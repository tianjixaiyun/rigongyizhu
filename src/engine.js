/* ============ 业务引擎：打卡 / 连续 / 积分 / 统计 ============ */
window.Engine = (function () {
  const S = () => Store.s;

  /* ---------- 记忆化缓存 ----------
   * 统计口径（完成率 / 连续 / 热力图 / 年度回顾）一次渲染里会被重复算几十上百次，
   * 这里按「数据版本号 + 短 TTL」缓存：数据一改（Store.bump）立即失效。 */
  const _c = new Map();
  function memo(key, fn, ttl) {
    const r = window.Store ? Store.rev : undefined;
    if (r === undefined) return fn();        // 没有版本号支持（如单测桩）就不缓存，保证结果永远新鲜
    const now = Date.now();
    const hit = _c.get(key);
    if (hit && hit.rev === r && now - hit.t < (ttl || 3000)) return hit.v;
    const v = fn();
    _c.set(key, { v, rev: r, t: now });
    return v;
  }
  function bust() { _c.clear(); }

  function items(date) {
    return memo('items', () => (S().items || []).filter(it => !it.deleted && !it.archived));
  }

  /* 展示顺序的唯一入口：习惯页的「上移 / 下移」写的就是 sort，
   * 今日页 / 习惯页 / 选择器都从这里取，避免各处各写一遍排序而写歪。 */
  function sorted() {
    return memo('sorted', () => items().slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)));
  }

  /* 习惯的"出生日"：创建之前的历史日期不该算进分母。
   * 之前年度回顾 / 完成率会把 1 月 1 日一直到今天全算成「该做」，
   * 于是上周才建的习惯完成率被稀释成 0% —— 这里统一掐掉。 */
  /* 每个习惯最早一笔打卡在哪天（导入 CSV / 换设备迁移时，记录可能早于 createdAt）。
   * 结果按 rev 缓存：一次渲染里可能被调用上千次，不能每次都遍历全部日志。 */
  function earliestLog() {
    return memo('elog', function () {
    const m = {};
    const logs = S().logs || {};
    Object.keys(logs).forEach(d => {
      const day = logs[d] || {};
      Object.keys(day).forEach(id => { if (day[id] && (!m[id] || d < m[id])) m[id] = d; });
    });
    return m;
    });
  }
  function bornOn(it) {
    if (!it) return null;
    let b = it.createdAt ? U.ymd(new Date(it.createdAt)) : null;
    const e = earliestLog()[it.id];
    if (e && (!b || e < b)) b = e;      // 有更早的真实记录，以记录为准
    return b || null;
  }
  function isAlive(it, date) {
    const b = bornOn(it);
    return !b || date >= b;
  }

  /* 某天某个习惯是否"该做" */
  function isDue(it, date) {
    if (it.pausedUntil && date <= it.pausedUntil) return false;
    if (!isAlive(it, date)) return false;
    const sc = it.schedule || { type: 'daily' };
    const wd = U.weekdayOf(date);
    if (sc.type === 'daily') return true;
    if (sc.type === 'weekdays') return (sc.days || [1, 2, 3, 4, 5]).includes(wd);
    if (sc.type === 'timesPerWeek') return true;
    if (sc.type === 'interval') {
      const n = Math.max(1, sc.n || 2);
      const start = U.ymd(new Date(it.createdAt || Date.now()));
      return U.daysBetween(start, date) % n === 0;
    }
    if (sc.type === 'monthly') return (sc.days || [1]).includes(U.parseYmd(date).getDate());
    /* 年度型（v50）：一年一次的那种事 —— 生日、体检、年检、纪念日。
     * 用 MM-DD 存，只比月日：2 月 29 日在平年自然就没有这一天，不安排也不算漏。 */
    if (sc.type === 'yearly') return (sc.dates || []).indexOf(date.slice(5)) >= 0;
    return true;
  }

  /* ---------- 休息日（v49 · 对标 Habi / Dayora 的「漏一天不该清零」）----------
   * 「每天都要做」是最容易让人放弃的设计：一周里总有那么一两天做不到，
   * 一旦那天的连击归零，前面二十天的努力在心理上就全废了 —— 于是干脆不做了。
   * 这里给每个习惯一个「每周可以休息 N 天」的额度：
   *   休息日不计进完成率分母（不算「没做到」），也不打断连击（不算断签）。
   * 额度按自然周重置，用完为止 —— 不是无限宽容，是「一周忙几天不至于前功尽弃」。 */
  function restPerWeek(it) {
    const n = it && +it.restPerWeek;
    return Number.isInteger(n) && n >= 1 && n <= 6 ? n : 0;
  }
  function restPerMonth(it) {
    const n = it && +it.restPerMonth;
    return Number.isInteger(n) && n >= 1 && n <= 15 ? n : 0;
  }
  /* v51：额度有两种周期，按月那个优先（表单里两者互斥，设了每月就把每周清零）。
   * 依据：HN 上做得最好的那批替代品（Habenna）用的是「每月几天宽限日」——
   * 生活的不规律是按月来的（这个月出差多、下个月很闲），按周切会把额度浪费掉。 */
  function restQuota(it) {
    const m = restPerMonth(it);
    if (m) return { n: m, span: 'month' };
    const w = restPerWeek(it);
    if (w) return { n: w, span: 'week' };
    return null;
  }
  function restPerWeekLike(it) { const q = restQuota(it); return q ? q.n : 0; }
  /* 这一周 / 这个月（按周期起点对齐）到 date 为止，已经用掉的休息天数。
   * 只有「该做、没做完、也没请假、也没用保护券」的日子才消耗额度。 */
  function restUsed(it, date) {
    const q = restQuota(it);
    if (!q) return 0;
    return memo('ru:' + it.id + ':' + q.span + ':' + date, () => {
      const fz = (S().freezes || {});
      let used = 0;
      let cur = q.span === 'month' ? (date.slice(0, 7) + '-01') : U.weekStartOf(date);
      while (cur <= date) {
        if (isDue(it, cur) && !isDone(it, cur) && !isSkipped(cur, it.id) && !fz[cur]) used++;
        cur = U.shiftYmd(cur, 1);
      }
      return used;
    });
  }
  /* 这一天是否算「用掉休息额度」。
   * 只对**已经过去**的日子生效：今天还没过完，不能提前判定为休息 ——
   * 否则今天该做的习惯会凭空从完成率分母里消失，进度条一早就显示 100%。 */
  function isRestDay(it, date) {
    const q = restQuota(it);
    if (!q || !date || date >= U.today()) return false;
    if (!isDue(it, date) || isDone(it, date) || isSkipped(date, it.id)) return false;
    if ((S().freezes || {})[date]) return false;
    return restUsed(it, date) <= q.n;
  }
  /* 全站口径：这一天没有任何完成，但至少有一个习惯用掉了休息额度 → 算全站休息日，不断链。
   * 注意与「那天压根没有习惯」区分开：后者 total 也是 0，但它本来就该断（旧行为不变）。 */
  function isGlobalRestDay(date) {
    if (!date || date >= U.today()) return false;
    if ((S().freezes || {})[date]) return false;
    if (todayRate(date).done > 0) return false;
    return items().some(it => isRestDay(it, date));
  }

  /* 取/写日志：logs[date][itemId] = {v,d,t,by,steps} */
  function getLog(date, itemId) {
    const st = S();
    const day = st.logs[date] || {};
    return day[itemId] || null;
  }
  function setLog(date, itemId, patch) {
    const st = S();
    if (!st.logs[date]) st.logs[date] = {};
    const cur = st.logs[date][itemId] || { v: null, d: false, t: 0, by: '', steps: {} };
    st.logs[date][itemId] = Object.assign(cur, patch, { t: Date.now() });
    bust();
    return st.logs[date][itemId];
  }
  function clearLog(date, itemId) {
    const st = S();
    if (st.logs[date]) delete st.logs[date][itemId];
    bust();
  }

  /* avoid = 戒断型（少做某件事）：打勾表示「今天忍住了」，slip 表示破戒 */
  function isCheckLike(it) { return it.type === 'check' || it.type === 'avoid'; }
  function isDone(it, date) {
    const lg = getLog(date, it.id);
    if (!lg) return false;
    /* 轻量完成（v28 · 4.4）：做到最小版本也算数 —— 不断签、算完成，
     * 只在强度分里按一半计。这是「全有或全无」和「有总比没有好」的分界线。 */
    if (lg.mini) return true;
    if ((it.steps || []).length) return it.steps.every((_, i) => !!(lg.steps || {})[i]);
    if (isCheckLike(it)) return !!lg.d;
    return (lg.v || 0) >= (it.target || 1);
  }
  function progress(it, date) {
    const lg = getLog(date, it.id);
    /* 轻量完成只算半份：连击照常，但强度分涨得慢 —— 用户能感到「做了，但没那么实」 */
    if (lg && lg.mini) return 0.5;
    if ((it.steps || []).length) return it.steps.filter((_, i) => !!((lg || {}).steps || {})[i]).length / it.steps.length;
    if (isCheckLike(it)) return lg && lg.d ? 1 : 0;
    const v = (lg && lg.v) || 0;
    return U.clamp(v / (it.target || 1), 0, 1);
  }

  /* ---------- 部分完成（v51 · 对标 HN 上那句「反正没达标就算了」）----------
   * 原话是：finer grained tracking can contribute to "i am not on target,
   * so maybe it doesn't matter" sort of thinking.
   * 数值型习惯目标 30 分钟、今天只做了 20 分钟 —— 现在算 0，连击当场断掉，
   * 于是「反正断了」就成了不做最后 10 分钟的理由。
   * 这里划一条 50% 的线：过了半程就不断链（和「请假 / 保护券 / 休息日」同等待遇），
   * 但仍然不算完成（不打勾、不进完成率的分子），强度分按真实比例计。
   * 不设更低是因为「做了 3 分钟也算没断」会让连击彻底失去意义。 */
  const PARTIAL_AT = 0.5;
  function partialOf(it, date) {
    if (!it || isCheckLike(it) || (it.steps || []).length) return 0;
    const lg = getLog(date, it.id);
    if (!lg || lg.mini) return 0;
    const r = U.clamp((lg.v || 0) / (it.target || 1), 0, 1);
    return r >= PARTIAL_AT && r < 1 ? r : 0;
  }
  function isPartial(it, date) { return partialOf(it, date) > 0; }

  /* ---------- 最小版本（v28 · 4.4，对标 Duolingo 的「每日目标可低到 1 节课」）----------
   * 读书 30 分钟做不到时，「读 1 页」也能保住今天。习惯上挂一句 mini 文案，
   * 打卡时走 mini 通道：算完成、不断签、强度减半。 */
  function miniOf(it) { return (it && it.mini) || ''; }
  function isMiniDone(it, date) {
    const lg = getLog(date || U.today(), it.id);
    return !!(lg && lg.mini);
  }
  /* 切到轻量完成 / 切回完整完成。已经完整完成的不降级 —— 别把做完的事改小。 */
  function toggleMini(it, date) {
    const d = date || U.today();
    const lg = getLog(d, it.id) || {};
    if (lg.mini) { clearLog(d, it.id); afterCheck(it, d, true); return false; }
    if (isDone(it, d)) return false;
    setLog(d, it.id, { mini: 1, d: true, v: 0, steps: {}, slip: 0, by: S().settings.nickname || '' });
    afterCheck(it, d, false);
    return true;
  }
  /* 破戒：记一笔，但不算完成 */
  function slip(it, date) {
    const was = isDone(it, date);
    const lg = getLog(date, it.id) || {};
    const on = !lg.slip;
    setLog(date, it.id, { d: false, v: 0, mini: 0, slip: on ? 1 : 0, by: S().settings.nickname || '' });
    afterCheck(it, date, was);
    return on;
  }
  function slipped(it, date) { const lg = getLog(date, it.id); return !!(lg && lg.slip); }

  /* ---------- 单次打卡备注（v27 · 4.3，对标 Habo 的 notes & comments）----------
   * 日记是「按天」的，缺的是「这一次」：跑了 5 公里、读了 30 页、今天为什么只做了 10 分钟。
   * 存在 logs[date][itemId].note 上，跟着这一次打卡走，不单独占一个存储结构。
   * 上限 140 字：够写一句，也保证 CSV 导出和列表渲染不会被长文撑破。 */
  const NOTE_MAX = 140;
  function noteOf(itemId, date) {
    const lg = getLog(date || U.today(), itemId);
    return (lg && lg.note) || '';
  }
  function setNote(itemId, date, text) {
    const d = date || U.today();
    const v = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
    const lg = getLog(d, itemId);
    /* 没有打卡记录时不凭空造一条：备注是「这一次」的注解，不是独立事件。
     * 但用户可能先写备注再打卡，所以允许建一条只有备注的空记录。 */
    if (!lg) setLog(d, itemId, { v: 0, d: false, note: v, by: S().settings.nickname || '' });
    else setLog(d, itemId, { note: v });
    return v;
  }
  /* 搜备注（v28 · 4.5）：日记搜索只能搜到日记正文，而「这一次」的记录散在 logs 里。
   * 返回按日期倒序的结果，带上是哪个习惯、哪一天、整句原文。 */
  function noteSearch(q, limit) {
    const key = String(q == null ? '' : q).trim().toLowerCase();
    if (!key) return [];
    const st = S();
    const byId = {};
    (st.items || []).forEach(it => { byId[it.id] = it; });
    const out = [];
    Object.keys(st.logs || {}).forEach(d => {
      const day = st.logs[d] || {};
      Object.keys(day).forEach(id => {
        const note = (day[id] || {}).note;
        if (!note) return;
        if (String(note).toLowerCase().indexOf(key) < 0) return;
        const it = byId[id];
        out.push({ date: d, itemId: id, name: (it && it.name) || '（已删除的习惯）', note: note, deleted: !it });
      });
    });
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return limit ? out.slice(0, limit) : out;
  }

  /* 某个习惯写过哪些句子（v28 · 4.5）：详情页按时间倒序列出最近几条 */
  function notesOf(itemId, limit) {
    const st = S();
    const out = [];
    Object.keys(st.logs || {}).forEach(d => {
      const note = ((st.logs[d] || {})[itemId] || {}).note;
      if (note) out.push({ date: d, note: note });
    });
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { list: limit ? out.slice(0, limit) : out, total: out.length };
  }

  /* ---------- 戒断型（avoid）的独立口径 ----------
   * 打卡型：勾上=完成，没勾=没完成，两者都归零。
   * 戒断型语义是反的：「今天没做」才是成功。而且「没打开 App」和「破戒」是两件事——
   * 前者只是没记录，后者是明确的失败信号。用同一套完成度衡量，会把「戒烟 20 天
   * 破 1 次」和「读书漏 1 天」算成一样糟（v26 对标 mhabit 的 separate scoring models）。
   * 所以这里单独给一套口径：
   *   成功日 = 打勾（忍住了）｜破戒日 = slip｜豁免日 = 请假 / 保护券｜未记录 = 中性
   * 分数只看「连续未破戒天数」：破戒重置连胜，历史最佳单独保留。 */
  function isAvoid(it) { return !!it && it.type === 'avoid'; }

  function cleanStreakOf(itemId, endDate) {
    return memo('cs:' + itemId + ':' + endDate, () => cleanStreakRaw(itemId, endDate));
  }
  function cleanStreakRaw(itemId, endDate) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!isAvoid(it)) return 0;
    const floor = bornOn(it) || U.today();
    const freezes = S().freezes || {};
    let n = 0, cur = endDate;
    for (let i = 0; i < 3650; i++) {
      if (cur < floor) break;
      /* 只数「该防住」的日子；请假 / 保护券是豁免日，不算破戒也不算未破戒 */
      if (isDue(it, cur) && !isSkipped(cur, itemId) && !freezes[cur]) {
        if (slipped(it, cur)) break;
        n++;
      }
      cur = U.shiftYmd(cur, -1);
    }
    return n;
  }
  function bestCleanStreak(itemId) {
    return memo('bcs:' + itemId, () => bestCleanStreakRaw(itemId));
  }
  function bestCleanStreakRaw(itemId) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!isAvoid(it)) return 0;
    const freezes = S().freezes || {};
    const start = bornOn(it) || U.today();
    const end = U.today();
    let best = 0, run = 0, cur = start;
    for (let i = 0; i < 3650 && cur <= end; i++) {
      if (isDue(it, cur) && !isSkipped(cur, itemId) && !freezes[cur]) {
        if (slipped(it, cur)) run = 0; else { run++; if (run > best) best = run; }
      }
      cur = U.shiftYmd(cur, 1);
    }
    return Math.max(best, cleanStreakOf(itemId, end));
  }
  /* 近 N 天的四类日子各占多少天，用于详情页把口径讲清楚 */
  function avoidSummary(itemId, days) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!isAvoid(it)) return null;
    const end = U.today();
    const n = Math.max(1, days || 30);
    let kept = 0, slip = 0, exempt = 0, blank = 0;
    for (let i = 0; i < n; i++) {
      const cur = U.shiftYmd(end, -i);
      if (!isAlive(it, cur) || !isDue(it, cur)) continue;
      if (isSkipped(cur, itemId) || (S().freezes || {})[cur]) { exempt++; continue; }
      if (slipped(it, cur)) { slip++; continue; }
      const lg = getLog(cur, itemId);
      if (lg && lg.d) kept++; else blank++;
    }
    return { kept, slip, exempt, blank, clean: cleanStreakOf(itemId, end), bestClean: bestCleanStreak(itemId), days: n };
  }

  /* 打卡 / 取消 */
  function toggle(it, date) {
    const done = isDone(it, date);
    if (done) {
      if (isCheckLike(it)) { clearLog(date, it.id); afterCheck(it, date, true); return false; }
      const lg = getLog(date, it.id) || {};
      setLog(date, it.id, { v: 0, d: false, steps: {}, mini: 0, by: S().settings.nickname || '' });
      afterCheck(it, date, true);
      return false;
    }
    if ((it.steps || []).length) {
      const steps = {}; it.steps.forEach((_, i) => { steps[i] = true; });
      setLog(date, it.id, { v: it.steps.length, d: true, steps, mini: 0, by: S().settings.nickname || '' });
    } else if (isCheckLike(it)) setLog(date, it.id, { d: true, v: 1, mini: 0, by: S().settings.nickname || '' });
    else setLog(date, it.id, { v: it.target || 1, d: true, mini: 0, by: S().settings.nickname || '' });
    afterCheck(it, date, false);
    return true;
  }
  function addValue(it, date, delta) {
    if (!Number.isFinite(delta)) throw new Error('请输入有效的数字');
    const was = isDone(it, date);
    const lg = getLog(date, it.id) || { v: 0, d: false };
    let v = Math.max(0, (lg.v || 0) + delta);
    v = Math.round(v * 100) / 100;
    if (!Number.isFinite(v)) throw new Error('数值过大，请调整后重试');
    const done = v >= (it.target || 1);
    setLog(date, it.id, { v, d: done, mini: 0, by: S().settings.nickname || '' });
    afterCheck(it, date, was);
    return v;
  }
  function setValue(it, date, v) {
    if (!Number.isFinite(v)) throw new Error('请输入有效的数字');
    const was = isDone(it, date);
    v = Math.round(Math.max(0, v) * 100) / 100;
    if (!Number.isFinite(v)) throw new Error('数值过大，请调整后重试');
    const done = v >= (it.target || 1);
    setLog(date, it.id, { v, d: done, mini: 0, by: S().settings.nickname || '' });
    afterCheck(it, date, was);
    return v;
  }
  function toggleStep(it, date, idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= (it.steps || []).length) return null;
    const was = isDone(it, date);
    const lg = getLog(date, it.id) || { v: 0, d: false, steps: {} };
    const st2 = Object.assign({}, lg.steps || {});
    st2[idx] = !st2[idx];
    const total = (it.steps || []).length;
    const doneN = (it.steps || []).filter((_, i) => st2[i]).length;
    setLog(date, it.id, { steps: st2, v: doneN, d: total > 0 && doneN >= total, mini: 0, by: S().settings.nickname || '' });
    afterCheck(it, date, was);
    return st2;
  }

  /* 以完成状态变化结算积分；取消和撤销退回本次奖励，重复加量不重复发奖。 */
  function afterCheck(it, date, wasDone) {
    const st = S();
    const ledger = st.checkRewards = st.checkRewards || {};
    const day = ledger[date] = ledger[date] || { items: {}, all: 0 };
    const done = isDone(it, date);
    let delta = 0;
    if (done && !wasDone && !Object.hasOwn(day.items, it.id)) {
      const streak = streakOf(it.id, date);
      const reward = 10 + (streak > 0 && streak % 7 === 0 ? 50 : 0);
      day.items[it.id] = reward;
      delta += reward;
    } else if (!done && Object.hasOwn(day.items, it.id)) {
      delta -= day.items[it.id];
      delete day.items[it.id];
    }
    const rate = todayRate(date);
    const all = rate.total > 0 && rate.done === rate.total;
    if (all && !day.all && !wasDone) { day.all = 30; delta += 30; }
    else if (!all && day.all) { delta -= day.all; day.all = 0; }
    st.settings.seedPts = Math.max(0, (st.settings.seedPts || 0) + delta);
  }

  function restoreLog(it, date, previous) {
    const was = isDone(it, date);
    clearLog(date, it.id);
    if (previous) setLog(date, it.id, previous);
    afterCheck(it, date, was);
  }

  function points() {
    const st = S();
    const spent = (st.redemptions || []).reduce((a, r) => a + (r.cost || 0), 0);
    return Math.max(0, (st.settings.seedPts || 0) - spent);
  }

  /* 当天是否"请假跳过"（跳过不算待办，也不算完成） */
  function isSkipped(date, itemId) {
    const lg = getLog(date, itemId);
    return !!(lg && lg.s);
  }

  /* 当天完成情况（跳过的不计入分母；v49 起用掉休息额度的过去日子也不计入分母） */
  function todayRate(date) {
    return memo('tr:' + date, () => {
      const list = items().filter(it => isDue(it, date) && !isSkipped(date, it.id) && !isRestDay(it, date));
      let done = 0;
      list.forEach(it => { if (isDone(it, date)) done++; });
      return { done, total: list.length, pct: list.length ? Math.round(done / list.length * 100) : 0 };
    });
  }
  /* ---------- 「每周 N 次」型习惯 ----------
   * Loop Habit Tracker 的做法：连击不按「每天」算，而按「这个周期有没有达标」算。
   * 这里用滚动 7 天窗口（今天往前 6 天）—— 比自然周更宽容，周五漏了周六补上也算数。 */
  function isWeekly(it) { return (it && it.schedule || {}).type === 'timesPerWeek'; }
  function weeklyTarget(it) { return Math.max(1, ((it || {}).schedule || {}).n || 1); }
  /* 连击单位：日频次是「天」，周频次是「周」—— UI 上必须分开写，否则会显示「连续 3 天」其实是 3 周 */
  function streakUnit(it) { return isWeekly(it) ? '周' : '天'; }

  function weekProgress(it, date) {
    if (!isWeekly(it)) return null;
    const d = date || U.today();
    const n = weeklyTarget(it);
    let done = 0, alive = 0;
    for (let i = 0; i < 7; i++) {
      const cur = U.shiftYmd(d, -i);
      if (!isAlive(it, cur)) continue;
      alive++;
      if (isDone(it, cur)) done++;
    }
    return { done: done, target: n, alive: alive, ok: done >= n, left: Math.max(0, n - done) };
  }

  /* 窗口内完成次数（含出生日过滤），用于周连击计算 */
  function windowDone(it, end) {
    let done = 0, alive = 0;
    for (let i = 0; i < 7; i++) {
      const cur = U.shiftYmd(end, -i);
      if (!isAlive(it, cur)) continue;
      alive++;
      if (isDone(it, cur)) done++;
    }
    return { done: done, alive: alive };
  }
  /* 周频次连击：连续多少个滚动窗口达成了每周目标。
   * 当前这个窗口还没达标不算断（这周还没过完），跳过它继续往前数。 */
  function weeklyStreakRaw(it, endDate) {
    const n = weeklyTarget(it);
    let end = endDate, streak = 0;
    for (let w = 0; w < 520; w++) {
      const r = windowDone(it, end);
      if (r.alive === 0) break;                       // 已经数到习惯出生之前
      const need = r.alive < 7 ? Math.max(1, Math.round(n * r.alive / 7)) : n;
      if (r.done >= need) { streak++; end = U.shiftYmd(end, -7); continue; }
      if (w === 0) { end = U.shiftYmd(end, -7); continue; }   // 本周还没过完，给机会
      break;
    }
    return streak;
  }
  function weeklyBestRaw(it) {
    const n = weeklyTarget(it);
    const end0 = U.today();
    let best = 0, run = 0, end = end0;
    for (let w = 0; w < 520; w++) {
      const r = windowDone(it, end);
      if (r.alive === 0) break;
      const need = r.alive < 7 ? Math.max(1, Math.round(n * r.alive / 7)) : n;
      if (r.done >= need) { run++; if (run > best) best = run; } else run = 0;
      end = U.shiftYmd(end, -7);
    }
    return best;
  }

  /* 连续天数：从 date 往回数，每天该习惯都完成 */
  /* endDate 默认今天：不传就按「现在」算。以前不传会一路把 undefined 传给
   * shiftYmd → parseYmd，报一句「Cannot read properties of undefined (reading 'split')」——
   * 这种报错对一个只想问「连续几天」的调用方毫无意义。 */
  function streakOf(itemId, endDate = U.today()) {
    return memo('st:' + itemId + ':' + endDate, () => streakOfRaw(itemId, endDate));
  }
  function streakOfRaw(itemId, endDate) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return 0;
    if (isWeekly(it)) return weeklyStreakRaw(it, endDate);
    let n = 0, cur = endDate;
    const today = U.today();
    /* 起点用 bornOn（创建日 or 最早一笔打卡）：从 CSV 导入的历史记录可能早于创建日，
     * 若按 createdAt 截断，导入的连击会凭空断掉。 */
    const floor = bornOn(it) || today;
    if (!isDone(it, cur)) {
      // 今天还没打卡不算断，从昨天开始算
      cur = U.shiftYmd(cur, -1);
      if (cur < floor) return 0;
    }
    const freezes = S().freezes || {};
    for (let i = 0; i < 3650; i++) {
      if (cur < floor) break;
      if (isDue(it, cur)) {
        if (isDone(it, cur)) n++;
        else if (isSkipped(cur, it.id) || freezes[cur] || isRestDay(it, cur) || isPartial(it, cur)) { /* 请假 / 保护券 / 休息日 / 部分完成：不断链 */ }
        else break;
      }
      cur = U.shiftYmd(cur, -1);
    }
    return n;
  }
  function bestStreak(itemId) {
    return memo('bs:' + itemId, () => bestStreakRaw(itemId));
  }
  function bestStreakRaw(itemId) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return 0;
    if (isWeekly(it)) return weeklyBestRaw(it);
    const freezes = S().freezes || {};
    const start = bornOn(it) || U.today();
    const end = U.today();
    let best = 0, run = 0;
    let cur = start;
    for (let i = 0; i < 3650 && cur <= end; i++) {
      if (isDue(it, cur)) {
        if (isDone(it, cur)) { run++; best = Math.max(best, run); }
        /* 请假 / 保护券 / 休息日：不断链，也不 +1（v45 修，v49 加休息日）。
         * 原来这里只有 run=0 一条路，导致「最佳纪录」不认保护券 ——
         * 用了保护券的用户会出现「当前连续 7 天、最佳纪录 5 天」这种自相矛盾。 */
        else if (isSkipped(cur, it.id) || freezes[cur] || isRestDay(it, cur) || isPartial(it, cur)) { /* 保持 run 不变 */ }
        else run = 0;
      }
      cur = U.shiftYmd(cur, 1);
    }
    return Math.max(best, streakOf(itemId, U.today()));
  }

  /* 历史连续段（v45 · 借鉴 OpenHabitTracker 的「最长连续排行」）
   * 只给一个「最佳 N 天」是抽象数字；给出「哪几段、什么时候」才是可回看的实证。
   * 口径必须与 bestStreakRaw 一致：done 才 +1，请假/保护券「不断链但也不 +1」。 */
  function streakRuns(itemId, limit) {
    return memo('sr:' + itemId + ':' + (limit || 3), () => streakRunsRaw(itemId, limit || 3));
  }
  function streakRunsRaw(itemId, limit) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return [];
    if (isWeekly(it)) return [];      // 周频次按周计段，单位不同，先不混进「天」的排行
    const freezes = S().freezes || {};
    const start = bornOn(it) || U.today();
    const end = U.today();
    const out = [];
    let run = 0, from = '', to = '';
    let cur = start;
    for (let i = 0; i < 3650 && cur <= end; i++) {
      if (isDue(it, cur)) {
        if (isDone(it, cur)) {
          if (!run) from = cur;
          run++; to = cur;
        } else if (isSkipped(cur, it.id) || freezes[cur] || isRestDay(it, cur) || isPartial(it, cur)) {
          /* 请假 / 保护券 / 休息日 / 部分完成：不断链，也不 +1 */
        } else if (run) {
          out.push({ n: run, from: from, to: to }); run = 0;
        }
      }
      cur = U.shiftYmd(cur, 1);
    }
    if (run) out.push({ n: run, from: from, to: to });
    /* 长的在前；同样长时近的在前 */
    out.sort((a, b) => b.n - a.n || (a.to < b.to ? 1 : -1));
    return out.slice(0, limit);
  }

  /* ---------- 单个习惯的热力图 ----------
   * GitHub 贡献图那种：一天一格，深浅 = 当天完成程度（数值型按目标达成比例）。
   * lv: -1 还没创建这个习惯 / 0 未安排或没做 / 1 请假 / 2~4 完成程度递增 */
  function itemHeat(itemId, days) {
    return memo('ih:' + itemId + ':' + days, () => itemHeatRaw(itemId, days));
  }
  function itemHeatRaw(itemId, days) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return [];
    const end = U.today();
    let cur = U.shiftYmd(end, -((days || 365) - 1));
    const out = [];
    const guard = (days || 365) + 2;
    for (let i = 0; i < guard && cur <= end; i++) {
      const born = isAlive(it, cur);
      const paused = it.pausedUntil && cur <= it.pausedUntil;
      const due = born && !paused && isDue(it, cur);
      const sk = born && isSkipped(cur, itemId);
      const p = due ? progress(it, cur) : 0;
      let lv = 0;
      if (!born) lv = -1;
      else if (sk) lv = 1;
      else if (!due) lv = 0;
      else if (p <= 0) lv = 0;
      else if (p < 0.34) lv = 2;
      else if (p < 0.67) lv = 3;
      else if (p < 1) lv = 3;
      else lv = 4;
      out.push({
        date: cur, due: due, born: born, done: due && isDone(it, cur), sk: sk,
        p: p, lv: lv, v: (getLog(cur, itemId) || {}).v || 0
      });
      cur = U.shiftYmd(cur, 1);
    }
    return out;
  }

  /* ---------- 补卡期限 ----------
   * 补卡是给用户救急的，不是给连击刷分的：默认只能补最近 3 天，可在设置里放宽到 7 天。 */
  function backfillDays() {
    const n = +(S().settings || {}).backfillDays;
    return n >= 1 && n <= 30 ? n : 3;
  }
  function canBackfill(date) {
    const gap = U.daysBetween(date, U.today());
    return gap >= 0 && gap <= backfillDays();
  }
  /* 全站连续：每天至少完成一个习惯 */
  function globalStreak() {
    return memo('gst', () => globalStreakRaw());
  }
  function globalStreakRaw() {
    /* 保护券覆盖的日子要算「没断」。一张券买的就是连击不断，
     * 顶上这个数要是不认它，用户刚看完「保住了」一抬头就是连续 0 天。
     * 注意不能重复计数：那天只要完成过任意一个习惯，done>0 已经算上了。 */
    const fz = S().freezes || {};
    const on = d => todayRate(d).done > 0 || !!fz[d] || isGlobalRestDay(d);
    let n = 0, cur = U.today();
    if (!on(cur)) cur = U.shiftYmd(cur, -1);
    for (let i = 0; i < 3650; i++) {
      if (on(cur)) n++; else break;
      cur = U.shiftYmd(cur, -1);
    }
    return n;
  }

  /* 热力图数据 */
  function heatmap(days) {
    return memo('heat:' + days, () => heatmapRaw(days));
  }
  function heatmapRaw(days) {
    const end = U.today();
    const start = U.shiftYmd(end, -(days - 1));
    const out = [];
    let cur = start;
    while (cur <= end) {
      const r = todayRate(cur);
      const lv = r.total === 0 ? 0 : r.pct === 0 ? 0 : r.pct < 40 ? 1 : r.pct < 70 ? 2 : r.pct < 100 ? 3 : 4;
      out.push({ date: cur, count: r.done, total: r.total, pct: r.pct, level: lv });
      cur = U.shiftYmd(cur, 1);
    }
    return out;
  }

  /* 近 n 周完成率（口径见下面的 weeklyTrendRaw） */
  function weeklyTrend(weeks) {
    return memo('wk:' + weeks, () => weeklyTrendRaw(weeks));
  }
  /* v42 · 走查第 12 条：窗口按「一周起始日」对齐，不再拿今天往前数 7 天。
   * 原来第 i 桶是 [today-7i-6, today-7i]，只有今天正好是周日时才和「上周周报」
   * 的区间对得上，其余日子两处数字各说各话；现在最后一桶就是本周（进行中也算），
   * 倒数第二桶恒等于上周周报，两个口径从此一致。
   * 注意每桶是 [s, s+6]：s 是这一周的第一天，别写成 s = e - 6（那会退到上周中段）。 */
  function weeklyTrendRaw(weeks) {
    const out = [];
    const start = U.weekStartOf(U.today());
    for (let i = weeks - 1; i >= 0; i--) {
      const s = U.shiftYmd(start, -7 * i);
      const e = U.shiftYmd(s, 6);
      let d = 0, t = 0;
      let cur = s;
      while (cur <= e) { const r = todayRate(cur); d += r.done; t += r.total; cur = U.shiftYmd(cur, 1); }
      out.push({ label: (U.parseYmd(s).getMonth() + 1) + '/' + U.parseYmd(s).getDate(), pct: t ? Math.round(d / t * 100) : 0 });
    }
    return out;
  }

  function itemRate(itemId, days) {
    return memo('ir:' + itemId + ':' + days, () => itemRateRaw(itemId, days));
  }
  /* v26 · 「样本不够就不说百分比」的唯一口径（复检 5.2）。
   * 以前同一个习惯在三个页面有三种说法：今日卡片说「数据 1 天」、习惯列表说
   * 「30 天完成率 100%」、详情页说「0% 近 30 天」——同一份数据互相打脸。
   * 现在三处都走这一个函数：应做天数不足 7 天只报「数据 N 天」，满 7 天才给百分比。 */
  function dueDaysOf(itemId, days) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return 0;
    const end = U.today();
    let t = 0;
    for (let i = 0; i < days; i++) {
      const day = U.shiftYmd(end, -i);
      if (isDue(it, day) && !isSkipped(day, itemId)) t++;
    }
    return t;
  }
  function rateLabel(itemId, days) {
    const t = dueDaysOf(itemId, days);
    if (t >= 7) return { enough: true, days: t, pct: itemRate(itemId, days), text: days + ' 天完成率 ' + itemRate(itemId, days) + '%' };
    const all = dueDaysOf(itemId, 1200);
    return { enough: false, days: all, pct: 0, text: '数据 ' + all + ' 天' };
  }
  /* 单个习惯近 N 天完成率。
   * 口径必须和「今日完成率」todayRate 一致：请假（skip）的日子既不算完成、也不算该做，
   * 否则同一个习惯在今日卡片（Extra.rateOf，排除请假）和习惯列表（这里，原先计入请假）
   * 会显示两个不同的数字，用户一眼就能看出对不上。 */
  function itemRateRaw(itemId, days) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return 0;
    const end = U.today();
    let d = 0, t = 0;
    for (let i = 0; i < days; i++) {
      const day = U.shiftYmd(end, -i);
      if (isDue(it, day) && !isSkipped(day, itemId)) { t++; if (isDone(it, day)) d++; }
    }
    return t ? Math.round(d / t * 100) : 0;
  }

  function totalCheckins() {
    return memo('tc', () => totalCheckinsRaw());
  }
  function totalCheckinsRaw() {
    let n = 0;
    Object.values(S().logs || {}).forEach(day => {
      Object.values(day).forEach(lg => { if (lg && (lg.d || (lg.v || 0) > 0)) n++; });
    });
    return n;
  }

  /* 心情 vs 完成率 关联 */
  function moodCorrelation() {
    return memo('mood', () => moodCorrelationRaw());
  }
  function moodCorrelationRaw() {
    const st = S();
    const buckets = {};
    Object.entries(st.moods || {}).forEach(([date, m]) => {
      const r = todayRate(date);
      if (r.total === 0) return;
      const k = Math.round(m);
      buckets[k] = buckets[k] || { sum: 0, n: 0 };
      buckets[k].sum += r.pct; buckets[k].n++;
    });
    return Object.entries(buckets).map(([k, v]) => ({ mood: +k, pct: Math.round(v.sum / v.n), n: v.n }))
      .sort((a, b) => a.mood - b.mood);
  }

  /* 年度回顾 */
  function yearly(year) {
    return memo('yr:' + (year || new Date().getFullYear()), () => yearlyRaw(year));
  }
  function yearlyRaw(year) {
    const st = S();
    const y = year || new Date().getFullYear();
    /* 起点取「年初」和「最早一个习惯的生日」中较晚的那个：
     * 习惯还没建的日子不该算进年度分母，否则新用户全年完成率永远是 0%。 */
    let start = y + '-01-01', end = y + '-12-31';
    let minBorn = null;
    items().forEach(it => {
      const b = bornOn(it);
      if (b && (!minBorn || b < minBorn)) minBorn = b;
    });
    if (minBorn && minBorn > start) start = minBorn;
    let totalDone = 0, totalDue = 0, daysActive = 0, bestDay = { date: '', pct: 0 };
    const perItem = {};
    let cur = start;
    const last = end > U.today() ? U.today() : end;
    while (cur <= last) {
      const r = todayRate(cur);
      totalDone += r.done; totalDue += r.total;
      if (r.done > 0) daysActive++;
      if (r.done > bestDay.pct) bestDay = { date: cur, pct: r.done };
      items().forEach(it => {
        if (!isDue(it, cur)) return;
        perItem[it.id] = perItem[it.id] || { name: it.name, color: it.color, done: 0, total: 0 };
        perItem[it.id].total++;
        if (isDone(it, cur)) perItem[it.id].done++;
      });
      cur = U.shiftYmd(cur, 1);
    }
    const top = Object.values(perItem).map(v => ({ name: v.name, color: v.color, rate: v.total ? Math.round(v.done / v.total * 100) : 0 }))
      .sort((a, b) => b.rate - a.rate).slice(0, 5);
    const photoN = Object.values(st.notes || {}).reduce((a, n) => a + ((n.photos || []).length), 0);
    const noteN = Object.values(st.notes || {}).filter(n => n.text && n.text.trim()).length;
    return {
      year: y, totalDone, totalDue, from: start,
      rate: totalDue ? Math.round(totalDone / totalDue * 100) : 0,
      daysActive, bestDay, top, photoN, noteN,
      points: points(), streak: globalStreak()
    };
  }

  /* 搭子排行榜（本周） */
  function leaderboard() {
    const st = S();
    const end = U.today(), start = U.shiftYmd(end, -6);
    const names = new Set();
    if (st.settings.nickname) names.add(st.settings.nickname);
    (st.members || []).forEach(m => m.name && names.add(m.name));
    Object.values(st.logs || {}).forEach(day => Object.values(day).forEach(l => l && l.by && names.add(l.by)));
    const rows = [];
    names.forEach(nm => {
      let d = 0, t = 0;
      let cur = start;
      while (cur <= end) {
        const day = st.logs[cur] || {};
        Object.values(day).forEach(l => {
          if (!l) return;
          const mine = nm ? l.by === nm : !l.by;
          if (!mine) return;
          t++; if (l.d) d++;
        });
        cur = U.shiftYmd(cur, 1);
      }
      rows.push({ name: nm || '未命名', done: d, total: t, pct: t ? Math.round(d / t * 100) : 0,
        me: nm === (st.settings.nickname || '') });
    });
    return rows.sort((a, b) => b.pct - a.pct || b.done - a.done);
  }

  /* 套餐进度 */
  function bundleProgress(b) {
    const date = U.today();
    const list = (b.itemIds || []).map(id => (S().items || []).find(x => x.id === id)).filter(Boolean);
    const done = list.filter(it => isDone(it, date)).length;
    return { done, total: list.length, pct: list.length ? Math.round(done / list.length * 100) : 0, list };
  }
  function runBundle(b) {
    const date = U.today();
    const p = bundleProgress(b);
    if (p.done === p.total && p.total > 0) {
      p.list.forEach(it => { restoreLog(it, date, null); });
      return false;
    }
    p.list.forEach(it => {
      if (isDone(it, date)) return;
      if ((it.steps || []).length) {
        const steps = {}; it.steps.forEach((_, i) => { steps[i] = true; });
        setLog(date, it.id, { v: it.steps.length, d: true, steps, by: S().settings.nickname || '' });
      } else if (isCheckLike(it)) setLog(date, it.id, { d: true, v: 1, by: S().settings.nickname || '' });
      else setLog(date, it.id, { v: it.target || 1, d: true, by: S().settings.nickname || '' });
      afterCheck(it, date, false);
    });
    return true;
  }

  /* ---------- 本月完成度（v49）----------
   * 「连续 N 天」只回答一个问题：今天断没断。它不回答「这个月我到底做得怎么样」。
   * 断过一次的人看到的是 0，而 0 会让人以为之前白做了 —— 这是把人劝退的最短路径。
   * 所以首屏并列第二个数字：本月有安排的日子里，有多少天做到了（当天至少完成一项）。 */
  function monthRate(date) {
    const d = date || U.today();
    return memo('mr:' + d, () => {
      const p = U.parseYmd(d);
      const start = U.ymd(new Date(p.getFullYear(), p.getMonth(), 1));
      let done = 0, total = 0, cur = start;
      while (cur <= d) {
        const r = todayRate(cur);
        if (r.total > 0) { total++; if (r.done > 0) done++; }
        cur = U.shiftYmd(cur, 1);
      }
      return { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0, from: start, to: d };
    });
  }

  /* 单个习惯累计做到多少次（v49 · 对标 Not Boring 的「完成 60 次就养成」）。
   * 连续天数会因为一天没做到而归零，累计次数不会 —— 断签那天最需要的就是这个不会归零的数字。 */
  function doneCount(itemId) {
    return memo('dc:' + itemId, () => {
      const it = (S().items || []).find(x => x.id === itemId);
      if (!it) return 0;
      const logs = S().logs || {};
      let n = 0;
      Object.keys(logs).forEach(d => { if (logs[d] && logs[d][itemId] && isDone(it, d)) n++; });
      return n;
    });
  }

  return {
    items, sorted, isDue, isAlive, bornOn, getLog, setLog, clearLog, isDone, progress, isSkipped,
    restPerWeek: restPerWeek, restPerMonth: restPerMonth, restQuota: restQuota, restPerWeekLike: restPerWeekLike,
    isRestDay: isRestDay, isGlobalRestDay: isGlobalRestDay, restUsed: restUsed,
    isPartial: isPartial, partialOf: partialOf, PARTIAL_AT: PARTIAL_AT,
    monthRate: monthRate, doneCount: doneCount,
    toggle, addValue, setValue, toggleStep, restoreLog,
    todayRate, streakOf, bestStreak, streakRuns, globalStreak, points,
    isWeekly, streakUnit, weekProgress, itemHeat, backfillDays, canBackfill,
    heatmap, weeklyTrend, itemRate, dueDaysOf, rateLabel, totalCheckins, moodCorrelation, yearly, leaderboard,
    bundleProgress, runBundle, slip: slip, slipped: slipped, isCheckLike: isCheckLike,
    isAvoid, cleanStreakOf, bestCleanStreak, avoidSummary,
    noteOf, setNote, NOTE_MAX, noteSearch, notesOf,
    miniOf, isMiniDone, toggleMini,
    /* v47：健康数据自动勾选要按正常口径发积分（自动完成也是完成） */
    afterCheck: afterCheck,
    bustCache: bust, memo: memo
  };
})();
