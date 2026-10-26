/* 搭子（v32 · 4.7）单元测试：网络用假 fetch，只验逻辑
 * 覆盖：创建/加入落盘、对方完成只提醒一次、打气只提示一次、退出补删
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const next = () => new Promise(resolve => setImmediate(resolve));

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
  const load = name => w.eval(read('src/' + name + '.js'));
  load('util'); load('store'); load('engine');
  w.Store.initSync(); await w.Store.init();
  w.Store._doSave = () => {};
  await next();
  load('buddy');
  /* 假网络：记录每次请求，按调用方给的剧本回包 */
  w.calls = [];
  w.respond = () => ({ status: 200, body: { ok: true } });
  w.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    w.calls.push({ url: String(url).replace(/^https?:\/\/[^/]+/, ''), body });
    const r = w.respond(String(url), body) || { status: 200, body: { ok: true } };
    return { status: r.status, json: async () => r.body };
  };
  w.Store.commit(st => {
    st.items = [{ id: 'read', name: '读书', type: 'check', slot: 'any', color: '#15803d',
      schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 20 }];
    st.logs = {}; st.settings.seedPts = 0; st.settings.nickname = '';
  });
  return w;
}
const toasts = w => {
  const el = w.document.getElementById('toast');
  return el ? el.textContent : '';
};

test('创建搭子：存下 code/token，并把昵称记住', async t => {
  const w = await app(t);
  w.respond = url => url.indexOf('/api/create') >= 0
    ? { status: 200, body: { ok: true, code: 'ABC234', token: 'tok1', me: { nick: '小明', done: false, streak: 0 }, peer: null } }
    : { status: 200, body: { ok: true } };
  const r = await w.Buddy.create('read', '小明');
  assert.equal(r.ok, true);
  assert.equal(r.code, 'ABC234');
  const b = w.Store.s.buddy;
  assert.equal(b.code, 'ABC234');
  assert.equal(b.token, 'tok1');
  assert.equal(b.habitId, 'read');
  assert.equal(w.Store.s.settings.nickname, '小明', '昵称要记下来，下次不用再填');
  const sent = w.calls[0].body;
  assert.equal(sent.habit, '读书');
  assert.equal(sent.nick, '小明');
  assert.equal(typeof sent.done, 'boolean');
  assert.ok(sent.day, '要带上日期，对方才知道这是哪天的状态');
});

test('创建失败不写本地状态', async t => {
  const w = await app(t);
  w.respond = () => ({ status: 503, body: { ok: false, error: 'busy' } });
  const r = await w.Buddy.create('read', '小明');
  assert.equal(r.ok, false);
  assert.equal(w.Store.s.buddy, null);
});

test('加入搭子：409 提示两个人了，404 提示邀请过期', async t => {
  const w = await app(t);
  w.respond = () => ({ status: 409, body: { ok: false, error: 'full' } });
  let r = await w.Buddy.join('ABC234', 'read', '小林');
  assert.equal(r.ok, false);
  assert.ok(/两个人/.test(r.msg), r.msg);
  w.respond = () => ({ status: 404, body: { ok: false, error: 'no-pair' } });
  r = await w.Buddy.join('ABC234', 'read', '小林');
  assert.ok(/过期/.test(r.msg), r.msg);
  assert.equal(w.Store.s.buddy, null);
});

test('对方今天完成：只提醒一次（按日期去重）', async t => {
  const w = await app(t);
  const day = w.U.today();
  w.Store.commit(st => {
    st.buddy = { code: 'ABC234', token: 'tok1', habitId: 'read', nick: '我', peer: null, notifiedFor: '', lastCheerSeen: 0 };
  });
  const peer = { nick: '小林', habit: '读书', done: true, streak: 5, day, cheerAt: 0 };
  w.respond = () => ({ status: 200, body: { ok: true, me: { cheerAt: 0 }, peer } });
  await w.Buddy.sync();
  assert.ok(/今天也完成了/.test(toasts(w)), toasts(w));
  assert.equal(w.Store.s.buddy.notifiedFor, day);
  /* 再同步一次：不能又弹一遍 */
  w.Store.commit(st => { const el = w.document.getElementById('toast'); if (el) el.textContent = ''; });
  await w.Buddy.sync();
  assert.equal(toasts(w), '', '第二次不该再提示');
});

test('对方打气：按 cheerAt 去重，只提示一次', async t => {
  const w = await app(t);
  const day = w.U.today();
  w.Store.commit(st => {
    st.buddy = { code: 'ABC234', token: 'tok1', habitId: 'read', nick: '我', peer: null, notifiedFor: day, lastCheerSeen: 0 };
  });
  const peer = { nick: '小林', habit: '读书', done: false, streak: 3, day, cheerAt: 1790000000000 };
  w.respond = () => ({ status: 200, body: { ok: true, me: { cheerAt: 0 }, peer } });
  await w.Buddy.sync();
  assert.ok(/打了个气/.test(toasts(w)), toasts(w));
  assert.equal(w.Store.s.buddy.lastCheerSeen, 1790000000000);
  w.Store.commit(st => { const el = w.document.getElementById('toast'); if (el) el.textContent = ''; });
  await w.Buddy.sync();
  assert.equal(toasts(w), '', '同一个 cheerAt 不该提示两次');
});

test('退出：删成功就清干净，连不上就留待删条', async t => {
  const w = await app(t);
  w.Store.commit(st => { st.buddy = { code: 'ABC234', token: 'tok1', habitId: 'read', nick: '我', peer: null }; });
  w.respond = () => ({ status: 200, body: { ok: true, gone: true } });
  let r = await w.Buddy.leave();
  assert.equal(w.Store.s.buddy, null);
  assert.equal(w.Store.s.buddyLeave, null);
  assert.equal(r.pending, false);

  /* 断网：本地立刻清掉（用户意图），同时留一张待删条 */
  w.Store.commit(st => { st.buddy = { code: 'XYZ789', token: 'tok2', habitId: 'read', nick: '我', peer: null }; });
  w.fetch = async () => { throw new Error('offline'); };
  r = await w.Buddy.leave();
  assert.equal(w.Store.s.buddy, null, '本地必须立刻清掉');
  assert.equal(r.pending, true);
  assert.equal(w.Store.s.buddyLeave.code, 'XYZ789');
});

test('待删条在联网后补删成功就消失', async t => {
  const w = await app(t);
  w.Store.commit(st => { st.buddyLeave = { code: 'XYZ789', token: 'tok2', at: Date.now() }; });
  w.respond = () => ({ status: 200, body: { ok: true, gone: true } });
  await w.Buddy.flushLeave();
  assert.equal(w.Store.s.buddyLeave, null);
});

test('共享的习惯被删掉：sync 报 gone，不发请求', async t => {
  const w = await app(t);
  w.Store.commit(st => { st.buddy = { code: 'ABC234', token: 'tok1', habitId: 'gone', nick: '我', peer: null }; });
  const before = w.calls.length;
  const r = await w.Buddy.sync();
  assert.equal(r.gone, true);
  assert.equal(w.calls.length, before, '习惯不在了就别往服务端发');
});

test('打气被限流：返回明确文案', async t => {
  const w = await app(t);
  w.Store.commit(st => { st.buddy = { code: 'ABC234', token: 'tok1', habitId: 'read', nick: '我', peer: null }; });
  w.respond = () => ({ status: 429, body: { ok: false, error: 'cheer-limit' } });
  const r = await w.Buddy.cheer();
  assert.equal(r.ok, false);
  assert.ok(/打过气/.test(r.msg), r.msg);
});
