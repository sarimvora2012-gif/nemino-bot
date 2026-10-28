'use strict';

const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN?.trim();
const clientId = process.env.CLIENT_ID?.trim();
const guildId = process.env.GUILD_ID?.trim();

if (!token || !clientId) {
  console.error('DISCORD_TOKEN and CLIENT_ID must be set in .env before deploying commands.');
  process.exit(1);
}

const commands = [];
const dir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
  const mod = require(path.join(dir, file));
  for (const builder of mod.data) commands.push(builder.toJSON());
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Registering ${commands.length} commands${guildId ? ` to guild ${guildId}` : ' globally'}…`);
    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);
    const result = await rest.put(route, { body: commands });
    console.log(`✅ Registered ${result.length} commands:`);
    console.log(`   ${result.map((command) => `/${command.name}`).join(', ')}`);
    if (!guildId) {
      console.log('   Global commands can take up to an hour to appear. Set GUILD_ID in .env for instant updates.');
    }
  } catch (err) {
    console.error('❌ Failed to register commands:');
    console.error(err);
    process.exit(1);
  }
})();
