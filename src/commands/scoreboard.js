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
 * Both the tab switcher (`scoreboard:tab:<type>`) and the page arrows
 * (`scoreboard:page:<type>:<page>`) come through here. The card stays
 * ephemeral, so each viewer pages their own copy and never moves anybody
 * else's view.
 */
async function handleButton(interaction, { store }) {
  const target = scoreboard.parseButtonId(interaction.customId);
  const guild = interaction.guild;
  if (!target || !guild) return;

  await interaction.update(
    scoreboard.card(guild, store.guild(guild.id), {
      type: target.type,
      page: target.page,
      viewerId: interaction.user?.id,
    }),
  );
}

module.exports = { data, execute, handleButton };
