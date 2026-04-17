const CACHE = "riva-bjj-v20260417110745";
const ASSETS = [
  "./",
  "./index.html",
  "./administrativo.html",
  "./professor.html",
  "./cadastroaluno.html",
  "./alunos.html",
  "./aniversariantes.html",
  "./financeiro.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

/* ── Caching strategies ─────────────────────────────────────── */

// Network-first: try network, fall back to cache (for HTML navigation)
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (req.method === "GET") cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || new Response("Offline", { status: 503 });
  }
}

// Stale-while-revalidate: serve cache immediately, update in background
async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (req.method === "GET") cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await fetchPromise) || new Response("Offline", { status: 503 });
}

// Cache-first: serve cache, fetch on miss
async function cacheFirst(req) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (req.method === "GET") cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // HTML navigation: prefer fresh HTML so deployments propagate quickly
  const isNav = event.request.mode === "navigate" ||
                event.request.destination === "document";
  if (isNav) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Core app assets: serve instantly from cache, update in background
  const isCoreAsset =
    url.origin === location.origin &&
    (url.pathname.endsWith("/app.js") || url.pathname.endsWith("/styles.css"));
  if (isCoreAsset) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Everything else (icons, manifest, …): cache-first
  event.respondWith(cacheFirst(event.request));
});
