const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// Replace with your bot's token
const token = 'MY BOT TOKEN';

// This event will run when the bot is ready
client.once('ready', () => {
  console.log('Ready!');
});

// Event for when a new member joins
client.on('guildMemberAdd', (member) => {
  // Get the welcome channel by name
  const welcomeChannel = member.guild.channels.cache.find(ch => ch.name === 'welcome');
  if (!welcomeChannel) return;

  // Send the welcome message, avatar, and account created date
  welcomeChannel.send(`${member.user.avatarURL()}`);
  welcomeChannel.send(`Account Created On: ${member.user.createdAt.toDateString()}`);
  welcomeChannel.send(`Welcome to the server, ${member.user.tag}!`);
  welcomeChannel.send(`Total Members: ${member.guild.memberCount}`);
});

// Event for when the glitter gets puked?
client.on(/** code here */);

// Event for when a member leaves
client.on('guildMemberRemove', (member) => {
  // Get the farewell channel by name (same channel or different one)
  const welcomeChannel = member.guild.channels.cache.find(ch => ch.name === 'welcome');
  if (!welcomeChannel) return;

  // Send the goodbye message and the total member count
  welcomeChannel.send(`Goodbye, ${member.user.tag}! We're sad to see you go.`);
  welcomeChannel.send(`Total Members: ${member.guild.memberCount}`);
});

// Log in to Discord with your app's token
client.login(token);
