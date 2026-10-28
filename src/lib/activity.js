'use strict';

const { Routes } = require('discord.js');
const { embed, sendLog, COLORS } = require('./helpers');
const v2 = require('./v2');
const { toSmallCaps } = require('./smallcaps');

const CHECK_EMOJI = '✅';
const DEFAULT_LOA_ROLE_ID = '1539905285789982781';
const TICK_MS = 30_000;
const AUTO_MIN_INTERVAL = 60 * 60;
const MEMBER_FETCH_TIMEOUT_MS = 20_000;

const EDIT_MIN_GAP_MS = 2_000;

let scheduler = null;
let ticking = false;
const refreshTimers = new Map();
const lastEditAt = new Map();

/**
 * Reads `30s`, `10m`, `12h`, `3d` or `1w`. `minSeconds` defaults to one
 * minute for activity checks; giveaways pass 1 so seconds are allowed.
 */
function parseDuration(input, { minSeconds = 60 } = {}) {
  const match = String(input ?? '')
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(s|m|h|d|w)$/);
  if (!match) {
    throw new Error('Use a time with a unit, for example 30s, 30m, 12h, 48h or 7d.');
  }
  const amount = Number(match[1]);
  const units = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  const seconds = amount * units[match[2]];
  if (!Number.isFinite(seconds) || seconds < minSeconds) {
    throw new Error(`The time must be at least ${formatDuration(minSeconds)}.`);
  }
  if (seconds > 365 * 86400) {
    throw new Error('The time must be 365 days or less.');
  }
  return seconds;
}

function formatDuration(seconds, { seconds: showSeconds = false } = {}) {
  let remaining = Math.max(0, Math.floor(seconds));
  const parts = [];
  for (const [label, size] of [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ]) {
    if (remaining >= size) {
      parts.push(`${Math.floor(remaining / size)}${label}`);
      remaining %= size;
    }
  }
  if (!parts.length) parts.push(`${remaining}s`);
  // Giveaways ask for second precision so a 90s window does not read as 1m.
  else if (showSeconds && remaining > 0) parts.push(`${remaining}s`);
  return parts.join(' ');
}

function getLoaRoleId(settings) {
  return settings.activity.loaRoleId || DEFAULT_LOA_ROLE_ID;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function memberFetchError(err) {
  const code = err?.code ?? err?.rawError?.code;
  if (code === 50001 || /missing access/i.test(err?.message ?? '')) {
    return new Error(
      'Discord is blocking the member list. Enable **Server Members Intent** in the Developer Portal → Bot → Privileged Gateway Intents, then try again.',
    );
  }
  return new Error(`I could not fetch the server members: ${err.message}`);
}

/**
 * Reads the member list through the REST API instead of the gateway member
 * chunking flow. That flow can wait forever when the Server Members Intent is
 * off, which made `/activity start` sit on “loading”.
 */
async function fetchGuildMembers(guild) {
  const members = new Map();
  let after = '0';

  for (let page = 0; page < 50; page += 1) {
    let batch;
    try {
      batch = await guild.client.rest.get(Routes.guildMembers(guild.id), {
        query: new URLSearchParams({ limit: '1000', after }),
      });
    } catch (err) {
      throw memberFetchError(err);
    }

    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const member of batch) {
      members.set(member.user.id, {
        id: member.user.id,
        bot: Boolean(member.user.bot),
        roles: member.roles ?? [],
      });
    }
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }

  return members;
}

async function fetchStaffSnapshot(guild, settings) {
  if (!settings.staffRoleId) {
    throw new Error('Set a staff role first with `/config set staff_role:@role`.');
  }
  if (!guild.roles.cache.get(settings.staffRoleId)) {
    throw new Error('The configured staff role no longer exists. Set it again with `/config set staff_role:@role`.');
  }

  const members = await withTimeout(
    fetchGuildMembers(guild),
    MEMBER_FETCH_TIMEOUT_MS,
    'Fetching the member list took too long. Try again, and make sure the bot has the Server Members Intent enabled.',
  );

  const loaRoleId = getLoaRoleId(settings);
  const staff = [...members.values()].filter(
    (member) => !member.bot && member.roles.includes(settings.staffRoleId),
  );
  const loa = staff.filter((member) => loaRoleId && member.roles.includes(loaRoleId));
  const required = staff.filter((member) => !(loaRoleId && member.roles.includes(loaRoleId)));

  return {
    staffIds: staff.map((member) => member.id),
    loaIds: loa.map((member) => member.id),
    requiredIds: required.map((member) => member.id),
    loaRoleId,
  };
}

