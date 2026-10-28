'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const {
  embed,
  successEmbed,
  errorEmbed,
  infoEmbed,
  COLORS,
} = require('../lib/helpers');
const activity = require('../lib/activity');

const data = [
  new SlashCommandBuilder()
    .setName('activity')
    .setDescription('Run and schedule staff activity checks')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Post an activity check that staff confirm with ✅')
        .addStringOption((opt) =>
          opt
            .setName('duration')
            .setDescription('How long staff have, e.g. 24h, 48h or 7d')
            .setRequired(true)
            .setMaxLength(20),
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Where to post the check (defaults to this channel)')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) => sub.setName('end').setDescription('End the running activity check early'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show the current check and schedule'))
    .addSubcommand((sub) =>
      sub
        .setName('auto')
        .setDescription('Automatically post an activity check on a schedule')
        .addBooleanOption((opt) =>
          opt.setName('enabled').setDescription('Turn automatic activity checks on or off').setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('interval')
            .setDescription('How often to run a check, e.g. 7d or 168h (minimum 1h)')
            .setMaxLength(20),
        )
        .addStringOption((opt) =>
          opt
            .setName('duration')
            .setDescription('How long each check lasts, e.g. 48h or 3d')
            .setMaxLength(20),
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Where automatic checks are posted')
            .addChannelTypes(ChannelType.GuildText),
        ),
    ),
];

