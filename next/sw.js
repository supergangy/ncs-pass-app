/* 이 경로의 워커 — **자기를 지운다.**
 *
 * 재제작 판이 루트로 옮겼다. 안내 페이지만 올리면 이 워커가 캐시에서 옛 앱을
 * 계속 내주므로 안내가 보이지 않는다 (옛 ncs-exam-app 주소에서 배운 것).
 *
 * 캐시 저장소는 **출처 단위**다. 전부 지우면 루트 앱의 캐시까지 날아간다 —
 * 그래서 항목이 **모두 /next/ 인 캐시**만 골라 지운다.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      const urls = (await c.keys()).map(r => new URL(r.url).pathname);
      if (urls.length && urls.every(p => p.includes('/next/'))) await caches.delete(k);
    }
    await self.registration.unregister();
  })());
});

/* 아무것도 가로채지 않는다 — 그물에서 안내 페이지를 받게 둔다 */
