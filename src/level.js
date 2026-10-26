/* ============ Level：等级 / 经验 / 称号 ============
 * 借鉴 Habitica（GitHub ~13.9K star）最核心的一条：给坚持一个"身份感"。
 * 但只取其轻量部分 —— 不做装备、不做组队打怪、不做公会，那套会毁掉本产品的克制定位。
 *
 * 与现有「积分」严格分开：
 *   积分 = 可花掉的通货（兑换奖励后会减少）
 *   经验 = 只涨不跌的身份（写日记也算，兑换不影响）
 *
 * 经验规则：完成一个习惯 +1，当天写了日记 +2。 intentionally 简单，用户能自己算明白。
 */
var _lvroot = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
_lvroot.Level = (function () {

  /* 称号：越低门槛越密，早期升级反馈快，后期靠大档制造仪式感 */
  var TITLES = [
    [30, '日拱一卒'], [25, '宗师'], [20, '大成'], [16, '蜕变'], [13, '精进'],
    [10, '恒心'], [7, '坚韧'], [5, '笃行'], [3, '践行'], [1, '初心']
  ];

  /* 升到下一级需要的经验。第 1 级最便宜（15），之后每级 +10，
   * 累计门槛：Lv2=15 Lv3=40 Lv4=75 Lv5=120 Lv6=175 Lv10=495
   * 每天 4 个习惯（4 XP）：约 10 天到 Lv3，30 天到 Lv5，4 个月到 Lv10。 */
  function needFor(lv) { return 15 + (lv - 1) * 10; }

  /* 累计到 lv 级总共需要的经验 */
  function xpToReach(lv) {
    if (lv <= 1) return 0;
    var n = lv - 1;
    return n * 15 + 5 * n * (n - 1);
  }

  function titleOf(lv) {
    for (var i = 0; i < TITLES.length; i++) if (lv >= TITLES[i][0]) return TITLES[i][1];
    return '初心';
  }

  /* ---------- 经验值 ---------- */
  var _cache = { rev: -1, xp: 0 };
  function xp() {
    var st = (typeof Store !== 'undefined' && Store.s) ? Store.s : null;
    if (!st) return 0;
    var rev = Store.rev || 0;
    if (_cache.rev === rev) return _cache.xp;
    var base = (typeof Engine !== 'undefined' && Engine.totalCheckins) ? Engine.totalCheckins() : 0;
    var wrote = 0;
    var notes = st.notes || {};
    for (var d in notes) {
      if (!Object.prototype.hasOwnProperty.call(notes, d)) continue;
      var t = notes[d] ? (notes[d].text || '') : '';
      if (String(t).trim()) wrote++;
    }
    var v = base + wrote * 2;
    _cache.rev = rev; _cache.xp = v;
    return v;
  }

  /* ---------- 当前等级状态 ---------- */
  function state() {
    var total = xp();
    var lv = 1;
    while (xpToReach(lv + 1) <= total && lv < 99) lv++;
    var curTotal = xpToReach(lv);        // 本级起点经验
    var need = needFor(lv);              // 升下级还需多少
    var got = total - curTotal;          // 本级已攒多少
    var pct = need > 0 ? Math.min(100, Math.round(got / need * 100)) : 100;
    return {
      lv: lv, title: titleOf(lv), xp: total,
      got: got, need: need,
      left: Math.max(0, need - got),
      pct: pct,
      next: titleOf(lv + 1),
      nextLv: lv + 1
    };
  }

  /* 到下一级还差多少次「今日打卡」（按今天习惯总数估算，给个体感） */
  function leftChecks() {
    var s = state();
    if (s.left <= 0) return 0;
    var perDay = 1;
    if (typeof Engine !== 'undefined' && Engine.todayRate) {
      perDay = Math.max(1, Engine.todayRate(typeof U !== 'undefined' ? U.today() : '').total || 1);
    }
    return { left: s.left, days: Math.ceil(s.left / perDay), perDay: perDay };
  }

  /* ---------- 升级检测 ---------- */
  /* 返回本次跨越的等级信息；没升级返回 null。
   * lastLv 由调用方持久化（存 settings.lastLevel），避免换设备同步后重复撒花。 */
  function checkUp() {
    var s = state();
    var st = Store.s;
    var prev = st.settings && st.settings.lastLevel;
    if (typeof prev !== 'number') {
      // 第一次见到：只记录，不放礼花（否则老用户一升级冒出一堆庆祝）
      Store.commit(function (x) { x.settings.lastLevel = s.lv; });
      return null;
    }
    if (s.lv <= prev) return null;
    Store.commit(function (x) { x.settings.lastLevel = s.lv; });
    return { from: prev, to: s.lv, title: s.title, lv: s.lv };
  }

  return {
    xp: xp, state: state, needFor: needFor, xpToReach: xpToReach,
    titleOf: titleOf, leftChecks: leftChecks, checkUp: checkUp, TITLES: TITLES
  };
})();