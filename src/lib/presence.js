'use strict';

const { ActivityType } = require('discord.js');

const CREDIT = 'made by seraphum';
/** Discord rate-limits presence updates (roughly 5 per 20s), so one swap per minute is safe. */
const CYCLE_MS = 60 * 1000;
/** Only the configured server's member count is shown, even if the bot is elsewhere. */
const TARGET_GUILD_ID = () => process.env.GUILD_ID?.trim() || null;

let timer = null;
let index = 0;

/**
 * "watching over 747 members" — the whole sentence, because this line is sent
 * as a custom status where Discord shows the text exactly as written instead of
 * putting a verb in front of it.
 */
function memberStatus(count) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `watching over ${n} ${n === 1 ? 'member' : 'members'}`;
}

function currentCount(client) {
  const guildId = TARGET_GUILD_ID();
  const guild = (guildId ? client.guilds.cache.get(guildId) : null) ?? client.guilds.cache.first();
  if (!guild) return 0;
  return guild.memberCount ?? guild.members?.cache?.size ?? 0;
}

/** The two statuses, in the order they are shown. */
function statusesFor(client) {
  return [CREDIT, memberStatus(currentCount(client))];
}

/** The presence activity for one status, ready for setPresence. */
function activityFor(text) {
  return text === CREDIT
    ? { name: CREDIT, type: ActivityType.Watching }
    : { name: 'Custom Status', state: text, type: ActivityType.Custom };
}

function show(client, text) {
  try {
    client.user.setPresence({ activities: [activityFor(text)] });
  } catch (err) {
    // Custom status unsupported on this client: fall back to a watching line
    // that still reads "Watching over N members" once Discord adds the verb.
    console.warn('[presence] Custom status failed, using watching instead:', err.message);
    try {
      client.user.setActivity(text.replace(/^watching\s+/i, ''), { type: ActivityType.Watching });
    } catch (retryErr) {
      console.warn('[presence] Could not update the status:', retryErr.message);
    }
  }
}

function apply(client) {
  if (!client?.user) return null;
  const statuses = statusesFor(client);
  const text = statuses[index % statuses.length];
  index = (index + 1) % statuses.length;
  show(client, text);
  return text;
}

/**
 * Starts on the credit, then swaps to the member count, refreshing the number
 * each time so the count stays correct without listening for joins.
 */
function start(client) {
  stop();
  index = 0;
  apply(client);
  timer = setInterval(() => apply(client), CYCLE_MS);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { CREDIT, CYCLE_MS, memberStatus, statusesFor, activityFor, apply, start, stop };
