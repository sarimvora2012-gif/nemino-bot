'use strict';

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
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const {
  embed,
  successEmbed,
  errorEmbed,
  infoEmbed,
  warningEmbed,
  requireStaff,
  isStaff,
  canManageRole,
  sendLog,
  safeDM,
  truncate,
  relative,
  timestamp,
  COLORS,
} = require('../lib/helpers');
const { DEFAULT_QUESTIONS } = require('../store');
const { createTicketChannel } = require('./ticket');

const QUESTIONS_PER_PAGE = 5;
const MAX_QUESTIONS = 10;
const ANSWER_TTL_MS = 60 * 60 * 1000;
const MAX_ANSWER_LENGTH = 1000;
const DENY_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const APPLICATION_TICKET_CATEGORY_ID = '1563497087411159190';

/** User ID -> application currently being answered in DMs. */
const drafts = new Map();

const data = [
  new SlashCommandBuilder()
    .setName('application')
    .setDescription('Application system')
    .addSubcommandGroup((group) =>
      group
        .setName('questions')
        .setDescription('Add, remove or list the application questions')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Add a question to the end of the application')
            .addStringOption((opt) =>
              opt
                .setName('question')
                .setDescription('The question applicants should answer')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(200),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Remove a question by its number')
            .addIntegerOption((opt) =>
              opt
                .setName('number')
                .setDescription('Question number, see /application questions list')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(MAX_QUESTIONS),
            ),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('Show all application questions')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Post the “Apply” button in this channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to post the panel in (defaults to this one)')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Open or close applications')
        .addBooleanOption((opt) =>
          opt.setName('open').setDescription('true = accepting applications').setRequired(true),
        ),
    ),
];

function panelEmbed(settings) {
  return embed({
    title: 'Staff applications',
    description: [
      settings.applications.open ? 'We are **open** for applications!' : 'Applications are currently **closed**.',
      '',
      'Click **Apply** below and the bot will send you the questions in a DM.',
      `There are ${settings.applications.questions.length} questions and you have **60 minutes** to finish.`,
      '',
      '**Tips**',
      '• Answer honestly and in detail.',
      '• You can type **cancel** in the DM to cancel your application.',
      '• Do not submit more than once.',
      '• If your application is denied, you can apply again after **2 weeks**.',
      '• Staff will review your application and contact you.',
    ].join('\n'),
    color: settings.applications.open ? COLORS.brand : COLORS.neutral,
    footer: 'Click Apply to start',
  });
}

function panelRow() {
  // The button stays active even when applications are closed so the panel keeps
  // working after `/application toggle`; the handler explains that they are closed.
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('apply:open')
      .setLabel('Apply')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Success),
  );
}

/** Always-available staff button for discussing an application with the applicant. */
function reviewComponents(applicationId, { pending = true } = {}) {
  const row = new ActionRowBuilder();
  if (pending) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`apply:accept:${applicationId}`)
        .setLabel('Accept')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`apply:deny:${applicationId}`)
        .setLabel('Deny')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`apply:ticket:${applicationId}`)
      .setLabel('Open ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

/** Returns the active 2-week cooldown after a denied application, if any. */
function denialCooldown(store, guildId, userId) {
  const denied = store.latestDeniedApplicationFor(guildId, userId);
  if (!denied) return null;

  const reapplyAt =
    denied.reapplyAt ??
    (denied.reviewedAt
      ? new Date(Date.parse(denied.reviewedAt) + DENY_COOLDOWN_MS).toISOString()
      : null);
  const until = reapplyAt ? Date.parse(reapplyAt) : Number.NaN;
  if (!Number.isFinite(until) || until <= Date.now()) return null;
  return { application: denied, until };
}

/**
 * Builds one or more embeds so long applications stay within Discord's limits.
 * Five answers per embed keeps every answer readable inside the 6000-char cap.
 */
function reviewEmbeds(application, statusText) {
  const chunks = [];
  for (let i = 0; i < application.answers.length; i += QUESTIONS_PER_PAGE) {
    chunks.push(application.answers.slice(i, i + QUESTIONS_PER_PAGE));
  }
  if (!chunks.length) chunks.push([]);

  const color =
    application.status === 'pending'
      ? COLORS.brand
      : application.status === 'accepted'
        ? COLORS.success
        : COLORS.danger;

  return chunks.map((chunk, index) => {
    const built = embed({
      title:
        index === 0
          ? `Application ${application.id} — ${application.username}`
          : `Application ${application.id} — continued (${index + 1}/${chunks.length})`,
      color,
      fields: chunk.map((entry) => ({
        name: truncate(entry.question, 100),
        value: truncate(entry.answer, 350),
      })),
      footer:
        index === 0
          ? `User ID: ${application.userId} · Submitted · full answers attached`
          : undefined,
    });
    if (index === 0) {
      built.addFields({
        name: 'Status',
        value: truncate(
          statusText ?? (application.status === 'pending' ? '⏳ Pending review' : 'Reviewed'),
          500,
        ),
      });
    }
    return built;
  });
}

function applicationFile(application) {
  const lines = [
    `Application ${application.id}`,
    `Applicant: ${application.username} (${application.userId})`,
    `Submitted: ${application.createdAt}`,
    '='.repeat(70),
    '',
  ];
  application.answers.forEach((entry, index) => {
    lines.push(`Q${index + 1}: ${entry.question}`);
    lines.push(entry.answer);
    lines.push('');
  });
  return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), {
    name: `application-${application.id}.txt`,
  });
}

