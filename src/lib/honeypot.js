'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, sendLog, safeDM, COLORS } = require('./helpers');
const v2 = require('./v2');
const { toSmallCaps } = require('./smallcaps');

const PREFIX = '!honeypot';
const INVITE_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]{2,64})\/?$/i;

const USAGE = [
  '`!honeypot` — turn the current channel into a honeypot',
  '`!honeypot https://discord.gg/xxxx` — same, but use that invite in the kick DM',
  '`!honeypot off` — disable the honeypot',
].join('\n');

/** Reads a `!honeypot` message. `off` disables, an invite link is stored, anything else sets up. */
function parseHoneypotCommand(content) {
  const raw = String(content ?? '').trim();
  if (!/^!honeypot(\s|$)/i.test(raw)) return null;

  const args = raw
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const head = (args[0] ?? '').toLowerCase();
  if (head === 'off' || head === 'disable') return { action: 'off' };

  const invite = args.map((arg) => arg.match(INVITE_PATTERN)).find(Boolean);
  return { action: 'setup', invite: invite ? `https://discord.gg/${invite[1]}` : null };
}

function panelCard() {
  return v2.card({
    accent: COLORS.danger,
    kicker: toSmallCaps('server security'),
    title: '🍯 HONEYPOT CHANNEL',
    quote: '> 🚫 **DO NOT TALK IN HERE**',
    sections: [
      '> ⛔ Sending **any** message in this channel kicks you from the server instantly.',
      '> 🪤 This channel exists to catch compromised accounts posting scam links.',
      '> 📩 The bot DMs you an invite so you can rejoin once your account is safe.',
      '> ✅ Keep this channel muted and never type in it.',
    ],
    footer: 'Honeypot active — do not type here',
  });
}

function canInvite(channel, guild) {
  if (!channel?.isTextBased?.()) return false;
  const me = guild.members.me;
  if (!me) return false;
  return Boolean(channel.permissionsFor?.(me)?.has(PermissionFlagsBits.CreateInstantInvite));
}

/** Where to create a permanent public invite: rules, system, welcome-ish, then anything usable. */
function pickInviteChannel(guild) {
  for (const channel of [guild.rulesChannel, guild.systemChannel, guild.publicUpdatesChannel]) {
    if (canInvite(channel, guild)) return channel;
  }
  const named = guild.channels.cache.find(
    (channel) => canInvite(channel, guild) && /rules|welcome|general|main|chat/i.test(channel.name ?? ''),
  );
  if (named) return named;
  return guild.channels.cache.find((channel) => canInvite(channel, guild)) ?? null;
}

/** Reuses a never-expiring invite, otherwise creates one so the DM link keeps working. */
async function resolveInvite(guild, existingUrl = null) {
  if (existingUrl) return existingUrl;

  const invites = await guild.invites.fetch().catch(() => null);
  const permanent = invites?.find((invite) => invite.maxAge === 0 && invite.maxUses === 0);
  if (permanent) return permanent.url;

  const channel = pickInviteChannel(guild);
  if (!channel) return null;

  const created = await guild.invites
    .create(channel, {
      maxAge: 0,
      maxUses: 0,
      unique: false,
      reason: 'Honeypot rejoin invite',
    })
    .catch((err) => {
      console.error('[honeypot] Failed to create an invite:', err.message);
      return null;
    });

  return created?.url ?? null;
}

async function replyAndClean(message, payload) {
  const sent = await message.reply({ ...payload, allowedMentions: { parse: [] } }).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), 10_000).unref?.();
  await message.delete().catch(() => {});
}

