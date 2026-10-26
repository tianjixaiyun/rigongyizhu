/* v31 · 4.6 计时绑定：到点自动打卡 / 中途保留 / 跨天对账
 * 底层（timer.js）在 v25 就有了，这一版补的是三件行为：
 * 1) 到点自动打卡 —— 不用再点一次「完成」
 * 2) 中途收工保留已用时间 —— 提前结束不白计
 * 3) 跨天的旧会话不跟着时钟无限涨
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

async function app(t, modules = []) {
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
  for (const name of modules) load(name);
  await next();
  return { w, load };
}

/* 一个时长型习惯 + 一个可操纵的计时会话 */
function durationHabit(w, target) {
  w.Store.commit(st => {
    st.items = [{ id: 'read', name: '读书', type: 'duration', target: target, unit: '分钟',
      slot: 'any', color: '#15803d', schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 30 }];
    st.logs = {}; st.settings.seedPts = 0;
  });
  return w.Store.s.items[0];
}
const MIN = 60000;

test('到点自动打卡：记目标时长、标完成、清掉会话', async t => {
  const { w } = await app(t, ['timer']);
  const it = durationHabit(w, 30);
  const day = w.U.today();
  /* 已经计了 29.5 分钟、本次又跑了 1 分钟 —— 开机对账应当替用户收工 */
  w.Store.s.timer = { itemId: it.id, date: day, accum: 29.5 * MIN, startAt: Date.now() - 60 * 1000, running: true };
  w.Timer.bootCheck();
  const lg = w.Engine.getLog(day, it.id);
  assert.equal(lg.v, 30, '记的是目标时长，不是溢出的部分');
  assert.equal(lg.d, true, '达标即完成');
  assert.equal(w.Store.s.timer, null, '会话清掉了，不会重复触发');
});

test('提前收工保留已计时间，未达标不算完成', async t => {
  const { w } = await app(t, ['timer']);
  const it = durationHabit(w, 30);
  const day = w.U.today();
  w.Store.s.timer = { itemId: it.id, date: day, accum: 12 * MIN, startAt: Date.now(), running: true };
  const r = w.Timer.keepStop();
  assert.equal(r.minutes, 12);
  const lg = w.Engine.getLog(day, it.id);
  assert.equal(lg.v, 12, '已计的 12 分钟留下了');
  assert.equal(lg.d, false, '没达标就不算完成');
  assert.equal(w.Store.s.timer, null);
});

test('保留的时间累加到既有时长上，不覆盖', async t => {
  const { w } = await app(t, ['timer']);
  const it = durationHabit(w, 30);
  const day = w.U.today();
  w.Engine.setValue(it, day, 15);
  w.Store.s.timer = { itemId: it.id, date: day, accum: 12 * MIN, startAt: Date.now(), running: true };
  w.Timer.keepStop();
  assert.equal(w.Engine.getLog(day, it.id).v, 27);
});

test('不足 1 分钟的收工不留痕迹', async t => {
  const { w } = await app(t, ['timer']);
  const it = durationHabit(w, 30);
  const day = w.U.today();
  w.Store.s.timer = { itemId: it.id, date: day, accum: 20 * 1000, startAt: Date.now(), running: true };
  const r = w.Timer.keepStop();
  assert.equal(r.minutes, 0);
  assert.equal(w.Engine.getLog(day, it.id), null, '点错了一下不该留下记录');
  assert.equal(w.Store.s.timer, null);
});

test('跨天的旧会话记到它开始的那天，不跟着时钟无限涨', async t => {
  const { w } = await app(t, ['timer']);
  const it = durationHabit(w, 30);
  const y = w.U.shiftYmd(w.U.today(), -1), day = w.U.today();
  /* 昨天 21:00 开始计时，一直没关，今天才打开 —— 已计 200 分钟，
   * 但只能记目标 30 分钟（多出来的部分是手机关着的时间，不是专注） */
  w.Store.s.timer = { itemId: it.id, date: y, accum: 200 * MIN, startAt: Date.now() - 200 * MIN, running: true };
  w.Timer.bootCheck();
  assert.equal(w.Engine.getLog(y, it.id).v, 30, '记到昨天，且不超过目标时长');
  assert.equal(w.Engine.getLog(day, it.id), null, '不污染今天');
  assert.equal(w.Store.s.timer, null, '旧会话清掉');
});

test('暂停中的会话到点也不自动收工', async t => {
  const { w } = await app(t, ['timer']);
  const it = durationHabit(w, 30);
  const day = w.U.today();
  /* 29.9 分钟时按了暂停 —— 用户只是想歇一下，不该被自动打卡 */
  w.Store.s.timer = { itemId: it.id, date: day, accum: 29.9 * MIN, startAt: Date.now(), running: false };
  w.Timer.bootCheck();
  assert.equal(w.Engine.getLog(day, it.id), null, '暂停着就不会自动写');
  assert.ok(w.Store.s.timer, '会话还在');
  assert.equal(w.Store.s.timer.running, false, '且仍是暂停态');
  w.Timer.stopAuto();
});

test('习惯被删掉后，遗留会话被清掉且不写日志', async t => {
  const { w } = await app(t, ['timer']);
  durationHabit(w, 30);
  const day = w.U.today();
  w.Store.commit(st => { st.items = []; });
  w.Store.s.timer = { itemId: 'read', date: day, accum: 12 * MIN, startAt: Date.now(), running: true };
  w.Timer.bootCheck();
  assert.equal(w.Store.s.timer, null);
});

test('手动收工记实际时长（可以超过目标），不足 1 分钟按 1 分钟算', async t => {
  const { w } = await app(t, ['timer']);
  const it = durationHabit(w, 30);
  const day = w.U.today();
  w.Store.s.timer = { itemId: it.id, date: day, accum: 45 * MIN, startAt: Date.now(), running: false };
  const r = w.Timer.finish();
  assert.equal(r.minutes, 45, '用户主动收工，记真实时长');
  assert.equal(w.Engine.getLog(day, it.id).v, 45);

  w.Store.s.timer = { itemId: it.id, date: day, accum: 10 * 1000, startAt: Date.now(), running: false };
  const r2 = w.Timer.finish();
  assert.equal(r2.minutes, 1, '按了完成就认这一笔');
});

test('reached 与 targetMs：没设目标的时长习惯只当秒表', async t => {
  const { w } = await app(t, ['timer']);
  const it = durationHabit(w, 0);
  const day = w.U.today();
  w.Store.s.timer = { itemId: it.id, date: day, accum: 60 * MIN, startAt: Date.now(), running: true };
  assert.equal(w.Timer.targetMs(it), 0);
  assert.equal(w.Timer.reached(it), false, '没有目标就永远「未达标」');
  w.Timer.bootCheck();
  assert.ok(w.Store.s.timer, '没目标就不自动收工，会话留着当秒表');
  assert.equal(w.Engine.getLog(day, it.id), null, '也不会偷偷写日志');
  w.Timer.stopAuto();
});
