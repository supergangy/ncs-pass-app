/* 서비스 워커 — 앱 껍데기와 문항을 캐시에 넣어 **오프라인에서 전부 돌아가게** 한다.
 *
 * 한국사 앱이 문항을 APK 안에 넣은 것과 같은 목적이다. 지하철에서 풀려야 한다.
 * `admin.json` 은 **일부러 넣지 않는다** — 관리자 모드일 때만 받아 온다.
 *
 * 콘텐츠를 새로 배포할 때는 아래 VERSION 을 올린다. 옛 캐시는 activate 에서 지운다.
 */
const VERSION = 'ncsbank-v12';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './favicon-32.png',
  './data/bank.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // 하나라도 실패하면 설치가 통째로 깨지므로 개별로 담는다
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 캐시가 있으면 먼저 내주고, 뒤에서 조용히 새것을 받아 둔다.
  // 오프라인에서 즉시 뜨는 것이 먼저이고, 갱신은 다음 실행에 반영된다.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
