/* 서비스 워커 — **만들어진 파일이다. 손으로 고치지 마라.**
 *
 *   생성: node tool/make_sw.mjs   (빌드 뒤에 돌린다)
 *   버전: 파일 목록과 크기의 해시. 내용이 바뀌면 저절로 바뀐다.
 *
 * 껍데기와 문항은 install 에서 담고, 폰트는 요청될 때 담는다 —
 * 폰트 509KB 는 PC 판만 쓰므로 모바일에서 미리 받을 이유가 없다.
 */
const VERSION = 'ncspass-8ddb88a202';

/** 첫 실행에 담을 것 — 16개 */
const SHELL = [
  "./a/desktop-CRVwV8hQ.js",
  "./a/desktop-D0-xJJxR.css",
  "./a/mobile-B69YTDkp.css",
  "./a/mobile-Ctnl1yn7.js",
  "./a/search-BjQAsdOS.js",
  "./a/search-DVQK87ua.css",
  "./data/bank.json",
  "./favicon-32.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./icon.svg",
  "./index.html",
  "./m-manifest.webmanifest",
  "./m/index.html",
  "./manifest.webmanifest"
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // 하나가 실패해도 설치를 깨지 않는다 — 나머지라도 담아 둔다
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
  if (url.origin !== location.origin) return;      // 남의 집 것은 건드리지 않는다

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;

    try {
      const res = await fetch(req);
      // 받아 온 것을 담아 둔다 — 폰트가 여기서 캐시된다
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      // 오프라인이고 캐시에도 없다. 화면 이동이면 껍데기를 준다 (해시 라우터라 그것으로 된다)
      if (req.mode === 'navigate') {
        const shellHit = await cache.match(url.pathname.includes('/m/') ? './m/index.html'
                                                                       : './index.html');
        if (shellHit) return shellHit;
      }
      throw err;
    }
  })());
});
