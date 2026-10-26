/* v12「坚持的燃料」回归测试：node tests/fuel.test.js
 * 覆盖：周频次连击 / 单习惯热力图 / 补卡期限 / 年度格子图 / 本周圆点 /
 *       里程碑 / 徽章进度 / 周报数据 / 小屋家具 */
global.window = global;
require('../src/util.js');

const DAY = 86400000;
const state = {
  version: 7,
  settings: { seedPts: 0, nickname: '我' },
  items: [], bundles: [], logs: {}, notes: {}, moods: {}, rewards: [],
  redemptions: [], sessions: [], members: [], rooms: [], media: {},
  freezes: {}, achievements: {}
};
let rev = 0;
global.Store = {
  s: state,
  get rev() { return rev; },
  commit(fn) { if (fn) fn(state); rev++; },
  save() { }
};
require('../src/engine.js');
require('../src/extra.js');
require('../src/decor.js');
const E = window.Engine, X = window.Extra, D = window.Decor;

let pass = 0, total = 0;
const ck = (n, c) => { total++; if (c) pass++; else console.log('  ✗ FAIL', n); };

const today = U.today();
const born = U.shiftYmd(today, -40);
const bornTs = U.parseYmd(born).getTime();

function addItem(o) {
  const it = Object.assign({ createdAt: bornTs, schedule: { type: 'daily' }, type: 'check' }, o);
  state.items.push(it);
  return it;
}
function mark(it, offset, v) {
  const d = U.shiftYmd(today, offset);
  E.setLog(d, it.id, { d: true, v: v == null ? 1 : v, t: Date.now() });
  rev++;
  return d;
}

/* ---------- 1. 周频次连击 ---------- */
const W = addItem({ id: 'w', name: '力量训练', schedule: { type: 'timesPerWeek', n: 2 } });
ck('周频次：单位是周', E.streakUnit(W) === '周');
ck('周频次：isWeekly', E.isWeekly(W) === true);

/* 本周（今天往前 6 天）做满 2 次 → 当前连击至少 1 */
mark(W, 0); mark(W, -2);
ck('本周 2/2', E.weekProgress(W, today).done === 2 && E.weekProgress(W, today).ok === true);
ck('周连击 >= 1', E.streakOf('w', today) >= 1);

/* 上一个 7 天窗口也做满 2 次 → 连击 2 */
mark(W, -7); mark(W, -9);
const sAfter2 = E.streakOf('w', today);
ck('两个窗口达标 → 连击 2', sAfter2 === 2);

/* 再往前一个窗口只做 1 次 → 断在 2 */
mark(W, -15);
ck('第三窗口只有 1 次 → 仍为 2', E.streakOf('w', today) === 2);
ck('最佳周连击 >= 2', E.bestStreak('w') >= 2);

/* 本周还没做满时不算断：清掉本周记录，连击应回落到 1（上一个窗口） */
E.clearLog(today, 'w'); E.clearLog(U.shiftYmd(today, -2), 'w');
rev++;
ck('本周未达标不算断 → 落在上一个窗口', E.streakOf('w', today) === 1);
ck('weekProgress 显示还差', E.weekProgress(W, today).done === 0 && E.weekProgress(W, today).left === 2);

/* 日频次仍是「天」 */
const H = addItem({ id: 'h', name: '喝水' });
mark(H, 0); mark(H, -1); mark(H, -2);
ck('日频次单位是天', E.streakUnit(H) === '天');
ck('日频次连击 3', E.streakOf('h', today) === 3);
ck('日频次最佳 3', E.bestStreak('h') === 3);

/* ---------- 2. 单习惯热力图 ---------- */
const N = addItem({ id: 'n', name: '读书', type: 'number', target: 20, unit: '页' });
mark(N, 0, 20);        // 满
mark(N, -1, 10);       // 半
mark(N, -2, 2);        // 一点
const heat = E.itemHeat('n', 10);
ck('热力图长度', heat.length === 10);
const byDate = {};
heat.forEach(h => { byDate[h.date] = h; });
ck('满格 lv4', byDate[today].lv === 4);
ck('半格 lv2/3', byDate[U.shiftYmd(today, -1)].lv >= 2 && byDate[U.shiftYmd(today, -1)].lv <= 3);
ck('少量 lv2', byDate[U.shiftYmd(today, -2)].lv === 2);
ck('没做 lv0', byDate[U.shiftYmd(today, -3)].lv === 0);
ck('热力图带进度值', byDate[U.shiftYmd(today, -1)].p === 0.5);
/* 出生日之前应标记为 -1（还没这个习惯） */
const before = heat.find(h => h.date < born);
ck('出生前标记为未创建', !before || before.lv === -1);

/* ---------- 3. 补卡期限 ---------- */
ck('默认补卡期限 3 天', E.backfillDays() === 3);
ck('今天可补', E.canBackfill(today) === true);
ck('昨天可补', E.canBackfill(U.shiftYmd(today, -1)) === true);
ck('3 天前可补', E.canBackfill(U.shiftYmd(today, -3)) === true);
ck('4 天前不可补', E.canBackfill(U.shiftYmd(today, -4)) === false);
ck('未来不可补', E.canBackfill(U.shiftYmd(today, 1)) === false);
state.settings.backfillDays = 7;
ck('设为 7 天后 6 天前可补', E.canBackfill(U.shiftYmd(today, -6)) === true);
state.settings.backfillDays = 3;