async function countReactions(message) {
  const reaction =
    message.reactions.cache.find((item) => item.emoji.name === CHECK_EMOJI) ??
    message.reactions.cache.get(CHECK_EMOJI);
  if (!reaction) return new Set();

  const ids = new Set();
  let after = null;
  for (let page = 0; page < 10; page += 1) {
    const users = await reaction.users
      .fetch({ limit: 100, ...(after ? { after } : {}) })
      .catch(() => null);
    if (!users || users.size === 0) break;
    for (const user of users.values()) {
      if (!user.bot) ids.add(user.id);
    }
    if (users.size < 100) break;
    after = users.lastKey();
  }
  return ids;
}

/** "1d 4h" style remaining time, so the card never shows raw timestamps. */
function timeLeft(endsAtMs) {
  if (!endsAtMs) return '—';
  const seconds = Math.max(0, Math.floor((endsAtMs - Date.now()) / 1000));
  return seconds > 0 ? formatDuration(seconds) : '0s';
}

function buildEmbed(guild, check, reactedIds, { ended = false } = {}) {
  const required = check.requiredIds ?? [];
  const loa = check.loaIds ?? [];
  const reacted = required.filter((id) => reactedIds.has(id)).length;
  const missing = Math.max(0, required.length - reacted);
  const totalRoster = required.length + loa.length;
  const endsAtMs = check.endsAt ? Date.parse(check.endsAt) : null;
  const percent = required.length ? Math.round((reacted / required.length) * 100) : 0;
  const allDone = missing === 0;
  const given = formatDuration(check.durationSeconds);
  const left = timeLeft(endsAtMs);

  // Kept deliberately short and horizontal: a header, one instruction line and
  // one stat line, instead of a tall stack of fields.
  return v2.card({
    accent: allDone ? COLORS.success : ended ? COLORS.danger : COLORS.brand,
    kicker: toSmallCaps(check.auto ? 'automatic activity check' : 'staff activity check'),
    title: ended ? '🏁 ACTIVITY CHECK — CLOSED' : '📊 ACTIVITY CHECK',
    subtitle: ended ? 'Final results' : `⏳ ${left} left`,
    quote: ended
      ? `> 🏁 **Check closed** · ${CHECK_EMOJI} **${reacted}/${required.length}** reacted`
      : allDone
        ? `> ✅ **Everyone has checked in!** Thanks for reacting early 💚`
        : `> ${CHECK_EMOJI} **React with ${CHECK_EMOJI} below to check in** · 🌴 LOA is skipped automatically`,
    description: [`🌴 **${loa.length} on LOA**`, `🕒 **${given} given**`].join(' · '),
    progress: {
      percent,
      emoji: allDone ? '🎯' : '📈',
      label: `${reacted} of ${required.length} checked in`,
    },
    thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
  });
}

async function getMessage(guild, check) {
  const channel =
    guild.channels.cache.get(check.channelId) ??
    (await guild.channels.fetch(check.channelId).catch(() => null));
  if (!channel?.isTextBased()) return { channel: null, message: null };
  // The cached message edits without a round trip; only fetch when it is gone.
  const cached = channel.messages?.cache?.get(check.messageId);
  const message = cached ?? (await channel.messages.fetch(check.messageId).catch(() => null));
  return { channel, message };
}

/** Mentions a list of members, split across messages so pings never truncate. */
async function pingUsers(channel, ids, buildLine, label = 'ping') {
  const chunks = [];
  let current = '';
  for (const id of ids) {
    const mention = `<@${id}> `;
    if (current.length + mention.length > 1800) {
      chunks.push(current.trim());
      current = '';
    }
    current += mention;
  }
  if (current.trim()) chunks.push(current.trim());

  for (const mentions of chunks) {
    await channel
      .send({ content: buildLine(mentions) })
      .catch((err) => console.error(`[activity] Failed to send ${label}:`, err.message));
  }
}

/**
 * One `<@&role>` mention when the staff role is known, so a check pings every
 * staff member with a single notification instead of a wall of user pings.
 */
function staffMention(roleId, ids) {
  if (roleId) return `<@&${roleId}>`;
  return ids.map((id) => `<@${id}>`).join(' ');
}

/** Pings the staff role (or the listed members if no role is configured). */
async function pingStaff(channel, roleId, ids, buildLine, label = 'ping') {
  if (!ids.length) return;
  if (!roleId) {
    await pingUsers(channel, ids, buildLine, label);
    return;
  }
  await channel
    .send({ content: buildLine(`<@&${roleId}>`) })
    .catch((err) => console.error(`[activity] Failed to send ${label}:`, err.message));
}

