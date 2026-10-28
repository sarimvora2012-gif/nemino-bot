'use strict';

/**
 * Spawner price board.
 *
 * Prices live in `settings.spawners` as millions with up to two decimals,
 * e.g. 13 -> "13M", 13.5 -> "13.5M", 0.75 -> "0.75M".
 * A single panel message is kept in the spawner prices channel and edited in
 * place whenever a price changes, so the channel always shows current prices.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require('discord.js');
const { embed, errorEmbed, successEmbed, infoEmbed, COLORS, isStaff } = require('./helpers');
const { toSmallCaps } = require('./smallcaps');
const v2 = require('./v2');
const { createTicketChannel } = require('../commands/ticket');

const PREFIX = '!spawnerprices';
const PRICES_CHANNEL_ID = '1528595505255288893';
const TICKET_CATEGORY_ID = '1556430475898396862';
const ACCENT = 0xf1c40f;
const MAX_PRICE = 1_000_000;
const MIN_PRICE = 0.01;
const MAX_DECIMALS = 2;

/** Display order is fixed: it is the order people expect on the board. */
const SPAWNER_TYPES = [
  { key: 'skeleton', label: 'Skeleton', emoji: '💀', names: ['skeleton', 'skelly'] },
  { key: 'creeper', label: 'Creeper', emoji: '💥', names: ['creeper'] },
  { key: 'irongolem', label: 'Iron Golem', emoji: '🤖', names: ['irongolem', 'iron_golem', 'golem'] },
  {
    key: 'zombiepiglin',
    label: 'Zombified Piglin',
    emoji: '🐷',
    names: ['zombiepiglin', 'zombifiedpiglin', 'zombie_piglin', 'zombified_piglin', 'piglin'],
  },
  { key: 'pig', label: 'Pig', emoji: '🐖', names: ['pig'] },
  { key: 'cow', label: 'Cow', emoji: '🐄', names: ['cow'] },
];

const MODES = [
  { key: 'buy', label: 'Buying' },
  { key: 'sell', label: 'Selling' },
];

function findEmoji(guild, names) {
  const cache = guild?.emojis?.cache;
  if (!cache?.find) return null;
  for (const name of names) {
    const emoji = cache.find((candidate) => String(candidate.name).toLowerCase() === name);
    if (emoji) return emoji;
  }
  return null;
}

/** Custom emoji for a spawner when the server has one, otherwise a plain emoji. */
function spawnerEmoji(guild, type) {
  const custom = findEmoji(guild, type.names);
  return custom ? `<${custom.animated ? 'a' : ''}:${custom.name}:${custom.id}>` : type.emoji;
}

/** The fire emoji used in the board title. */
function titleEmoji(guild) {
  const custom = findEmoji(guild, ['spawner_with_fire', 'spawnerwithfire', 'fire', 'firee', 'flame']);
  return custom ? `<${custom.animated ? 'a' : ''}:${custom.name}:${custom.id}>` : '🔥';
}

function spawnerByKey(key) {
  return SPAWNER_TYPES.find((type) => type.key === key) ?? null;
}

/**
 * Reads a price and checks it is a number in range with at most two decimals.
 * Returns `{ ok: true, value }` or `{ ok: false, message }` for a reply.
 */
function validatePrice(input) {
  const number = typeof input === 'number' ? input : Number(String(input ?? '').trim());
  if (!Number.isFinite(number)) {
    return { ok: false, message: 'Numbers only — for example `13`, `12.5` or `0.75`.' };
  }
  if (number < MIN_PRICE) {
    return { ok: false, message: `The smallest price is \`${MIN_PRICE}\` — for example \`0.5\`.` };
  }
  if (number > MAX_PRICE) {
    return { ok: false, message: `The largest price is \`${MAX_PRICE}\`.` };
  }

  const rounded = Math.round(number * 100) / 100;
  if (Math.abs(number - rounded) > 1e-9) {
    return {
      ok: false,
      message: `Prices can have at most **${MAX_DECIMALS} decimals** — for example \`12.5\` or \`12.75\`.`,
    };
  }
  return { ok: true, value: rounded };
}

function formatPrice(value) {
  const parsed = validatePrice(value);
  if (!parsed.ok) return null;
  return `${parsed.value.toFixed(2).replace(/\.?0+$/, '')}M`;
}

