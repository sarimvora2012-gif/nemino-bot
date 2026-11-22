'use strict';

const { EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

function parseColor(input) {
  if (typeof input === 'number') return input;
  const hex = String(input ?? '').replace('#', '').trim();
  const parsed = Number.parseInt(hex, 16);
  return Number.isNaN(parsed) ? 0x5865f2 : parsed;
}

/**
 * One palette for the whole bot: red is the accent on every card, bar and
 * button. Danger and warning are deeper / softer reds instead of another hue,
 * so a card never switches colour family.
 */
const RED = 0xed4245;
const RED_DEEP = 0xa1282b;
const RED_SOFT = 0xff7a7d;

const COLORS = {
  brand: parseColor(process.env.EMBED_COLOR || '#ED4245'),
  success: RED,
  danger: RED_DEEP,
  warning: RED_SOFT,
  neutral: 0x2b2d31,
  red: RED,
  deepRed: RED_DEEP,
  softRed: RED_SOFT,
};

const { icon, iconsFor } = require('./emojis');

const EMBED_SIGNATURE = 'made by seraphum';
const TROPHY_EMOJI_NAME = 'trophy';

/** The server's trophy emoji from the pack, falling back to the plain glyph. */
const trophyEmoji = (guild) => icon(guild, 'trophy');

/**
 * Builds a classic embed. Timestamps are off by default — Discord already shows
 * when a message was sent, so the footer only carries the signature. Pass
 * `timestamp: true` (or a date) for the rare card that is a record of a moment.
 */
function embed({
  title,
  description,
  color = COLORS.brand,
  fields = [],
  footer,
  thumbnail,
  timestamp = false,
}) {
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
  if (timestamp) built.setTimestamp(timestamp === true ? new Date() : new Date(timestamp));
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

/**
 * Send an embed (or a ready Components V2 card) to the configured audit log
 * channel, ignoring failures. A card is recognised by its components.
 */
async function sendLog(guild, settings, content) {
  if (!settings?.logChannelId) return;
  const channel = guild.channels.cache.get(settings.logChannelId);
  if (!channel?.isTextBased()) return;
  const payload =
    content && !Array.isArray(content) && Array.isArray(content.components)
      ? content
      : { embeds: Array.isArray(content) ? content : [content] };
  try {
    await channel.send({ ...payload, allowedMentions: { parse: [] } });
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
  TROPHY_EMOJI_NAME,
  trophyEmoji,
  icon,
  iconsFor,
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
