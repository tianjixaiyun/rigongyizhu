const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.RIGONG_SOURCE_ROOT || root;
const read = file => fs.readFileSync(path.join(sourceRoot, file), 'utf8');
const next = () => new Promise(resolve => setImmediate(resolve));

async function app(t, modules = []) {
  // DOM 模拟器不会下载脚本或访问真实云服务，不读取用户浏览器数据。
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
  // Let jsdom's own initial DOMContentLoaded finish before deliberately booting main.
  await next();
  return { w, load };
}
function habits(w, definitions) {
  w.Store.commit(st => {
    st.items = definitions.map((x, i) => Object.assign({
      id: 'habit' + i, name: '习惯' + i, type: 'check', target: null,
      createdAt: Date.now(), steps: [], schedule: { type: 'daily' }
    }, x));
    st.logs = {}; st.settings.seedPts = 0; st.checkRewards = {};
  });
  return w.Store.s.items;
}

test('达标后连续加量只发一次积分，取消后再次完成不刷分', async t => {
  const { w } = await app(t);
  const [it] = habits(w, [{ type: 'number', target: 2 }]);
  const day = w.U.today();
  w.Engine.todayRate(day); // Prime the render cache before writing.
  w.Engine.addValue(it, day, 2);
  const earned = w.Engine.points();
  assert.equal(earned, 40);
  w.Engine.addValue(it, day, 1); w.Engine.setValue(it, day, 8);
  assert.equal(w.Engine.points(), earned);
  w.Engine.setValue(it, day, 0);
  assert.equal(w.Engine.points(), 0);
  w.Engine.addValue(it, day, 2);
  assert.equal(w.Engine.points(), earned);
});

test('达标后的每次加号、手动改值均不会重复发奖', async t => {
  const { w } = await app(t);
  const [it] = habits(w, [{ type: 'number', target: 1 }]), day = w.U.today();
  w.Engine.addValue(it, day, 1);
  const earned = w.Engine.points();
  for (let i = 0; i < 10; i++) w.Engine.addValue(it, day, 1);
  w.Engine.setValue(it, day, 20);
  assert.equal(w.Engine.points(), earned);
});

test('同一次修改立即更新完成率缓存和全完成奖励', async t => {
  const { w } = await app(t);
  const list = habits(w, [{}, {}]), day = w.U.today();
  assert.equal(w.Engine.todayRate(day).done, 0);
  w.Engine.toggle(list[0], day); w.Engine.toggle(list[1], day);
  assert.equal(w.Engine.todayRate(day).pct, 100);
  assert.equal(w.Engine.points(), 50);
  w.Engine.toggle(list[1], day);
  assert.equal(w.Engine.points(), 10);
});

test('撤销一键完成恢复原来部分完成的数值', async t => {
  const { w } = await app(t);
  const [it] = habits(w, [{ type: 'number', target: 30 }]), day = w.U.today();
  w.Engine.setValue(it, day, 20);
  const old = structuredClone(w.Engine.getLog(day, it.id));
  w.Engine.toggle(it, day);
  w.Engine.restoreLog(it, day, old);
  assert.equal(w.Engine.getLog(day, it.id).v, 20);
  assert.equal(w.Engine.points(), 0);
});

test('分步骤习惯必须完成全部步骤，且不接受越界步骤', async t => {
  const { w } = await app(t);
  const [it] = habits(w, [{ type: 'number', target: 1, steps: ['第一步', '第二步'] }]);
  const day = w.U.today();
  w.Engine.toggleStep(it, day, 0);
  assert.equal(w.Engine.isDone(it, day), false);
  w.Engine.toggleStep(it, day, 9);
  assert.equal(w.Engine.getLog(day, it.id).v, 1);
  w.Engine.toggleStep(it, day, 1);
  assert.equal(w.Engine.isDone(it, day), true);
  assert.equal(w.Engine.points(), 40);
});

test('套餐支持戒断型与分步骤习惯，并可取消', async t => {
  const { w } = await app(t);
  const list = habits(w, [{ type: 'avoid' }, { type: 'number', target: 1, steps: ['A', 'B'] }]);
  const bundle = { itemIds: list.map(x => x.id) };
  w.Engine.runBundle(bundle);
  assert.equal(w.Engine.bundleProgress(bundle).done, 2);
  assert.equal(w.Engine.points(), 50);
  w.Engine.runBundle(bundle);
  assert.equal(w.Engine.points(), 0);
});

