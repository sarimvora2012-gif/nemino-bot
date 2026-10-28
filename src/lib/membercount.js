'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const DEFAULT_TEMPLATE = 'Members - {count}';
/** Discord allows 2 name edits per 10 minutes per channel, so space them 5 minutes apart. */
const RENAME_COOLDOWN_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 5 * 1000;
const REFRESH_MS = 10 * 60 * 1000;
/** Only the configured server gets a counter channel, even if the bot is elsewhere. */
const TARGET_GUILD_ID = process.env.GUILD_ID?.trim() || null;

const states = new Map();
let refresher = null;

function memberCount(guild) {
  return guild?.memberCount ?? guild?.members?.cache?.size ?? 0;
}

function countChannelName(template, count) {
  const text = String(template ?? DEFAULT_TEMPLATE).replace(/\{count\}/g, String(count));
  return [...text].slice(0, 100).join('');
}

function stateFor(guildId) {
  if (!states.has(guildId)) {
    states.set(guildId, { debounce: null, cooldown: null, lastRenameAt: 0 });
  }
  return states.get(guildId);
}

function findCountChannel(guild, settings) {
  if (!settings?.memberCountChannelId) return null;
  return guild.channels.cache.get(settings.memberCountChannelId) ?? null;
}

/**
 * Creates the locked counter voice channel at the top of the server, or fixes
 * the permissions and position of the one we already made.
 */
async function ensureChannel(guild, store) {
  const settings = store.guild(guild.id);
  const desired = countChannelName(settings.memberCountTemplate, memberCount(guild));
  const existing = findCountChannel(guild, settings);

  if (!existing) {
    const channel = await guild.channels.create({
      name: desired,
      type: ChannelType.GuildVoice,
      position: 0,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
        },
      ],
      reason: 'Live member counter',
    });
    store.updateGuild(guild.id, { memberCountChannelId: channel.id });
    stateFor(guild.id).lastRenameAt = Date.now();
    console.log(`[membercount] Created "${channel.name}" at the top of ${guild.name}`);
    return channel;
  }

  const everyone = guild.roles.everyone;
  const locked = existing.permissionOverwrites.cache
    .get(everyone.id)
    ?.deny.has(PermissionFlagsBits.Connect);
  if (!locked) {
    await existing
      .permissionOverwrites.edit(everyone, { Connect: false, Speak: false }, { reason: 'Member counter is read-only' })
      .catch((err) => console.warn('[membercount] Could not lock the channel:', err.message));
  }

  if (existing.rawPosition !== 0) {
    await existing
      .setPosition(0, { reason: 'Member counter belongs at the top' })
      .catch((err) => console.warn('[membercount] Could not move the channel:', err.message));
  }

  return existing;
}

/** Renames the channel to the current member count, respecting Discord's rename limit. */
async function update(guild, store) {
  const settings = store.guild(guild.id);
  const channel = findCountChannel(guild, settings);
  if (!channel) return null;

  const desired = countChannelName(settings.memberCountTemplate, memberCount(guild));
  if (channel.name === desired) return channel;

  const state = stateFor(guild.id);
  const wait = state.lastRenameAt + RENAME_COOLDOWN_MS - Date.now();
  if (wait > 0) {
    if (!state.cooldown) {
      state.cooldown = setTimeout(() => {
        state.cooldown = null;
        update(guild, store).catch((err) =>
          console.warn('[membercount] Delayed rename failed:', err.message),
        );
      }, wait);
      state.cooldown.unref?.();
    }
    return channel;
  }

  state.lastRenameAt = Date.now();
  try {
    await channel.setName(desired, 'Member count updated');
    console.log(`[membercount] ${guild.name} → ${desired}`);
  } catch (err) {
    console.warn('[membercount] Rename failed:', err.message);
  }
  return channel;
}

/** Coalesces join/leave bursts into one rename attempt. */
function queueUpdate(context, guild) {
  if (!guild) return;
  const state = stateFor(guild.id);
  if (state.debounce) return;

  state.debounce = setTimeout(() => {
    state.debounce = null;
    update(guild, context.store).catch((err) =>
      console.warn('[membercount] Update failed:', err.message),
    );
  }, DEBOUNCE_MS);
  state.debounce.unref?.();
}

function start(context) {
  const { client, store } = context;

  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      if (TARGET_GUILD_ID && guild.id !== TARGET_GUILD_ID) continue;
      if (guild.available === false) continue;
      try {
        await ensureChannel(guild, store);
        await update(guild, store);
      } catch (err) {
        console.warn(`[membercount] Setup failed for ${guild.name}:`, err.message);
      }
    }
  };

  run();

  if (!refresher) {
    refresher = setInterval(run, REFRESH_MS);
    refresher.unref?.();
  }
}

function stop() {
  if (refresher) clearInterval(refresher);
  refresher = null;
  for (const state of states.values()) {
    if (state.debounce) clearTimeout(state.debounce);
    if (state.cooldown) clearTimeout(state.cooldown);
  }
  states.clear();
}

module.exports = {
  DEFAULT_TEMPLATE,
  RENAME_COOLDOWN_MS,
  countChannelName,
  ensureChannel,
  memberCount,
  queueUpdate,
  start,
  stop,
  update,
};
