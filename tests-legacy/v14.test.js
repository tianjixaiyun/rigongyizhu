/* v14「行动版」新功能测试：node tests/v14.test.js
 * 覆盖本轮新增的四个功能：
 *  ① 待办清单（Todo）—— 一次性任务，不进完成率分母、不影响连击
 *  ② 引导式挑战（Challenge）—— 加入自动建习惯、进度累计、通关发奖且不重复发
 *  ③ 习惯计时器（Timer）—— 启动/暂停/继续/完成自动打卡
 *  ④ 习惯分组依据（按第一个标签归类）
 */
global.window = global;
require('../src/util.js');

const state = {
  version: 7,
  settings: { seedPts: 0 },
  items: [], bundles: [], logs: {}, notes: {}, moods: {}, rewards: [],
  redemptions: [], sessions: [], members: [],
  rooms: [{ id: 'room1', name: '我的房间' }], activeRoomId: 'room1',
  media: {}, todos: [], challenges: [], timer: null
};
let rev = 0;
global.Store = {
  s: state,
  get rev() { return rev; },
  bump() { rev++; },
  commit(fn) { if (fn) fn(state); rev++; },
  save() { },
  palette() { return ['#111111', '#222222', '#333333']; }
};
require('../src/engine.js');
require('../src/todo.js');
require('../src/timer.js');
/* challenge.js 建习惯时会查习惯库拿模板；测试里给一个最小实现即可 */
global.Feat = {
  LIB: [{ name: '早起', type: 'check', target: null, unit: '', slot: 'morning', reminderAt: '07:00', tags: ['健康'], color: '#BA7517' }]
};
require('../src/challenge.js');

const Todo = window.Todo, Chal = window.Challenge, Timer = window.Timer, E = window.Engine;

let pass = 0, total = 0;
const ck = (n, c) => { total++; if (c) pass++; else console.log('  ✗ FAIL', n); };
const today = U.today();

/* ================= ① 待办 ================= */
const t1 = Todo.add({ title: '买跑鞋', priority: 2, due: today });
const t2 = Todo.add({ title: '整理桌面', priority: 0 });
ck('待办：新建后进入列表', Todo.all().length === 2);
ck('待办：默认未完成', Todo.all().every(t => !t.done));
ck('待办：有截止日期的排在前面', Todo.sorted(Todo.all())[0].id === t1.id);

ck('待办：勾选完成', Todo.toggle(t1.id) === true && Todo.find(t1.id).done === true);
ck('待办：再次勾选取消完成', Todo.toggle(t1.id) === false && Todo.find(t1.id).done === false);

/* 都没日期时按优先级降序 */
const x1 = Todo.add({ title: '顺手的事', priority: 0 });
const x2 = Todo.add({ title: '要紧的事', priority: 2 });
const noDue = Todo.sorted(Todo.all().filter(t => !t.done && !t.due));
ck('待办排序：都没日期时高优先级在前', noDue[0].id === x2.id);

const past = U.shiftYmd(today, -3);
const t3 = Todo.add({ title: '交材料', due: past, priority: 1 });
ck('待办：逾期判定', Todo.isOverdue(Todo.find(t3.id)) === true);
ck('待办：今天到期不算逾期', Todo.isOverdue(Todo.find(t1.id)) === false);
ck('待办：dueText 逾期文案', Todo.dueText(Todo.find(t3.id)).indexOf('逾期') === 0);
ck('待办：dueText 今天', Todo.dueText(Todo.find(t1.id)) === '今天');
ck('待办：dueText 无日期返回空', Todo.dueText(Todo.find(t2.id)) === '');

const st = Todo.stats();
ck('待办统计：逾期数正确', st.overdue === 1);
ck('待办统计：今天到期数正确', st.dueToday === 1);
ck('待办统计：未完成数正确', st.open === 5);

Todo.addSub(t1.id, '查型号');
Todo.addSub(t1.id, '比价');
Todo.addSub(t1.id, '下单');
ck('子任务：添加成功', Todo.find(t1.id).subtasks.length === 3);
const subs = Todo.find(t1.id).subtasks;
Todo.toggleSub(t1.id, subs[0].id);
ck('子任务：勾选后进度变化', Todo.subProgress(Todo.find(t1.id)).done === 1);
ck('子任务：空文本不添加', (function () { Todo.addSub(t1.id, '   '); return Todo.find(t1.id).subtasks.length === 3; })());
Todo.toggleSub(t1.id, subs[1].id);
Todo.toggleSub(t1.id, subs[2].id);
ck('子任务：全部勾完 → 整条待办自动完成', Todo.find(t1.id).done === true);
Todo.toggleSub(t1.id, subs[0].id);
ck('子任务：取消一个 → 待办回到未完成', Todo.find(t1.id).done === false);
Todo.delSub(t1.id, subs[2].id);
ck('子任务：删除成功', Todo.find(t1.id).subtasks.length === 2);

Todo.remove(t2.id);
ck('待办：软删除后不在列表里', Todo.all().every(t => t.id !== t2.id));
ck('待办：软删除保留记录（云端合并用）', state.todos.some(t => t.id === t2.id && t.deleted === true));
ck('待办不进完成率：logs 里没有任何打卡记录', Object.keys(state.logs).length === 0);

