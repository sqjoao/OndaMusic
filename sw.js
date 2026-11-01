// Increment this version when publishing changed app files.
const CACHE_VERSION = "1";
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `onda-shell:${SCOPE.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "storage.js",
  "appearance.js",
  "pwa.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
].map((path) => new URL(path, SCOPE).href);
const APP_URLS = new Set(APP_FILES);
const HOME = new URL("index.html", SCOPE).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll fails atomically if a file is missing. The old worker stays usable.
      await cache.addAll(
        APP_FILES.map((url) => new Request(url, { cache: "reload" })),
      );
    })(),
  );
  // Do not skipWaiting here: a new version must not interrupt ongoing playback.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== SCOPE.origin) return;
  const isHome =
    request.mode === "navigate" &&
    (url.pathname === SCOPE.pathname ||
      url.pathname === new URL(HOME).pathname);
  // Cache only the app shell, never imported audio, unrelated sites or paths.
  if (!isHome && !APP_URLS.has(url.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(isHome ? HOME : request);
      return cached || fetch(request);
    })(),
  );
});
