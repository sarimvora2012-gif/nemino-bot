'use strict';

/**
 * Video announcements.
 *
 *  /upload video link:<url>  -> uploads channel, pings the Nemino role
 *
 * The bot never posts about streams: there is no live watcher and no live
 * command, so nothing can ping the server for a stream.
 */

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { errorEmbed, successEmbed } = require('../lib/helpers');
const { toSmallCaps } = require('../lib/smallcaps');
const v2 = require('../lib/v2');

const UPLOAD_CHANNEL_ID = '1527963264477302845';
const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/@RealNemino';
const OWNER_NAME = 'realnemino';
const DEFAULT_PING_ROLE_ID = '1528275182068826132';
const PING_ROLE_NAMES = ['nemino', 'nemo'];
const MAX_TITLE = 150;

const YOUTUBE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

const data = [
  new SlashCommandBuilder()
    .setName('upload')
    .setDescription('Announce a new video in the uploads channel')
    .addSubcommand((sub) =>
      sub
        .setName('video')
        .setDescription('Post your newest video')
        .addStringOption((opt) =>
          opt
            .setName('link')
            .setDescription('The video link')
            .setRequired(true)
            .setMaxLength(500),
        ),
    ),
];

function cleanUrl(value) {
  const text = String(value ?? '').trim();
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function youtubeId(url) {
  const match = String(url ?? '').match(YOUTUBE);
  return match ? match[1] : null;
}

/** YouTube links get their 16:9 cover so the card is wide rather than tall. */
function videoThumbnail(url) {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : null;
}

/**
 * The real title and cover of a video, from YouTube's public oEmbed endpoint.
 * The oEmbed thumbnail always exists, while maxresdefault 404s on shorter
 * uploads, so it is used as the primary cover.
 */
async function videoMeta(url) {
  const id = youtubeId(url);
  if (!id) return null;

  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${id}`,
  )}&format=json`;
  const response = await fetch(endpoint, { headers: { 'user-agent': USER_AGENT } }).catch(() => null);
  const data = response?.ok ? await response.json().catch(() => null) : null;

  return {
    videoId: id,
    title: typeof data?.title === 'string' ? data.title.trim().slice(0, MAX_TITLE) : null,
    thumbnail:
      typeof data?.thumbnail_url === 'string' ? data.thumbnail_url : videoThumbnail(url),
    author: typeof data?.author_name === 'string' ? data.author_name : null,
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'youtube.com';
  }
}

function linkButton(label, url, emoji) {
  return new ButtonBuilder()
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(ButtonStyle.Link)
    .setURL(url);
}

function linkRow(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons.filter(Boolean));
}

function channelButton() {
  return linkButton('YouTube channel', YOUTUBE_CHANNEL_URL, '📺');
}

/** The role pinged for uploads: env override, then a Nemino/Nemo role. */
function announceRole(guild) {
  const override = process.env.UPLOAD_PING_ROLE_ID?.trim();
  if (override) {
    const role = guild?.roles?.cache?.get(override);
    if (role) return role;
  }

  for (const name of PING_ROLE_NAMES) {
    const wanted = toSmallCaps(name);
    const role = guild?.roles?.cache?.find(
      (candidate) =>
        candidate.id !== guild.id &&
        !candidate.managed &&
        // Font-insensitive, so a staff role restyled by !stafffont still matches.
        toSmallCaps(candidate.name).toLowerCase() === wanted,
    );
    if (role) return role;
  }

  return guild?.roles?.cache?.get(DEFAULT_PING_ROLE_ID) ?? null;
}

/** Owner, Manage Server, or the announced role may post announcements. */
function canAnnounce(member, guild, role) {
  if (!member) return false;
  if (guild?.ownerId === member.id) return true;
  if (member.permissions?.has?.('ManageGuild')) return true;
  return Boolean(role && member.roles?.cache?.has(role.id));
}

/**
 * The upload card, shaped like Discord's own video preview: the uploader line,
 * the real title, the badge and time, a one-line summary, the cover image,
 * then the play button.
 */
function videoCard({ title = null, url = null, thumbnail = null, ping = null }) {
  const host = url ? hostOf(url) : 'youtube.com';
  const now = Math.floor(Date.now() / 1000);

  return v2.card({
    accent: 0xff2d55,
    kicker: `🍥 ${OWNER_NAME}`,
    title: title || `New video from ${OWNER_NAME}`,
    subtitle: `🎬 new upload · <t:${now}:f>`,
    quote: ping,
    description: [
      `Nemino just uploaded a new video!`,
      url ? `🔗 [${host}](${url})` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    image: thumbnail,
    footer: 'uploads',
    buttons: [
      linkRow(url ? linkButton('Watch video', url, '▶️') : null, channelButton()),
    ],
  });
}

function uploadCard({ guild, url, meta = null }) {
  const role = announceRole(guild);
  const payload = videoCard({
    title: meta?.title ?? null,
    url,
    thumbnail: meta?.thumbnail ?? videoThumbnail(url),
    ping: role ? `<@&${role.id}>` : null,
  });

  if (role) payload.allowedMentions = { parse: [], roles: [role.id] };
  return payload;
}

async function resolveChannel(guild, id) {
  return (
    guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null))
  );
}

async function announce(interaction, { channelId, payload, build, label }) {
  const guild = interaction.guild;
  const role = announceRole(guild);

  if (!canAnnounce(interaction.member, guild, role)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `Only the owner${role ? `, <@&${role.id}>` : ''} or members with **Manage Server** can post ${label}.`,
          'Missing permissions',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = await resolveChannel(guild, channelId);
  if (!channel?.isTextBased()) {
    await interaction.reply({
      embeds: [errorEmbed(`I cannot find the channel (<#${channelId}>).`, 'Channel missing')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // The card needs the video's real title and cover, which takes a round trip.
  const content = build ? await build() : payload;
  const message = await channel.send(content).catch((err) => {
    console.error(`[media] Failed to post ${label}:`, err);
    return null;
  });

  if (!message) {
    await interaction.editReply({
      embeds: [
        errorEmbed(`I could not post in ${channel}. Check my **Send Messages** permission there.`, 'Post failed'),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [successEmbed('Posted', `Your announcement is live in ${channel}.\n[Jump to it](${message.url})`)],
  });
  return message;
}

async function execute(interaction) {
  const guild = interaction.guild;

  const link = cleanUrl(interaction.options.getString('link'));
  if (!link) {
    await interaction.reply({
      embeds: [errorEmbed('That is not a valid link. It needs to start with `https://`.', 'Invalid link')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await announce(interaction, {
    channelId: UPLOAD_CHANNEL_ID,
    label: 'uploads',
    build: async () => uploadCard({ guild, url: link, meta: await videoMeta(link) }),
  });
}

module.exports = {
  DEFAULT_PING_ROLE_ID,
  UPLOAD_CHANNEL_ID,
  YOUTUBE_CHANNEL_URL,
  announceRole,
  canAnnounce,
  cleanUrl,
  data,
  execute,
  uploadCard,
  videoMeta,
  videoThumbnail,
  youtubeId,
};