async function pingMissing(channel, missingIds, roleId) {
  await pingStaff(
    channel,
    roleId,
    missingIds,
    (mentions) => `⏰ ${mentions} we are still waiting on you !`,
    'reminder',
  );
}

/** Pings the staff role (LOA members included, they can ignore it) when a check starts. */
async function pingStaffStarted(channel, activeIds, roleId) {
  await pingStaff(
    channel,
    roleId,
    activeIds,
    (mentions) =>
      `📣 ${mentions}\n> **An activity check has started!** React with ${CHECK_EMOJI} on the card above to check in. 🌴 LOA staff can ignore this.`,
    'check-in ping',
  );
}

/**
 * Who has reacted. Reactions are tracked from the gateway as they happen, so a
 * check-in shows up immediately; the REST reaction list is only read when the
 * bot has no local copy yet (first refresh after a restart, or an older check).
 */
async function reactedUsers(check, message, { reconcile = false } = {}) {
  const local = Array.isArray(check.reactedIds) ? check.reactedIds : null;
  if (local && !reconcile) return new Set(local);
  const fetched = await countReactions(message);
  check.reactedIds = [...fetched];
  check.reactedAt = new Date().toISOString();
  return fetched;
}

/**
 * Recomputes the reaction counts, updates the check embed and optionally pings
 * the staff role when members have not reacted yet.
 */
async function refreshCheck(ctx, guild, { ping = false, final = false, reconcile = false } = {}) {
  const settings = ctx.store.guild(guild.id);
  const check = settings.activity.current;
  if (!check || check.endedAt) return null;

  const { channel, message } = await getMessage(guild, check);
  if (!channel || !message) {
    settings.activity.current = null;
    ctx.store.save();
    console.warn(`[activity] Check message missing in guild ${guild.id}; cleared active check.`);
    return null;
  }

  const reacted = await reactedUsers(check, message, { reconcile });
  const missing = check.requiredIds.filter((id) => !reacted.has(id));

  if (ping && missing.length) {
    await pingMissing(channel, missing, settings.staffRoleId);
  }

  const updated = buildEmbed(guild, check, reacted, { ended: final });
  try {
    await message.edit(updated);
  } catch (err) {
    // Older check messages were posted as classic embeds and cannot be edited
    // into Components V2, so repost the card and keep following the new one.
    if (!v2.isClassicEmbedMessage(message)) {
      console.error('[activity] Failed to update check message:', err.message);
    } else {
      await message.delete().catch(() => {});
      const reposted = await channel.send(updated).catch((sendErr) => {
        console.error('[activity] Failed to repost the check card:', sendErr.message);
        return null;
      });
      if (reposted) {
        check.messageId = reposted.id;
        await reposted.react(CHECK_EMOJI).catch(() => {});
      }
    }
  }

  check.lastRefreshAt = new Date().toISOString();
  check.lastReactedCount = check.requiredIds.filter((id) => reacted.has(id)).length;
  check.leftLabel = timeLeft(check.endsAt ? Date.parse(check.endsAt) : null);

  if (final) {
    check.endedAt = new Date().toISOString();
    settings.activity.lastCheck = {
      endedAt: check.endedAt,
      staff: check.requiredIds.length,
      reacted: check.lastReactedCount,
      loa: check.loaIds.length,
      missing: missing.length,
      channelId: check.channelId,
      messageId: check.messageId,
    };
    settings.activity.current = null;
    ctx.store.save();

    await sendLog(guild, settings, [
      embed({
        title: '🏁 Activity Check Ended',
        description: missing.length
          ? `> ⚠️ **${missing.length}** active staff did not react before the check closed.`
          : '> ✅ **Everyone responded before the check closed.**',
        color: missing.length ? COLORS.danger : COLORS.success,
        fields: [
          { name: '✅ Reacted', value: `${check.lastReactedCount}/${check.requiredIds.length}`, inline: true },
          { name: '🌴 On LOA', value: `${check.loaIds.length}`, inline: true },
        ],
        footer: check.auto ? 'Automatic check' : undefined,
        thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
      }),
    ]);
  } else {
    ctx.store.save();
  }

  return { check, reacted, missing };
}

