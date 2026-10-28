'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const {
  embed,
  successEmbed,
  errorEmbed,
  infoEmbed,
  requireStaff,
  sendLog,
  truncate,
  relative,
  timestamp,
  COLORS,
} = require('../lib/helpers');
const activity = require('../lib/activity');
const { createTicketChannel } = require('./ticket');

/** The category giveaway claim tickets are created in. */
const CLAIM_CATEGORY_ID = '1556430315386445965';
const MAX_WINNERS = 20;
const TICK_MS = 5_000;

let scheduler = null;
let ticking = false;

const data = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway system')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Start a giveaway in this channel')
        .addStringOption((opt) =>
          opt
            .setName('prize')
            .setDescription('What the winner gets')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(200),
        )
        .addStringOption((opt) =>
          opt
            .setName('duration')
            .setDescription('How long entries stay open, e.g. 1d, 12h, 30m or 30s')
            .setRequired(true)
            .setMaxLength(20),
        )
        .addStringOption((opt) =>
          opt
            .setName('claimtime')
            .setDescription('How long the winners have to claim, e.g. 24h, 30m or 30s')
            .setRequired(true)
            .setMaxLength(20),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('winners')
            .setDescription('How many winners to draw (default 1)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(MAX_WINNERS),
        ),
    ),
];

function activeEntryRow(giveaway) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${giveaway.id}`)
      .setLabel('Enter Giveaway')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success),
  );
}

/** Every winner of a giveaway; older giveaways only stored a single winner. */
function winnerIdsOf(giveaway) {
  if (Array.isArray(giveaway?.winnerIds)) return giveaway.winnerIds;
  return giveaway?.winnerId ? [giveaway.winnerId] : [];
}

/** Claim records per winner. Older giveaways stored one claim on the giveaway. */
function claimsOf(giveaway) {
  const claims = giveaway?.claims;
  if (claims && typeof claims === 'object' && Object.keys(claims).length) return claims;
  if (giveaway?.claimedAt && giveaway.winnerId) {
    return {
      [giveaway.winnerId]: {
        claimedAt: giveaway.claimedAt,
        ticketChannelId: giveaway.ticketChannelId ?? null,
      },
    };
  }
  return {};
}

function unclaimedWinners(giveaway) {
  const claims = claimsOf(giveaway);
  return winnerIdsOf(giveaway).filter((id) => !claims[id]);
}

/** Distinct random winners, never more than the number of entries. */
function drawWinners(entries, count, random = Math.random) {
  const pool = [...new Set(entries ?? [])];
  const winners = [];
  const wanted = Math.min(Math.max(1, Number(count) || 1), pool.length);

  while (winners.length < wanted && pool.length) {
    const [picked] = pool.splice(Math.floor(random() * pool.length), 1);
    winners.push(picked);
  }

  return winners;
}

function claimRow(giveaway) {
  const winners = winnerIdsOf(giveaway);
  const claimed = winners.length - unclaimedWinners(giveaway).length;
  const disabled = Boolean(
    giveaway.claimExpiredAt ||
      !winners.length ||
      claimed >= winners.length ||
      giveaway.claimInProgress,
  );
  let label = 'Claim Prize';
  if (giveaway.claimExpiredAt) label = 'Claim window closed';
  else if (winners.length && claimed >= winners.length) label = 'All prizes claimed';
  else if (giveaway.claimInProgress) label = 'Opening ticket…';

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:claim:${giveaway.id}`)
      .setLabel(label)
      .setEmoji('🎁')
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

function activeEmbed(giveaway) {
  return embed({
    title: '🎉 Giveaway',
    description: [
      `**Prize:** ${giveaway.prize}`,
      `**Host:** <@${giveaway.hostId}>`,
      `**Ends:** ${relative(giveaway.endsAt)}`,
      `**Claim window:** ${activity.formatDuration(giveaway.claimSeconds, { seconds: true })} after the giveaway ends`,
      `**Entries:** ${giveaway.entries.length}`,
      ...(giveaway.winnerCount > 1 ? [`**Winners:** ${giveaway.winnerCount}`] : []),
      '',
      'Click **Enter Giveaway** below for a chance to win!',
    ].join('\n'),
    color: COLORS.brand,
    footer: giveaway.id,
  });
}

