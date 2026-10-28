'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, successEmbed, sendLog, COLORS } = require('./helpers');
const v2 = require('./v2');
const { toSmallCaps } = require('./smallcaps');

const VOUCH_COMMANDS = [':vouch', 'vouch'];
const CONFIRM_MS = 3000;
const MAX_NICKNAME = 32;
const MAX_MANUAL_ADD = 1000;

/** The vouch channels: configured IDs first, then anything named like a vouch channel. */
function isVouchChannel(channel, settings) {
  if (!channel?.isTextBased?.()) return false;
  if (settings.vouchChannelId && settings.vouchChannelId === channel.id) return true;
  if (settings.staffVouchChannelId && settings.staffVouchChannelId === channel.id) return true;
  const name = channel.name ?? '';
  if (/vouch/i.test(name)) return true;
  // This server names channels in small caps (ᴠᴏᴜᴄʜ), which /vouch/i misses.
  return toSmallCaps(name).includes(toSmallCaps('vouch'));
}

/** Reads the `:vouch @user` line. Returns the mentioned member or null. */
function parseVouch(message) {
  const firstLine = String(message.content ?? '')
    .trim()
    .split('\n')[0]
    .trim()
    .toLowerCase();
  const isVouch = VOUCH_COMMANDS.some(
    (command) => firstLine === command || firstLine.startsWith(`${command} `),
  );
  if (!isVouch) return null;
  return message.mentions?.members?.first() ?? null;
}

/** Owner, configured vouch admin role, or any role with "owner" in its name. */
function canManageVouches(member, guild, settings) {
  if (!member) return false;
  if (guild.ownerId === member.id) return true;
  if (settings.vouchAdminRoleId && member.roles?.cache?.has(settings.vouchAdminRoleId)) return true;
  return Boolean(
    member.roles?.cache?.some((role) => /owner/i.test(role.name) && role.id !== guild.id),
  );
}

