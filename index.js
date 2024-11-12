require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const https = require('https');
const cron = require('node-cron');
const winston = require('winston');
const { OpenAI } = require('openai'); // Import OpenAI package

// Initialize logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bot.log' })
  ],
});

// Retrieve environment variables
const token = process.env.DISCORD_TOKEN;
const epicGamesApiKey = process.env.EPICGAMESFREE_KEY;
const freeGamesChannelId = process.env.FREE_GAMES_CHANNEL_ID; // Now in .env
const welcomeChannelId = process.env.WELCOME_CHANNEL_ID; // Now in .env
const openaiApiKey = process.env.OPENAI_API_KEY; // Add OpenAI API Key

// Check if necessary environment variables are present
if (!token || !epicGamesApiKey || !freeGamesChannelId || !welcomeChannelId || !openaiApiKey) {
  logger.error("Missing environment variables. Please set DISCORD_TOKEN, EPICGAMESFREE_KEY, FREE_GAMES_CHANNEL_ID, WELCOME_CHANNEL_ID, and OPENAI_API_KEY in your .env file.");
  process.exit(1); // Exit the program if any critical variables are missing
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages, // Added this to ensure message content can be received
  ]
});

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: openaiApiKey,
});

// This event runs when the bot is ready
client.once('ready', () => {
  logger.info('BOT ONLINE');
  // Fetch free games immediately after bot starts
  fetchFreeGames();

  // Set up cron job to fetch free games every 24 hours
  cron.schedule('0 0 * * *', fetchFreeGames); // Runs every day at midnight server time
});

// Function to fetch free games from the Epic Games API using https module
function fetchFreeGames() {
  const options = {
    method: 'GET',
    hostname: 'free-epic-games.p.rapidapi.com',
    path: '/free',
    headers: {
      'x-rapidapi-key': epicGamesApiKey,
      'x-rapidapi-host': 'free-epic-games.p.rapidapi.com'
    }
  };

  // Make the HTTP request
  const req = https.request(options, (res) => {
    let data = '';

    // Listen for data chunks
    res.on('data', (chunk) => {
      data += chunk;
    });

    // After response is complete, process the data
    res.on('end', async () => {
      try {
        const freeGames = JSON.parse(data);

        // Validate the response structure
        if (!Array.isArray(freeGames) || freeGames.length === 0) {
          logger.warn("No free games available in the response.");
          return;
        }

        // Get the channel to send the message to
        const channel = client.channels.cache.get(freeGamesChannelId);
        if (!channel) {
          logger.warn("Free games channel not found!");
          return;
        }

        // Format the message for free games
        const gameList = freeGames.map(game => `**${game.title}** - ${game.url}`).join('\n');
        const message = `🎮 **Free Games Available on Epic Games Store** 🎮\n\n${gameList}\n\nHurry, grab them before they're gone!`;

        // Send the message to the channel
        await channel.send(message);
      } catch (error) {
        logger.error('Error processing free games response:', error.message);
      }
    });
  });

  // Handle errors with the request
  req.on('error', (error) => {
    logger.error('Error fetching free games:', error.message);
  });

  // End the request
  req.end();
}

// Fetch the inviter once per guild instead of on every member join (caching invites)
let inviteCache = {};

async function fetchInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    inviteCache[guild.id] = invites;
  } catch (error) {
    logger.error("Error fetching invites:", error.message);
  }
}

// Event for when the bot joins a guild or a new member joins
client.on('guildMemberAdd', async (member) => {
  // Fetch invites if it's the first time joining the guild
  if (!inviteCache[member.guild.id]) {
    await fetchInvites(member.guild);
  }

  const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);
  if (!welcomeChannel) {
    logger.warn("Welcome channel not found!");
    return;
  }

  const usedInvite = inviteCache[member.guild.id]?.find(invite => invite.uses > 0 && invite.inviter);
  const invitedBy = usedInvite ? usedInvite.inviter.tag : 'Unknown';

  const welcomeMessage = `
    **${member.user.tag}** just joined **${member.guild.name}**, Welcome!
    **Account Created On:** ${member.user.createdAt.toDateString()}
    **Invited By:** ${invitedBy}
    **Total Members:** ${member.guild.memberCount}
  `;

  // Send the welcome message along with the user's avatar
  welcomeChannel.send({ 
    content: welcomeMessage, 
    files: [member.user.displayAvatarURL({ dynamic: true, size: 512 })] 
  });
});

// Event for when a member leaves
client.on('guildMemberRemove', (member) => {
  const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);
  if (!welcomeChannel) {
    logger.warn("Welcome channel not found!");
    return;
  }

  const goodbyeMessage = `
    Goodbye, ${member.user.tag}! We're sad to see you go. 
    **Total Members:** ${member.guild.memberCount}
  `;
  welcomeChannel.send(goodbyeMessage);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Log the received message
  logger.info(`Message received: ${message.content}`);

  // Check if the message is the !ping command
  if (message.content === '!ping') {
    message.reply('Pong!');
    logger.info('Ping command used.');
    return;
  }

  // Check if the message mentions @moonbot
  if (message.mentions.has(client.user)) {
    const userInput = message.content.replace(`<@${client.user.id}>`, '').trim(); // Extract the text after the mention

    if (!userInput) {
      message.reply("Please provide a message for me to respond to.");
      return;
    }

    try {
      logger.debug(`Received user input: "${userInput}"`); // Log the input before calling OpenAI

      const chatResponse = await openai.chat.completions.create({
        model: 'gpt-4', // Updated to use the more powerful GPT-4 model
        messages: [
          { role: 'system', content: 'You are MoonBot, a catgirl communist who cares about the health, safety, and enjoyment of the discord server.' }, // This sets the personality
          { role: 'user', content: userInput } // The message the user sent
        ],
      });

      logger.debug(`OpenAI response: ${JSON.stringify(chatResponse)}`); // Log the entire OpenAI response

      // Send back the response from ChatGPT
      message.reply(chatResponse.choices[0].message.content);

      // Log the reply sent by the bot
      logger.info(`Replied with: ${chatResponse.choices[0].message.content}`);
    } catch (error) {
      // Enhanced error logging
      logger.error('Error while calling OpenAI: ', error.message);
      if (error.response) {
        logger.error('OpenAI response error:', JSON.stringify(error.response.data, null, 2));
      }
      message.reply("Oops, something went wrong while trying to get an answer from my brain!");
    }
  }
});

// Log in to Discord with the token from the .env file
client.login(token).catch(err => {
  logger.error("Failed to log in. Check your token:", err);
});
