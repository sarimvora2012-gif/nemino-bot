'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { toPlain, toSmallCaps } = require('./smallcaps');

const MAX_NICKNAME = 32;

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
  isRankRole,
  nicknameFor,
  rankRoles,
  renameBlocker,
  splitCount,
  staffRankRole,
  stripRank,
  syncNickname,
};
