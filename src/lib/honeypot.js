'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { embed, errorEmbed, sendLog, safeDM, COLORS } = require('./helpers');
const v2 = require('./v2');
const { toPlain, toSmallCaps } = require('./smallcaps');

const PREFIX = '!honeypot';
const INVITE_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]{2,64})\/?$/i;

/** How long the fallback "you are immune" note stays when DMs are closed. */
const IMMUNE_NOTE_MS = 8_000;

const USAGE = [
  '`!honeypot` — turn the current channel into a honeypot',
  '`!honeypot https://discord.gg/xxxx` — same, but use that invite in the kick DM',
  '`!honeypot off` — disable the honeypot',
].join('\n');

/**
 * Permissions that mean "moderator or above". Manage Messages is deliberately
 * left out: helpers can hold it without being moderators.
 */
const IMMUNE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
];

/** Role words that count as moderator level, matched in any font. */
const MOD_ROLE_WORDS = new Set([
  'mod',
  'mods',
  'moderator',
  'moderators',
  'admin',
  'admins',
  'administrator',
  'manager',
  'manager',
  'owner',
  'coowner',
  'headmod',
]);

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

/** True when a role name means moderator level, whatever font it is written in. */
function roleNameIsModLevel(name) {
  const words = toPlain(String(name ?? ''))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  if (MOD_ROLE_WORDS.has(words.join(''))) return true;
  return words.some((word) => MOD_ROLE_WORDS.has(word));
}

/** Moderators and above are immune: they need the channel to manage it. */
function isModOrAbove(member, guild) {
  if (!member) return false;
  if (guild?.ownerId && guild.ownerId === member.id) return true;
  if (IMMUNE_PERMISSIONS.some((flag) => member.permissions?.has?.(flag))) return true;
  return Boolean(
    member.roles?.cache?.some?.(
      (role) => role?.id !== guild?.id && roleNameIsModLevel(role?.name),
    ),
  );
}

