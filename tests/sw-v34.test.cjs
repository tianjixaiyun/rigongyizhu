/* v34 · 离线缓存拆成「核心 / 可选」两类的守护测试（外部评审 P1-3）
 *
 * 场景：vendor/cloud-sdk.js 是云同步才用到的 62KB，页面早就改成按需加载了，
 * 但 Service Worker 的 install 还在用一次 addAll 把它当必需品。
 * addAll 是「一个失败整批失败」的语义 —— 那个文件下不下来，整个离线包就装不上，
 * 用户下次断网打开就是白屏。这里用假的 caches 环境把这件事钉住。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODE = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
/* 版本号从 CACHE 名里取（rigongyizhu-vNN），别写死 —— 每升一版都要回来改一次太蠢 */
const VER = (CODE.match(/rigongyizhu-v(\d+)/) || [])[1];
const SDK = './vendor/cloud-sdk.js?v=' + VER;

/* 造一个足够像 CacheStorage 的假环境：可以指定哪个 URL 下载失败 */
function env(opts) {
  const o = opts || {};
  const cached = new Set();
  const calls = { addAll: [], add: [], deleted: [] };
  function makeCache() {
    return {
      async addAll(list) {
        calls.addAll.push(list.slice());
        for (const u of list) {
          /* 真实的 addAll 是一个失败整批失败：下载失败的 URL 会让整个 Promise 拒绝。
           * 所以这里两个失败规则都算 —— 只要 cloud-sdk 还在 addAll 的名单里，安装就该挂。 */
          if ((o.failCore && o.failCore.test(u)) || (o.failOptional && o.failOptional.test(u))) {
            throw new Error('addAll 批次失败: ' + u);
          }
        }
        list.forEach(u => cached.add(u));
      },
      async add(u) {
        calls.add.push(u);
        if (o.failOptional && o.failOptional.test(u)) throw new Error('optional 下载失败: ' + u);
        cached.add(u);
      },
      async put() { },
      async match() { return null; }
    };
  }
  const listeners = {};
  const self = {
    addEventListener(type, fn) { listeners[type] = fn; },
    async skipWaiting() { calls.skipped = true; },
    clients: { claim: async () => { }, matchAll: async () => [] },
    location: { origin: 'https://x.test', href: 'https://x.test/sw.js' }
  };
  const ctx = vm.createContext({
    self, caches: { open: async () => makeCache(), keys: async () => [], delete: async k => { calls.deleted.push(k); } },
    location: self.location, URL, console, Promise, Set, Error, fetch: async () => ({ ok: true, clone() { return this; } })
  });
  vm.runInContext(CODE, ctx);
  return { listeners, cached, calls, ctx };
}

/* 触发 install，返回 Promise：装成功 resolve，装失败 reject */
function install(e) {
  return new Promise((res, rej) => {
    e.listeners.install({ waitUntil: p => Promise.resolve(p).then(res, rej) });
  });
}

test('离线清单把云 SDK 放在可选里，不再当必需品', () => {
  const { ctx } = env();
  const FILES = vm.runInContext('FILES', ctx);
  const OPTIONAL = vm.runInContext('OPTIONAL', ctx);
  assert.ok(!FILES.some(u => /cloud-sdk/.test(u)), 'cloud-sdk 不应在核心清单里');
  assert.ok(OPTIONAL.some(u => /cloud-sdk/.test(u)), 'cloud-sdk 应在可选清单里');
});

test('可选资源下载失败时，核心离线安装仍然成功', async () => {
  const e = env({ failOptional: /cloud-sdk/ });
  await install(e);                       // 不抛错即为通过
  /* v53 · 报告 P2-10：安装完不再自己 skipWaiting。
   * 装好就接管 = 用户正在写日记时被静默换版本，而且他没法主动获取新版特性。
   * 现在必须等页面发 SKIP_WAITING（用户点了「刷新」）。 */
  assert.equal(e.calls.skipped, undefined, '安装完成后不应自动 skipWaiting');
  const FILES = vm.runInContext('FILES', e.ctx);
  for (const u of FILES) assert.ok(e.cached.has(u), '核心资源应已缓存: ' + u);
  assert.ok(!e.cached.has(SDK), '失败的可选资源不该假装缓存成功');
});

test('收到 SKIP_WAITING 才让路（v53 · 报告 P2-10）', async () => {
  const e = env();
  await install(e);
  assert.equal(e.calls.skipped, undefined, '没人发消息之前不能自己切');
  const onMsg = e.listeners.message;
  assert.equal(typeof onMsg, 'function', 'sw.js 必须有 message 监听');
  onMsg({ data: { type: 'SKIP_WAITING' } });
  assert.equal(e.calls.skipped, true, '收到 SKIP_WAITING 后应 skipWaiting');
  /* 其它消息（比如通知相关）不该误触发切换 */
  const e2 = env();
  await install(e2);
  e2.listeners.message({ data: { type: 'something-else' } });
  assert.equal(e2.calls.skipped, undefined, '无关消息不应触发切换');
});

test('可选资源正常时也一并缓存（联网用过云功能后断网仍可用）', async () => {
  const e = env();
  await install(e);
  assert.ok(e.cached.has(SDK));
});

test('核心资源下载失败时，安装必须失败（不能装出半残的离线包）', async () => {
  const e = env({ failCore: /src\/main\.js/ });
  let failed = false;
  try { await install(e); } catch (err) { failed = true; }
  assert.equal(failed, true, '核心资源缺失时安装应 reject');
  assert.ok(!e.calls.skipped, '安装失败时不应 skipWaiting');
});

test('fetch 事件认得可选资源（缓存命中就直接给，不重复请求）', async () => {
  const e = env();
  await install(e);
  let responded = null;
  const req = new Request('https://x.test/vendor/cloud-sdk.js?v=' + VER);
  e.listeners.fetch({
    request: req,
    respondWith(p) { responded = p; }
  });
  assert.ok(responded, '可选资源应走 respondWith，而不是被当成未知路径放过');
});
