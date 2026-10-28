'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const { successEmbed, errorEmbed, COLORS, embed } = require('../lib/helpers');

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
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((opt) =>
          opt
            .setName('ticket_category')
            .setDescription('Category new ticket channels are created in')
            .addChannelTypes(ChannelType.GuildCategory),
        )
        .addChannelOption((opt) =>
          opt
            .setName('transcript_channel')
            .setDescription('Channel ticket transcripts are uploaded to (defaults to log channel)')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((opt) =>
          opt
            .setName('application_review_channel')
            .setDescription('Channel staff review applications in')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addRoleOption((opt) =>
          opt.setName('application_accept_role').setDescription('Role given when an application is accepted'),
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
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((opt) =>
          opt
            .setName('staff_vouch_channel')
            .setDescription('Staff vouch channel (defaults to any channel with “vouch” in its name)')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addRoleOption((opt) =>
          opt
            .setName('vouch_admin_role')
            .setDescription('Extra role allowed to use !vouchadd (owner and co-owner always can)'),
        )
        .addRoleOption((opt) =>
          opt
            .setName('automod_alert_role')
            .setDescription('Role pinged when AutoMod catches a suspicious link (defaults to the staff role)'),
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
  const staffRole = interaction.options.getRole('staff_role');
  const logChannel = interaction.options.getChannel('log_channel');
  const ticketCategory = interaction.options.getChannel('ticket_category');
  const transcriptChannel = interaction.options.getChannel('transcript_channel');
  const reviewChannel = interaction.options.getChannel('application_review_channel');
  const acceptRole = interaction.options.getRole('application_accept_role');
  const loaRole = interaction.options.getRole('loa_role');
  const vouchChannel = interaction.options.getChannel('vouch_channel');
  const staffVouchChannel = interaction.options.getChannel('staff_vouch_channel');
  const vouchAdminRole = interaction.options.getRole('vouch_admin_role');
  const automodAlertRole = interaction.options.getRole('automod_alert_role');

  if (staffRole) {
    settings.staffRoleId = staffRole.id;
    updates.push(`Staff role → ${staffRole}`);
  }
  if (logChannel) {
    settings.logChannelId = logChannel.id;
    updates.push(`Log channel → ${logChannel}`);
  }
  if (ticketCategory) {
    settings.ticketCategoryId = ticketCategory.id;
    updates.push(`Ticket category → ${ticketCategory.name}`);
  }
  if (transcriptChannel) {
    settings.transcriptChannelId = transcriptChannel.id;
    updates.push(`Transcript channel → ${transcriptChannel}`);
  }
  if (reviewChannel) {
    settings.applications.reviewChannelId = reviewChannel.id;
    updates.push(`Application review channel → ${reviewChannel}`);
  }
  if (acceptRole) {
    settings.applications.acceptRoleId = acceptRole.id;
    updates.push(`Accepted applications give → ${acceptRole}`);
  }
  if (loaRole) {
    settings.activity.loaRoleId = loaRole.id;
    updates.push(`LOA role → ${loaRole}`);
  }
  if (vouchChannel) {
    settings.vouchChannelId = vouchChannel.id;
    updates.push(`Vouch channel → ${vouchChannel}`);
  }
  if (staffVouchChannel) {
    settings.staffVouchChannelId = staffVouchChannel.id;
    updates.push(`Staff vouch channel → ${staffVouchChannel}`);
  }
  if (vouchAdminRole) {
    settings.vouchAdminRoleId = vouchAdminRole.id;
    updates.push(`Extra vouch admin role → ${vouchAdminRole}`);
  }
  if (automodAlertRole) {
    settings.automodAlertRoleId = automodAlertRole.id;
    updates.push(`AutoMod link alerts ping → ${automodAlertRole}`);
  }

  if (updates.length === 0) {
    await interaction.reply({
      embeds: [errorEmbed('Nothing was provided. Pass at least one option, or use `/config view`.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  store.save();
  await interaction.reply({ embeds: [successEmbed('Settings updated', updates.join('\n'))] });
}

module.exports = { data, execute };
