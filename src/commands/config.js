'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const { successEmbed, errorEmbed, COLORS, embed } = require('../lib/helpers');
const { parseChannelLink } = require('../lib/links');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/**
 * Every channel setting `/config set` can fill, either from the channel picker
 * or by pasting a channel link into the matching `<name>_link` option.
 */
const LINK_SETTINGS = {
  log_channel: {
    label: 'Log channel',
    types: TEXT_CHANNELS,
    apply: (settings, channel) => {
      settings.logChannelId = channel.id;
    },
  },
  ticket_category: {
    label: 'Ticket category',
    types: [ChannelType.GuildCategory],
    apply: (settings, channel) => {
      settings.ticketCategoryId = channel.id;
    },
  },
  transcript_channel: {
    label: 'Transcript channel',
    types: TEXT_CHANNELS,
    apply: (settings, channel) => {
      settings.transcriptChannelId = channel.id;
    },
  },
  application_review_channel: {
    label: 'Application review channel',
    types: TEXT_CHANNELS,
    apply: (settings, channel) => {
      settings.applications.reviewChannelId = channel.id;
    },
  },
  vouch_channel: {
    label: 'Vouch channel',
    types: TEXT_CHANNELS,
    apply: (settings, channel) => {
      settings.vouchChannelId = channel.id;
    },
  },
  staff_vouch_channel: {
    label: 'Staff vouch channel',
    types: TEXT_CHANNELS,
    apply: (settings, channel) => {
      settings.staffVouchChannelId = channel.id;
    },
  },
};

/** `<name>_link` is the paste-a-link twin of the `<name>` channel picker. */
const linkOptionName = (key) => `${key}_link`;

/**
 * Turns a pasted channel link, `<#mention>` or ID into a channel in this guild.
 * Returns `{ channel }` or `{ error }` with a message that says what was wrong.
 */
async function resolveChannel(guild, raw, meta) {
  const channelId = parseChannelLink(raw);
  if (!channelId) {
    return {
      error:
        'that is not a channel link — right-click the channel, choose **Copy Channel Link** and paste it (`<#channel>` and a plain channel ID work too).',
    };
  }

  const channel =
    guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) {
    return { error: `no channel with the ID \`${channelId}\` is in this server, or I cannot see it.` };
  }

  if (!meta.types.includes(channel.type)) {
    const wanted = meta.types.includes(ChannelType.GuildCategory)
      ? 'a **category**'
      : 'a **text channel**';
    return {
      error: `${channel.name ? `**#${channel.name}**` : 'that channel'} is not ${wanted}.`,
    };
  }

  return { channel };
}

