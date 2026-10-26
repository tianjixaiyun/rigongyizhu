/* v13「交付级完善」回归测试：node tests/delivery.test.js
 * 覆盖本轮修掉的口径不一致与提示矛盾：
 *  ① 完成率口径统一（请假不算该做）—— 今日卡片与习惯列表必须是同一个数
 *  ② 中断检测精确到"哪个习惯的连续断了"，且被保护券覆盖时不再提示
 *  ③ 漏卡统计不把"请假"算成漏
 *  ④ 数值展示不过度精确（numShort）
 *  ⑤ 版本号可读
 */
global.window = global;
require('../src/util.js');

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
  bump() { rev++; },
  commit(fn) { if (fn) fn(state); rev++; },
  save() { }
};
require('../src/engine.js');
require('../src/extra.js');
const E = window.Engine, X = window.Extra;

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
function mark(it, offset, patch) {
  const d = U.shiftYmd(today, offset);
  E.setLog(d, it.id, Object.assign({ d: true, v: 1, t: Date.now() }, patch || {}));
  rev++;
  return d;
}
function skip(it, offset) { return mark(it, offset, { d: false, v: 0, s: 1 }); }

/* ---------- ① 完成率口径：请假不算该做 ----------
 * A 只在最近 12 天存在（出生日 = 11 天前），窗口内：
 *   完成 6 天（今天 + 前 5 天）、请假 4 天、没做 2 天。
 * 该做 = 12 - 4 = 8 天，完成 6 天 → 75%（请假那 4 天不进分母）。 */
const A = addItem({ id: 'A', name: '读书', createdAt: U.parseYmd(U.shiftYmd(today, -11)).getTime() });
mark(A, 0);
for (let i = 1; i <= 5; i++) mark(A, -i);
for (let i = 6; i <= 9; i++) skip(A, -i);
/* -10、-11 既不完成也不请假 → 该做但没做 */
ck('itemRate：请假不进分母（8 天该做 / 6 天完成 = 75%）', E.itemRate('A', 30) === 75);
ck('itemRate 与 Extra.rateOf 完全一致（同一口径）', E.itemRate('A', 30) === X.rateOf(A, 30).pct);
ck('todayRate：请假日不算待办（此刻只有 A，且 A 那天请假 → 分母为 0）',
  E.todayRate(U.shiftYmd(today, -6)).total === 0);

/* ---------- ② 中断检测：精确到习惯 ----------
 * B：昨天之前连续完成 20 天，昨天漏了 → 真的断了。
 * C：从来没打过 → 不算"断了一条连续"，不该被点名。
 * D：昨天请了假 → 不算漏。 */
const B = addItem({ id: 'B', name: '早起' });
for (let i = 2; i <= 21; i++) mark(B, -i);
const C = addItem({ id: 'C', name: '冥想' });
const D = addItem({ id: 'D', name: '喝水' });
skip(D, -1);

state.settings.breakDismiss = null;
state.freezes = {};
rev++;
const y = U.shiftYmd(today, -1);
let bk = X.breakInfo();
ck('breakInfo：昨天有漏卡时给出结果', !!bk);
ck('breakInfo：只统计真正没做的那几个（B、C）', bk && bk.count === 2);
ck('breakInfo：请假的习惯不算漏（D 不在名单里）', bk && bk.names.indexOf('喝水') < 0);
ck('breakInfo：broke 只包含"真的断了连续"的习惯', bk && bk.broke.length === 1 && bk.broke[0].name === '早起');
ck('breakInfo：broke 带上被打断的连续天数', bk && bk.broke[0].prev === 20);
ck('breakInfo：从未打过卡的习惯不点名', bk && !bk.broke.some(x => x.name === '冥想'));

/* 保护券覆盖昨天 → 不再提示中断 */
state.freezes[y] = 1; rev++;
ck('breakInfo：被保护券接上后不再提示', X.breakInfo() === null);
delete state.freezes[y]; rev++;

/* 用户点过「知道了」→ 当天不再提示 */
state.settings.breakDismiss = y; rev++;
ck('breakInfo：用户已忽略则不再提示', X.breakInfo() === null);
state.settings.breakDismiss = null; rev++;

/* ---------- ③ 漏卡统计不把请假算成漏 ---------- */
const missNames = X.missedOn(y).map(x => x.name);
ck('missedOn：请假的习惯不算漏（喝水）', missNames.indexOf('喝水') < 0);
ck('missedOn：真没做的习惯仍然算漏（早起）', missNames.indexOf('早起') >= 0);
ck('missedOn：已完成的习惯不算漏（读书）', missNames.indexOf('读书') < 0);

/* ---------- ④ 数值展示 ---------- */
ck('numShort：41.39 → 41.4', U.numShort(41.39) === 41.4);
ck('numShort：1234.56 → 1235', U.numShort(1234.56) === 1235);
ck('numShort：1.98 保留两位', U.numShort(1.98) === 1.98);
ck('numShort：整数原样', U.numShort(30) === 30);
ck('numShort：null → 空串', U.numShort(null) === '');
ck('numShort：0 保留', U.numShort(0) === 0);

/* ---------- ⑤ 版本号 ---------- */
ck('版本号已定义且可读', typeof U.VERSION === 'string' && U.VERSION.length > 0);
ck('构建日期已定义', typeof U.BUILD_DATE === 'string');

console.log('\n交付级完善：' + pass + '/' + total + ' 通过');
if (pass !== total) process.exit(1);
