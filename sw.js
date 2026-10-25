// Deck Reviewer service worker: keeps a copy of the app on the device so it opens offline.
// The page itself is always fetched fresh when online (network first), so updates arrive as before;
// only without a connection is the saved copy used. version.json is never cached (it is how updates are found).
const CACHE = "deck-reviewer-v1";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png", "./logo-512.png"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function networkFirst(req, key) {
  const c = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req, { cache: "no-store" }), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 8000))]);
    if (res && res.ok) c.put(key || req, res.clone());
    return res;
  } catch (e) {
    const hit = await c.match(key || req, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}
async function cacheFirst(req) {
  const c = await caches.open(CACHE), hit = await c.match(req);
  if (hit) { fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); }).catch(() => {}); return hit; }
  const res = await fetch(req); if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res;
}
self.addEventListener("fetch", ev => {
  const req = ev.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith("/version.json")) return;                       // always the network: this is how updates are found
    if (req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")) { ev.respondWith(networkFirst(req, "./index.html")); return; }
    ev.respondWith(cacheFirst(req)); return;                                   // icons, manifest
  }
  if (url.hostname === "www.gstatic.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") ev.respondWith(cacheFirst(req));   // Firebase code and fonts, for offline
});
