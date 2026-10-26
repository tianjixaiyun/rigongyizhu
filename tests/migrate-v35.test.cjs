/* v35 迁移导入单元测试：确认现有 CSV 导入器对 Loop / BeaverHabits 的真实覆盖范围，
 * 以及通用 Markdown 迁出。写这个测试的起因是外部评审说「先确认现有导入器覆盖范围」。
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
const ymd = d => { const t = new Date(); t.setDate(t.getDate() + (d || 0)); return t.toISOString().slice(0, 10); };

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
  load('plus');
  return w;
}

test('Loop 宽表（Date + 每列一个习惯）能导入', async t => {
  const w = await app(t);
  const r = w.Plus.importCSV('Date,跑步,读书\n' + ymd(-1) + ',1,0\n' + ymd(0) + ',1,1\n');
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.habits, 2);
  const done = w.Store.s.logs[ymd(0)];
  assert.ok(done, '今天的记录应该在');
  /* 跨 realm 的数组不能 deepEqual（jsdom window 里造的数组原型不同），比字符串 */
  assert.equal((w.Store.s.items || []).map(i => i.name).sort().join(','), '读书,跑步');
});

test('Loop 长表（Date,Habit,Value）能导入，且一条记录就算完成', async t => {
  const w = await app(t);
  /* Loop 的可计数习惯：同一天两条 1，另一天一条 3 —— 三条都该算做到过 */
  const r = w.Plus.importCSV('Date,Habit,Value\n' +
    ymd(-2) + ',跑步,1\n' + ymd(-2) + ',跑步,1\n' + ymd(-1) + ',读书,3\n');
  assert.equal(r.ok, true, r.msg);
  const logs = w.Store.s.logs;
  const item = (w.Store.s.items || []).find(i => i.name === '读书');
  assert.ok(item, '读书习惯应被创建');
  assert.equal(logs[ymd(-1)][item.id].d, true, '有一条记录就算完成');
  const run = (w.Store.s.items || []).find(i => i.name === '跑步');
  assert.equal(logs[ymd(-2)][run.id].d, true);
  assert.equal(logs[ymd(-2)][run.id].v, 1);
});

test('Markdown 迁出：概览 + 习惯 + 每日记录都能读', async t => {
  const w = await app(t);
  w.Store.commit(s => {
    s.items = [{ id: 'a', name: '早起', type: 'check', color: '#e0503a', schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 30 }];
    s.logs = { [ymd(0)]: { a: { d: true, note: '六点半起了' } } };
  });
  const md = w.Plus.exportMarkdown();
  assert.match(md, /# 日拱一卒 · 数据迁出/);
  assert.match(md, /\| 早起 \| 打卡 \| — \| 1 \| 1 \|/);
  /* 日期别写死 —— 写死的那天之后这条测试每天都会红 */
  assert.ok(md.indexOf('### ' + ymd(0) + '（今天）') >= 0, '缺少今天的日期标题');
  assert.match(md, /- ✓ 早起 —— 「六点半起了」/);
});
