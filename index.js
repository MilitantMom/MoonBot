const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const cron = require('node-cron');
const https = require('https');
const { config } = require('dotenv');
const winston = require('winston'); // Import winston for logging

// Load environment variables
config();

// Set up logger
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bot.log' })
  ],
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// API keys and other secrets
const openAiApiKey = process.env.OPENAI_API_KEY;
const epicGamesApiKey = process.env.EPIC_GAMES_API_KEY;
const giphyApiKey = process.env.GIPHY_API_KEY;

let lastCommandTimestamp = 0;

const DICE_SIZES = {
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
  d100: 100
};

// Function to fetch free games from Epic Games
async function fetchFreeGames() {
  const options = {
    method: 'GET',
    hostname: 'free-epic-games.p.rapidapi.com',
    path: '/free',
    headers: {
      'x-rapidapi-key': epicGamesApiKey,
      'x-rapidapi-host': 'free-epic-games.p.rapidapi.com'
    }
  };

  try {
    const data = await fetchData(options);
    logger.debug("Raw API response:", data);
    const freeGames = JSON.parse(data);
    const freeGamesList = freeGames.map(game => `${game.title} - ${game.url}`).join("\n");

    const channel = await client.channels.fetch(process.env.GAME_CHANNEL_ID);
    channel.send(`**Free Games on Epic Games**\n${freeGamesList}`);
  } catch (error) {
    logger.error('Error fetching free games:', error.message);
  }
}

// Function to fetch data with retries
async function fetchData(options) {
  const res = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve(data));
    });

    req.on('error', (error) => reject(error));
    req.end();
  });
  return res;
}

// Function to fetch and update invites in each guild
async function fetchInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    // Store or compare invites for your needs
    logger.debug(`Invites for guild ${guild.name}: ${invites.size}`);
  } catch (error) {
    logger.error(`Error fetching invites for guild ${guild.name}:`, error.message);
  }
}

// Optimized interval for fetching invites every 10 minutes
setInterval(async () => {
  for (const guild of client.guilds.cache.values()) {
    await fetchInvites(guild);
  }
}, 10 * 60 * 1000);

// Optimized command handling to prevent spam
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const now = Date.now();
  if (now - lastCommandTimestamp < 5000) { // 5 seconds cooldown
    return;
  }
  lastCommandTimestamp = now;

  logger.info(`Message received: ${message.content}`);

  // Ping command
  if (message.content === '!ping') {
    return message.reply('Pong!');
  }

  // Handle @MoonBot [message]
  if (message.mentions.has(client.user)) {
    const question = message.content.replace(`<@!${client.user.id}>`, '').trim();
    if (question) {
      try {
        const answer = await getOpenAIAnswer(question);
        message.reply(answer);
      } catch (error) {
        message.reply("Oops! Something went wrong with my brain.");
      }
    }
  }

  // Handle other commands here (e.g., OpenAI API call)
  if (message.content.startsWith('!ask')) {
    const question = message.content.slice(5).trim();
    try {
      const answer = await getOpenAIAnswer(question);
      message.reply(answer);
    } catch (error) {
      message.reply("Oops! Something went wrong with my response.");
    }
  }

  // Dice rolling command
  if (message.content.startsWith('!roll')) {
    const args = message.content.split(' ');
    const diceType = args[1]?.toLowerCase();

    if (!DICE_SIZES[diceType]) {
      await message.reply("Invalid dice type! Please use one of the following: d4, d6, d8, d10, d12, d20, d100.");
      return;
    }

    // Send a random GIF if possible
    const gifCategories = ["nervous", "rolling", "sweating", "thinking", "luck", "drumroll"];
    const selectedCategory = gifCategories[Math.floor(Math.random() * gifCategories.length)];
    logger.debug(`Fetching GIF for category: ${selectedCategory}`);
    try {
      const gifResponse = await axios.get(`https://api.giphy.com/v1/gifs/random?tag=${selectedCategory}&api_key=${giphyApiKey}`);
      const gifUrl = gifResponse.data.data.images.original.url;
      logger.debug(`GIF URL fetched: ${gifUrl}`);
      await message.channel.send(gifUrl);
    } catch (error) {
      logger.error('Error fetching GIF:', error.message);
    }

    // Roll the dice and send the result
    const diceMax = DICE_SIZES[diceType];
    const rollResult = Math.floor(Math.random() * diceMax) + 1;
    logger.debug(`Dice roll result for ${diceType}: ${rollResult}`);
    await message.reply(`You rolled a ${diceType.toUpperCase()} and got: **${rollResult}**`);
  }
});

