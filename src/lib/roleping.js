'use strict';

const { isStaff, errorEmbed } = require('./helpers');
const { fontKey } = require('./smallcaps');

const PREFIXES = ['!pingrole', '!pr'];

/** `co owner`, `Co-Owner` and `👑 ᴄᴏ-ᴏᴡɴᴇʀ` all share one key. */
const roleKey = fontKey;

/**
 * Finds a role by plain or fancy name. Returns `{ role }` on a single match,
 * otherwise `{ matches }` so the caller can show what was ambiguous.
 */
function findRole(guild, query) {
  const wanted = roleKey(query);
  if (!wanted) return { role: null, matches: [] };

  const roles = [...guild.roles.cache.values()].filter(
    (role) => role.id !== guild.id && !role.managed,
  );

  const exact = roles.filter((role) => roleKey(role.name) === wanted);
  if (exact.length === 1) return { role: exact[0], matches: exact };
  if (exact.length > 1) return { role: null, matches: exact };

  const partial = roles.filter((role) => roleKey(role.name).includes(wanted));
  if (partial.length === 1) return { role: partial[0], matches: partial };
  return { role: null, matches: partial };
}

/**
 * `!pingrole staff` — pings a role whose name is in the fancy font, so staff
 * never have to type the small-caps characters themselves.
 */
async function handleMessage(message, { store }) {
  const content = String(message.content ?? '').trim();
  const lower = content.toLowerCase();
  const prefix = PREFIXES.find(
    (candidate) => lower === candidate || lower.startsWith(`${candidate} `),
  );
  if (!prefix) return;

  const guild = message.guild;
  if (!guild) return;

  const settings = store.guild(guild.id);
  const silent = { parse: [], users: [], roles: [] };
  const reply = (payload) => message.reply({ ...payload, allowedMentions: silent });

  if (!isStaff(message.member, settings)) {
    await reply({
      embeds: [errorEmbed('Only staff can ping roles this way.', 'Missing permissions')],
    });
    return;
  }

  const query = content.slice(prefix.length).trim().replace(/^@/, '').trim();
  if (!query) {
    await reply({
      embeds: [
        errorEmbed(
          'Name the role after the command, in normal letters: `!pingrole staff`.',
          'Which role?',
        ),
      ],
    });
    return;
  }

  const { role, matches } = findRole(guild, query);
  if (!role) {
    if (matches.length) {
      const list = matches
        .slice(0, 8)
        .map((candidate) => `> ${candidate}`)
        .join('\n');
      await reply({
        embeds: [
          errorEmbed(
            `${matches.length} roles match **${query}**:\n${list}\nUse the full name.`,
            'Which role?',
          ),
        ],
      });
      return;
    }

    await reply({
      embeds: [errorEmbed(`No role in this server matches **${query}**.`, 'Role not found')],
    });
    return;
  }

  // A bare mention is the whole message, so the ping itself is the notification.
  await message
    .reply({
      content: `<@&${role.id}>`,
      allowedMentions: { parse: [], users: [], roles: [role.id] },
    })
    .catch(() => {});
}

module.exports = { PREFIXES, findRole, handleMessage, roleKey };
