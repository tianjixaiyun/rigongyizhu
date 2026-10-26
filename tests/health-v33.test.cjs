/* 健康数据导入（v33）单元测试：只验解析与落库逻辑，不碰 UI
 * 覆盖：Apple export.xml 按天聚合（含分片步数、睡眠只算睡着、锻炼时长单位）、
 *       三种来源识别、指标汇总口径、只补空缺、阈值判完成、不发积分
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

const ymd = d => {
  const t = new Date();
  t.setDate(t.getDate() + (d || 0));
  return t.toISOString().slice(0, 10);
};

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
  load('health');
  w.Store.commit(st => {
    st.items = [{ id: 'walk', name: '走路', type: 'duration', target: 8000, unit: '步', slot: 'any',
      color: '#15803d', schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 30 }];
    st.logs = {}; st.settings.seedPts = 0;
  });
  return w;
}

const XML = (rows) => '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="zh_CN">\n' + rows.join('\n') + '\n</HealthData>';
const step = (day, hh, mm, v) =>
  '<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" ' +
  'startDate="' + day + ' ' + hh + ':' + mm + ':00 +0800" endDate="' + day + ' ' + hh + ':' + mm + ':00 +0800" value="' + v + '"/>';

test('Apple 步数是分片记录：同一天多条要相加，不能只剩最后一条', async t => {
  const w = await app(t);
  const d = ymd(0);
  const xml = XML([step(d, '08', '00', '300'), step(d, '12', '30', '1200'), step(d, '19', '05', '850')]);
  const ms = w.Health.metrics(w.Health.parseText(xml).acc);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].key, 'steps');
  assert.equal(ms[0].count, 1);
  assert.equal(ms[0].days[0].v, 2350);
  assert.equal(ms[0].avg, 2350);
});

test('Apple 睡眠只算「睡着」的段落，卧床和清醒不计，按小时折算', async t => {
  const w = await app(t);
  const d = ymd(-1);
  const xml = XML([
    '<Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisInBed" startDate="' + d + ' 22:30:00 +0800" endDate="' + d + ' 23:00:00 +0800"/>',
    '<Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="' + d + ' 23:00:00 +0800" endDate="' + d + ' 23:30:00 +0800"/>',
    '<Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAwake" startDate="' + d + ' 23:30:00 +0800" endDate="' + d + ' 23:50:00 +0800"/>',
    '<Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="' + d + ' 23:50:00 +0800" endDate="' + d + ' 23:59:59 +0800"/>'
  ]);
  const ms = w.Health.metrics(w.Health.parseText(xml).acc);
  assert.equal(ms[0].key, 'sleep');
  /* 30 分 + 约 10 分 = 约 0.66 小时（卧床 30 分、清醒 20 分都不算） */
  assert.ok(ms[0].days[0].v > 0.6 && ms[0].days[0].v < 0.7, '实际 ' + ms[0].days[0].v);
});

test('Apple 锻炼：duration 单位是秒时折成分钟', async t => {
  const w = await app(t);
  const d = ymd(0);
  const xml = XML([
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" startDate="' + d + ' 07:00:00 +0800" endDate="' + d + ' 07:30:00 +0800"/>',
    '<Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="1800" durationUnit="sec" startDate="' + d + ' 18:00:00 +0800" endDate="' + d + ' 18:30:00 +0800"/>'
  ]);
  const ms = w.Health.metrics(w.Health.parseText(xml).acc);
  assert.equal(ms[0].key, 'exercise');
  assert.equal(ms[0].days[0].v, 60);
});

test('太早的记录不进内存：只取最近 400 天', async t => {
  const w = await app(t);
  const old = '2020-01-01';
  const xml = XML([step(old, '08', '00', '5000'), step(ymd(0), '09', '00', '1234')]);
  const ms = w.Health.metrics(w.Health.parseText(xml).acc);
  assert.equal(ms[0].count, 1);
  assert.equal(ms[0].days[0].d, ymd(0));
});

test('Health Auto Export 的 JSON：多个指标各归各的', async t => {
  const w = await app(t);
  const d = ymd(0);
  const j = JSON.stringify({ data: { metrics: [
    { name: 'step_count', units: 'count', data: [{ date: d + ' 00:00:00 +0800', qty: 6000 }, { date: d + ' 12:00:00 +0800', qty: 3000 }] },
    { name: 'apple_sleeping_wrist_temperature', units: 'degC', data: [] },
    { name: 'sleep_analysis', units: 'hr', data: [{ date: d + ' 08:00:00 +0800', qty: 7.5 }] }
  ] } });
  const ms = w.Health.metrics(w.Health.parseText(j).acc);
  const byKey = {};
  ms.forEach(m => { byKey[m.key] = m; });
  assert.equal(byKey.steps.days[0].v, 9000);
  assert.equal(byKey.sleep.days[0].v, 7.5);
});

test('Google Fit 的 CSV：Date,Step count 也按天求和', async t => {
  const w = await app(t);
  const d = ymd(0);
  const csv = 'Date,Step count\n' + d + ' 08:00:00,1200\n' + d + ' 18:00:00,3800\n' + ymd(-1) + ' 09:00:00,5000';
  const ms = w.Health.metrics(w.Health.parseText(csv).acc);
  assert.equal(ms[0].key, 'steps');
  assert.equal(ms[0].count, 2);
  assert.equal(ms[0].days.filter(x => x.d === d)[0].v, 5000);
});

