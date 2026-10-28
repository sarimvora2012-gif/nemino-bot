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

/**
 * Owner, configured vouch admin role, or any role with "owner" in its name.
 * The name check is font-insensitive, so a small-capped `👑 ᴄᴏ-ᴏᴡɴᴇʀ` still
 * counts after `!stafffont` has restyled it.
 */
function roleNameSaysOwner(name) {
  return /owner/i.test(name) || toSmallCaps(name).includes(toSmallCaps('owner'));
}

function canManageVouches(member, guild, settings) {
  if (!member) return false;
  if (guild.ownerId === member.id) return true;
  if (settings.vouchAdminRoleId && member.roles?.cache?.has(settings.vouchAdminRoleId)) return true;
  return Boolean(
    member.roles?.cache?.some((role) => roleNameSaysOwner(role.name) && role.id !== guild.id),
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

/**
 * Why the bot cannot rename this member, or null when it can.
 * Discord refuses every one of these silently, which is why a missing
 * permission used to look like the counter was simply broken.
 */
function nicknameBlocker(member, guild = member?.guild) {
  if (!member?.setNickname) return 'this member cannot be renamed.';
  const me = guild?.members?.me;
  if (!me) return 'I am not in this server.';
  if (!me.permissions?.has(PermissionFlagsBits.ManageNicknames)) {
    return 'I am missing the **Manage Nicknames** permission — give it to my role, no re-invite needed.';
  }
  if (guild.ownerId && member.id === guild.ownerId) {
    return 'Discord never lets a bot rename the server owner.';
  }
  const mine = me.roles?.highest?.position;
  const theirs = member.roles?.highest?.position;
  if (Number.isFinite(mine) && Number.isFinite(theirs) && theirs >= mine) {
    return 'their highest role is above mine — move my bot role higher.';
  }
  return null;
}

/**
 * Shows the count next to their name, e.g. "Slash (12)".
 * Returns `{ ok, changed, reason }` so callers can tell "nothing to do" apart
 * from "Discord refused".
 */
async function updateNickname(member, count, guild = member?.guild) {
  if (!member?.setNickname) return { ok: false, changed: false, reason: 'this member cannot be renamed.' };
  const name = withCount(member.displayName, count);
  if (member.displayName === name) return { ok: true, changed: false, reason: null };

  const blocked = nicknameBlocker(member, guild);
  if (blocked) {
    console.warn(`[vouch] Could not rename ${member.user?.tag ?? member.id}: ${blocked}`);
    return { ok: false, changed: false, reason: blocked };
  }

  const updated = await member.setNickname(name, `Vouch count: ${count}`).catch((err) => err);
  if (updated instanceof Error) {
    console.warn(`[vouch] Discord refused the rename of ${member.user?.tag ?? member.id}: ${updated.message}`);
    return { ok: false, changed: false, reason: updated.message };
  }
  return { ok: true, changed: true, reason: null };
}

/** Re-applies every saved count, for members vouched before the bot could rename. */
async function resyncNicknames(guild, store) {
  const settings = store.guild(guild.id);
  const result = { total: 0, updated: 0, already: 0, missing: 0, failed: [] };

  for (const [userId, raw] of Object.entries(settings.vouches ?? {})) {
    const count = Number(raw) || 0;
    if (count <= 0) continue;
    result.total += 1;

    const member =
      guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    if (!member) {
      result.missing += 1;
      continue;
    }

    const applied = await updateNickname(member, count, guild);
    if (applied.ok && applied.changed) result.updated += 1;
    else if (applied.ok) result.already += 1;
    else result.failed.push({ member, count, reason: applied.reason });
  }

  return result;
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

  const nickname = await updateNickname(target, count, guild);
  if (refresh && channel) await refreshPanel(channel, store);

  return { ok: true, count, nickname };
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
          [
            `Added **${amount}** vouch${amount === 1 ? '' : 'es'} to ${target}.`,
            `They now have **${result.count}** vouch${result.count === 1 ? '' : 'es'}.`,
            ...(result.nickname && !result.nickname.ok
              ? [`⚠️ Nickname not updated — ${result.nickname.reason}`]
              : []),
          ].join('\n'),
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

  // !vouchresync — re-apply the count to everyone who already has vouches.
  if (lower === '!vouchresync') {
    if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply({
        embeds: [errorEmbed('You need **Manage Server** to resync vouch nicknames.', 'Missing permissions')],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const synced = await resyncNicknames(guild, store);
    const lines = [
      `**Counted members:** ${synced.total}`,
      `**Nicknames updated:** ${synced.updated}`,
      `**Already correct:** ${synced.already}`,
    ];
    if (synced.missing) lines.push(`**No longer in the server:** ${synced.missing}`);

    if (synced.failed.length) {
      lines.push('', `⚠️ **${synced.failed.length} could not be renamed**`);
      for (const entry of synced.failed.slice(0, 8)) {
        lines.push(`> <@${entry.member.id}> — ${entry.reason}`);
      }
      if (synced.failed.length > 8) lines.push(`> …and ${synced.failed.length - 8} more`);
    }

    await message
      .reply({
        embeds: [
          embed({
            title: '🔄 Vouch nicknames resynced',
            description: lines.join('\n'),
            color: synced.failed.length ? COLORS.warning : COLORS.success,
          }),
        ],
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
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
    [
      `✅ **Vouch counted for ${target}** — they now have **${result.count}** vouch${
        result.count === 1 ? '' : 'es'
      }.`,
      ...(result.nickname && !result.nickname.ok
        ? [`⚠️ Nickname not updated — ${result.nickname.reason}`]
        : []),
    ].join('\n'),
    result.nickname && !result.nickname.ok ? COLORS.warning : COLORS.success,
  );
}

module.exports = {
  CONFIRM_MS,
  canManageVouches,
  handleMessage,
  roleNameSaysOwner,
  isVouchChannel,
  leaderboardCard,
  leaderboardEntries,
  nicknameBlocker,
  panelCard,
  parseVouch,
  refreshPanel,
  registerVouch,
  resyncNicknames,
  updateNickname,
  withCount,
};