test('数字入口拒绝无穷和 NaN，不污染日志', async t => {
  const { w } = await app(t);
  const [it] = habits(w, [{ type: 'number', target: 2 }]);
  assert.throws(() => w.Engine.setValue(it, w.U.today(), Infinity));
  assert.throws(() => w.Engine.addValue(it, w.U.today(), NaN));
  assert.equal(w.Engine.getLog(w.U.today(), it.id), null);
});

test('同一天多次计时累加，不覆盖既有时长', async t => {
  const { w } = await app(t, ['timer']);
  const [it] = habits(w, [{ type: 'duration', target: 30 }]), day = w.U.today();
  w.Engine.setValue(it, day, 15);
  w.Store.s.timer = { itemId: it.id, date: day, accum: 10 * 60000, running: false };
  w.Timer.finish();
  assert.equal(w.Engine.getLog(day, it.id).v, 25);
  assert.equal(w.Store.s.timer, null);
});

test('合并备份包含待办、挑战、例程、胶囊、媒体索引且去重', async t => {
  const { w } = await app(t);
  /* v22 起导入会对账：没有 blob 也没有 cloud 的索引算幽灵，会被清掉。
   * 这里用一条真实可用的云端索引（cloud=1 + path）来验证「合并会带上媒体索引」。 */
  const imported = { items: [], todos: [{ id: 't', title: '待办' }], challenges: [{ id: 'c' }],
    routines: [{ id: 'r' }], capsules: [{ id: 'p' }],
    media: { photo: { kind: 'photo', cloud: 1, path: 'u/1/media/photo.jpg' } } };
  await w.Store.importJSON({ state: imported }, 'merge');
  await w.Store.importJSON({ state: imported }, 'merge');
  for (const key of ['todos', 'challenges', 'routines', 'capsules']) assert.equal(w.Store.s[key].length, 1, key);
  assert.equal(w.Store.s.media.photo.kind, 'photo');
  assert.equal(w.Store.s.media.photo.path, 'u/1/media/photo.jpg');
});

test('合并日志使用更新日期，不被较旧备份覆盖', async t => {
  const { w } = await app(t);
  const [it] = habits(w, [{}]), day = w.U.today();
  w.Engine.setLog(day, it.id, { d: true, v: 1 });
  await w.Store.importJSON({ items: [], logs: { [day]: { [it.id]: { d: false, v: 0, t: 1 } } } }, 'merge');
  assert.equal(w.Engine.isDone(it, day), true);
});

test('替换旧备份补齐默认设置，并立即使统计缓存失效', async t => {
  const { w } = await app(t);
  habits(w, [{}]); w.Engine.items();
  await w.Store.importJSON({ items: [], settings: { nickname: '旧用户' } }, 'replace');
  assert.equal(w.Store.s.settings.nickname, '旧用户');
  assert.equal(w.Store.s.settings.autoSync, true);
  assert.equal(w.Engine.items().length, 0);
});

test('无效备份、危险字段、远程媒体链接不会修改现有数据', async t => {
  const { w } = await app(t);
  const before = JSON.stringify(w.Store.s);
  for (const invalid of [null, 123, { nonsense: true }, { items: 'broken' },
    { items: [], settings: [] }, JSON.parse('{"items":[],"__proto__":{"polluted":true}}'),
    { state: { items: [] }, media: { x: 'https://example.com/track' } }]) {
    await assert.rejects(w.Store.importJSON(invalid, 'replace'));
    assert.equal(JSON.stringify(w.Store.s), before);
  }
});

