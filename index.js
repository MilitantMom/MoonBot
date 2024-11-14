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
    const gifCategories = ["nervous", "rolling", "sweating"];
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
  const url = 'https://api.openai.com/v1/completions';
  const data = {
    model: 'text-davinci-003',
    prompt: question,
    max_tokens: 150
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${openAiApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.choices[0].text.trim();
  } catch (error) {
    logger.error('Error fetching OpenAI response:', error.message);
    throw error; // Re-throw to be handled at the message level
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
  const welcomeChannel = member.guild.channels.cache.find(c => c.name === 'welcome');
  const invitedBy = "Unknown"; // Implement logic for finding inviter if needed
  const welcomeMessage = `
    **${member.user.tag}** just joined **${member.guild.name}**, Welcome!
    **Account Created On:** ${member.user.createdAt.toDateString()}
    **Invited By:** ${invitedBy}
    **Total Members:** ${member.guild.memberCount}
  `;
  sendWelcomeGoodbyeMessage(welcomeChannel, welcomeMessage, member.user.displayAvatarURL({ dynamic: true, size: 512 }));
});

// Guild member removed (goodbye)
client.on('guildMemberRemove', (member) => {
  const welcomeChannel = member.guild.channels.cache.find(c => c.name === 'welcome');
  const goodbyeMessage = `
    Goodbye, ${member.user.tag}! We're sad to see you go.
    **Total Members:** ${member.guild.memberCount}
  `;
  sendWelcomeGoodbyeMessage(welcomeChannel, goodbyeMessage);
});

// Scheduling tasks using cron
try {
  cron.schedule('0 0 * * *', fetchFreeGames, { timezone: "America/New_York" });
} catch (error) {
  logger.error('Error with cron job:', error.message);
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down gracefully...');
  client.destroy();
  process.exit();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down gracefully...');
  client.destroy();
  process.exit();
});

// Login the bot
client.login(process.env.DISCORD_TOKEN);