/* ================= ② 挑战 ================= */
ck('挑战：预设库非空', Chal.PRESETS.length >= 4);
const c1 = Chal.join('early21');
ck('挑战：加入成功', !!c1 && c1.key === 'early21');
ck('挑战：加入时自动建好习惯', state.items.some(it => it.id === c1.habitId && it.name === '早起'));
ck('挑战：重复加入不重复创建', Chal.join('early21').id === c1.id && Chal.list().length === 1);
ck('挑战：初始进度为 0', Chal.doneCount(c1) === 0);
ck('挑战：还差天数 = 总天数', Chal.left(c1) === 21);
ck('挑战：未知 key 返回 null', Chal.join('nope') === null);

const habit = state.items.find(it => it.id === c1.habitId);
E.setLog(today, habit.id, { d: true, v: 1, t: Date.now() });
rev++;
Chal.syncAll();
ck('挑战：打卡后进度累加', Chal.doneCount(c1) === 1);
ck('挑战：进度百分比', Chal.pct(c1) === Math.round(1 / 21 * 100));
ck('挑战：sync 幂等（再跑一次不重复计数）', (Chal.syncAll(), Chal.doneCount(c1) === 1));

/* 把开始日推前、补满 21 天 → 应自动通关并发奖 */
const pts0 = state.settings.seedPts || 0;
c1.startedAt = U.shiftYmd(today, -20);
for (let i = 1; i < 21; i++) E.setLog(U.shiftYmd(today, -i), habit.id, { d: true, v: 1, t: Date.now() });
rev++;
const cleared = Chal.syncAll();
ck('挑战：攒够天数自动通关', !!c1.doneAt);
ck('挑战：通关返回 cleared 列表', cleared.length >= 1);
ck('挑战：通关发积分奖励', (state.settings.seedPts || 0) >= pts0 + 120);
ck('挑战：重复 sync 不重复发奖', Chal.syncAll().length === 0 && (state.settings.seedPts || 0) === pts0 + 120);

const c2 = Chal.join('zen7');
Chal.leave(c2.id);
ck('挑战：退出后不在列表里', Chal.list().every(c => c.id !== c2.id));
ck('挑战：退出不影响已建的习惯', state.items.some(it => it.id === c2.habitId));

/* ================= ③ 计时器 ================= */
state.items.push({ id: 'dur1', name: '冥想', type: 'duration', target: 10, unit: '分钟', tags: ['健康'], schedule: { type: 'daily' }, createdAt: Date.now() });
rev++;
Timer.start('dur1');
ck('计时器：启动后有活跃计时', !!Timer.active() && Timer.active().itemId === 'dur1');
ck('计时器：启动即运行', Timer.active().running === true);
ck('计时器：isFor 命中', Timer.isFor('dur1') === true);
ck('计时器：对别的习惯不误报', Timer.isFor('dur_other') === false);

Timer.pause();
ck('计时器：暂停后不再运行', Timer.active().running === false);
Timer.resume();
ck('计时器：继续后恢复运行', Timer.active().running === true);
Timer.toggle();
ck('计时器：toggle 切到暂停', Timer.active().running === false);

/* 模拟已经计了 12 分钟 → 完成 */
state.timer.accum = 12 * 60000;
state.timer.running = false;
rev++;
ck('计时器：未完成前不计入习惯', E.getLog(today, 'dur1') == null || E.getLog(today, 'dur1').v !== 12);
const r = Timer.finish();
ck('计时器：完成后清空活跃计时', Timer.active() === null);
ck('计时器：完成后把分钟数记进习惯', r && r.minutes === 12);
const lg = E.getLog(today, 'dur1');
ck('计时器：习惯值已写入', lg && lg.v === 12);
ck('计时器：12 分钟 ≥ 目标 10 分钟 → 视为完成', E.isDone({ id: 'dur1', type: 'duration', target: 10, schedule: { type: 'daily' } }, today) === true);

ck('计时器 fmt：0 → 00:00', Timer.fmt(0) === '00:00');
ck('计时器 fmt：65 秒 → 01:05', Timer.fmt(65000) === '01:05');
ck('计时器 fmt：1 小时 → 1:00:00', Timer.fmt(3600000) === '1:00:00');
ck('计时器 fmt：负数兜底为 00:00', Timer.fmt(-5) === '00:00');

Timer.start('dur1');
Timer.cancel();
ck('计时器：放弃后清空', Timer.active() === null);
ck('计时器：放弃不写习惯值（仍为 12）', E.getLog(today, 'dur1').v === 12);

/* ================= ④ 分组依据 ================= */
function groupOf(it) { return (it.tags && it.tags[0]) || '其他'; }
ck('分组：有标签时按第一个标签归类', groupOf({ tags: ['健康'] }) === '健康');
ck('分组：无标签归入「其他」', groupOf({ tags: [] }) === '其他');
ck('分组：tags 缺失也安全', groupOf({}) === '其他');

/* ================= ⑤ 版本号 ================= */
ck('版本号已升到 17', U.VERSION === '17');

console.log('\nv14 行动版：' + pass + '/' + total + ' 通过');
if (pass !== total) process.exit(1);
