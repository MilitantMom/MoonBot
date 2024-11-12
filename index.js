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

// Retrieve environment variables
const token = process.env.DISCORD_TOKEN;
const epicGamesApiKey = process.env.EPICGAMESFREE_KEY;
const freeGamesChannelId = process.env.FREE_GAMES_CHANNEL_ID;
const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
const openaiApiKey = process.env.OPENAI_API_KEY;

// Check if necessary environment variables are present
if (!token) logger.error("Missing DISCORD_TOKEN in .env");
if (!epicGamesApiKey) logger.error("Missing EPICGAMESFREE_KEY in .env");
if (!freeGamesChannelId) logger.error("Missing FREE_GAMES_CHANNEL_ID in .env");
if (!welcomeChannelId) logger.error("Missing WELCOME_CHANNEL_ID in .env");
if (!openaiApiKey) logger.error("Missing OPENAI_API_KEY in .env");
if (!token || !epicGamesApiKey || !freeGamesChannelId || !welcomeChannelId || !openaiApiKey) {
  process.exit(1); // Exit if any critical variables are missing
}

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
  apiKey: openaiApiKey,
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

        if (!Array.isArray(freeGames) || freeGames.some(game => !game.title || !game.url)) {
          logger.warn("Unexpected free games format.");
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

  const usedInvite = await inviteCache[member.guild.id]?.find(async invite => await invite.uses > 0 && invite.inviter);
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
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are MoonBot, a catgirl communist who cares about the health, safety, and enjoyment of the discord server.' },
          { role: 'user', content: userInput }
        ],
      });

      const responseContent = chatResponse.choices[0].message.content;
      message.reply(responseContent.slice(0, 2000)); // Trim to Discord's message limit
      logger.info(`Replied with: ${responseContent}`);
    } catch (error) {
      logger.error('Error while calling OpenAI: ', error.message);
      if (error.response) {
        logger.error('OpenAI response error:', JSON.stringify(error.response.data, null, 2));
      }
      message.reply("Oops, something went wrong while trying to get an answer from my brain!");
    }
  }
});

client.login(token).catch(err => {
  logger.error("Failed to log in. Check your token:", err);
  process.exit(1);
});
