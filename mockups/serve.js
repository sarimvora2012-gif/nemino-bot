'use strict';

// Tiny static server for the design-board mockups, so the preview can live on
// its own address instead of the app's built-in HTML preview route.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
// PORT is set to 0 in this environment, which would bind a random port, so only
// honour a real, usable port number and fall back to the fixed one.
const requested = Number(process.env.PORT);
const port =
  Number.isInteger(requested) && requested > 1024 && requested < 65536 ? requested : 4417;
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/**
 * Accepts a PNG from the export page and writes it to mockups/emoji/.
 * Name must be a plain slot name, and the body is capped at Discord's 256 KB
 * per-emoji limit.
 */
function handleSave(req, res) {
  const raw = decodeURIComponent((req.url || '').slice('/save/'.length).split('?')[0]);
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  };

  if (!/^[A-Za-z0-9_-]{2,32}\.png$/.test(raw)) {
    send(400, { ok: false, error: 'name must look like ok.png' });
    return;
  }

  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 256 * 1024) {
      tooBig = true;
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', () => { if (!res.writableEnded) send(400, { ok: false, error: 'upload failed' }); });
  req.on('end', () => {
    if (tooBig) { send(413, { ok: false, error: 'over 256 KB' }); return; }
    const buf = Buffer.concat(chunks);
    if (!buf.length) { send(400, { ok: false, error: 'empty body' }); return; }
    const dir = path.join(root, 'emoji');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, raw), buf);
    send(200, { ok: true, name: raw, bytes: buf.length });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && (req.url || '').startsWith('/save/')) {
    handleSave(req, res);
    return;
  }

  let name = decodeURIComponent((req.url || '/').split('?')[0]);
  if (name === '/' || name === '') name = '/emoji-pass-mockup.html';

  const file = path.resolve(root, `.${name}`);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(port, HOST, () => {
  fs.writeFileSync(path.join(root, 'server.pid'), String(process.pid));
  console.log(`mockups served at http://${HOST}:${port}/ (pid ${process.pid})`);
});
