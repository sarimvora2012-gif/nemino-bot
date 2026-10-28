'use strict';

const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const {
  embed,
  warningEmbed,
  isStaff,
  sendLog,
  truncate,
  COLORS,
} = require('./helpers');

/**
 * Bot-side AutoMod.
 *
 * It intentionally errs on the strict side: links from non-staff must be on the
 * trusted-domain list, invites and scam signals are blocked, and dangerous
 * attachments are never allowed. Admins bypass everything, staff bypass the
 * link/ad rules but not obvious scam text or dangerous files. The market
 * channels are advertising areas, so members may post ads, invites and custom
 * links there; scams, dangerous files, mentions and spam are still blocked.
 */

/** Channels where members are allowed to advertise. */
const MARKET_CHANNEL_IDS = new Set([
  '1527957956933582969', // #market
  '1527956094964600843', // #staff-market
]);

const ALLOWED_DOMAINS = new Set([
  'youtube.com',
  'youtu.be',
  'twitch.tv',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'facebook.com',
  'reddit.com',
  'spotify.com',
  'soundcloud.com',
  'tenor.com',
  'giphy.com',
  'klipy.com',
  'imgur.com',
  'discord.com',
  'discordapp.com',
  'discordapp.net',
  'github.com',
  'gitlab.com',
  'google.com',
  'wikipedia.org',
  'fandom.com',
  'roblox.com',
  'steampowered.com',
  'epicgames.com',
  'minecraft.net',
  'curseforge.com',
  'modrinth.com',
]);

const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  'cutt.ly',
  'is.gd',
  'rb.gy',
  'shorturl.at',
  'rebrand.ly',
  'tiny.cc',
  'ow.ly',
  'buff.ly',
  'bit.do',
  'shorte.st',
  'adf.ly',
  't.co',
  'goo.gl',
  'v.gd',
  's.id',
  'lnkd.in',
]);

const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.scr',
  '.bat',
  '.cmd',
  '.com',
  '.pif',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.msi',
  '.jar',
  '.ps1',
  '.hta',
  '.cpl',
  '.reg',
  '.apk',
  '.dll',
  '.lnk',
  '.url',
  '.html',
  '.htm',
  '.svg',
  '.zip',
  '.rar',
  '.7z',
  '.iso',
  '.img',
  '.docm',
  '.xlsm',
  '.pptm',
]);

/**
 * Reasons that mean a link itself looked dangerous, so high staff can be told
 * about it. Plain spam (message flood, repeated lines) is not one of these.
 */
const LINK_REASON_PREFIXES = [
  'IP-address link',
  'lookalike domain',
  'shortened link',
  'Steam gift scam link',
  'unapproved link',
  'server invite link',
];

const INVITE_PATTERN =
  /(?:discord\.(?:gg|me)\/|discord(?:app)?\.com\/invite\/|dsc\.gg\/|disboard\.org\/server\/|top\.gg\/server\/)/i;

