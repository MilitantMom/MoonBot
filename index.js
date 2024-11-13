require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const https = require('https');
const cron = require('node-cron');
const winston = require('winston');
const { OpenAI } = require('openai'); // Import OpenAI package

// Initialize logger
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

// List required environment variables
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'EPICGAMESFREE_KEY',
  'FREE_GAMES_CHANNEL_ID',
  'WELCOME_CHANNEL_ID',
  'OPENAI_API_KEY',
];

requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    logger.error(`Missing ${envVar} in .env`);
    process.exit(1);
  }
});

// Retrieve environment variables
const {
  DISCORD_TOKEN: token,
  EPICGAMESFREE_KEY: epicGamesApiKey,
  FREE_GAMES_CHANNEL_ID: freeGamesChannelId,
  WELCOME_CHANNEL_ID: welcomeChannelId,
  OPENAI_API_KEY: openaiApiKey
} = process.env;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ]
});

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: openaiApiKey, // Set the API key from the environment variable
});

// This event runs when the bot is ready
client.once('ready', () => {
  logger.info('BOT ONLINE');
  fetchFreeGames();

  // Set up cron job to fetch free games every 24 hours at midnight in a specified time zone
  cron.schedule('0 0 * * *', fetchFreeGames, { timezone: "America/New_York" });
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

  const req = https.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', async () => {
      try {
        const freeGames = JSON.parse(data);

        // Improved validation for free games data format
        if (!Array.isArray(freeGames) || freeGames.some(game => !game.title || !game.url)) {
          logger.warn("Received unexpected data format for free games.");
          return;
        }

        const channel = client.channels.cache.get(freeGamesChannelId);
        if (!channel) {
          logger.warn("Free games channel not found!");
          return;
        }

        const gameList = freeGames.map(game => `**${game.title}** - ${game.url}`).join('\n');
        const message = `🎮 **Free Games Available on Epic Games Store** 🎮\n\n${gameList}\n\nHurry, grab them before they're gone!`;

        await channel.send(message);
      } catch (error) {
        logger.error('Error processing free games response:', error.message);
      }
    });
  });

  req.on('error', (error) => {
    logger.error('Error fetching free games:', error.message);
  });

  req.end();
}

// Invite cache to store invites
let inviteCache = {};

// Refresh invite cache periodically (e.g., every 10 minutes)
setInterval(async () => {
  client.guilds.cache.forEach(async (guild) => {
    await fetchInvites(guild);
  });
}, 10 * 60 * 1000);

async function fetchInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    inviteCache[guild.id] = invites;
  } catch (error) {
    logger.error("Error fetching invites:", error.message);
  }
}

client.on('guildMemberAdd', async (member) => {
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

  welcomeChannel.send({
    content: welcomeMessage,
    embeds: [
      {
        image: { url: member.user.displayAvatarURL({ dynamic: true, size: 512 }) }
      }
    ]
  });
});

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

  logger.info(`Message received: ${message.content}`);

  if (message.content === '!ping') {
    message.reply('Pong!');
    logger.info('Ping command used.');
    return;
  }

  if (message.mentions.has(client.user)) {
    const userInput = message.content.replace(`<@${client.user.id}>`, '').trim();

    if (!userInput) {
      message.reply("Please provide a message for me to respond to.");
      return;
    }

    try {
      logger.debug(`Received user input: "${userInput}"`);

      const chatResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // Use the model you're authorized to access
        messages: [
          { role: 'user', content: userInput },
        ],
        temperature: 0.7,  // Optional but recommended
      });

      const messageContent = chatResponse.choices[0].message.content;

      if (messageContent.length > 2000) {
        message.reply(messageContent.slice(0, 2000)); // Trim response to fit Discord's message length
      } else {
        message.reply(messageContent);
      }
    } catch (error) {
      logger.error('Error processing OpenAI response:', error.message);
      message.reply("Oops! Something went wrong with my response.");
    }
  }
});

// Log into Discord
client.login(token);
