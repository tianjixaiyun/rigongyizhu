const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.resolve(__dirname, '..');
const next = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function product(t, boot = false) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const console = new VirtualConsole(), errors = [];
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: 'https://local-test.example/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const w = dom.window;
  let requests = 0;
  t.after(() => { w.close(); assert.equal(requests, 0, '不得连接真实服务'); assert.deepEqual(errors, [], '无 DOM 异常'); });
  w.indexedDB = new IDBFactory(); w.structuredClone = structuredClone;
  w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.scrollTo = () => {};
  w.fetch = async () => { requests++; throw new Error('Test network disabled'); };
  const scripts = [...html.matchAll(/<script defer src="(src\/[^"?]+)(?:\?[^"]*)?"/g)].map(x => x[1]);
  const load = script => w.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  for (const script of scripts.filter(x => !x.endsWith('/main.js'))) load(script);
  w.Store.initSync(); await w.Store.init(); w.Store._doSave = () => {};
  w.Diary.ensureWeather = async () => null; w.Cloud.boot = async () => {};
  w.Remind.start = () => {}; w.UX.initPullRefresh = () => {};
  w.Store.commit(st => {
    st.items = []; st.logs = {}; st.bundles = []; st.routines = []; st.todos = [];
    st.settings.onboarded = 1; st.settings.sound = false; st.settings.freezeLeft = 0;
    st.settings.groupBySlot = false; st.settings.pwaHintOff = 1;
  });
  await next();
  if (boot) {
    w.Store.initSync = () => w.Store.s; w.Store.init = async () => w.Store.s;
    load('src/main.js'); w.document.dispatchEvent(new w.Event('DOMContentLoaded')); await next();
  }
  function seed(defs) {
    w.Store.commit(st => { st.items = defs.map((it, i) => ({ id: 'h' + i, name: '习惯' + i, type: 'check', steps: [], color: '#486be6', slot: 'any',
      createdAt: Date.now() - 14 * 86400000, schedule: { type: 'daily' }, ...it })); });
    w.UI.go('today'); return w.Store.s.items;
  }
  const click = selector => { const el = w.document.querySelector(selector); assert.ok(el, selector); el.click(); return el; };
  return { w, seed, click };
}

test('今日筛选随真实打卡更新，进度与最近七天立即一致', async t => {
  const { w, seed, click } = await product(t, true);
  const [it] = seed([{ name: '喝水' }, { name: '阅读' }]);
  click('[data-product="filter"][data-filter="pending"]');
  click('[data-act="tick"][data-id="h0"]');
  assert.equal(w.Engine.isDone(it, w.U.today()), true);
  assert.equal(w.document.getElementById('pDone').textContent, '1');
  assert.equal(w.document.getElementById('pPlTrack').getAttribute('aria-valuenow'), '50');
  assert.equal(w.document.querySelectorAll('.hitem').length, 1);
  assert.equal(w.document.querySelector('.hitem').dataset.id, 'h1');
  assert.equal(w.document.querySelector('[data-count="done"]').textContent, '1');
  assert.match(w.document.querySelector('.p-day.current').getAttribute('aria-label'), /完成 1\/2/);
  click('[data-product="filter"][data-filter="done"]');
  assert.equal(w.document.querySelector('.hitem').dataset.id, 'h0');
});

test('中文搜索等待组合输入完成，支持标签并保持输入焦点', async t => {
  const { w, seed } = await product(t);
  seed([{ name: '喝水', tags: ['健康'] }, { name: '读书', tags: ['学习'] }]);
  let input = w.document.getElementById('todaySearch'); input.focus(); input.value = '健康';
  input.dispatchEvent(new w.InputEvent('input', { bubbles: true, isComposing: true }));
  await wait(190); assert.equal(w.document.querySelectorAll('.hitem').length, 2);
  input.dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true }));
  await wait(190);
  assert.equal(w.document.querySelectorAll('.hitem').length, 1);
  assert.equal(w.document.activeElement.id, 'todaySearch');
  assert.equal(w.document.activeElement.value, '健康');
  input = w.document.activeElement; input.value = '不存在'; input.dispatchEvent(new w.InputEvent('input', { bubbles: true }));
  await wait(190); assert.match(w.document.querySelector('.p-empty-result').textContent, /没有找到/);
  w.document.querySelector('[data-product="reset"]').click();
  assert.equal(w.document.querySelectorAll('.hitem').length, 2);
});

