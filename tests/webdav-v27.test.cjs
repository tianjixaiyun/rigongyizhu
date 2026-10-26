/* v27 单测（4.6 WebDAV）：冲突判断与恢复形状
 * 冲突规则是这个功能唯一「会毁数据」的地方，必须在不依赖网络的情况下钉死：
 *  ① 自己写的重复上传 → 不冲突（覆盖自己的旧版是应该的）
 *  ② 没见过远端、又是别人写的 → 冲突（第一次上传前问一次）
 *  ③ 见过之后别人写了更新的 → 冲突
 *  ④ 别人写的但更旧 → 不冲突（我们这份更新，覆盖合理）
 *  ⑤ pull() 交出来的必须是「内层导出 JSON」—— 形状不对导入会报「不是本产品的备份」
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.RIGONG_SOURCE_ROOT || root;
const read = file => fs.readFileSync(path.join(sourceRoot, file), 'utf8');

async function app(t) {
  const dom = new JSDOM(read('index.html'), {
    url: 'https://local-test.example/', runScripts: 'outside-only',
    pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  t.after(() => w.close());
  Object.defineProperty(w, 'indexedDB', { value: new IDBFactory(), configurable: true });
  w.structuredClone = structuredClone;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async url => {
    if (!String(url).startsWith('data:')) throw new Error('Network disabled in tests');
    return fetch(url);
  };
  const load = name => w.eval(read('src/' + name + '.js'));
  load('util'); load('store'); load('engine');
  w.Store.initSync(); await w.Store.init();
  w.Store._doSave = () => {};
  load('plugins');
  load('webdav');          // 放在 store 之后：它内部只在调用时才碰 Store
  w.Store.commit(s => {
    s.settings.onboarded = 1;
    s.items = [{
      id: 'run', name: '跑步', type: 'check', slot: 'any', color: '#15803d',
      schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 5
    }];
    s.logs = { '2026-10-21': { run: { d: true, v: 1 } } };
  });
  return { w };
}

/* 假网盘：一个 Map + 可编程的 fetch。remote = null 表示远端没有文件。 */
function stubFetch(w, opts) {
  opts = opts || {};
  const files = opts.files || {};      // name -> 文件内容
  const puts = [];                     // 记录所有 PUT，用于断言「没有偷偷写」
  const log = [];
  w.fetch = async (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    const name = decodeURIComponent(u.split('/').pop());
    log.push(method + ' ' + name);
    if (opts.failWith === 'cors') { const e = new TypeError('Failed to fetch'); throw e; }
    if (method === 'PUT') {
      if (opts.putStatus && opts.putStatus !== 201) {
        return { ok: false, status: opts.putStatus, text: async () => 'err' };
      }
      puts.push({ name: name, body: init.body });
      files[name] = init.body;
      return { ok: true, status: 201, text: async () => 'created' };
    }
    if (method === 'GET') {
      if (!files[name]) return { ok: false, status: 404, text: async () => 'nf' };
      return { ok: true, status: 200, text: async () => files[name] };
    }
    if (method === 'PROPFIND' || method === 'HEAD') {
      if (opts.propfindStatus) return { ok: false, status: opts.propfindStatus, text: async () => 'no' };
      return { ok: true, status: 207, text: async () => '<d:multistatus/>' };
    }
    return { ok: false, status: 405, text: async () => '' };
  };
  return { puts: puts, log: log };
}

test('配置校验：地址/用户名/密码缺失都在本地拦住，且不落库', async t => {
  const { w } = await app(t);
  const { log } = stubFetch(w, {});
  assert.equal((await w.WebDAV.save({ url: 'example.com', user: 'u', pass: 'p' })).ok, false);
  assert.equal((await w.WebDAV.save({ url: 'https://x/dav', user: '', pass: 'p' })).ok, false);
  assert.equal((await w.WebDAV.save({ url: 'https://x/dav', user: 'u', pass: '' })).ok, false);
  assert.equal(w.WebDAV.has(), false, '失败的配置不能留在库里');
  assert.equal(log.length, 0, '本地能拦住的错误不该发请求');
});

