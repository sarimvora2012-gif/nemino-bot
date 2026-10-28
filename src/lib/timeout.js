'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, successEmbed, sendLog, safeDM, COLORS, timestamp, relative } = require('./helpers');

const PREFIX = '!to';
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord's hard limit
const MIN_TIMEOUT_MS = 60 * 1000;

/**
 * Reads `10`, `10m`, `1h`, `2d` or `1w`. A bare number means minutes.
 * Returns milliseconds, or null when the value is not a usable time.
 */
function parseTimeoutTime(input) {
  const match = String(input ?? '')
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(s|m|h|d|w)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const ms = amount * units[match[2] ?? 'm'];
  if (!Number.isFinite(ms) || ms < MIN_TIMEOUT_MS || ms > MAX_TIMEOUT_MS) return null;
  return ms;
}

function formatTimeout(ms) {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.join(' ') || '0m';
}

function splitArgs(content) {
  return content.trim().split(/\s+/).slice(1);
}

async function handleMessage(message, { store }) {
  const content = String(message.content ?? '').trim();
  const lower = content.toLowerCase();
  if (lower !== PREFIX && !lower.startsWith(`${PREFIX} `)) return;

  const guild = message.guild;
  if (!guild) return;
  const settings = store.guild(guild.id);
  const usage = 'Usage: `!to @user 10m [reason]` — times accept `10m`, `1h`, `2d` or `1w` (max 28 days).';

  if (!message.member?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
    await message.reply({
      embeds: [
        errorEmbed('You need **Timeout Members** to time someone out.', 'Missing permissions'),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const target = message.mentions.members?.first() ?? null;
  if (!target) {
    await message.reply({
      embeds: [errorEmbed(usage, 'Mention a member')],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const args = splitArgs(content).filter((part) => !/^<@!?\d+>$/.test(part));
  const ms = parseTimeoutTime(args[0]);
  if (!ms) {
    await message.reply({
      embeds: [errorEmbed(usage, 'Invalid time')],
      allowedMentions: { parse: [] },
    });
    return;
  }
  const reason = args.slice(1).join(' ').trim() || 'No reason provided';

  if (target.user?.bot) {
    await message.reply({
      embeds: [errorEmbed('Bots cannot be timed out.')],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (target.id === message.author.id) {
    await message.reply({
      embeds: [errorEmbed('You cannot time yourself out.')],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const moderatorHighest = message.member.roles?.highest?.position ?? 0;
  const isOwner = guild.ownerId === message.author.id;
  const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isOwner && !isAdmin && (target.roles?.highest?.position ?? 0) >= moderatorHighest) {
    await message.reply({
      embeds: [
        errorEmbed(
          `${target} has a role equal to or above yours, so they cannot be timed out by you.`,
          'Role hierarchy',
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (!target.moderatable) {
    await message.reply({
      embeds: [
        errorEmbed(
          `I cannot time ${target} out. Move my bot role above theirs and make sure I have **Moderate Members**.`,
          'Missing permissions',
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const expiresAt = new Date(Date.now() + ms);
  try {
    await target.timeout(ms, `${reason} — by ${message.author.tag}`);
  } catch (err) {
    console.error('[timeout] Failed to time out a member:', err);
    await message.reply({
      embeds: [errorEmbed(`Discord rejected the timeout: ${err.message}`, 'Timeout failed')],
      allowedMentions: { parse: [] },
    });
    return;
  }

  await message.reply({
    embeds: [
      successEmbed(
        'Member timed out',
        [
          `**Member:** ${target} \`${target.user.tag}\``,
          `**Duration:** ${formatTimeout(ms)}`,
          `**Ends:** ${timestamp(expiresAt)} (${relative(expiresAt)})`,
          `**Reason:** ${reason}`,
        ].join('\n'),
      ),
    ],
    allowedMentions: { parse: [] },
  });

  await sendLog(guild, settings, [
    embed({
      title: '⏳ Member timed out',
      description: [
        `**Member:** ${target} \`${target.user.tag}\` (\`${target.id}\`)`,
        `**Moderator:** ${message.author} \`${message.author.tag}\``,
        `**Duration:** ${formatTimeout(ms)}`,
        `**Ends:** ${timestamp(expiresAt)} (${relative(expiresAt)})`,
        `**Channel:** ${message.channel}`,
        `**Reason:** ${reason}`,
      ].join('\n'),
      color: COLORS.warning,
      footer: 'Moderation log',
    }),
  ]);

  await safeDM(target.user, {
    embeds: [
      embed({
        title: '⏳ You were timed out',
        description: [
          `**Server:** ${guild.name}`,
          `**Duration:** ${formatTimeout(ms)}`,
          `**Ends:** ${timestamp(expiresAt)} (${relative(expiresAt)})`,
          `**Reason:** ${reason}`,
        ].join('\n'),
        color: COLORS.warning,
      }),
    ],
  });
}

module.exports = { PREFIX, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS, formatTimeout, handleMessage, parseTimeoutTime };
