'use strict';

const { ApplicationCommandPermissionType } = require('discord.js');

const SUGGESTION_COMMAND = 'suggestion';

/**
 * `/suggestion` is meant for every member, and the bot itself has no staff gate
 * on it. Discord can still hide a command from members through **Server
 * Settings → Integrations** (or an old restriction left behind when a command
 * is re-registered), which makes it look like members "do not have permission".
 * Allowing **@everyone** on the command puts that right, and the check below
 * skips the write when it is already allowed.
 */
async function suggestionCommandId(client, guild) {
  if (guild?.commands?.fetch) {
    const local = await guild.commands.fetch().catch(() => null);
    const found = local?.find?.((command) => command.name === SUGGESTION_COMMAND);
    if (found) return found.id;
  }
  const global = await client?.application?.commands?.fetch?.().catch?.(() => null);
  return global?.find?.((command) => command.name === SUGGESTION_COMMAND)?.id ?? null;
}

/** Grants **@everyone** the suggestion command, leaving other overrides alone. */
async function allowEveryone(client, guild) {
  const id = await suggestionCommandId(client, guild);
  if (!id) {
    return { ok: false, reason: 'the `/suggestion` command is not registered yet' };
  }
  const everyoneId = guild?.roles?.everyone?.id;
  if (!everyoneId) return { ok: false, reason: 'this guild has no @everyone role' };

  try {
    await guild.commands.permissions.add({
      command: id,
      permissions: [
        { id: everyoneId, type: ApplicationCommandPermissionType.Role, permission: true },
      ],
    });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Re-applies member access on every start. Silent unless a guild fails. */
async function syncSuggestionAccess(client) {
  for (const guild of client?.guilds?.cache?.values?.() ?? []) {
    const id = await suggestionCommandId(client, guild);
    if (!id) continue;

    const everyoneId = guild?.roles?.everyone?.id;
    if (!everyoneId) continue;

    const existing = await guild.commands.permissions.fetch({ command: id }).catch(() => null);
    const allowed = existing?.some?.(
      (entry) =>
        entry.id === everyoneId &&
        (entry.type === ApplicationCommandPermissionType.Role || entry.type === 'ROLE') &&
        entry.permission === true,
    );
    if (allowed) continue;

    const granted = await allowEveryone(client, guild);
    if (!granted.ok) {
      console.warn(`[suggestion] Could not open the command to members: ${granted.reason}`);
    }
  }
}

module.exports = { SUGGESTION_COMMAND, allowEveryone, suggestionCommandId, syncSuggestionAccess };