const SCAM_SIGNALS = [
  { label: 'free Nitro', re: /\bfree\s+(?:discord\s+)?nitro\b/i },
  { label: 'Nitro gift', re: /\bnitro\s+(?:gift|giveaway)\b/i },
  { label: 'Steam gift', re: /\b(?:free\s+)?steam\s+(?:gift|wallet|code)\b/i },
  { label: 'gift card', re: /\b(?:free\s+)?gift\s*card\b/i },
  { label: 'prize claim', re: /\b(?:claim|collect)\s+(?:your\s+)?prize\b/i },
  { label: 'fake winner', re: /\b(?:you(?:'ve|\s+have)?\s+won|winner\s+selected|congratulations,?\s+you)\b/i },
  { label: 'airdrop', re: /\b(?:crypto|token|nft)?\s*airdrop\b/i },
  { label: 'wallet drainer', re: /\b(?:connect|sync|validate)\s+(?:your\s+)?wallet\b/i },
  { label: 'seed phrase', re: /\b(?:seed|recovery)\s+phrase\b/i },
  { label: 'private key', re: /\bprivate\s+key\b/i },
  { label: 'free Robux', re: /\bfree\s+(?:robux|v-?bucks)\b/i },
  { label: 'free skins', re: /\bfree\s+(?:cs2?|csgo|valorant)\s+skins?\b/i },
  { label: 'fake verification', re: /\b(?:verify|validate)\s+(?:your\s+)?(?:discord\s+)?account\b/i },
  { label: 'account threat', re: /\b(?:account\s+(?:will\s+be\s+)?(?:suspended|deleted|terminated)|click\s+to\s+verify)\b/i },
  { label: 'DM cash request', re: /\b(?:cash\s*app|zelle|paypal)\s+(?:me|request|payment)\b/i },
  { label: 'guaranteed profit', re: /\b(?:guaranteed|risk[- ]free)\s+(?:profit|returns?|money)\b/i },
  { label: 'crypto doubling', re: /\bdouble\s+your\s+(?:crypto|bitcoin|money)\b/i },
  { label: 'free money', re: /\bfree\s+money\b/i },
];

const AD_SIGNALS = [
  { label: 'server advertising', re: /\b(?:join|check\s+out)\s+(?:my|our)\s+(?:server|discord)\b/i },
  { label: 'selling', re: /\b(?:selling|for\s+sale|buy\s+(?:now|followers|views|likes))\b/i },
  { label: 'paid promotion', re: /\b(?:paid\s+promo|promotion|sponsor(?:ed|ship)?|affiliate)\b/i },
  { label: 'DM advertising', re: /\b(?:dm|message)\s+(?:me|for)\b/i },
  { label: 'followers/views', re: /\b(?:grow|boost)\s+your\s+(?:server|channel|followers|views)\b/i },
  { label: 'NSFW advertising', re: /\b(?:onlyfans|nsfw|18\+)\b/i },
  { label: 'cheap services', re: /\b(?:cheap|discount)\s+(?:nitro|followers|views|likes|services)\b/i },
];

const LINK_RE =
  /(?:https?:\/\/|www\.)[^\s<>"'`]+|(?<![@\w.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?/gi;

function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .replace(/\bhxxp(s?):\/\//gi, 'http$1://')
    .replace(/\[\.\]|\(\.\)|\{\.\}/g, '.')
    .replace(/\s+(?:\[?dot\]?|\(dot\))\s+/gi, '.');
}

function isMarketChannel(channel) {
  return [channel?.id, channel?.parentId].some((id) => MARKET_CHANNEL_IDS.has(id));
}

function domainAllowed(hostname) {
  return [...ALLOWED_DOMAINS].some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

function isIpHost(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

function extractLinks(text) {
  const normalized = normalizeText(text);
  const found = new Map();

  for (const rawMatch of normalized.match(LINK_RE) ?? []) {
    const raw = rawMatch.replace(/[.,!?;:]+$/, '').replace(/[)\]}>]+$/, '');
    if (!raw) continue;

    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(candidate);
      const hostname = url.hostname.toLowerCase();
      if (!hostname.includes('.')) continue;
      found.set(`${hostname}${url.pathname}`, {
        raw,
        hostname,
        pathname: url.pathname,
        href: url.href,
      });
    } catch {
      // Malformed URL text is handled by the other patterns.
    }
  }

  return [...found.values()];
}

function isSuspiciousLinkReason(reason) {
  return LINK_REASON_PREFIXES.some((prefix) => String(reason).startsWith(prefix));
}

function dangerousAttachment(name) {
  const extension = path.extname(String(name ?? '')).toLowerCase();
  return DANGEROUS_EXTENSIONS.has(extension) ? extension : null;
}

function matchLabels(signals, text) {
  return signals.filter((signal) => signal.re.test(text)).map((signal) => signal.label);
}

/**
 * Pure detection function, exported so it can be covered by offline checks.
 * `isAdmin` bypasses everything; `isStaff` bypasses link/ad restrictions;
 * `allowAdvertising` is used for the market channels.
 */
function analyze({
  content = '',
  isAdmin = false,
  isStaff: staff = false,
  allowAdvertising = false,
  attachmentNames = [],
  mentionCount = 0,
  everyone = false,
  accountAgeDays = 999,
  joinedDays = 999,
}) {
  if (isAdmin) {
    return { flagged: false, reasons: [], severity: null, timeoutMs: 0, links: [] };
  }

  const text = normalizeText(content);
  const links = extractLinks(text);
  const reasons = [];
  let severity = null;

  const add = (level, reason) => {
    if (!reason || reasons.includes(reason)) return;
    reasons.push(reason);
    if (level === 'high' || severity === null) {
      if (level === 'high') severity = 'high';
      else if (severity !== 'high') severity = level;
    }
  };

  for (const name of attachmentNames) {
    const extension = dangerousAttachment(name);
    if (extension) add('high', `dangerous attachment (${extension})`);
  }

  if (!staff && everyone) add('high', '@everyone / @here mention');
  if (!staff && mentionCount >= 5) add('high', 'mass mentions');

  if (!staff && !allowAdvertising && INVITE_PATTERN.test(text)) {
    add('high', 'server invite link');
  }

  const scamHits = matchLabels(SCAM_SIGNALS, text);
  if (scamHits.length) {
    add('high', `scam phrase: ${scamHits.slice(0, 3).join(', ')}`);
  }

  if (!staff) {
    for (const link of links) {
      if (isIpHost(link.hostname)) {
        add('high', `IP-address link (${link.hostname})`);
      }
      if (link.hostname.includes('xn--')) {
        add('high', `lookalike domain (${link.hostname})`);
      }
      if (SHORTENERS.has(link.hostname)) {
        add('high', `shortened link (${link.hostname})`);
      }
      if (link.hostname === 'steamcommunity.com' && /^\/gift/i.test(link.pathname)) {
        add('high', 'Steam gift scam link');
      }
      if (!allowAdvertising && !domainAllowed(link.hostname)) {
        add('medium', `unapproved link (${link.hostname})`);
      }
    }

    if (!allowAdvertising) {
      if (links.length && accountAgeDays < 7) {
        add('medium', 'new account posting links');
      }
      if (links.length && joinedDays < 1) {
        add('medium', 'recently joined member posting links');
      }

      const adHits = matchLabels(AD_SIGNALS, text);
      if (adHits.length >= 2 || (adHits.length >= 1 && links.length)) {
        add('medium', `advertising: ${adHits.slice(0, 3).join(', ')}`);
      }
    }
  }

  if (!reasons.length) {
    return { flagged: false, reasons: [], severity: null, timeoutMs: 0, links };
  }

  const timeoutMs =
    severity === 'high' ? 24 * 60 * 60 * 1000 : severity === 'medium' ? 60 * 60 * 1000 : 0;

  return { flagged: true, reasons, severity, timeoutMs, links };
}

const burstTracker = new Map();
const duplicateTracker = new Map();
const noticeTracker = new Map();
const spamStrikeTracker = new Map();

// Chatting quickly is normal, so a flood has to be sustained before it counts.
const BURST_WINDOW_MS = 10_000;
const BURST_LIMIT = 12;
const DUPLICATE_WINDOW_MS = 60_000;
const DUPLICATE_LIMIT = 5;

// A spam flag only removes the message. A time out follows when the same
// member keeps spamming after being warned off.
const SPAM_ESCALATION_WINDOW_MS = 10 * 60 * 1000;
const SPAM_ESCALATION_LIMIT = 2;
const SPAM_ESCALATED_TIMEOUT_MS = 10 * 60 * 1000;

const SPAM_LIMITS = {
  BURST_WINDOW_MS,
  BURST_LIMIT,
  DUPLICATE_WINDOW_MS,
  DUPLICATE_LIMIT,
  SPAM_ESCALATION_WINDOW_MS,
  SPAM_ESCALATION_LIMIT,
  SPAM_ESCALATED_TIMEOUT_MS,
};

function trackBurst(key) {
  const now = Date.now();
  const recent = (burstTracker.get(key) ?? []).filter((at) => now - at < BURST_WINDOW_MS);
  recent.push(now);
  burstTracker.set(key, recent);
  return recent.length;
}

function trackDuplicate(key, content) {
  const now = Date.now();
  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalized.length < 8) return 0;
  const recent = (duplicateTracker.get(key) ?? []).filter(
    (entry) => now - entry.at < DUPLICATE_WINDOW_MS,
  );
  recent.push({ at: now, content: normalized });
  duplicateTracker.set(key, recent);
  return recent.filter((entry) => entry.content === normalized).length;
}

/**
 * Counts one spam flag per burst, so a single flood only ever warns. Coming
 * back and doing it again is what escalates.
 */
function trackSpamStrike(key) {
  const now = Date.now();
  const recent = (spamStrikeTracker.get(key) ?? []).filter(
    (at) => now - at < SPAM_ESCALATION_WINDOW_MS,
  );
  const last = recent[recent.length - 1] ?? 0;
  if (!last || now - last > BURST_WINDOW_MS) recent.push(now);
  spamStrikeTracker.set(key, recent);
  return recent.length;
}

function cleanupTrackers() {
  const now = Date.now();
  for (const [key, times] of burstTracker) {
    const recent = times.filter((at) => now - at < BURST_WINDOW_MS);
    if (recent.length) burstTracker.set(key, recent);
    else burstTracker.delete(key);
  }
  for (const [key, entries] of duplicateTracker) {
    const recent = entries.filter((entry) => now - entry.at < DUPLICATE_WINDOW_MS);
    if (recent.length) duplicateTracker.set(key, recent);
    else duplicateTracker.delete(key);
  }
  for (const [key, at] of noticeTracker) {
    if (now - at > 60_000) noticeTracker.delete(key);
  }
  for (const [key, times] of spamStrikeTracker) {
    const recent = times.filter((at) => now - at < SPAM_ESCALATION_WINDOW_MS);
    if (recent.length) spamStrikeTracker.set(key, recent);
    else spamStrikeTracker.delete(key);
  }
}

const cleanupTimer = setInterval(cleanupTrackers, 60_000);
cleanupTimer.unref?.();

async function sendDeletedNotice(channel) {
  const last = noticeTracker.get(channel.id) ?? 0;
  if (Date.now() - last < 10_000) return;
  noticeTracker.set(channel.id, Date.now());

  const notice = await channel
    .send({
      embeds: [warningEmbed('Message removed', 'AutoMod removed a message that looked like spam, an ad or a scam.')],
    })
    .catch(() => null);
  if (notice) {
    setTimeout(() => {
      notice.delete().catch(() => {});
    }, 7_000).unref?.();
  }
}

/**
 * Posts a pinged alert in the log channel when a message carried a link that
 * AutoMod judged dangerous. The links are inside backticks so nobody can open
 * one with a stray click.
 */
async function sendLinkAlert(message, settings, { linkReasons, links, action }) {
  const channel = settings.logChannelId
    ? message.guild.channels.cache.get(settings.logChannelId)
    : null;
  if (!channel?.isTextBased()) return;

  const roleId = settings.automodAlertRoleId || settings.staffRoleId;
  const linkList = links.map((link) => `\`${truncate(link.raw, 200)}\``).join('\n');

  try {
    await channel.send({
      content: roleId
        ? `<@&${roleId}> 🚨 suspicious link caught by AutoMod`
        : '🚨 suspicious link caught by AutoMod',
      embeds: [
        embed({
          title: '🔗 Suspicious link',
          color: COLORS.danger,
          description: `> AutoMod removed a message from ${message.author} in ${message.channel} for a link it judged dangerous.`,
          fields: [
            { name: '🔗 Links', value: truncate(linkList || '*no link text*', 1000) },
            { name: '⚠️ Why', value: truncate(linkReasons.join('\n'), 1000) },
            { name: '🛡️ Action', value: truncate(action, 500) },
            { name: '💬 Message', value: truncate(message.content || '*No text content*', 1000) },
          ],
        }),
      ],
      allowedMentions: { parse: [], roles: roleId ? [roleId] : [] },
    });
  } catch (err) {
    console.error('[automod] Failed to send the suspicious-link alert:', err.message);
  }
}

async function handleMessage(message, { store }, { trackSpam = true } = {}) {
  if (!message.guild || !message.member || message.author?.bot) return;
  if (
    message.member.permissions.has(PermissionFlagsBits.Administrator) ||
    message.member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    return;
  }

  const settings = store.guild(message.guild.id);
  const staff = isStaff(message.member, settings);
  const allowAdvertising = isMarketChannel(message.channel);
  const now = Date.now();

  const analysis = analyze({
    content: message.content,
    isStaff: staff,
    allowAdvertising,
    attachmentNames: [...message.attachments.values()].map((attachment) => attachment.name),
    mentionCount: message.mentions.users.size + message.mentions.roles.size,
    everyone: message.mentions.everyone,
    accountAgeDays: (now - message.author.createdTimestamp) / 86_400_000,
    joinedDays: message.member.joinedTimestamp
      ? (now - message.member.joinedTimestamp) / 86_400_000
      : 999,
  });

  const reasons = [...analysis.reasons];
  let severity = analysis.severity;
  const add = (level, reason) => {
    if (reasons.includes(reason)) return;
    reasons.push(reason);
    if (level === 'high') severity = 'high';
    else if (!severity) severity = level;
  };

  const key = `${message.guild.id}:${message.author.id}`;
  let burst = 0;
  let duplicate = 0;
  if (trackSpam) {
    burst = trackBurst(key);
    if (burst > BURST_LIMIT) {
      add('medium', `message flood (${burst} messages in ${BURST_WINDOW_MS / 1000}s)`);
    }

    duplicate = trackDuplicate(key, message.content);
    if (duplicate > DUPLICATE_LIMIT) {
      add('medium', `repeated message (${duplicate} times)`);
    }
  }

  if (!reasons.length) return;

  // Content that looks like a scam or an ad keeps its own punishment. Spam is
  // handled gently first: the message is removed and only a repeat turns into
  // a short time out, so someone caught up in a conversation is not punished.
  const spamOnly = !analysis.flagged;
  let timeoutMs = analysis.timeoutMs;
  if (spamOnly) {
    const strikes = trackSpamStrike(key);
    timeoutMs = strikes >= SPAM_ESCALATION_LIMIT ? SPAM_ESCALATED_TIMEOUT_MS : 0;
  } else if (!timeoutMs && severity === 'medium') {
    timeoutMs = 60 * 60 * 1000;
  }

  let deleted = false;
  if (message.deletable) {
    deleted = await message
      .delete()
      .then(() => true)
      .catch(() => false);
  }

  let timedOut = false;
  let timeoutError = null;
  if (timeoutMs > 0 && message.member.moderatable) {
    try {
      await message.member.timeout(timeoutMs, `AutoMod: ${reasons.join('; ')}`);
      timedOut = true;
    } catch (err) {
      timeoutError = err.message;
    }
  }

  const action = [
    deleted ? 'message deleted' : 'delete failed',
    timedOut ? `timed out for ${Math.round(timeoutMs / 60_000)} min` : '',
    !timedOut && timeoutMs > 0 ? 'timeout failed (check Moderate Members)' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  console.warn(
    `[automod] ${message.guild.name} #${message.channel.name} ${message.author.tag}: ${reasons.join('; ')} (${action})`,
  );

  // A link the bot considered dangerous is worth a real ping: scam links are
  // only useful to catch while someone is still deciding whether to click.
  const linkReasons = reasons.filter(isSuspiciousLinkReason);
  if (linkReasons.length) {
    await sendLinkAlert(message, settings, { linkReasons, links: analysis.links, action });
  }

  await sendLog(message.guild, settings, [
    embed({
      title: '🛡️ AutoMod action',
      color: severity === 'high' ? COLORS.danger : COLORS.warning,
      fields: [
        { name: 'Member', value: `${message.author}`, inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Action', value: truncate(action, 500), inline: true },
        { name: 'Reasons', value: truncate(reasons.join('\n'), 1024) },
        { name: 'Message', value: truncate(message.content || '*No text content*', 1000) },
        ...(timeoutError ? [{ name: '⚠️ Timeout error', value: truncate(timeoutError, 1000) }] : []),
      ],
    }),
  ]);

  if (deleted) await sendDeletedNotice(message.channel);
}

module.exports = {
  analyze,
  handleMessage,
  SPAM_LIMITS,
  normalizeText,
  extractLinks,
  isSuspiciousLinkReason,
  sendLinkAlert,
  LINK_REASON_PREFIXES,
  dangerousAttachment,
  isMarketChannel,
  ALLOWED_DOMAINS,
  MARKET_CHANNEL_IDS,
  SHORTENERS,
};
