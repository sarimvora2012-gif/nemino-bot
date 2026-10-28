'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const {
  embed,
  successEmbed,
  errorEmbed,
  infoEmbed,
  warningEmbed,
  isStaff,
  canManageRole,
  sendLog,
  safeDM,
  truncate,
  relative,
  timestamp,
  COLORS,
} = require('./helpers');

const LOA_REQUEST_CHANNEL_ID = '1563541405706485850';
const LOA_ROLE_ID = '1539905285789982781';
const PREFIX = '!loasetup';

function loaRoleId(settings) {
  return settings?.activity?.loaRoleId || LOA_ROLE_ID;
}

function panelEmbed(roleId = LOA_ROLE_ID) {
  return embed({
    title: '🌴 Leave of Absence',
    description: [
      'Need some time away from the server? You can request a leave of absence here.',
      '',
      'Click **Request LOA** below and tell us:',
      '• How long you need to be away',
      '• Why you need the leave',
      '',
      `Your request will be sent to <#${LOA_REQUEST_CHANNEL_ID}> for staff review.`,
      `If it is accepted, you will receive <@&${roleId}> and be excluded from activity checks.`,
    ].join('\n'),
    color: COLORS.brand,
    footer: 'Staff review every request',
  });
}

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('loa:request')
      .setLabel('Request LOA')
      .setEmoji('🌴')
      .setStyle(ButtonStyle.Primary),
  );
}

function statusText(request) {
  if (request.status === 'accepted') {
    return request.reviewedBy
      ? `✅ Accepted by <@${request.reviewedBy}>`
      : '✅ Accepted';
  }
  if (request.status === 'denied') {
    return request.reviewedBy
      ? `❌ Denied by <@${request.reviewedBy}>`
      : '❌ Denied';
  }
  return '⏳ Waiting for staff review';
}

function requestEmbed(request) {
  const fields = [
    { name: 'Member', value: `<@${request.userId}> (${request.username})`, inline: true },
    { name: 'Duration', value: truncate(request.duration, 200), inline: true },
    { name: 'Requested', value: relative(request.createdAt), inline: true },
    { name: 'Reason', value: truncate(request.reason, 1000) },
    { name: 'Status', value: statusText(request) },
  ];

  if (request.status === 'denied' && request.denyReason) {
    fields.push({ name: 'Denial reason', value: truncate(request.denyReason, 1000) });
  }

  return embed({
    title: `LOA request ${request.id}`,
    color:
      request.status === 'accepted'
        ? COLORS.success
        : request.status === 'denied'
          ? COLORS.danger
          : COLORS.warning,
    fields,
    footer: `User ID: ${request.userId}`,
  });
}

function requestComponents(request) {
  const pending = request.status === 'pending';
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`loa:accept:${request.id}`)
        .setLabel(request.status === 'accepted' ? 'Accepted' : 'Accept')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!pending),
      new ButtonBuilder()
        .setCustomId(`loa:deny:${request.id}`)
        .setLabel(request.status === 'denied' ? 'Denied' : 'Deny')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!pending),
    ),
  ];
}

async function fetchRequestChannel(guild) {
  const channel =
    guild.channels.cache.get(LOA_REQUEST_CHANNEL_ID) ??
    (await guild.channels.fetch(LOA_REQUEST_CHANNEL_ID).catch(() => null));
  return channel?.isTextBased() ? channel : null;
}

async function editRequestMessage(guild, request) {
  if (!request.channelId || !request.messageId) return;
  const channel =
    guild.channels.cache.get(request.channelId) ??
    (await guild.channels.fetch(request.channelId).catch(() => null));
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(request.messageId).catch(() => null);
  if (!message) return;
  await message
    .edit({
      embeds: [requestEmbed(request)],
      components: requestComponents(request),
    })
    .catch(() => {});
}

/** `!loasetup` posts the panel in the current channel. */
async function handleMessage(message, { store }) {
  if (!message.guild || message.author?.bot) return;
  if (message.content.trim().toLowerCase() !== PREFIX) return;

  const settings = store.guild(message.guild.id);
  if (!isStaff(message.member, settings)) {
    await message
      .reply({
        embeds: [
          errorEmbed(
            'Only staff can post the LOA request panel.',
            'Missing permissions',
          ),
        ],
      })
      .catch(() => {});
    return;
  }

  const requestChannel = await fetchRequestChannel(message.guild);
  if (!requestChannel) {
    await message
      .reply({
        embeds: [
          errorEmbed(
            `I cannot find the LOA request channel (<#${LOA_REQUEST_CHANNEL_ID}>). Make sure it exists and that I can see it.`,
            'LOA channel missing',
          ),
        ],
      })
      .catch(() => {});
    return;
  }

  try {
    await message.channel.send({
      embeds: [panelEmbed(loaRoleId(settings))],
      components: [panelRow()],
    });
  } catch (err) {
    console.error('[loa] Failed to post panel:', err);
    await message
      .reply({
        embeds: [errorEmbed('I could not post the LOA panel in this channel.')],
      })
      .catch(() => {});
    return;
  }

  // Keep the channel tidy if the bot has Manage Messages.
  await message.delete().catch(() => {});
}

