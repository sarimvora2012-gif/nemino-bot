'use strict';

const { ApplicationCommandPermissionType } = require('discord.js');
const spawners = require('./spawners');

const PRICE_COMMAND = 'setspawnerprice';

/**
 * `/setspawnerprice` is registered for **Manage Server**, which keeps it out of
 * everyone else's command picker. Discord lets a guild allow one extra role on
 * top of that default, so the spawner perms role is added as an allow entry —
 * that is what makes the command usable for the people who run spawner deals
 * without giving them Manage Server itself.
 */
async function priceCommandId(client, guild) {
  if (guild?.commands?.fetch) {
    const local = await guild.commands.fetch().catch(() => null);
    const found = local?.find?.((command) => command.name === PRICE_COMMAND);
    if (found) return found.id;
  }
  const global = await client?.application?.commands?.fetch?.().catch?.(() => null);
  return global?.find?.((command) => command.name === PRICE_COMMAND)?.id ?? null;
}

/** Grants the role the price command, leaving any other overrides untouched. */
async function grantPriceAccess(client, guild, role) {
  const id = await priceCommandId(client, guild);
  if (!id) {
    return { ok: false, reason: 'the `/setspawnerprice` command is not registered yet' };
  }

  try {
    await guild.commands.permissions.add({
      command: id,
      permissions: [{ id: role.id, type: ApplicationCommandPermissionType.Role, permission: true }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Re-applies the price command access for the spawner perms role on every
 * start: re-registering the slash commands can drop the override, and this puts
 * it back without anyone noticing. Silent unless something actually fails.
 */
async function syncPriceAccess(client, store) {
  for (const guild of client?.guilds?.cache?.values?.() ?? []) {
    const settings = store.guild(guild.id);
    const role = spawners.spawnerPermsRole(guild, settings);
    if (!role) continue;

    const id = await priceCommandId(client, guild);
    if (!id) continue;

    const existing = await guild.commands.permissions.fetch({ command: id }).catch(() => null);
    const allowed = existing?.some?.(
      (entry) =>
        entry.id === role.id &&
        (entry.type === ApplicationCommandPermissionType.Role || entry.type === 'ROLE') &&
        entry.permission === true,
    );
    if (allowed) continue;

    const granted = await grantPriceAccess(client, guild, role);
    if (!granted.ok) {
      console.warn(`[spawners] Could not give ${role.name} the price command: ${granted.reason}`);
    }
  }
}

module.exports = { PRICE_COMMAND, grantPriceAccess, priceCommandId, syncPriceAccess };
