'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, infoEmbed, COLORS } = require('./helpers');
const { toPlain, toSmallCaps } = require('./smallcaps');

const MAX_NICKNAME = 32;
const PREFIX_COMMANDS = new Set(['!staffname', '!staffnames']);
// Discord throttles nickname edits per guild, so bulk renames are spaced out.
const RENAME_GAP_MS = 350;

/**
 * Roles that sit in the hierarchy but are not a rank: the bot/integration roles,
 * the LOA tag and the kick-protection tag. Matched on the plain name, so a
 * small-capped `ʙᴏᴛꜱ` is still recognised.
 */
const NOT_A_RANK = ['bot', 'bots', 'loa', 'leaveofabsence', 'protected', 'kickprotected'];

function plainName(role) {
  return toPlain(String(role?.name ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isRankRole(role, settings, guild) {
  if (!role || role.id === guild?.id) return false;
  if (role.managed) return false;
  if (settings?.activity?.loaRoleId && role.id === settings.activity.loaRoleId) return false;
  if (settings?.kickProtectionRoleId && role.id === settings.kickProtectionRoleId) return false;
  const plain = plainName(role);
  return !NOT_A_RANK.some((word) => plain === word || plain.startsWith(word));
}

/** Every role that counts as a step in the staff hierarchy, highest first. */
function rankRoles(guild, settings) {
  const base = settings?.staffRoleId ? guild?.roles?.cache?.get?.(settings.staffRoleId) : null;
  if (!base) return [];
  return [...(guild.roles.cache.values?.() ?? [])]
    .filter((role) => role.position >= base.position && isRankRole(role, settings, guild))
    .sort((a, b) => b.position - a.position);
}

/** Splits `ɢʟᴀᴄɪᴀʟ (12)` into the name and the vouch count suffix. */
function splitCount(displayName) {
  const name = String(displayName ?? '').trim();
  const match = name.match(/\s*\((\d+)\)\s*$/);
  return {
    name: match ? name.slice(0, match.index).trim() : name,
    count: match ? match[1] : null,
  };
}

/** Removes a rank prefix this bot may have written earlier. */
function stripRank(name, prefixes) {
  const sorted = [...prefixes].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (name === prefix) return '';
    if (name.startsWith(`${prefix} `)) return name.slice(prefix.length).trim();
  }
  return name;
}

/** The member's highest staff rank, or null when they are not staff. */
function staffRankRole(member, settings, guild = member?.guild) {
  if (!member?.roles?.cache || !settings?.staffRoleId) return null;
  return rankRoles(guild, settings).find((role) => member.roles.cache.has(role.id)) ?? null;
}

/**
 * The nickname the member should have: rank in small caps, their own name in the
 * normal font, then their vouch count if they have one. `ᴍᴏᴅ glacia (12)`.
 *
 * Returns null when there is nothing to change, so callers can skip the API call.
 */
function nicknameFor(member, settings, guild = member?.guild) {
  if (!member?.displayName) return null;
  const role = staffRankRole(member, settings, guild);
  const prefixes = rankRoles(guild, settings).map((entry) => toSmallCaps(entry.name ?? '').trim());
  const { name, count } = splitCount(member.displayName);
  const stripped = stripRank(name, prefixes);

  // Not staff and no prefix of ours to remove: never touch the name.
  if (!role && stripped === name) return null;

  const prefix = role ? toSmallCaps(role.name ?? '').trim() : '';
  const suffix = count ? ` (${count})` : '';
  const base = stripped || member.user?.username || 'Member';
  const room = MAX_NICKNAME - (prefix ? prefix.length + 1 : 0) - suffix.length;
  const trimmed = [...base].slice(0, Math.max(1, room)).join('').trim() || 'Member';
  return prefix ? `${prefix} ${trimmed}${suffix}` : `${trimmed}${suffix}`;
}

/** Why Discord would refuse the rename, or null when it should work. */
function renameBlocker(member, guild = member?.guild) {
  if (!member?.setNickname) return 'this member cannot be renamed.';
  const me = guild?.members?.me;
  if (!me) return 'I am not in this server.';
  if (!me.permissions?.has?.(PermissionFlagsBits.ManageNicknames)) {
    return 'I am missing the **Manage Nicknames** permission.';
  }
  if (guild?.ownerId && member.id === guild.ownerId) {
    return 'Discord never lets a bot rename the server owner.';
  }
  const mine = me.roles?.highest?.position;
  const theirs = member.roles?.highest?.position;
  if (Number.isFinite(mine) && Number.isFinite(theirs) && theirs >= mine) {
    return 'their highest role is above mine — move my bot role higher.';
  }
  return null;
}

// The delay is awaited, so it must never be unref'd: an unref'd timer does not
// keep the event loop alive when it is the only pending work.
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rebuilds every staff nickname, for staff who were promoted before this
 * existed or renamed by hand. Members who are not staff and carry no prefix of
 * ours are left completely alone.
 */
async function syncAllNicknames(guild, store, { gapMs = RENAME_GAP_MS } = {}) {
  const settings = store.guild(guild.id);
  const result = { staff: 0, updated: 0, already: 0, cleared: 0, untouched: 0, failed: [] };
  const roles = rankRoles(guild, settings);
  const prefixes = roles.map((role) => toSmallCaps(role.name ?? '').trim());
  const members = await guild.members.fetch().catch(() => guild.members.cache);

  for (const member of members?.values?.() ?? []) {
    if (member?.user?.bot) continue;
    const role = staffRankRole(member, settings, guild);
    const { name } = splitCount(member.displayName ?? '');
    // A prefix this bot wrote earlier is worth removing for someone who left staff.
    const carriesPrefix = stripRank(name, prefixes) !== name;
    if (!role && !carriesPrefix) {
      result.untouched += 1;
      continue;
    }

    result.staff += 1;
    const synced = await syncNickname(member, settings, guild);
    if (!synced.ok) {
      result.failed.push({ member, reason: synced.reason });
      continue;
    }
    if (!synced.changed) {
      result.already += 1;
      continue;
    }
    if (role) result.updated += 1;
    else result.cleared += 1;
    if (gapMs) await wait(gapMs);
  }

  return result;
}

function summaryEmbed(guild, result) {
  const lines = [
    `**Staff renamed:** ${result.updated}`,
    `**Already correct:** ${result.already}`,
  ];
  if (result.cleared) lines.push(`**Prefix removed:** ${result.cleared}`);
  lines.push(`**Members left alone:** ${result.untouched}`);

  if (result.failed.length) {
    const shown = result.failed.slice(0, 8).map((entry) => `• ${entry.member} — ${entry.reason}`);
    if (result.failed.length > shown.length) shown.push(`• …and ${result.failed.length - shown.length} more`);
    lines.push('', '**Could not rename:**', ...shown);
  }

  return embed({
    title: 'Staff names rebuilt',
    description: lines.join('\n'),
    color: result.failed.length ? COLORS.warning : COLORS.success,
    footer: guild?.name,
  });
}

/**
 * `!staffname` — puts every staff member's rank in front of their name. The
 * command exists because promotions before this feature, or names edited by
 * hand, never went through `syncNickname`.
 */
async function handleMessage(message, { store }) {
  const content = String(message.content ?? '').trim();
  const command = content.split(/\s+/)[0].toLowerCase();
  if (!PREFIX_COMMANDS.has(command)) return;

  const guild = message.guild;
  if (!guild) return;

  if (!message.member?.permissions?.has?.(PermissionFlagsBits.ManageServer)) {
    await message
      .reply({
        embeds: [errorEmbed('You need **Manage Server** to rebuild staff names.', 'Missing permissions')],
      })
      .catch(() => {});
    return;
  }

  const settings = store.guild(guild.id);
  if (!settings.staffRoleId) {
    await message
      .reply({
        embeds: [
          errorEmbed(
            'Set the staff role first with `/config set staff_role:@role` — the rank in front of a name comes from the roles above it.',
            'No staff role set',
          ),
        ],
      })
      .catch(() => {});
    return;
  }

  const progress = await message
    .reply({ embeds: [infoEmbed('Rebuilding staff names…', 'This takes a few seconds.')] })
    .catch(() => null);
  const result = await syncAllNicknames(guild, store);
  const payload = { embeds: [summaryEmbed(guild, result)] };
  if (progress) await progress.edit(payload).catch(() => {});
  else await message.reply(payload).catch(() => {});
}

/** Applies the rank prefix. Safe to call after any role change. */
async function syncNickname(member, settings, guild = member?.guild) {
  const wanted = nicknameFor(member, settings, guild);
  if (!wanted) return { ok: true, changed: false, nickname: member?.displayName ?? null };
  if (wanted === member.displayName) {
    return { ok: true, changed: false, nickname: wanted };
  }

  const blocked = renameBlocker(member, guild);
  if (blocked) return { ok: false, changed: false, nickname: member.displayName, reason: blocked };

  const result = await member.setNickname(wanted, 'Staff rank prefix').catch((err) => err);
  if (result instanceof Error) {
    return { ok: false, changed: false, nickname: member.displayName, reason: result.message };
  }
  return { ok: true, changed: true, nickname: wanted };
}

module.exports = {
  MAX_NICKNAME,
  NOT_A_RANK,
  PREFIX_COMMANDS,
  RENAME_GAP_MS,
  handleMessage,
  isRankRole,
  nicknameFor,
  rankRoles,
  renameBlocker,
  splitCount,
  staffRankRole,
  stripRank,
  summaryEmbed,
  syncAllNicknames,
  syncNickname,
};
