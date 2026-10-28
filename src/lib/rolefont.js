'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, COLORS } = require('./helpers');
const { fontKey, toPlain, toSmallCaps } = require('./smallcaps');

const PREFIX = '!stafffont';
const MAX_ROLE_NAME = 100;

/**
 * Splits a readable alias off a role name: `ꜱᴛᴀꜰꜰ (Staff)` gives
 * `{ base: 'ꜱᴛᴀꜰꜰ', alias: 'Staff' }`. A genuine `Staff (EU)` is left whole,
 * because its brackets do not repeat the name after font conversion.
 */
function splitAlias(name) {
  const value = String(name ?? '');
  const match = value.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!match) return { base: value, alias: null };
  const base = match[1].trim();
  const inner = match[2].trim();
  if (!base || !inner || fontKey(inner) !== fontKey(base)) return { base: value, alias: null };
  return { base, alias: inner };
}

/** The words of a name without emoji or surrounding punctuation, title-cased. */
function aliasText(text) {
  return String(text ?? '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .replace(/\p{L}+/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/** `ꜱᴛᴀꜰꜰ (Staff)` — keeps the fun font but lets `@staff` autocomplete. */
function withAlias(smallCaps, plain) {
  if (!plain) return smallCaps;
  const name = `${smallCaps} (${plain})`;
  return [...name].length <= MAX_ROLE_NAME ? name : smallCaps;
}

/**
 * Builds the rename plan for the staff roles.
 *
 * `roles` is anything array-like with `{ id, name, position, managed }`.
 * Every role at or above the staff role counts as a staff role; pass
 * `staffPosition: null` to cover every role the bot is allowed to touch.
 *
 * `readable` appends the plain name in brackets so the `@` menu still finds
 * the role when normal letters are typed.
 *
 * Each entry says what the name becomes, and `blocked` explains why Discord
 * will refuse it (a role at or above the bot's own role cannot be edited).
 */
function planRenames(
  roles,
  { everyoneId, botPosition = null, staffPosition = null, readable = false } = {},
) {
  return [...roles]
    .filter((role) => role && role.id !== everyoneId)
    .filter((role) => !role.managed)
    .filter((role) => staffPosition === null || role.position >= staffPosition)
    .sort((a, b) => b.position - a.position)
    .map((role) => {
      const { base, alias } = splitAlias(role.name);
      const plainBase = toPlain(base).trim();
      const small = toSmallCaps(plainBase);
      const to = readable ? withAlias(small, alias ?? aliasText(plainBase)) : small;
      if (to === role.name) return null;
      const blocked =
        botPosition !== null && role.position >= botPosition
          ? 'it sits at or above my role, so move my bot role above it'
          : null;
      return { id: role.id, from: role.name, to, position: role.position, blocked };
    })
    .filter(Boolean);
}

/** Renames roles from a plan and reports what happened. */
async function applyRenames(roles, plan, reason = 'Staff roles in small caps') {
  const byId = new Map([...roles].map((role) => [role.id, role]));
  const renamed = [];
  const failed = [];

  for (const entry of plan) {
    if (entry.blocked) {
      failed.push({ ...entry, reason: entry.blocked });
      continue;
    }
    const role = byId.get(entry.id);
    const updated = await role?.setName(entry.to, reason).catch((err) => err);
    if (updated instanceof Error) {
      failed.push({ ...entry, reason: updated.message });
      continue;
    }
    if (!role) {
      failed.push({ ...entry, reason: 'the role no longer exists' });
      continue;
    }
    renamed.push(entry);
  }

  return { renamed, failed };
}

/** The roles the command should touch, or null when the staff role is unset. */
function targetRoles(guild, settings, mentioned = null) {
  if (mentioned) return [mentioned];
  const staffRole = settings.staffRoleId ? guild.roles.cache.get(settings.staffRoleId) : null;
  if (!staffRole) return null;
  return [...guild.roles.cache.values()].filter(
    (role) => role.id !== guild.id && !role.managed && role.position >= staffRole.position,
  );
}

function resultEmbed({ renamed, failed }, guild, readable = false) {
  const lines = [
    renamed.length
      ? `**Renamed ${renamed.length} role${renamed.length === 1 ? '' : 's'}**`
      : readable
        ? 'Nothing needed renaming — those roles already show their plain name in brackets.'
        : 'Nothing needed renaming — those roles are already in small caps.',
  ];

  if (renamed.length) {
    lines.push(
      '',
      ...renamed.slice(0, 15).map((entry) => `> **${entry.from}** → ${entry.to}`),
      ...(renamed.length > 15 ? [`> …and ${renamed.length - 15} more`] : []),
    );
  }

  if (failed.length) {
    lines.push('', `⚠️ **${failed.length} could not be renamed**`);
    for (const entry of failed.slice(0, 10)) {
      lines.push(`> **${entry.from}** — ${entry.reason}`);
    }
    if (failed.length > 10) lines.push(`> …and ${failed.length - 10} more`);
  }

  return embed({
    title: '🔤 Staff role font',
    description: lines.join('\n'),
    color: failed.length ? COLORS.warning : COLORS.success,
    footer: guild.name,
  });
}

async function handleMessage(message, { store }) {
  const content = String(message.content ?? '').trim();
  if (content.toLowerCase() !== PREFIX && !content.toLowerCase().startsWith(`${PREFIX} `)) {
    return;
  }

  const guild = message.guild;
  if (!guild) return;
  const settings = store.guild(guild.id);
  const reply = (payload) => message.reply({ ...payload, allowedMentions: { parse: [] } });

  if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply({
      embeds: [
        errorEmbed('You need **Manage Server** to restyle the staff roles.', 'Missing permissions'),
      ],
    });
    return;
  }

  const words = content.split(/\s+/).slice(1).map((word) => word.toLowerCase());
  const readable = words.includes('readable') || words.includes('plain');
  const mentioned = message.mentions?.roles?.first() ?? null;
  const roles = targetRoles(guild, settings, mentioned);
  if (!roles) {
    await reply({
      embeds: [
        errorEmbed(
          'Set the staff floor first with `/config set staff_role:@role` — every role from there up is restyled, or name one role: `!stafffont @role`.',
          'Staff role missing',
        ),
      ],
    });
    return;
  }

  const staffRole = settings.staffRoleId ? guild.roles.cache.get(settings.staffRoleId) : null;
  const plan = planRenames(roles, {
    everyoneId: guild.id,
    botPosition: guild.members.me?.roles?.highest?.position ?? null,
    staffPosition: mentioned ? null : (staffRole?.position ?? null),
    readable,
  });

  const result = await applyRenames(
    roles,
    plan,
    readable ? 'Staff roles in small caps with a plain alias' : 'Staff roles in small caps',
  );
  await reply({ embeds: [resultEmbed(result, guild, readable)] });
}

module.exports = {
  PREFIX,
  aliasText,
  applyRenames,
  handleMessage,
  planRenames,
  splitAlias,
  targetRoles,
  withAlias,
};
