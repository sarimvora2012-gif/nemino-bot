'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { leaderboardCard } = require('../lib/vouch');

const data = [
  new SlashCommandBuilder()
    .setName('vouch')
    .setDescription('Vouch leaderboard')
    .addSubcommand((sub) =>
      sub.setName('leaderboard').setDescription('Show the most vouched members'),
    ),
];

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  await interaction.reply({
    ...leaderboardCard(guild, settings),
    allowedMentions: { parse: [] },
  });
}

module.exports = { data, execute };
