/* v17「旗舰版」回归测试：node tests/v17.test.js
 * 覆盖本轮新增/改动的纯算法不变量（不依赖 jsdom）：
 *  ① 版本常量
 *  ② 自然月报告：日历格结构（前导空格 / 7 的倍数 / 未来日标记）
 *  ③ 请假不进分母（与 Engine.todayRate 同口径）
 *  ④ 完成率与 bestRun 连续天数
 *  ⑤ 环比方向（与上一个自然月比较）
 *  ⑥ Top3 习惯按完成率排序
 *  ⑦ 空月份 / 未来月份不崩
 */
global.window = global;

require('../src/util.js');

const state = {
  version: 17,
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
require('../src/extra.js');

const U = window.U, E = window.Engine, X = window.Extra;
let pass = 0, fail = 0;
function ck(n, c, x) { if (c) pass++; else { fail++; console.log('FAIL: ' + n + (x !== undefined ? ' :: ' + x : '')); } }

/* ---------------- 工具 ---------------- */
const today = U.today();
const NOW = new Date();
const PYM = U.ymd(new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1)).slice(0, 7); // 上一个自然月（已过完）
const P2YM = U.ymd(new Date(NOW.getFullYear(), NOW.getMonth() - 2, 1)).slice(0, 7); // 上上个月
const NYM = U.ymd(new Date(NOW.getFullYear(), NOW.getMonth() + 1, 1)).slice(0, 7);  // 下个月（全未来）