test('探活失败不落库：401 / CORS / 404 各自给对文案', async t => {
  const { w } = await app(t);
  let s = stubFetch(w, { propfindStatus: 401 });
  let r = await w.WebDAV.save({ url: 'https://x/dav', dir: 'bak', user: 'u', pass: 'p' });
  assert.equal(r.ok, false);
  assert.match(r.msg, /应用密码/, '401 要提示用应用密码');

  s = stubFetch(w, { failWith: 'cors' });
  r = await w.WebDAV.save({ url: 'https://x/dav', dir: 'bak', user: 'u', pass: 'p' });
  assert.equal(r.ok, false);
  assert.match(r.msg, /不允许网页直接访问/, 'CORS 要说明是网盘不让网页直连，而不是密码错');

  s = stubFetch(w, { propfindStatus: 404 });
  r = await w.WebDAV.save({ url: 'https://x/dav', dir: 'bak', user: 'u', pass: 'p' });
  assert.equal(r.ok, false);
  assert.match(r.msg, /建好|不存在/, '404 要提示先把目录建好');
  assert.equal(w.WebDAV.has(), false, '一种都没连上，就不该留下配置');
});

test('上传：写 latest + 一份带时间戳的历史文件', async t => {
  const { w } = await app(t);
  const s = stubFetch(w, {});
  await w.WebDAV.save({ url: 'https://x/dav', dir: 'bak', user: 'u', pass: 'p' });
  const r = await w.WebDAV.upload({});
  assert.equal(r.ok, true);
  const names = s.puts.map(p => p.name);
  assert.ok(names.some(n => n === 'latest.json'), '必须有 latest.json');
  assert.equal(names.filter(n => /^rigongyizu-\d{8}-\d{4}\.json$/.test(n)).length, 1, '历史文件只写一份');
  assert.notEqual(names[0], names[1], '两个文件名不同，历史那份不会被覆盖');
  /* 备份内容只含文字，不带媒体 */
  const wrap = JSON.parse(s.puts[0].body);
  assert.equal(wrap.kind, 'webdav-backup');
  assert.equal(wrap.media, undefined, '照片语音不进网盘备份');
  assert.equal(wrap.data.state.logs['2026-10-21'].run.d, true);
});

test('冲突判断：四种情形各就各位', async t => {
  const { w } = await app(t);
  const s = stubFetch(w, {});
  await w.WebDAV.save({ url: 'https://x/dav', dir: 'bak', user: 'u', pass: 'p' });

  /* ① 远端不存在 → 不冲突 */
  let chk = await w.WebDAV.checkConflict();
  assert.equal(chk.conflict, false, '第一次上传没有远端，不该冲突');

  /* 造一份「本机自己写的」远端 → 不冲突 */
  const mine = JSON.parse(await w.WebDAV.buildBackup());
  const files = {};
  stubFetch(w, { files: files });

  /* ② 别人写的、而且我们没见过 → 冲突（配置后第一次上传要问） */
  files['latest.json'] = JSON.stringify(Object.assign({}, mine, {
    deviceId: 'dev_OTHER', savedAt: Date.now() + 1000
  }));
  w.Store.commit(st => { st.settings.webdav.seenRemoteAt = 0; });
  chk = await w.WebDAV.checkConflict();
  assert.equal(chk.conflict, true, '没见过远端又是别人写的 → 冲突');

  /* ③ 见过之后，别人写了更新的 → 冲突 */
  w.Store.commit(st => { st.settings.webdav.seenRemoteAt = Date.now() - 120000; });
  chk = await w.WebDAV.checkConflict();
  assert.equal(chk.conflict, true, '别人在我们上次见过之后又写了 → 冲突');

  /* ④ 别人写的那份比我们见过的还旧 → 不冲突（我们这份更新，覆盖合理） */
  files['latest.json'] = JSON.stringify(Object.assign({}, mine, {
    deviceId: 'dev_OTHER', savedAt: Date.now() - 3600000
  }));
  w.Store.commit(st => { st.settings.webdav.seenRemoteAt = Date.now() - 60000; });
  chk = await w.WebDAV.checkConflict();
  assert.equal(chk.conflict, false, '别人写的旧版不该拦住我们更新的这份');

  /* ⑤ 自己写的、什么时候都不冲突 */
  files['latest.json'] = JSON.stringify(Object.assign({}, mine, { savedAt: Date.now() + 999999 }));
  chk = await w.WebDAV.checkConflict();
  assert.equal(chk.conflict, false, '自己写的重复上传不冲突');
});

