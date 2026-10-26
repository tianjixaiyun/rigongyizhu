/* Level 等级/经验 单元测试
 * 跑法：node tests/level.test.js
 */
'use strict';
globalThis.window = globalThis;

function mkStore(state) {
  let rev = 0;
  const s = Object.assign({
    items: [], logs: {}, notes: {}, settings: {}, redemptions: [], streaks: {}, freeDayUsed: {}
  }, state || {});
  return {
    get s() { return s; },
    get rev() { return rev; },
    commit(fn) { if (fn) fn(s); rev++; }
  };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

/* ---------- 搭一个最小环境 ---------- */
const Day = 86400000;
function ymd(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const NOW = Date.now();
function ago(n) { return ymd(NOW - n * Day); }

globalThis.U = { today: () => ymd(NOW), };

let totalCheckins = 0;
let perDay = 4;
globalThis.Engine = {
  totalCheckins: () => totalCheckins,
  todayRate: () => ({ done: 0, total: perDay, pct: 0 })
};

globalThis.Store = mkStore();

require('../src/level.js');
const L = globalThis.Level;

console.log('\n【等级与经验】');

/* ---- 1. 经验规则：打卡 +1，写日记 +2 ---- */
totalCheckins = 0;
Store.s.notes = {};
Store.commit();
ok('零数据时经验为 0', L.xp() === 0, L.xp());

totalCheckins = 10;
Store.commit();
ok('打卡 10 次 = 10 XP', L.xp() === 10, L.xp());

Store.s.notes = { '2026-01-01': { text: '写了' }, '2026-01-02': { text: '   ' }, '2026-01-03': { text: '又写了' } };
Store.commit();
ok('写日记每天 +2（空文本不算）', L.xp() === 14, L.xp());

/* ---- 2. 经验缓存跟着 Store.rev 失效 ---- */
const before = L.xp();
totalCheckins = 20;                 // 直接改数据但不 commit
ok('未 commit 时走缓存（不会再重算）', L.xp() === before, L.xp());
Store.commit();
ok('commit 后 rev 变了，重新算', L.xp() === 24, L.xp());

/* ---- 3. 等级门槛曲线 ---- */
ok('Lv1 起点为 0', L.xpToReach(1) === 0, L.xpToReach(1));
ok('Lv2 门槛 15', L.xpToReach(2) === 15, L.xpToReach(2));
ok('Lv3 门槛 40', L.xpToReach(3) === 40, L.xpToReach(3));
ok('Lv5 门槛 120', L.xpToReach(5) === 120, L.xpToReach(5));
ok('Lv10 门槛 495', L.xpToReach(10) === 495, L.xpToReach(10));
ok('门槛单调递增', L.xpToReach(2) < L.xpToReach(3) && L.xpToReach(9) < L.xpToReach(10));

/* ---- 4. 等级换算边界 ---- */
totalCheckins = 0; Store.s.notes = {}; Store.commit();
ok('0 XP → Lv1', L.state().lv === 1, L.state().lv);

totalCheckins = 14; Store.commit();
ok('14 XP → 仍是 Lv1', L.state().lv === 1, L.state().lv);

totalCheckins = 15; Store.commit();
ok('15 XP → 升到 Lv2（卡在边界上）', L.state().lv === 2, L.state().lv);

totalCheckins = 39; Store.commit();
ok('39 XP → Lv2', L.state().lv === 2, L.state().lv);
totalCheckins = 40; Store.commit();
ok('40 XP → Lv3', L.state().lv === 3, L.state().lv);

/* ---- 5. 本级进度百分比 ---- */
totalCheckins = 15; Store.commit();     // Lv2 起点 15，本级 need = 25
let s = L.state();
ok('本级起点 got=0', s.got === 0, s.got);
ok('本级需 25（needFor(2)）', s.need === 25, s.need);
ok('本级百分比 0%', s.pct === 0, s.pct);

totalCheckins = 15 + 12; Store.commit();
s = L.state();
ok('本级攒了 12 → left 13', s.left === 13, s.left);
ok('本级百分比 48%', s.pct === 48, s.pct);

totalCheckins = 40; Store.commit();     // 正好升 Lv3
ok('满级边界 pct 归 0', L.state().pct === 0, L.state().pct);

/* ---- 6. 称号阶梯 ---- */
ok('Lv1 → 初心', L.titleOf(1) === '初心', L.titleOf(1));
ok('Lv3 → 践行', L.titleOf(3) === '践行', L.titleOf(3));
ok('Lv5 → 笃行', L.titleOf(5) === '笃行', L.titleOf(5));
ok('Lv7 → 坚韧', L.titleOf(7) === '坚韧', L.titleOf(7));
ok('Lv10 → 恒心', L.titleOf(10) === '恒心', L.titleOf(10));
ok('Lv13 → 精进', L.titleOf(13) === '精进', L.titleOf(13));
ok('Lv16 → 蜕变', L.titleOf(16) === '蜕变', L.titleOf(16));
ok('Lv20 → 大成', L.titleOf(20) === '大成', L.titleOf(20));
ok('Lv25 → 宗师', L.titleOf(25) === '宗师', L.titleOf(25));
ok('Lv30 → 日拱一卒', L.titleOf(30) === '日拱一卒', L.titleOf(30));
ok('档位之间向下取最近档（Lv4 仍是践行）', L.titleOf(4) === '践行', L.titleOf(4));

/* ---- 7. 距离下一级的人话估算 ---- */
perDay = 4;
totalCheckins = 20; Store.commit();     // Lv2，left = 20 → 5 天
let lc = L.leftChecks();
ok('剩 20 XP / 每天 4 → 5 天', lc.left === 20 && lc.days === 5, JSON.stringify(lc));

perDay = 1;
totalCheckins = 20; Store.commit();
lc = L.leftChecks();
ok('每天只 1 个习惯时不会除零', lc.days === 20, JSON.stringify(lc));

perDay = 4;
totalCheckins = 600; Store.commit();
ok('高级别也能算（不崩）', typeof L.state().lv === 'number' && L.state().lv > 9, L.state().lv);

/* ---- 8. 升级检测 ---- */
delete Store.s.settings.lastLevel;
totalCheckins = 0; Store.commit();
const first = L.checkUp();
ok('首次调用只记录、不报升级', first === null, JSON.stringify(first));
ok('已写入 lastLevel 基线', Store.s.settings.lastLevel === 1, Store.s.settings.lastLevel);

let up = L.checkUp();
ok('等级没变时不报错也不升级', up === null, JSON.stringify(up));

totalCheckins = 15; Store.commit();
up = L.checkUp();
ok('升到 Lv2 会被检出', up && up.from === 1 && up.to === 2, JSON.stringify(up));

up = L.checkUp();
ok('同一级再调用不再重复庆祝', up === null, JSON.stringify(up));

totalCheckins = 40; Store.commit();
up = L.checkUp();
ok('升到 Lv3 会被检出', up && up.to === 3, JSON.stringify(up));

/* 换设备同步后 XP 跳很多级：只报一次从 lastLevel 到当前 */
delete Store.s.settings.lastLevel;
totalCheckins = 40; Store.commit();
L.checkUp();                              // 建立基线 Lv3
totalCheckins = 300; Store.commit();      // 一口气同步到 Lv8
up = L.checkUp();
ok('跨多级也只报一次', up && up.from === 3 && up.to === L.state().lv, JSON.stringify(up));

/* ---- 9. 兑换不影响经验（和积分的本质区别）---- */
totalCheckins = 40;
Store.s.redemptions = [{ cost: 100 }];
Store.commit();
ok('兑换后经验不变（区别于会减少的积分）', L.xp() === 40, L.xp());

console.log('\n等级模块：' + pass + '/' + (pass + fail) + ' 通过');
if (fail) { console.log('失败 ' + fail + ' 项'); process.exit(1); }