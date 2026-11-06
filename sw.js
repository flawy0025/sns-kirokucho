// SNS 記録帳：通信がなくても開けるようにするための仕組み（service worker）
// 記録そのものは扱いません（記録はブラウザの localStorage にあります）。
const VERSION = 'v1';
const APP = `sns-kirokucho-app-${VERSION}`;
const EXT = 'sns-kirokucho-ext';
const FILES = [
  './', './index.html', './app.js', './ocr-parse.js', './vendor/d3.min.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sns-kirokucho-app-') && k !== APP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 自分のファイル：まず新しいものを取りに行き、だめならしまってあるものを使う
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(APP).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  // 文字のデータ（Google Fonts）と読み取り用のプログラム（jsDelivr）：しまってあれば使う
  if (/^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) {
    event.respondWith(
      caches.open(EXT).then((cache) => cache.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }))),
    );
  }
});
