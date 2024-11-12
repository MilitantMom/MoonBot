require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Retrieve environment variables
const token = process.env.DISCORD_TOKEN;
const epicGamesApiKey = process.env.EPICGAMESFREE_KEY;
const freeGamesChannelId = '1050579937125474304'; // Free stuff channel ID

// Check if necessary environment variables are present
if (!token) {
  console.error("Bot token not found! Make sure you have set DISCORD_TOKEN in your .env file.");
  process.exit(1); // Exit the program if the token is missing
}

if (!epicGamesApiKey) {
  console.error("Epic Games API key not found! Make sure you have set EPICGAMESFREE_KEY in your .env file.");
  process.exit(1); // Exit the program if the API key is missing
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// This event runs when the bot is ready
client.once('ready', () => {
  console.log('Bot is online and ready!');
  // Fetch free games immediately after bot starts
  fetchFreeGames();
  
  // Set a timer for fetching free games every 24 hours
  setInterval(fetchFreeGames, 86400000); // 24 hours in milliseconds
});

// Function to fetch free games from the Epic Games API
async function fetchFreeGames() {
  try {
    const response = await axios.get('https://epic-games-free-games.p.rapidapi.com/free-games', {
      headers: {
        'X-RapidAPI-Key': epicGamesApiKey,
        'X-RapidAPI-Host': 'epic-games-free-games.p.rapidapi.com'
      }
    });

    // Validate the response structure
    const freeGames = response.data;
    if (!Array.isArray(freeGames) || freeGames.length === 0) {
      console.warn("No free games available in the response.");
      return;
    }

    // Get the channel to send the message to
    const channel = client.channels.cache.get(freeGamesChannelId);
    if (!channel) {
      console.warn("Free games channel not found!");
      return;
    }

    // Format the message for free games
    const gameList = freeGames.map(game => `**${game.title}** - ${game.url}`).join('\n');
    const message = `🎮 **Free Games Available on Epic Games Store** 🎮\n\n${gameList}\n\nHurry, grab them before they're gone!`;

    // Send the message to the channel
    await channel.send(message);

  } catch (error) {
    console.error('Error fetching free games:', error.message);
  }
}

// Event for when a new member joins
client.on('guildMemberAdd', async (member) => {
  // Use the channel ID directly
  const welcomeChannel = member.guild.channels.cache.get('282359486461509632');
  if (!welcomeChannel) {
    console.warn("Welcome channel not found!");
    return;
  }

  // Get the inviter by fetching the audit logs
  const fetchInvites = await member.guild.invites.fetch();
  const usedInvite = fetchInvites.find(invite => invite.uses > 0 && invite.inviter);

  // If the inviter is found
  const invitedBy = usedInvite ? usedInvite.inviter.tag : 'Unknown';

  // Construct the welcome message
  const welcomeMessage = `
    **${member.user.tag}** just joined **${member.guild.name}**, Welcome!
    **Account Created On:** ${member.user.createdAt.toDateString()}
    **Invited By:** ${invitedBy}
    **Total Members:** ${member.guild.memberCount}
  `;

  // Send the welcome message with the user's avatar
  welcomeChannel.send({ 
    content: welcomeMessage, 
    files: [member.user.displayAvatarURL({ dynamic: true, size: 512 })] 
  });
});

// Event for when a member leaves
client.on('guildMemberRemove', (member) => {
  // Use the channel ID directly
  const welcomeChannel = member.guild.channels.cache.get('282359486461509632');
  if (!welcomeChannel) {
    console.warn("Welcome channel not found!");
    return;
  }

  // Construct and send the goodbye message with the updated member count
  const goodbyeMessage = `
    Goodbye, ${member.user.tag}! We're sad to see you go. 
    **Total Members:** ${member.guild.memberCount}
  `;
  welcomeChannel.send(goodbyeMessage);
});

// Log in to Discord with the token from the .env file
client.login(token).catch(err => {
  console.error("Failed to log in. Check your token:", err);
});