test('卡片菜单与更多入口可用，所有原有页面仍可到达', async t => {
  const { w, seed, click } = await product(t, true);
  seed([{ name: '运动' }]);
  click('.p-habit-menu'); assert.match(w.document.getElementById('sheetTitle').textContent, /运动/);
  assert.ok(w.document.querySelector('[data-act="openhabit"][role="button"]'));
  /* v26 · 「更多功能」只放工具（复检 5.3：它原来是导航复制品）。
     页面入口在底部标签栏（8 个 tab，窄屏只显示 5 个）与「我的」页的快捷入口里。 */
  w.UI.closeSheet(); click('[data-product="more"]');
  const moreBtns = [...w.document.querySelectorAll('.p-more-grid button')].map(b => b.textContent.trim());
  assert.deepEqual(moreBtns, ['切换深浅主题', '番茄钟', '语音打卡']);
  assert.equal(w.document.querySelectorAll('.p-more-grid [data-page]').length, 0);
  w.UI.closeSheet();
  for (const tab of ['today', 'habits', 'diary', 'grow', 'me', 'todos', 'rooms', 'connect']) {
    w.UI.go(tab);
    assert.equal(w.UI.tab, tab);
    assert.equal(w.document.querySelector('.tab[aria-current="page"]').dataset.tab, tab);
  }
  w.UI.go('me');
  /* v54 · 走查 P1-5：「我的」页收成一级页 + 3 个分组，打卡音效搬进了「设置与提醒」 */
  w.UI.setMeSub('settings');
  const toggle = w.document.querySelector('[data-act="togglesound"]');
  assert.equal(toggle.getAttribute('role'), 'switch');
  toggle.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(w.Store.s.settings.sound, true);
  assert.equal(w.document.querySelector('[data-act="togglesound"]').getAttribute('aria-checked'), 'true');
});

test('最近七天入口打开对应日期，补录更新真实历史和回顾图表', async t => {
  const { w, seed, click } = await product(t, true);
  const [it] = seed([{ name: '阅读' }]);
  const day = w.U.shiftYmd(w.U.today(), -1);
  click('.p-week [data-date="' + day + '"]');
  assert.match(w.document.getElementById('sheetTitle').textContent, new RegExp(day));
  click('[data-act="daytick"][data-id="h0"]');
  assert.equal(w.Engine.isDone(it, day), true);
  w.UI.closeSheet(); w.UI.go('grow');
  assert.equal(w.Product.overview().week.done, 1);
  assert.equal(w.document.querySelector('.p-bar-column[data-date="' + day + '"] > span').textContent, '100%');
});

test('编辑名称保留原时段、每周/间隔/星期/月度频率，动机可清空', async t => {
  const { w, seed, click } = await product(t, true);
  const schedules = [{ type: 'timesPerWeek', n: 7 }, { type: 'interval', n: 5 }, { type: 'weekdays', days: [0, 6] }, { type: 'monthly', days: [1, 15, 31] }];
  for (const schedule of schedules) {
    const [it] = seed([{ name: '原名', slot: 'evening', schedule, why: '旧动机', type: 'duration', target: 45, unit: '分钟' }]);
    w.UI.openHabit(it);
    w.document.getElementById('fName').value = '新名'; w.document.getElementById('fWhy').value = '';
    click('[data-act="savehabit"]');
    const saved = w.Store.s.items[0];
    assert.equal(saved.name, '新名'); assert.equal(saved.slot, 'evening');
    assert.equal(saved.schedule.type, schedule.type);
    if (schedule.n) assert.equal(saved.schedule.n, schedule.n);
    if (schedule.days) assert.equal(JSON.stringify([...saved.schedule.days].sort((a, b) => a - b)), JSON.stringify([...schedule.days].sort((a, b) => a - b)));
    assert.equal(saved.type, 'duration'); assert.equal(saved.target, 45); assert.equal(saved.why, '');
  }
  // Reopening sheets must not accumulate weekday toggle handlers.
  w.UI.openHabit(w.Store.s.items[0]); w.UI.openHabit(w.Store.s.items[0]);
  click('[data-f="sched"][data-v="weekdays"]');
  click('[data-fd="6"]');
  assert.ok(w.UI.collectHabit('h0').schedule.days.includes(6));
});

