'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { COLORS, errorEmbed, trophyEmoji } = require('./helpers');
const { toSmallCaps } = require('./smallcaps');
const levels = require('./levels');
const v2 = require('./v2');

const PAGE_SIZE = 10;
const SAVE_DEBOUNCE_MS = 5_000;
const TYPES = ['levels', 'messages', 'voice'];
// Voice only counts while people are actually hanging out together, and it is
// deliberately slow: one point per 15 minutes keeps a long call from outrunning
// months of chatting.
const MIN_VOICE_MEMBERS = 3;
const VOICE_SECONDS_PER_POINT = 15 * 60;

/** A session's words in points — the number the voice board ranks by. */
function voicePoints(seconds) {
  return Math.floor(Math.max(0, Math.floor(Number(seconds) || 0)) / VOICE_SECONDS_PER_POINT);
}

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

/** Everyone else connected to a channel, as far as Discord's cache knows. */
function channelMembers(guild, channelId, excludeId = null) {
  const ids = new Set();
  for (const state of guild?.voiceStates?.cache?.values?.() ?? []) {
    const id = state?.id ?? state?.member?.id;
    if (!id || id === excludeId) continue;
    if (state.channelId !== channelId) continue;
    if (!state.channel || !state.member || state.member.user?.bot) continue;
    ids.add(id);
  }
  return ids;
}

/**
 * A voice session only runs while the channel holds `MIN_VOICE_MEMBERS` people,
 * so two friends in a call and someone sitting alone after everybody left earn
 * nothing. Joiners and leavers re-check the whole channel, which is why one
 * person leaving a full call stops the clock for everybody left behind.
 */
function applyGate(store, settings, guild, channelId, memberId, present, at) {
  if (!channelId) return;
  const others = channelMembers(guild, channelId, memberId);
  const total = others.size + (present ? 1 : 0);
  const counting = total >= MIN_VOICE_MEMBERS;

  if (present && counting) startVoice(store, settings, memberId, at);
  else endVoice(store, settings, memberId, at);

  for (const id of others) {
    if (counting) startVoice(store, settings, id, at);
    else endVoice(store, settings, id, at);
  }
}

