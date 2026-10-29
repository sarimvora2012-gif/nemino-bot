'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { COLORS, trophyEmoji } = require('./helpers');
const { toSmallCaps } = require('./smallcaps');
const levels = require('./levels');
const v2 = require('./v2');

const PAGE_SIZE = 10;
const SAVE_DEBOUNCE_MS = 5_000;
const TYPES = ['levels', 'messages', 'voice'];

let saveTimer = null;

/** Titles and labels, so every board in the switcher looks like one family. */
const BOARDS = {
  levels: { title: 'TOP MEMBERS', emoji: '📈', label: 'levels' },
  messages: { title: 'TOP CHATTERS', emoji: '💬', label: 'messages' },
  voice: { title: 'TOP VOICE', emoji: '🔊', label: 'voice' },
};

/** Per-member activity counters: messages sent and seconds spent in voice. */
function statsStore(settings) {
  settings.activityStats = settings.activityStats ?? {};
  settings.activityStats.users = settings.activityStats.users ?? {};
  return settings.activityStats.users;
}

function recordFor(settings, userId) {
  const users = statsStore(settings);
  if (!users[userId]) users[userId] = { messages: 0, voiceSeconds: 0, voiceSince: null };
  const record = users[userId];
  record.messages = Math.max(0, Math.floor(Number(record.messages) || 0));
  record.voiceSeconds = Math.max(0, Math.floor(Number(record.voiceSeconds) || 0));
  if (!record.voiceSince) record.voiceSince = null;
  return record;
}

/** Writes to disk at most once every few seconds instead of per message. */
function scheduleSave(store) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      store.save();
    } catch (err) {
      console.error('[scoreboard] Could not save activity:', err.message);
    }
  }, SAVE_DEBOUNCE_MS);
  saveTimer.unref?.();
}

// ---- Counting -------------------------------------------------------------

/** One message for that member. Bots and DMs never reach here. */
function recordMessage(store, guildId, userId) {
  if (!guildId || !userId) return null;
  const settings = store.guild(guildId);
  const record = recordFor(settings, userId);
  record.messages += 1;
  scheduleSave(store);
  return record;
}

/**
 * Voice sessions are stored as a start time, so a session that runs for hours
 * costs nothing until it ends. AFK and the member-counter channel do not count.
 */
function countsForVoice(state, memberCountChannelId) {
  if (!state?.channel) return false;
  if (memberCountChannelId && state.channel.id === memberCountChannelId) return false;
  if (state.guild?.afkChannelId && state.channel.id === state.guild.afkChannelId) return false;
  return true;
}

function startVoice(store, settings, userId, at) {
  const record = recordFor(settings, userId);
  if (record.voiceSince) return false;
  record.voiceSince = at;
  scheduleSave(store);
  return true;
}

function endVoice(store, settings, userId, at) {
  const record = recordFor(settings, userId);
  if (!record.voiceSince) return 0;
  const seconds = Math.max(0, Math.round((at - Number(record.voiceSince)) / 1000));
  record.voiceSeconds += seconds;
  record.voiceSince = null;
  scheduleSave(store);
  return seconds;
}

function handleVoiceState(oldState, newState, { store }) {
  const guild = newState?.guild ?? oldState?.guild;
  if (!guild) return;
  const member = newState?.member ?? oldState?.member;
  if (!member || member.user?.bot) return;

  const settings = store.guild(guild.id);
  const channelId = settings.memberCountChannelId;
  const was = countsForVoice(oldState, channelId);
  const is = countsForVoice(newState, channelId);
  // Moving between two countable channels is one continuous session.
  if (was === is) return;

  const now = Date.now();
  if (is) startVoice(store, settings, member.id, now);
  else endVoice(store, settings, member.id, now);
}

/**
 * On startup every session from the previous run is finished at unknown times,
 * so it is closed at boot and reopened for whoever is connected right now.
 */
function syncVoiceSessions(client, store) {
  const now = Date.now();
  for (const guild of client?.guilds?.cache?.values?.() ?? []) {
    const settings = store.guild(guild.id);
    for (const record of Object.values(statsStore(settings))) record.voiceSince = null;

    for (const state of guild.voiceStates?.cache?.values?.() ?? []) {
      if (!state?.member || state.member.user?.bot) continue;
      if (!countsForVoice(state, settings.memberCountChannelId)) continue;
      recordFor(settings, state.member.id).voiceSince = now;
    }
  }
  try {
    store.save();
  } catch (err) {
    console.error('[scoreboard] Could not save voice sessions:', err.message);
  }
}

/** Closes every open session, so a shutdown does not lose the hours so far. */
function flushVoiceSessions(store) {
  const now = Date.now();
  for (const settings of Object.values(store.data?.guilds ?? {})) {
    for (const [userId, record] of Object.entries(statsStore(settings))) {
      if (record.voiceSince) endVoice(store, settings, userId, now);
    }
  }
}