/** One short line for the winners, with the claim button underneath. */
function endedContent(giveaway) {
  const winners = winnerIdsOf(giveaway);
  if (!winners.length) return `🎉 The **${giveaway.prize}** giveaway ended with no entries.`;

  const claims = claimsOf(giveaway);
  const claimed = winners.filter((id) => claims[id]);
  const waiting = winners.filter((id) => !claims[id]);
  const mentions = winners.map((id) => `<@${id}>`).join(', ');

  if (!waiting.length) {
    const tickets = claimed
      .map((id) => (claims[id].ticketChannelId ? `<#${claims[id].ticketChannelId}>` : null))
      .filter(Boolean);
    return `✅ ${mentions} claimed the **${giveaway.prize}** prize${tickets.length ? ` — ${tickets.join(', ')}` : ''}.`;
  }
  if (giveaway.claimExpiredAt) {
    return `⏰ The claim window for **${giveaway.prize}** closed — ${waiting
      .map((id) => `<@${id}>`)
      .join(', ')} did not claim.`;
  }
  if (claimed.length) {
    return [
      `🎉 Congrats ${mentions}! You won **${giveaway.prize}**.`,
      `✅ Claimed: ${claimed.map((id) => `<@${id}>`).join(', ')}`,
      `⏳ Still waiting on: ${waiting.map((id) => `<@${id}>`).join(', ')}`,
      'Press **Claim Prize** below.',
    ].join('\n');
  }

  return `🎉 Congrats ${mentions}! You won **${giveaway.prize}**. Press **Claim Prize** below.`;
}

/** Small winner message: the ping line plus the claim button, nothing else. */
function endedPayload(giveaway) {
  const winners = winnerIdsOf(giveaway);
  return {
    content: endedContent(giveaway),
    components: winners.length ? [claimRow(giveaway)] : [],
    allowedMentions: { parse: [], users: winners },
  };
}

async function getGiveawayMessage(client, giveaway) {
  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel?.isTextBased()) return { channel: null, message: null };
  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  return { channel, message };
}

async function endGiveaway(ctx, giveaway) {
  const { client, store } = ctx;
  const guild = client.guilds.cache.get(giveaway.guildId);
  const now = Date.now();
  const entries = [...new Set(giveaway.entries)];
  const winnerIds = drawWinners(entries, giveaway.winnerCount ?? 1);
  const claimEndsAt = new Date(now + giveaway.claimSeconds * 1000).toISOString();

  const updated = store.updateGiveaway(giveaway.id, {
    status: 'ended',
    endedAt: new Date(now).toISOString(),
    winnerIds,
    // Kept in sync for anything that still reads the older single-winner field.
    winnerId: winnerIds[0] ?? null,
    claims: {},
    claimEndsAt,
  });

  const { channel, message } = await getGiveawayMessage(client, updated);
  if (!message) {
    console.warn(`[giveaway] Winner message for ${giveaway.id} is missing; marked as ended.`);
    return updated;
  }

  await message
    .edit(endedPayload(updated))
    .catch((err) => console.error('[giveaway] Failed to post winner message:', err.message));

  if (guild) {
    await sendLog(guild, store.guild(guild.id), [
      embed({
        title: 'Giveaway ended',
        color: winnerIds.length ? COLORS.success : COLORS.neutral,
        fields: [
          { name: 'Giveaway', value: `${giveaway.id} · ${truncate(giveaway.prize, 200)}`, inline: true },
          {
            name: 'Winners',
            value: winnerIds.length ? winnerIds.map((id) => `<@${id}>`).join(', ') : 'No entries',
            inline: true,
          },
          { name: 'Entries', value: `${entries.length}`, inline: true },
          ...(winnerIds.length
            ? [{ name: 'Claim before', value: timestamp(claimEndsAt), inline: true }]
            : []),
        ],
      }),
    ]);
  }

  return updated;
}

