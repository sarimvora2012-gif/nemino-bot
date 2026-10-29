'use strict';

const { COLORS } = require('./helpers');
const { toSmallCaps } = require('./smallcaps');
const v2 = require('./v2');

const SAVE_DEBOUNCE_MS = 5_000;
const MAX_LEVEL = 500;

let saveTimer = null;

/**
 * XP required to move from `level` to the next one.
 * 100, 155, 220, 295 … so early levels feel quick and later ones stretch.
 */
function xpForLevel(level) {
  const safe = Math.max(0, Math.floor(level));
  return 5 * safe * safe + 50 * safe + 100;
}

/** Total XP needed to *reach* a level, i.e. the sum of every step below it. */
function totalXpForLevel(level) {
  let total = 0;
  for (let i = 0; i < Math.max(0, Math.floor(level)); i += 1) total += xpForLevel(i);
  return total;
}

/** Splits total XP into a level plus progress towards the next one. */
function levelFromXp(totalXp) {
  let level = 0;
  let remaining = Math.max(0, Math.floor(Number(totalXp) || 0));

  while (level < MAX_LEVEL) {
    const needed = xpForLevel(level);
    if (remaining < needed) {
      return { level, xpIntoLevel: remaining, xpForNext: needed, totalXp: Math.max(0, Math.floor(Number(totalXp) || 0)) };
    }
    remaining -= needed;
    level += 1;
  }

  return {
    level: MAX_LEVEL,
    xpIntoLevel: 0,
    xpForNext: xpForLevel(MAX_LEVEL),
    totalXp: Math.max(0, Math.floor(Number(totalXp) || 0)),
  };
}

function recordFor(settings, userId) {
  settings.levels.users = settings.levels.users ?? {};
  const record = settings.levels.users[userId] ?? { xp: 0, messages: 0, lastAt: 0 };
  settings.levels.users[userId] = record;
  return record;
}

/** Every ranked member, most XP first. Ties go to whoever has more messages. */
function entries(settings, limit = 10) {
  return Object.entries(settings.levels?.users ?? {})
    .map(([id, record]) => ({
      id,
      xp: Math.max(0, Math.floor(Number(record.xp) || 0)),
      messages: Math.max(0, Math.floor(Number(record.messages) || 0)),
    }))
    .filter((entry) => entry.xp > 0 || entry.messages > 0)
    .sort((a, b) => b.xp - a.xp || b.messages - a.messages)
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, position: index + 1 }));
}

/** The member's place on the leaderboard (1-based), or null when unranked. */
function positionOf(settings, userId) {
  const all = entries(settings, Number.MAX_SAFE_INTEGER);
  return all.find((entry) => entry.id === userId)?.position ?? null;
}

function randomXp(settings) {
  const min = Math.max(1, Math.floor(Number(settings.levels.xpMin) || 1));
  const max = Math.max(min, Math.floor(Number(settings.levels.xpMax) || min));
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Writes to disk at most once every few seconds instead of per message. */
function scheduleSave(store) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      store.save();
    } catch (err) {
      console.error('[levels] Could not save XP:', err.message);
    }
  }, SAVE_DEBOUNCE_MS);
  saveTimer.unref?.();
}

function rankCard(guild, settings, member) {
  const record = recordFor(settings, member.id);
  const { level, xpIntoLevel, xpForNext, totalXp } = levelFromXp(record.xp);
  const position = positionOf(settings, member.id);
  const percent = xpForNext ? (xpIntoLevel / xpForNext) * 100 : 100;

  return v2.card({
    accent: COLORS.brand,
    kicker: toSmallCaps('levels'),
    title: `LEVEL ${level}`,
    subtitle: `${member.user.username}${position ? ` · rank #${position}` : ''}`,
    stats: [
      { emoji: '✨', label: 'XP', value: `${totalXp.toLocaleString('en-US')}` },
      { emoji: '💬', label: 'Messages', value: `${record.messages.toLocaleString('en-US')}` },
    ],
    progress: {
      percent,
      emoji: '📈',
      label: `${xpIntoLevel.toLocaleString('en-US')}/${xpForNext.toLocaleString('en-US')} XP · ${(xpForNext - xpIntoLevel).toLocaleString('en-US')} to go`,
    },
    thumbnail: member.displayAvatarURL?.({ size: 256 }) ?? member.user.displayAvatarURL?.(),
    footer: guild.name,
  });
}

function levelUpCard(guild, member, level, xpIntoLevel, xpForNext) {
  return v2.card({
    accent: COLORS.success,
    kicker: toSmallCaps('level up'),
    title: `🎉 LEVEL ${level}`,
    subtitle: `${member}`,
    progress: {
      percent: xpForNext ? (xpIntoLevel / xpForNext) * 100 : 0,
      emoji: '📈',
      label: `${xpIntoLevel}/${xpForNext} XP to level ${level + 1}`,
    },
    thumbnail: member.displayAvatarURL?.({ size: 256 }),
    footer: guild.name,
  });
}

/**
 * Awards XP for one message. Returns what changed so the caller can log it,
 * or null when the message does not earn anything.
 */
function awardMessage(message, store) {
  const guild = message.guild;
  if (!guild || message.author?.bot) return null;

  const settings = store.guild(guild.id);
  const levels = settings.levels;
  if (!levels.enabled) return null;
  if (message.channel?.isDMBased?.() || !message.channel?.isTextBased?.()) return null;

  const record = recordFor(settings, message.author.id);
  record.messages = (Number(record.messages) || 0) + 1;

  const cooldownMs = Math.max(0, Number(levels.cooldownSeconds) || 0) * 1000;
  const now = Date.now();
  if (cooldownMs && now - (Number(record.lastAt) || 0) < cooldownMs) {
    scheduleSave(store);
    return null;
  }

  record.lastAt = now;
  const before = levelFromXp(record.xp).level;
  const gained = randomXp(settings);
  record.xp = Math.max(0, Math.floor(Number(record.xp) || 0)) + gained;
  const after = levelFromXp(record.xp);
  scheduleSave(store);

  return { gained, levelUp: after.level > before ? after : null, record };
}

/**
 * Message handler: awards XP and posts the level-up card when a level is gained.
 * Never throws into the gateway handler.
 */
async function handleMessage(message, { store }) {
  const result = awardMessage(message, store);
  if (!result?.levelUp) return;

  const settings = store.guild(message.guild.id);
  if (!settings.levels.announce) return;

  const channelId = settings.levels.announceChannelId ?? message.channel.id;
  const channel =
    message.guild.channels.cache.get(channelId) ??
    (await message.guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased?.()) return;

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;

  const { level, xpIntoLevel, xpForNext } = result.levelUp;
  await channel
    .send({
      ...levelUpCard(message.guild, member, level, xpIntoLevel, xpForNext),
      allowedMentions: { parse: [], users: [member.id], roles: [] },
    })
    .catch((err) => console.error('[levels] Could not post the level-up card:', err.message));
}

/** XP edits a member's total directly (used to port levels from another bot). */
function setXp(store, guildId, userId, xp) {
  const settings = store.guild(guildId);
  const record = recordFor(settings, userId);
  record.xp = Math.max(0, Math.floor(Number(xp) || 0));
  store.save();
  return levelFromXp(record.xp);
}

module.exports = {
  MAX_LEVEL,
  SAVE_DEBOUNCE_MS,
  awardMessage,
  entries,
  handleMessage,
  levelFromXp,
  levelUpCard,
  positionOf,
  randomXp,
  rankCard,
  recordFor,
  scheduleSave,
  setXp,
  totalXpForLevel,
  xpForLevel,
};
