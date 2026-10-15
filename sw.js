/* Guarda la "cáscara" de la app para que abra rápido; los datos siempre se piden en línea. */
const VERSION = "ejec-v1";
const ARCHIVOS = ["./", "index.html", "estilos.css", "app.js", "config.js", "manifest.webmanifest", "icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;  // Supabase y CDN van directo
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); return r;
  }).catch(() => caches.match(e.request)));
});