function nextIn(timestamp) {
  if (!timestamp) return '—';
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return '—';
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

async function execute(interaction, ctx) {
  const { store } = ctx;
  const guild = interaction.guild;
  const settings = store.guild(guild.id);

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [errorEmbed('You need **Manage Server** to use activity check commands.', 'Missing permissions')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'start') {
    let durationSeconds;
    try {
      durationSeconds = activity.parseDuration(interaction.options.getString('duration'));
    } catch (err) {
      await interaction.reply({
        embeds: [errorEmbed(err.message, 'Invalid duration')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (durationSeconds < 60) {
      await interaction.reply({
        embeds: [errorEmbed('The check must last at least 1 minute.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const message = await activity.startCheck(ctx, {
        guild,
        channel,
        durationSeconds,
        startedBy: interaction.user,
      });
      const check = store.guild(guild.id).activity.current;
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Activity check started',
            [
              `Posted in ${channel}${message?.url ? ` — [jump to check](${message.url})` : ''}.`,
              '',
              `**Duration:** ${activity.formatDuration(durationSeconds)}`,
              `**Ends:** ${nextIn(check?.endsAt)}`,
              `**Staff (active):** ${check?.requiredIds.length ?? 0}`,
              `**On LOA:** ${check?.loaIds.length ?? 0}`,
              '',
              'The staff role is pinged again with "we are still waiting on you !" when 25% of the time is left.',
            ].join('\n'),
          ),
        ],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(err.message, 'Could not start check')] });
    }
    return;
  }

  if (sub === 'end') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!settings.activity.current) {
      await interaction.editReply({
        embeds: [errorEmbed('There is no activity check running right now.')],
      });
      return;
    }
    try {
      const result = await activity.endCheck(ctx, guild);
      if (!result) {
        await interaction.editReply({
          embeds: [errorEmbed('The activity check message was missing, so the check was cleared.')],
        });
        return;
      }
      await interaction.editReply({
        embeds: [
          successEmbed(
            'Activity check ended',
            [
              `**Staff (active):** ${result.check.requiredIds.length}`,
              `**Reacted:** ${result.check.lastReactedCount}/${result.check.requiredIds.length}`,
              `**On LOA:** ${result.check.loaIds.length}`,
              `**Not reacted:** ${result.missing.length}`,
            ].join('\n'),
          ),
        ],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(err.message, 'Could not end check')] });
    }
    return;
  }

  if (sub === 'status') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const current = settings.activity.current;

    let reacted = current?.lastReactedCount ?? 0;
    let messageUrl = null;
    if (current) {
      const { message } = await activity.getMessage(guild, current);
      if (message) {
        messageUrl = message.url;
        const reactedIds = await activity.countReactions(message);
        reacted = current.requiredIds.filter((id) => reactedIds.has(id)).length;
      }
    }

    const auto = settings.activity;
    await interaction.editReply({
      embeds: [
        embed({
          title: 'Activity check status',
          description: current
            ? [
                `A check is running in <#${current.channelId}>.`,
                messageUrl ? `[Jump to check](${messageUrl})` : '',
                '',
                `**Staff (active):** ${current.requiredIds.length}`,
                `**Reacted:** ${reacted}/${current.requiredIds.length}`,
                `**On LOA:** ${current.loaIds.length}`,
                `**Not reacted:** ${Math.max(0, current.requiredIds.length - reacted)}`,
                `**Ends:** ${nextIn(current.endsAt)}`,
              ]
                .filter(Boolean)
                .join('\n')
            : 'No activity check is running right now.',
          color: current ? COLORS.brand : COLORS.neutral,
          fields: [
            {
              name: 'Automatic checks',
              value: auto.enabled
                ? [
                    `Every **${activity.formatDuration(auto.intervalSeconds)}**`,
                    `Duration **${activity.formatDuration(auto.durationSeconds)}**`,
                    `Channel ${auto.channelId ? `<#${auto.channelId}>` : '—'}`,
                    `Next: ${nextIn(auto.nextCheckAt)}`,
                  ].join('\n')
                : 'Disabled — use `/activity auto enabled:true`',
              inline: true,
            },
            {
              name: 'LOA role',
              value: auto.loaRoleId ? `<@&${auto.loaRoleId}>` : 'Not set',
              inline: true,
            },
            {
              name: 'Last check',
              value: auto.lastCheck
                ? `${auto.lastCheck.reacted}/${auto.lastCheck.staff} reacted · ${nextIn(auto.lastCheck.endedAt)}`
                : 'No completed checks yet',
              inline: true,
            },
          ],
        }),
      ],
    });
    return;
  }

  if (sub === 'auto') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        embeds: [errorEmbed('You need **Manage Server** to change the automatic schedule.', 'Missing permissions')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const enabled = interaction.options.getBoolean('enabled');
    if (!enabled) {
      settings.activity.enabled = false;
      settings.activity.nextCheckAt = null;
      store.save();
      await interaction.reply({
        embeds: [infoEmbed('Automatic checks disabled', 'Any check that is already running will continue.')],
      });
      return;
    }

    let intervalSeconds;
    let durationSeconds;
    try {
      intervalSeconds = interaction.options.getString('interval')
        ? activity.parseDuration(interaction.options.getString('interval'))
        : settings.activity.intervalSeconds;
      durationSeconds = interaction.options.getString('duration')
        ? activity.parseDuration(interaction.options.getString('duration'))
        : settings.activity.durationSeconds;
    } catch (err) {
      await interaction.reply({
        embeds: [errorEmbed(err.message, 'Invalid time')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (intervalSeconds < activity.AUTO_MIN_INTERVAL) {
      await interaction.reply({
        embeds: [errorEmbed('The interval must be at least 1 hour.', 'Interval too short')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (intervalSeconds <= durationSeconds) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'The interval must be longer than the check duration, otherwise checks would overlap.',
            'Invalid schedule',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!settings.staffRoleId) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'Set a staff role first with `/config set staff_role:@role`, then enable automatic checks.',
            'Staff role missing',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const configuredChannel = settings.activity.channelId
      ? guild.channels.cache.get(settings.activity.channelId)
      : null;
    const channel =
      interaction.options.getChannel('channel') ?? configuredChannel ?? interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.reply({
        embeds: [errorEmbed('Choose a text channel for automatic checks.', 'Invalid channel')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nextCheckAt = new Date(Date.now() + intervalSeconds * 1000).toISOString();
    settings.activity.enabled = true;
    settings.activity.intervalSeconds = intervalSeconds;
    settings.activity.durationSeconds = durationSeconds;
    settings.activity.channelId = channel.id;
    settings.activity.nextCheckAt = nextCheckAt;
    store.save();

    await interaction.reply({
      embeds: [
        successEmbed(
          'Automatic checks enabled',
          [
            `**Every:** ${activity.formatDuration(intervalSeconds)}`,
            `**Each check lasts:** ${activity.formatDuration(durationSeconds)}`,
            `**Channel:** ${channel}`,
            `**First check:** ${nextIn(nextCheckAt)}`,
            `**Reminder:** when 25% of the time is left`,
            '',
            'Use `/activity start` if you want to run one right now.',
          ].join('\n'),
        ),
      ],
    });
  }
}

module.exports = { data, execute };
