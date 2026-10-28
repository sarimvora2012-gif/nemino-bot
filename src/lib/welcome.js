'use strict';

const { timestamp } = require('./helpers');
const v2 = require('./v2');
const { toSmallCaps } = require('./smallcaps');

/** Where new-member cards go; a channel set with /config wins over this default. */
const DEFAULT_WELCOME_CHANNEL_ID =
  process.env.WELCOME_CHANNEL_ID?.trim() || '1528229937893609492';
const FALLBACK_RULES_CHANNEL_ID = '1528136158847045745';
const FALLBACK_GENERAL_CHANNEL_ID = '1527920834046328896';

const ACCENT = 0xffc93c;

/** The welcome channel: configured, then the default id, then any #welcome-ish text channel. */
function resolveWelcomeChannel(guild, settings, client = null) {
  const candidates = [settings?.welcomeChannelId, DEFAULT_WELCOME_CHANNEL_ID].filter(Boolean);
  for (const id of candidates) {
    const channel = guild.channels.cache.get(id) ?? client?.channels.cache.get(id);
    if (channel?.isTextBased()) return channel;
  }

  return (
    guild.channels.cache.find(
      (channel) => channel.isTextBased() && /welcome|👋/i.test(channel.name ?? ''),
    ) ?? null
  );
}

function welcomeCard(member, guild, memberCount) {
  const user = member.user;
  const joined = member.joinedAt ?? member.joinedTimestamp ?? new Date();
  const rulesId = guild.rulesChannel?.id ?? FALLBACK_RULES_CHANNEL_ID;
  const generalId = guild.channels.cache.get(FALLBACK_GENERAL_CHANNEL_ID)
    ? FALLBACK_GENERAL_CHANNEL_ID
    : guild.channels.cache.find(
        (channel) => channel.isTextBased() && /general|chat/i.test(channel.name ?? ''),
      )?.id;

  const grid = [`👤 **Member** · ${user}`, `📅 **Joined** · ${timestamp(joined)}`].join(
    '   •   ',
  );

  const startHere = [
    `📜 **Read the rules** · <#${rulesId}>`,
    generalId ? `💬 **Say hi** · <#${generalId}>` : null,
    '🎫 **Need help?** · open a ticket any time',
  ]
    .filter(Boolean)
    .join('   •   ');

  return v2.card({
    accent: ACCENT,
    kicker: toSmallCaps('welcome'),
    title: `👋 WELCOME TO ${toSmallCaps(guild.name, 60)}`,
    subtitle: `member #${memberCount}`,
    description: grid,
    sections: [`> ✨ Enjoy your stay!`, startHere],
    footer: 'Welcome aboard',
    thumbnail: user.displayAvatarURL({ size: 256, extension: 'png' }),
  });
}

/** Posts the welcome card for a new member. Never throws into the gateway handler. */
async function handleMemberAdd(member, { store } = {}) {
  if (!member?.guild || member.user?.bot) return null;

  const guild = member.guild;
  try {
    const settings = store ? store.guild(guild.id) : null;
    const channel = resolveWelcomeChannel(guild, settings, member.client);
    if (!channel) {
      console.warn(`[welcome] No welcome channel in ${guild.name}; skipping the card.`);
      return null;
    }

    const memberCount = guild.memberCount ?? guild.members.cache.size;
    // Components V2 messages cannot carry `content`, so the ping lives in the
    // card itself and allowedMentions makes that mention notify them.
    const payload = welcomeCard(member, guild, memberCount);
    return await channel.send({
      ...payload,
      allowedMentions: { users: [member.id] },
    });
  } catch (err) {
    console.error('[welcome] Failed to send the welcome card:', err.message);
    return null;
  }
}

module.exports = {
  ACCENT,
  DEFAULT_WELCOME_CHANNEL_ID,
  handleMemberAdd,
  resolveWelcomeChannel,
  welcomeCard,
};