async function openRequestModal(interaction, { store }) {
  const settings = store.guild(interaction.guild.id);
  const roleId = loaRoleId(settings);

  if (interaction.member.roles.cache.has(roleId)) {
    await interaction.reply({
      embeds: [infoEmbed('You already have LOA', 'You are already marked as on leave.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const pending = store.pendingLoaRequestFor(interaction.guild.id, interaction.user.id);
  if (pending) {
    const link =
      pending.channelId && pending.messageId
        ? `https://discord.com/channels/${interaction.guild.id}/${pending.channelId}/${pending.messageId}`
        : null;
    await interaction.reply({
      embeds: [
        infoEmbed(
          'You already have a pending request',
          [
            `Your request **${pending.id}** is still waiting for staff review.`,
            link ? `[Jump to your request](${link})` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const requestChannel = await fetchRequestChannel(interaction.guild);
  if (!requestChannel) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `The LOA request channel (<#${LOA_REQUEST_CHANNEL_ID}>) is unavailable. Please contact a staff member.`,
          'LOA requests unavailable',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('loa:request-modal')
    .setTitle('Request a Leave of Absence');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('duration')
        .setLabel('How long do you need?')
        .setPlaceholder('e.g. 3 days, 1 week, until November 10')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Why do you need this leave?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000),
    ),
  );
  await interaction.showModal(modal);
}

async function acceptRequest(interaction, request, { store }) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  if (!isStaff(interaction.member, settings)) {
    await interaction.editReply({
      embeds: [errorEmbed('Only staff can accept LOA requests.', 'Missing permissions')],
    });
    return;
  }

  const member = await guild.members.fetch(request.userId).catch(() => null);
  if (!member) {
    await interaction.editReply({
      embeds: [errorEmbed('That member is no longer in this server.')],
    });
    return;
  }

  const roleId = loaRoleId(settings);
  const role =
    guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
  let roleWarning = null;

  if (!role) {
    roleWarning = 'the LOA role could not be found';
  } else if (member.roles.cache.has(role.id)) {
    // Already on LOA; still record the accepted request.
  } else if (!canManageRole(guild, role)) {
    roleWarning = 'the LOA role is above my highest role';
  } else {
    await member.roles
      .add(role, `LOA request ${request.id} accepted by ${interaction.user.tag}`)
      .catch((err) => {
        roleWarning = err.message;
      });
  }

  const updated = store.updateLoaRequest(request.id, {
    status: 'accepted',
    reviewedBy: interaction.user.id,
    reviewedAt: new Date().toISOString(),
  });

  await editRequestMessage(guild, updated);

  await safeDM(member.user, {
    embeds: [
      successEmbed(
        'Your LOA request was accepted',
        [
          `**Server:** ${guild.name}`,
          `**Request:** ${request.id}`,
          `**Duration:** ${request.duration}`,
          '',
          roleWarning
            ? 'A staff member will assign your LOA role shortly.'
            : `You now have <@&${role.id}> and will be excluded from activity checks.`,
        ].join('\n'),
      ),
    ],
  });

  await sendLog(guild, settings, [
    embed({
      title: 'LOA request accepted',
      color: COLORS.success,
      fields: [
        { name: 'Member', value: `${member.user} (${member.id})`, inline: true },
        { name: 'Request', value: request.id, inline: true },
        { name: 'Accepted by', value: `${interaction.user}`, inline: true },
        { name: 'Duration', value: truncate(request.duration, 200) },
        ...(roleWarning ? [{ name: '⚠️ Role not applied', value: truncate(roleWarning, 1024) }] : []),
      ],
    }),
  ]);

  await interaction.editReply({
    embeds: [
      roleWarning
        ? warningEmbed(
            'LOA accepted, but the role was not applied',
            `${truncate(roleWarning, 900)}\n\nGive the role manually or drag my role above the LOA role.`,
          )
        : successEmbed('LOA accepted', `<@${request.userId}> now has the LOA role.`),
    ],
  });
}

async function handleModal(interaction, { store }) {
  const [, action, requestId] = interaction.customId.split(':');

  if (action === 'request-modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const duration = interaction.fields.getTextInputValue('duration').trim();
    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!duration || !reason) {
      await interaction.editReply({
        embeds: [errorEmbed('Please provide both a duration and a reason.')],
      });
      return;
    }

    const pending = store.pendingLoaRequestFor(interaction.guild.id, interaction.user.id);
    if (pending) {
      await interaction.editReply({
        embeds: [infoEmbed('You already have a pending LOA request', `Request **${pending.id}** is still waiting for review.`)],
      });
      return;
    }

    const channel = await fetchRequestChannel(interaction.guild);
    if (!channel) {
      await interaction.editReply({
        embeds: [errorEmbed('The LOA request channel is unavailable. Please contact a staff member.')],
      });
      return;
    }

    const number = store.nextCounter(interaction.guild.id, 'loa');
    const request = {
      id: `L-${String(number).padStart(4, '0')}`,
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      username: interaction.user.tag,
      duration,
      reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    store.addLoaRequest(request);

    const settings = store.guild(interaction.guild.id);
    const staffPing = settings.staffRoleId ? `<@&${settings.staffRoleId}>` : '';
    const message = await channel
      .send({
        content: `${staffPing} new LOA request from <@${request.userId}>`.trim(),
        embeds: [requestEmbed(request)],
        components: requestComponents(request),
      })
      .catch((err) => {
        console.error('[loa] Failed to post request:', err);
        return null;
      });

    if (!message) {
      store.updateLoaRequest(request.id, { status: 'failed' });
      await interaction.editReply({
        embeds: [errorEmbed('Your request could not be sent. Please contact a staff member.')],
      });
      return;
    }

    store.updateLoaRequest(request.id, { channelId: channel.id, messageId: message.id });

    await interaction.editReply({
      embeds: [
        successEmbed(
          'LOA request submitted',
          `Your request **${request.id}** was sent to staff. You will get a DM when it has been reviewed.`,
        ),
      ],
    });
    return;
  }

  if (action === 'deny-modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const request = store.loaRequest(requestId);
    if (!request || request.status !== 'pending') {
      await interaction.editReply({
        embeds: [errorEmbed('This LOA request has already been reviewed.')],
      });
      return;
    }

    const settings = store.guild(interaction.guild.id);
    if (!isStaff(interaction.member, settings)) {
      await interaction.editReply({
        embeds: [errorEmbed('Only staff can deny LOA requests.', 'Missing permissions')],
      });
      return;
    }

    const denyReason = interaction.fields.getTextInputValue('reason').trim();
    const updated = store.updateLoaRequest(request.id, {
      status: 'denied',
      reviewedBy: interaction.user.id,
      reviewedAt: new Date().toISOString(),
      denyReason,
    });

    await editRequestMessage(interaction.guild, updated);

    const applicant = await interaction.client.users.fetch(request.userId).catch(() => null);
    if (applicant) {
      await safeDM(applicant, {
        embeds: [
          embed({
            title: 'Your LOA request was denied',
            description: [
              `**Server:** ${interaction.guild.name}`,
              `**Request:** ${request.id}`,
              `**Reason:** ${denyReason}`,
              '',
              'Contact a staff member if you think this was a mistake.',
            ].join('\n'),
            color: COLORS.danger,
          }),
        ],
      });
    }

    await sendLog(interaction.guild, settings, [
      embed({
        title: 'LOA request denied',
        color: COLORS.danger,
        fields: [
          { name: 'Member', value: `<@${request.userId}> (${request.userId})`, inline: true },
          { name: 'Request', value: request.id, inline: true },
          { name: 'Denied by', value: `${interaction.user}`, inline: true },
          { name: 'Reason', value: truncate(denyReason, 1000) },
        ],
      }),
    ]);

    await interaction.editReply({
      embeds: [successEmbed('LOA request denied', `Request **${request.id}** was denied and the member was notified.`)],
    });
  }
}

async function handleButton(interaction, { store }) {
  const [, action, requestId] = interaction.customId.split(':');

  if (action === 'request') {
    await openRequestModal(interaction, { store });
    return;
  }

  if (action !== 'accept' && action !== 'deny') return;

  const request = store.loaRequest(requestId);
  if (!request || request.status !== 'pending') {
    await interaction.reply({
      embeds: [errorEmbed('This LOA request has already been reviewed.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = store.guild(interaction.guild.id);
  if (!isStaff(interaction.member, settings)) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff can review LOA requests.', 'Missing permissions')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'deny') {
    const modal = new ModalBuilder()
      .setCustomId(`loa:deny-modal:${request.id}`)
      .setTitle(`Deny ${request.id}`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason (sent to the member)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  await acceptRequest(interaction, request, { store });
}

module.exports = {
  LOA_REQUEST_CHANNEL_ID,
  LOA_ROLE_ID,
  handleMessage,
  handleButton,
  handleModal,
  panelEmbed,
  panelRow,
  requestEmbed,
  requestComponents,
};
