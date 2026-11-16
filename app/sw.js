// Cache do Conversor de Extratos OFX para funcionar sem internet.
// Com internet: sempre busca a versão mais nova (e guarda uma cópia).
// Sem internet: usa a última cópia guardada.
const CACHE = "conversor-ofx";
const ARQUIVOS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icone-192.png",
  "./icone-512.png",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/jszip.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