function getQuestions(settings) {
  const questions = settings.applications.questions.filter((question) => question?.trim());
  return (questions.length ? questions : DEFAULT_QUESTIONS).slice(0, MAX_QUESTIONS);
}

function clearDraft(draft) {
  if (drafts.get(draft.userId) === draft) drafts.delete(draft.userId);
  if (draft.timer) clearTimeout(draft.timer);
}

async function expireDraft(client, draft) {
  if (drafts.get(draft.userId) !== draft) return;
  clearDraft(draft);

  const user = await client.users.fetch(draft.userId).catch(() => null);
  if (user) {
    await safeDM(user, {
      embeds: [
        warningEmbed(
          'Your application timed out',
          [
            `The 60-minute time limit for your **${draft.guildName}** application has passed.`,
            '',
            'Click **Apply** again if you would still like to apply.',
          ].join('\n'),
        ),
      ],
    });
  }
}

function newDraft(guild, user, questions) {
  const now = Date.now();
  const draft = {
    guildId: guild.id,
    guildName: guild.name,
    userId: user.id,
    username: user.tag,
    questions,
    answers: new Array(questions.length).fill(null),
    index: 0,
    createdAt: now,
    expiresAt: now + ANSWER_TTL_MS,
    timer: null,
  };

  drafts.set(user.id, draft);
  draft.timer = setTimeout(() => {
    expireDraft(guild.client, draft).catch((err) => {
      console.error('[application] Failed to expire draft:', err.message);
    });
  }, ANSWER_TTL_MS);
  draft.timer.unref?.();
  return draft;
}

function questionEmbed(draft) {
  const number = draft.index + 1;
  const description = [
    draft.index === 0
      ? [
          `You are applying to **${draft.guildName}**.`,
          '',
          'Answer each question by typing your reply in this DM. You have **60 minutes** in total.',
          'Type **cancel** at any time to cancel your application.',
          '',
        ].join('\n')
      : '',
    `**${draft.questions[draft.index]}**`,
  ]
    .filter(Boolean)
    .join('\n');

  return embed({
    title: `Application question ${number}/${draft.questions.length}`,
    description,
    color: COLORS.brand,
    footer: `Reply in this DM · Expires ${relative(draft.expiresAt)} · Type cancel to cancel`,
  });
}

