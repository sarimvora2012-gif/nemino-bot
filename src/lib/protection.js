'use strict';

const { PermissionFlagsBits } = require('discord.js');

const PROTECTION_ROLE_NAME = '🛡️ ᴋɪᴄᴋ ᴘʀᴏᴛᴇᴄᴛᴇᴅ';

function isProtected(member, protectionRoleId) {
  return Boolean(protectionRoleId && member?.roles?.cache?.has(protectionRoleId));
}

function isGuildAdmin(member, guild) {
  if (!member) return false;
  if (guild?.ownerId && member.id === guild.ownerId) return true;
  return Boolean(member.permissions?.has(PermissionFlagsBits.ManageGuild));
}

/**
 * Works out whether `actor` may kick `target` through the bot.
 * Admins (Manage Server or the server owner) can kick protected members;
 * everyone else is stopped by the protection role.
 */
function evaluateKick({ actor, target, bot, guild, protectionRoleId }) {
  if (!actor || !target || !bot) {
    return { ok: false, message: 'I could not resolve the member or bot permissions.' };
  }
  if (target.id === actor.id) {
    return { ok: false, message: 'You cannot kick yourself.' };
  }
  if (target.id === bot.id) {
    return { ok: false, message: 'I cannot kick myself.' };
  }
  if (guild?.ownerId && target.id === guild.ownerId) {
    return { ok: false, message: 'The server owner cannot be kicked.' };
  }
  if (!actor.permissions?.has(PermissionFlagsBits.KickMembers)) {
    return { ok: false, message: 'You need **Kick Members** to use this.' };
  }
  if (!bot.permissions?.has(PermissionFlagsBits.KickMembers)) {
    return {
      ok: false,
      message: 'I need **Kick Members**. Re-invite me with the updated invite link in the README.',
    };
  }

  const protectedMember = isProtected(target, protectionRoleId);
  if (protectedMember && !isGuildAdmin(actor, guild)) {
    return {
      ok: false,
      protected: true,
      message: `${target} has **kick protection**. Only admins can kick them.`,
    };
  }

  if (target.roles.highest.position >= bot.roles.highest.position) {
    return {
      ok: false,
      message: `${target} has a role above mine, so I cannot kick them. Move my bot role higher.`,
    };
  }
  if (!isGuildAdmin(actor, guild) && target.roles.highest.position >= actor.roles.highest.position) {
    return {
      ok: false,
      message: `${target} has a role above yours, so you cannot kick them.`,
    };
  }

  return { ok: true, protected: protectedMember };
}

/**
 * Finds or creates the kick-protection role and keeps it just below the bot's
 * highest role, above the staff roles that non-admin staff can hold.
 */
async function ensureProtectionRole(guild, settings, store) {
  const me = guild.members.me;
  if (!me) throw new Error('I could not resolve my own server member.');
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('I need **Manage Roles** to create and assign the protection role.');
  }

  let role = settings.kickProtectionRoleId
    ? guild.roles.cache.get(settings.kickProtectionRoleId)
    : null;
  if (!role) {
    role = guild.roles.cache.find((candidate) => candidate.name === PROTECTION_ROLE_NAME) ?? null;
  }

  if (!role) {
    role = await guild.roles.create({
      name: PROTECTION_ROLE_NAME,
      hoist: false,
      mentionable: false,
      permissions: [],
      reason: 'Kick protection for chosen members',
    });
  }

  if (role.managed) {
    throw new Error('The protection role is managed by an integration and cannot be edited.');
  }
  if (role.position >= me.roles.highest.position) {
    throw new Error(
      'The protection role is above my highest role. Drag my bot role above it in Server Settings → Roles, then try again.',
    );
  }

  if (role.permissions.bitfield !== 0n) {
    await role.setPermissions([], 'Kick protection roles grant no permissions');
  }
  if (role.mentionable) {
    await role.setMentionable(false, 'Keep the protection role silent');
  }

  const targetPosition = Math.max(1, me.roles.highest.position - 1);
  if (role.position !== targetPosition) {
    await role.setPosition(targetPosition, 'Keep kick protection above staff roles');
  }

  settings.kickProtectionRoleId = role.id;
  store.save();
  return role;
}

module.exports = {
  PROTECTION_ROLE_NAME,
  isProtected,
  isGuildAdmin,
  evaluateKick,
  ensureProtectionRole,
};
