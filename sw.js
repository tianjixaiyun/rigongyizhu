/* 离线缓存：让断网也能打开并打卡
 *
 * 资源分两类（v34 · 外部评审 P1）：
 *   FILES    —— 打开页面就要用的核心资源。安装时 addAll，缺一个就让安装失败、下次重试。
 *   OPTIONAL —— 只有用到某个功能才需要的资源（云同步 SDK 62KB）。
 *               逐个 add、失败忽略：绝不能因为一个可选文件下不下来，
 *               把整个离线安装一起拖垮 —— 那会让「断网也能打卡」这件事失效。
 * 以前 cloud-sdk 在 FILES 里，页面早就改成按需加载了，离线清单却还把它当必需品。
 */
const CACHE = 'rigongyizhu-v54';
const FILES = [
  './', './index.html', './manifest.webmanifest',
  './assets/app.css?v=54', './assets/product.css?v=54', './assets/icons.svg', './assets/icon.svg', './assets/apple-touch-icon.png',
  './src/util.js?v=54', './src/errlog.js?v=54', './src/sync-model.js?v=54', './src/cloud-v18.js?v=54', './src/webdav.js?v=54', './src/enc.js?v=54', './src/store.js?v=54', './src/engine.js?v=54',
  './src/parse.js?v=54', './src/features.js?v=54', './src/todo.js?v=54', './src/challenge.js?v=54', './src/timer.js?v=54', './src/plugins.js?v=54', './src/extra.js?v=54', './src/rooms.js?v=54', './src/lock.js?v=54', './src/buddy.js?v=54', './src/health.js?v=54', './src/fx.js?v=54', './src/ux.js?v=54', './src/remind.js?v=54', './src/insights.js?v=54', './src/ics.js?v=54', './src/paper.js?v=54', './src/plus.js?v=54', './src/diary.js?v=54', './src/level.js?v=54', './src/safety.js?v=54', './src/decor.js?v=54', './src/chart.js?v=54',   './src/product.js?v=54', './src/ui.js?v=54', './src/friends-v19.js?v=54', './src/main.js?v=54'
];
/* 可选资源：下不下来都不影响离线打卡，失败就下次联网时再说 */
const OPTIONAL = ['./vendor/cloud-sdk.js?v=54'];
const ALL = FILES.concat(OPTIONAL);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* 核心：失败即安装失败（保留旧缓存，下次再试），不能装出一个半残的离线包 */
    await c.addAll(FILES);
    /* 可选：allSettled —— 任何一个失败都只丢它自己 */
    await Promise.allSettled(OPTIONAL.map(u => c.add(u)));
    /* v53 · 报告 P2-10：这里原来直接 skipWaiting()，等于「新版本装好就立刻接管」——
     * 用户正在写日记、正在计时，页面底下的资源被换掉且毫无提示。
     * 现在改成：装好就停住（waiting），由页面弹一条「新版本已就绪，点刷新」，
     * 用户点了我才 skipWaiting。首次安装不受影响 —— 那时没有 controller，
     * 浏览器本来就不会进 waiting，装完直接 activate。 */
  })());
});
/* 页面点了「刷新」→ 通知我们让路。没收到就一直等，绝不自己抢。 */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('rigongyizhu-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==location.origin || url.pathname.includes('/.cloud/')) return;
  if(req.mode==='navigate') {
    /* v25 · 评审 5.5：HTML 改走 network-first。
     * 原来 cache-first 会让新版本装好了、页面却还是旧的（用户以为没更新）。
     * 先问网络，拿到新 HTML 就顺手更新缓存；断网时再退回缓存。 */
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => { });
        }
        return res;
      }).catch(() => caches.open(CACHE).then(c => c.match('./index.html')).then(hit => hit || caches.match('./')))
    );
    return;
  }
  const known=ALL.some(path=>new URL(path,location.href).href===url.href);
  if(!known) return;
  e.respondWith(caches.open(CACHE).then(c=>c.match(req)).then(hit=>hit || fetch(req)));
});

/* 通知点击：唤起（或打开）页面，并把"去打卡"的意图带过去 */
self.addEventListener('notificationclick', e => {
  const n = e.notification;
  const data = n.data || {};
  n.close();

  /* 「稍后提醒」：不打开页面，只把意图转给已经开着的页面，由页面延后 N 分钟再提醒。
   * 没有开着的页面时无法在后台定时（网页提醒的固有限制），此时退回"打开应用"——
   * 打开本身就是一次提醒。 */
  if (e.action === 'snooze') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        if (list.length) {
          try { list[0].focus(); } catch (err) { }
          try { list[0].postMessage({ type: 'remind-snooze', id: data.id, min: 30 }); } catch (err) { }
          return;
        }
        return self.clients.openWindow(data.url || './');
      })
    );
    return;
  }

  const target = data.url || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (new URL(c.url).pathname.indexOf('/index.html') >= 0 || new URL(c.url).pathname === '/' || c.url.indexOf('?check=') >= 0) {
          if ('focus' in c) {
            return c.focus().then(() => {
              try { c.postMessage({ type: 'remind-click', url: target }); } catch (err) { }
            });
          }
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