async function startApplication(interaction, { store }) {
  const { guild, user } = interaction;
  const settings = store.guild(guild.id);

  if (!settings.applications.open) {
    await interaction.reply({
      embeds: [warningEmbed('Applications are closed', 'Check back later — staff will announce when they reopen.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!settings.applications.reviewChannelId) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          'Applications are not set up yet. Please contact a staff member.',
          'Applications unavailable',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const pending = store.pendingApplicationFor(guild.id, user.id);
  if (pending) {
    await interaction.reply({
      embeds: [
        infoEmbed(
          'You already have an application in review',
          `Your application **${pending.id}** is still pending. Please wait for staff to review it.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cooldown = denialCooldown(store, guild.id, user.id);
  if (cooldown) {
    await interaction.reply({
      embeds: [
        warningEmbed(
          'Application cooldown',
          [
            `Your application **${cooldown.application.id}** was denied.`,
            '',
            `You can apply again ${relative(cooldown.until)} (${timestamp(cooldown.until)}).`,
          ].join('\n'),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existing = drafts.get(user.id);
  if (existing) {
    if (Date.now() < existing.expiresAt) {
      await interaction.reply({
        embeds: [
          infoEmbed(
            'You already have an application in progress',
            'Check your DMs and finish the questions there, or type **cancel** to cancel it.',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    clearDraft(existing);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const draft = newDraft(guild, user, getQuestions(settings));

  try {
    await user.send({ embeds: [questionEmbed(draft)] });
  } catch (err) {
    clearDraft(draft);
    console.error('[application] Could not DM applicant:', err.message);
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'I could not send you a DM. Enable **Direct Messages** for this server in your privacy settings, then click Apply again.',
          'DMs are closed',
        ),
      ],
    });
    return;
  }

  await interaction.editReply({ content: 'Check dms to continue!' });
}

async function submitDraft(client, draft, { store }) {
  const guild =
    client.guilds.cache.get(draft.guildId) ??
    (await client.guilds.fetch(draft.guildId).catch(() => null));
  const user = await client.users.fetch(draft.userId).catch(() => null);

  if (!guild) {
    if (user) {
      await safeDM(user, {
        embeds: [errorEmbed('Your application could not be submitted. Please contact a staff member.')],
      });
    }
    return;
  }

  const settings = store.guild(guild.id);
  const pending = store.pendingApplicationFor(guild.id, draft.userId);
  if (pending) {
    if (user) {
      await safeDM(user, {
        embeds: [
          infoEmbed(
            'You already have an application in review',
            `Your application **${pending.id}** is still pending. Please wait for staff to review it.`,
          ),
        ],
      });
    }
    return;
  }

  const reviewChannel =
    guild.channels.cache.get(settings.applications.reviewChannelId) ??
    (await guild.channels.fetch(settings.applications.reviewChannelId).catch(() => null));
  if (!reviewChannel?.isTextBased()) {
    if (user) {
      await safeDM(user, {
        embeds: [errorEmbed('The review channel is missing. Please contact a staff member.')],
      });
    }
    return;
  }

  const answers = draft.questions.map((question, index) => ({
    question,
    answer: (draft.answers[index] ?? '').trim() || '—',
  }));

  const number = store.nextCounter(guild.id, 'application');
  const application = {
    id: `A-${String(number).padStart(4, '0')}`,
    guildId: guild.id,
    userId: draft.userId,
    username: draft.username,
    answers,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  store.addApplication(application);

  const staffPing = settings.staffRoleId ? `<@&${settings.staffRoleId}>` : '';
  const message = await reviewChannel
    .send({
      content: `${staffPing} new application from <@${draft.userId}> (${draft.userId})`.trim(),
      embeds: reviewEmbeds(application),
      files: [applicationFile(application)],
      components: reviewComponents(application.id),
    })
    .catch((err) => {
      console.error('[application] Failed to post review message:', err);
      return null;
    });

  if (!message) {
    store.updateApplication(application.id, { status: 'failed' });
    if (user) {
      await safeDM(user, {
        embeds: [errorEmbed('Your application could not be submitted. Please contact a staff member.')],
      });
    }
    return;
  }

  store.updateApplication(application.id, { messageId: message.id, channelId: reviewChannel.id });

  if (user) {
    await safeDM(user, {
      embeds: [
        successEmbed(
          'Application submitted',
          `Thanks <@${draft.userId}>! Your application **${application.id}** is now with the staff team. You will receive a DM when it has been reviewed.`,
        ),
      ],
    });
  }

  await sendLog(guild, settings, [
    embed({
      title: 'Application submitted',
      color: COLORS.brand,
      fields: [
        { name: 'Applicant', value: `<@${draft.userId}> (${draft.userId})`, inline: true },
        { name: 'Application', value: application.id, inline: true },
      ],
    }),
  ]);
}

/** Handles an incoming DM, using it as the answer to the current question. */
async function handleDirectMessage(message, { client, store }) {
  if (!message.channel.isDMBased() || message.author.bot) return;

  const draft = drafts.get(message.author.id);
  if (!draft) {
    await safeDM(message.author, {
      embeds: [
        infoEmbed(
          'No application in progress',
          'Click the **Apply** button in the server to start a new application.',
        ),
      ],
    });
    return;
  }

  if (Date.now() >= draft.expiresAt) {
    clearDraft(draft);
    await safeDM(message.author, {
      embeds: [
        warningEmbed(
          'Your application timed out',
          'The 60-minute time limit has passed. Click **Apply** in the server to start again.',
        ),
      ],
    });
    return;
  }

  const content = message.content.trim();

  if (content.toLowerCase() === 'cancel') {
    clearDraft(draft);
    await safeDM(message.author, {
      embeds: [
        infoEmbed(
          'Application cancelled',
          'Nothing was submitted. You can click **Apply** in the server if you change your mind.',
        ),
      ],
    });
    return;
  }

  if (!content) {
    await safeDM(message.author, {
      embeds: [errorEmbed('Please type your answer as a message so I can save it.')],
    });
    return;
  }

  if (content.length > MAX_ANSWER_LENGTH) {
    await safeDM(message.author, {
      embeds: [
        errorEmbed(
          `That answer is too long (${content.length}/${MAX_ANSWER_LENGTH} characters). Please shorten it and send it again.`,
        ),
      ],
    });
    return;
  }

  draft.answers[draft.index] = content;
  draft.index += 1;

  if (draft.index < draft.questions.length) {
    try {
      await message.author.send({ embeds: [questionEmbed(draft)] });
    } catch (err) {
      clearDraft(draft);
      console.error('[application] Could not send next question:', err.message);
    }
    return;
  }

  clearDraft(draft);
  await submitDraft(client, draft, { store });
}

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  if (!(await requireStaff(interaction, settings))) return;

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'questions') {
    if (sub === 'list') {
      const questions = getQuestions(settings);
      await interaction.reply({
        embeds: [
          embed({
            title: 'Application questions',
            description: questions.map((question, index) => `**${index + 1}.** ${question}`).join('\n'),
            color: COLORS.brand,
            footer: `${questions.length} question${questions.length === 1 ? '' : 's'} · max ${MAX_QUESTIONS}`,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        embeds: [errorEmbed('You need **Manage Server** to change the application questions.', 'Missing permissions')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add') {
      const question = interaction.options.getString('question').trim();
      if (settings.applications.questions.length >= MAX_QUESTIONS) {
        await interaction.reply({
          embeds: [errorEmbed(`You can have at most ${MAX_QUESTIONS} questions. Remove one before adding another.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      settings.applications.questions.push(question);
      store.save();
      await interaction.reply({
        embeds: [
          successEmbed(
            'Question added',
            `**${settings.applications.questions.length}.** ${question}\n\nThere are now **${settings.applications.questions.length}** questions.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove') {
      const number = interaction.options.getInteger('number');
      const questions = settings.applications.questions;
      if (number > questions.length) {
        await interaction.reply({
          embeds: [errorEmbed(`There is no question **${number}**. Use \`/application questions list\` to see them.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (questions.length === 1) {
        await interaction.reply({
          embeds: [errorEmbed('Keep at least one question. Add a new one before removing the last.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const [removed] = questions.splice(number - 1, 1);
      store.save();
      await interaction.reply({
        embeds: [
          successEmbed(
            'Question removed',
            `Removed **${number}.** ${removed}\n\nThere are now **${questions.length}** questions.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (sub === 'panel') {
    const target = interaction.options.getChannel('channel') ?? interaction.channel;
    await target.send({ embeds: [panelEmbed(settings)], components: [panelRow()] });
    await interaction.reply({
      embeds: [
        successEmbed(
          'Application panel posted',
          [
            `Posted in ${target}.`,
            settings.applications.reviewChannelId
              ? ''
              : '⚠️ No review channel is set yet — run `/config set application_review_channel:#channel` before members apply.',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'toggle') {
    const open = interaction.options.getBoolean('open');
    settings.applications.open = open;
    store.save();
    await interaction.reply({
      embeds: [
        open
          ? successEmbed('Applications opened', 'New applications can now be submitted.')
          : warningEmbed('Applications closed', 'The Apply button will now turn members away.'),
      ],
    });
  }
}

async function openApplicationTicket(interaction, { store, applicationId }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);

  if (!isStaff(interaction.member, settings)) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff can open application tickets.', 'Missing permissions')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const application = store.application(applicationId);
  if (!application) {
    await interaction.reply({
      embeds: [errorEmbed('That application could not be found.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const existingId = store.ticketForApplication(guild.id, applicationId);
  if (existingId) {
    const existing =
      guild.channels.cache.get(existingId) ??
      (await guild.channels.fetch(existingId).catch(() => null));
    if (existing) {
      await interaction.editReply({
        embeds: [
          infoEmbed(
            'An application ticket is already open',
            `Continue the conversation with <@${application.userId}> in ${existing}.`,
          ),
        ],
      });
      return;
    }
    store.removeTicket(existingId);
  }

  const applicant = await guild.members.fetch(application.userId).catch(() => null);
  if (!applicant) {
    await interaction.editReply({
      embeds: [errorEmbed('The applicant is no longer a member of this server.')],
    });
    return;
  }

  let channel;
  let ticket;
  try {
    ({ channel, ticket } = await createTicketChannel({
      client: interaction.client,
      guild,
      settings,
      store,
      ownerId: application.userId,
      extraUserIds: [interaction.user.id],
      categoryId: APPLICATION_TICKET_CATEGORY_ID,
      topic: `Application ${application.id} · applicant ${application.username} (${application.userId})`,
      reason: `Application ticket opened by ${interaction.user.tag}`,
      type: 'application',
    }));
  } catch (err) {
    console.error('[application] Failed to create ticket:', err);
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'I could not create the application ticket. Make sure I have **Manage Channels** and access to the application ticket category.',
          'Ticket creation failed',
        ),
      ],
    });
    return;
  }

  store.addTicket(channel.id, { ...ticket, applicationId });

  const reviewLink =
    application.channelId && application.messageId
      ? `https://discord.com/channels/${guild.id}/${application.channelId}/${application.messageId}`
      : null;
  const status =
    application.status === 'pending'
      ? 'Pending review'
      : application.status === 'accepted'
        ? 'Accepted'
        : 'Denied';

  const welcome = embed({
    title: `Application ${application.id}`,
    description: [
      `Hey ${applicant}, this private ticket is for discussing your staff application with the team.`,
      '',
      'A staff member will be with you shortly.',
    ].join('\n'),
    color: COLORS.brand,
    fields: [
      { name: 'Applicant', value: `${applicant.user} (${applicant.id})`, inline: true },
      { name: 'Application', value: application.id, inline: true },
      { name: 'Status', value: status, inline: true },
      ...(reviewLink
        ? [{ name: 'Application review', value: `[Jump to the review message](${reviewLink})` }]
        : []),
    ],
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

  await channel.send({
    content: [applicant.toString(), `<@${interaction.user.id}>`].join(' '),
    embeds: [welcome],
    components: [row],
  });

  await interaction.editReply({
    embeds: [successEmbed('Application ticket opened', `The ticket is ready: ${channel}`)],
  });

  await sendLog(guild, settings, [
    embed({
      title: 'Application ticket opened',
      color: COLORS.success,
      fields: [
        { name: 'Applicant', value: `${applicant.user} (${applicant.id})`, inline: true },
        { name: 'Application', value: application.id, inline: true },
        { name: 'Opened by', value: `${interaction.user}`, inline: true },
        { name: 'Channel', value: `${channel}`, inline: true },
      ],
    }),
  ]);
}

async function handleButton(interaction, { store }) {
  const [, action, arg] = interaction.customId.split(':');
  const guild = interaction.guild;
  const settings = store.guild(guild.id);

  if (action === 'open') {
    await startApplication(interaction, { store });
    return;
  }

  if (action === 'ticket') {
    await openApplicationTicket(interaction, { store, applicationId: arg });
    return;
  }

  // ---- accept / deny -------------------------------------------------------
  const application = store.application(arg);
  if (!application || application.status !== 'pending') {
    await interaction.reply({
      embeds: [errorEmbed('This application has already been reviewed.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!isStaff(interaction.member, settings)) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff can review applications.', 'Missing permissions')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'deny') {
    const modal = new ModalBuilder()
      .setCustomId(`apply:deny-modal:${application.id}`)
      .setTitle(`Deny ${application.id}`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason (sent to the applicant)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === 'accept') {
    const member = await guild.members.fetch(application.userId).catch(() => null);
    if (!member) {
      await interaction.reply({
        embeds: [errorEmbed('That applicant is no longer a member of the server.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let roleWarning = null;
    const acceptRoleId = settings.applications.acceptRoleId;
    if (acceptRoleId) {
      const role = guild.roles.cache.get(acceptRoleId);
      if (role && canManageRole(guild, role)) {
        await member.roles.add(role, `Application ${application.id} accepted`).catch((err) => {
          roleWarning = err.message;
        });
      } else {
        roleWarning = 'the configured accept role is missing or above my highest role';
      }
    }

    const updated = store.updateApplication(application.id, {
      status: 'accepted',
      reviewedBy: interaction.user.id,
      reviewedAt: new Date().toISOString(),
    });

    await interaction.update({
      embeds: reviewEmbeds(updated, `✅ Accepted by ${interaction.user}`),
      components: reviewComponents(application.id, { pending: false }),
    });

    if (roleWarning) {
      await interaction
        .followUp({
          embeds: [
            warningEmbed(
              'Accepted, but the role was not applied',
              `${truncate(roleWarning, 900)}\n\nGive the role manually or fix the role hierarchy with \`/config set application_accept_role:@role\`.`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    await safeDM(member.user, {
      embeds: [
        successEmbed(
          'Your application was accepted',
          [
            `**Server:** ${guild.name}`,
            `**Application:** ${application.id}`,
            '',
            'Welcome to the team! Your quick starter tutorial:',
            '',
            `1. Read the [staff rules](https://discord.com/channels/${guild.id}/1528260370106417292).`,
            `2. Follow the [staff workflow](https://discord.com/channels/${guild.id}/1563549593755586610).`,
            '3. Run `!staffguide` in the staff channel for every command and when to use it.',
          ].join('\n'),
        ),
      ],
    });

    await sendLog(guild, settings, [
      embed({
        title: 'Application accepted',
        color: COLORS.success,
        fields: [
          { name: 'Applicant', value: `${member.user} (${member.id})`, inline: true },
          { name: 'Application', value: application.id, inline: true },
          { name: 'Reviewed by', value: `${interaction.user}`, inline: true },
          ...(roleWarning ? [{ name: '⚠️ Role not applied', value: truncate(roleWarning, 1024) }] : []),
        ],
      }),
    ]);
  }
}

async function handleModal(interaction, { store }) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const guild = interaction.guild;
  const settings = store.guild(guild.id);

  if (action === 'deny-modal') {
    const applicationId = parts[2];
    const application = store.application(applicationId);
    if (!application || application.status !== 'pending') {
      await interaction.reply({
        embeds: [errorEmbed('This application has already been reviewed.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!isStaff(interaction.member, settings)) {
      await interaction.reply({
        embeds: [errorEmbed('Only staff can review applications.', 'Missing permissions')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = interaction.fields.getTextInputValue('reason').trim();
    const updated = store.updateApplication(applicationId, {
      status: 'denied',
      reviewedBy: interaction.user.id,
      reviewedAt: new Date().toISOString(),
      denyReason: reason,
      reapplyAt: new Date(Date.now() + DENY_COOLDOWN_MS).toISOString(),
    });

    const reviewMessage = application.channelId
      ? await guild.channels.cache
          .get(application.channelId)
          ?.messages.fetch(application.messageId)
          .catch(() => null)
      : null;

    if (reviewMessage) {
      await reviewMessage
        .edit({
          embeds: reviewEmbeds(
            updated,
            `❌ Denied by ${interaction.user}\n**Reason:** ${truncate(reason, 900)}\n**Reapply:** ${relative(updated.reapplyAt)}`,
          ),
          components: reviewComponents(applicationId, { pending: false }),
        })
        .catch(() => {});
    }

    await interaction.reply({
      embeds: [
        successEmbed('Application denied', `${application.id} was denied and the applicant has been notified.`),
      ],
      flags: MessageFlags.Ephemeral,
    });

    const applicant = await guild.client.users.fetch(application.userId).catch(() => null);
    if (applicant) {
      await safeDM(applicant, {
        embeds: [
          embed({
            title: 'Your application was not accepted',
            description: [
              `**Server:** ${guild.name}`,
              `**Application:** ${application.id}`,
              `**Reason:** ${reason}`,
              '',
              `Thank you for applying. You can apply again ${relative(updated.reapplyAt)} (${timestamp(updated.reapplyAt)}).`,
            ].join('\n'),
            color: COLORS.danger,
          }),
        ],
      });
    }

    await sendLog(guild, settings, [
      embed({
        title: 'Application denied',
        color: COLORS.danger,
        fields: [
          { name: 'Applicant', value: `<@${application.userId}> (${application.userId})`, inline: true },
          { name: 'Application', value: application.id, inline: true },
          { name: 'Reviewed by', value: `${interaction.user}`, inline: true },
          { name: 'Reason', value: truncate(reason, 1024) },
          { name: 'Reapply', value: relative(updated.reapplyAt), inline: true },
        ],
      }),
    ]);
  }
}

module.exports = {
  data,
  execute,
  handleButton,
  handleModal,
  handleDirectMessage,
  panelEmbed,
  panelRow,
  reviewComponents,
  denialCooldown,
};
