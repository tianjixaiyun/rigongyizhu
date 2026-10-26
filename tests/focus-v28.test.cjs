/* v28 单测（4.2 / 4.3 / 4.4 / 4.5）：断签修复、最小版本、回归判断、备注检索
 * 这四条都是「规则型」逻辑 —— 判错了不会报错，只会静悄悄地多给/少给一次机会，
 * 所以用不着浏览器，直接在这里钉死。
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

async function app(t, seed) {
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
  load('util'); load('store'); load('engine'); load('extra'); load('remind');
  w.Store.initSync(); await w.Store.init();
  w.Store._doSave = () => {};
  w.Store.commit(s => { Object.assign(s.settings, { onboarded: 1 }); if (seed) seed(s, w); });
  return w;
}

/* ================= 4.4 最小版本 ================= */
test('4.4 最小版算完成、强度减半、完整完成会清标记', async t => {
  const w = await app(t, (s, w) => {
    s.items = [{
      id: 'read', name: '读书', type: 'duration', target: 30, unit: '分钟', slot: 'any',
      color: '#15803d', schedule: { type: 'daily' }, mini: '读 1 页', createdAt: Date.now() - 86400000 * 10
    }];
    s.logs = {};
  });
  const it = w.Store.s.items[0];
  const d = w.U.today();
  w.Engine.toggleMini(it, d);
  assert.equal(w.Engine.isDone(it, d), true, '做到最小版 → 算完成');
  assert.equal(w.Engine.isMiniDone(it, d), true);
  assert.equal(w.Engine.progress(it, d), 0.5, '强度只记一半');
  assert.ok(w.Engine.streakOf(it.id, d) >= 1, '不断签');

  w.Engine.toggleMini(it, d);
  assert.equal(w.Engine.isDone(it, d), false, '再点一次取消，不留下假完成');

  w.Engine.toggleMini(it, d);
  w.Engine.setValue(it, d, 30);                    // 真做满了
  assert.equal(w.Engine.isMiniDone(it, d), false, '完整完成要清掉最小版标记');
  assert.equal(w.Engine.isDone(it, d), true);

  w.Engine.addValue(it, d, -30);                   // 又归零
  assert.equal(w.Engine.isMiniDone(it, d), false);
});

test('4.4 没设文案也能用；请假日不进轻量统计', async t => {
  const w = await app(t, (s, w) => {
    s.items = [{
      id: 'a', name: 'A', type: 'check', slot: 'any', color: '#15803d',
      schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 10
    }];
    s.logs = {};
  });
  const it = w.Store.s.items[0];
  assert.equal(w.Engine.miniOf(it), '');
  w.Engine.toggleMini(it, w.U.today());
  assert.equal(w.Engine.isDone(it, w.U.today()), true, '没有文案也能记录轻量完成');
  const ms = w.Extra.miniStats(7);
  assert.equal(ms.mini, 1);
  assert.equal(ms.full, 0);
  assert.equal(ms.miniDays, 1);
});

/* ================= 4.2 断签修复 ================= */
test('4.2 修复：48 小时内一次、每月一次、券优先否则积分', async t => {
  const w = await app(t, (s, w) => {
    s.items = [{
      id: 'run', name: '跑步', type: 'check', slot: 'any', color: '#15803d',
      schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 20
    }];
    s.logs = {};
    const d = w.U.shiftYmd(w.U.today(), -1);
    s.logs[d] = {};
    s.settings.freezeLeft = 1; s.settings.repairMonth = ''; s.settings.seedPts = 0;
  });
  const y = w.U.shiftYmd(w.U.today(), -1);
  assert.equal(w.Extra.breakInfo() && w.Extra.breakInfo().date, y);
  const st = w.Extra.repairState(y);
  assert.equal(st.ok, true); assert.equal(st.via, 'freeze');

  const r = w.Extra.repair(y);
  assert.equal(r.ok, true);
  assert.equal(w.Store.s.freezes[y], 1, '修好 = 给这天记一张保护券，连击自然接上');
  assert.equal(w.Store.s.settings.freezeLeft, 0, '券用掉一张');
  assert.equal(w.Store.s.settings.repairMonth, w.U.today().slice(0, 7), '记下本月已用');

  const again = w.Extra.repair(y);
  assert.equal(again.ok, false);
  assert.match(again.msg, /本月/);
  const rp = w.Extra.repairState(y);
  assert.equal(rp.ok, false); assert.match(rp.reason, /本月/);
});

test('4.2 超过 48 小时不给修', async t => {
  const w = await app(t, (s, w) => {
    s.items = [{
      id: 'run', name: '跑步', type: 'check', slot: 'any', color: '#15803d',
      schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 20
    }];
    s.logs = {}; s.freezes = {};
    s.settings.freezeLeft = 1; s.settings.repairMonth = '';
  });
  const old = w.U.shiftYmd(w.U.today(), -5);
  const st = w.Extra.repairState(old);
  assert.equal(st.ok, false);
  assert.match(st.reason, /48/);
  assert.equal(w.Extra.repair(old).ok, false, '不能真的写进去');
  assert.equal(w.Store.s.freezes[old], undefined);
});