async function startCheck(ctx, { guild, channel, durationSeconds, startedBy = null, auto = false }) {
  const settings = ctx.store.guild(guild.id);
  if (settings.activity.current) {
    throw new Error('An activity check is already running. End it first with `/activity end`.');
  }
  if (!channel?.isTextBased()) {
    throw new Error('Choose a normal text channel for the activity check.');
  }

  const snapshot = await fetchStaffSnapshot(guild, settings);
  if (!snapshot.requiredIds.length) {
    throw new Error('There are no active staff members to check. Everyone with the staff role is on LOA.');
  }

  const now = Date.now();
  const check = {
    messageId: null,
    channelId: channel.id,
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + durationSeconds * 1000).toISOString(),
    durationSeconds,
    staffIds: snapshot.staffIds,
    loaIds: snapshot.loaIds,
    requiredIds: snapshot.requiredIds,
    loaRoleId: snapshot.loaRoleId,
    // Filled in by the reaction handlers, so the card never has to poll Discord.
    reactedIds: [],
    reactedAt: new Date(now).toISOString(),
    warned: false,
    startedBy: startedBy ? { id: startedBy.id, tag: startedBy.tag } : null,
    auto: Boolean(auto),
  };

  const initial = buildEmbed(guild, check, new Set());
  const message = await channel.send(initial).catch((err) => {
    throw new Error(`I could not post the activity check: ${err.message}`);
  });

  check.messageId = message.id;
  await message.react(CHECK_EMOJI).catch((err) => {
    console.error('[activity] Could not add the checkmark reaction:', err.message);
  });

  await pingStaffStarted(channel, check.requiredIds, settings.staffRoleId);

  settings.activity.current = check;
  settings.activity.lastCheckAt = check.startedAt;
  if (settings.activity.enabled) {
    settings.activity.nextCheckAt = new Date(
      now + settings.activity.intervalSeconds * 1000,
    ).toISOString();
  }
  ctx.store.save();

  await sendLog(guild, settings, [
    embed({
      title: '🚀 Activity Check Started',
      description: `> 📣 A new activity check is live in ${channel}.`,
      color: COLORS.brand,
      fields: [
        { name: '📍 Channel', value: `${channel}`, inline: true },
        { name: '⏳ Ends', value: `<t:${Math.floor(Date.parse(check.endsAt) / 1000)}:R>`, inline: true },
        { name: '👥 Active Staff', value: `${check.requiredIds.length}`, inline: true },
        { name: '🌴 On LOA', value: `${check.loaIds.length}`, inline: true },
        { name: '🛡️ Started By', value: auto ? 'Automatic schedule' : `${startedBy?.tag ?? 'Unknown'}` },
      ],
      thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
    }),
  ]);

  return message;
}

async function endCheck(ctx, guild) {
  const settings = ctx.store.guild(guild.id);
  if (!settings.activity.current) return null;

  const result = await refreshCheck(ctx, guild, { final: true });
  if (!result) {
    settings.activity.current = null;
    ctx.store.save();
  }
  return result;
}

function scheduleNextAuto(settings, fromMs = Date.now()) {
  settings.activity.nextCheckAt = new Date(
    fromMs + settings.activity.intervalSeconds * 1000,
  ).toISOString();
}

async function runTick(ctx) {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const guildId of Object.keys(ctx.store.data.guilds)) {
      const guild = ctx.client.guilds.cache.get(guildId);
      if (!guild) continue;

      // Finish checks whose time is up, and send the 25%-remaining reminder.
      let settings = ctx.store.guild(guildId);
      const check = settings.activity.current;
      if (check && !check.endedAt) {
        const endsAt = Date.parse(check.endsAt);
        const warnAt = endsAt - 0.25 * check.durationSeconds * 1000;

        if (now >= endsAt) {
          try {
            await refreshCheck(ctx, guild, { final: true });
          } catch (err) {
            console.error(`[activity] Failed to end check in ${guildId}:`, err);
          }
        } else if (!check.warned && now >= warnAt) {
          check.warned = true;
          ctx.store.save();
          try {
            await refreshCheck(ctx, guild, { ping: true });
          } catch (err) {
            console.error(`[activity] Failed to send reminder in ${guildId}:`, err);
          }
        } else if (
          // Keep the "hours left" line honest without editing on every tick:
          // only refresh once the displayed label actually changes.
          check.leftLabel !== timeLeft(endsAt) &&
          (!check.lastRefreshAt || now - Date.parse(check.lastRefreshAt) > 60_000)
        ) {
          try {
            await refreshCheck(ctx, guild);
          } catch (err) {
            console.error(`[activity] Failed to refresh the countdown in ${guildId}:`, err);
          }
        }
      }

      // Start an automatic check when it is due.
      settings = ctx.store.guild(guildId);
      if (!settings.activity.enabled || settings.activity.current) continue;

      const due = settings.activity.nextCheckAt
        ? Date.parse(settings.activity.nextCheckAt)
        : now;
      if (Number.isNaN(due) || now < due) continue;

      const channel =
        (settings.activity.channelId &&
          (guild.channels.cache.get(settings.activity.channelId) ??
            (await guild.channels.fetch(settings.activity.channelId).catch(() => null)))) ||
        null;

      if (!channel?.isTextBased()) {
        console.warn(`[activity] Automatic check skipped in ${guildId}: channel missing.`);
        scheduleNextAuto(settings);
        ctx.store.save();
        continue;
      }

      try {
        await startCheck(ctx, {
          guild,
          channel,
          durationSeconds: settings.activity.durationSeconds,
          auto: true,
        });
      } catch (err) {
        console.error(`[activity] Automatic check failed in ${guildId}:`, err.message);
        scheduleNextAuto(settings);
        ctx.store.save();
      }
    }
  } finally {
    ticking = false;
  }
}