function handleVoiceState(oldState, newState, { store }) {
  const guild = newState?.guild ?? oldState?.guild;
  if (!guild) return;
  const member = newState?.member ?? oldState?.member;
  const memberId = member?.id ?? newState?.id ?? oldState?.id;
  if (!member || member.user?.bot || !memberId) return;

  const settings = store.guild(guild.id);
  const channelId = settings.memberCountChannelId;
  const was = countsForVoice(oldState, channelId) ? oldState.channel.id : null;
  const is = countsForVoice(newState, channelId) ? newState.channel.id : null;
  // Mute/deafen changes and staying put never move the clock.
  if (was === is) return;

  const now = Date.now();
  if (was) applyGate(store, settings, guild, was, memberId, false, now);
  if (is) applyGate(store, settings, guild, is, memberId, true, now);
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

    const rosters = new Map();
    for (const state of guild.voiceStates?.cache?.values?.() ?? []) {
      const id = state?.id ?? state?.member?.id;
      if (!id || !state.channel || state.member?.user?.bot) continue;
      if (!countsForVoice(state, settings.memberCountChannelId)) continue;
      const ids = rosters.get(state.channelId) ?? new Set();
      ids.add(id);
      rosters.set(state.channelId, ids);
    }

    for (const ids of rosters.values()) {
      if (ids.size < MIN_VOICE_MEMBERS) continue;
      for (const id of ids) recordFor(settings, id).voiceSince = now;
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

/** Messages for one member, taking whichever counter has counted further. */
function messageCountFor(settings, userId) {
  const counted = Math.max(
    0,
    Math.floor(Number(statsStore(settings)[userId]?.messages) || 0),
  );
  const fromLevels = Math.max(
    0,
    Math.floor(Number(settings.levels?.users?.[userId]?.messages) || 0),
  );
  return Math.max(counted, fromLevels);
}

/** Their place on one board (1-based), or null when they are not ranked. */
function positionOn(settings, type, userId) {
  const index = entriesFor(settings, type).findIndex((entry) => entry.id === userId);
  return index === -1 ? null : index + 1;
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
      .map(([id, record]) => {
        const seconds = Math.max(0, Math.floor(Number(record?.voiceSeconds) || 0));
        return { id, value: voicePoints(seconds), seconds };
      })
      // Under 15 minutes is not a point yet, so nobody is ranked on 0.
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value || b.seconds - a.seconds || a.id.localeCompare(b.id));
  }

  // The level store has counted messages since the bot was installed, so the
  // chat board starts with that history instead of an empty page.
  const counted = statsStore(settings);
  const levelUsers = settings.levels?.users ?? {};
  const ids = new Set([...Object.keys(counted), ...Object.keys(levelUsers)]);

  return [...ids]
    .map((id) => ({ id, value: messageCountFor(settings, id) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
}

/** The value half of a row: `Level 7 · 2,500 XP`, `900 messages`, `2h in voice`. */
function detailFor(entry, type) {
  if (type === 'levels') {
    return `**Level ${entry.level}** · ${entry.value.toLocaleString('en-US')} XP`;
  }
  if (type === 'messages') {
    return `**${entry.value.toLocaleString('en-US')}** messages`;
  }
  return `**${entry.value} pt${entry.value === 1 ? '' : 's'}** · ${formatVoice(entry.seconds)} in voice`;
}

function lineFor(entry, place, type) {
  const medals = ['🥇', '🥈', '🥉'];
  const placeLabel = medals[place - 1] ?? `\`#${place}\``;
  return `${placeLabel} <@${entry.id}> · ${detailFor(entry, type)}`;
}

/**
 * Where the viewer sits on this board when they are not on the page in front
 * of them, so paging through a big server still tells everyone their place.
 * Returns null when their row is already visible.
 */
function viewerLine(all, type, viewerId, start) {
  if (!viewerId) return null;
  const index = all.findIndex((entry) => entry.id === viewerId);
  if (index === -1) return '📍 **Your rank** · not ranked on this board yet';
  const place = index + 1;
  if (place > start && place <= start + PAGE_SIZE) return null;
  return `📍 **Your rank** · \`#${place}\` ${detailFor(all[index], type)}`;
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
function card(guild, settings, { type = 'levels', page = 1, viewerId = null } = {}) {
  const safeType = TYPES.includes(type) ? type : 'levels';
  const all = entriesFor(settings, safeType);
  const pageCount = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = all.slice(start, start + PAGE_SIZE);

  const description = slice.length
    ? slice.map((entry, index) => lineFor(entry, start + index + 1, safeType)).join('\n')
    : '> 🌱 Nothing tracked yet — start chatting or hop in voice!';
  const mine = viewerLine(all, safeType, viewerId, start);

  return v2.card({
    accent: COLORS.brand,
    kicker: toSmallCaps('scoreboard'),
    title: `${trophyEmoji(guild)} ${BOARDS[safeType].title}`,
    subtitle: `${all.length} member${all.length === 1 ? '' : 's'} · page ${safePage}/${pageCount}`,
    description,
    sections: mine ? [mine] : [],
    footer: guild?.name,
    thumbnail: guild?.iconURL?.({ size: 256 }) ?? undefined,
    buttons: rowsFor(safeType, safePage, pageCount),
  });
}

/** `#12` on a board, or `unranked` when they have no activity there yet. */
function placeLabel(place) {
  return place ? `#${place}` : 'unranked';
}

/**
 * One member's whole activity picture: level and XP, messages and voice
 * points, each with their place on that board.
 */
function memberCard(guild, settings, member) {
  const userId = member?.id;
  const totalXp = Math.max(0, Math.floor(Number(settings.levels?.users?.[userId]?.xp) || 0));
  const { level, xpIntoLevel, xpForNext } = levels.levelFromXp(totalXp);
  const voiceSeconds = Math.max(
    0,
    Math.floor(Number(statsStore(settings)[userId]?.voiceSeconds) || 0),
  );
  const points = voicePoints(voiceSeconds);
  const messages = messageCountFor(settings, userId);

  return v2.card({
    accent: COLORS.brand,
    kicker: toSmallCaps('activity'),
    title: `LEVEL ${level}`,
    subtitle: member?.user?.username ?? 'Member',
    stats: [
      {
        emoji: '✨',
        label: 'XP',
        value: `${totalXp.toLocaleString('en-US')} · ${placeLabel(positionOn(settings, 'levels', userId))}`,
      },
      {
        emoji: '💬',
        label: 'Messages',
        value: `${messages.toLocaleString('en-US')} · ${placeLabel(
          positionOn(settings, 'messages', userId),
        )}`,
      },
      {
        emoji: '🔊',
        label: 'Voice',
        value: `${points} pt${points === 1 ? '' : 's'} · ${formatVoice(voiceSeconds)} · ${placeLabel(
          positionOn(settings, 'voice', userId),
        )}`,
      },
    ],
    progress: {
      percent: xpForNext ? (xpIntoLevel / xpForNext) * 100 : 0,
      emoji: '📈',
      label: `${xpIntoLevel.toLocaleString('en-US')}/${xpForNext.toLocaleString(
        'en-US',
      )} XP to level ${level + 1}`,
    },
    thumbnail: member?.displayAvatarURL?.({ size: 256 }) ?? member?.user?.displayAvatarURL?.(),
    footer: guild?.name,
  });
}

/**
 * Replies with one member's activity card, defaulting to whoever asked. Shared
 * by `/rank` and `/activity rank` so both always render the same thing.
 */
async function replyWithMemberCard(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  const user = interaction.options.getUser('user') ?? interaction.user;
  const member =
    (await guild.members.fetch(user.id).catch(() => null)) ??
    guild.members.cache.get(user.id) ??
    null;

  if (!member) {
    await interaction.reply({
      embeds: [errorEmbed(`${user} is not a member of this server.`, 'Not a member')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return null;
  }

  const payload = {
    ...v2.ephemeral(memberCard(guild, settings, member)),
    allowedMentions: { parse: [] },
  };
  await interaction.reply(payload);
  return payload;
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
  MIN_VOICE_MEMBERS,
  PAGE_SIZE,
  TYPES,
  VOICE_SECONDS_PER_POINT,
  card,
  channelMembers,
  countsForVoice,
  endVoice,
  detailFor,
  entriesFor,
  ephemeralCard,
  flushVoiceSessions,
  formatVoice,
  handleMessage,
  handleVoiceState,
  memberCard,
  messageCountFor,
  positionOn,
  recordFor,
  recordMessage,
  replyWithMemberCard,
  scheduleSave,
  startVoice,
  statsStore,
  syncVoiceSessions,
  viewerLine,
  voicePoints,
};
