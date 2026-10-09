// SitCraft iPad app — offline support (a "service worker"). It keeps a copy of every app file on the iPad so SitCraft opens
// and works with no internet. Your shows themselves live in the iPad's storage (IndexedDB), not here.
// A new version of the app is downloaded quietly in the background and only switched to when you tap "update"
// (or the next time SitCraft starts before anything is open), so the app never changes under you while you write.
// tools/build-web.js fills in the build stamp and the file list.
'use strict';
var BUILD = 'c5d30fe8dda8';
var FILES = ["index.html","busy.js","dc-runtime.js","desktop-shim.js","library.js","link.js","manifest.webmanifest","orbit.js","screens.js","split.js","sync.js","vendor/fonts.css","vendor/fonts/courier-prime-latin-400-italic.woff2","vendor/fonts/courier-prime-latin-400-normal.woff2","vendor/fonts/courier-prime-latin-700-italic.woff2","vendor/fonts/courier-prime-latin-700-normal.woff2","vendor/fonts/geist-mono-latin-400-normal.woff2","vendor/fonts/geist-mono-latin-500-normal.woff2","vendor/fonts/geist-mono-latin-600-normal.woff2","vendor/fonts/geist-sans-latin-400-normal.woff2","vendor/fonts/geist-sans-latin-500-normal.woff2","vendor/fonts/geist-sans-latin-600-normal.woff2","vendor/fonts/geist-sans-latin-700-normal.woff2","vendor/preact.min.umd.js","web/ai.js","web/bridge.js","web/icons/icon-180.png","web/icons/icon-192.png","web/icons/icon-512.png","web/ipad.css","web/kit.js","web/start.js","web/vendor/jsQR-LICENSE.txt","web/vendor/jsQR.js","web/vendor/pako-LICENSE.txt","web/vendor/pako.min.js"];
var CACHE = 'sitcraft-' + BUILD;
var INDEX = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(new URL(f, self.registration.scope).href, { cache: 'reload' }); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('sitcraft-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  if (e.data === 'update-now') self.skipWaiting();
  if (e.data === 'build' && e.source) e.source.postMessage({ build: BUILD });
});

self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var u = new URL(r.url);
  if (u.origin !== self.location.origin || u.href.indexOf(self.registration.scope) !== 0) return; // Google, Drive: straight to the internet
  if (/\/(version\.json|sw\.js)$/.test(u.pathname)) return;
  if (r.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(function (c) { return c.match(INDEX); }).then(function (x) { return x || fetch(r); }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) { return c.match(r, { ignoreSearch: true }); }).then(function (x) { return x || fetch(r); }));
});