test('创建表单只在需要时显示目标，拒绝小数频率和无穷目标', async t => {
  const { w, click } = await product(t);
  w.UI.openHabit(null);
  assert.equal(w.document.getElementById('fGoalFields').style.display, 'none');
  click('[data-f="type"][data-v="duration"]');
  assert.equal(w.document.getElementById('fGoalFields').style.display, '');
  assert.equal(w.document.getElementById('fTarget').value, '30');
  assert.equal(w.document.getElementById('fUnit').value, '分钟');
  const base = { name: '运动', type: 'duration', target: 30, schedule: { type: 'daily' } };
  assert.equal(w.UI.validateHabit(base), '');
  assert.ok(w.UI.validateHabit({ ...base, target: Infinity }));
  for (const type of ['timesPerWeek', 'interval']) assert.ok(w.UI.validateHabit({ ...base, schedule: { type, n: 2.5 } }));
  assert.ok(w.UI.validateHabit({ ...base, schedule: { type: 'monthly', days: [32] } }));
});

test('保存状态来自事务结果；保存途中继续编辑不提前显示完成', async t => {
  const { w, seed, click } = await product(t);
  seed([{ name: '阅读' }]); w.UI.go('me');
  assert.match(w.document.querySelector('.p-mobile-storage').textContent, /正在保存/);
  const pending = w.Store.saveNow(); w.Store.commit(st => { st.settings.nickname = '新改动'; });
  await pending;
  assert.equal(w.Store.saveStatus.state, 'pending');
  await w.Store.saveNow(); assert.equal(w.Store.saveStatus.state, 'saved');
  assert.match(w.document.querySelector('.p-mobile-storage').textContent, /已保存到本机/);
  click('.p-mobile-storage [data-product="storage"]');
  assert.match(w.document.getElementById('sheetBody').textContent, /清除网站数据前/);
  assert.ok(w.document.querySelector('[data-act="export"]'));
});

test('休息日不误报习惯丢失，也不把未计划日期计入分母', async t => {
  const { w, seed } = await product(t);
  seed([{ name: '休息日测试', schedule: { type: 'weekdays', days: [(w.U.weekdayOf(w.U.today()) + 1) % 7] } }]);
  assert.equal(w.Engine.todayRate(w.U.today()).total, 0);
  assert.match(w.document.getElementById('todayHeading').textContent, /今天没有安排/);
  assert.match(w.document.querySelector('.empty').textContent, /你的习惯还在/);
});

test('数据库与备用缓存同时失败时，明确显示失败和导出入口', async t => {
  const { w, seed } = await product(t);
  seed([{ name: '阅读' }]); w.UI.go('me');
  const db = await new Promise(resolve => { const request = w.indexedDB.open('rigongyizhu', 1); request.onsuccess = () => resolve(request.result); });
  const proto = Object.getPrototypeOf(db), transaction = proto.transaction;
  const setItem = w.Storage.prototype.setItem;
  try {
    proto.transaction = function (...args) {
      const tx = transaction.apply(this, args);
      if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());
      return tx;
    };
    w.Storage.prototype.setItem = () => { throw new w.DOMException('Full', 'QuotaExceededError'); };
    await assert.rejects(w.Store.saveNow());
    assert.equal(w.Store.saveStatus.state, 'error');
    assert.match(w.document.querySelector('.p-mobile-storage').textContent, /保存失败，请导出备份/);
    assert.ok(w.document.querySelector('.p-mobile-storage .error'));
  } finally { proto.transaction = transaction; w.Storage.prototype.setItem = setItem; db.close(); }
});

test('网格快速记录不重建搜索框；键盘焦点保留；待完成筛选在打卡后更新', async t => {
 const {w}=await product(t,true);
 w.Store.commit(s=>{s.items=[
  {id:'check-v19',name:'阅读',type:'check',schedule:{type:'daily'},createdAt:Date.now()},
  {id:'count-v19',name:'喝水',type:'count',target:2,unit:'杯',schedule:{type:'daily'},createdAt:Date.now()}
 ];s.settings.gridView=true;});
 w.UI.go('today');
 const search=w.document.getElementById('todaySearch');
 const tile=w.document.querySelector('.p-tile[data-id="count-v19"]');tile.focus();
 w.Engine.addValue(w.Store.s.items[1],w.U.today(),1);w.Store.commit();
 assert.ok(w.UI.patchToday('count-v19'));assert.equal(w.document.getElementById('todaySearch'),search);
 assert.equal(w.document.activeElement.dataset.id,'count-v19');
 w.document.querySelector('[data-product="filter"][data-filter="pending"]').click();
 w.document.querySelector('.p-tile[data-id="check-v19"]').click();await wait(50);
 assert.equal(w.document.querySelector('.p-tile[data-id="check-v19"]'),null);
});
