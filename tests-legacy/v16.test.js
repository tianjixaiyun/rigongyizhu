/* v16「体验修复版」回归测试：node tests/v16.test.js
 * 覆盖本轮修复的核心不变量（纯算法层，不依赖 jsdom）：
 *  ① 积分按「完成状态变化」结算 —— 达标后加量不重复发奖、取消退回、可再次获得
 *  ② 统计缓存即时失效 —— setLog / clearLog 后 bust()，不必等 Store.commit
 *  ③ 撤销恢复部分进度 —— restoreLog 把「一键完成」前的数值还回来
 *  ④ 分步骤习惯 —— 全部步骤才算完成，越界步骤被拒且不改数据
 *  ⑤ 数值入口校验 —— Infinity / NaN 抛错且不污染日志
 *  ⑥ 计时器累加 —— 同一天多次计时叠加，而不是覆盖
 */
global.window = global;

require('../src/util.js');

const state = {
  version: 16,
  settings: { seedPts: 0, nickname: '我', autoSync: true },
  items: [], bundles: [], logs: {}, notes: {}, moods: {},
  rewards: [], redemptions: [], sessions: [], members: [], rooms: [],
  routines: [], capsules: [], todos: [], challenges: [],
  media: {}, freezes: {}, achievements: {}, checkRewards: {}, timer: null
};
let rev = 0;
global.Store = {
  s: state,
  get rev() { return rev; },
  bump() { rev++; },
  commit(fn) { if (fn) fn(state); rev++; },
  save() { }
};

require('../src/engine.js');
require('../src/timer.js');

const U = window.U, E = window.Engine, T = window.Timer;
let pass = 0, fail = 0;
function ck(n, c, x) { if (c) pass++; else { fail++; console.log('FAIL: ' + n + (x !== undefined ? ' :: ' + x : '')); } }

const DAY = U.today();

function setup(defs) {
  state.items = defs.map((x, i) => Object.assign({
    id: 'h' + i, sort: i, name: '习惯' + i, type: 'check', target: null, unit: '',
    slot: 'any', tags: [], color: '#000', steps: [], schedule: { type: 'daily' },
    archived: false, deleted: false, createdAt: Date.now(), updatedAt: Date.now()
  }, x));
  state.logs = {};
  state.checkRewards = {};
  state.settings.seedPts = 0;
  state.timer = null;
  Store.bump();
  return state.items;
}

/* ================= 0. 版本 ================= */
ck('版本号不低于 16', Number(U.VERSION) >= 16, U.VERSION);
ck('版本名非空', typeof U.VERSION_NAME === 'string' && U.VERSION_NAME.length > 0, U.VERSION_NAME);

/* ================= 1. 积分不重复结算 ================= */
{
  const [it] = setup([{ type: 'number', target: 2 }]);
  E.todayRate(DAY);                       // 先给缓存灌一次旧值
  E.addValue(it, DAY, 2);                 // 达标：10 + 全完成 30
  const earned = E.points();
  ck('达标一次得 40 分（10 完成 + 30 全完成）', earned === 40, earned);

  E.addValue(it, DAY, 1);                 // 达标后继续加号
  ck('达标后继续加号不再发奖', E.points() === earned, E.points());

  E.setValue(it, DAY, 8);                 // 达标后手动改值
  ck('达标后手动改值不再发奖', E.points() === earned, E.points());

  E.setValue(it, DAY, 0);                 // 取消完成
  ck('取消完成后奖励全额退回', E.points() === 0, E.points());

  E.addValue(it, DAY, 2);                 // 再次完成
  ck('再次完成重新获得同一笔奖励（不刷分）', E.points() === earned, E.points());
}

{
  const [it] = setup([{ type: 'number', target: 1 }]);
  E.addValue(it, DAY, 1);
  const earned = E.points();
  for (let i = 0; i < 10; i++) E.addValue(it, DAY, 1);
  E.setValue(it, DAY, 20);
  ck('连续 10 次加号 + 改值后积分不变', E.points() === earned, E.points());
}

/* ================= 2. 统计缓存即时失效 ================= */
{
  const list = setup([{}, {}]);
  ck('初始完成率 0%', E.todayRate(DAY).pct === 0, E.todayRate(DAY).pct);

  /* 关键：两次 toggle 之间不调用 Store.commit()，靠 setLog 内部的 bust() 失效 */
  E.toggle(list[0], DAY);
  E.toggle(list[1], DAY);
  ck('打卡后完成率立即变 100%（缓存已失效）', E.todayRate(DAY).pct === 100, E.todayRate(DAY).pct);
  ck('全部完成得 10+10+30=50 分', E.points() === 50, E.points());

  E.toggle(list[1], DAY);
  ck('取消一个后完成率立即回落', E.todayRate(DAY).pct === 50, E.todayRate(DAY).pct);
  ck('取消后全完成奖励退回', E.points() === 10, E.points());
}

