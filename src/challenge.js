/* ============ 引导式挑战（Challenges） ============
 * 参考 Fabulous 的 Journey / Challenge 思路：新手面对空白列表不知道从什么开始，
 * 于是给一组「有名字、有天数、有终点」的挑战 —— 加入后自动挂上一个习惯，
 * 每天该习惯完成，挑战进度就 +1，攒够天数就通关拿奖励。
 * 进度按「累计完成天数」算（不是连续），漏一天不至于全盘归零，更容易坚持到底。
 */
window.Challenge = (function () {

  const PRESETS = [
    { key: 'early21', name: '21 天早起', icon: 'sun', emoji: '🌅', days: 21, habit: '早起', reward: 120, desc: '连续三周在固定时间起床，把早起交给身体记忆' },
    { key: 'water7', name: '7 天多喝水', icon: 'drop', emoji: '💧', days: 7, habit: '喝水', reward: 60, desc: '每天喝够 1.5 升水，先给自己补满水' },
    { key: 'read30', name: '30 天阅读', icon: 'book-open', emoji: '📖', days: 30, habit: '读书', reward: 200, desc: '每天读 30 分钟，一个月就是 15 小时' },
    { key: 'sport14', name: '14 天运动', icon: 'sneaker-move', emoji: '🏃', days: 14, habit: '运动', reward: 120, desc: '连续两周动起来，让身体先热起来' },
    { key: 'zen7', name: '7 天冥想', icon: 'lotus', emoji: '🧘', days: 7, habit: '冥想', reward: 60, desc: '每天 10 分钟冥想，给大脑留一点空白' },
    { key: 'diary21', name: '21 天写日记', icon: 'pencil', emoji: '✍️', days: 21, habit: '写日记', reward: 120, desc: '睡前写几句，把一天收个尾' }
  ];

  function preset(key) { return PRESETS.find(p => p.key === key) || null; }
  function list() { return (Store.s.challenges || []).filter(c => !c.deleted); }
  function find(id) { return (Store.s.challenges || []).find(c => c.id === id && !c.deleted) || null; }
  function joined(key) { return list().find(c => c.key === key) || null; }

  /* 加入挑战时把习惯挂上：同名习惯直接复用，没有就照习惯库的模板建一个 */
  function ensureHabit(name) {
    const st = Store.s;
    let it = (st.items || []).find(x => x.name === name && !x.deleted && !x.archived);
    if (it) return it.id;
    const tpl = (window.Feat && Feat.LIB ? Feat.LIB.find(l => l.name === name) : null) ||
      { type: 'check', target: null, unit: '', slot: 'any', reminderAt: null, tags: [], color: null };
    const pal = Store.palette();
    const created = Object.assign({
      id: U.uid('item'), roomId: st.activeRoomId, sort: (st.items || []).length,
      name: name, type: tpl.type || 'check', target: tpl.target != null ? tpl.target : null,
      unit: tpl.unit || '', slot: tpl.slot || 'any', reminderAt: tpl.reminderAt || null,
      tags: tpl.tags || [], color: tpl.color || pal[(st.items || []).length % pal.length],
      steps: [], schedule: { type: 'daily' }, dependsOn: null, goal: null,
      pausedUntil: null, archived: false, deleted: false,
      createdAt: Date.now(), updatedAt: Date.now()
    });
    Store.commit(s => { s.items.push(created); });
    return created.id;
  }

  function join(keyOrPreset) {
    const p = typeof keyOrPreset === 'string' ? preset(keyOrPreset) : keyOrPreset;
    if (!p) return null;
    if (joined(p.key)) return joined(p.key);
    const habitId = ensureHabit(p.habit);
    const c = {
      id: U.uid('chal'), key: p.key, name: p.name, icon: p.icon || 'target', emoji: p.emoji, days: p.days,
      habitId: habitId, startedAt: U.today(), doneDates: {}, doneAt: null,
      reward: p.reward || 0, createdAt: Date.now(), updatedAt: Date.now(), deleted: false
    };
    Store.commit(st => { (st.challenges = st.challenges || []).push(c); });
    return c;
  }

  function leave(id) {
    Store.commit(st => {
      const c = (st.challenges || []).find(x => x.id === id);
      if (c) { c.deleted = true; c.updatedAt = Date.now(); }
    });
  }

  /* v59 · 全品类对标（Way of Life 的 chains / HabitNow 的灵活目标）：
   * 挑战不再只有 6 个写死的模板 —— 任意习惯 × 任意天数（7–100）。
   * 奖励按约 6 分/天自动算（与现有模板同量级），凑成 5 的倍数。
   * 进度/通关/领奖全部复用 join+syncAll 的既有逻辑，custom key 唯一不与预设冲突。 */
  function createCustom(o) {
    const name = String(o.name || '').trim().slice(0, 20);
    const days = Math.min(100, Math.max(7, Math.round(+o.days || 0)));
    if (!name || !days) return null;
    const habitName = String(o.habitName || '').trim().slice(0, 20) || name;
    const reward = Math.max(30, Math.round(days * 6 / 5) * 5);
    return join({ key: 'custom_' + U.uid('c').slice(-10), name: name, icon: 'target', emoji: '🎯',
      days: days, habit: habitName, reward: reward, desc: '' });
  }

  function doneCount(c) { return Object.keys(c.doneDates || {}).length; }
  function pct(c) { return Math.min(100, Math.round(doneCount(c) / Math.max(1, c.days) * 100)); }
  function left(c) { return Math.max(0, c.days - doneCount(c)); }

  /* 把关联习惯的历史打卡补进挑战进度，并判断是否通关。
   * 幂等：重复调用不会重复计数，也不会重复发奖。 */
  function syncAll() {
    const st = Store.s;
    const today = U.today();
    let changed = false, cleared = [];
    (st.challenges || []).forEach(c => {
      if (c.deleted || c.doneAt) return;
      const it = (st.items || []).find(x => x.id === c.habitId && !x.deleted);
      if (!it) return;
      c.doneDates = c.doneDates || {};
      let d = c.startedAt, guard = 0;
      while (d && d <= today && guard++ < 500) {
        if (!c.doneDates[d] && Engine.isDone(it, d)) { c.doneDates[d] = 1; changed = true; }
        d = U.shiftYmd(d, 1);
      }
      if (doneCount(c) >= c.days) {
        c.doneAt = Date.now();
        if (c.reward) { st.settings.seedPts = (st.settings.seedPts || 0) + c.reward; }
        cleared.push(c);
        changed = true;
      }
    });
    if (changed) Store.commit();
    return cleared;
  }

  return { PRESETS, preset, list, find, joined, join, leave, createCustom, doneCount, pct, left, syncAll };
})();
