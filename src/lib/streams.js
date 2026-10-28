'use strict';

/**
 * Watches a YouTube channel and announces when it goes live.
 *
 * youtube.com/@handle/live serves the channel page, which embeds the live
 * player (with `liveBroadcastDetails.isLiveNow`) only while the channel is
 * streaming; a redirect to the watch page is handled too. YouTube compresses
 * the page heavily, so checking it every few minutes is cheap. Every live
 * video is announced at most once.
 */

const media = require('../commands/media');

const POLL_MS = 3 * 60 * 1000;
const FIRST_CHECK_MS = 15_000;
const MAX_SCAN_BYTES = 1_600_000;
const LIVE_MARKER = /"isLive":true|"isLiveNow":true|"hlsManifestUrl"/;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function handleOf(value = media.YOUTUBE_HANDLE) {
  const text = String(value ?? '').trim();
  if (!text) return '@RealNemino';
  return text.startsWith('@') ? text : `@${text}`;
}

function liveUrl(handle = media.YOUTUBE_HANDLE) {
  return `https://www.youtube.com/${handleOf(handle)}/live`;
}

function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function videoIdFrom(html) {
  const match = String(html ?? '').match(/"videoId":"([A-Za-z0-9_-]{11})"/);
  return match ? match[1] : null;
}

/** The videoId belonging to the live player, found just before the marker. */
function videoIdNear(html, index, window = 20_000) {
  const start = Math.max(0, index - window);
  const slice = String(html ?? '').slice(start, index);
  const matches = [...slice.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

/**
 * Pure decision step so the live logic can be checked without the network.
 * `url` is the final URL after redirects, `html` may be a truncated page.
 */
function parseLiveResponse({ url = '', status = 0, html = '' } = {}) {
  const redirected = String(url).match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (redirected) return { live: true, videoId: redirected[1] };

  if (Number(status) !== 200) return { live: false, videoId: null };

  const text = String(html ?? '');
  const marker = text.search(LIVE_MARKER);
  if (marker < 0) return { live: false, videoId: null };
  return { live: true, videoId: videoIdNear(text, marker) ?? videoIdFrom(text) };
}

/** Reads at most `maxBytes` and stops early once a live marker shows up. */
async function readLimited(response, maxBytes = MAX_SCAN_BYTES) {
  const reader = response.body?.getReader?.();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;

  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.length ?? 0;
      text += decoder.decode(value, { stream: true });
      if (LIVE_MARKER.test(text)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return text;
}

async function detectLive(handle = media.YOUTUBE_HANDLE) {
  const response = await fetch(liveUrl(handle), {
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'en-US,en;q=0.9' },
  });

  const finalUrl = response.url ?? '';
  if (/[?&]v=[A-Za-z0-9_-]{11}/.test(finalUrl)) {
    await response.body?.cancel?.().catch(() => {});
    return parseLiveResponse({ url: finalUrl, status: response.status });
  }

  if (response.status !== 200) {
    await response.body?.cancel?.().catch(() => {});
    return parseLiveResponse({ status: response.status });
  }

  const html = await readLimited(response);
  return parseLiveResponse({ url: finalUrl, status: response.status, html });
}

/** Marks a live video as already announced (also used by a manual /golive). */
function markAnnounced(settings, videoId) {
  if (!settings || !videoId) return false;
  if (!settings.stream) settings.stream = {};
  settings.stream.announcedVideoId = videoId;
  settings.stream.announcedAt = new Date().toISOString();
  return true;
}

/** The stream title, from YouTube's public oEmbed endpoint. */
async function liveTitle(videoId) {
  if (!videoId) return null;
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`;
  const response = await fetch(endpoint, { headers: { 'user-agent': USER_AGENT } }).catch(() => null);
  if (!response?.ok) return null;

  const data = await response.json().catch(() => null);
  const title = typeof data?.title === 'string' ? data.title.trim() : '';
  return title ? title.slice(0, 150) : null;
}

async function resolveChannel(guild, id) {
  return guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
}

/**
 * One poll: announces the stream when the channel is live and that video has
 * not been announced yet. Returns the posted message, or null.
 */
async function checkGuild(client, guild, settings, store) {
  if (!settings.stream) settings.stream = {};
  const stream = settings.stream;
  if (stream.enabled === false) return null;

  const handle = stream.handle || media.YOUTUBE_HANDLE;
  const state = await detectLive(handle);
  const firstCheck = !stream.lastCheckedAt;
  const wasLive = stream.isLive;
  stream.lastCheckedAt = new Date().toISOString();
  stream.isLive = state.live;

  if (firstCheck || state.live !== wasLive) {
    console.log(`[streams] ${handle} is ${state.live ? 'LIVE' : 'offline'}`);
  }

  if (!state.live) {
    store.save();
    return null;
  }

  if (state.videoId && stream.announcedVideoId === state.videoId) {
    store.save();
    return null;
  }

  const channel = await resolveChannel(guild, media.STREAM_CHANNEL_ID);
  if (!channel?.isTextBased()) {
    console.warn(`[streams] Stream channel ${media.STREAM_CHANNEL_ID} is not usable.`);
    store.save();
    return null;
  }

  const url = state.videoId ? watchUrl(state.videoId) : media.YOUTUBE_CHANNEL_URL;
  const meta = state.videoId ? await media.videoMeta(url).catch(() => null) : null;
  const title = meta?.title || (await liveTitle(state.videoId)) || 'Nemino is live';
  const payload = media.liveCard({
    guild,
    title,
    url,
    thumbnail: meta?.thumbnail ?? null,
  });

  const message = await channel.send(payload).catch((err) => {
    console.error('[streams] Could not post the live announcement:', err.message);
    return null;
  });
  if (!message) {
    store.save();
    return null;
  }

  stream.announcedVideoId = state.videoId;
  stream.announcedAt = stream.lastCheckedAt;
  stream.messageId = message.id;
  store.save();
  console.log(`[streams] Announced live: ${title} (${state.videoId ?? 'no id'})`);
  return message;
}

let timer = null;
let busy = false;

async function tick(context) {
  if (busy) return;
  busy = true;

  try {
    const guildId = process.env.GUILD_ID?.trim();
    const guild =
      (guildId ? context.client.guilds.cache.get(guildId) : null) ??
      context.client.guilds.cache.first();
    if (!guild) return;

    const settings = context.store.guild(guild.id);
    await checkGuild(context.client, guild, settings, context.store);
  } catch (err) {
    console.warn('[streams] Check failed:', err.message);
  } finally {
    busy = false;
  }
}

function start(context) {
  stop();
  const first = setTimeout(() => tick(context), FIRST_CHECK_MS);
  first.unref?.();

  timer = setInterval(() => tick(context), POLL_MS);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  FIRST_CHECK_MS,
  MAX_SCAN_BYTES,
  POLL_MS,
  checkGuild,
  detectLive,
  handleOf,
  liveTitle,
  liveUrl,
  markAnnounced,
  parseLiveResponse,
  readLimited,
  videoIdNear,
  start,
  stop,
  videoIdFrom,
  watchUrl,
};
