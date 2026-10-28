'use strict';

// Some hosting panels (fps.ms, Pterodactyl-style panels) start a Node server with
// `node index.js` from the project root, even though package.json points at
// src/index.js. This shim makes both entry points work without changing either.
require('./src/index.js');
