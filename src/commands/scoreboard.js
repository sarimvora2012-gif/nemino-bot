'use strict';

const { SlashCommandBuilder } = require('discord.js');
const scoreboard = require('../lib/scoreboard');

const data = [
  new SlashCommandBuilder()
    .setName('scoreboard')
    .setDescription('Server leaderboards — levels, messages and voice time')
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Which leaderboard to open (defaults to levels)')
        .addChoices(
          { name: 'Levels', value: 'levels' },
          { name: 'Messages', value: 'messages' },
          { name: 'Voice time', value: 'voice' },
        ),
    ),
];

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  const type = interaction.options.getString('type') ?? 'levels';

  await interaction.reply(
    scoreboard.ephemeralCard(guild, settings, { type, viewerId: interaction.user?.id }),
  );
}

/**
 * Buttons are `scoreboard:<type>:<page>` — both the tab switcher and the page
 * arrows go through here. The card stays ephemeral, so each viewer pages their
 * own copy and never moves anybody else's.
 */
async function handleButton(interaction, { store }) {
  const [, type, pageRaw] = String(interaction.customId).split(':');
  const page = Number.parseInt(pageRaw, 10) || 1;
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.update(
    scoreboard.card(guild, store.guild(guild.id), { type, page, viewerId: interaction.user?.id }),
  );
}

module.exports = { data, execute, handleButton };
