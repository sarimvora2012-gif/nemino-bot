'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, COLORS } = require('./helpers');
const { isOwnerOrCoOwner } = require('./roles');

const PREFIX = '!purge';
const STAFF_CAP = 50; // normal staff per command
const OWNER_CAP = 1000; // Discord's own ceiling for one purge
const BATCH = 100; // Discord accepts at most 100 ids per bulk delete
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
const CONFIRM_MS = 5000;

/** Reads the amount from `!purge 100`. Whole numbers only. */
function parseAmount(input) {
  const text = String(input ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** The most this member may remove in one command. */
function capFor(member, guild) {
  return isOwnerOrCoOwner(member, guild) ? OWNER_CAP : STAFF_CAP;
}

/**
 * Walks the channel history newest-first until `amount` messages are held.
 * Fetching one page only would cap every purge at Discord's 100-per-request.
 */
async function collect(channel, amount) {
  const found = [];
  let before;

  while (found.length < amount) {
    const want = Math.min(BATCH, amount - found.length);
    const batch = await channel.messages.fetch({ limit: want, ...(before ? { before } : {}) });
    if (!batch?.size) break;

    found.push(...batch.values());
    before = batch.last().id;
    if (batch.size < want) break;
  }

  return found;
}

function chunksOf(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
}

async function handleMessage(message) {
  const content = String(message.content ?? '').trim();
  const lower = content.toLowerCase();
  if (lower !== PREFIX && !lower.startsWith(`${PREFIX} `)) return;

  const guild = message.guild;
  const channel = message.channel;
  if (!guild || !channel?.isTextBased?.()) return;
  const silent = { parse: [], users: [], roles: [] };
  const reply = (payload) => message.reply({ ...payload, allowedMentions: silent });

  if (!message.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
    await reply({
      embeds: [errorEmbed('You need **Manage Messages** to purge.', 'Missing permissions')],
    });
    return;
  }

  const amount = parseAmount(content.slice(PREFIX.length).trim());
  if (!amount) {
    await reply({
      embeds: [
        errorEmbed(
          'Usage: `!purge 25` — a number of messages to remove. Messages older than 14 days are kept.',
          'How many?',
        ),
      ],
    });
    return;
  }

  const cap = capFor(message.member, guild);
  if (amount > cap) {
    await reply({
      embeds: [
        errorEmbed(
          cap === STAFF_CAP
            ? `Staff can remove up to **${STAFF_CAP}** messages at a time. Ask an owner or co-owner for a bigger purge.`
            : `Discord caps one purge at **${OWNER_CAP}** messages — run the command again for the rest.`,
          'Too many',
        ),
      ],
    });
    return;
  }

  // The command itself is not part of the count; it is removed at the end.
  const history = (await collect(channel, amount + 1))
    .filter((entry) => entry.id !== message.id)
    .slice(0, amount);
  const cutoff = Date.now() - TWO_WEEKS;
  const fresh = history.filter((entry) => entry.createdTimestamp > cutoff);
  const stale = history.length - fresh.length;

  let deleted = 0;
  for (const chunk of chunksOf(fresh, BATCH)) {
    const removed = await channel.bulkDelete(chunk, false).catch((err) => {
      console.error('[purge] Bulk delete failed:', err.message);
      return null;
    });
    if (!removed) break;
    deleted += removed.size ?? chunk.length;
  }

  await message.delete().catch(() => {});

  const lines = [`**Deleted:** ${deleted}`];
  if (stale) lines.push(`**Skipped:** ${stale} older than 14 days (Discord keeps those)`);
  if (deleted < amount && !stale) lines.push('**Note:** the channel ran out of messages');

  const confirmation = await channel
    .send({
      embeds: [embed({ title: '🧹 Purged', description: lines.join('\n'), color: COLORS.success, footer: `by ${message.author.username}` })],
      allowedMentions: { parse: [] },
    })
    .catch(() => null);

  if (confirmation) {
    setTimeout(() => confirmation.delete().catch(() => {}), CONFIRM_MS).unref?.();
  }
}

module.exports = {
  PREFIX,
  STAFF_CAP,
  OWNER_CAP,
  capFor,
  chunksOf,
  collect,
  handleMessage,
  parseAmount,
};
