// Service worker: lets the app open with no signal.
//
// Strategy is "network first": when online you always get the newest version,
// so a change you push shows up the next time you open the app. If the network
// is missing or slower than 3 seconds, the saved copy is used instead.
//
// If you add a file the app needs, add it to APP_FILES too.
// tests/sw.test.js fails if this list and the real files drift apart.

// The real app and the test copy (/beta/) share one website, so each names its
// cache after its own folder and only clears out its own old caches.
const CACHE_VERSION = 'v6';
const CACHE = `${self.registration.scope}|${CACHE_VERSION}`;
const NETWORK_TIMEOUT_MS = 3000;

const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'src/app.js',
  'src/csv.js',
  'src/env.js',
  'src/exporter.js',
  'src/files.js',
  'src/history.js',
  'src/ids.js',
  'src/importers.js',
  'src/logger.js',
  'src/store.js',
  'src/time.js',
  'src/version.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && (k.startsWith(`${self.registration.scope}|`) || !k.includes('|'))).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // "no-cache" makes the phone ask GitHub whether each file changed instead of
  // reusing its own copy for up to 10 minutes, so a new version arrives right away.
  const network = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy));
    }
    return res;
  });

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS));

  event.respondWith(
    Promise.race([network, timeout]).catch(async () => {
      const cached = (await caches.match(req, { ignoreSearch: true })) ?? (await caches.match('index.html'));
      return cached ?? network;
    }),
  );
});
