'use strict';

/**
 * Video and stream announcements.
 *
 *  /upload video link:<url>  -> uploads channel, pings the Nemino role
 *  /golive title:<text>      -> streams channel, pings @everyone
 *
 * Both are posted by hand: the bot does not watch an external platform for a
 * stream starting, so nothing is announced unless someone runs the command.
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
const STREAM_CHANNEL_ID = '1527962279704789072';
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
  new SlashCommandBuilder()
    .setName('golive')
    .setDescription('Announce that you are live in the streams channel')
    .addStringOption((opt) =>
      opt
        .setName('title')
        .setDescription('What are you streaming?')
        .setRequired(true)
        .setMaxLength(MAX_TITLE),
    )
    .addStringOption((opt) =>
      opt
        .setName('link')
        .setDescription('Stream link (optional)')
        .setRequired(false)
        .setMaxLength(500),
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
 * One layout for both videos and streams, shaped like Discord's own video
 * preview: the uploader line, the real title, the badge and time, a one-line
 * summary, the cover image, then the play button.
 */
function videoCard({ kind, title = null, url = null, thumbnail = null, ping = null }) {
  const live = kind === 'live';
  const host = url ? hostOf(url) : 'youtube.com';
  const now = Math.floor(Date.now() / 1000);

  return v2.card({
    accent: live ? 0xff1a1a : 0xff2d55,
    kicker: `🍥 ${OWNER_NAME}`,
    title:
      title || (live ? `${OWNER_NAME} is live` : `New video from ${OWNER_NAME}`),
    subtitle: `${live ? '🔴 youtube live' : '🎬 new upload'} · <t:${now}:f>`,
    quote: ping,
    description: [
      live
        ? `Nemino is now live on YouTube!`
        : `Nemino just uploaded a new video!`,
      url ? `🔗 [${host}](${url})` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    image: thumbnail,
    footer: live ? 'streams' : 'uploads',
    buttons: [
      linkRow(
        url ? linkButton(live ? 'Watch stream' : 'Watch video', url, live ? '🔴' : '▶️') : null,
        channelButton(),
      ),
    ],
  });
}

function uploadCard({ guild, url, meta = null }) {
  const role = announceRole(guild);
  const payload = videoCard({
    kind: 'upload',
    title: meta?.title ?? null,
    url,
    thumbnail: meta?.thumbnail ?? videoThumbnail(url),
    ping: role ? `<@&${role.id}>` : null,
  });

  if (role) payload.allowedMentions = { parse: [], roles: [role.id] };
  return payload;
}

function liveCard({ guild, title, url, thumbnail = null }) {
  const payload = videoCard({
    kind: 'live',
    title,
    url,
    thumbnail: thumbnail ?? videoThumbnail(url),
    ping: '@everyone',
  });

  payload.allowedMentions = { parse: ['everyone'] };
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

async function execute(interaction, { store } = {}) {
  const guild = interaction.guild;

  if (interaction.commandName === 'upload') {
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
    return;
  }

  if (interaction.commandName === 'golive') {
    const title = interaction.options.getString('title').trim();
    const rawLink = interaction.options.getString('link');
    const link = rawLink ? cleanUrl(rawLink) : null;

    if (!title) {
      await interaction.reply({
        embeds: [errorEmbed('Give your stream a title.', 'Missing title')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (rawLink && !link) {
      await interaction.reply({
        embeds: [errorEmbed('That stream link is not valid. It needs to start with `https://`.', 'Invalid link')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await announce(interaction, {
      channelId: STREAM_CHANNEL_ID,
      label: 'stream announcements',
      build: async () => {
        const meta = link ? await videoMeta(link) : null;
        return liveCard({ guild, title, url: link, thumbnail: meta?.thumbnail ?? null });
      },
    });
  }
}

module.exports = {
  DEFAULT_PING_ROLE_ID,
  STREAM_CHANNEL_ID,
  UPLOAD_CHANNEL_ID,
  YOUTUBE_CHANNEL_URL,
  announceRole,
  canAnnounce,
  cleanUrl,
  data,
  execute,
  liveCard,
  uploadCard,
  videoMeta,
  videoThumbnail,
  youtubeId,
};