function startScheduler(ctx) {
  stopScheduler();
  runTick(ctx).catch((err) => console.error('[activity] Scheduler tick failed:', err));
  scheduler = setInterval(() => {
    runTick(ctx).catch((err) => console.error('[activity] Scheduler tick failed:', err));
  }, TICK_MS);
  scheduler.unref?.();

  // Once the gateway is ready, refresh any check that was running before a restart.
  const warmup = setTimeout(() => {
    for (const guildId of Object.keys(ctx.store.data.guilds)) {
      const guild = ctx.client.guilds.cache.get(guildId);
      const settings = ctx.store.guild(guildId);
      if (!guild || !settings.activity.current) continue;
      // Restore the reaction list from Discord after a restart, then let the
      // gateway keep it current from here on.
      refreshCheck(ctx, guild, { reconcile: true }).catch((err) =>
        console.error(`[activity] Startup refresh failed in ${guildId}:`, err.message),
      );
    }
  }, 5000);
  warmup.unref?.();
}

function stopScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
  for (const timer of refreshTimers.values()) clearTimeout(timer);
  refreshTimers.clear();
  lastEditAt.clear();
}

/**
 * Edits the card soon after a reaction, but never more than once every
 * EDIT_MIN_GAP_MS, so a burst of check-ins cannot trip the edit rate limit.
 */
function scheduleCardUpdate(ctx, guildId, messageId) {
  if (refreshTimers.has(messageId)) return;
  const wait = Math.max(0, EDIT_MIN_GAP_MS - (Date.now() - (lastEditAt.get(messageId) ?? 0)));
  const timer = setTimeout(() => {
    refreshTimers.delete(messageId);
    lastEditAt.set(messageId, Date.now());
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return;
    refreshCheck(ctx, guild).catch((err) =>
      console.error('[activity] Failed to refresh reaction counts:', err.message),
    );
  }, wait);
  timer.unref?.();
  refreshTimers.set(messageId, timer);
}

function handleReaction(ctx, reaction, user, action = 'add') {
  if (!reaction?.message?.id || !user || user.bot) return;
  if (reaction.emoji?.name !== CHECK_EMOJI) return;

  const guildId =
    reaction.message.guildId ??
    reaction.message.channel?.guildId ??
    reaction.message.guild?.id ??
    null;
  if (!guildId) return;

  if (!ctx.store.data.guilds[guildId]) return;
  const settings = ctx.store.guild(guildId);
  const check = settings.activity.current;
  if (!check || check.endedAt || check.messageId !== reaction.message.id) return;
  if (!(check.requiredIds ?? []).includes(user.id)) return;

  // Record the check-in straight away so the card is correct the moment it is
  // edited, then edit at most once every couple of seconds to stay inside
  // Discord's per-message edit limit.
  const reacted = new Set(Array.isArray(check.reactedIds) ? check.reactedIds : []);
  if (action === 'remove') reacted.delete(user.id);
  else reacted.add(user.id);
  check.reactedIds = [...reacted];
  check.reactedAt = new Date().toISOString();
  ctx.store.save();

  scheduleCardUpdate(ctx, guildId, check.messageId);
}

module.exports = {
  CHECK_EMOJI,
  DEFAULT_LOA_ROLE_ID,
  AUTO_MIN_INTERVAL,
  pingStaffStarted,
  pingStaff,
  staffMention,
  scheduleCardUpdate,
  reactedUsers,
  pingUsers,
  timeLeft,
  fetchGuildMembers,
  parseDuration,
  formatDuration,
  buildEmbed,
  countReactions,
  startCheck,
  endCheck,
  refreshCheck,
  runTick,
  startScheduler,
  stopScheduler,
  handleReaction,
  getLoaRoleId,
  getMessage,
};