/* ---------- 4. 年度格子图 ---------- */
const g = X.yearGrid('h', 365);
ck('格子图存在', !!g);
ck('格子图按 7 行对齐', g.cells.length % 7 === 0);
ck('格子图列数合理', g.weeks >= 52 && g.weeks <= 54);
ck('月份标签存在', g.months.length >= 12);
ck('月份标签列递增', g.months.every((m, i) => i === 0 || m.col > g.months[i - 1].col));
ck('统计了完成数', g.done >= 3 && g.due > 0);
ck('pct 在 0-100', g.pct >= 0 && g.pct <= 100);
/* 前面的空格是补位（null） */
ck('首列前有补位格', g.cells[0] === null || typeof g.cells[0] === 'object');

/* ---------- 5. 本周 7 圆点 ---------- */
const dots = X.weekDots('h');
ck('圆点 7 个', dots.length === 7);
ck('圆点从周一开始', U.weekdayOf(dots[0].date) === 1);
ck('圆点含今天', dots.some(d => d.today === true));
ck('已打卡那天是 done', dots.find(d => d.date === today).state === 'done');
ck('未来那天是 future', dots.filter(d => d.state === 'future').length >= 0);
const stNames = ['done', 'miss', 'skip', 'rest', 'future', 'none'];
ck('圆点状态合法', dots.every(d => stNames.indexOf(d.state) >= 0));

/* ---------- 6. 里程碑 ---------- */
const ms = X.milestoneOf(H);
ck('里程碑有 best', typeof ms.best === 'number');
ck('里程碑单位是天', ms.unit === '天');
ck('里程碑 next 是 7', ms.next && ms.next.n === 7);
ck('里程碑还差天数', ms.need === 7 - ms.best);
ck('里程碑进度 0-100', ms.pct >= 0 && ms.pct <= 100);
const all = X.milestones();
/* v42 · 走查第 6 条：里程碑从 5 档扩到 8 档（3/7/14/21/30/50/100/365），
 * 庆祝哪几档、墙上就画哪几档，和 main.js 的 CELEBRATE_DAYS 是同一串数字。 */
ck('全局里程碑 8 档', all.length === 8);
ck('里程碑含 365', all[all.length - 1].n === 365);
ck('里程碑按 3/7/14/21/30/50/100/365', all.map(x => x.n).join(',') === '3,7,14,21,30,50,100,365');

/* ---------- 7. 徽章进度 ---------- */
const m = X.metrics();
X.checkAchievements();
const bs = X.badges();
ck('徽章含 365 档', bs.some(b => b.id === 's365'));
const p7 = X.badgeProgress(m, bs.find(b => b.id === 's7'));
ck('徽章进度有 cur/need', p7 && typeof p7.cur === 'number' && p7.need === 7);
ck('徽章进度百分比合法', p7.pct >= 0 && p7.pct <= 100);
ck('首次打卡徽章已解锁', bs.find(b => b.id === 'first').got === true);

/* ---------- 8. 周报数据 ---------- */
const wc = X.weekCard();
ck('周报有完成率', typeof wc.pct === 'number');
ck('周报有次数', typeof wc.done === 'number' && typeof wc.total === 'number');
ck('周报有连击变化', wc.streak && typeof wc.streak.delta === 'number');
ck('周报有日期区间', typeof wc.range === 'string' && wc.range.length > 0);
ck('周报排行非空', Array.isArray(wc.top3));
ck('周报最低项存在', wc.worst === null || typeof wc.worst.pct === 'number');
const sd = X.streakDelta();
ck('连击变化：now == 当前连击', sd.now === E.globalStreak());

/* ---------- 9. 我的小屋 ---------- */
state.settings.seedPts = 500;
rev++;
ck('初始房间为空', D.roomItems().length === 0);
ck('初始等级毛坯房', D.level().cur.name === '毛坯房');
const buy = D.buy('pothos');
ck('买下绿萝成功', buy.ok === true);
ck('绿萝已拥有', D.owned('pothos') === 1);
ck('绿萝已摆进房间', D.roomItems().length === 1);
ck('积分被扣', E.points() === 500 - 60);
const poor = D.buy('piano');    // 500 分，不够
ck('积分不够买不了', poor.ok === false);
ck('失败提示含差额', /积分不够/.test(poor.msg || ''));
const sell = D.sell('pothos');
ck('退回成功', sell.ok === true);
ck('退回一半积分', sell.back === 30);
ck('退回到账', E.points() === 500 - 60 + 30);
ck('房间又空了', D.roomItems().length === 0);
/* 买满 8 件后多余的进仓库 */
state.settings.seedPts = 5000;
rev++;
for (let i = 0; i < 9; i++) D.buy('cactus');
ck('房间最多 8 件', D.roomItems().length === D.SLOTS);
ck('多出来的进仓库', D.storage().length >= 1);
const placeR = D.place('cactus');
ck('摆满后再摆会提示', placeR.ok === false);
D.unplace('cactus');
ck('收起一件后可以再摆', D.place('cactus').ok === true);
ck('投入积分被统计', D.invested() > 0);
ck('等级随投入提升', D.level().cur.name !== '毛坯房');

/* ---------- 10. 向后兼容 ---------- */
const legacy = { items: [{ id: 'z', name: '老习惯' }], logs: {} };
ck('老数据没有 schedule 也能用', (function () {
  try {
    const it = legacy.items[0];
    return E.isDue(it, today) === true && E.streakUnit(it) === '天';
  } catch (e) { return false; }
})());
ck('没有 decor 字段不报错', (function () {
  try { delete state.decor; return D.roomItems().length >= 0; } catch (e) { return false; }
})());

console.log('坚持的燃料：' + pass + '/' + total + ' 通过');
if (pass !== total) process.exit(1);
