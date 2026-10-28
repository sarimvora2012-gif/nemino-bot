'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The project root is the folder holding package.json, whichever directory the
// hosting panel launches the process from.
const ROOT = path.join(__dirname, '..', '..');

// Some panels refuse a filename that starts with a dot, so all three names are
// accepted. The first one that exists wins.
const ENV_FILES = ['.env', 'wispbyte.env', 'env'];

let lastLoaded = null;

/** Names in the project root, for startup diagnostics. Never reads file contents. */
function rootListing(limit = 20) {
  try {
    const names = fs.readdirSync(ROOT);
    const shown = names.slice(0, limit).join(', ');
    return names.length > limit ? `${shown}, … (${names.length} entries)` : shown || '(empty)';
  } catch (err) {
    return `unreadable (${err.message})`;
  }
}

/** Files in the root that look like a env file, including near-misses like .env.txt. */
function envCandidates() {
  try {
    return fs
      .readdirSync(ROOT)
      .filter((name) => /env/i.test(name))
      .join(', ');
  } catch {
    return '';
  }
}

/** Loads the first env file found in the project root. Returns its name or null. */
function loadEnv() {
  for (const name of ENV_FILES) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    require('dotenv').config({ path: file });
    // Name only — never the token inside it.
    console.log(`[env] Loaded ${name}`);
    lastLoaded = name;
    return name;
  }

  const near = envCandidates();
  console.warn(`[env] No env file in ${ROOT}`);
  console.warn(`[env] Looking for: ${ENV_FILES.join(', ')}`);
  console.warn(`[env] Env-like files found: ${near || 'none'}`);
  console.warn(`[env] Folder contains: ${rootListing()}`);
  lastLoaded = null;
  return null;
}

/** Key names declared in the env file (no values), so startup can say where a value came from. */
function fileKeys(name = lastLoaded) {
  if (!name) return [];
  try {
    const text = fs.readFileSync(path.join(ROOT, name), 'utf8');
    return text
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/))
      .filter(Boolean)
      .map((match) => match[1]);
  } catch {
    return [];
  }
}

const SNOWFLAKE = /^\d{15,25}$/;
const BOT_TOKEN = /^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/;

/**
 * Checks the three variables the bot needs and explains anything wrong in plain
 * language. Values are never printed — only whether they exist and look valid.
 *
 * Returns `{ fatal, lines, problems, token, clientId, guildId }`.
 */
function auditEnv() {
  const keys = fileKeys();
  const raw = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN ?? '',
    CLIENT_ID: process.env.CLIENT_ID ?? '',
    GUILD_ID: process.env.GUILD_ID ?? '',
  };

  const lines = ['Environment check'];
  const problems = [];
  const values = {};
  let fatal = false;

  for (const name of ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID']) {
    const value = raw[name].trim();
    const source = keys.includes(name) ? `from ${lastLoaded}` : value ? 'from panel variables' : null;

    if (!value) {
      const hint =
        name === 'GUILD_ID'
          ? 'optional, but without it commands register globally (slow to appear)'
          : 'required — add it in Startup → Environment Variables, or in the env file';
      lines.push(`  ✗ ${name} missing · ${hint}`);
      if (name !== 'GUILD_ID') {
        fatal = true;
        problems.push(`${name} is missing`);
      }
      continue;
    }

    const wrapped = /^["'].*["']$/.test(value);
    const clean = wrapped ? value.slice(1, -1).trim() : value;
    values[name] = clean;

    if (wrapped) {
      lines.push(`  ⚠ ${name} has quotes around it · remove the " or ' in the panel`);
      problems.push(`${name} is wrapped in quotes`);
    }

    if (name === 'DISCORD_TOKEN') {
      const valid = BOT_TOKEN.test(clean);
      lines.push(
        valid
          ? `  ✓ DISCORD_TOKEN present (${source}), looks like a bot token`
          : `  ✗ DISCORD_TOKEN does not look like a bot token (${source}) · copy it again from Developer Portal → Bot → Reset Token`,
      );
      if (!valid) {
        fatal = true;
        problems.push('DISCORD_TOKEN is not a valid bot token');
      }
      continue;
    }

    if (SNOWFLAKE.test(clean)) {
      lines.push(
        name === 'GUILD_ID'
          ? `  ✓ GUILD_ID ${clean} (${source})`
          : `  ✓ CLIENT_ID ${clean} (${source})`,
      );
    } else if (name === 'GUILD_ID') {
      lines.push(`  ⚠ GUILD_ID "${clean}" is not a server ID · ignoring it, commands will register globally`);
      problems.push('GUILD_ID is not a server ID');
      delete values.GUILD_ID;
    } else {
      lines.push(`  ✗ CLIENT_ID "${clean}" is not an application ID (17–20 digits)`);
      fatal = true;
      problems.push('CLIENT_ID is not an application ID');
    }
  }

  if (fatal) {
    lines.push(
      '',
      'The hosting panel restarts the bot every 60 seconds while this is wrong,',
      'so nothing else will work until the missing value is added.',
      '',
      'Panel: Startup → Environment Variables → Name must be exactly',
      `${problems.length ? 'DISCORD_TOKEN / CLIENT_ID' : 'the variable'} (all caps, no spaces around the name).`,
      `Env file: ${ENV_FILES.join(', ')} next to package.json, one KEY=value per line.`,
      `Folder: ${ROOT}`,
      `Files there: ${rootListing()}`,
      `Env-like files there: ${envCandidates() || 'none'}`,
    );
  }

  return {
    fatal,
    lines,
    problems,
    token: values.DISCORD_TOKEN ?? null,
    clientId: values.CLIENT_ID ?? null,
    guildId: values.GUILD_ID ?? null,
  };
}

module.exports = {
  auditEnv,
  ENV_FILES,
  ROOT,
  envCandidates,
  fileKeys,
  loadEnv,
  rootListing,
};
