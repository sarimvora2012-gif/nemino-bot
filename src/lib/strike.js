'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, isStaff, safeDM, truncate, COLORS } = require('./helpers');
const v2 = require('./v2');
const { toSmallCaps } = require('./smallcaps');

const PREFIX = '!strike';
const REMOVE_PREFIX = '!strikeremove';
const STRIKES_CHANNEL_ID = '1528258786165260358';

const USAGE = [
  '`!strike @user <reason>` — issue a strike',
  '`!strike list @user` — see every strike on a member',
  '`!strike remove @user S-0001 [reason]` — void a specific strike',
  '`!strikeremove @user <reason>` — void their most recent active strike',
].join('\n');

const VOID_WORDS = new Set(['remove', 'void']);
const MENTION = /^<@!?\d+>$/;

/**
 * Reads a `!strike` message. Returns null when the message is not a strike
 * command, otherwise `{ action, words, reason, id }` where action is one of
 * `add`, `list` or `remove`.
 */
function parseStrikeCommand(content) {
  const raw = String(content ?? '').trim();

  if (/^!strikeremove(\s|$)/i.test(raw)) {
    const tokens = raw
      .slice(REMOVE_PREFIX.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const mentionIndex = tokens.findIndex((token) => MENTION.test(token));
    const reasonWords = mentionIndex >= 0 ? tokens.slice(mentionIndex + 1) : tokens;
    return {
      action: 'remove-latest',
      words: reasonWords,
      reason: reasonWords.join(' ').trim(),
    };
  }

  if (!/^!strike(\s|$)/i.test(raw)) return null;

  const tokens = raw
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const head = (tokens[0] ?? '').toLowerCase();
  const withoutMentions = (list) => list.filter((token) => !MENTION.test(token));

  if (head === 'list') return { action: 'list', words: withoutMentions(tokens.slice(1)), reason: '' };
  if (VOID_WORDS.has(head)) {
    return { action: 'remove', words: withoutMentions(tokens.slice(1)), reason: '' };
  }

  // Everything after the member mention is the reason, so extra mentions in
  // the reason survive instead of being stripped out.
  const mentionIndex = tokens.findIndex((token) => MENTION.test(token));
  const reasonWords = mentionIndex >= 0 ? tokens.slice(mentionIndex + 1) : tokens;
  return { action: 'add', words: reasonWords, reason: reasonWords.join(' ').trim() };
}

/** `S-3`, `s-0003` and `3` all become `S-0003`. */
function normalizeStrikeId(input) {
  const value = String(input ?? '').trim().toUpperCase();
  const match = value.match(/^S?-?(\d{1,6})$/);
  if (!match) return null;
  return `S-${match[1].padStart(4, '0')}`;
}

function strikesEmbed(user, strikes, color = COLORS.brand) {
  const active = strikes.filter((strike) => strike.active);
  const voided = strikes.filter((strike) => !strike.active);
  const total = { Minor: 0, Moderate: 0, Severe: 0 };
  for (const strike of active) {
    if (total[strike.severity] !== undefined) total[strike.severity] += 1;
  }

  const format = (strike) =>
    [
      `**${strike.id}** · ${strike.severity} · ${new Date(strike.createdAt).toISOString().slice(0, 10)}`,
      `> ${truncate(strike.reason, 300)}`,
      `> By <@${strike.moderatorId}>${strike.active ? '' : ` · **voided** by <@${strike.removedBy}>${strike.removeReason ? ` — ${truncate(strike.removeReason, 200)}` : ''}`}`,
    ].join('\n');

  const fields = [
    {
      name: 'Active strikes',
      value: active.length ? active.map(format).join('\n\n') : '_None_',
      inline: false,
    },
    {
      name: 'Summary',
      value: `Minor: **${total.Minor}** · Moderate: **${total.Moderate}** · Severe: **${total.Severe}**`,
      inline: false,
    },
  ];
  if (voided.length) {
    fields.push({
      name: `Voided strikes (${voided.length})`,
      value: truncate(voided.map(format).join('\n\n'), 1024),
      inline: false,
    });
  }

  return embed({
    title: `⚠️ Strikes — ${user.tag}`,
    color: active.length ? color : COLORS.success,
    fields,
    thumbnail: user.displayAvatarURL(),
    footer: `${active.length} active strike${active.length === 1 ? '' : 's'}`,
  });
}

function issuedCard({ member, strike, activeCount, reason }) {
  return v2.card({
    accent: COLORS.danger,
    kicker: toSmallCaps('staff strikes'),
    title: '⚠️ STRIKE ISSUED',
    sections: [
      `👤 **${member}** · 🪪 **${strike.id}** · 📊 **${activeCount}** active · 📝 ${truncate(reason, 400)}`,
    ],
    footer: 'Strike record',
  });
}

function voidedCard({ member, strikeId, remaining, reason }) {
  return v2.card({
    accent: COLORS.success,
    kicker: toSmallCaps('staff strikes'),
    title: '✅ STRIKE VOIDED',
    sections: [
      `👤 **${member}** · 🪪 **${strikeId}** · 📊 **${remaining}** active left · 📝 ${truncate(reason, 400)}`,
    ],
    footer: 'Strike record',
  });
}

/** The staff strikes channel, fetched if it is not cached yet. */
async function resolveStrikesChannel(guild) {
  const cached = guild.channels.cache.get(STRIKES_CHANNEL_ID);
  if (cached?.isTextBased()) return cached;
  const fetched = await guild.channels.fetch(STRIKES_CHANNEL_ID).catch(() => null);
  return fetched?.isTextBased() ? fetched : null;
}

/**
 * Posts a strike card in the staff strikes channel. Falls back to the
 * moderation log and then the channel the command was used in, so a record is
 * never lost when the strikes channel is missing.
 */
async function publishCard(guild, settings, payload, fallbackChannel) {
  const strikesChannel = await resolveStrikesChannel(guild);
  if (strikesChannel) {
    await strikesChannel.send({ ...payload, allowedMentions: { parse: [] } });
    return strikesChannel;
  }

  const logChannel = settings.logChannelId
    ? guild.channels.cache.get(settings.logChannelId)
    : null;
  if (logChannel?.isTextBased()) {
    await logChannel.send({ ...payload, allowedMentions: { parse: [] } });
    return logChannel;
  }

  await fallbackChannel.send({ ...payload, allowedMentions: { parse: [] } });
  return fallbackChannel;
}

async function replyError(message, description, title = 'Strike command') {
  await message
    .reply({ embeds: [errorEmbed(description, title)], allowedMentions: { parse: [] } })
    .catch(() => {});
}

async function resolveTarget(message) {
  const mentioned = message.mentions.members?.first();
  if (mentioned) return mentioned;
  const user = message.mentions.users?.first();
  if (!user) return null;
  return message.guild.members.fetch(user.id).catch(() => null);
}

async function handleMessage(message, { store }) {
  const parsed = parseStrikeCommand(message.content);
  if (!parsed) return;

  const guild = message.guild;
  if (!guild) return;

  const settings = store.guild(guild.id);
  if (!isStaff(message.member, settings)) {
    await replyError(
      message,
      settings.staffRoleId
        ? `<@&${settings.staffRoleId}> or **Manage Server** is required to use strikes.`
        : 'You need **Manage Server** to use strikes. Set a staff role with `/config set staff_role:@role` to let others use them too.',
      'Missing permissions',
    );
    return;
  }

  const isAdmin = message.member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (parsed.action !== 'list' && !isAdmin) {
    await replyError(
      message,
      'Only admins can add or remove strikes. Staff can still use `!strike list @user`.',
      'Missing permissions',
    );
    return;
  }

  const target = await resolveTarget(message);
  if (!target) {
    await replyError(message, `Mention the member first.\n\n${USAGE}`, 'Mention a member');
    return;
  }

  const user = target.user ?? target;

  if (parsed.action === 'list') {
    const strikes = store.strikes(guild.id, user.id);
    await message.channel
      .send({
        embeds: [strikesEmbed(user, strikes)],
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
    await message.delete().catch(() => {});
    return;
  }

  if (user.bot) {
    await replyError(message, 'Strikes only apply to human members.');
    return;
  }

  if (parsed.action === 'add') {
    const reason = parsed.reason;
    if (!reason) {
      await replyError(message, `Add a reason for the strike.\n\n${USAGE}`, 'Reason required');
      return;
    }

    const number = store.nextCounter(guild.id, 'strike');
    const strike = {
      id: `S-${String(number).padStart(4, '0')}`,
      userId: user.id,
      reason,
      severity: 'Minor',
      moderatorId: message.author.id,
      createdAt: new Date().toISOString(),
      active: true,
    };
    store.addStrike(guild.id, user.id, strike);
    const activeCount = store.strikes(guild.id, user.id).filter((item) => item.active).length;

    const card = issuedCard({ member: target, strike, activeCount, reason });

    await publishCard(guild, settings, card, message.channel);
    await message.delete().catch(() => {});

    await safeDM(user, {
      embeds: [
        embed({
          title: '⚠️ You received a strike',
          description: [
            `**Server:** ${guild.name}`,
            `**Strike:** ${strike.id}`,
            `**Reason:** ${reason}`,
            `**Active strikes:** ${activeCount}`,
            '',
            'If you believe this is a mistake, open a ticket and speak with the staff team.',
          ].join('\n'),
          color: COLORS.danger,
        }),
      ],
    });
    return;
  }

  if (parsed.action === 'remove' || parsed.action === 'remove-latest') {
    const removeLatest = parsed.action === 'remove-latest';
    let id;
    let reason;

    if (removeLatest) {
      if (!parsed.reason) {
        await replyError(
          message,
          `Add a reason for removing the strike.\n\n${USAGE}`,
          'Reason required',
        );
        return;
      }
      const active = store
        .strikes(guild.id, user.id)
        .filter((item) => item.active)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      if (!active.length) {
        await replyError(message, `${target} has no active strikes to remove.`);
        return;
      }
      id = active[0].id;
      reason = parsed.reason;
    } else {
      id = normalizeStrikeId(parsed.words[0]);
      if (!id) {
        await replyError(
          message,
          `Give the strike ID, for example \`S-0001\`.\n\n${USAGE}`,
          'Strike ID required',
        );
        return;
      }
      reason = parsed.words.slice(1).join(' ').trim() || 'No reason provided';
    }

    const strike = store.findStrike(guild.id, user.id, id);
    if (!strike) {
      await replyError(message, `No strike **${id}** found for ${target}.`);
      return;
    }
    if (!strike.active) {
      await replyError(message, `Strike **${id}** is already voided.`);
      return;
    }

    store.updateStrike(guild.id, user.id, id, {
      active: false,
      removedBy: message.author.id,
      removedAt: new Date().toISOString(),
      removeReason: reason,
    });
    const remaining = store.strikes(guild.id, user.id).filter((item) => item.active).length;

    const card = voidedCard({ member: target, strikeId: id, remaining, reason });

    await publishCard(guild, settings, card, message.channel);
    await message.delete().catch(() => {});
  }
}

module.exports = {
  PREFIX,
  REMOVE_PREFIX,
  STRIKES_CHANNEL_ID,
  USAGE,
  handleMessage,
  issuedCard,
  normalizeStrikeId,
  parseStrikeCommand,
  resolveStrikesChannel,
  strikesEmbed,
  voidedCard,
};
