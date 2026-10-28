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

const FONT_LETTERS = new Set(Object.values(SMALL_CAPS));

/**
 * Comparison key that ignores the font: `Staff`, `ꜱᴛᴀꜰꜰ` and `@ ꜱᴛᴀᴛꜰ ✦` all
 * become `ꜱᴛᴀꜰꜰ`. Emoji, spaces and punctuation are dropped, digits are kept.
 */
function fontKey(input) {
  return [...toSmallCaps(input ?? '')]
    .filter((character) => FONT_LETTERS.has(character) || /[0-9]/.test(character))
    .join('');
}

const REVERSE = new Map(Object.entries(SMALL_CAPS).map(([plain, fancy]) => [fancy, plain]));

/** Turns the fancy font back into normal letters: `ꜱᴛᴀꜰꜰ` becomes `staff`. */
function toPlain(input) {
  return [...String(input ?? '').normalize('NFKC')]
    .map((character) => REVERSE.get(character) ?? character)
    .join('');
}

module.exports = { fontKey, toPlain, toSmallCaps, SMALL_CAPS };
