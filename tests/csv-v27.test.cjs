/* v27 单测（4.4 CSV 导出 / 导入）：
 * 不依赖浏览器，直接跑 plus.js 的导出与解析逻辑。
 * 重点是「闭环」：导出 → 导回 → 再导出必须一字不差，
 * 以及 Loop 宽表兼容、引号/逗号/换行转义、空记录不落地。 */
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
  load('plus');
  return { w };
}
function seed(w, items, logs) {
  w.Store.commit(s => {
    s.items = items.map((x, i) => Object.assign({
      id: 'h' + i, name: '习惯' + i, type: 'check', target: null, unit: '', slot: 'any',
      createdAt: Date.now() - 86400000 * 30, steps: [], schedule: { type: 'daily' }
    }, x));
    s.logs = logs;
  });
  return w.Store.s.items;
}

test('导出 CSV：BOM + CRLF + schema，四类状态各就各位', async t => {
  const { w } = await app(t);
  seed(w, [
    { id: 'run', name: '跑步', type: 'check' },
    { id: 'water', name: '喝水', type: 'number', unit: '升' },
    { id: 'sugar', name: '不喝含糖饮料', type: 'avoid' }
  ], {
    '2026-10-19': { run: { d: true, v: 1 }, water: { d: true, v: 1.5 }, sugar: { slip: true } },
    '2026-10-20': { run: {}, water: { d: true, v: 2.5 }, sugar: {} },
    '2026-10-21': { run: { d: true, v: 1, note: '雨,停跑\n"第二天"跑' }, water: { d: true, v: 1.8 }, sugar: {} }
  });
  const csv = w.Plus.exportCSV();
  assert.equal(csv.charCodeAt(0), 0xFEFF, '开头必须是 BOM，否则 Excel 中文乱码');
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines[0], 'date,habit,type,value,unit,status,note,schema');
  const rows = lines.slice(1).filter(Boolean);
  assert.equal(rows.length, 6, '空记录不导出：9 条记录里 3 条是空');
  assert.ok(rows[0].includes('2026-10-19,跑步,check,1,,done,'));
  assert.ok(rows.some(r => r.includes('2026-10-19,喝水,number,1.5,升,done,')));
  assert.ok(rows.some(r => r.includes('2026-10-19,不喝含糖饮料,avoid,,,slip,')));
  assert.ok(rows.every(r => r.endsWith('rigongyizu-csv/1')), '每行都带 schema 版本号');
  const noteRow = rows.find(r => r.startsWith('2026-10-21,跑步'));
  assert.ok(noteRow.includes('"雨,停跑\n""第二天""跑"'), '逗号引号换行三种都要转义');
});

test('闭环：导出 → 导回 → 再导出，一字不差', async t => {
  const { w } = await app(t);
  seed(w, [
    { id: 'run', name: '跑步', type: 'check' },
    { id: 'water', name: '喝水', type: 'number', unit: '升' },
    { id: 'sugar', name: '不喝含糖饮料', type: 'avoid' }
  ], {
    '2026-10-19': { run: { d: true, v: 1, note: '配速 5\'42"' }, water: { d: true, v: 1.5 }, sugar: { slip: true } },
    '2026-10-21': { run: { d: true, v: 1, note: '雨,停跑\n第二天跑' }, water: { d: true, v: 1.8 }, sugar: {} }
  });
  const a = w.Plus.exportCSV();
  w.Store.commit(s => { s.items = []; s.logs = {}; });
  const r = w.Plus.importCSV(a);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'long');
  assert.equal(r.total, 3, '三个习惯都认出来了');
  assert.equal(r.logs, 5, '五条记录都回去了');
  const b = w.Plus.exportCSV();
  assert.equal(a, b, '再导出的内容必须和第一次完全一致');
});

test('长表回读：状态/数值/单位/类型/备注逐项还原', async t => {
  const { w } = await app(t);
  const it0 = seed(w, [{ id: 'run', name: '跑步', type: 'check' }], {});
  const csv = '\uFEFFdate,habit,type,value,unit,status,note,schema\r\n' +
    '2026-10-19,跑步,check,1,,done,"a,b",rigongyizu-csv/1\r\n';
  w.Plus.importCSV(csv);
  const lg = w.Store.s.logs['2026-10-19']['run'];
  assert.equal(lg.d, true);
  assert.equal(lg.v, 1);
  assert.equal(lg.note, 'a,b');

  const csv2 = 'date,habit,type,value,unit,status,note,schema\r\n' +
    '2026-10-19,喝水,number,2.5,升,done,,rigongyizu-csv/1\r\n' +
    '2026-10-20,不喝含糖饮料,avoid,,,slip,,rigongyizu-csv/1\r\n';
  w.Store.commit(s => { s.items = []; s.logs = {}; });
  w.Plus.importCSV(csv2);
  const water = w.Store.s.items.find(i => i.name === '喝水');
  const sugar = w.Store.s.items.find(i => i.name === '不喝含糖饮料');
  assert.equal(water.type, 'number');
  assert.equal(water.unit, '升');
  assert.equal(w.Store.s.logs['2026-10-19'][water.id].v, 2.5);
  assert.equal(sugar.type, 'avoid', '戒断型不能被导回成打卡型');
  assert.equal(w.Store.s.logs['2026-10-20'][sugar.id].slip, true, '破戒要落成 slip');
});

test('Loop 宽表兼容：按行按列识别完成', async t => {
  const { w } = await app(t);
  const r = w.Plus.parseCSV('\uFEFFDate,跑步,喝水\r\n2026-10-01,1,0\r\n2026-10-02,1,1\r\n2026-10-03,x,0\r\n');
  assert.equal(r.kind, 'wide');
  assert.deepEqual([...r.habits.map(h => h.name)], ['跑步', '喝水']);
  assert.deepEqual([...r.habits[0].dates], ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual([...r.habits[1].dates], ['2026-10-02'], '0 不算完成');
  w.Store.commit(s => { s.items = []; s.logs = {}; });
  const im = w.Plus.importCSV('\uFEFFDate,跑步,喝水\r\n2026-10-01,1,0\r\n2026-10-02,1,1\r\n');
  assert.equal(im.logs, 3, '两条跑步 + 一条喝水');
});

test('导入只补空缺，不覆盖已有真实记录', async t => {
  const { w } = await app(t);
  const [it] = seed(w, [{ id: 'run', name: '跑步', type: 'check' }], {});
  w.Store.commit(s => { s.logs['2026-10-02'] = { run: { d: true, v: 3, note: '真实记录' } }; });
  const r = w.Plus.importCSV('date,habit,value,status\r\n2026-10-02,跑步,1,done\r\n2026-10-03,跑步,1,done\r\n');
  assert.equal(r.kept, 1, '已存在的记录算 kept');
  assert.equal(r.logs, 1, '只补 10-03 那天');
  const lg = w.Store.s.logs['2026-10-02'].run;
  assert.equal(lg.v, 3, '数值不被导入覆盖');
  assert.equal(lg.note, '真实记录', '备注不被导入覆盖');
});

test('垃圾输入不炸：空文件 / 只有表头 / 列名对不上', async t => {
  const { w } = await app(t);
  assert.equal(w.Plus.parseCSV('').habits.length, 0);
  assert.equal(w.Plus.parseCSV('\uFEFFdate,habit,status\r\n').habits.length, 0, '只有表头 → 没有数据');
  assert.equal(w.Plus.parseCSV('随便写点什么\n没有表头').habits.length, 0);
  const r = w.Plus.importCSV('');
  assert.equal(r.ok, false, '导入失败要给原因，不能静默');
});