const data = [
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('View and change this server’s bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('view').setDescription('Show the current settings'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Change one or more settings')
        .addRoleOption((opt) =>
          opt.setName('staff_role').setDescription('Role that can use staff commands'),
        )
        .addChannelOption((opt) =>
          opt
            .setName('log_channel')
            .setDescription('Channel for moderation and ticket logs')
            .addChannelTypes(...TEXT_CHANNELS),
        )
        .addStringOption((opt) =>
          opt
            .setName(linkOptionName('log_channel'))
            .setDescription('…or paste the log channel link here')
            .setMaxLength(200),
        )
        .addChannelOption((opt) =>
          opt
            .setName('ticket_category')
            .setDescription('Category new ticket channels are created in')
            .addChannelTypes(ChannelType.GuildCategory),
        )
        .addStringOption((opt) =>
          opt
            .setName(linkOptionName('ticket_category'))
            .setDescription('…or paste the ticket category link here')
            .setMaxLength(200),
        )
        .addChannelOption((opt) =>
          opt
            .setName('transcript_channel')
            .setDescription('Channel ticket transcripts are uploaded to (defaults to log channel)')
            .addChannelTypes(...TEXT_CHANNELS),
        )
        .addStringOption((opt) =>
          opt
            .setName(linkOptionName('transcript_channel'))
            .setDescription('…or paste the transcript channel link here')
            .setMaxLength(200),
        )
        .addChannelOption((opt) =>
          opt
            .setName('application_review_channel')
            .setDescription('Channel staff review applications in')
            .addChannelTypes(...TEXT_CHANNELS),
        )
        .addStringOption((opt) =>
          opt
            .setName(linkOptionName('application_review_channel'))
            .setDescription('…or paste the application review channel link here')
            .setMaxLength(200),
        )
        .addRoleOption((opt) =>
          opt
            .setName('application_accept_role')
            .setDescription('Role given when an application is accepted'),
        )
        .addRoleOption((opt) =>
          opt
            .setName('loa_role')
            .setDescription('Members with this role are skipped by activity checks'),
        )
        .addChannelOption((opt) =>
          opt
            .setName('vouch_channel')
            .setDescription('Member vouch channel (defaults to any channel with “vouch” in its name)')
            .addChannelTypes(...TEXT_CHANNELS),
        )
        .addStringOption((opt) =>
          opt
            .setName(linkOptionName('vouch_channel'))
            .setDescription('…or paste the vouch channel link here')
            .setMaxLength(200),
        )
        .addChannelOption((opt) =>
          opt
            .setName('staff_vouch_channel')
            .setDescription('Staff vouch channel (defaults to any channel with “vouch” in its name)')
            .addChannelTypes(...TEXT_CHANNELS),
        )
        .addStringOption((opt) =>
          opt
            .setName(linkOptionName('staff_vouch_channel'))
            .setDescription('…or paste the staff vouch channel link here')
            .setMaxLength(200),
        )
        .addRoleOption((opt) =>
          opt
            .setName('vouch_admin_role')
            .setDescription('Extra role allowed to use !vouchadd (owner and co-owner always can)'),
        )        .addRoleOption((opt) =>
          opt.setName('automod_alert_role')
            .setDescription('Role pinged when AutoMod catches a suspicious link (defaults to the staff role)'),
        )
        .addRoleOption((opt) =>
          opt.setName('high_staff_role')
            .setDescription('Role pinged when staff miss an activity check (defaults to the AutoMod alert role)'),
        ),
    ),
];

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [errorEmbed('You need **Manage Server** to change the bot settings.', 'Missing permissions')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.options.getSubcommand() === 'view') {
    const list = (value) => (value ? `<#${value}>` : '—');
    const role = (value) => (value ? `<@&${value}>` : '—');
    const view = embed({
      title: 'Server settings',
      description: 'Change values with `/config set`.',
      color: COLORS.brand,
      fields: [
        { name: 'Staff role', value: role(settings.staffRoleId), inline: true },
        { name: 'Log channel', value: list(settings.logChannelId), inline: true },
        { name: 'Transcript channel', value: list(settings.transcriptChannelId), inline: true },
        { name: 'Ticket category', value: list(settings.ticketCategoryId), inline: true },
        { name: 'Application review channel', value: list(settings.applications.reviewChannelId), inline: true },
        { name: 'Application accept role', value: role(settings.applications.acceptRoleId), inline: true },
        { name: 'Application questions', value: `${settings.applications.questions.length}`, inline: true },
        { name: 'Applications open', value: settings.applications.open ? 'Yes' : 'No', inline: true },
        { name: 'LOA role', value: role(settings.activity.loaRoleId), inline: true },
        { name: 'Vouch channel', value: list(settings.vouchChannelId), inline: true },
        { name: 'Staff vouch channel', value: list(settings.staffVouchChannelId), inline: true },
        { name: 'Extra vouch admin role', value: role(settings.vouchAdminRoleId), inline: true },
        {
          name: 'AutoMod alert role',
          value: role(settings.automodAlertRoleId ?? settings.staffRoleId),
          inline: true,
        },
        {
          name: 'High staff role (activity results)',
          value: role(settings.highStaffRoleId ?? settings.automodAlertRoleId),
          inline: true,
        },
        {
          name: 'Automatic activity checks',
          value: settings.activity.enabled ? 'Enabled — `/activity status`' : 'Disabled',
          inline: true,
        },
      ],
    });
    await interaction.reply({ embeds: [view], flags: MessageFlags.Ephemeral });
    return;
  }

  const updates = [];
  const problems = [];

  const staffRole = interaction.options.getRole('staff_role');
  const acceptRole = interaction.options.getRole('application_accept_role');
  const loaRole = interaction.options.getRole('loa_role');
  const vouchAdminRole = interaction.options.getRole('vouch_admin_role');
  const automodAlertRole = interaction.options.getRole('automod_alert_role');
  const highStaffRole = interaction.options.getRole('high_staff_role');

  if (staffRole) {
    settings.staffRoleId = staffRole.id;
    updates.push(`Staff role → ${staffRole}`);
  }
  if (acceptRole) {
    settings.applications.acceptRoleId = acceptRole.id;
    updates.push(`Accepted applications give → ${acceptRole}`);
  }
  if (loaRole) {
    settings.activity.loaRoleId = loaRole.id;
    updates.push(`LOA role → ${loaRole}`);
  }
  if (vouchAdminRole) {
    settings.vouchAdminRoleId = vouchAdminRole.id;
    updates.push(`Extra vouch admin role → ${vouchAdminRole}`);
  }
  if (automodAlertRole) {
    settings.automodAlertRoleId = automodAlertRole.id;
    updates.push(`AutoMod link alerts ping → ${automodAlertRole}`);
  }
  if (highStaffRole) {
    settings.highStaffRoleId = highStaffRole.id;
    updates.push(`Missed activity checks ping → ${highStaffRole}`);
  }

  // Channel settings: the picker, the pasted link, or exactly one of them.
  for (const [key, meta] of Object.entries(LINK_SETTINGS)) {
    const picked = interaction.options.getChannel(key);
    const pasted = interaction.options.getString(linkOptionName(key));

    if (picked && pasted) {
      problems.push(
        `**${meta.label}**: pick it in \`${key}\` or paste a link in \`${linkOptionName(key)}\`, not both.`,
      );
      continue;
    }

    if (picked) {
      if (!meta.types.includes(picked.type)) {
        const wanted = meta.types.includes(ChannelType.GuildCategory)
          ? 'a **category**'
          : 'a **text channel**';
        problems.push(`**${meta.label}**: ${picked.name ? `**#${picked.name}**` : 'that channel'} is not ${wanted}.`);
        continue;
      }
      meta.apply(settings, picked);
      updates.push(`${meta.label} → ${picked}`);
      continue;
    }

    if (pasted) {
      const { channel, error } = await resolveChannel(guild, pasted, meta);
      if (error) {
        problems.push(`**${meta.label}**: ${error}`);
        continue;
      }
      meta.apply(settings, channel);
      updates.push(`${meta.label} → ${channel}`);
    }
  }

  if (problems.length && !updates.length) {
    await interaction.reply({
      embeds: [errorEmbed(problems.join('\n'), 'Setting not changed')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (updates.length) store.save();

  if (problems.length) {
    await interaction.reply({
      embeds: [
        embed({
          title: 'Settings partly updated',
          description: [...updates, '', '⚠️ **Not changed**', ...problems].join('\n'),
          color: COLORS.warning,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!updates.length) {
    await interaction.reply({
      embeds: [errorEmbed('Nothing was provided. Pass at least one option, or use `/config view`.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({ embeds: [successEmbed('Settings updated', updates.join('\n'))] });
}

module.exports = { LINK_SETTINGS, data, execute, resolveChannel };
