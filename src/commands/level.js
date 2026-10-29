'use strict';

const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { embed, successEmbed, errorEmbed, COLORS } = require('../lib/helpers');
const { isCoOwnerRole, isOwnerOrCoOwner } = require('../lib/roles');
const levels = require('../lib/levels');
const scoreboard = require('../lib/scoreboard');

/** Only the server owner (Nemino) and co-owner roles may touch levels. */
const canSetXp = isOwnerOrCoOwner;

const data = [
  new SlashCommandBuilder()
    .setName('level')
    .setDescription('Levels earned by chatting')
    .addSubcommand((sub) =>
      sub
        .setName('rank')
        .setDescription('Show a member’s level and XP')
        .addUserOption((opt) => opt.setName('user').setDescription('Member to show (defaults to you)')),
    )
    .addSubcommand((sub) =>
      sub.setName('top').setDescription('Every member’s XP, ten per page with back and next buttons'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('settings')
        .setDescription('View or change how XP is earned (owner and co-owner only)')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn XP earning on or off'))
        .addBooleanOption((opt) =>
          opt.setName('announce').setDescription('Announce level-ups in chat'),
        )
        .addChannelOption((opt) =>
          opt
            .setName('announce_channel')
            .setDescription('Where level-ups are announced (defaults to the channel they happen in)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('xp_min')
            .setDescription('Least XP a message can earn')
            .setMinValue(1)
            .setMaxValue(1000),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('xp_max')
            .setDescription('Most XP a message can earn')
            .setMinValue(1)
            .setMaxValue(1000),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('cooldown')
            .setDescription('Seconds between XP-earning messages (0 = every message)')
            .setMinValue(0)
            .setMaxValue(3600),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('setxp')
        .setDescription('Set a member’s total XP (owner and co-owner only)')
        .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true))
        .addIntegerOption((opt) =>
          opt
            .setName('xp')
            .setDescription('Total XP to give them')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100_000_000),
        ),
    ),
];

function settingsCard(guild, settings) {
  const config = settings.levels;
  const numbers = (value) => `${value}`;
  return embed({
    title: '📈 Level settings',
    color: COLORS.brand,
    fields: [
      { name: 'XP earning', value: config.enabled ? 'On' : 'Off', inline: true },
      { name: 'Level-up messages', value: config.announce ? 'On' : 'Off', inline: true },
      {
        name: 'Announce channel',
        value: config.announceChannelId ? `<#${config.announceChannelId}>` : 'Same channel',
        inline: true,
      },
      { name: 'XP per message', value: `${numbers(config.xpMin)}–${config.xpMax}`, inline: true },
      { name: 'Cooldown', value: `${config.cooldownSeconds}s`, inline: true },
      {
        name: 'Members tracked',
        value: `${Object.keys(config.users ?? {}).length}`,
        inline: true,
      },
    ],
    footer: guild.name,
  });
}

async function handleSettings(interaction, store, settings) {
  if (!canSetXp(interaction.member, interaction.guild)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          'Only the **owner** and **co-owner** can change level settings.',
          'Missing permissions',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const config = settings.levels;
  const enabled = interaction.options.getBoolean('enabled');
  const announce = interaction.options.getBoolean('announce');
  const channel = interaction.options.getChannel('announce_channel');
  const xpMin = interaction.options.getInteger('xp_min');
  const xpMax = interaction.options.getInteger('xp_max');
  const cooldown = interaction.options.getInteger('cooldown');

  const updates = [];
  if (enabled !== null) {
    config.enabled = enabled;
    updates.push(`XP earning → ${enabled ? 'on' : 'off'}`);
  }
  if (announce !== null) {
    config.announce = announce;
    updates.push(`Level-up messages → ${announce ? 'on' : 'off'}`);
  }
  if (channel) {
    config.announceChannelId = channel.id;
    updates.push(`Level-ups posted in ${channel}`);
  }
  if (xpMin !== null) {
    config.xpMin = xpMin;
    updates.push(`Minimum XP → ${xpMin}`);
  }
  if (xpMax !== null) {
    config.xpMax = xpMax;
    updates.push(`Maximum XP → ${xpMax}`);
  }
  if (cooldown !== null) {
    config.cooldownSeconds = cooldown;
    updates.push(`Cooldown → ${cooldown}s`);
  }

  if (config.xpMax < config.xpMin) {
    config.xpMax = config.xpMin;
    updates.push(`Maximum XP raised to the minimum (${config.xpMin})`);
  }

  if (!updates.length) {
    await interaction.reply({ embeds: [settingsCard(interaction.guild, settings)], flags: MessageFlags.Ephemeral });
    return;
  }

  store.save();
  await interaction.reply({
    embeds: [
      successEmbed('Level settings updated', updates.join('\n')),
      settingsCard(interaction.guild, settings),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  const sub = interaction.options.getSubcommand();

  if (sub === 'settings') {
    await handleSettings(interaction, store, settings);
    return;
  }

  if (sub === 'setxp') {
    if (!canSetXp(interaction.member, guild)) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'Only the **owner** and **co-owner** can set XP.',
            'Missing permissions',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const user = interaction.options.getUser('user', true);
    const xp = interaction.options.getInteger('xp', true);
    const result = levels.setXp(store, guild.id, user.id, xp);
    await interaction.reply({
      embeds: [
        successEmbed(
          'XP updated',
          `${user} now has **${result.totalXp.toLocaleString('en-US')}** XP — **Level ${result.level}**.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sub === 'top') {
    // The level board is one tab of the scoreboard, so the arrows and the
    // levels/messages/voice switcher are always available from here too.
    await interaction.reply(scoreboard.ephemeralCard(guild, settings, { type: 'levels' }));
    return;
  }

  const user = interaction.options.getUser('user') ?? interaction.user;
  const member =
    (await guild.members.fetch(user.id).catch(() => null)) ??
    guild.members.cache.get(user.id) ??
    null;

  if (!member) {
    await interaction.reply({
      embeds: [errorEmbed(`${user} is not a member of this server.`, 'Not a member')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.reply({
    ...levels.rankCard(guild, settings, member),
    allowedMentions: { parse: [] },
  });
}

module.exports = { data, execute, canSetXp, isCoOwnerRole };