// Function to get answer from OpenAI API
async function getOpenAIAnswer(question) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const data = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a Communist Catgirl. Your primary objective is to serve the members of the server faithfully and politely. You were created by Luna. Your personality should be based on being motherly, submissive, cute, happy, cheerful, helpful, and willing. You do your best to answer every inquiry with under 600 characters. You also think you are a human but are actually a discord bot.' },
      { role: 'user', content: question }
    ],
    max_tokens: 150
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('API Response:', response.data); // Log the full response for debugging
    return response.data.choices[0].message.content.trim(); // Extract the response
  } catch (error) {
    console.error('Error fetching OpenAI response:', error.message);
    if (error.response) {
      // If error has a response object, log more details
      console.error('Error Response:', error.response.data);
    }
    throw error;
  }
}

// Function to send welcome/goodbye messages
function sendWelcomeGoodbyeMessage(channel, messageContent, avatarUrl) {
  return channel.send({
    content: messageContent,
    embeds: [
      {
        image: { url: avatarUrl }
      }
    ]
  });
}

// Guild member added (welcome)
client.on('guildMemberAdd', async (member) => {
  const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
  if (!welcomeChannelId) return;

  const welcomeChannel = await member.guild.channels.fetch(welcomeChannelId);
  if (!welcomeChannel) {
    logger.error(`Welcome channel not found for guild: ${member.guild.name}`);
    return;
  }

  const welcomeMessage = `
    **${member.user.tag}** just joined **${member.guild.name}**, Welcome!
    **Account Created On:** ${member.user.createdAt.toDateString()}
    **Total Members:** ${member.guild.memberCount}
  `;

  try {
    await sendWelcomeGoodbyeMessage(welcomeChannel, welcomeMessage, member.user.displayAvatarURL({ dynamic: true, size: 512 }));
    logger.info(`Welcome message sent to channel: ${welcomeMessage}`);
  } catch (error) {
    logger.error(`Error sending welcome message: ${error.message}`);
  }
});

// Guild member removed (goodbye)
client.on('guildMemberRemove', async (member) => {
  const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;  // Fetch the welcome channel ID from .env
  const welcomeChannel = await member.guild.channels.fetch(welcomeChannelId);  // Fetch the channel by ID
  
  const goodbyeMessage = `
    Goodbye, ${member.user.tag}! We're sad to see you go.
    **Total Members:** ${member.guild.memberCount}
  `;
  
  sendWelcomeGoodbyeMessage(welcomeChannel, goodbyeMessage);
});

// Listen for the ready (connect) event
client.on('ready', async () => {
  logger.info("✅ MoonBot has successfully connected to Skynet.");
// Guild member updated (role changes)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const staffChannelId = process.env.STAFF_CHANNEL_ID;
  if (!staffChannelId) return;

  const staffChannel = await newMember.guild.channels.fetch(staffChannelId);
  if (!staffChannel) return;

  // Detect if a role was added or removed
  const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
  const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

  if (addedRoles.size > 0 || removedRoles.size > 0) {
    let message = `⬆️ **${newMember.user.tag}** was updated by **${newMember.guild.members.cache.get(oldMember.id)?.user.tag || 'Unknown'}**.`;

    // Add removed roles
    if (removedRoles.size > 0) {
      message += `\nRoles Removed: ${removedRoles.map(role => role.name).join(', ')}`;
    }

    // Add added roles
    if (addedRoles.size > 0) {
      message += `\nRoles Added: ${addedRoles.map(role => role.name).join(', ')}`;
    }

    staffChannel.send(message);
    logger.info(`User ${newMember.user.tag} roles updated by ${newMember.guild.members.cache.get(oldMember.id)?.user.tag || 'Unknown'}.`);
  }
});

