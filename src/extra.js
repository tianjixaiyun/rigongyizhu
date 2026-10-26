/* ============ 统计增强层 ============
 * 借鉴 GitHub 上 Loop Habit Tracker / Habitica 的成熟做法：
 *  - 习惯强度分(Loop Score)：漏一天不会归零，用指数移动平均衡量习惯真实牢固程度
 *  - 跳过 / 请假(Skip)：当天标记跳过，不算没完成也不算完成
 *  - 连续保护券(Streak Freeze)：漏打卡自动消耗一张保住连续记录
 *  - 成就徽章墙：完成指定的里程碑自动解锁
 *  - 周期回顾报告：周/月自动小结
 *  - 补卡日历：任意过去日期都能补录
 */
window.Extra = (function () {
  const S = () => Store.s;
  const T = () => U.today();

  /* ---------- 跳过 / 请假 ---------- */
  function skip(date, itemId, on) {
    Engine.setLog(date, itemId, { s: on ? 1 : 0, by: (S().settings.nickname || '') });
  }
  function isSkipped(date, itemId) {
    return !!Engine.isSkipped(date, itemId);
  }

  /* ---------- 连续保护券 ---------- */
  /* 每月发 1 张（最多囤 2 张）；昨天有漏打卡时自动消耗一张保住连续 */
  function reconcile() {
    const st = S();
    st.freezes = st.freezes || {};
    if (st.settings.freezeLeft == null) st.settings.freezeLeft = 1;
    const month = T().slice(0, 7);
    if (st.settings.freezeMonth !== month) {
      const first = st.settings.freezeMonth == null;
      st.settings.freezeMonth = month;
      if (!first) st.settings.freezeLeft = Math.min(2, (st.settings.freezeLeft || 0) + 1);
    }
    const y = U.shiftYmd(T(), -1);
    if (!st.freezes[y] && st.settings.freezeLeft > 0 && yesterdayHadMiss()) {
      st.freezes[y] = 1;
      st.settings.freezeLeft--;
      Store.commit();
      return { used: true, date: y, left: st.settings.freezeLeft };
    }
    Store.save();
    return { used: false, left: st.settings.freezeLeft };
  }
  function yesterdayHadMiss() {
    const y = U.shiftYmd(T(), -1);
    const list = Engine.items();
    if (!list.some(it => U.ymd(new Date(it.createdAt || Date.now())) <= y)) return false;
    /* v49：休息日不算「漏」—— 那是计划内的休息，不该自动替用户花掉一张补卡券
     * v51：部分完成也不算 —— 做了 20/30 分钟的人不该被自动扣券，那正是他最难受的时候 */
    return list.some(it => Engine.isDue(it, y) && !Engine.isDone(it, y) && !isSkipped(y, it.id) &&
      !Engine.isRestDay(it, y) && !Engine.isPartial(it, y));
  }
  function freezeInfo() {
    const st = S();
    return {
      left: st.settings.freezeLeft == null ? 1 : st.settings.freezeLeft,
      usedDates: Object.keys(st.freezes || {}).sort().reverse().slice(0, 8)
    };
  }
  function useFreezeManual(date) {
    const st = S();
    if (st.settings.freezeLeft <= 0) return { ok: false, msg: '没有可用的保护券了，每月 1 号会补一张' };
    st.freezes = st.freezes || {};
    if (st.freezes[date]) return { ok: false, msg: '这一天已经保护过了' };
    st.freezes[date] = 1; st.settings.freezeLeft--;
    Store.commit();
    return { ok: true, left: st.settings.freezeLeft };
  }

  /* 某个习惯在 date 这天为止、往回连续完成了多少天（请假不断链，与 streakOf 同口径） */
  function habitStreakEndingAt(it, date) {
    let n = 0, cur = date;
    const floor = Engine.bornOn(it) || date;
    for (let i = 0; i < 3650; i++) {
      if (cur < floor) break;
      if (Engine.isDue(it, cur)) {
        if (Engine.isDone(it, cur)) n++;
        else if (isSkipped(cur, it.id)) { /* 请假：不断链 */ }
        else break;
      }
      cur = U.shiftYmd(cur, -1);
    }
    return n;
  }

  /* ---------- 连续记录中断检测 ----------
   * 昨天（或最近一个应打卡日）有漏、且没被保护券覆盖 → 连续记录已断，
   * 此时给用户两条路：用补卡券接上 / 直接去补录那天。
   *
   * 注意：顶部那颗「🔥 N 天」是全站口径（每天至少完成一个习惯），
   * 和「某几个习惯自己的连续断了」不是一回事。如果这里只笼统写「连续记录中断」，
   * 就会出现「顶部说连续 24 天、卡片说连续中断」的自相矛盾。所以额外算出
   * broke：真正被打断（此前 ≥2 天）的那几个习惯，文案精确到习惯名。 */
  function breakInfo() {
    const st = S();
    const list = Engine.items();
    if (!list.length) return null;
    const y = U.shiftYmd(T(), -1);
    const earliest = list.map(it => U.ymd(new Date(it.createdAt || Date.now()))).sort()[0];
    if (y < earliest) return null;                       // 还没有"昨天"可查
    /* v28 · 4.2：修复窗口是 48 小时 —— 昨天已经接上（保护券 / 修复）时，
     * 不能就此收工，还得再看前天：否则「昨天刚好被券保住、前天漏了」的人
     * 永远看不到修复入口。每个候选日单独判「是否已接上 / 是否已忽略」。 */
    let day = null, missed = [];
    const cands = [y, U.shiftYmd(T(), -2)];
    for (let i = 0; i < cands.length; i++) {
      const cand = cands[i];
      if (cand < earliest) continue;
      if ((st.freezes || {})[cand]) continue;            // 这天已经接上了，不算断
      if (st.settings.breakDismiss === cand) continue;   // 用户忽略过这天
      const m = missedOn(cand);
      if (m.length) { day = cand; missed = m; break; }
    }
    if (!day) return null;
    // 中断前的连续天数：给一句"你之前连续了 N 天"（全站"全部完成"口径）
    let prev = 0, cur = day;
    for (let i = 0; i < 3650; i++) {
      const r = Engine.todayRate(cur);
      if (r.total > 0 && r.pct === 100) { prev++; cur = U.shiftYmd(cur, -1); } else break;
    }
    /* 真正被这次漏卡打断的习惯：此前至少连续 2 天才值得单独点名，
     * 只漏过一天的不算"断了"，避免小题大做。 */
    const broke = missed.map(it => ({ name: it.name, prev: habitStreakEndingAt(it, U.shiftYmd(day, -1)), unit: Engine.streakUnit(it) }))
      .filter(x => x.prev >= 2)
      .sort((a, b) => b.prev - a.prev);
    return {
      date: day,
      isYesterday: day === y,
      names: missed.map(it => it.name),
      count: missed.length,
      freezeLeft: st.settings.freezeLeft == null ? 1 : st.settings.freezeLeft,
      prevStreak: prev,
      broke: broke,
      repair: repairState(day)
    };
  }

  /* ---------- 断签修复（v28 · 4.2，对标 Duolingo 的 Streak Repair）----------
   * Duolingo 给两层网：事前的 Freeze（要提前买）+ 事后的 Repair（忘了买还能救）。
   * 我们已经有前者（每月发券、昨天漏了自动用一张），这里补后者：
   * 48 小时内、每月限一次、代价可见（一张券，没券就 30 积分）。
   * 限次和代价是必须的 —— 无限修复等于连胜贬值，用户自己也不信那个数字了。 */
  const REPAIR_PTS = 30;
  function repairState(date) {
    const st = S();
    const month = T().slice(0, 7);
    const usedThisMonth = st.settings.repairMonth === month;
    const left = st.settings.freezeLeft == null ? 1 : st.settings.freezeLeft;
    const pts = Engine.points();
    if (usedThisMonth) return { ok: false, reason: '本月已经修过一次了，下个月 1 号再来', cost: 0, usedThisMonth: true };
    if (!date) return { ok: false, reason: '没有可修复的日子', cost: 0, usedThisMonth: false };
    if (U.shiftYmd(T(), -2) > date) return { ok: false, reason: '超过 48 小时了，修不了', cost: 0, usedThisMonth: false };
    if (left > 0) return { ok: true, via: 'freeze', cost: 0, left: left, usedThisMonth: false };
    if (pts >= REPAIR_PTS) return { ok: true, via: 'points', cost: REPAIR_PTS, pts: pts, usedThisMonth: false };
    return { ok: false, reason: '需要 1 张保护券或 ' + REPAIR_PTS + ' 积分，现在都不够', cost: REPAIR_PTS, usedThisMonth: false };
  }
  function repair(date) {
    const st = S();
    const d = date || (breakInfo() || {}).date;
    const s = repairState(d);
    if (!s.ok) return { ok: false, msg: s.reason };
    st.freezes = st.freezes || {};
    if (st.freezes[d]) return { ok: false, msg: '这一天已经接上了' };
    if (s.via === 'freeze') st.settings.freezeLeft = Math.max(0, (st.settings.freezeLeft || 1) - 1);
    else st.settings.seedPts = Math.max(0, (st.settings.seedPts || 0) - REPAIR_PTS);
    st.freezes[d] = 1;
    st.settings.repairMonth = T().slice(0, 7);
    Engine.bustCache();
    Store.commit();
    return { ok: true, via: s.via, date: d };
  }

  /* ---------- 最小版本（v28 · 4.4）----------
   * 数据落在 logs[date][itemId].mini 上，判断口径在 Engine（isDone 认它、progress 打五折）。
   * 这里只补两件上层要用的：给习惯配一句 mini 文案、统计一段时间的轻量次数。 */
  function setMiniLabel(itemId, text) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return '';
    const v = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 30);
    Store.commit(() => { it.mini = v; it.updatedAt = Date.now(); });
    return v;
  }
  function miniStats(days, endYmd) {
    const end = endYmd || T();
    const n = Math.max(1, days || 7);
    let mini = 0, full = 0, miniDays = 0;
    for (let i = 0; i < n; i++) {
      const d = U.shiftYmd(end, -i);
      let dayMini = 0;
      Engine.items().forEach(it => {
        if (!Engine.isDue(it, d) || isSkipped(d, it.id)) return;
        if (!Engine.isDone(it, d)) return;
        if (Engine.isMiniDone(it, d)) { mini++; dayMini++; } else full++;
      });
      if (dayMini) miniDays++;
    }
    return { mini: mini, full: full, miniDays: miniDays, days: n };
  }
  function dismissBreak(date) {
    const st = S();
    st.settings.breakDismiss = date || U.shiftYmd(T(), -1);
    Store.save();
  }

  /* ---------- 习惯强度分（Loop Score）：0–100，越稳定越高 ----------
   * 指数移动平均衰减很快（0.93^240 ≈ 0），所以只回看 240 天，
   * 结果与回看 1200 天完全一致，但循环量减少 80%。再叠加记忆化缓存。 */
  const SCORE_WINDOW = 240;
  function scoreOf(itemId) {
    return Engine.memo('score:' + itemId, () => scoreOfRaw(itemId));
  }
  function scoreOfRaw(itemId) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return 0;
    /* 戒断型走独立模型（v27）：分数 = 连续未破戒天数映射到 0–100，破戒即重置。
     * 用 cs/(cs+K) 而不是线性：头几天涨得快（给正反馈），越往后越平（不虚高）。
     * K=8 时：7 天 47 分、30 天 79 分、90 天 92 分。
     * 注意这里不能用 EMA —— EMA 把「破戒」和「漏打」算成同一件事，
     * 而戒断型的失败只有一种：破戒。 */
    if (Engine.isAvoid(it)) {
      const cs = Engine.cleanStreakOf(itemId, T());
      return Math.round(100 * cs / (cs + 8) * 10) / 10;
    }
    const a = 0.07;                       // 衰减系数：约两周半衰一半
    const end = T();
    let cur = U.ymd(new Date(it.createdAt || Date.now()));
    const floor = U.shiftYmd(end, -(SCORE_WINDOW - 1));
    if (cur < floor) cur = floor;         // 更早的记录对 EMA 已无贡献
    let s = 0;
    for (let i = 0; i < SCORE_WINDOW && cur <= end; i++) {
      if (Engine.isDue(it, cur) && !isSkipped(cur, it.id)) {
        const p = Engine.progress(it, cur);
        if (cur === end && p === 0) { cur = U.shiftYmd(cur, 1); continue; }  // 今天还没打卡不扣分
        s = s + a * (100 * U.clamp(p, 0, 1) - s);
      }
      cur = U.shiftYmd(cur, 1);
    }
    return Math.round(s * 10) / 10;
  }
  /* kind='avoid' 时用暖色：这类习惯的「好」不是绿色的安全感，而是「还没破戒」的警觉 */
  function scoreLevel(sc, kind) {
    if (kind === 'avoid') {
      return sc >= 80 ? { txt: '稳住了', color: 'var(--warn)' }
        : sc >= 50 ? { txt: '守得住', color: 'var(--warn)' }
          : sc >= 25 ? { txt: '有反复', color: 'var(--danger)' }
            : { txt: '刚重置', color: 'var(--danger)' };
    }
    return sc >= 80 ? { txt: '牢固', color: 'var(--ok)' }
      : sc >= 50 ? { txt: '稳固', color: 'var(--accent)' }
        : sc >= 25 ? { txt: '养成中', color: 'var(--warn,#e0a020)' }
          : { txt: '起步期', color: 'var(--txt-3)' };
  }

  /* ---------- 强度历史（v27 · 4.2）----------
   * 详情页要一条 90 天强度曲线，让用户看见「它是怎么变的」。
   * 逐日往前推进一次即可，不要每个点都重算 scoreOf（那是 90 × 240 次循环）。
   * 返回 [{date, pct}]，直接喂给 Chart.line。 */
  function scoreSeries(itemId, days) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return [];
    const n = Math.max(2, days || 90);
    const end = T();
    const out = [];
    let cur = U.shiftYmd(end, -(n - 1));
    const floor = Engine.bornOn(it) || U.ymd(new Date(it.createdAt || Date.now()));
    if (cur < floor) cur = floor;
    if (Engine.isAvoid(it)) {
      /* 先把「连续未破戒」滚到窗口起点，再逐日推进 */
      let cs = 0;
      let pre = U.shiftYmd(cur, -1);
      for (let i = 0; i < 3650 && pre >= floor; i++) {
        if (Engine.isDue(it, pre) && !isSkipped(pre, itemId)) {
          if (Engine.slipped(it, pre)) cs = 0; else cs++;
        }
        pre = U.shiftYmd(pre, -1);
      }
      for (let i = 0; i < n + 400 && cur <= end; i++) {
        if (Engine.isDue(it, cur) && !isSkipped(cur, itemId)) {
          if (Engine.slipped(it, cur)) cs = 0; else cs++;
        }
        out.push({ date: cur, pct: Math.round(100 * cs / (cs + 8)) });
        cur = U.shiftYmd(cur, 1);
      }
      return out.slice(-n);
    }
    /* 打卡型：与 scoreOf 同一套 EMA，先预热 240 天再取窗口 */
    const a = 0.07;
    let s = 0;
    let warm = U.shiftYmd(cur, -SCORE_WINDOW);
    if (warm < floor) warm = floor;
    for (let i = 0; i < 3650 && warm < cur; i++) {
      if (Engine.isDue(it, warm) && !isSkipped(warm, itemId)) {
        s = s + a * (100 * U.clamp(Engine.progress(it, warm), 0, 1) - s);
      }
      warm = U.shiftYmd(warm, 1);
    }
    for (let i = 0; i < n + 400 && cur <= end; i++) {
      if (Engine.isDue(it, cur) && !isSkipped(cur, itemId)) {
        const p = Engine.progress(it, cur);
        if (!(cur === end && p === 0)) s = s + a * (100 * p - s);   // 今天还没打卡不扣分
      }
      out.push({ date: cur, pct: Math.round(s) });
      cur = U.shiftYmd(cur, 1);
    }
    return out.slice(-n);
  }


  /* ---------- 单习惯详情 ---------- */
  function rateOf(it, n) {
    const end = T();
    let cur = U.shiftYmd(end, -(n - 1)), d = 0, t = 0;
    for (let i = 0; i < n; i++) {
      if (cur > end) break;
      if (Engine.isDue(it, cur) && !isSkipped(cur, it.id)) { t++; if (Engine.isDone(it, cur)) d++; }
      cur = U.shiftYmd(cur, 1);
    }
    return { pct: t ? Math.round(d / t * 100) : 0, done: d, total: t };
  }
  function habitDetail(id) {
    const it = (S().items || []).find(x => x.id === id);
    if (!it) return null;
    const end = T();
    let cur = U.ymd(new Date(it.createdAt || Date.now()));
    const days = [];
    for (let i = 0; i < 1200 && cur <= end; i++) {
      const due = Engine.isDue(it, cur) && !isSkipped(cur, it.id);
      days.push({ date: cur, due: due, done: Engine.isDone(it, cur), sk: isSkipped(cur, it.id), v: (Engine.getLog(cur, it.id) || {}).v || 0 });
      cur = U.shiftYmd(cur, 1);
    }
    const dueDays = days.filter(d => d.due);
    const wd = [0, 0, 0, 0, 0, 0, 0], wdDue = [0, 0, 0, 0, 0, 0, 0];
    days.forEach(d => { const k = U.weekdayOf(d.date); if (d.due) { wdDue[k]++; if (d.done) wd[k]++; } });
    let val = 0;
    days.forEach(d => { val += d.v || 0; });
    return {
      item: it, score: scoreOf(id),
      streak: Engine.streakOf(id, end), best: Engine.bestStreak(id),
      totalDone: days.filter(d => d.done).length, dueCount: dueDays.length,
      rate30: rateOf(it, 30), rateAll: rateOf(it, 1200),
      kind: Engine.isAvoid(it) ? 'avoid' : (it.type === 'check' ? 'check' : 'number'),
      avoid: Engine.avoidSummary(id, 30),
      weekday: wd, weekdayDue: wdDue, totalVal: Math.round(val * 100) / 100,
      calendar: days.slice(-70), last7: days.slice(-7)
    };
  }

  /* ---------- 年度热力图（GitHub 贡献图那种） ----------
   * 一个习惯一张：53 列 × 7 行，一列是一周，行是周日…周六。
   * 深浅 = 当天完成程度；数值型习惯按「目标达成比例」决定深浅，不是非黑即白。 */
  function yearGrid(itemId, days) {
    return Engine.memo('yg:' + itemId + ':' + (days || 365), () => yearGridRaw(itemId, days));
  }
  function yearGridRaw(itemId, days) {
    const heat = Engine.itemHeat(itemId, days || 365);
    if (!heat.length) return null;
    const pad = U.weekdayIdx(heat[0].date);       // 按「一周起始日」补齐第一行
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push(null);
    heat.forEach(h => cells.push(h));
    while (cells.length % 7) cells.push(null);
    const weeks = cells.length / 7;
    const months = [];
    let lastM = -1;
    for (let w = 0; w < weeks; w++) {
      const c = cells[w * 7];
      if (!c) continue;
      const m = +c.date.slice(5, 7);
      if (m !== lastM) { months.push({ col: w, label: m + '月' }); lastM = m; }
    }
    let done = 0, due = 0;
    heat.forEach(h => { if (h.due) { due++; if (h.done) done++; } });
    return {
      cells: cells, weeks: weeks, months: months, days: heat,
      done: done, due: due, pct: due ? Math.round(done / due * 100) : 0
    };
  }

  /* 本周 7 个圆点：一眼看出这周哪几天掉了 */
  function weekDots(itemId) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return [];
    const today = T();
    const back = U.weekdayIdx(today);            // 按「一周起始日」回退到本周第一天
    const mon = U.shiftYmd(today, -back);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = U.shiftYmd(mon, i);
      const born = Engine.isAlive(it, d);
      const due = born && Engine.isDue(it, d);
      const sk = isSkipped(d, itemId);
      const st2 = !born ? 'none' : d > today ? 'future' : sk ? 'skip' : !due ? 'rest' : Engine.isDone(it, d) ? 'done' : 'miss';
      out.push({ date: d, wd: i, state: st2, v: (Engine.getLog(d, itemId) || {}).v || 0, today: d === today });
    }
    return out;
  }

  /* ---------- 里程碑 ---------- */
  /* 连击里程碑：和 main.js 的 CELEBRATE_DAYS 保持同一串数字（走查第 6 条要求
   * 「每个里程碑只庆祝一次并记入徽章」）—— 庆祝哪几档，墙上就画哪几档。
   * 365 是终局档，只在墙上陈列，不参与庆祝弹窗。 */
  const MILESTONES = [
    { n: 3, name: '三日起步', icon: 'sprout', emoji: '🌱' },
    { n: 7, name: '七日不断', icon: 'fire', emoji: '🔥' },
    { n: 14, name: '两周坚持', icon: 'lightning', emoji: '⚡' },
    { n: 21, name: '21 天定律', icon: 'lightning', emoji: '🧠' },
    { n: 30, name: '整月不断', icon: 'calendar-dots', emoji: '📅' },
    { n: 50, name: '五十天', icon: 'trophy', emoji: '🏔' },
    { n: 100, name: '百日传说', icon: 'medal', emoji: '👑' },
    { n: 365, name: '日拱一卒', icon: 'house', emoji: '🏛' }
  ];
  /* 单个习惯：当前处在哪个里程碑区间，离下一个还差多少 */
  function milestoneOf(it, bestOverride) {
    /* 戒断型传「历史最佳未破戒天数」进来 —— 它的纪录口径和打卡型不同 */
    const best = Number.isFinite(bestOverride) ? bestOverride : Engine.bestStreak(it.id);
    const unit = Engine.streakUnit(it);
    let next = null;
    for (let i = 0; i < MILESTONES.length; i++) { if (MILESTONES[i].n > best) { next = MILESTONES[i]; break; } }
    let prev = null;
    MILESTONES.forEach(m => { if (m.n <= best) prev = m; });
    const need = next ? next.n - best : 0;
    return { best: best, unit: unit, next: next, prev: prev, need: need, pct: next ? Math.round(best / next.n * 100) : 100 };
  }
  /* 全站：每个里程碑解锁了没有（用于「连击里程碑」这一栏）。
   * 画的是「全站连续」到过哪几档 —— 和打卡时弹的庆祝（走查第 6 条）用的是同一把尺子
   * （Engine.globalStreak），避免「弹了 7 天庆祝、墙上 7 还锁着」的自相矛盾。
   * celebrated 记的是已经跨过（且已庆祝过）的档；best 取「当前连击」与「历史最高跨过档」的较大者，
   * 断过再续也不会把纪录抹掉。365 是终局档，只在墙上陈列、不参与庆祝弹窗。 */
  function milestones() {
    const st = S();
    const celebrated = (st.settings && st.settings.celebrated) || [];
    const best = Math.max(Engine.globalStreak(), celebrated.length ? Math.max.apply(null, celebrated) : 0);
    return MILESTONES.map(x => Object.assign({}, x, {
      got: celebrated.indexOf(x.n) >= 0 || best >= x.n,
      cur: Math.min(best, x.n)
    }));
  }

  /* 全站连击在「某天」是多少（用来算周报里的连击变化） */
  function globalStreakAt(date) {
    /* 与 Engine.globalStreak 同口径：保护券覆盖的日子也算没断。
     * 断签预警、周报的「连击变化」都读这个数，两边必须一致。 */
    const fz = S().freezes || {};
    let n = 0, cur = date;
    for (let i = 0; i < 3650; i++) {
      if (Engine.todayRate(cur).done > 0 || !!fz[cur] || Engine.isGlobalRestDay(cur)) n++; else break;
      cur = U.shiftYmd(cur, -1);
    }
    return n;
  }
  function streakDelta() {
    const now = Engine.globalStreak();
    const before = globalStreakAt(U.shiftYmd(T(), -7));
    return { now: now, before: before, delta: now - before };
  }

  /* 周报卡片的数据：最高 / 最低 / 总次数 / 连击变化 */
  function weekCard() {
    return Engine.memo('wcard', () => weekCardRaw());
  }
  function weekCardRaw() {
    const rv = review('week');
    const items = rv.items || [];
    const sd = streakDelta();
    const start = U.shiftYmd(T(), -6);
    const end = T();
    return {
      range: U.prettyDate(start) + ' – ' + U.prettyDate(end),
      pct: rv.pct, prevPct: rv.prevPct, done: rv.done, total: rv.total,
      best: items[0] || null,
      worst: items.length ? items[items.length - 1] : null,
      top3: items.slice(0, 3),
      streak: sd,
      checkins: rv.done,
      bullets: rv.bullets
    };
  }

  /* ---------- 指标 & 成就 ---------- */
  function metrics() {
    return Engine.memo('metrics', () => metricsRaw());
  }
  function metricsRaw() {
    const st = S();
    let totalDone = 0, early = 0, owl = 0;
    Object.keys(st.logs || {}).forEach(d => {
      Object.values(st.logs[d] || {}).forEach(lg => {
        if (lg.d) {
          totalDone++;
          const hh = new Date(lg.t || Date.now()).getHours();
          if (hh < 8) early++;
          if (hh >= 22) owl++;
        }
      });
    });
    let bestAny = 0;
    Engine.items().forEach(it => { bestAny = Math.max(bestAny, Engine.bestStreak(it.id)); });
    let perfectRun = 0, cur = T();
    if (Engine.todayRate(cur).pct < 100) cur = U.shiftYmd(cur, -1);
    for (let i = 0; i < 365; i++) {          // 一年足够，"完美一周/一月"成就用不到更久
      const r = Engine.todayRate(cur);
      if (r.total > 0 && r.pct === 100) perfectRun++; else break;
      cur = U.shiftYmd(cur, -1);
    }
    let photos = 0, notes = 0;
    Object.values(st.notes || {}).forEach(n => {
      photos += (n.photos || []).length;
      if ((n.text || '').trim()) notes++;
    });
    return {
      totalDone: totalDone, early: early, owl: owl, bestAny: bestAny,
      perfectRun: perfectRun, photos: photos, notes: notes,
      freezeUsed: Object.keys(st.freezes || {}).length,
      inRoom: window.Rooms ? Rooms.myRooms().length : 0
    };
  }

  const BADGES = [
    { id: 'first', icon: 'sparkle', emoji: '🎉', name: '第一步', desc: '完成第一次打卡', test: m => m.totalDone >= 1 },
    { id: 'd10', icon: 'sprout', emoji: '🌱', name: '十日之约', desc: '累计打卡 10 次', test: m => m.totalDone >= 10 },
    { id: 'd100', icon: 'chart-bar', emoji: '💪', name: '百次成习', desc: '累计打卡 100 次', test: m => m.totalDone >= 100 },
    { id: 'd500', icon: 'chart-line', emoji: '🏅', name: '习惯大师', desc: '累计打卡 500 次', test: m => m.totalDone >= 500 },
    { id: 's7', icon: 'fire', emoji: '🔥', name: '七日不断', desc: '任一习惯连续 7 天', test: m => m.bestAny >= 7 },
    { id: 's21', icon: 'lightning', emoji: '🧠', name: '21 天定律', desc: '任一习惯连续 21 天', test: m => m.bestAny >= 21 },
    { id: 's30', icon: 'calendar-dots', emoji: '📅', name: '整月不断', desc: '任一习惯连续 30 天', test: m => m.bestAny >= 30 },
    { id: 's100', icon: 'medal', emoji: '👑', name: '百日传说', desc: '任一习惯连续 100 天', test: m => m.bestAny >= 100 },
    { id: 's365', icon: 'house', emoji: '🏛', name: '日拱一卒', desc: '任一习惯连续 365 天', test: m => m.bestAny >= 365 },
    { id: 'pw7', icon: 'star', emoji: '⭐', name: '完美一周', desc: '连续 7 天全部完成', test: m => m.perfectRun >= 7 },
    { id: 'pw30', icon: 'trophy', emoji: '🏆', name: '完美一月', desc: '连续 30 天全部完成', test: m => m.perfectRun >= 30 },
    { id: 'early', icon: 'sun', emoji: '🌅', name: '早起鸟', desc: '8 点前打卡 10 次', test: m => m.early >= 10 },
    { id: 'owl', icon: 'moon', emoji: '🌙', name: '夜猫子', desc: '22 点后打卡 10 次', test: m => m.owl >= 10 },
    { id: 'photo', icon: 'image', emoji: '📸', name: '记录者', desc: '留下 10 张照片', test: m => m.photos >= 10 },
    { id: 'note', icon: 'notebook', emoji: '📝', name: '笔耕不辍', desc: '写下 20 篇笔记', test: m => m.notes >= 20 },
    { id: 'room', icon: 'users', emoji: '🏠', name: '不孤单', desc: '加入一个房间', test: m => m.inRoom >= 1 },
    { id: 'freeze', icon: 'snowflake', emoji: '🧊', name: '有备无患', desc: '用掉一张保护券', test: m => m.freezeUsed >= 1 }
  ];
  /* 未解锁的徽章也该让人看到「差多少」，否则徽章墙只是一堆灰图标 */
  const BADGE_GOAL = {
    first: ['totalDone', 1], d10: ['totalDone', 10], d100: ['totalDone', 100], d500: ['totalDone', 500],
    s7: ['bestAny', 7], s21: ['bestAny', 21], s30: ['bestAny', 30], s100: ['bestAny', 100], s365: ['bestAny', 365],
    pw7: ['perfectRun', 7], pw30: ['perfectRun', 30],
    early: ['early', 10], owl: ['owl', 10], photo: ['photos', 10], note: ['notes', 20],
    room: ['inRoom', 1], freeze: ['freezeUsed', 1]
  };
  function badgeProgress(m, b) {
    const g = BADGE_GOAL[b.id];
    if (!g) return null;
    const cur = Math.min(m[g[0]] || 0, g[1]);
    return { cur: m[g[0]] || 0, need: g[1], pct: g[1] ? Math.round(cur / g[1] * 100) : 0 };
  }
  function checkAchievements() {
    const m = metrics();
    const st = S();
    st.achievements = st.achievements || {};
    const news = [];
    BADGES.forEach(b => {
      if (!st.achievements[b.id] && b.test(m)) { st.achievements[b.id] = Date.now(); news.push(b); }
    });
    if (news.length) Store.commit();
    return news;
  }
  function badges() {
    const got = S().achievements || {};
    return BADGES.map(b => Object.assign({}, b, { got: !!got[b.id], at: got[b.id] || 0 }));
  }

  /* ---------- 周期回顾 ---------- */
  function bestWeekday(s, e) {
    let cur = s, done = [0, 0, 0, 0, 0, 0, 0], all = [0, 0, 0, 0, 0, 0, 0];
    while (cur <= e) {
      const r = Engine.todayRate(cur), k = U.weekdayOf(cur);
      all[k] += r.total; done[k] += r.done;
      cur = U.shiftYmd(cur, 1);
    }
    let bi = -1, bv = -1;
    for (let i = 0; i < 7; i++) { const v = all[i] ? done[i] / all[i] : 0; if (all[i] > 0 && v > bv) { bv = v; bi = i; } }
    return bi < 0 ? null : { wd: bi, pct: Math.round(bv * 100) };
  }
  function review(kind) {
    return Engine.memo('review:' + kind, () => reviewRaw(kind));
  }
  /* kind: 'week' | 'month'；endYmd/label/prevLabel 供「上周周报」复用同一套统计口径 */
  function reviewRaw(kind, endYmd, label, prevLabel) {
    const end = endYmd || T();
    const len = kind === 'week' ? 7 : 30;
    const start = U.shiftYmd(end, -(len - 1));
    let cur = start, d = 0, t = 0;
    while (cur <= end) { const r = Engine.todayRate(cur); d += r.done; t += r.total; cur = U.shiftYmd(cur, 1); }
    let ps = U.shiftYmd(start, -len), pd = 0, pt = 0;
    for (let i = 0; i < len; i++) { const r = Engine.todayRate(ps); pd += r.done; pt += r.total; ps = U.shiftYmd(ps, 1); }
    const pct = t ? Math.round(d / t * 100) : 0;
    const prevPct = pt ? Math.round(pd / pt * 100) : 0;
    const items = Engine.items().map(it => {
      let a = 0, b = 0, c = start;
      while (c <= end) { if (Engine.isDue(it, c) && !isSkipped(c, it.id)) { b++; if (Engine.isDone(it, c)) a++; } c = U.shiftYmd(c, 1); }
      return { name: it.name, pct: b ? Math.round(a / b * 100) : 0, done: a, total: b, score: scoreOf(it.id) };
    }).filter(x => x.total > 0).sort((x, y) => y.pct - x.pct);
    const bw = bestWeekday(start, end);
    const lb = label || (kind === 'week' ? '本周' : '近 30 天');
    const pv = prevLabel || (kind === 'week' ? '上周' : '上一个 30 天');
    const bullets = [];
    bullets.push(lb + '共完成 ' + d + ' / ' + t + ' 次，完成率 ' + pct + '%');
    if (pt > 0) bullets.push(pct >= prevPct ? ('比' + pv + '提升 ' + (pct - prevPct) + ' 个百分点') : ('比' + pv + '下降 ' + (prevPct - pct) + ' 个百分点'));
    if (items.length) bullets.push('最稳的是「' + items[0].name + '」' + items[0].pct + '%');
    const weak = items.slice().sort((x, y) => y.pct - x.pct).pop();
    if (weak && weak.pct < 100) bullets.push('最容易掉链子的是「' + weak.name + '」' + weak.pct + '%，明天优先搞定它');
    bullets.push('全站连续 ' + Engine.globalStreak() + ' 天' + (bw ? '，' + '周' + '日一二三四五六'[bw.wd] + '表现最好（' + bw.pct + '%）' : ''));
    if (items.length) {
      const strong = items.slice().sort((x, y) => y.score - x.score)[0];
      bullets.push('习惯强度最高的是「' + strong.name + '」，强度 ' + strong.score + ' 分');
    }
    /* v28 · 4.4：轻量完成要能在周报里被看见，否则「做了一点」和「什么都没做」在复盘时没区别，
     * 用户下次就不会再选最小版本了。 */
    const ms = miniStats(len, end);
    if (ms.mini) bullets.push('其中 ' + ms.mini + ' 次是轻量完成（只做了最小版本），照样算数');
    return { kind: kind, label: lb, pct: pct, prevPct: prevPct, done: d, total: t, items: items, bullets: bullets, mini: ms, text: bullets.join('\n') };
  }

  /* ---------- v20 · 上周周报 ----------
   * 自然周口径（按「一周起始日」切分，默认周一），区间固定为上一个完整周，
   * 与「上周」= reviewRaw 的 prevPct、和「近 12 周趋势」的倒数第二桶对得上。
   * 复用 reviewRaw 的整套统计（请假不进分母、bestWeekday、强度分），只是换区间和文案，
   * 所以周报卡和既有页面永远同一个口径。纯本地计算，不发任何网络请求。
   * v42 · 走查第 12 条：起始日改成用户设置（默认周一），周日开工的人不再对不上。 */
  function lastWeekReport() {
    const thisStart = U.weekStartOf(T());
    const lastEnd = U.shiftYmd(thisStart, -1);
    return reviewRaw('week', lastEnd, '上周', '上上周');
  }

  /* ---------- 自然月报告 ----------
   * 已有「本周回顾」和「年度回顾」，中间正好缺最有仪式感的一格：这个月到底怎么样。
   * 口径与 Engine.todayRate 完全一致（请假不进分母），环比对象是上一个自然月。 */
  function monthReport(ym) {
    return Engine.memo('mrep:' + ym, () => monthReportRaw(ym));
  }
  function monthSpan(ym) {
    const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
    const dim = new Date(y, m + 1, 0).getDate();
    return { start: ym + '-01', end: ym + '-' + String(dim).padStart(2, '0') };
  }
  function monthPct(ym) {
    const sp = monthSpan(ym);
    let d = 0, t = 0, cur = sp.start;
    while (cur <= sp.end) { const r = Engine.todayRate(cur); d += r.done; t += r.total; cur = U.shiftYmd(cur, 1); }
    return { done: d, total: t, pct: t ? Math.round(d / t * 100) : 0 };
  }
  function monthReportRaw(ym) {
    ym = ym || T().slice(0, 7);
    const sp = monthSpan(ym);
    const today = T();
    let d = 0, t = 0, active = 0, days = 0, run = 0, bestRun = 0;
    const per = {};
    const cells = [];
    const pad = U.weekdayIdx(sp.start);           // 月历第一行前空几格，按一周起始日
    for (let i = 0; i < pad; i++) cells.push(null);
    let cur = sp.start;
    while (cur <= sp.end) {
      const future = cur > today;
      const r = future ? { pct: 0, done: 0, total: 0 } : Engine.todayRate(cur);
      cells.push({ date: cur, pct: r.pct, done: r.done, total: r.total, future: future, today: cur === today });
      if (!future) {
        days++; d += r.done; t += r.total;
        if (r.done > 0) { active++; run++; if (run > bestRun) bestRun = run; } else run = 0;
        Engine.items().forEach(it => {
          if (!Engine.isDue(it, cur) || isSkipped(cur, it.id)) return;
          per[it.id] = per[it.id] || { name: it.name, color: it.color, done: 0, total: 0 };
          per[it.id].total++;
          if (Engine.isDone(it, cur)) per[it.id].done++;
        });
      }
      cur = U.shiftYmd(cur, 1);
    }
    while (cells.length % 7) cells.push(null);
    const list = Object.values(per)
      .map(v => ({ name: v.name, color: v.color, pct: v.total ? Math.round(v.done / v.total * 100) : 0, done: v.done, total: v.total }))
      .filter(x => x.total > 0).sort((a, b) => b.pct - a.pct || b.done - a.done);
    const pm = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1);
    const pym = U.ymd(pm).slice(0, 7);
    const prev = monthPct(pym);
    const pct = t ? Math.round(d / t * 100) : 0;
    return {
      ym: ym, label: (+ym.slice(0, 4)) + ' 年 ' + (+ym.slice(5, 7)) + ' 月',
      pct: pct, prevYm: pym, prevPct: prev.pct, hasPrev: prev.total > 0,
      done: d, total: t, active: active, days: days, bestRun: bestRun,
      best: list[0] || null, worst: list.length > 1 ? list[list.length - 1] : null,
      /* items 只给月报卡片展示前 3 名；list 是全部习惯，
         回顾页的「多习惯对比」图需要按名次排完所有习惯。 */
      list: list, items: list.slice(0, 3), cells: cells
    };
  }

  /* ---------- 补卡日历（某月） ---------- */
  function monthGrid(ym) {
    return Engine.memo('grid:' + ym, () => monthGridRaw(ym));
  }
  function monthGridRaw(ym) {
    const first = new Date(ym + '-01T00:00:00');
    const pad = U.weekdayIdx(U.ymd(first));       // 月历第一行前空几格，按一周起始日
    const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const today = T();
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push(null);
    for (let day = 1; day <= dim; day++) {
      const ds = ym + '-' + String(day).padStart(2, '0');
      const r = Engine.todayRate(ds);
      const future = ds > today;
      const lv = future || r.total === 0 ? 0 : r.pct === 0 ? 0 : r.pct < 40 ? 1 : r.pct < 70 ? 2 : r.pct < 100 ? 3 : 4;
      cells.push({ date: ds, day: day, pct: r.pct, done: r.done, total: r.total, level: lv, future: future, today: ds === today });
    }
    return cells;
  }
  /* 某天漏做的习惯（请假的不算漏 —— 与 breakInfo / todayRate 同口径） */
  function missedOn(date) {
    return Engine.items().filter(it => {
      const created = U.ymd(new Date(it.createdAt || Date.now()));
      /* v49：用掉休息额度的日子不算「漏了」—— 那是计划内的休息，不该弹中断卡
       * v51：部分完成也不算漏（做了大半个目标，不该被判成「昨天没做」） */
      return created <= date && Engine.isDue(it, date) && !Engine.isDone(it, date) && !isSkipped(date, it.id) &&
        !Engine.isRestDay(it, date) && !Engine.isPartial(it, date);
    });
  }

  return {
    skip: skip, isSkipped: isSkipped,
    reconcile: reconcile, freezeInfo: freezeInfo, useFreezeManual: useFreezeManual,
    breakInfo: breakInfo, dismissBreak: dismissBreak, repair: repair, repairState: repairState, REPAIR_PTS: REPAIR_PTS,
    setMiniLabel: setMiniLabel, miniStats: miniStats,
    scoreOf: scoreOf, scoreLevel: scoreLevel, scoreSeries: scoreSeries, habitDetail: habitDetail, rateOf: rateOf,
    checkAchievements: checkAchievements, badges: badges, badgeProgress: badgeProgress, metrics: metrics,
    review: review, monthGrid: monthGrid, monthReport: monthReport, missedOn: missedOn,
    yesterdayHadMiss: yesterdayHadMiss,
    lastWeekReport: lastWeekReport,
    yearGrid: yearGrid, weekDots: weekDots, milestoneOf: milestoneOf, milestones: milestones,
    MILESTONES: MILESTONES, streakDelta: streakDelta, weekCard: weekCard, globalStreakAt: globalStreakAt
  };
})();