test('4.2 券和积分都不够时说清差什么', async t => {
  const w = await app(t, (s, w) => {
    s.items = [{
      id: 'run', name: '跑步', type: 'check', slot: 'any', color: '#15803d',
      schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 20
    }];
    s.logs = {}; s.freezes = {};
    s.settings.freezeLeft = 0; s.settings.repairMonth = ''; s.settings.seedPts = 0;
  });
  const y = w.U.shiftYmd(w.U.today(), -1);
  const st = w.Extra.repairState(y);
  assert.equal(st.ok, false);
  assert.match(st.reason, /保护券|积分/);
});

test('4.2 48 小时窗口覆盖两天：昨天被券保住时还看前天', async t => {
  const w = await app(t, (s, w) => {
    s.items = [{
      id: 'run', name: '跑步', type: 'check', slot: 'any', color: '#15803d',
      schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 20
    }];
    s.logs = {};
    const y = w.U.shiftYmd(w.U.today(), -1), d2 = w.U.shiftYmd(w.U.today(), -2);
    s.logs[y] = {}; s.logs[d2] = {};
    s.freezes = {}; s.freezes[y] = 1;                    // 昨天已经接上了
    s.settings.breakDismiss = '';
    s.settings.freezeLeft = 1; s.settings.repairMonth = '';
  });
  const bk = w.Extra.breakInfo();
  assert.ok(bk, '昨天被券保住，前天有漏 → 断签卡仍然要出现');
  assert.equal(bk.date, w.U.shiftYmd(w.U.today(), -2));
});

test('4.2 预警只在有连续要断时发', async t => {
  const w = await app(t, (s, w) => {
    s.items = [{
      id: 'run', name: '跑步', type: 'check', slot: 'any', color: '#15803d',
      schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 20
    }];
    s.logs = {};
    for (let i = 1; i <= 8; i++) { const d = w.U.shiftYmd(w.U.today(), -i); s.logs[d] = { run: { d: true } }; }
    s.settings.nudge = { on: true, at: '21:00' };
  });
  const R = w.Remind;
  assert.equal(R.nudgePayload(20 * 60), null, '没到点不响');
  const p = R.nudgePayload(21 * 60 + 30);
  assert.ok(p, '到点 + 有连续要断 → 响');
  assert.equal(p.left, 1);
  assert.match(p.body, /连续 8 天/);
  assert.ok(R.nudgePayload(23 * 60 + 59), '深夜也提醒：今天还来得及');
  assert.equal(w.Engine.toggle(w.Store.s.items[0], w.U.today()) && R.nudgePayload(23 * 60), null, '全完成就不响');
  w.Store.commit(s => { s.settings.nudge = { on: false, at: '21:00' }; });
  w.Engine.clearLog(w.U.today(), 'run');
  assert.equal(R.nudgePayload(23 * 60), null, '关掉开关不响');
});

/* ================= 4.5 备注 ================= */
test('4.5 备注可搜、可列、可跨年筛选', async t => {
  const w = await app(t, (s, w) => {
    s.items = [
      { id: 'a', name: '读书', type: 'check', slot: 'any', color: '#15803d', schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 400 },
      { id: 'b', name: '跑步', type: 'check', slot: 'any', color: '#3c5bcc', schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 400 }
    ];
    s.logs = {};
  });
  const y = w.U.today();
  w.Engine.setNote('a', y, '读到第三章，讲小胜利如何累积');
  w.Engine.setNote('b', y, '今天配速五分半');
  w.Engine.setNote('a', w.U.shiftYmd(y, -1), '昨天读了二十页');

  const hits = w.Engine.noteSearch('读');
  assert.equal(hits.length, 2);
  assert.ok(hits.every(h => h.note.indexOf('读') > -1));
  assert.equal(hits[0].date, y, '按日期倒序');
  assert.equal(w.Engine.noteSearch('五分半').length, 1);
  assert.equal(w.Engine.noteSearch('').length, 0, '空关键词不返回全部');
  assert.equal(w.Engine.noteSearch('不存在的词').length, 0);

  const list = w.Engine.notesOf('a', 10);
  assert.equal(list.total, 2);
  assert.equal(list.list[0].date, y);
  assert.equal(w.Engine.noteOf('a', y), '读到第三章，讲小胜利如何累积');

  w.Engine.setNote('a', y, '   读   到   第   三   章  ');
  assert.equal(w.Engine.noteOf('a', y), '读 到 第 三 章', '空白归一');
  const long = 'x'.repeat(300);
  w.Engine.setNote('a', y, long);
  assert.equal(w.Engine.noteOf('a', y).length, w.Engine.NOTE_MAX, '超长截断');
});