async function handleMessage(message, { store }) {
  const parsed = parseHoneypotCommand(message.content);
  const guild = message.guild;
  if (!guild) return;

  if (parsed) {
    await handleCommand(message, guild, parsed, store);
    return;
  }

  // Everything else is checked against the configured honeypot channel.
  const settings = store.guild(guild.id);
  const honeypot = settings.honeypot;
  if (!honeypot?.channelId || honeypot.channelId !== message.channelId) return;
  if (message.author?.bot) return;

  const member = message.member;
  if (!member) return;

  // Admins and the owner need the channel to manage it; everyone else is kicked.
  const isAdmin =
    guild.ownerId === member.id ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (isAdmin) return;

  const channelName = message.channel?.name ?? 'honeypot';

  await message.delete().catch(() => {});

  const inviteUrl = await resolveInvite(guild, honeypot.inviteUrl);
  if (inviteUrl) {
    settings.honeypot.inviteUrl = inviteUrl;
    store.save();
  }

  const dmSent = await safeDM(member.user, {
    embeds: [
      embed({
        title: '🍯 You were kicked — honeypot channel',
        description: [
          `**Server:** ${guild.name}`,
          `**Channel:** #${channelName}`,
          '',
          'You sent a message in a channel marked **DO NOT TALK IN HERE**. That channel only exists to catch compromised accounts, so any message in it triggers an automatic kick.',
          '',
          '**If your account is fine**, this was just a slip — come straight back:',
          inviteUrl ?? 'Ask a staff member for a new invite.',
          '',
          '**If you did not write that message**, your account may be compromised. Change your password, turn on 2FA, then rejoin with the link above.',
        ].join('\n'),
        color: COLORS.danger,
        footer: 'Honeypot system',
      }),
    ],
  });

  let kicked = false;
  try {
    await member.kick(`Honeypot: typed in #${channelName} (possible compromised account)`);
    kicked = true;
  } catch (err) {
    console.error('[honeypot] Failed to kick member:', err.message);
  }

  await sendLog(guild, settings, [
    embed({
      title: kicked ? '🍯 Honeypot triggered — member kicked' : '🍯 Honeypot triggered — kick failed',
      description: [
        `**Member:** ${member}`,
        `**Channel:** #${channelName}`,
        `**Message:** ${String(message.content ?? '').slice(0, 300) || '_no text_'}`,
        `**DM with invite:** ${dmSent ? 'sent' : 'not delivered'}`,
        `**Kick:** ${kicked ? 'done' : 'failed — check my role position and Kick Members'}`,
      ].join('\n'),
      color: COLORS.danger,
      thumbnail: member.user.displayAvatarURL(),
      footer: 'Security log',
    }),
  ]);
}

async function handleCommand(message, guild, parsed, store) {
  const settings = store.guild(guild.id);

  if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await replyAndClean(message, {
      embeds: [errorEmbed('You need **Manage Server** to set up the honeypot.', 'Missing permissions')],
    });
    return;
  }

  const previous = settings.honeypot;

  if (parsed.action === 'off') {
    if (!previous?.channelId) {
      await replyAndClean(message, {
        embeds: [errorEmbed('No honeypot is set up right now.')],
      });
      return;
    }
    if (previous.messageId) {
      const oldChannel = guild.channels.cache.get(previous.channelId);
      const oldMessage = oldChannel?.messages
        ? await oldChannel.messages.fetch(previous.messageId).catch(() => null)
        : null;
      await oldMessage?.delete().catch(() => {});
    }
    settings.honeypot = { channelId: null, messageId: null, inviteUrl: previous.inviteUrl ?? null };
    store.save();
    await replyAndClean(message, {
      embeds: [
        embed({
          title: 'Honeypot disabled',
          description: 'Messages in the old honeypot channel are no longer punished.',
          color: COLORS.success,
        }),
      ],
    });
    return;
  }

  const inviteUrl = await resolveInvite(guild, parsed.invite ?? previous?.inviteUrl ?? null);
  if (!inviteUrl) {
    await replyAndClean(message, {
      embeds: [
        errorEmbed(
          [
            'I could not create an invite, so a caught member would have no way back in.',
            'Give me **Create Invite** in a public channel, or pass your own link:',
            '`!honeypot https://discord.gg/xxxx`',
          ].join('\n'),
          'Invite needed',
        ),
      ],
    });
    return;
  }

  if (previous?.messageId && previous.channelId !== message.channelId) {
    const oldChannel = guild.channels.cache.get(previous.channelId);
    const oldMessage = oldChannel?.messages
      ? await oldChannel.messages.fetch(previous.messageId).catch(() => null)
      : null;
    await oldMessage?.delete().catch(() => {});
  }

  const panel = panelCard();
  const panelMessage = await message.channel.send({
    ...panel,
    allowedMentions: { parse: [] },
  });

  settings.honeypot = {
    channelId: message.channelId,
    messageId: panelMessage.id,
    inviteUrl,
  };
  store.save();

  await replyAndClean(message, {
    embeds: [
      embed({
        title: '🍯 Honeypot armed',
        description: [
          `**Channel:** ${message.channel}`,
          `**Invite sent on kick:** ${inviteUrl}`,
          '',
          'Anyone who sends a message here is kicked and DMed that invite.',
          'Admins and the server owner are never kicked.',
          'Run `!honeypot off` to disable it.',
        ].join('\n'),
        color: COLORS.success,
      }),
    ],
  });
}

module.exports = {
  PREFIX,
  USAGE,
  handleMessage,
  parseHoneypotCommand,
  panelCard,
  pickInviteChannel,
  resolveInvite,
};
