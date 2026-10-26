/* 日拱一卒 · 独立部署版 Service Worker（GitHub Pages）
 *
 * 与原版 sw.js 的关键区别：
 * 1. 导航请求「网络优先 3 秒超时，失败回退缓存的应用壳」——
 *    平台休眠、断网、5xx 时老用户照样能打开应用，本地数据照常用。
 * 2. 静态资源缓存优先（文件名自带 ?v= 版本号）。
 * 3. 只管同源；云后端（workbuddy.host）等跨域请求原样放行。
 *
 * v45：版本号随发布升到 45；导航兜底同时命中 './' 与 './index.html' 两个键。
 */
const VERSION = 'rigongyizhu-standalone-45';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/app.css?v=45',
  './assets/product.css?v=45',
  './assets/icons.svg',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './src/app.bundle.js?v=45',
  './vendor/cloud-sdk.js?v=45',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 全部尝试预缓存；单个失败不阻断安装（首次有网即可，后续靠运行时补）
    await Promise.allSettled(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 页面导航：网络优先（3 秒），失败回退缓存壳
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const fresh = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
        if (fresh && fresh.ok) {
          cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        }
        throw new Error('bad response');
      } catch (err) {
        const cached = (await cache.match('./index.html')) || (await cache.match('./'));
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>日拱一卒</title>' +
          '<div style="font-family:system-ui;text-align:center;padding:48px 16px">' +
          '<h1>日拱一卒</h1><p>首次打开需要联网，请稍后重试。</p></div>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // 其余同源资源：缓存优先，未命中再走网络并补缓存
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
