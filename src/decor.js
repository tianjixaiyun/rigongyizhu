/* ============ 我的小屋：用打卡积分把「房间」经营起来 ============
 * 打卡给的是积分，积分原本只能换现实奖励 —— 反馈太慢，几十天才兑换一次。
 * 这里把积分接到一个能天天看见的地方：每完成一次打卡就离下一件家具近一点，
 * 房间会一点点变满。数据全部挂在 st.decor（新字段），老数据没有就当空房间，
 * 不影响任何已有记录。
 *
 * 积分账本沿用既有的 st.redemptions（points() 已经按它扣减），只是打上 kind:'decor'
 * 以便和「兑换现实奖励」区分开。
 */
window.Decor = (function () {
  var S = function () { return Store.s; };

  var CATALOG = [
    { id: 'pothos', emoji: '🪴', name: '绿萝', cost: 60, cat: '植物', desc: '最好养的第一种植物' },
    { id: 'cactus', emoji: '🌵', name: '仙人掌', cost: 80, cat: '植物', desc: '忙起来忘了浇水也死不了' },
    { id: 'lamp', emoji: '💡', name: '落地灯', cost: 90, cat: '家具', desc: '晚上打卡时的一角暖光' },
    { id: 'poster', emoji: '🖼', name: '挂画', cost: 70, cat: '装饰', desc: '写一句你想成为的样子' },
    { id: 'window', emoji: '🪟', name: '大窗户', cost: 130, cat: '装饰', desc: '让屋子亮一点' },
    { id: 'coffee', emoji: '☕', name: '咖啡机', cost: 140, cat: '家具', desc: '早起习惯的最佳搭档' },
    { id: 'monstera', emoji: '🌿', name: '龟背竹', cost: 150, cat: '植物', desc: '叶子开背，说明养得不错' },
    { id: 'speaker', emoji: '🎧', name: '音响', cost: 160, cat: '家具', desc: '给专注时段配个背景' },
    { id: 'shelf', emoji: '📚', name: '书架', cost: 180, cat: '家具', desc: '读完的书都摆上去' },
    { id: 'sofa', emoji: '🛋', name: '沙发', cost: 200, cat: '家具', desc: '累了就坐一会儿' },
    { id: 'trophy', emoji: '🏆', name: '奖杯', cost: 220, cat: '装饰', desc: '给坚持过的自己' },
    { id: 'bed', emoji: '🛏', name: '舒适大床', cost: 260, cat: '家具', desc: '早睡的底气' },
    { id: 'cat', emoji: '🐱', name: '猫', cost: 300, cat: '伙伴', desc: '它会在你打卡时踩键盘' },
    { id: 'dog', emoji: '🐶', name: '狗', cost: 320, cat: '伙伴', desc: '遛狗顺便把步数走了' },
    { id: 'rug', emoji: '🧶', name: '地毯', cost: 110, cat: '装饰', desc: '光脚踩着很舒服' },
    { id: 'piano', emoji: '🎹', name: '钢琴', cost: 500, cat: '家具', desc: '屋子里的终极奢侈品' }
  ];

  var LEVELS = [
    { n: 0, name: '毛坯房', icon: 'house', emoji: '🏚' },
    { n: 200, name: '有人气', icon: 'house', emoji: '🏠' },
    { n: 500, name: '温馨', icon: 'house', emoji: '🏡' },
    { n: 1200, name: '雅致', icon: 'sparkle', emoji: '✨' },
    { n: 2500, name: '理想家', icon: 'medal', emoji: '🏰' }
  ];

  var SLOTS = 8;   // 房间里能同时摆多少件（买多了进仓库）

  function state() {
    var st = S();
    if (!st.decor) st.decor = {};
    var d = st.decor;
    if (!d.owned) d.owned = {};
    if (!d.placed) d.placed = [];
    return d;
  }
  function item(id) {
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i];
    return null;
  }
  function owned(id) { return state().owned[id] || 0; }
  function placed() { return state().placed.slice(0, SLOTS); }
  function stored(id) { return Math.max(0, owned(id) - state().placed.filter(function (x) { return x === id; }).length); }

  /* 累计投入的积分 = 房间等级 */
  function invested() {
    var sum = 0;
    (S().redemptions || []).forEach(function (r) { if (r && r.kind === 'decor') sum += (r.cost || 0); });
    return sum;
  }
  function level() {
    var v = invested(), cur = LEVELS[0], next = null;
    LEVELS.forEach(function (l) { if (v >= l.n) cur = l; });
    for (var i = 0; i < LEVELS.length; i++) { if (LEVELS[i].n > v) { next = LEVELS[i]; break; } }
    return { cur: cur, next: next, invested: v, pct: next ? Math.round((v - cur.n) / (next.n - cur.n) * 100) : 100 };
  }

  function buy(id) {
    var it = item(id);
    if (!it) return { ok: false, msg: '没有这件物品' };
    if (window.Engine && Engine.points() < it.cost) return { ok: false, msg: '积分不够，还差 ' + (it.cost - Engine.points()) + ' 分' };
    Store.commit(function (s) {
      s.redemptions = s.redemptions || [];
      s.redemptions.push({ id: U.uid('dc'), kind: 'decor', decorId: id, name: it.name, cost: it.cost, at: Date.now() });
      var d = s.decor = s.decor || {};
      d.owned = d.owned || {}; d.placed = d.placed || [];
      d.owned[id] = (d.owned[id] || 0) + 1;
      if (d.placed.length < SLOTS) d.placed.push(id);
    });
    return { ok: true, item: it };
  }
  /* 卖回：退一半积分，避免买错就血本无归 */
  function sell(id) {
    var it = item(id);
    if (!it) return { ok: false };
    var n = owned(id);
    if (n <= 0) return { ok: false, msg: '你没有这件' };
    var back = Math.round(it.cost / 2);
    Store.commit(function (s) {
      var d = s.decor;
      d.owned[id] = n - 1;
      if (d.owned[id] <= 0) delete d.owned[id];
      var i = d.placed.indexOf(id);
      if (i >= 0) d.placed.splice(i, 1);
      s.settings.seedPts = (s.settings.seedPts || 0) + back;
    });
    return { ok: true, back: back };
  }
  function place(id) {
    var d = state();
    if (owned(id) <= 0) return { ok: false, msg: '先买一件' };
    if (d.placed.length >= SLOTS) return { ok: false, msg: '房间摆满了（最多 ' + SLOTS + ' 件），先收起一件' };
    Store.commit(function (s) { s.decor.placed.push(id); });
    return { ok: true };
  }
  function unplace(id) {
    Store.commit(function (s) {
      var i = s.decor.placed.indexOf(id);
      if (i >= 0) s.decor.placed.splice(i, 1);
    });
    return { ok: true };
  }

  /* 房间里摆着的（按摆放顺序） */
  function roomItems() {
    return placed().map(function (id) { return item(id); }).filter(Boolean);
  }
  /* 仓库：买了但没摆出来的 */
  function storage() {
    var out = [];
    Object.keys(state().owned).forEach(function (id) {
      var n = stored(id);
      if (n > 0) out.push({ item: item(id), n: n });
    });
    return out.filter(function (x) { return x.item; });
  }
  function cats() {
    var seen = {}, out = [];
    CATALOG.forEach(function (it) { if (!seen[it.cat]) { seen[it.cat] = 1; out.push(it.cat); } });
    return out;
  }

  return {
    CATALOG: CATALOG, LEVELS: LEVELS, SLOTS: SLOTS,
    state: state, item: item, owned: owned, placed: placed, stored: stored,
    invested: invested, level: level, roomItems: roomItems, storage: storage, cats: cats,
    buy: buy, sell: sell, place: place, unplace: unplace
  };
})();
