/* 业务引擎回归测试：node tests/engine.test.js */
global.window = global;
require('../src/util.js');

/* 用最小化的 Store 桩替代 IndexedDB */
const state = {
  version: 7,
  settings: { seedPts: 0, nickname: '我' },
  items: [], bundles: [], logs: {}, notes: {}, moods: {}, rewards: [],
  redemptions: [], sessions: [], members: [], rooms: [], media: {},
  activeRoomId: 'r1'
};
global.Store = { s: state, commit(fn) { if (fn) fn(state); } };
require('../src/engine.js');
const E = window.Engine;

let pass = 0, total = 0;
const ck = (n, c) => { total++; if (c) pass++; else console.log('  ✗ FAIL', n); };

const today = U.today();
const yd = U.shiftYmd(today, -1);
const d3 = U.shiftYmd(today, -3);

/* 1. 打卡型习惯 */
state.items.push({ id: 'a', name: '早起', type: 'check', target: null, unit: '', schedule: { type: 'daily' }, createdAt: Date.now() - 86400000 * 10, roomId: 'r1' });
const A = state.items[0];
ck('not done', E.isDone(A, today) === false);
E.toggle(A, today);
ck('done after toggle', E.isDone(A, today) === true);
ck('rate 1/1', E.todayRate(today).pct === 100);
E.toggle(A, today);
ck('undone', E.isDone(A, today) === false);
ck('rate 0', E.todayRate(today).done === 0);
E.toggle(A, today);
ck('log date', E.getLog(today, 'a').d === true);

/* 2. 连续天数 */
E.setLog(yd, 'a', { d: true, v: 1 });
ck('streak 2', E.streakOf('a', today) === 2);
E.setLog(d3, 'a', { d: true, v: 1 });
ck('streak 2 (gap at day-2)', E.streakOf('a', today) === 2);
E.setLog(U.shiftYmd(today, -2), 'a', { d: true, v: 1 });
ck('streak 4', E.streakOf('a', today) === 4);
E.clearLog(U.shiftYmd(today, -2), 'a');
ck('streak back to 2', E.streakOf('a', today) === 2);

/* 3. 计数型 */
state.items.push({ id: 'b', name: '跑步', type: 'number', target: 3, unit: '公里', schedule: { type: 'daily' }, createdAt: Date.now(), roomId: 'r1' });
const B = state.items[1];
E.addValue(B, today, 2);
ck('v=2 not done', E.isDone(B, today) === false);
E.addValue(B, today, 1);
ck('v=3 done', E.isDone(B, today) === true);
ck('progress clamp', E.progress(B, U.shiftYmd(today, -1)) === 0);
E.addValue(B, today, 5);
ck('progress clamp 1', E.progress(B, today) === 1);

/* 4. 每周 N 次 */
state.items.push({ id: 'c', name: '力量', type: 'check', schedule: { type: 'timesPerWeek', n: 3 }, createdAt: Date.now(), roomId: 'r1' });
ck('tpw due any day', E.isDue(state.items[2], today) === true);

/* 5. 工作日 */
state.items.push({ id: 'd', name: '背单词', type: 'check', schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5] }, createdAt: Date.now(), roomId: 'r1' });
const D = state.items[3];
const sat = U.shiftYmd(today, (6 - U.weekdayOf(today) + 7) % 7 || 7); // 下个周六
ck('sat not due', E.isDue(D, sat) === false);
/* 今天是不是工作日取决于「今天星期几」，所以期望值要跟着算，不能写死 */
ck('rate excludes sat habit', E.todayRate(today).total === (E.isDue(D, today) ? 4 : 3));

/* 6. 套餐 */
state.bundles.push({ id: 'bd1', name: '晨间', itemIds: ['a', 'b'] });
const bp = E.bundleProgress(state.bundles[0]);
ck('bundle 2/2 done', bp.done === 2 && bp.total === 2);
E.runBundle(state.bundles[0]); // 撤销
ck('bundle undone', E.bundleProgress(state.bundles[0]).done === 0);
E.runBundle(state.bundles[0]); // 再完成
ck('bundle redone', E.bundleProgress(state.bundles[0]).done === 2);

/* 7. 积分 */
ck('points > 0', E.points() > 0);

/* 8. 依赖锁定 */
state.items.push({ id: 'e', name: '拉伸', type: 'check', dependsOn: 'a', schedule: { type: 'daily' }, createdAt: Date.now(), roomId: 'r1' });
const Eit = state.items[4];
E.clearLog(today, 'a');
ck('locked until dep done', E.progress(Eit, today) === 0 && E.isDone(Eit, today) === false);

/* 9. 热力图 / 趋势 */
const heat = E.heatmap(30);
ck('heatmap 30', heat.length === 30 && heat[heat.length - 1].date === today);
const wk = E.weeklyTrend(4);
ck('weekly 4', wk.length === 4);

/* 10. 年度 */
const y = E.yearly(new Date().getFullYear());
ck('year', y.year === new Date().getFullYear() && typeof y.rate === 'number');

/* 11. 出生日口径：习惯创建之前的日子不能进分母
 * 否则 10 月才建的习惯，年度完成率会被 1~9 月的空账稀释成 0%。 */
ck('bornOn 取创建日', E.bornOn(A) === U.shiftYmd(today, -10));
ck('创建前不算该做', E.isDue(A, U.shiftYmd(today, -30)) === false);
ck('创建当天算该做', E.isDue(A, U.shiftYmd(today, -10)) === true);
ck('缺 createdAt 的旧数据不误伤', E.isDue({ id: 'x', schedule: { type: 'daily' } }, '2020-01-01') === true);
ck('年度统计从最早生日开始', y.from === U.shiftYmd(today, -10));
ck('年度完成率不再被稀释成 0', y.rate > 0);
state.items.push({ id: 'z', name: '新建', type: 'check', schedule: { type: 'daily' }, createdAt: Date.now(), roomId: 'r1' });
E.setLog(today, 'z', { d: true, v: 1 });
ck('今天新建且已打卡 → 完成率 100%', E.itemRate('z', 30) === 100);

console.log(pass + '/' + total + ' assertions passed');
process.exit(pass === total ? 0 : 1);