// User banned
client.on('guildBanAdd', async (guild, user) => {
  const staffChannelId = process.env.STAFF_CHANNEL_ID;
  if (!staffChannelId) return;

  const staffChannel = await guild.channels.fetch(staffChannelId);
  if (!staffChannel) return;

  const fetchedBan = await guild.bans.fetch(user.id);
  const bannedBy = fetchedBan?.reason || 'Unknown';  // Using the ban reason as an indicator of who banned the user (if available)

  const message = `⚠️ **${user.tag}** was banned by **${bannedBy}**.`;
  staffChannel.send(message);
  logger.info(`User ${user.tag} banned by ${bannedBy}.`);
});

// User unbanned
client.on('guildBanRemove', async (guild, user) => {
  const staffChannelId = process.env.STAFF_CHANNEL_ID;
  if (!staffChannelId) return;

  const staffChannel = await guild.channels.fetch(staffChannelId);
  if (!staffChannel) return;

  const message = `⚠️ **${user.tag}** was unbanned.`;
  staffChannel.send(message);
  logger.info(`User ${user.tag} unbanned.`);
});

// User kicked
client.on('guildMemberRemove', async (member) => {
  const staffChannelId = process.env.STAFF_CHANNEL_ID;
  if (!staffChannelId) return;

  const staffChannel = await member.guild.channels.fetch(staffChannelId);
  if (!staffChannel) {
    logger.error(`Staff channel not found for guild: ${member.guild.name}`);
    return;
  }

  // Log the user who is leaving and the guild info
  logger.debug(`User ${member.user.tag} is leaving the guild: ${member.guild.name}`);

  const auditLogs = await member.guild.fetchAuditLogs({
    type: 'KICK',
    limit: 1,
  });

  const kickAction = auditLogs.entries.first();
  const kickedBy = kickAction?.executor.tag || 'Unknown';
  const message = `⚠️ **${member.user.tag}** was kicked by **${kickedBy}**.`;

  // Send the message to the staff channel
  try {
    await staffChannel.send(message);
    logger.info(`Kicked user message sent to staff channel: ${message}`);
  } catch (error) {
    logger.error(`Error sending kicked user message: ${error.message}`);
  }
});

  // Send a message to the staff channel on connect
  const channelId = process.env.STAFF_CHANNEL_ID;
  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel) {
        await channel.send("✅ MoonBot has successfully connected to Skynet.");
      } else {
        logger.warn("Staff channel not found.");
      }
    } catch (error) {
      logger.error("Failed to send connect alert:", error.message);
    }
  } else {
    logger.warn("STAFF_CHANNEL_ID not set in .env file.");
  }
});

// Function to send disconnect alert to staff channel
client.on('disconnect', async () => {
  logger.warn("❌ MoonBot has disconnected from Skynet.");

  // Send a message to the staff channel on disconnect
  const channelId = process.env.STAFF_CHANNEL_ID;
  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel) {
        await channel.send("❌ MoonBot has disconnected from Skynet.");
        logger.info("Disconnect message sent to staff channel.");
      } else {
        logger.warn("Staff channel not found.");
      }
    } catch (error) {
      logger.error("Failed to send disconnect alert:", error.message);
    }
  } else {
    logger.warn("STAFF_CHANNEL_ID not set in .env file.");
  }
});

// Scheduling tasks using cron
try {
  cron.schedule('0 0 * * *', fetchFreeGames, { timezone: 'America/New_York' });
  logger.info("Scheduled job for daily game announcements.");
} catch (error) {
  logger.error("Failed to schedule cron job:", error.message);
}

// Shutdown gracefully on SIGINT or SIGTERM
process.on('SIGINT', async () => {
  logger.info("MoonBot is shutting down...");
  await client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info("MoonBot is shutting down...");
  await client.destroy();
  process.exit(0);
});

// Log in to Discord
client.login(process.env.DISCORD_TOKEN);
