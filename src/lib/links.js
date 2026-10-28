'use strict';

/**
 * Reads a channel out of anything Discord lets you copy.
 *
 * Accepted:
 *   https://discord.com/channels/123/456
 *   https://canary.discord.com/channels/123/456?foo=1
 *   https://discordapp.com/channels/123/456
 *   <#456>
 *   456
 *
 * Returns the channel ID, or null when the text is not a channel reference.
 */
function parseChannelLink(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  const mention = text.match(/^<#(\d{10,25})>$/);
  if (mention) return mention[1];

  const url = text.match(
    /^(?:https?:\/\/)?(?:www\.|canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{10,25})\/(\d{10,25})(?:[/?#]\S*)?$/i,
  );
  if (url) return url[1];

  if (/^\d{10,25}$/.test(text)) return text;

  return null;
}

module.exports = { parseChannelLink };