test('冲突时 upload 拒绝写出去；force 之后才覆盖', async t => {
  const { w } = await app(t);
  const files = {};
  const s = stubFetch(w, { files: files });
  await w.WebDAV.save({ url: 'https://x/dav', dir: 'bak', user: 'u', pass: 'p' });
  files['latest.json'] = JSON.stringify({
    app: '日拱一卒', kind: 'webdav-backup', schema: 1,
    deviceId: 'dev_OTHER', savedAt: Date.now() + 60000, habits: 9, days: 30, data: {}
  });
  const before = s.puts.length;
  const r = await w.WebDAV.upload({});
  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
  assert.equal(s.puts.length, before, '有冲突时一个字都不能写上去');
  assert.equal(r.meta.habits, 9, '冲突信息要带上对方那份的概况');

  const f = await w.WebDAV.upload({ force: true });
  assert.equal(f.ok, true);
  assert.ok(s.puts.length > before, '用户明确选择后才允许覆盖');
  const wrap = JSON.parse(files['latest.json']);
  assert.equal(wrap.deviceId, w.WebDAV.cfg().deviceId, '覆盖后是本机这份');
});

test('pull() 交出来的是内层导出 JSON（导入认得）', async t => {
  const { w } = await app(t);
  const files = {};
  const s = stubFetch(w, { files: files });
  await w.WebDAV.save({ url: 'https://x/dav', dir: 'bak', user: 'u', pass: 'p' });
  await w.WebDAV.upload({});
  /* 清库，再从网盘拉回来 —— 端到端闭环 */
  w.Store.commit(st => { st.items = []; st.logs = {}; });
  const p = await w.WebDAV.pull();
  assert.equal(p.ok, true);
  const inner = JSON.parse(p.text);
  assert.equal(inner.app, '日拱一卒', '是导出的那份，不是我们的壳');
  assert.ok(inner.state && inner.state.items, '带 state，Store.importJSON 才认');
  await w.Store.importJSON(p.text, 'replace');
  assert.equal(w.Store.s.items.length, 1, '恢复后习惯回来了');
  assert.equal(w.Store.s.logs['2026-10-21'].run.d, true, '恢复后打卡也回来了');
});

test('一天只自动备份一次；没配置时静默跳过', async t => {
  const { w } = await app(t);
  const s = stubFetch(w, { files: {} });
  assert.equal((await w.WebDAV.autoTick({ toast: false })).skipped, true, '没配置就别动');
  await w.WebDAV.save({ url: 'https://x/dav', dir: 'bak', user: 'u', pass: 'p' });
  const first = await w.WebDAV.autoTick({ toast: false });
  assert.equal(first.ok, true, '配置后当天补一份');
  const second = await w.WebDAV.autoTick({ toast: false });
  assert.equal(second.skipped, true, '当天第二次就跳过');
  assert.equal(s.puts.filter(p => p.name === 'latest.json').length, 1, '没有重复上传');
  /* 拨回昨天：再跑一次应该补上 */
  w.Store.commit(st => { st.settings.webdav.lastAutoDay = '2000-01-01'; });
  const third = await w.WebDAV.autoTick({ toast: false });
  assert.equal(third.ok, true, '跨天要补');
});

test('文件名不合法的历史备份被拦下（防目录穿越）', async t => {
  const { w } = await app(t);
  stubFetch(w, { files: {} });
  await w.WebDAV.save({ url: 'https://x/dav', dir: 'bak', user: 'u', pass: 'p' });
  const r = await w.WebDAV.pullNamed('../../secrets.json');
  assert.equal(r.ok, false, '带斜杠的名字直接拒');
});