// ---- Reading --------------------------------------------------------------

function formatVoice(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  if (minutes) return `${minutes}m`;
  return total > 0 ? '<1m' : '0m';
}

/** Every ranked member for one board, best first. */
function entriesFor(settings, type) {
  if (type === 'levels') {
    return levels
      .entries(settings, Number.MAX_SAFE_INTEGER)
      .map((entry) => ({
        id: entry.id,
        value: entry.xp,
        level: levels.levelFromXp(entry.xp).level,
      }));
  }

  if (type === 'voice') {
    return Object.entries(statsStore(settings))
      .map(([id, record]) => ({
        id,
        value: Math.max(0, Math.floor(Number(record?.voiceSeconds) || 0)),
      }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  }

  // The level store has counted messages since the bot was installed, so the
  // chat board starts with that history instead of an empty page.
  const counted = statsStore(settings);
  const levelUsers = settings.levels?.users ?? {};
  const ids = new Set([...Object.keys(counted), ...Object.keys(levelUsers)]);

  return [...ids]
    .map((id) => ({
      id,
      value: Math.max(
        Math.max(0, Math.floor(Number(counted[id]?.messages) || 0)),
        Math.max(0, Math.floor(Number(levelUsers[id]?.messages) || 0)),
      ),
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
}

function lineFor(entry, place, type) {
  const medals = ['🥇', '🥈', '🥉'];
  const placeLabel = medals[place - 1] ?? `\`#${place}\``;
  if (type === 'levels') {
    return `${placeLabel} <@${entry.id}> · **Level ${entry.level}** · ${entry.value.toLocaleString('en-US')} XP`;
  }
  if (type === 'messages') {
    return `${placeLabel} <@${entry.id}> · **${entry.value.toLocaleString('en-US')}** messages`;
  }
  return `${placeLabel} <@${entry.id}> · **${formatVoice(entry.value)}** in voice`;
}

function tabButton(type, current) {
  const board = BOARDS[type];
  return new ButtonBuilder()
    .setCustomId(`scoreboard:${type}:1`)
    .setLabel(toSmallCaps(board.label))
    .setEmoji(board.emoji)
    .setStyle(type === current ? ButtonStyle.Primary : ButtonStyle.Secondary);
}

function rowsFor(type, page, pageCount) {
  return [
    new ActionRowBuilder().addComponents(TYPES.map((name) => tabButton(name, type))),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scoreboard:${type}:${page - 1}`)
        .setLabel(toSmallCaps('back'))
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`scoreboard:${type}:${page + 1}`)
        .setLabel(toSmallCaps('next'))
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount),
    ),
  ];
}

/**
 * One scoreboard card. `type` picks the board and `page` walks through every
 * ranked member ten at a time, so nobody is cut off at the top ten.
 */
function card(guild, settings, { type = 'levels', page = 1 } = {}) {
  const safeType = TYPES.includes(type) ? type : 'levels';
  const all = entriesFor(settings, safeType);
  const pageCount = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = all.slice(start, start + PAGE_SIZE);

  const description = slice.length
    ? slice.map((entry, index) => lineFor(entry, start + index + 1, safeType)).join('\n')
    : '> 🌱 Nothing tracked yet — start chatting or hop in voice!';

  return v2.card({
    accent: COLORS.brand,
    kicker: toSmallCaps('scoreboard'),
    title: `${trophyEmoji(guild)} ${BOARDS[safeType].title}`,
    subtitle: `${all.length} member${all.length === 1 ? '' : 's'} · page ${safePage}/${pageCount}`,
    description,
    footer: guild?.name,
    thumbnail: guild?.iconURL?.({ size: 256 }) ?? undefined,
    buttons: rowsFor(safeType, safePage, pageCount),
  });
}

/** A scoreboard card only the person who ran the command can page through. */
function ephemeralCard(guild, settings, options) {
  return {
    ...card(guild, settings, options),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

/** MessageCreate hook: counts the message for the chat leaderboard. */
function handleMessage(message, { store }) {
  if (!message?.guild || message.author?.bot) return;
  if (message.channel?.isDMBased?.()) return;
  recordMessage(store, message.guild.id, message.author.id);
}

module.exports = {
  BOARDS,
  PAGE_SIZE,
  TYPES,
  card,
  countsForVoice,
  endVoice,
  entriesFor,
  ephemeralCard,
  flushVoiceSessions,
  formatVoice,
  handleMessage,
  handleVoiceState,
  recordFor,
  recordMessage,
  scheduleSave,
  startVoice,
  statsStore,
  syncVoiceSessions,
};
