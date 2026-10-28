'use strict';

const { fontKey } = require('./smallcaps');

/**
 * `Co-Owner`, `CO OWNER` and a small-capped `💎 ᴄᴏ-ᴏᴡɴᴇʀ` all share a key, so
 * the check survives `!stafffont` restyling the role.
 */
const CO_OWNER_KEYS = new Set(
  ['co-owner', 'co owner', 'coowner', 'co_owner', 'vice owner'].map(fontKey),
);

function isCoOwnerRole(role, guild) {
  return Boolean(role) && role.id !== guild.id && CO_OWNER_KEYS.has(fontKey(role.name));
}

/** The server owner (Nemino) or anybody holding a co-owner role. */
function isOwnerOrCoOwner(member, guild) {
  if (!member) return false;
  if (guild.ownerId === member.id) return true;
  return Boolean(member.roles?.cache?.some((role) => isCoOwnerRole(role, guild)));
}

module.exports = { CO_OWNER_KEYS, isCoOwnerRole, isOwnerOrCoOwner };
