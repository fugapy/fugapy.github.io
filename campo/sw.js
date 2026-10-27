// Guarda la app en el celular para que abra sin señal.
// Subir VERSION cada vez que cambia un archivo de la lista.

const VERSION = 'fuga-campo-0.1.0';
const APP = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './icono.svg',
  './icono-192.png',
  './icono-512.png',
  './js/app.js',
  './js/db.js',
  './js/media.js',
  './js/modelo.js',
  './js/plano.js',
  './js/exportar.js',
  './js/zip.js',
];
const FUENTES = 'fuga-campo-fuentes';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== FUENTES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Tipografías de Google: se guardan la primera vez que hay señal.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FUENTES).then(async (c) => {
      const guardada = await c.match(req);
      if (guardada) return guardada;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === 'opaque') c.put(req, r.clone());
        return r;
      } catch {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App: primero lo guardado (abre al instante y sin señal) y, si hay señal,
  // se actualiza por detrás para la próxima vez que se abra.
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const guardada = await c.match(req, { ignoreSearch: true });
    const red = fetch(req, { cache: 'no-cache' }).then((r) => {
      if (r.ok) c.put(req, r.clone());
      return r;
    });
    if (guardada) {
      e.waitUntil(red.catch(() => {}));
      return guardada;
    }
    return red.catch(() => (req.mode === 'navigate' ? c.match('./index.html') : new Response('', { status: 504 })));
  }));
});