test('中文表头（日期,步数）也认', async t => {
  const w = await app(t);
  const csv = '日期,步数\n' + ymd(0) + ',7200';
  const ms = w.Health.metrics(w.Health.parseText(csv).acc);
  assert.equal(ms[0].key, 'steps');
  assert.equal(ms[0].label, '步数');
  assert.equal(ms[0].days[0].v, 7200);
});

test('长表（date,name,value）能一次带多个指标', async t => {
  const w = await app(t);
  const d = ymd(0);
  const csv = 'date,name,value\n' + d + ',步数,4000\n' + d + ',睡眠,6.5\n' + d + ',体重,68.4';
  const ms = w.Health.metrics(w.Health.parseText(csv).acc);
  const keys = ms.map(m => m.key).sort().join(',');
  /* 跨 realm 的数组原型不同，deepEqual 会误判；比字符串最稳 */
  assert.equal(keys, 'sleep,steps,weight');
  assert.equal(ms.filter(m => m.key === 'weight')[0].agg, 'avg');
});

test('落库：只补空缺，用户自己打过的日子不动', async t => {
  const w = await app(t);
  const d0 = ymd(0), d1 = ymd(-1);
  w.Store.commit(st => { st.logs[d0] = { walk: { v: 100, d: true, by: '我' } }; });
  const ms = w.Health.metrics(w.Health.parseText(XML([step(d0, '09', '00', '9000'), step(d1, '09', '00', '9000')])).acc);
  const r = w.Health.apply(ms[0], 'walk', { thr: 8000, mode: 'empty' });
  assert.equal(r.days, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.done, 1);
  assert.equal(w.Store.s.logs[d0].walk.v, 100, '原有记录不能被覆盖');
  assert.equal(w.Store.s.logs[d1].walk.v, 9000);
  assert.equal(w.Store.s.logs[d1].walk.d, true);
});

test('阈值决定算不算完成：6000 步 + 门槛 8000 不打卡但数值照样留下', async t => {
  const w = await app(t);
  const d = ymd(-2);
  const ms = w.Health.metrics(w.Health.parseText(XML([step(d, '09', '00', '6000')])).acc);
  w.Health.apply(ms[0], 'walk', { thr: 8000, mode: 'empty' });
  assert.equal(w.Store.s.logs[d].walk.v, 6000);
  assert.equal(w.Store.s.logs[d].walk.d, false);
  assert.equal(w.Engine.isDone(w.Store.s.items[0], d), false);
});

test('门槛填 0（心率、体重这类）→ 有记录就算完成', async t => {
  const w = await app(t);
  const d = ymd(-3);
  const ms = w.Health.metrics(w.Health.parseText(XML([step(d, '09', '00', '100')])).acc);
  w.Health.apply(ms[0], 'walk', { thr: 0, mode: 'empty' });
  assert.equal(w.Store.s.logs[d].walk.d, true);
});

test('补历史不发积分：seedPts 一分不涨', async t => {
  const w = await app(t);
  const xml = XML([step(ymd(-1), '09', '00', '9000'), step(ymd(-2), '09', '00', '9000')]);
  const ms = w.Health.metrics(w.Health.parseText(xml).acc);
  w.Health.apply(ms[0], 'walk', { thr: 8000, mode: 'empty' });
  assert.equal(w.Store.s.settings.seedPts, 0);
});

test('新建习惯：数值型、目标=阈值、单位跟着指标走', async t => {
  const w = await app(t);
  const ms = w.Health.metrics(w.Health.parseText(XML([step(ymd(0), '09', '00', '9000')])).acc);
  const id = w.Health.makeHabit(ms[0]);
  const it = w.Store.s.items.filter(x => x.id === id)[0];
  assert.equal(it.name, '步数');
  assert.equal(it.type, 'duration');
  assert.equal(it.target, 8000);
  assert.equal(it.unit, '步');
});

test('认不出来的内容不瞎猜：返回空指标而不是报错', async t => {
  const w = await app(t);
  const r = w.Health.parseText('随便一段文字，没有任何表格结构');
  assert.equal(w.Health.metrics(r.acc).length, 0);
});

test('大文件分块读：跨块被切开的标签不会丢，也不会算重', async t => {
  const w = await app(t);
  /* 造 ~7MB：约 3 万条记录，必然跨过 4MB 的分块边界。
   * 每条 100 步，全部落在同一天 —— 期望 30000 × 100 = 3,000,000。 */
  const d = ymd(0);
  const N = 30000;
  const one = '<Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="' + d +
    ' 08:00:00 +0800" endDate="' + d + ' 08:10:00 +0800" value="100"/>';
  const xml = XML(new Array(N).fill(one));
  const file = new w.File([xml], 'export.xml', { type: 'text/xml' });
  assert.ok(file.size > 4 * 1024 * 1024, '样本要大于一个分块，实际 ' + file.size);
  const r = await w.Health.scanFile(file);
  const ms = w.Health.metrics(r.acc);
  assert.equal(ms[0].key, 'steps');
  assert.equal(ms[0].count, 1);
  assert.equal(ms[0].days[0].v, N * 100);
});
