'use strict';

const { EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

function parseColor(input) {
  if (typeof input === 'number') return input;
  const hex = String(input ?? '').replace('#', '').trim();
  const parsed = Number.parseInt(hex, 16);
  return Number.isNaN(parsed) ? 0x5865f2 : parsed;
}

const COLORS = {
  brand: parseColor(process.env.EMBED_COLOR || '#5865F2'),
  success: 0x57f287,
  danger: 0xed4245,
  warning: 0xfee75c,
  neutral: 0x2b2d31,
};

const EMBED_SIGNATURE = 'made by seraphum';

function embed({ title, description, color = COLORS.brand, fields = [], footer, thumbnail }) {
  const built = new EmbedBuilder().setColor(color);
  if (title) built.setTitle(title);
  if (description) built.setDescription(description);
  if (fields.length) built.addFields(fields);

  const footerText = footer
    ? String(footer).includes(EMBED_SIGNATURE)
      ? String(footer)
      : `${footer} · ${EMBED_SIGNATURE}`
    : EMBED_SIGNATURE;
  built.setFooter({
    text: footerText.length > 2048 ? `${footerText.slice(0, 2047)}…` : footerText,
  });

  if (thumbnail) built.setThumbnail(thumbnail);
  built.setTimestamp(new Date());
  return built;
}

const successEmbed = (title, description) => embed({ title, description, color: COLORS.success });
const errorEmbed = (description, title = 'Something went wrong') =>
  embed({ title, description, color: COLORS.danger });
const infoEmbed = (title, description) => embed({ title, description, color: COLORS.brand });
const warningEmbed = (title, description) => embed({ title, description, color: COLORS.warning });

function truncate(text, max = 1024) {
  const value = String(text ?? '');
  if (value.length <= max) return value || '—';
  return `${value.slice(0, max - 1)}…`;
}

/** A member is staff if they manage the server or hold the configured staff role. */
function isStaff(member, settings) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return Boolean(settings?.staffRoleId && member.roles?.cache?.has(settings.staffRoleId));
}

/**
 * Replies with an error and returns false when the user is not staff.
 * Ephemeral so it never clutters the channel.
 */
async function requireStaff(interaction, settings) {
  if (isStaff(interaction.member, settings)) return true;
  const message = settings?.staffRoleId
    ? `<@&${settings.staffRoleId}> or **Manage Server** is required to use this.`
    : 'You need **Manage Server** to use this. Set a staff role with `/config set staff_role:@role` to let others use it too.';
  await interaction.reply({ embeds: [errorEmbed(message, 'Missing permissions')], flags: MessageFlags.Ephemeral });
  return false;
}

/** True when the bot can assign/remove this role (role below the bot's top role). */
function canManageRole(guild, role) {
  const me = guild.members.me;
  if (!me || !role) return false;
  return role.position < me.roles.highest.position && !role.managed;
}

const timestamp = (date = new Date()) => `<t:${Math.floor(new Date(date).getTime() / 1000)}:f>`;
const relative = (date = new Date()) => `<t:${Math.floor(new Date(date).getTime() / 1000)}:R>`;

/** Send an embed to the configured audit log channel, ignoring failures. */
async function sendLog(guild, settings, embeds) {
  if (!settings?.logChannelId) return;
  const channel = guild.channels.cache.get(settings.logChannelId);
  if (!channel?.isTextBased()) return;
  try {
    await channel.send({
      embeds: Array.isArray(embeds) ? embeds : [embeds],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[log] Failed to send log message:', err.message);
  }
}

async function safeDM(user, payload) {
  try {
    return await user.send(payload);
  } catch {
    return null;
  }
}

module.exports = {
  COLORS,
  EMBED_SIGNATURE,
  embed,
  successEmbed,
  errorEmbed,
  infoEmbed,
  warningEmbed,
  truncate,
  isStaff,
  requireStaff,
  canManageRole,
  timestamp,
  relative,
  sendLog,
  safeDM,
};
