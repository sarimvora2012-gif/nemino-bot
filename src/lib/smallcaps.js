'use strict';

const SMALL_CAPS = {
  a: 'ᴀ',
  b: 'ʙ',
  c: 'ᴄ',
  d: 'ᴅ',
  e: 'ᴇ',
  f: 'ꜰ',
  g: 'ɢ',
  h: 'ʜ',
  i: 'ɪ',
  j: 'ᴊ',
  k: 'ᴋ',
  l: 'ʟ',
  m: 'ᴍ',
  n: 'ɴ',
  o: 'ᴏ',
  p: 'ᴘ',
  q: 'ǫ',
  r: 'ʀ',
  s: 'ꜱ',
  t: 'ᴛ',
  u: 'ᴜ',
  v: 'ᴠ',
  w: 'ᴡ',
  x: 'x',
  y: 'ʏ',
  z: 'ᴢ',
};

/**
 * Converts normal text and existing "fancy font" Unicode into small caps.
 * NFKC first turns mathematical/fraktur letters back into normal letters, so
 * running this on an already-stylised channel name gives one consistent font.
 */
function toSmallCaps(input, maxLength = 100) {
  const normalized = String(input ?? '')
    .normalize('NFKC')
    .toLowerCase();

  let output = '';
  for (const character of normalized) {
    output += SMALL_CAPS[character] ?? character;
  }

  return [...output].slice(0, maxLength).join('');
}

module.exports = { toSmallCaps, SMALL_CAPS };
