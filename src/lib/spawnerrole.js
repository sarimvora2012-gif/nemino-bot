'use strict';

const { ApplicationCommandPermissionType, PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, COLORS } = require('./helpers');
const spawners = require('./spawners');

const PREFIXES = ['!spawnermanager', '!spawnermanagersetup', '!spawnerrole'];
const ROLE_NAME = 'Spawner Manager';
const PRICE_COMMAND = 'setspawnerprice';

/**
 * `/setspawnerprice` is registered for **Manage Server**, which keeps it out of
 * everyone else's command picker. Discord lets a guild allow one more role on
 * top of that default, so the Spawner Manager role is added as an allow
 * override — that is what ``permissions to change spawner prices`` means
 * without handing the role Manage Server itself.
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
 * Finds or creates the role and makes sure it may use `/setspawnerprice`.
 * Returns `{ ok, role, created, granted }`; never throws.
 */
async function ensureSpawnerManagerRole(client, guild, settings) {
  let role = spawners.spawnerManagerRole(guild, settings);
  let created = false;

  if (!role) {
    const me = guild?.members?.me;
    if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
      return {
        ok: false,
        reason:
          'I need the **Manage Roles** permission to create it. Give my role Manage Roles, then run `!spawnermanager` again.',
      };
    }
    role = await guild.roles
      .create({
        name: ROLE_NAME,
        hoist: false,
        mentionable: true,
        permissions: [],
        reason: 'Spawner Manager — can change spawner prices',
      })
      .catch((err) => err);
    if (role instanceof Error) return { ok: false, reason: role.message };
    created = true;
  }

  settings.spawnerManagerRoleId = role.id;
  const granted = await grantPriceAccess(client, guild, role);
  return { ok: true, role, created, granted };
}

/**
 * Re-applies the command permission on every start: re-registering the slash
 * commands can drop the override, and this puts it back without anyone
 * noticing. Silent unless something actually fails.
 */
async function syncPricePermissions(client, store) {
  for (const guild of client?.guilds?.cache?.values?.() ?? []) {
    const settings = store.guild(guild.id);
    if (!settings.spawnerManagerRoleId) continue;

    const role = spawners.spawnerManagerRole(guild, settings);
    if (!role) {
      console.warn(`[spawners] The Spawner Manager role is set but missing in ${guild.name} — run !spawnermanager`);
      continue;
    }

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

function resultEmbed(guild, result) {
  const lines = [
    result.created
      ? `Created ${result.role} with **no server permissions** — it only unlocks spawner prices.`
      : `${result.role} already existed, so I reused it.`,
    '',
    result.granted.ok
      ? '**Can change prices:** yes — `/setspawnerprice` and `!spawnerprices` both work for it.'
      : `**Can change prices:** not yet — ${result.granted.reason}.`,
    '',
    `Give the role to anyone who runs spawner deals: **Members → right click → Roles → ${result.role.name}**.`,
    'They can then set buying and selling prices, and the board updates for everyone.',
  ];

  if (!result.granted.ok) {
    lines.push(
      '',
      `If it stays blocked, open **Server Settings → Integrations → ${guild.me?.user?.username ?? 'this bot'} → \`/setspawnerprice\`** and tick the role there.`,
    );
  }

  return embed({
    title: '🔧 Spawner Manager',
    description: lines.join('\n'),
    color: result.granted.ok ? COLORS.success : COLORS.warning,
    footer: guild.name,
  });
}

/** `!spawnermanager` — creates the role and gives it the price commands. */
async function handleMessage(message, { store }) {
  const content = String(message.content ?? '').trim();
  const command = content.split(/\s+/)[0].toLowerCase();
  if (!PREFIXES.includes(command)) return;

  const guild = message.guild;
  if (!guild) return;

  const reply = (payload) => message.reply({ ...payload, allowedMentions: { parse: [] } }).catch(() => {});

  if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply({
      embeds: [
        errorEmbed('You need **Manage Server** to set up the Spawner Manager role.', 'Missing permissions'),
      ],
    });
    return;
  }

  const settings = store.guild(guild.id);
  const result = await ensureSpawnerManagerRole(message.client, guild, settings).catch((err) => ({
    ok: false,
    reason: err.message,
  }));

  if (!result.ok) {
    await reply({ embeds: [errorEmbed(result.reason, 'Spawner Manager')] });
    return;
  }

  store.save();
  await reply({ embeds: [resultEmbed(guild, result)] });
}

module.exports = {
  PREFIXES,
  PRICE_COMMAND,
  ROLE_NAME,
  ensureSpawnerManagerRole,
  grantPriceAccess,
  handleMessage,
  priceCommandId,
  resultEmbed,
  syncPricePermissions,
};
