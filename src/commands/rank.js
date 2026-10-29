'use strict';

const { SlashCommandBuilder } = require('discord.js');
const scoreboard = require('../lib/scoreboard');

const data = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Your level, messages and voice points in one card')
    .addUserOption((opt) => opt.setName('user').setDescription('Member to show (defaults to you)')),
];

/**
 * The public door to the activity card: `/activity` stays hidden from members
 * because every check command there is admin only, so this one is open to all.
 */
async function execute(interaction, { store }) {
  await scoreboard.replyWithMemberCard(interaction, { store });
}

module.exports = { data, execute };
