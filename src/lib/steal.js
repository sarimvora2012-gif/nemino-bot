'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, COLORS } = require('./helpers');
const { toSmallCaps } = require('./smallcaps');

const PREFIX = '!steal';
const SHOW_MS = 3000;
const ERROR_MS = 10_000;
const MAX_EMOJI_BYTES = 256 * 1024; // Discord's hard limit for a single emoji
const MAX_NAME = 32;

/** `<:name:id>` and `<a:name:id>` — how a custom emoji appears in raw message text. */
const EMOJI_PATTERN = /<(a?):([A-Za-z0-9_]{2,32}):(\d{15,20})>/;
/** Also accept a pasted CDN link, e.g. https://cdn.discordapp.com/emojis/123.gif */
const CDN_PATTERN = /(?:https?:\/\/)?cdn\.discordapp\.com\/emojis\/(\d{15,20})\.(gif|png|webp|jpe?g)/i;

/**
 * Reads a `!steal` message.
 * Returns `{ action: 'steal', emoji }`, `{ action: 'usage' }`, or null when it is not this command.
 */
function parseStealCommand(content) {
  const raw = String(content ?? '').trim();
  if (!new RegExp(`^${PREFIX}(\\s|$)`, 'i').test(raw)) return null;

  const rest = raw.slice(PREFIX.length).trim();

  const emoji = rest.match(EMOJI_PATTERN);
  if (emoji) {
    return {
      action: 'steal',
      emoji: { animated: emoji[1].toLowerCase() === 'a', name: emoji[2], id: emoji[3] },
    };
  }

  const cdn = rest.match(CDN_PATTERN);
  if (cdn) {
    return {
      action: 'steal',
      emoji: {
        animated: cdn[2].toLowerCase() === 'gif',
        name: `stolen_${cdn[1].slice(-6)}`,
        id: cdn[1],
      },
    };
  }

  return { action: 'usage', empty: rest.length === 0 };
}

/** Discord only allows A-Z, a-z, 0-9 and underscores, and at least 2 characters. */
function safeName(input) {
  const cleaned = String(input ?? '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = cleaned || 'stolen';
  return base.length < 2 ? `${base}_` : [...base].slice(0, MAX_NAME).join('');
}

/** Adds a `_2`, `_3`, … suffix when the server already has an emoji with that name. */
function uniqueName(base, taken = new Set()) {
  const used = new Set([...taken].filter(Boolean).map((name) => String(name).toLowerCase()));
  const root = [...safeName(base)].slice(0, MAX_NAME).join('');
  if (!used.has(root.toLowerCase())) return root;

  for (let index = 2; index < 100; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${[...root].slice(0, MAX_NAME - suffix.length).join('')}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }

  const fallback = `_${Math.floor(Math.random() * 90) + 10}`;
  return `${[...root].slice(0, MAX_NAME - fallback.length).join('')}${fallback}`;
}

async function download(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, url, size: buffer.length };
  } catch {
    return null;
  }
}

/**
 * Fetches the emoji image from Discord's public CDN (works for emojis from
 * servers this bot has never joined). Animated emojis over the size limit fall
 * back to their static frame so the steal still succeeds.
 */
async function downloadEmojiImage(emoji) {
  const base = `https://cdn.discordapp.com/emojis/${emoji.id}`;

  if (emoji.animated) {
    const gif = await download(`${base}.gif?size=128`);
    if (gif && gif.size <= MAX_EMOJI_BYTES) return gif;
    const png = await download(`${base}.png?size=128`);
    if (png) return png;
    return gif;
  }

  return (
    (await download(`${base}.png?size=128`)) ?? (await download(`${base}.webp?size=128`))
  );
}

/** Replies to the command and removes both messages, so the channel stays clean. */
async function replyAndClean(message, payload, delay) {
  const sent = await message
    .reply({ ...payload, allowedMentions: { parse: [] } })
    .catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), delay).unref?.();
  await message.delete().catch(() => {});
}

function successCard(created, animated, totalEmojis) {
  return embed({
    title: '🎨 Emoji stolen!',
    description: [
      `${created} **${created.name}** joined the server`,
      `-# ${animated ? '🧵 animated' : '🖼️ static'} · ${totalEmojis} emojis in this server`,
    ].join('\n'),
    color: COLORS.success,
    thumbnail: created.imageURL({ size: 256 }),
    footer: toSmallCaps('emoji theft'),
  });
}

async function handleMessage(message, context) {
  const guild = message.guild;
  if (!guild || message.author?.bot) return;

  const parsed = parseStealCommand(message.content);
  if (!parsed) return;

  const deny = (description, title = 'Missing permissions') =>
    replyAndClean(message, { embeds: [errorEmbed(description, title)] }, ERROR_MS);

  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));

  if (!member?.permissions?.has(PermissionFlagsBits.ManageGuildExpressions)) {
    await deny('You need **Manage Expressions** (Administrator works too) to steal emojis.');
    return;
  }

  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageGuildExpressions)) {
    await deny('Give me **Manage Expressions** so I can add stolen emojis to this server.');
    return;
  }

  if (parsed.action === 'usage') {
    await deny(
      parsed.empty
        ? [
            'Paste the emoji right after the command: `!steal :funnycat:`',
            'Custom emojis from **any** server work — type or paste the emoji itself, not the image link.',
          ].join('\n')
        : [
            'That is not a custom emoji, so there is nothing to copy.',
            'Only custom emojis (`:name:` from a server) can be stolen — standard emojis like 😀 already exist everywhere.',
          ].join('\n'),
      'Nothing to steal',
    );
    return;
  }

  const image = await downloadEmojiImage(parsed.emoji);
  if (!image) {
    await deny(
      [
        `I could not download that emoji (\`${parsed.emoji.id}\`).`,
        'It may have been deleted, or the server that owns it no longer exists.',
      ].join('\n'),
      'Emoji unavailable',
    );
    return;
  }

  if (image.size > MAX_EMOJI_BYTES) {
    await deny(
      `That emoji is ${Math.round(image.size / 1024)} KB — Discord only allows emojis up to 256 KB.`,
      'Emoji too large',
    );
    return;
  }

  const name = uniqueName(
    safeName(parsed.emoji.name),
    new Set(guild.emojis.cache.map((emoji) => emoji.name)),
  );

  let created;
  try {
    created = await guild.emojis.create({
      attachment: image.buffer,
      name,
      reason: `!steal by ${message.author.tag}`,
    });
  } catch (err) {
    console.error('[steal] Failed to create the emoji:', err);
    const full = /maximum|limit|size/i.test(err.message ?? '');
    await deny(
      full
        ? 'This server has no emoji slots left. Delete a few emojis and try again.'
        : `Discord rejected the emoji: ${err.message}`,
      'Steal failed',
    );
    return;
  }

  await replyAndClean(
    message,
    { embeds: [successCard(created, parsed.emoji.animated, guild.emojis.cache.size)] },
    SHOW_MS,
  );
}

module.exports = {
  PREFIX,
  SHOW_MS,
  MAX_EMOJI_BYTES,
  handleMessage,
  parseStealCommand,
  safeName,
  uniqueName,
};
