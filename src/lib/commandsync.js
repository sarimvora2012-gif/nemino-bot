'use strict';

const { REST, Routes } = require('discord.js');

/**
 * Keeps the registered slash commands in step with the code, so a manual
 * `npm run deploy` is no longer required after an update. It only writes when
 * something actually differs, which keeps it clear of Discord's rate limits.
 */

/** Only the fields that change behaviour; ids and versions are ignored. */
function canonical(command) {
  const sorted = (list) =>
    (list ?? []).map((option) => {
      const copy = { ...option };
      if (Array.isArray(copy.options)) copy.options = sorted(copy.options);
      return copy;
    });

  return JSON.stringify({
    name: command.name,
    description: command.description ?? '',
    options: sorted(command.options),
    default_member_permissions: command.default_member_permissions ?? null,
  });
}

/** What changed between the local command set and what Discord has. */
function diffCommands(local, remote) {
  const localByName = new Map(local.map((command) => [command.name, canonical(command)]));
  const remoteByName = new Map(remote.map((command) => [command.name, canonical(command)]));

  const added = [...localByName.keys()].filter((name) => !remoteByName.has(name));
  const removed = [...remoteByName.keys()].filter((name) => !localByName.has(name));
  const changed = [...localByName.keys()].filter(
    (name) => remoteByName.has(name) && remoteByName.get(name) !== localByName.get(name),
  );

  return {
    added,
    removed,
    changed,
    identical: !added.length && !removed.length && !changed.length,
  };
}

function describe({ added, removed, changed }) {
  const parts = [];
  if (added.length) parts.push(`new: ${added.map((name) => `/${name}`).join(', ')}`);
  if (changed.length) parts.push(`updated: ${changed.map((name) => `/${name}`).join(', ')}`);
  if (removed.length) parts.push(`removed: ${removed.map((name) => `/${name}`).join(', ')}`);
  return parts.join(' · ');
}

/**
 * Registers the local commands when Discord's copy differs.
 * Returns `{ status, detail }`; never throws.
 */
async function syncCommands({ token, clientId, guildId, commands, rest = null }) {
  if (!token || !clientId) {
    return { status: 'skipped', detail: 'DISCORD_TOKEN and CLIENT_ID are needed to register commands' };
  }

  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  const client = rest ?? new REST({ version: '10' }).setToken(token);

  let remote;
  try {
    remote = await client.get(route);
  } catch (err) {
    remote = null;
    console.warn(`[commands] Could not read the registered commands: ${err.message}`);
  }

  if (Array.isArray(remote)) {
    const difference = diffCommands(commands, remote);
    if (difference.identical) {
      return { status: 'unchanged', detail: `${commands.length} commands already up to date` };
    }

    try {
      const registered = await client.put(route, { body: commands });
      return {
        status: 'updated',
        detail: `${registered.length} commands registered (${describe(difference)})`,
      };
    } catch (err) {
      return { status: 'failed', detail: `could not register commands: ${err.message}` };
    }
  }

  try {
    const registered = await client.put(route, { body: commands });
    return { status: 'updated', detail: `${registered.length} commands registered` };
  } catch (err) {
    return { status: 'failed', detail: `could not register commands: ${err.message}` };
  }
}

/** Logs the outcome in the same voice as the rest of startup. */
function logSync(result, guildId) {
  if (result.status === 'unchanged') {
    console.log(`[commands] ${result.detail}`);
    return;
  }
  if (result.status === 'updated') {
    console.log(`[commands] ${result.detail}`);
    console.log(
      guildId
        ? '[commands] Registered for your server, so they appear immediately.'
        : '[commands] Registered globally — Discord can take up to an hour to show them. Set GUILD_ID for instant updates.',
    );
    return;
  }
  if (result.status === 'skipped') {
    console.warn(`[commands] ${result.detail}`);
    return;
  }
  console.error(`[commands] Deploy failed — ${result.detail}`);
  console.error('[commands] Check that the bot is invited with the applications.commands scope.');
}

module.exports = { canonical, diffCommands, logSync, syncCommands };
