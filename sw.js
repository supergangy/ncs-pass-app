/* 서비스 워커 — **만들어진 파일이다. 손으로 고치지 마라.**
 *
 *   생성: node tool/make_sw.mjs   (빌드 뒤에 돌린다)
 *   버전: 파일 목록과 크기의 해시. 내용이 바뀌면 저절로 바뀐다.
 *
 * 껍데기와 문항은 install 에서 담고, 폰트는 요청될 때 담는다 —
 * 폰트 509KB 는 PC 판만 쓰므로 모바일에서 미리 받을 이유가 없다.
 */
const VERSION = 'ncspass-21c7fa6ea0';

/** 첫 실행에 담을 것 — 16개 */
const SHELL = [
  "./a/desktop-D6iAZcb0.js",
  "./a/desktop-Dv3rixtm.css",
  "./a/mobile-CHlY1o8E.css",
  "./a/mobile-CvqaEFUe.js",
  "./a/search-CFmDxxpV.js",
  "./a/search-DyoE9MAU.css",
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

/** 껍데기 문서인가 — 이름이 안 바뀌는 주소라 캐시가 오래 남으면 위험한 것 */
const isDoc = (req, url) => req.mode === 'navigate'
                         || url.pathname.endsWith('/')
                         || url.pathname.endsWith('.html');

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // 남의 집 것은 건드리지 않는다

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);

    // ── HTML — 그물 먼저, 끊기면 캐시 ───────────────────────
    //    캐시를 먼저 주면 배포 뒤에도 옛 껍데기가 계속 나가고, 그 안의 묶음
    //    이름은 이미 사라져 **하얀 화면**이 된다. 오프라인일 때만 캐시로 돈다.
    if (isDoc(req, url)) {
      try {
        // fetch(req) 로는 모자란다 — 그것은 **브라우저 HTTP 캐시**를 먼저 본다.
        //   GitHub Pages 가 HTML 에 max-age=600 을 붙이므로, 워커가 그물로 나가도
        //   10분 동안 옛 껍데기가 되돌아온다(실측). no-cache 로 매번 서버에
        //   물어본다 — 안 바뀌었으면 304 라 값이 거의 없다. (backtick 금지: 이 글은
        //   템플릿 문자열 안에 들어간다)
        const res = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
        if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true })
                 || await cache.match(url.pathname.includes('/m/') ? './m/index.html'
                                                                   : './index.html');
        if (hit) return hit;                        // 해시 라우터라 껍데기 하나로 된다
        throw err;
      }
    }

    // ── 그 밖 — 캐시 먼저 ───────────────────────────────────
    //    묶음·폰트·아이콘·문항은 이름이나 캐시 판이 바뀌어야 바뀐다
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;

    const res = await fetch(req);
    // 받아 온 것을 담아 둔다 — 폰트가 여기서 캐시된다
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  })());
});