async function expireClaim(ctx, giveaway) {
  const updated = ctx.store.updateGiveaway(giveaway.id, {
    claimExpiredAt: new Date().toISOString(),
  });
  const { message } = await getGiveawayMessage(ctx.client, updated);
  if (message) {
    await message
      .edit(endedPayload(updated))
      .catch((err) => console.error('[giveaway] Failed to close claim window:', err.message));
  }
  return updated;
}

async function forwardWinnerMessage(client, giveaway, guild, ticketChannel) {
  const { message } = await getGiveawayMessage(client, giveaway);
  if (message) {
    try {
      await message.forward(ticketChannel);
      return true;
    } catch (err) {
      console.warn('[giveaway] Forward failed, sending a link instead:', err.message);
    }
  }

  const url = `https://discord.com/channels/${guild.id}/${giveaway.channelId}/${giveaway.messageId}`;
  await ticketChannel
    .send({ content: `🎉 [Original giveaway winner message](${url})` })
    .catch(() => {});
  return false;
}

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  if (!(await requireStaff(interaction, settings))) return;

  const sub = interaction.options.getSubcommand();
  if (sub !== 'create') return;

  let durationSeconds;
  let claimSeconds;
  try {
    durationSeconds = activity.parseDuration(interaction.options.getString('duration'), {
      minSeconds: 1,
    });
    claimSeconds = activity.parseDuration(interaction.options.getString('claimtime'), {
      minSeconds: 1,
    });
  } catch (err) {
    await interaction.reply({
      embeds: [errorEmbed(err.message, 'Invalid time')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.channel?.isTextBased()) {
    await interaction.reply({
      embeds: [errorEmbed('Run this command in a normal text channel.', 'Invalid channel')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const prize = interaction.options.getString('prize').trim();
  const winnerCount = Math.min(
    Math.max(1, interaction.options.getInteger('winners') ?? 1),
    MAX_WINNERS,
  );
  const number = store.nextCounter(guild.id, 'giveaway');
  const giveaway = {
    id: `G-${String(number).padStart(4, '0')}`,
    guildId: guild.id,
    channelId: interaction.channel.id,
    messageId: null,
    hostId: interaction.user.id,
    hostTag: interaction.user.tag,
    prize,
    createdAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + durationSeconds * 1000).toISOString(),
    durationSeconds,
    claimSeconds,
    claimEndsAt: null,
    winnerCount,
    winnerId: null,
    winnerIds: [],
    claims: {},
    entries: [],
    status: 'active',
  };

  const message = await interaction.channel
    .send({ embeds: [activeEmbed(giveaway)], components: [activeEntryRow(giveaway)] })
    .catch((err) => {
      console.error('[giveaway] Failed to post giveaway:', err);
      return null;
    });

  if (!message) {
    await interaction.reply({
      embeds: [errorEmbed('I could not post the giveaway. Check my Send Messages permission here.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  giveaway.messageId = message.id;
  store.addGiveaway(giveaway);

  await interaction.reply({
    embeds: [
      successEmbed(
        'Giveaway started',
        [
          `**Prize:** ${prize}`,
          `**Winners:** ${winnerCount}`,
          `**Ends:** ${relative(giveaway.endsAt)}`,
          `**Claim window:** ${activity.formatDuration(claimSeconds, { seconds: true })}`,
          `[Jump to giveaway](${message.url})`,
        ].join('\n'),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });

  await sendLog(guild, settings, [
    embed({
      title: 'Giveaway started',
      color: COLORS.brand,
      fields: [
        { name: 'Giveaway', value: `${giveaway.id} · ${truncate(prize, 200)}`, inline: true },
        { name: 'Host', value: `${interaction.user}`, inline: true },
        { name: 'Winners', value: `${winnerCount}`, inline: true },
        { name: 'Ends', value: timestamp(giveaway.endsAt), inline: true },
      ],
    }),
  ]);
}

async function handleEnter(interaction, { store }, giveaway) {
  if (!giveaway || giveaway.guildId !== interaction.guild.id) {
    await interaction.reply({
      embeds: [errorEmbed('This giveaway no longer exists.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (giveaway.status !== 'active' || Date.now() >= Date.parse(giveaway.endsAt)) {
    await interaction.reply({
      embeds: [infoEmbed('This giveaway has ended', 'Better luck next time!')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (giveaway.entries.includes(interaction.user.id)) {
    await interaction.reply({
      embeds: [infoEmbed('You are already entered', 'Good luck! 🍀')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  giveaway.entries.push(interaction.user.id);
  store.updateGiveaway(giveaway.id, { entries: giveaway.entries });

  await interaction.reply({
    embeds: [successEmbed('You are entered!', `Good luck — the winner is drawn ${relative(giveaway.endsAt)}.`)],
    flags: MessageFlags.Ephemeral,
  });

  await interaction.message
    .edit({
      embeds: [activeEmbed(giveaway)],
      // Without the row the button vanishes for everyone after the first entry.
      components: [activeEntryRow(giveaway)],
    })
    .catch((err) => console.error('[giveaway] Failed to update entry count:', err.message));
}

async function handleClaim(interaction, ctx, giveaway) {
  const { store, client } = ctx;
  const guild = interaction.guild;

  if (!giveaway || giveaway.guildId !== guild.id) {
    await interaction.reply({
      embeds: [errorEmbed('This giveaway no longer exists.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (giveaway.status !== 'ended' || !winnerIdsOf(giveaway).length) {
    await interaction.reply({
      embeds: [infoEmbed('This giveaway has not ended yet', 'The claim button only works for the winners after the draw.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const claimant = interaction.user;
  if (!winnerIdsOf(giveaway).includes(claimant.id)) {
    await interaction.reply({
      embeds: [errorEmbed('Only a giveaway winner can claim this prize.', 'Not your prize')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existingClaim = claimsOf(giveaway)[claimant.id];
  if (existingClaim) {
    const channel = existingClaim.ticketChannelId
      ? guild.channels.cache.get(existingClaim.ticketChannelId)
      : null;
    await interaction.reply({
      embeds: [
        infoEmbed(
          'You already claimed this prize',
          channel ? `Your ticket is here: ${channel}` : 'A staff member will help you with your prize.',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (giveaway.claimInProgress) {
    await interaction.reply({
      embeds: [infoEmbed('Your ticket is being created', 'Please wait a moment and check the category.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (Date.now() >= Date.parse(giveaway.claimEndsAt)) {
    await expireClaim(ctx, giveaway);
    await interaction.reply({
      embeds: [errorEmbed('The claim window for this giveaway has closed.', 'Too late')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const winner = await guild.members.fetch(claimant.id).catch(() => null);
  if (!winner) {
    await interaction.editReply({
      embeds: [errorEmbed('You are no longer a member of this server, so a ticket cannot be opened.')],
    });
    return;
  }

  const host = await guild.members.fetch(giveaway.hostId).catch(() => null);
  giveaway.claimInProgress = true;
  store.updateGiveaway(giveaway.id, { claimInProgress: true });

  let channel;
  try {
    ({ channel } = await createTicketChannel({
      client,
      guild,
      settings: store.guild(guild.id),
      store,
      ownerId: claimant.id,
      extraUserIds: host ? [host.id] : [],
      categoryId: CLAIM_CATEGORY_ID,
      topic: `Giveaway ${giveaway.id} prize claim · winner ${claimant.id} · host ${giveaway.hostId}`,
      reason: `Giveaway ${giveaway.id} prize claimed by ${claimant.tag}`,
      type: 'giveaway',
    }));
  } catch (err) {
    giveaway.claimInProgress = false;
    store.updateGiveaway(giveaway.id, { claimInProgress: false });
    console.error('[giveaway] Failed to create claim ticket:', err);
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'I could not create the claim ticket. Make sure I have **Manage Channels** access to the giveaway ticket category.',
          'Ticket creation failed',
        ),
      ],
    });
    return;
  }

  const hostMention = host ? `<@${host.id}>` : 'the host';
  const welcome = embed({
    title: `🎁 Prize claim — ${truncate(giveaway.prize, 200)}`,
    description: [
      `Congratulations <@${claimant.id}>! You won **${giveaway.prize}**.`,
      '',
      `**Host:** ${hostMention}`,
      `**Giveaway:** ${giveaway.id}`,
      `**Claimed:** ${timestamp()}`,
      '',
      'The original giveaway winner message has been forwarded below so the host can verify the prize.',
    ].join('\n'),
    color: COLORS.success,
  });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close:${channel.id}`)
      .setLabel('Close')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );

  await channel.send({
    content: [`<@${claimant.id}>`, host ? `<@${host.id}>` : ''].filter(Boolean).join(' '),
    embeds: [welcome],
    components: [closeRow],
  });

  await forwardWinnerMessage(client, giveaway, guild, channel);

  const claims = {
    ...claimsOf(giveaway),
    [claimant.id]: { claimedAt: new Date().toISOString(), ticketChannelId: channel.id },
  };
  const remaining = winnerIdsOf(giveaway).filter((id) => !claims[id]);

  const updated = store.updateGiveaway(giveaway.id, {
    claims,
    // Mirrored onto the older single-claim fields for anything still reading them.
    claimedAt: Object.values(claims)[0].claimedAt,
    claimedBy: claimant.id,
    ticketChannelId: channel.id,
    claimInProgress: false,
    ...(remaining.length ? {} : { allClaimedAt: new Date().toISOString() }),
  });

  const { message } = await getGiveawayMessage(client, updated);
  if (message) {
    await message
      .edit(endedPayload(updated))
      .catch((err) => console.error('[giveaway] Failed to update winner message:', err.message));
  }

  await interaction.editReply({
    embeds: [successEmbed('Prize claimed', `Your private ticket with the host is ready: ${channel}`)],
  });

  await sendLog(guild, store.guild(guild.id), [
    embed({
      title: 'Giveaway prize claimed',
      color: COLORS.success,
      fields: [
        { name: 'Giveaway', value: `${giveaway.id} · ${truncate(giveaway.prize, 200)}`, inline: true },
        { name: 'Winner', value: `${winner}`, inline: true },
        { name: 'Ticket', value: `${channel}`, inline: true },
        {
          name: 'Still claiming',
          value: remaining.length ? remaining.map((id) => `<@${id}>`).join(', ') : 'Everyone claimed',
          inline: true,
        },
      ],
    }),
  ]);
}

async function handleButton(interaction, ctx) {
  const [, action, id] = interaction.customId.split(':');
  const giveaway = id ? ctx.store.giveaway(id) : null;

  if (action === 'enter') {
    await handleEnter(interaction, ctx, giveaway);
    return;
  }
  if (action === 'claim') {
    await handleClaim(interaction, ctx, giveaway);
  }
}

async function runTick(ctx) {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const giveaway of Object.values(ctx.store.data.giveaways)) {
      if (giveaway.status === 'active' && now >= Date.parse(giveaway.endsAt)) {
        try {
          await endGiveaway(ctx, giveaway);
        } catch (err) {
          console.error(`[giveaway] Failed to end ${giveaway.id}:`, err);
        }
        continue;
      }

      if (
        giveaway.status === 'ended' &&
        unclaimedWinners(giveaway).length > 0 &&
        !giveaway.claimExpiredAt &&
        !giveaway.claimInProgress &&
        giveaway.claimEndsAt &&
        now >= Date.parse(giveaway.claimEndsAt)
      ) {
        try {
          await expireClaim(ctx, giveaway);
        } catch (err) {
          console.error(`[giveaway] Failed to expire claim for ${giveaway.id}:`, err);
        }
      }
    }
  } finally {
    ticking = false;
  }
}

function startScheduler(ctx) {
  stopScheduler();
  runTick(ctx).catch((err) => console.error('[giveaway] Scheduler tick failed:', err));
  scheduler = setInterval(() => {
    runTick(ctx).catch((err) => console.error('[giveaway] Scheduler tick failed:', err));
  }, TICK_MS);
  scheduler.unref?.();
}

function stopScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
}

module.exports = {
  data,
  execute,
  handleButton,
  activeEmbed,
  activeEntryRow,
  endedContent,
  endedPayload,
  endGiveaway,
  drawWinners,
  winnerIdsOf,
  claimsOf,
  unclaimedWinners,
  MAX_WINNERS,
  expireClaim,
  runTick,
  startScheduler,
  stopScheduler,
  CLAIM_CATEGORY_ID,
};
