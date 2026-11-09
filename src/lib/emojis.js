'use strict';

/**
 * The custom emoji pack (the PNGs in mockups/emoji).
 *
 * Each slot lists the names it may be uploaded under — the pack uses the first —
 * plus the plain glyph used when the emoji is missing, so a partial upload never
 * prints raw `<:name:id>` into a card.
 */
const SLOTS = {
  ok: { names: ['ok', 'nem_ok', 'check', 'tick'], fallback: '✅' },
  no: { names: ['no', 'nem_no', 'cross', 'xmark'], fallback: '❌' },
  warn: { names: ['warn', 'nem_warn', 'warning'], fallback: '⚠️' },
  up: { names: ['up', 'nem_up', 'arrow_up'], fallback: '📈' },
  down: { names: ['down', 'nem_down', 'arrow_down'], fallback: '📉' },
  swap: { names: ['swap', 'nem_swap', 'switch'], fallback: '🔄' },
  ticket: { names: ['ticket', 'nem_ticket', 'tickets'], fallback: '🎫' },
  app: { names: ['app', 'nem_app', 'clipboard', 'application'], fallback: '📋' },
  file: { names: ['file', 'nem_file', 'document'], fallback: '📄' },
  log: { names: ['log', 'nem_log', 'logs'], fallback: '📜' },
  gift: { names: ['gift', 'nem_gift', 'giveaway'], fallback: '🎁' },
  idea: { names: ['idea', 'nem_idea', 'suggestion'], fallback: '💡' },
  vouch: { names: ['vouch', 'nem_vouch', 'handshake'], fallback: '🤝' },
  staff: { names: ['staff', 'nem_staff', 'medal', 'badge'], fallback: '🎖️' },
  palm: { names: ['palm', 'nem_palm', 'loa'], fallback: '🌴' },
  clock: { names: ['clock', 'nem_clock', 'timer'], fallback: '⏳' },
  shield: { names: ['shield', 'nem_shield', 'protect'], fallback: '🛡️' },
  honey: { names: ['honey', 'nem_honey', 'honeypot'], fallback: '🍯' },
  broom: { names: ['broom', 'nem_broom', 'purge'], fallback: '🧹' },
  money: { names: ['money', 'nem_money', 'cash'], fallback: '💸' },
  trophy: { names: ['trophy', 'nem_trophy', 'cup'], fallback: '🏆' },
  note: { names: ['note', 'nem_note', 'pencil'], fallback: '📝' },
  chart: { names: ['chart', 'nem_chart', 'stats'], fallback: '📊' },
  list: { names: ['list', 'nem_list', 'logbook'], fallback: '🗒️' },
  spark: { names: ['spark', 'nem_spark', 'sparkle'], fallback: '✨' },
  gear: { names: ['gear', 'nem_gear', 'settings'], fallback: '⚙️' },
  m1: { names: ['m1', 'nem_m1', 'medal1'], fallback: '🥇' },
  m2: { names: ['m2', 'nem_m2', 'medal2'], fallback: '🥈' },
  m3: { names: ['m3', 'nem_m3', 'medal3'], fallback: '🥉' },
};

// guild -> { signature, icons }, so a card with eight icons only walks the emoji
// cache once per slot. The signature drops the cache when emoji are added or
// removed, which is when a name could start or stop resolving.
let cache = new WeakMap();

function findEmoji(guild, names) {
  const collection = guild?.emojis?.cache;
  if (!collection || typeof collection.find !== 'function') return null;
  for (const name of names) {
    const found = collection.find((emoji) => emoji.name === name);
    if (found) return found;
  }
  return null;
}

/** `<:ok:123>` when the server has the emoji, otherwise its plain glyph. */
function icon(guild, slot) {
  const def = SLOTS[slot];
  if (!def) return '';
  if (!guild || typeof guild !== 'object') return def.fallback;

  const collection = guild.emojis?.cache;
  const signature = collection?.size ?? collection?.length ?? 0;
  let entry = cache.get(guild);
  if (!entry || entry.signature !== signature) {
    entry = { signature, icons: new Map() };
    cache.set(guild, entry);
  }

  const cached = entry.icons.get(slot);
  if (cached !== undefined) return cached;

  const emoji = findEmoji(guild, def.names);
  const rendered = emoji
    ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`
    : def.fallback;
  entry.icons.set(slot, rendered);
  return rendered;
}

/** Binds a guild once so a card can just call `e('ticket')`. */
function iconsFor(guild) {
  return (slot) => icon(guild, slot);
}

/** Drops every cached resolution; used by the checks after edits. */
function clearIconCache() {
  cache = new WeakMap();
}

module.exports = {
  SLOTS,
  clearIconCache,
  findEmoji,
  icon,
  iconsFor,
};
