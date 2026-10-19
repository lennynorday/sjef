/* Offline-cache voor de app-bestanden. Data loopt altijd live via Supabase. */
const CACHE = "sjef-v3";
const FILES = ["./", "index.html", "style.css", "app.js", "data.js", "icons.js", "config.js", "manifest.webmanifest", "icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Netwerk eerst, zodat updates direct binnenkomen; cache als vangnet.
  e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request, {ignoreSearch:true})));
});
