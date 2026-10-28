'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The project root is the folder holding package.json, whichever directory the
// hosting panel launches the process from.
const ROOT = path.join(__dirname, '..', '..');

// Some panels refuse a filename that starts with a dot, so all three names are
// accepted. The first one that exists wins.
const ENV_FILES = ['.env', 'wispbyte.env', 'env'];

/** Loads the first env file found in the project root. Returns its name or null. */
function loadEnv() {
  for (const name of ENV_FILES) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    require('dotenv').config({ path: file });
    return name;
  }
  return null;
}

module.exports = { loadEnv, ENV_FILES };