function withCount(name, count) {
  const base = String(name ?? '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .trim();
  const suffix = ` (${count})`;
  const trimmed = [...base].slice(0, Math.max(1, MAX_NICKNAME - suffix.length)).join('').trim();
  return `${trimmed || 'Member'}${suffix}`;
}

/** Shows the count next to their name, e.g. "Slash (12)". */
async function updateNickname(member, count) {
  if (!member?.setNickname) return false;
  const name = withCount(member.displayName, count);
  if (member.displayName === name) return false;
  const updated = await member.setNickname(name, `Vouch count: ${count}`).catch(() => null);
  return Boolean(updated);
}

/** One plain instruction line, matching how other vouch bots word it. */
const PANEL_TEXT = 'Vouches must be in the format: `vouch <@member>`';

function panelCard() {
  return { content: PANEL_TEXT };
}

/**
 * Deletes the previous panel and posts a fresh one, so the how-to message is
 * always the most recent message in the channel. Nothing is pinned.
 */
async function refreshPanel(channel, store) {
  const settings = store.guild(channel.guild.id);
  const previousId = settings.vouchPanels?.[channel.id];
  if (previousId) {
    const previous = await channel.messages.fetch(previousId).catch(() => null);
    if (previous) {
      if (previous.pinned) await previous.unpin().catch(() => {});
      await previous.delete().catch(() => {});
    }
  }

  const message = await channel
    .send({ ...panelCard(), allowedMentions: { parse: [] } })
    .catch((err) => {
      console.error('[vouch] Failed to post the vouch panel:', err.message);
      return null;
    });
  if (!message) return null;

  settings.vouchPanels = settings.vouchPanels ?? {};
  settings.vouchPanels[channel.id] = message.id;
  store.save();
  return message;
}

/** Small confirmation that disappears after a few seconds. */
async function sendConfirmation(channel, text, color = COLORS.success) {
  const message = await channel
    .send({ embeds: [embed({ description: text, color })] })
    .catch(() => null);
  if (!message) return null;
  const timer = setTimeout(() => message.delete().catch(() => {}), CONFIRM_MS);
  timer.unref?.();
  return message;
}

/**
 * Adds one vouch to a member and keeps the nickname and channel panel in sync.
 * Returns `{ ok, count }` or `{ ok: false, reason }`.
 */
async function registerVouch({
  guild,
  target,
  voucher,
  store,
  channel = null,
  amount = 1,
  refresh = true,
}) {
  if (!target || target.user?.bot) return { ok: false, reason: 'Bot accounts cannot be vouched for.' };
  if (voucher && voucher.id === target.id) return { ok: false, reason: 'You cannot vouch for yourself.' };

  const settings = store.guild(guild.id);
  settings.vouches = settings.vouches ?? {};
  const count = (settings.vouches[target.id] ?? 0) + amount;
  settings.vouches[target.id] = count;
  store.save();

  await updateNickname(target, count);
  if (refresh && channel) await refreshPanel(channel, store);

  return { ok: true, count };
}

function leaderboardEntries(settings, limit = 10) {
  return Object.entries(settings.vouches ?? {})
    .map(([id, count]) => ({ id, count: Number(count) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function leaderboardCard(guild, settings) {
  const entries = leaderboardEntries(settings);
  const total = Object.values(settings.vouches ?? {}).reduce(
    (sum, count) => sum + (Number(count) || 0),
    0,
  );
  const medals = ['🥇', '🥈', '🥉'];
  const lines = entries.map(
    (entry, index) =>
      `${medals[index] ?? `\`#${index + 1}\``} <@${entry.id}> · **${entry.count}** vouch${
        entry.count === 1 ? '' : 'es'
      }`,
  );

  return v2.card({
    accent: COLORS.brand,
    kicker: toSmallCaps('vouch leaderboard'),
    title: '🏆 TOP VOUCHED',
    subtitle: `${total} vouch${total === 1 ? '' : 'es'} given in this server`,
    description: lines.length ? lines.join('\n') : '> 🌱 No vouches yet — be the first to vouch!',
    footer: guild.name,
    thumbnail: guild.iconURL?.({ size: 256 }) ?? undefined,
  });
}

function parseAmount(input) {
  const value = Number.parseInt(String(input ?? '').replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(value) || value < 1) return null;
  return Math.min(value, MAX_MANUAL_ADD);
}

async function handleMessage(message, { store }) {
  const guild = message.guild;
  if (!guild || message.author?.bot) return;
  const settings = store.guild(guild.id);
  const content = message.content.trim();
  const lower = content.toLowerCase();
  if (!content) return;

  // !vouchsetup — post or refresh the pinned panel.
  if (lower === '!vouchsetup') {
    if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply({
        embeds: [errorEmbed('You need **Manage Server** to set up the vouch panel.', 'Missing permissions')],
        allowedMentions: { parse: [] },
      });
      return;
    }
    const panel = await refreshPanel(message.channel, store);
    await message
      .reply({
        embeds: [
          panel
            ? successEmbed('Vouch panel posted', 'It is refreshed after every vouch, so it stays at the bottom of the channel.')
            : errorEmbed('I could not post the panel here.', 'Panel failed'),
        ],
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
    return;
  }

  // !vouchadd @user <amount> — owner and co-owner only.
  if (lower === '!vouchadd' || lower.startsWith('!vouchadd ')) {
    if (!canManageVouches(message.member, guild, settings)) {
      await message.reply({
        embeds: [
          errorEmbed(
            'Only the **owner** and **co-owner** can add vouches manually.',
            'Missing permissions',
          ),
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const target = message.mentions.members?.first() ?? null;
    if (!target) {
      await message.reply({
        embeds: [errorEmbed('Mention the member first: `!vouchadd @user 5`.', 'Who?')],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const args = content.split(/\s+/).slice(1).filter((part) => !/^<@!?\d+>$/.test(part));
    const amount = parseAmount(args[0]);
    if (!amount) {
      await message.reply({
        embeds: [errorEmbed('Give an amount of vouches, for example `!vouchadd @user 5`.', 'Amount missing')],
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (target.user?.bot) {
      await message.reply({
        embeds: [errorEmbed('Bots cannot be vouched for.')],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const result = await registerVouch({ guild, target, voucher: null, store, amount });
    if (!result.ok) {
      await message.reply({
        embeds: [errorEmbed(result.reason)],
        allowedMentions: { parse: [] },
      });
      return;
    }

    await message.reply({
      embeds: [
        successEmbed(
          'Vouches added',
          `Added **${amount}** vouch${amount === 1 ? '' : 'es'} to ${target}.\nThey now have **${result.count}** vouch${result.count === 1 ? '' : 'es'}.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });

    await sendLog(guild, settings, [
      embed({
        title: '🛠️ Vouches added manually',
        description: [
          `**Member:** ${target} \`${target.user.tag}\``,
          `**Amount:** ${amount}`,
          `**Total now:** ${result.count}`,
          `**By:** ${message.author} \`${message.author.tag}\``,
        ].join('\n'),
        color: COLORS.warning,
      }),
    ]);
    return;
  }

  if (!isVouchChannel(message.channel, settings)) return;

  const target = parseVouch(message);
  if (!target) {
    if (content.startsWith(':')) {
      await sendConfirmation(
        message.channel,
        `⚠️ **Vouch not counted.** Mention the member: \`:vouch @user\`.`,
        COLORS.warning,
      );
    }
    return;
  }

  const result = await registerVouch({
    guild,
    target,
    voucher: message.author,
    store,
    channel: message.channel,
  });

  if (!result.ok) {
    await sendConfirmation(message.channel, `⚠️ ${result.reason}`, COLORS.danger);
    return;
  }

  await sendConfirmation(
    message.channel,
    `✅ **Vouch counted for ${target}** — they now have **${result.count}** vouch${
      result.count === 1 ? '' : 'es'
    }.`,
  );
}

module.exports = {
  CONFIRM_MS,
  canManageVouches,
  handleMessage,
  isVouchChannel,
  leaderboardCard,
  leaderboardEntries,
  panelCard,
  parseVouch,
  refreshPanel,
  registerVouch,
  updateNickname,
  withCount,
};
