// Deck Reviewer service worker: keeps a copy of the app on the device so it opens offline.
// Opening the app first asks the tiny version.json (about 57 bytes) which build is current. If it is the build already saved on the
// device, the saved copy opens at once (no 1 MB download); only a NEW build, or nothing saved yet, downloads the page, so updates arrive as before.
// If the site is unreachable, slow, or answers with an error (down, switched off, a cut-off page), the saved copy opens.
// The encrypted question bank is a separate file per version (bank-<fingerprint>.bin); the page stores it in its own cache (deck-bank-v1), which this worker never clears, so a code-only update does not download the bank again.
// version.json is never cached for the page itself (it is how updates are found); the build the saved copy belongs to is kept under the same name in this cache.
const CACHE = "deck-reviewer-v1";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png"];   // only what the app needs to open; the other icons (about 240 KB) are kept the first time they are really asked for, so a visitor who only looks at the login page does not pay for them
const VKEY = "./version.json";

async function markBuild(c, res) {                                             // note which build the saved page really is (read from the page itself, so a briefly stale server can never mislead us)
  try {
    const m = /const BUILD_ID = "([^"]+)"/.exec(await res.text());
    if (m) await c.put(VKEY, new Response(JSON.stringify({ build: m[1] }), { headers: { "Content-Type": "application/json" } })); else await c.delete(VKEY);
  } catch (e) { try { await c.delete(VKEY); } catch (e2) {} }
}
self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE.map(u => new Request(u, { cache: "reload" })));
    const p = await c.match("./index.html"); if (p) await markBuild(c, p);
  }).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== "deck-bank-v1").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const timed = (req, ms) => Promise.race([fetch(req, { cache: "no-store" }), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), ms))]);
async function appPage(ev, req) {
  const c = await caches.open(CACHE), saved = await c.match("./index.html", { ignoreSearch: true });
  let latest = null;                                                           // the build the server says is current
  try { const r = await timed(VKEY, 4000); if (r && r.ok) { const j = await r.json(); if (j && j.build) latest = String(j.build); } } catch (e) {}
  if (saved && !latest) return saved;                                          // offline, slow, or the site answers with an error: the saved copy
  if (saved && latest) { try { const v = await c.match(VKEY); if (v && (await v.json()).build === latest) return saved; } catch (e) {} }   // same build: nothing to download
  try {                                                                        // a new build, or nothing saved yet: get the page
    const res = await timed(req, 8000);
    if (res && res.ok) {
      ev.waitUntil(Promise.all([c.put("./index.html", res.clone()), markBuild(c, res.clone())]).catch(() => {}));
      return res;
    }
    return saved || res;                                                       // an error answer never replaces a working saved copy
  } catch (e) { if (saved) return saved; throw e; }
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
    if (url.pathname.endsWith("/admin.html")) return;                         // the admin page: always the network, never stored (and never mixed up with the app)
    if (/\/(bank|trial)-[0-9a-f]{12}\.bin$/.test(url.pathname)) return;      // the encrypted question bank files: the page keeps them itself (Cache Storage "deck-bank-v1"); each name never changes its content
    if (req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")) { ev.respondWith(appPage(ev, req)); return; }
    ev.respondWith(cacheFirst(req)); return;                                   // icons, manifest
  }
  if (url.hostname === "www.gstatic.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") ev.respondWith(cacheFirst(req));   // Firebase code and fonts, for offline
});