test('IndexedDB 事务回滚时写备用缓存，并在下次启动恢复较新记录', async t => {
  const { w } = await app(t);
  await w.Store.saveNow();
  const db = await new Promise((resolve, reject) => {
    const r = w.indexedDB.open('rigongyizhu', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  const prototype = Object.getPrototypeOf(db), original = prototype.transaction;
  prototype.transaction = function (...args) {
    const tx = original.apply(this, args);
    if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());
    return tx;
  };
  w.Store.s.settings.nickname = '事务失败后仍需保存';
  assert.equal(await w.Store.saveNow(), true);
  prototype.transaction = original;
  assert.ok(w.localStorage.getItem('rigongyizhu.state'));
  w.Store.initSync(); await w.Store.init();
  assert.equal(w.Store.s.settings.nickname, '事务失败后仍需保存');
  await w.Store.saveNow();
  assert.equal(w.localStorage.getItem('rigongyizhu.state'), null);
  db.close();
});

test('云合并包含待办和挑战，较旧日志不覆盖本地', async t => {
  const { w } = await app(t, ['sync-model']);
  const [it] = habits(w, [{}]), day = w.U.today();
  w.Engine.setLog(day, it.id, { d: true, v: 1 });
  w.SyncModel.merge(w.Store.s, { items: [], todos: [{ id: 'cloudtodo' }], challenges: [{ id: 'cloudchallenge' }],
    logs: { [day]: { [it.id]: { d: false, v: 0, t: 1 } } } });
  assert.equal(w.Store.s.todos.length, 1);
  assert.equal(w.Store.s.challenges.length, 1);
  assert.equal(w.Engine.isDone(it, day), true);
  await w.Store.saveNow();
});

test('弹窗具备关闭按钮、Escape 关闭及焦点返回', async t => {
  const { w } = await app(t, ['ui']);
  /* v25：提醒 / 云备份 已从顶栏移到「我的」，顶栏不再有这两个按钮 */
  assert.equal(w.document.getElementById('btnCloud'), null);
  assert.equal(w.document.getElementById('btnNotify'), null);
  const trigger = w.document.getElementById('btnTheme'); trigger.focus();
  w.UI.sheet('测试弹窗', '<button>内容</button>');
  const sheet = w.document.getElementById('sheet');
  assert.equal(sheet.getAttribute('role'), 'dialog');
  assert.equal(w.document.activeElement, sheet);
  assert.ok(sheet.querySelector('[aria-label="关闭弹窗"]'));
  assert.equal(w.document.getElementById('app').inert, true);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(sheet.classList.contains('on'), false);
  assert.equal(w.document.activeElement, trigger);
  assert.equal(w.document.getElementById('app').inert, false);
});

async function bootDiary(t) {
  const { w, load } = await app(t, ['diary']);
  w.Store.s.settings.onboarded = 1;
  w.Store.initSync = () => w.Store.s; w.Store.init = async () => w.Store.s;
  const date = w.U.today();
  w.Feat = { Pomo: { paint() {} }, Notify: { startLoop() {} }, Voice: { stop() {} } };
  w.UI = { tab: 'diary', diaryState: () => ({ date }), render() {}, go() {}, closeSheet() {}, savedTip() {} };
  load('main');
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await next();
  const editor = w.document.createElement('textarea'); editor.dataset.act = 'dytext';
  w.document.getElementById('view').appendChild(editor);
  return { w, editor, date };
}

test('日记在防抖期间切页或被重绘时保存输入快照', async t => {
  const { w, editor, date } = await bootDiary(t);
  editor.value = '还没有等到半秒就切页';
  editor.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.document.dispatchEvent(new w.Event('rigong:before-render'));
  editor.remove();
  assert.equal(w.Store.s.notes[date].text, '还没有等到半秒就切页');
});

test('页面切后台立即保存最后一笔日记和数据', async t => {
  const { w, editor, date } = await bootDiary(t);
  editor.value = '切后台前最后一句';
  editor.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.dispatchEvent(new w.Event('pagehide'));
  assert.equal(w.Store.s.notes[date].text, '切后台前最后一句');
  await w.Store.saveNow();
  const db = await new Promise(resolve => { const r = w.indexedDB.open('rigongyizhu', 1); r.onsuccess = () => resolve(r.result); });
  const persisted = await new Promise(resolve => { const r = db.transaction('kv').objectStore('kv').get('state'); r.onsuccess = () => resolve(r.result); });
  assert.equal(persisted.notes[date].text, '切后台前最后一句'); db.close();
});
