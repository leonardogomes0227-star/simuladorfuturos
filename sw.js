// Service worker do Radar de Futuros: o app abre offline; os dados de mercado sempre vêm da rede.
// Troque VERSION a cada publicação para os usuários receberem os arquivos novos.
const VERSION = 'radar-v2.1.0';
const SHELL = [
  './', 'index.html', 'css/style.css',
  'js/engine.js', 'js/metrics.js', 'js/data.js', 'js/bot.js', 'js/app.js',
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
  // Stale-while-revalidate: abre rápido do cache e atualiza em segundo plano.
  e.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined));
        return hit || net;
      })
    )
  );
});