function dim(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
function dates(ym) {
  const out = [];
  for (let i = 1; i <= dim(ym); i++) out.push(ym + '-' + String(i).padStart(2, '0'));
  return out;
}

function setup(defs) {
  state.items = defs.map((x, i) => Object.assign({
    id: 'h' + i, sort: i, name: '习惯' + i, type: 'check', target: null, unit: '',
    slot: 'any', tags: [], color: '#000', steps: [], schedule: { type: 'daily' },
    archived: false, deleted: false, createdAt: new Date(2020, 0, 1).getTime(), updatedAt: Date.now()
  }, x));
  state.logs = {};
  state.checkRewards = {};
  state.settings.seedPts = 0;
  Store.bump();
  return state.items;
}
/* 把某天某习惯标记为完成 */
function done(date, id) {
  state.logs[date] = state.logs[date] || {};
  state.logs[date][id] = { v: 1, d: true, t: Date.now(), by: '' };
}
/* 把某天某习惯标记为请假 */
function skip(date, id) {
  state.logs[date] = state.logs[date] || {};
  state.logs[date][id] = { v: null, d: false, s: 1, t: Date.now(), by: '' };
}

/* ================= 0. 版本 ================= */
ck('版本号已升到 17', U.VERSION === '17', U.VERSION);
ck('版本名为「旗舰版」', U.VERSION_NAME === '旗舰版', U.VERSION_NAME);

/* ================= 1. 日历格结构 ================= */
{
  setup([{ name: '早起' }, { name: '读书' }]);
  const r = X.monthReport(PYM);
  const nDays = dim(PYM);
  const pad = U.weekdayOf(PYM + '-01');

  ck('月报 label 格式正确', r.label === (+PYM.slice(0, 4)) + ' 年 ' + (+PYM.slice(5, 7)) + ' 月', r.label);
  ck('日历格总数为 7 的倍数', r.cells.length % 7 === 0, r.cells.length);
  ck('前导空格数 = 当月 1 号星期', r.cells.slice(0, pad).every(c => c === null), pad);
  ck('有效格数 = 当月天数', r.cells.filter(Boolean).length === nDays, r.cells.filter(Boolean).length);
  ck('已过整月无未来格', r.cells.filter(c => c && c.future).length === 0);
  ck('已过整月无「今天」格', r.cells.filter(c => c && c.today).length === 0);
  ck('日期序列连续', r.cells.filter(Boolean).map(c => c.date).join(',') === dates(PYM).join(','));
}

/* ================= 2. 未来月份 ================= */
{
  setup([{ name: '早起' }]);
  const r = X.monthReport(NYM);
  ck('未来月所有有效格均为 future', r.cells.filter(Boolean).every(c => c.future));
  ck('未来月完成率为 0', r.pct === 0 && r.total === 0, r.pct + '/' + r.total);
}

/* ================= 3. 空月份不崩 ================= */
{
  setup([]);
  const r = X.monthReport(PYM);
  ck('无习惯时 total 为 0', r.total === 0);
  ck('无习惯时 pct 为 0', r.pct === 0);
  ck('无习惯时 Top3 为空数组', Array.isArray(r.items) && r.items.length === 0);
  ck('无习惯时 best 为 null', r.best === null);
  ck('无习惯时 days 仍等于当月天数', r.days === dim(PYM), r.days);
}

/* ================= 4. 全勤 → 100% ================= */
{
  setup([{ name: '早起' }, { name: '读书' }]);
  dates(PYM).forEach(d => { done(d, 'h0'); done(d, 'h1'); });
  Store.bump();
  const r = X.monthReport(PYM);
  ck('全勤完成率为 100', r.pct === 100, r.pct);
  ck('全勤 total = 天数 × 2', r.total === dim(PYM) * 2, r.total);
  ck('全勤 bestRun = 当月天数', r.bestRun === dim(PYM), r.bestRun);
  ck('全勤 active = 当月天数', r.active === dim(PYM), r.active);
}

/* ================= 5. 请假不进分母 ================= */
{
  setup([{ name: '早起' }, { name: '读书' }]);
  const ds = dates(PYM);
  ds.forEach(d => { done(d, 'h0'); done(d, 'h1'); });
  // 取月内第 5 天，给 h0 请假：该天分母应从 2 降到 1，且完成数从 2 降到 1
  const D = ds[4];
  delete state.logs[D].h0;
  skip(D, 'h0');
  Store.bump();
  const r = X.monthReport(PYM);
  ck('请假当天不计入分母', r.total === dim(PYM) * 2 - 1, r.total);
  ck('请假当天不计入完成数', r.done === dim(PYM) * 2 - 1, r.done);
  ck('请假后完成率仍为 100', r.pct === 100, r.pct);
}

/* ================= 6. 完成率 50% ================= */
{
  setup([{ name: '早起' }, { name: '读书' }]);
  const ds = dates(PYM);
  ds.forEach((d, i) => { done(d, 'h0'); if (i % 2 === 0) done(d, 'h1'); });
  Store.bump();
  const r = X.monthReport(PYM);
  const half = Math.ceil(dim(PYM) / 2);
  ck('完成数正确（h0 全勤 + h1 半数）', r.done === dim(PYM) + half, r.done);
  ck('分母为 天数 × 2', r.total === dim(PYM) * 2, r.total);
  const expect = Math.round((dim(PYM) + half) / (dim(PYM) * 2) * 100);
  ck('完成率四舍五入正确', r.pct === expect, r.pct + ' vs ' + expect);
}

/* ================= 7. bestRun 连续天数 ================= */
{
  setup([{ name: '早起' }]);
  const ds = dates(PYM);
  // 第 3~7 天连续 5 天完成
  [2, 3, 4, 5, 6].forEach(i => done(ds[i], 'h0'));
  Store.bump();
  const r = X.monthReport(PYM);
  ck('bestRun = 最长连续完成天数', r.bestRun === 5, r.bestRun);
  ck('active = 有完成的天数', r.active === 5, r.active);
}

/* ================= 8. Top3 排序 ================= */
{
  setup([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]);
  const ds = dates(PYM);
  // A 全勤，B 一半，C 少量，D 不完成
  ds.forEach((d, i) => { done(d, 'h0'); if (i % 2 === 0) done(d, 'h1'); if (i % 4 === 0) done(d, 'h2'); });
  Store.bump();
  const r = X.monthReport(PYM);
  ck('Top3 最多 3 项', r.items.length === 3, r.items.length);
  ck('Top3 按完成率降序', r.items[0].pct >= r.items[1].pct && r.items[1].pct >= r.items[2].pct);
  ck('Top1 是 A', r.items[0].name === 'A', r.items[0].name);
  ck('best 与 Top1 一致', r.best.name === 'A', r.best.name);
  ck('worst 是完成率最低者（D 为 0%）', r.worst.name === 'D', r.worst.name);
}

/* ================= 9. 环比方向 ================= */
{
  setup([{ name: '早起' }]);
  // 上上个月全勤（100%），上个月只做一半 → 环比应为下降
  dates(P2YM).forEach(d => done(d, 'h0'));
  dates(PYM).forEach((d, i) => { if (i % 2 === 0) done(d, 'h0'); });
  Store.bump();
  const r = X.monthReport(PYM);
  ck('prevYm 指向上一个自然月', r.prevYm === P2YM, r.prevYm);
  ck('hasPrev 为真', r.hasPrev === true);
  ck('上月完成率高于本月（环比下降）', r.prevPct > r.pct, r.prevPct + ' > ' + r.pct);
  ck('上月完成率 = 100', r.prevPct === 100, r.prevPct);
}

/* ================= 10. monthSpan / monthPct 一致性 ================= */
{
  setup([{ name: '早起' }]);
  const sp = X.monthSpan ? X.monthSpan(PYM) : null;
  if (sp) {
    ck('monthSpan.start 为当月 1 号', sp.start === PYM + '-01', sp.start);
    ck('monthSpan.end 为当月最后一天', sp.end === PYM + '-' + String(dim(PYM)).padStart(2, '0'), sp.end);
  }
  const ds = dates(PYM);
  ds.forEach((d, i) => { if (i < 10) done(d, 'h0'); });
  Store.bump();
  const r = X.monthReport(PYM);
  ck('monthReport.done 与直接计数一致', r.done === 10, r.done);
  ck('完成率 = done/total', r.pct === Math.round(r.done / r.total * 100), r.pct);
}

console.log('\nWeb v17 旗舰版：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