function panelCard(kicks = 0) {
  const count = Number(kicks) || 0;
  return v2.card({
    accent: COLORS.danger,
    kicker: toSmallCaps('server security'),
    title: '🍯 HONEYPOT CHANNEL',
    quote: '> 🚫 **DO NOT TALK IN HERE**',
    stats: [
      { emoji: '🚪', label: 'Kicked', value: `${count}` },
      { emoji: '🛡️', label: 'Mods', value: 'immune' },
    ],
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

/** True when the channel's name still reads as a honeypot, in any font. */
function looksLikeHoneypotChannel(channel) {
  return /honeypot/i.test(toPlain(String(channel?.name ?? '')));
}

/**
 * Should a message in this channel trigger the honeypot? A stored channel id
 * that Discord no longer has (deleted and re-created channel) is replaced by a
 * channel with a honeypot name, so the trap cannot go silently dead.
 */
function isArmedChannel(settings, channel) {
  const config = settings?.honeypot;
  if (!config?.channelId || !channel) return false;
  if (config.channelId === channel.id) return true;
  const stored = channel.guild?.channels?.cache?.get?.(config.channelId);
  return !stored && looksLikeHoneypotChannel(channel);
}

/** Why Discord would refuse a kick, or null when a kick should work. */
function kickBlocker(guild, member) {
  const me = guild?.members?.me;
  if (!me) return 'I could not read my own member record in this server.';

  const allowed =
    me.permissions?.has?.(PermissionFlagsBits.KickMembers) ||
    me.permissions?.has?.(PermissionFlagsBits.Administrator);
  if (!allowed) return 'I am missing the **Kick Members** permission.';

  const myTop = me.roles?.highest?.position ?? 0;
  const theirTop = member?.roles?.highest?.position ?? 0;
  if (theirTop >= myTop) {
    return 'Their top role sits at or above my own, so Discord blocks the kick. Move my role above theirs.';
  }
  return null;
}

/**
 * The newest bot message with components in the channel, used when a stored
 * panel id is gone so a re-created channel does not get a second panel.
 */
async function findExistingPanel(channel, botId) {
  if (!botId || !channel?.messages?.fetch) return null;
  const fetched = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!fetched) return null;
  const list = fetched instanceof Map ? [...fetched.values()] : Array.isArray(fetched) ? fetched : [];
  return (
    list.find(
      (entry) => entry?.author?.id === botId && (entry.components?.length ?? 0) > 0,
    ) ?? null
  );
}

/** Sends or fixes the panel so the kick count on it stays current. */
async function ensurePanel(channel, settings, store) {
  if (!channel?.isTextBased?.()) return null;
  const config = settings.honeypot;
  const payload = { ...panelCard(config.kicks ?? 0), allowedMentions: { parse: [] } };

  const existing =
    (config.messageId ? await channel.messages.fetch(config.messageId).catch(() => null) : null) ??
    (await findExistingPanel(channel, channel.client?.user?.id));

  if (existing) {
    if (settings.honeypot.messageId !== existing.id) {
      settings.honeypot.messageId = existing.id;
      store.save();
    }
    await existing.edit(payload).catch(() => {});
    return existing;
  }

  const panel = await channel.send(payload).catch((err) => {
    console.error('[honeypot] Could not post the panel:', err.message);
    return null;
  });
  if (panel) {
    settings.honeypot.messageId = panel.id;
    store.save();
  }
  return panel;
}

/** Re-renders the panel in the armed channel after the count changes. */
async function refreshPanel(guild, settings, store) {
  const config = settings.honeypot;
  if (!config?.channelId || !config?.messageId) return;
  const channel = guild.channels?.cache?.get(config.channelId);
  if (!channel) return;
  await ensurePanel(channel, settings, store);
}

async function sendImmuneNotice(member, channel) {
  const payload = {
    embeds: [
      embed({
        title: '🛡️ Honeypot — you are immune',
        description: [
          `You typed in ${channel}, which is a **honeypot**: it exists to catch compromised accounts.`,
          'Your message was removed, but **moderators and above are never kicked**.',
          '',
          'Please do not type there again.',
        ].join('\n'),
        color: COLORS.warning,
        footer: 'Honeypot system',
      }),
    ],
  };

  const dmed = await safeDM(member.user, payload);
  if (dmed) return true;

  // DMs closed. A channel message is the only fallback; it is removed quickly.
  const note = await channel
    .send({ content: `<@${member.id}>`, ...payload, allowedMentions: { users: [member.id] } })
    .catch(() => null);
  if (note) setTimeout(() => note.delete().catch(() => {}), IMMUNE_NOTE_MS).unref?.();
  return false;
}

async function handleMessage(message, { store }) {
  const guild = message.guild;
  if (!guild) return;

  const parsed = parseHoneypotCommand(message.content);
  if (parsed) {
    await handleCommand(message, guild, parsed, store);
    return;
  }

  const settings = store.guild(guild.id);
  if (!isArmedChannel(settings, message.channel)) return;
  if (message.author?.bot || message.system) return;

  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;

  const channelName = message.channel?.name ?? 'honeypot';

  // The armed channel was deleted and re-created: take over the new one.
  if (settings.honeypot.channelId !== message.channelId) {
    settings.honeypot = {
      ...settings.honeypot,
      channelId: message.channelId,
      channelName: channelName,
      messageId: null,
    };
    store.save();
    await ensurePanel(message.channel, settings, store);
  }

  if (isModOrAbove(member, guild)) {
    await message.delete().catch(() => {});
    const dmed = await sendImmuneNotice(member, message.channel);
    await sendLog(guild, settings, [
      embed({
        title: '🛡️ Honeypot ignored — moderator',
        description: [
          `**Member:** ${member}`,
          `**Channel:** #${channelName}`,
          `**Message:** ${String(message.content ?? '').slice(0, 300) || '_no text_'}`,
          `**Notice:** ${dmed ? 'DM sent' : 'DM closed, showed a temporary note'}`,
        ].join('\n'),
        color: COLORS.warning,
        thumbnail: member.user?.displayAvatarURL?.(),
        footer: 'Security log',
      }),
    ]);
    return;
  }

  await message.delete().catch(() => {});

  const inviteUrl = await resolveInvite(guild, settings.honeypot.inviteUrl);
  if (inviteUrl && inviteUrl !== settings.honeypot.inviteUrl) {
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

  const blocker = kickBlocker(guild, member);
  let kicked = false;
  let failure = blocker;

  if (!blocker) {
    try {
      await member.kick(`Honeypot: typed in #${channelName} (possible compromised account)`);
      kicked = true;
    } catch (err) {
      failure = err.message;
      console.error('[honeypot] Failed to kick member:', err.message);
    }
  } else {
    console.error('[honeypot] Kick skipped:', blocker);
  }

  if (kicked) {
    settings.honeypot.kicks = (Number(settings.honeypot.kicks) || 0) + 1;
    settings.honeypot.lastKickAt = Date.now();
    store.save();
    await refreshPanel(guild, settings, store);
  }

  const total = Number(settings.honeypot.kicks) || 0;
  const lines = [
    `**Member:** ${member}`,
    `**Channel:** #${channelName}`,
    `**Message:** ${String(message.content ?? '').slice(0, 300) || '_no text_'}`,
    `**DM with invite:** ${dmSent ? 'sent' : 'not delivered'}`,
    `**Kick:** ${kicked ? 'done' : `failed — ${failure ?? 'unknown reason'}`}`,
    `**Total kicked:** ${total}`,
  ];

  await sendLog(guild, settings, [
    embed({
      title: kicked ? '🍯 Honeypot triggered — member kicked' : '🍯 Honeypot triggered — kick failed',
      description: lines.join('\n'),
      color: kicked ? COLORS.danger : COLORS.warning,
      thumbnail: member.user?.displayAvatarURL?.(),
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
  const total = Number(previous?.kicks) || 0;

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
    settings.honeypot = { ...previous, channelId: null, messageId: null };
    store.save();
    await replyAndClean(message, {
      embeds: [
        embed({
          title: 'Honeypot disabled',
          description: [
            'Messages in the old honeypot channel are no longer punished.',
            `**Kicks recorded:** ${total}`,
          ].join('\n'),
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

  settings.honeypot = {
    ...previous,
    channelId: message.channelId,
    channelName: message.channel?.name ?? null,
    messageId: null,
    inviteUrl,
  };
  store.save();

  const panel = await ensurePanel(message.channel, settings, store);

  const blocker = kickBlocker(guild, message.member);
  await replyAndClean(message, {
    embeds: [
      embed({
        title: panel ? '🍯 Honeypot armed' : '⚠️ Honeypot saved — panel failed',
        description: [
          `**Channel:** ${message.channel}`,
          `**Invite sent on kick:** ${inviteUrl}`,
          `**Kicked so far:** ${total}`,
          `**Bot can kick:** ${blocker ? `no — ${blocker}` : 'yes'}`,
          '',
          'Anyone who sends a message here is kicked and DMed that invite.',
          'Moderators and above are immune — their message is removed and they are told privately.',
          'Run `!honeypot off` to disable it.',
        ].join('\n'),
        color: blocker ? COLORS.warning : COLORS.success,
      }),
    ],
  });
}

/**
 * Startup check: repairs a deleted panel and warns when the armed channel is
 * gone, so the trap can never sit there doing nothing unnoticed.
 */
async function verify({ client, store }) {
  for (const guild of client.guilds.cache.values()) {
    const settings = store.guild(guild.id);
    const config = settings.honeypot;
    if (!config?.channelId) continue;

    const channel = guild.channels.cache.get(config.channelId);
    if (!channel) {
      console.warn(
        `[honeypot] Armed channel ${config.channelId} is gone from ${guild.name}; a channel named like a honeypot takes over automatically.`,
      );
      await sendLog(guild, settings, [
        embed({
          title: '🍯 Honeypot channel is missing',
          description: [
            `The armed channel (\`${config.channelId}\`) no longer exists.`,
            'The next message in a channel with **honeypot** in its name re-arms the trap automatically.',
            'Run `!honeypot` there to post a fresh panel right away.',
          ].join('\n'),
          color: COLORS.warning,
        }),
      ]);
      continue;
    }

    await ensurePanel(channel, settings, store);
  }
}

module.exports = {
  PREFIX,
  USAGE,
  IMMUNE_PERMISSIONS,
  IMMUNE_NOTE_MS,
  ensurePanel,
  findExistingPanel,
  handleMessage,
  isArmedChannel,
  isModOrAbove,
  kickBlocker,
  looksLikeHoneypotChannel,
  panelCard,
  parseHoneypotCommand,
  pickInviteChannel,
  refreshPanel,
  resolveInvite,
  roleNameIsModLevel,
  verify,
};