/* ================= 3. 撤销恢复部分进度 ================= */
{
  const [it] = setup([{ type: 'number', target: 30 }]);
  E.setValue(it, DAY, 20);
  const before = JSON.parse(JSON.stringify(E.getLog(DAY, it.id)));

  E.toggle(it, DAY);                      // 一键完成：v 被顶到 30
  ck('一键完成后 v 达到目标', E.getLog(DAY, it.id).v === 30, E.getLog(DAY, it.id).v);

  E.restoreLog(it, DAY, before);          // 撤销
  ck('撤销后恢复到原来的 20', E.getLog(DAY, it.id).v === 20, E.getLog(DAY, it.id).v);
  ck('撤销后不再算完成', E.isDone(it, DAY) === false);
  ck('撤销后积分退回', E.points() === 0, E.points());

  E.restoreLog(it, DAY, null);            // 撤销到「从未打卡」
  ck('撤销到无记录时日志被清空', E.getLog(DAY, it.id) === null);
}

/* ================= 4. 分步骤习惯 ================= */
{
  const [it] = setup([{ type: 'number', target: 1, steps: ['第一步', '第二步'] }]);
  ck('初始未完成', E.isDone(it, DAY) === false);

  E.toggleStep(it, DAY, 0);
  ck('只勾一步不算完成', E.isDone(it, DAY) === false);
  ck('progress 反映 1/2', E.progress(it, DAY) === 0.5, E.progress(it, DAY));

  const bad = E.toggleStep(it, DAY, 9);
  ck('越界步骤返回 null', bad === null);
  ck('越界步骤不改动数值', E.getLog(DAY, it.id).v === 1, E.getLog(DAY, it.id).v);

  E.toggleStep(it, DAY, 1);
  ck('两步全勾才完成', E.isDone(it, DAY) === true);
  ck('分步骤习惯得 40 分', E.points() === 40, E.points());
}

/* ================= 5. 数值入口校验 ================= */
{
  const [it] = setup([{ type: 'number', target: 2 }]);
  let threw1 = false, threw2 = false;
  try { E.setValue(it, DAY, Infinity); } catch (e) { threw1 = true; }
  try { E.addValue(it, DAY, NaN); } catch (e) { threw2 = true; }
  ck('setValue(Infinity) 抛错', threw1);
  ck('addValue(NaN) 抛错', threw2);
  ck('非法数值不写进日志', E.getLog(DAY, it.id) === null, JSON.stringify(E.getLog(DAY, it.id)));

  E.setValue(it, DAY, 1.23456);
  ck('数值保留两位小数', E.getLog(DAY, it.id).v === 1.23, E.getLog(DAY, it.id).v);
}

/* ================= 6. 计时器累加 ================= */
{
  const [it] = setup([{ type: 'duration', target: 30 }]);
  E.setValue(it, DAY, 15);                                     // 已经记了 15 分钟
  state.timer = { itemId: it.id, date: DAY, accum: 10 * 60000, running: false };
  T.finish();
  ck('15 分钟 + 再计 10 分钟 = 25 分钟', E.getLog(DAY, it.id).v === 25, E.getLog(DAY, it.id).v);
  ck('计时结束后 timer 被清空', state.timer === null);

  state.timer = { itemId: it.id, date: DAY, accum: 10 * 60000, running: false };
  T.finish();
  ck('第三次计时继续累加到 35', E.getLog(DAY, it.id).v === 35, E.getLog(DAY, it.id).v);
  ck('累计超过目标后算完成', E.isDone(it, DAY) === true);
}

/* ================= 7. 套餐（戒断型 + 分步骤） ================= */
{
  const list = setup([{ type: 'avoid' }, { type: 'number', target: 1, steps: ['A', 'B'] }]);
  const bundle = { itemIds: list.map(x => x.id) };
  E.runBundle(bundle);
  ck('套餐一键完成两项', E.bundleProgress(bundle).done === 2, E.bundleProgress(bundle).done);
  ck('套餐完成得 10+10+30=50 分', E.points() === 50, E.points());
  E.runBundle(bundle);
  ck('套餐可整体取消且积分退回', E.points() === 0, E.points());
}

console.log('\nWeb v16 体验修复版：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exitCode = 1;
