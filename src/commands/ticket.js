'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const {
  embed,
  successEmbed,
  errorEmbed,
  infoEmbed,
  requireStaff,
  isStaff,
  sendLog,
  safeDM,
  truncate,
  COLORS,
} = require('../lib/helpers');
const { toSmallCaps } = require('../lib/smallcaps');

const data = [
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system')
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Post the button members click to open a ticket')
        .addChannelOption((opt) =>
          opt
            .setName('category')
            .setDescription('Category new tickets are created in (defaults to configured category)')
            .addChannelTypes(ChannelType.GuildCategory),
        )
        .addStringOption((opt) =>
          opt.setName('message').setDescription('Extra text shown on the panel').setMaxLength(1500),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Close the current ticket and save a transcript')
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Why the ticket is being closed').setMaxLength(500),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a member to this ticket')
        .addUserOption((opt) => opt.setName('user').setDescription('Member to add').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a member from this ticket')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Member to remove').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('claim').setDescription('Claim this ticket as yours')),
];

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  const sub = interaction.options.getSubcommand();

  if (sub === 'panel') {
    if (!(await requireStaff(interaction, settings))) return;
    const category = interaction.options.getChannel('category');
    if (category) {
      settings.ticketCategoryId = category.id;
      store.save();
    }
    const extra = interaction.options.getString('message');
    const panel = embed({
      title: 'Need help?',
      description: [
        'Click the button below to open a private ticket with our staff team.',
        '',
        '**Before opening a ticket**',
        '• Check the FAQ and announcements for an answer.',
        '• Describe your issue clearly once the ticket is open.',
        '• Do not open multiple tickets for the same issue.',
        extra ? `\n${extra}` : '',
      ].join('\n'),
      color: COLORS.brand,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:open')
        .setLabel('Open a ticket')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.channel.send({ embeds: [panel], components: [row] });
    await interaction.reply({
      embeds: [
        successEmbed(
          'Ticket panel posted',
          settings.ticketCategoryId
            ? `New tickets will be created in <#${settings.ticketCategoryId}>.`
            : 'No ticket category is configured, so tickets will be created at the top of the channel list. Set one with `/config set ticket_category:#category`.',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ticket = store.ticket(interaction.channelId);
  if (!ticket) {
    await interaction.reply({
      embeds: [errorEmbed('This command only works inside a ticket channel.', 'Not a ticket')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'close') {
    if (!canCloseTicket(interaction.member, settings, ticket)) {
      await interaction.reply({
        embeds: [errorEmbed('Only the ticket owner or staff can close this ticket.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    await interaction.deferReply();
    const result = await closeTicket(interaction.client, interaction.channel, ticket, settings, {
      closedBy: interaction.user,
      reason,
      store,
    });
    await interaction
      .editReply({ embeds: [closeResultEmbed(result)] })
      .catch(() => {});
    return;
  }

  if (!(await requireStaff(interaction, settings))) return;

  if (sub === 'add' || sub === 'remove') {
    const user = interaction.options.getUser('user');
    if (user.bot) {
      await interaction.reply({
        embeds: [errorEmbed('Bots cannot be added to tickets.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const allow = sub === 'add';
    await interaction.channel.permissionOverwrites.edit(
      user.id,
      allow
        ? {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
          }
        : { ViewChannel: false, SendMessages: false },
      { reason: `${allow ? 'Added to' : 'Removed from'} ticket by ${interaction.user.tag}` },
    );
    await interaction.reply({
      embeds: [
        successEmbed(
          allow ? 'Member added' : 'Member removed',
          `${user} ${allow ? 'can now see this ticket.' : 'can no longer see this ticket.'}`,
        ),
      ],
    });
    return;
  }

  if (sub === 'claim') {
    if (ticket.claimedBy) {
      await interaction.reply({
        embeds: [errorEmbed(`This ticket is already claimed by <@${ticket.claimedBy}>.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    ticket.claimedBy = interaction.user.id;
    ticket.claimedAt = new Date().toISOString();
    store.addTicket(interaction.channelId, ticket);
    await interaction.reply({
      embeds: [
        infoEmbed('Ticket claimed', `${interaction.user} is handling this ticket.`),
      ],
    });
    await sendLog(guild, settings, [
      embed({
        title: 'Ticket claimed',
        color: COLORS.brand,
        fields: [
          { name: 'Ticket', value: `${interaction.channel}`, inline: true },
          { name: 'Claimed by', value: `${interaction.user}`, inline: true },
        ],
      }),
    ]);
  }
}

/**
 * Creates a private ticket channel and stores it. Shared by the ticket panel and
 * giveaway prize claims, so both support `/ticket close` and transcripts.
 */
async function createTicketChannel({
  client,
  guild,
  settings,
  store,
  ownerId,
  extraUserIds = [],
  categoryId = null,
  topic = null,
  reason = 'Ticket opened',
  type = 'ticket',
}) {
  const parentId = categoryId ?? settings.ticketCategoryId;
  let category = parentId ? guild.channels.cache.get(parentId) : null;
  if (category && category.type !== ChannelType.GuildCategory) {
    category = null;
    if (!categoryId) {
      settings.ticketCategoryId = null;
      store.save();
    }
  }

  const number = store.nextCounter(guild.id, 'ticket');
  const staffRole = settings.staffRoleId
    ? guild.roles.cache.get(settings.staffRoleId)
    : null;

  const access = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.UseExternalEmojis,
  ];

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: ownerId,
      allow: access,
    },
    {
      id: client.user.id,
      allow: [
        ...access,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];

  for (const userId of new Set(extraUserIds.filter(Boolean))) {
    if (userId === ownerId || userId === client.user.id) continue;
    overwrites.push({ id: userId, allow: access });
  }

  if (staffRole) {
    overwrites.push({
      id: staffRole.id,
      allow: [...access, PermissionFlagsBits.ManageMessages],
    });
  }

  const channel = await guild.channels.create({
    name: `${toSmallCaps('ticket')}-${String(number).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent: category?.id ?? null,
    topic:
      topic ??
      `Ticket #${String(number).padStart(4, '0')} · opened by <@${ownerId}> (${ownerId})`,
    permissionOverwrites: overwrites,
    reason,
  });

  const ticket = {
    guildId: guild.id,
    userId: ownerId,
    number,
    status: 'open',
    createdAt: new Date().toISOString(),
    claimedBy: null,
    type,
  };
  store.addTicket(channel.id, ticket);

  return { channel, ticket, number };
}

/** Creates the ticket channel for a member. Shared by the panel button. */
async function openTicket(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  const existingChannelId = store.openTicketFor(guild.id, interaction.user.id);

  if (existingChannelId) {
    const existing = guild.channels.cache.get(existingChannelId);
    if (existing) {
      await interaction.reply({
        embeds: [
          infoEmbed('You already have an open ticket', `Head over to ${existing} to continue.`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    store.removeTicket(existingChannelId);
  }

  let channel;
  let number;
  try {
    ({ channel, number } = await createTicketChannel({
      client: interaction.client,
      guild,
      settings,
      store,
      ownerId: interaction.user.id,
      reason: `Ticket opened by ${interaction.user.tag}`,
    }));
  } catch (err) {
    console.error('[ticket] Failed to create channel:', err);
    await interaction.reply({
      embeds: [
        errorEmbed(
          'I could not create the ticket channel. Make sure I have **Manage Channels** and that my role is above the channel permissions.',
          'Ticket creation failed',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const staffRole = settings.staffRoleId
    ? guild.roles.cache.get(settings.staffRoleId)
    : null;

  const welcome = embed({
    title: `Ticket #${String(number).padStart(4, '0')}`,
    description: [
      `Hey ${interaction.user}, thanks for opening a ticket!`,
      '',
      'A member of the staff team will be with you shortly. While you wait, please:',
      '• Describe your issue with as much detail as possible.',
      '• Include screenshots or links if they help.',
      '• Do not ping staff repeatedly.',
    ].join('\n'),
    color: COLORS.brand,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:claim:${channel.id}`)
      .setLabel('Claim')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket:close:${channel.id}`)
      .setLabel('Close')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );

  const ping = [interaction.user.toString(), staffRole ? staffRole.toString() : '']
    .filter(Boolean)
    .join(' ');

  await channel.send({ content: ping, embeds: [welcome], components: [row] });

  await interaction.reply({
    embeds: [successEmbed('Ticket opened', `Your ticket is ready: ${channel}`)],
    flags: MessageFlags.Ephemeral,
  });

  await sendLog(guild, settings, [
    embed({
      title: 'Ticket opened',
      color: COLORS.success,
      fields: [
        { name: 'Member', value: `${interaction.user} (${interaction.user.id})`, inline: true },
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Number', value: `#${String(number).padStart(4, '0')}`, inline: true },
      ],
    }),
  ]);
}

/** Builds a plain-text transcript of the ticket channel. */
async function buildTranscript(channel, ticket) {
  const collected = [];
  let before;
  for (let page = 0; page < 5; page += 1) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    collected.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = [
    `Ticket #${String(ticket.number).padStart(4, '0')}`,
    `Opened by: ${ticket.userId}`,
    `Created: ${ticket.createdAt}`,
    `Closed: ${new Date().toISOString()}`,
    `Channel: #${channel.name}`,
    '='.repeat(70),
    '',
  ];

  for (const message of collected) {
    const author = message.author ? `${message.author.tag} (${message.author.id})` : 'Unknown';
    lines.push(`[${new Date(message.createdTimestamp).toISOString()}] ${author}: ${message.content || ''}`);
    for (const attachment of message.attachments.values()) {
      lines.push(`    [attachment] ${attachment.name}: ${attachment.url}`);
    }
    for (const embedItem of message.embeds) {
      if (embedItem.title) lines.push(`    [embed] ${embedItem.title}`);
      if (embedItem.description) lines.push(`    [embed] ${embedItem.description}`);
    }
  }

  fs.mkdirSync(path.join(process.cwd(), 'transcripts'), { recursive: true });
  const filePath = path.join(
    process.cwd(),
    'transcripts',
    `ticket-${String(ticket.number).padStart(4, '0')}-${ticket.userId}.txt`,
  );
  fs.writeFileSync(filePath, lines.join('\n'));
  return { filePath, messageCount: collected.length };
}

const DELETE_DELAY_MS = 4000;

/** The reply a closer sees: the truth about whether the channel went away. */
function closeResultEmbed(result) {
  if (result?.deleted) {
    return successEmbed('Ticket closed', 'The transcript has been saved and the channel is gone.');
  }
  return errorEmbed(
    [
      'The ticket was closed and the transcript saved, but the channel could not be deleted:',
      `\`${truncate(result?.error ?? 'unknown error', 300)}\``,
      '',
      'Give me **Manage Channels** in that channel or its category, then press **Close** again.',
    ].join('\n'),
    'Channel not deleted',
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ticket owner, staff, or anyone who can manage this channel may close it. */
function canCloseTicket(member, settings, ticket) {
  if (!member) return false;
  if (ticket && member.id === ticket.userId) return true;
  if (isStaff(member, settings)) return true;
  return Boolean(
    member.permissions?.has?.(PermissionFlagsBits.ManageChannels) ||
    member.permissions?.has?.(PermissionFlagsBits.ManageMessages) ||
    member.permissions?.has?.(PermissionFlagsBits.Administrator),
  );
}

/**
 * Deletes a ticket channel and reports the real outcome. `deletable` is a
 * permission guess that is wrong often enough (threads, stale caches, category
 * overwrites) that the delete is always attempted and its error kept.
 */
async function deleteTicketChannel(channel, { reason = 'Ticket closed' } = {}) {
  if (!channel) return { deleted: false, error: 'Channel not found' };
  try {
    await channel.delete(reason);
    return { deleted: true, error: null };
  } catch (err) {
    console.error(`[ticket] Could not delete ${channel.name ?? channel.id}:`, err.message);
    return { deleted: false, error: err.message };
  }
}

/**
 * Deletes ticket channels whose ticket is already closed but which survived a
 * failed delete, a restart during the countdown, or a crash.
 */
async function sweepClosedTickets(context) {
  const { client, store } = context;
  let removed = 0;

  for (const [channelId, ticket] of Object.entries(store.data.tickets)) {
    if (ticket.status === 'open') continue;

    const guild = client.guilds.cache.get(ticket.guildId);
    if (!guild) continue;

    const channel =
      guild.channels.cache.get(channelId) ??
      (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel) continue;

    const deletion = await deleteTicketChannel(channel, { reason: 'Ticket was already closed' });
    if (deletion.deleted) {
      removed += 1;
      delete ticket.closeError;
    } else {
      ticket.closeError = deletion.error;
    }
    store.save();
  }

  if (removed) console.log(`[ticket] Cleaned up ${removed} closed ticket channel(s).`);
  return removed;
}

async function closeTicket(client, channel, ticket, settings, { closedBy, reason, store }) {
  const guild = channel.guild;
  let transcript = null;
  let transcriptError = null;

  try {
    transcript = await buildTranscript(channel, ticket);
  } catch (err) {
    transcriptError = err;
    console.error('[ticket] Transcript failed:', err);
  }

  const transcriptChannelId = settings.transcriptChannelId || settings.logChannelId;
  const transcriptChannel = transcriptChannelId
    ? guild.channels.cache.get(transcriptChannelId)
    : null;

  if (transcript && transcriptChannel?.isTextBased()) {
    try {
      const file = new AttachmentBuilder(transcript.filePath, {
        name: path.basename(transcript.filePath),
      });
      await transcriptChannel.send({
        content: `📄 Transcript for ticket #${String(ticket.number).padStart(4, '0')} — ${transcript.messageCount} messages`,
        files: [file],
      });
    } catch (err) {
      console.error('[ticket] Failed to upload transcript:', err.message);
    }
  }

  // The channel is deleted first, so the ticket is only recorded as closed once
  // it is really gone. A failed delete stays "open" and can be retried.
  const notice = embed({
    title: 'Ticket closed',
    description: transcriptError
      ? `Closed by ${closedBy}. The channel will be deleted in a few seconds.`
      : `Closed by ${closedBy}.\n**Reason:** ${reason}\n\nA transcript has been saved to the staff logs.`,
    color: COLORS.danger,
  });
  await channel.send({ embeds: [notice] }).catch(() => {});
  await sleep(DELETE_DELAY_MS);

  const deletion = await deleteTicketChannel(channel, {
    reason: `Ticket closed by ${closedBy.tag}`,
  });

  ticket.closedBy = closedBy.id;
  ticket.closeReason = reason;
  ticket.closedAt = new Date().toISOString();
  ticket.transcriptFile = transcript ? path.basename(transcript.filePath) : null;
  ticket.status = deletion.deleted ? 'closed' : 'open';
  if (deletion.deleted) {
    delete ticket.closeError;
  } else {
    ticket.closeError = deletion.error;
    ticket.closeFailedAt = new Date().toISOString();
  }
  store.save();

  await sendLog(guild, settings, [
    embed({
      title: 'Ticket closed',
      color: COLORS.danger,
      fields: [
        { name: 'Ticket', value: `#${String(ticket.number).padStart(4, '0')} (${channel.name})`, inline: true },
        { name: 'Opened by', value: `<@${ticket.userId}>`, inline: true },
        { name: 'Closed by', value: `${closedBy}`, inline: true },
        { name: 'Reason', value: truncate(reason, 500) },
        {
          name: 'Channel',
          value: deletion.deleted
            ? '✅ Deleted'
            : `⚠️ Could not be deleted: ${truncate(deletion.error ?? 'unknown error', 300)}`,
        },
      ],
    }),
  ]);

  const owner = await client.users.fetch(ticket.userId).catch(() => null);
  if (owner) {
    await safeDM(owner, {
      embeds: [
        infoEmbed(
          'Your ticket was closed',
          [
            `**Ticket:** #${String(ticket.number).padStart(4, '0')} in **${guild.name}**`,
            `**Closed by:** ${closedBy.tag}`,
            `**Reason:** ${reason}`,
            '',
            'If you still need help, feel free to open a new ticket.',
          ].join('\n'),
        ),
      ],
    });
  }

  if (!deletion.deleted) {
    await channel
      .send({
        embeds: [
          errorEmbed(
            [
              `I could not delete this channel: \`${truncate(deletion.error ?? 'unknown error', 300)}\``,
              '',
              'Give me **Manage Channels** in this channel (or in its category) and press **Close** again — the transcript was still saved.',
            ].join('\n'),
            'Channel not deleted',
          ),
        ],
      })
      .catch(() => {});
  }

  return { deleted: deletion.deleted, error: deletion.error, transcript };
}

async function handleButton(interaction, { store }) {
  const [, action, channelId] = interaction.customId.split(':');
  const settings = store.guild(interaction.guild.id);

  if (action === 'open') {
    await openTicket(interaction, { store });
    return;
  }

  const channel = interaction.guild.channels.cache.get(channelId) ?? interaction.channel;
  const ticket = store.ticket(channelId);

  // Already closed but the channel is still here (the delete failed or the bot
  // restarted mid-countdown): pressing Close finishes the job instead of
  // refusing, so a stuck ticket can always be cleared by staff.
  if (ticket && ticket.status !== 'open' && action === 'close') {
    if (!canCloseTicket(interaction.member, settings, ticket)) {
      await interaction.reply({
        embeds: [errorEmbed('Only the ticket owner or staff can close this ticket.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const deletion = await deleteTicketChannel(channel, {
      reason: `Ticket closed by ${interaction.user.tag}`,
    });
    if (deletion.deleted) delete ticket.closeError;
    else ticket.closeError = deletion.error;
    store.save();
    await interaction
      .editReply({ embeds: [closeResultEmbed(deletion)] })
      .catch(() => {});
    return;
  }

  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({
      embeds: [errorEmbed('This ticket is no longer open.', 'Ticket closed')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'claim') {
    if (!(await requireStaff(interaction, settings))) return;
    if (ticket.claimedBy) {
      await interaction.reply({
        embeds: [errorEmbed(`This ticket is already claimed by <@${ticket.claimedBy}>.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    ticket.claimedBy = interaction.user.id;
    ticket.claimedAt = new Date().toISOString();
    store.addTicket(channelId, ticket);
    await interaction.reply({
      embeds: [infoEmbed('Ticket claimed', `${interaction.user} is handling this ticket.`)],
    });
    return;
  }

  if (action === 'close') {
    if (!canCloseTicket(interaction.member, settings, ticket)) {
      await interaction.reply({
        embeds: [errorEmbed('Only the ticket owner or staff can close this ticket.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`ticket:close-modal:${channelId}`)
      .setTitle(`Close ticket #${String(ticket.number).padStart(4, '0')}`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for closing (optional)')
          .setPlaceholder('Issue resolved, duplicate ticket, ...')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(500)
          .setRequired(false),
      ),
    );
    await interaction.showModal(modal);
  }
}

async function handleModal(interaction, { store }) {
  const [, action, channelId] = interaction.customId.split(':');
  if (action !== 'close-modal') return;

  const ticket = store.ticket(channelId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({
      embeds: [errorEmbed('This ticket is no longer open.', 'Ticket closed')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = store.guild(interaction.guild.id);
  if (!canCloseTicket(interaction.member, settings, ticket)) {
    await interaction.reply({
      embeds: [errorEmbed('Only the ticket owner or staff can close this ticket.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = interaction.fields.getTextInputValue('reason')?.trim() || 'No reason provided';
  await interaction.deferReply();
  const channel = interaction.guild.channels.cache.get(channelId) ?? interaction.channel;
  const result = await closeTicket(interaction.client, channel, ticket, settings, {
    closedBy: interaction.user,
    reason,
    store,
  });
  await interaction
    .editReply({ embeds: [closeResultEmbed(result)] })
    .catch(() => {});
}

module.exports = {
  data,
  execute,
  handleButton,
  handleModal,
  openTicket,
  closeTicket,
  createTicketChannel,
  canCloseTicket,
  deleteTicketChannel,
  sweepClosedTickets,
};
