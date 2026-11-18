// 耳コピツールを、ネットにつながらない場所でも開けるようにするための控え（キャッシュ）係。
// 方針: つながるときは必ずネットの最新版を使い、その写しを控えておく。つながらないときだけ控えを出す。
// こうしておくと「更新したのに古い画面のまま」が起きない。

const CACHE = 'mimikopi-v3';
const ABCJS = 'https://cdn.jsdelivr.net/npm/abcjs@6.4.4/dist/abcjs-basic-min.js';
const PRECACHE = ['./', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', ABCJS];

self.addEventListener('install', (event) => {
  // 初回に、ページ本体と楽譜の部品を控えておく。失敗しても（圏外でも）インストール自体は進める
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // 古い名前の控えは片づける
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !/^https?:/.test(req.url)) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined))
          .then((hit) => hit || Response.error())
      )
  );
});
