// Service worker do Radar de Futuros: o app abre offline, mas SEMPRE tenta a rede primeiro,
// para quem está online nunca ver uma versão velha. Os dados de mercado nunca são guardados.
// Troque VERSION (e RADAR_VERSION em js/config.js) a cada publicação.
const VERSION = 'radar-v2.5.0';
const SHELL = [
  './', 'index.html', 'css/style.css',
  'js/config.js', 'js/engine.js', 'js/metrics.js', 'js/data.js', 'js/bot.js', 'js/hoje.js', 'js/radar.js', 'js/narrativa.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // APIs e fontes externas passam direto: nunca guardar preço em cache.
  if (url.origin !== self.location.origin) return;
  // Rede primeiro; o cache só entra quando a rede falha (offline).
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))
    )
  );
});
