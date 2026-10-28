'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The project root is the folder holding package.json, whichever directory the
// hosting panel launches the process from.
const ROOT = path.join(__dirname, '..', '..');

// Some panels refuse a filename that starts with a dot, so all three names are
// accepted. The first one that exists wins.
const ENV_FILES = ['.env', 'wispbyte.env', 'env'];

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
    return name;
  }

  const near = envCandidates();
  console.warn(`[env] No env file in ${ROOT}`);
  console.warn(`[env] Looking for: ${ENV_FILES.join(', ')}`);
  console.warn(`[env] Env-like files found: ${near || 'none'}`);
  console.warn(`[env] Folder contains: ${rootListing()}`);
  return null;
}

module.exports = { loadEnv, rootListing, envCandidates, ENV_FILES, ROOT };
