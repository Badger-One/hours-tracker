// A tiny web server for trying the app on your computer.
// Run with: npm start   then open the address it prints.
// Uses only Node's built-in modules, so there's nothing to install.
// Press Ctrl+C in the terminal to stop it.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv',
};

const server = http.createServer(async (req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.join(ROOT, urlPath);

  // Refuse paths like /../../secret that try to escape the project folder.
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store', // Always serve your latest edits.
    });
    res.end(body);
    console.log(`200 ${req.method} ${urlPath}`);
  } catch {
    res.writeHead(404).end('Not found');
    console.log(`404 ${req.method} ${urlPath}`);
  }
});

server.listen(PORT, () => {
  console.log(`\nHours Tracker is running.\n  On this computer:  http://localhost:${PORT}`);
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`  On your phone (same Wi-Fi):  http://${net.address}:${PORT}`);
    }
  }
  console.log('\nPress Ctrl+C to stop.\n');
});
