// muxway's service worker: the client's own files from the device, and
// nothing else. The hub's API is never read here, never cached, never
// answered; a request under /v1/ passes as if no worker were installed.
// The build writes the stamp and the asset list below (scripts/stamp-sw.mjs).
const STAMP = "a15da10685321ebb";
const ASSETS = ["/assets/index-B5GgQL74.js","/assets/index-ChH6XXu7.css"];
const CACHE = 'mx-' + STAMP;

// The page's files: the shell (the page at /, which every app route falls back to), the manifest
// and the icons, the microphone worklet, and the hashed assets.
const SHELL = '/';
const OWN = [
  SHELL,
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-green.svg',
  '/icon-paper.svg',
  '/mic-worklet.js',
].concat(ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        OWN.map((path) =>
          fetch(path, { cache: 'no-cache' }).then((r) => {
            if (r.ok) return cache.put(path, r);
          }),
        ),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// The routes the page renders, as the hub's appRoute lists them.
function appRoute(path) {
  return (
    path === '/' ||
    path === '/signin' ||
    path === '/admin' ||
    path.startsWith('/p/') ||
    path.startsWith('/w/') ||
    path.startsWith('/b/')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  // The API, and anything that is not the client's own: not ours.
  if (path.startsWith('/v1/')) return;
  if (path.startsWith('/assets/') || path.startsWith('/icons/') || path.startsWith('/fonts/')) {
    // Immutable files: the cache first, then the network, kept for next time.
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((r) => {
              if (r.ok) cache.put(req, r.clone());
              return r;
            }),
        ),
      ),
    );
    return;
  }
  if (req.mode === 'navigate' && appRoute(path)) {
    // The page: the network first, the cached shell when there is none.
    event.respondWith(
      fetch(req).catch(() => caches.open(CACHE).then((cache) => cache.match(SHELL))),
    );
  }
});

// The page asks the waiting worker to take over.
self.addEventListener('message', (event) => {
  if (event.data === 'mx-skip-waiting') self.skipWaiting();
});