function pricesFor(settings, mode) {
  const store = settings?.spawners ?? {};
  const prices = store[mode];
  return prices && typeof prices === 'object' ? prices : {};
}

/** One board line: emoji, name, price. Returns null while no price is set. */
function priceLine(guild, settings, type, mode) {
  const price = formatPrice(pricesFor(settings, mode)[type.key]);
  if (!price) return null;
  return `${spawnerEmoji(guild, type)} ${type.label} **${price}** each`;
}

/** Rows without a price are left out entirely. */
function pricedLines(guild, settings, mode) {
  return SPAWNER_TYPES.map((type) => priceLine(guild, settings, type, mode)).filter(Boolean);
}

function section(title, lines, empty = '— no prices listed yet') {
  return `**${title}**\n${lines.length ? lines.join('\n') : empty}`;
}

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('spawner:buy')
      .setLabel('Buy Spawners')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('spawner:sell')
      .setLabel('Sell Spawners')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Success),
  );
}

/**
 * The board itself: wide container, one divider between each block, and the
 * two ticket buttons underneath.
 */
function panelPayload(guild, settings) {
  const container = new ContainerBuilder().setAccentColor(ACCENT);

  const header = [
    `-# ${toSmallCaps('buy & sell')}`,
    `# ${titleEmoji(guild)} ${toSmallCaps('Spawner Prices')}`,
    `-# ${toSmallCaps('prices in millions')} · updated <t:${Math.floor(Date.now() / 1000)}:R>`,
  ].join('\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

  const divider = () =>
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );

  divider();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      section(`🛒 ${toSmallCaps('buying')}`, pricedLines(guild, settings, 'buy')),
    ),
  );

  divider();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      section(`💰 ${toSmallCaps('selling')}`, pricedLines(guild, settings, 'sell')),
    ),
  );

  divider();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**📋 ${toSmallCaps('notes')}**`,
        '> Our prices are **NOT** negotiable',
        '> **2 by 2** at least · **8 spawner** minimum',
        '',
        `⬇️ ${toSmallCaps('open a ticket below')}`,
      ].join('\n'),
    ),
  );

  container.addActionRowComponents(panelButtons());
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(v2.signatureLine('Spawner prices')),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/** Stores one price. Returns the formatted price, or null when it is invalid. */
function applyPrice(settings, key, mode, price) {
  const type = spawnerByKey(key);
  if (!type) return null;
  if (mode !== 'buy' && mode !== 'sell') return null;

  const parsed = validatePrice(price);
  if (!parsed.ok) return null;

  if (!settings.spawners) settings.spawners = { buy: {}, sell: {}, panelChannelId: null, panelMessageId: null };
  if (!settings.spawners[mode]) settings.spawners[mode] = {};
  settings.spawners[mode][type.key] = parsed.value;

  return formatPrice(parsed.value);
}

function storedPanel(settings) {
  const panel = settings?.spawners ?? {};
  if (!panel.panelChannelId || !panel.panelMessageId) return null;
  return { channelId: panel.panelChannelId, messageId: panel.panelMessageId };
}

/** Edits the saved panel message in place, if it still exists. */
async function refreshPanel(client, guild, settings) {
  const panel = storedPanel(settings);
  if (!panel) return false;

  const channel =
    guild.channels.cache.get(panel.channelId) ??
    (await guild.channels.fetch(panel.channelId).catch(() => null));
  if (!channel?.isTextBased()) return false;

  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!message) return false;

  await message
    .edit(panelPayload(guild, settings))
    .catch((err) => console.warn('[spawners] Could not refresh the panel:', err.message));
  return true;
}

/** Posts the panel in a channel, or edits the existing one there. */
async function ensurePanel(guild, settings, store, channel) {
  const panel = storedPanel(settings);
  if (panel && panel.channelId === channel.id) {
    const existing = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (existing) {
      await existing.edit(panelPayload(guild, settings));
      return existing;
    }
  }

  const message = await channel.send(panelPayload(guild, settings));
  settings.spawners.panelChannelId = channel.id;
  settings.spawners.panelMessageId = message.id;
  store.save();
  return message;
}

function ticketIntro({ user, mode, guild, settings, channelId }) {
  const buying = mode === 'buy';
  const prices = pricedLines(guild, settings, mode);
  const lines = prices.length ? prices.join('\n') : '— no prices listed yet';

  return {
    embeds: [
      embed({
        title: buying ? '🛒 Spawner purchase ticket' : '💰 Spawner sale ticket',
        description: [
          `Hey ${user}, a member of the team will be with you shortly.`,
          '',
          buying
            ? 'Tell us **which spawners** you want and **how many**.'
            : 'Tell us **which spawners** you are selling and **how many**.',
          '**2 by 2** at least · **8 spawner** minimum · prices are **not** negotiable.',
          '',
          `**${buying ? 'Buying' : 'Selling'} prices**`,
          lines,
        ].join('\n'),
        color: buying ? COLORS.danger : COLORS.success,
        footer: 'Spawner ticket',
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:close:${channelId}`)
          .setLabel('Close ticket')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function handleButton(interaction, { store }) {
  const [, action] = String(interaction.customId).split(':');
  const mode = action === 'buy' || action === 'sell' ? action : null;
  if (!mode) return;

  const guild = interaction.guild;
  const settings = store.guild(guild.id);

  const existingId = store.openTicketFor(guild.id, interaction.user.id);
  const existing = existingId ? guild.channels.cache.get(existingId) : null;
  if (existing) {
    await interaction.reply({
      embeds: [infoEmbed('You already have an open ticket', `Head over to ${existing} to continue.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (existingId) store.removeTicket(existingId);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let channel;
  let number;
  try {
    ({ channel, number } = await createTicketChannel({
      client: interaction.client,
      guild,
      settings,
      store,
      ownerId: interaction.user.id,
      categoryId: TICKET_CATEGORY_ID,
      type: `spawner-${mode}`,
      topic: `Spawner ${mode === 'buy' ? 'purchase' : 'sale'} · <@${interaction.user.id}> (${interaction.user.id})`,
      reason: `Spawner ${mode} ticket opened by ${interaction.user.tag}`,
    }));
  } catch (err) {
    console.error('[spawners] Failed to create ticket:', err);
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'I could not create the ticket channel. Make sure I have **Manage Channels**.',
          'Ticket creation failed',
        ),
      ],
    });
    return;
  }

  const payload = ticketIntro({
    user: interaction.user,
    mode,
    guild,
    settings,
    channelId: channel.id,
  });
  await channel.send({ ...payload, allowedMentions: { parse: [] } }).catch(() => {});

  await interaction.editReply({
    embeds: [
      successEmbed(
        mode === 'buy' ? 'Purchase ticket opened' : 'Sale ticket opened',
        `Ticket #${String(number).padStart(4, '0')} is ready: ${channel}`,
      ),
    ],
  });
}

/** `!spawnerprices` — admins post or refresh the board in the current channel. */
async function handleMessage(message, { store }) {
  const content = String(message.content ?? '').trim();
  if (content !== PREFIX && !content.startsWith(`${PREFIX} `)) return;

  const guild = message.guild;
  const settings = store.guild(guild.id);

  if (!message.member?.permissions?.has('ManageGuild') && !isStaff(message.member, settings)) {
    await message
      .reply({ embeds: [errorEmbed('Only staff can post the spawner prices board.', 'Missing permissions')] })
      .catch(() => {});
    return;
  }

  if (!message.channel?.isTextBased()) return;

  const panel = await ensurePanel(guild, settings, store, message.channel).catch((err) => {
    console.error('[spawners] Could not post the board:', err);
    return null;
  });

  if (!panel) {
    await message
      .reply({ embeds: [errorEmbed('I could not post the board in this channel.', 'Post failed')] })
      .catch(() => {});
    return;
  }

  await message.delete().catch(() => {});
}

module.exports = {
  ACCENT,
  pricedLines,
  MAX_DECIMALS,
  MAX_PRICE,
  MIN_PRICE,
  MODES,
  PREFIX,
  PRICES_CHANNEL_ID,
  SPAWNER_TYPES,
  TICKET_CATEGORY_ID,
  applyPrice,
  ensurePanel,
  formatPrice,
  handleButton,
  handleMessage,
  panelPayload,
  priceLine,
  refreshPanel,
  spawnerByKey,
  spawnerEmoji,
  storedPanel,
  titleEmoji,
  ticketIntro,
  validatePrice,
};
