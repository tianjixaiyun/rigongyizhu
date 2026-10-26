/* ============ 提醒：让「提醒时间」真的会响 ============
 * 原来的实现只在页面打开时每 30 秒比对一次分钟，息屏 / 切后台就完全静音。
 * 这里做四件事：
 *  1) 通知走 Service Worker（PWA 后台也能弹），带「去打卡」按钮，点了直接完成
 *  2) 到点后有 90 分钟补发窗口（页面当时没开，回来也能收到）
 *  3) 睡前兜底检查：21:30 一次列出今天还没打卡的习惯
 *  4) 权限引导：没授权时给一条可关闭的引导卡，而不是默默不提醒
 */
window.Remind = (function () {
  var GRACE = 90;                 // 到点后多少分钟内仍补发
  var LS_FIRED = 'rgz.remind.fired';
  var LS_GUIDE = 'rgz.remind.guide';
  var LS_SNOOZE = 'rgz.remind.snooze';
  var _t = null;
  var SNOOZE_MIN = 30;            // 「稍后提醒」默认延后多少分钟
  /* v37 · 到点没打卡就再叫两次（第 1 次之后 40 分钟、90 分钟）。
   * 依据：市面横评里「提醒」是用户放弃的第一原因 —— 只响一次，人在开会/通勤，
   * 这一天的习惯就废了；滴答清单的「持续提醒」正是它被反复提到的差异点。
   * 只补两次是因为再多就成骚扰，而且 90 分钟后 GRACE 窗口也快关了。 */
  var REPEAT_MIN = [40, 90];
  /* 每轮补叫自己的补发窗口。不能沿用上面那个「距原定时间 90 分钟」——
   * 第三轮本来就排在原定时间 +90 分钟，用同一个上界等于只留 1 分钟窗口，几乎必然错过。 */
  var REPEAT_WINDOW = 60;
  /* 22:00 之后不再补叫：那已经不是「提醒」，是骚扰了。 */
  var QUIET_AT = 22 * 60;
  /* v38 · 报告 P1-10「提醒降噪」：同一件事 30 分钟内只占一个通知位。
   * 之前的问题：三个习惯同在 21:00 就是三条通知，接着断签预警一条、睡前汇总一条 ——
   * 一晚上五条，用户第一反应是把权限关掉，那后面所有提醒全废了。
   * 做法：① 同一轮到点的多个习惯合成一条；② 「今天还没做完」类共用一个 tag，
   * 后来的替换前面的，不堆叠；③ 30 分钟内已经响过就不再响第二声（静默替换内容）。 */
  var MERGE_MIN = 30;
  var LS_LAST = 'rgz.remind.last';
  var TAG_TODAY = 'rgz-today';
  function lastAt() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_LAST) || '{}');
      return o && o.d === U.today() ? (o.t || 0) : 0;
    } catch (e) { return 0; }
  }
  function markAt() { try { localStorage.setItem(LS_LAST, JSON.stringify({ d: U.today(), t: Date.now() })); } catch (e) { } }
  function withinMerge() { var t = lastAt(); return !!t && (Date.now() - t) < MERGE_MIN * 60000; }

  /* 用户点了通知上的「稍后」：把这条提醒推到 N 分钟后再发。
   * 存在 localStorage 里，这样即使中途刷新页面也不会立刻又弹一次。 */
  function snoozeMap() {
    try { return JSON.parse(localStorage.getItem(LS_SNOOZE) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveSnooze(m) { try { localStorage.setItem(LS_SNOOZE, JSON.stringify(m)); } catch (e) { } }
  function snoozedUntil(id) { var m = snoozeMap(); return m[id] || 0; }
  function snooze(id, min) {
    if (!id) return 0;
    var at = Date.now() + (min || SNOOZE_MIN) * 60000;
    var m = snoozeMap();
    /* 顺手清掉过期的，别让这个 map 无限长 */
    var now = Date.now();
    Object.keys(m).forEach(function (k) { if (m[k] < now) delete m[k]; });
    m[id] = at;
    saveSnooze(m);
    /* 从「今天已提醒」里摘掉，到点后才允许再发一次 */
    var o = fired();
    o.ids = o.ids.filter(function (x) { return x !== id; });
    /* 补叫计数也归零：用户主动说「等会儿」，就不该被当成「已经催过两次」 */
    if (o.reps) delete o.reps[id];
    try { localStorage.setItem(LS_FIRED, JSON.stringify(o)); } catch (e) { }
    return at;
  }

  function supported() { return 'Notification' in window; }
  function perm() { return supported() ? Notification.permission : 'unsupported'; }

  function hhmm(d) { d = d || new Date(); return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function toMin(s) { var p = String(s || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }

  function nightCfg() {
    var st = Store.s;
    if (!st.settings.remindNight) st.settings.remindNight = { on: true, at: '21:30' };
    return st.settings.remindNight;
  }
  /* 断签预警（v28 · 4.2）：当天结束前 3 小时，只在「有连续记录要断」时才响。
   * 与 21:30 的睡前汇总分工不同 —— 那条是「今天还有 N 项」，这条是「你连续 12 天，别断在今天」。
   * 两条都发会显得吵，所以这条发过之后当天不再发汇总。 */
  function nudgeCfg() {
    var st = Store.s;
    if (!st.settings.nudge) st.settings.nudge = { on: true, at: '21:00' };
    return st.settings.nudge;
  }
  /* 找出「今天再不做就要断」的最大连续。
   * 关键：连击算到**昨天**为止，不是今天 —— 今天还没打卡，streakOf(今天) 永远是 0，
   * 那这条预警就永远发不出去了。用户要看到的是「我已经连续 N 天，别在今天断」。 */
  function streakAtRisk(left) {
    var y = U.shiftYmd(U.today(), -1);
    var g = Engine.globalStreakAt ? Engine.globalStreakAt(y) : Engine.globalStreak();
    var best = { days: g, name: '' };
    left.forEach(function (it) {
      var s = Engine.streakOf(it.id, y);
      if (s > best.days) best = { days: s, name: it.name };
    });
    return best;
  }

  /* 预警内容（纯函数，便于验收）：到点了吗、有连续要断吗、还差几个。
   * 返回 null 表示「这会儿不该响」。 */
  function nudgePayload(minute) {
    var ng = nudgeCfg();
    if (!ng.on) return null;
    if (minute < toMin(ng.at || '21:00')) return null;
    var today = U.today();
    var left = Engine.items().filter(function (it) {
      return Engine.isDue(it, today) && !Engine.isDone(it, today) && !Engine.isSkipped(today, it.id);
    });
    if (!left.length) return null;
    var risk = streakAtRisk(left);
    if (risk.days < 2) return null;      /* 没有连续要保，就别拿这条当催命符 */
    return {
      title: '今天还差 ' + left.length + ' 个',
      body: (risk.name ? '「' + risk.name + '」连续 ' + risk.days + ' 天' : '连续 ' + risk.days + ' 天') +
        '，别断在今天 · 现在做还来得及',
      left: left.length, risk: risk
    };
  }
  /* ---------- 学会闭嘴（v50 · 对标 Habi 的 Smart Notifications）----------
   * 横评里「提醒」被骂得最狠的两条：一是半夜三点弹「你今天还没打卡」，
   * 二是**已经养成习惯之后还在天天催** —— 人都自动做了，提醒就成了纯噪音，
   * 最后用户把整个通知权限关掉，所有提醒一起陪葬。
   * 所以提醒要看这个习惯自己最近做得怎么样：
   *   近 14 天做到 ≥90%（且样本 ≥10 天）→ 已经长在身上了，不再提醒
   *   近 14 天做到 70–90%                 → 提醒一次就够，不再补叫
   *   其余                                → 正常提醒 + 两次补叫
   * 断签预警（21:00 那一条）不受影响：稳定的人到点还没做，恰恰是最该被叫一次的时候。
   * 用户随时可以用「还是提醒我」把它叫回来 —— 自动关掉的东西必须能手动开回来。 */
  var MATURE_DAYS = 14, MATURE_MIN = 10, MATURE_HI = 0.9, MATURE_MID = 0.7;
  function maturity(it) {
    var due = 0, ok = 0;
    for (var i = 1; i <= MATURE_DAYS; i++) {
      var d = U.shiftYmd(U.today(), -i);
      if (!Engine.isDue(it, d)) continue;
      if (Engine.isSkipped(d, it.id)) continue;
      due++;
      if (Engine.isDone(it, d)) ok++;
    }
    var rate = due ? ok / due : 0;
    var lv = 0;
    if (it && it.remindAlways) lv = 0;
    else if (due >= MATURE_MIN && rate >= MATURE_HI) lv = 2;
    else if (due >= MATURE_MIN && rate >= MATURE_MID) lv = 1;
    return {
      level: lv, due: due, ok: ok, rate: rate, forced: !!it.remindAlways,
      text: lv === 2 ? ('近 14 天做到了 ' + ok + '/' + due + '，提醒先闭嘴了 —— 断签那天晚上还会叫你一次')
        : lv === 1 ? ('近 14 天做到了 ' + ok + '/' + due + '，只提醒一次，不再补叫')
          : ''
    };
  }
  /* 这个习惯这会儿该不该响（level 2 = 完全闭嘴） */
  function quietFor(it) { try { return maturity(it).level >= 2; } catch (e) { return false; } }
  /* 允许补叫几次（level 1 = 一次就够） */
  function maxReps(it) { try { return maturity(it).level >= 1 ? 0 : REPEAT_MIN.length; } catch (e) { return REPEAT_MIN.length; } }

  /* 写日记提醒：只在「这天打了卡但还没写」时响一次，空日子不打扰 */
  function diaryCfg() {
    var st = Store.s;
    if (!st.settings.remindDiary) st.settings.remindDiary = { on: true, at: '22:30' };
    return st.settings.remindDiary;
  }

  /* 每周复盘：周日晚上推一次本周完成率，把「周报」送到眼前（默认周日 20:30） */
  function weekCfg() {
    var st = Store.s;
    if (!st.settings.remindWeek) st.settings.remindWeek = { on: true, at: '20:30', wd: 0 };
    return st.settings.remindWeek;
  }

  /* 今天已经提醒过的 id（跨天自动重置，不进云端） */
  function fired() {
    var today = U.today();
    try {
      var o = JSON.parse(localStorage.getItem(LS_FIRED) || '{}');
      if (o && o.d === today) return { d: today, ids: o.ids || [], reps: o.reps || {} };
    } catch (e) { }
    return { d: today, ids: [], reps: {} };
  }
  function markFired(id) {
    var o = fired();
    if (o.ids.indexOf(id) < 0) o.ids.push(id);
    try { localStorage.setItem(LS_FIRED, JSON.stringify(o)); } catch (e) { }
  }
  function wasFired(id) { return fired().ids.indexOf(id) >= 0; }
  /* 已经补叫过几次（0 = 只发过第一次） */
  function repsOf(id) { var r = fired().reps || {}; return r[id] || 0; }
  function bumpReps(id) {
    var o = fired();
    o.reps = o.reps || {};
    o.reps[id] = (o.reps[id] || 0) + 1;
    try { localStorage.setItem(LS_FIRED, JSON.stringify(o)); } catch (e) { }
  }

  /* ---------- 发通知 ---------- */
  function fallback(title, body, opt) {
    try {
      if (!supported() || perm() !== 'granted') return false;
      var n = new Notification(title, { body: body, icon: 'assets/icon.svg', badge: 'assets/icon.svg', tag: opt.tag });
      n.onclick = function () { try { window.focus(); } catch (e) { } handleClick(opt.url); n.close(); };
      return true;
    } catch (e) { return false; }
  }
  function fire(title, body, opt) {
    opt = opt || {};
    var data = { url: opt.url || './', id: opt.id || '' };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.ready.then(function (reg) {
          var o = {
            body: body, icon: 'assets/icon.svg', badge: 'assets/icon.svg',
            tag: opt.tag || 'rgz',
            /* quiet = 只是替换同一条通知的内容，不要再响一次（合并窗口用） */
            renotify: !opt.quiet,
            requireInteraction: !!opt.sticky,
            data: data
          };
          if (opt.actions) o.actions = opt.actions;
          return reg.showNotification(title, o);
        }).catch(function () { fallback(title, body, opt); });
        return true;
      }
    } catch (e) { }
    return fallback(title, body, opt);
  }
  /* 通知里的「去打卡」被点：直接完成该习惯 */
  function handleClick(url) {
    if (!url) return;
    var m = /[?&]check=([^&]+)/.exec(url);
    if (!m) return;
    var id = decodeURIComponent(m[1]);
    setTimeout(function () {
      try {
        var it = (Store.s.items || []).find(x => x.id === id);
        if (!it) return;
        if (Engine.isDone(it, U.today())) return;
        Engine.toggle(it, U.today());
        Store.commit();
        if (window.UI) UI.render();
        if (window.FX) FX.celebrate(Engine.todayRate(U.today()).pct, '打卡完成 🎉');
      } catch (e) { }
    }, 260);
  }

  /* 通知正文：有「什么时候做」（cue）就先说它 —— 行为学里「实现意图」
   * （在 X 之后做 Y）比「记得做 Y」有效得多，提醒里带上场景等于每次帮你回忆一遍。 */
  function sub(it) {
    if (it.cue) {
      return it.cue + (it.type === 'check' ? '' : ' · 目标 ' + U.num(it.target || 0) + (it.unit || ''));
    }
    if (it.type === 'check') return '完成后点一下即可记录';
    return '目标 ' + U.num(it.target || 0) + (it.unit || '') + ' · 点「去打卡」直接记录';
  }

  /* 同一条习惯的第 1 / 2 / 3 次通知要说不一样的话。
   * 一模一样的内容第二次出现时，人会自动当噪音过滤掉 —— 换一种说法才叫得动。 */
  function fireHabit(it, round) {
    var title, body;
    if (!round) {
      title = '该打卡了：' + it.name;
      body = sub(it);
    } else if (round === 1) {
      title = '还没打卡：' + it.name;
      body = (it.cue ? it.cue + ' · ' : '') + '不用一次做完，先做 2 分钟也算';
    } else {
      title = '最后一次提醒：' + it.name;
      body = '今天还剩一点时间 · 做完点一下就算完成，明天接着来';
    }
    fire(title, body, {
      tag: TAG_TODAY,
      id: it.id,
      url: './?check=' + encodeURIComponent(it.id),
      actions: [{ action: 'check', title: '去打卡' }, { action: 'snooze', title: '稍后 ' + SNOOZE_MIN + ' 分钟' }]
    });
    markAt();
    if (window.Plugins && Plugins.pushRemind) Plugins.pushRemind(title, body);
  }

  /* 同一轮到点好几个习惯：合成一条，别让通知栏被刷屏（v38 · P1-10）。
   * 合并后只保留「去打卡」—— 一条通知上挂不了 N 个习惯的「稍后」。 */
  function fireBatch(list) {
    var names = list.map(function (x) { return x.it.name; });
    var title = names.length + ' 个习惯到点了';
    var body = names.slice(0, 5).join('、') + (names.length > 5 ? ' 等' : '') + ' · 打开一次就能全部搞定';
    fire(title, body, {
      tag: TAG_TODAY, url: './', sticky: true,
      actions: [{ action: 'check', title: '去打卡' }]
    });
    markAt();
    if (window.Plugins && Plugins.pushRemind) Plugins.pushRemind(title, body);
  }

  /* ---------- 主循环 ---------- */
  function tick() {
    var st = Store.s;
    if (!st) return;
    if (window.Feat && Feat.Notify) { try { Feat.Notify.badge(); } catch (e) { } }
    if (window.Plugins) { try { Plugins.dailyTick(hhmm()); } catch (e) { } }
    if (!st.settings.remindEnabled) return;
    if (perm() !== 'granted') return;

    var today = U.today(), n = nowMin();
    /* 先收集、后发送：同一轮里到点的习惯合起来发一条（v38 · P1-10） */
    var batch = [];
    Engine.items().forEach(function (it) {
      if (!it.reminderAt) return;
      /* v50：已经养成的不催。不写进「今天已提醒」，明天要是没做到，照样会响。 */
      if (quietFor(it)) return;
      if (Engine.isDone(it, today)) return;
      /* 点过「稍后提醒」的习惯：时间没到就安静待着，别再吵 */
      var su = snoozedUntil(it.id);
      if (su) {
        if (Date.now() < su) return;
        var m2 = snoozeMap(); delete m2[it.id]; saveSnooze(m2);
        /* 延后的时间到了：直接发这一次，不管之前叫过几次 */
        markFired(it.id);
        batch.push({ it: it, round: 0 });
        return;
      }
      var m = toMin(it.reminderAt);
      if (!wasFired(it.id)) {
        if (n >= m && n - m <= GRACE) {
          markFired(it.id);
          batch.push({ it: it, round: 0 });
        }
        return;
      }
      /* 已经响过第一遍但还没打卡 —— 补叫（v37）。
       * 每一轮都有独立的时间点，且仍然受 GRACE 约束：太晚就不再补，免得半夜炸响。 */
      var reps = repsOf(it.id);
      if (reps >= maxReps(it)) return;
      var due = m + REPEAT_MIN[reps];
      if (n >= due && n - due <= REPEAT_WINDOW && n < QUIET_AT) {
        bumpReps(it.id);
        batch.push({ it: it, round: reps + 1 });
      }
    });
    if (batch.length === 1) fireHabit(batch[0].it, batch[0].round);
    else if (batch.length > 1) fireBatch(batch);

    /* 断签预警（v28 · 4.2）：当天结束前 3 小时，只在「有连续记录要断」时响。
     * 全站连续 0 天、也没有任何习惯连续 ≥2 天时不说 —— 那只是「今天还没做完」，
     * 21:30 的汇总会说，这里再说一遍就成噪音了。
     * 这里不设上界（不像别的提醒卡 GRACE）：21:00 之后任何时候打开都该被提醒，
     * 因为「今天还来得及」在 22:40 依然成立；跨过午夜是另一天，fired 会自然重置。 */
    if (!wasFired('__nudge') && !wasFired('__night')) {
      var np = nudgePayload(n);
      if (np) {
        markFired('__nudge');
        fire(np.title, np.body, {
          tag: TAG_TODAY, url: './', sticky: true,
          /* 30 分钟内刚响过习惯提醒：换掉那条的内容，但别再响一声 */
          quiet: withinMerge(),
          actions: [{ action: 'check', title: '去打卡' }]
        });
        markAt();
        if (window.Plugins && Plugins.pushRemind) Plugins.pushRemind(np.title, np.body);
        markFired('__night');   /* 已经在说同一件事了，21:30 不再重复 */
      }
    }

    /* 睡前兜底：今天还没做完的一次性汇总 */
    var nc = nightCfg();
    if (nc.on && !wasFired('__night')) {
      var m2 = toMin(nc.at || '21:30');
      if (n >= m2 && n - m2 <= GRACE) {
        var r = Engine.todayRate(today);
        if (r.total > 0 && r.done < r.total) {
          markFired('__night');
          var left = Engine.items().filter(function (it) {
            return Engine.isDue(it, today) && !Engine.isDone(it, today);
          }).map(function (it) { return it.name; });
          var nightBody = left.slice(0, 6).join('、') + (left.length > 6 ? ' 等' : '') + ' · 现在补上还来得及';
          fire('今天还有 ' + (r.total - r.done) + ' 项没打卡', nightBody,
            { tag: TAG_TODAY, url: './', sticky: true, quiet: withinMerge() });
          markAt();
          if (window.Plugins && Plugins.pushRemind) Plugins.pushRemind('今天还有 ' + (r.total - r.done) + ' 项没打卡', nightBody);
        } else if (r.total > 0) {
          markFired('__night');
        }
      }
    }

    /* 写日记：当天打了卡却一个字没写，才提一次 */
    var dc = diaryCfg();
    if (dc.on && !wasFired('__diary')) {
      var m3 = toMin(dc.at || '22:30');
      if (n >= m3 && n - m3 <= GRACE) {
        var need = !!(window.Diary && Diary.needsWrite && Diary.needsWrite(today));
        markFired('__diary');
        if (need) {
          var r2 = Engine.todayRate(today);
          var db = '今天完成了 ' + r2.done + '/' + r2.total + '，趁还记得住，写两句吧 ✎';
          fire('今天还没写日记', db, { tag: 'rgz-diary', url: './#diary', sticky: true });
          if (window.Plugins && Plugins.pushRemind) Plugins.pushRemind('今天还没写日记', db);
        }
      }
    }
    /* 每周复盘：一周结束前把成绩单送到眼前，别让数据只在 App 里躺着 */
    var wc = weekCfg();
    if (wc.on && !wasFired('__week')) {
      var m4 = toMin(wc.at || '20:30');
      var wd = new Date().getDay();
      if (wd === (wc.wd == null ? 0 : wc.wd) && n >= m4 && n - m4 <= GRACE) {
        markFired('__week');
        var wk = (Engine.weeklyTrend(1) || [])[0];
        if (wk && (Engine.totalCheckins() || 0) > 0) {
          var rv = window.Extra ? Extra.review('week') : null;
          var wb = '本周完成率 ' + wk.pct + '%' + (rv ? ' · ' + rv.bullets[0] : '') + ' · 点开看完整复盘';
          fire('本周复盘 · 你坚持得怎么样', wb, { tag: 'rgz-week', url: './#grow' });
          if (window.Plugins && Plugins.pushRemind) Plugins.pushRemind('本周复盘', wb);
        }
      }
    }
  }

  function start() {
    tick();
    clearInterval(_t);
    _t = setInterval(tick, 20000);
    var kick = function () { setTimeout(tick, 400); };
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
    window.addEventListener('focus', kick);
    window.addEventListener('online', function () { setTimeout(tick, 800); });
  }

  /* ---------- 兜底：网页当时没开，回来补上 ----------
   * 系统通知只在页面活着时才可能弹；用户关了页面、息屏、或者压根没授权，
   * 提醒时间照样会过去。这里不依赖任何"曾经发过"的记录，直接按事实算：
   * 今天有习惯的提醒时间已经过了、而它还没打卡 —— 那这次提醒就漏了，
   * 下次打开页面时列出来让人补上。 */
  function pendingList() {
    var st = Store.s;
    if (!st) return [];
    if (st.settings.remindEnabled === false) return [];
    var today = U.today(), n = nowMin();
    try {
      return Engine.items().filter(function (it) {
        if (!it.reminderAt) return false;
        if (quietFor(it)) return false;      /* v50：已经养成的不算「漏了」 */
        if (!Engine.isDue(it, today)) return false;
        if (Engine.isDone(it, today)) return false;
        if (Engine.isSkipped(today, it.id)) return false;
        return n >= toMin(it.reminderAt);
      });
    } catch (e) { return []; }
  }
  function missedDismissed() {
    try { return (Store.s.settings || {}).missedDismiss === U.today(); } catch (e) { return true; }
  }
  function dismissMissed() {
    Store.commit(function (s) { s.settings.missedDismiss = U.today(); });
  }

  /* ---------- 权限 ---------- */
  function enable() {
    if (!supported()) return Promise.resolve('unsupported');
    if (perm() === 'granted') {
      Store.commit(function (s) { s.settings.remindEnabled = true; });
      return Promise.resolve('granted');
    }
    return Promise.resolve(Notification.requestPermission()).then(function (p) {
      if (p === 'granted') Store.commit(function (s) { s.settings.remindEnabled = true; });
      return p;
    }).catch(function () { return 'denied'; });
  }

  /* ---------- 引导卡 ---------- */
  function needGuide() {
    if (!supported()) return false;
    if (perm() !== 'default') return false;
    if (!Engine.items().length) return false;
    try { if (localStorage.getItem(LS_GUIDE) === U.today()) return false; } catch (e) { }
    return true;
  }
  function dismissGuide() { try { localStorage.setItem(LS_GUIDE, U.today()); } catch (e) { } }

  function statusText() {
    if (!supported()) return '这个浏览器不支持系统通知';
    var p = perm();
    if (p === 'granted') return '已授权 · 网页打开时提醒，关闭后请使用系统日历';
    if (p === 'denied') return '被浏览器拦住了 · 需去网站设置里放行';
    return '还没开启 · 点一下授权';
  }

  return {
    start: start, tick: tick, fire: fire, enable: enable,
    perm: perm, supported: supported, statusText: statusText,
    needGuide: needGuide, dismissGuide: dismissGuide,
    pendingList: pendingList, missedDismissed: missedDismissed, dismissMissed: dismissMissed,
    nightCfg: nightCfg, diaryCfg: diaryCfg, weekCfg: weekCfg, handleClick: handleClick,
    nudgeCfg: nudgeCfg, streakAtRisk: streakAtRisk, nudgePayload: nudgePayload,
    maturity: maturity, quietFor: quietFor, maxReps: maxReps, MATURE_MIN: MATURE_MIN,
    snooze: snooze, snoozedUntil: snoozedUntil, SNOOZE_MIN: SNOOZE_MIN,
    REPEAT_MIN: REPEAT_MIN, repsOf: repsOf, tick: tick,
    MERGE_MIN: MERGE_MIN, withinMerge: withinMerge, TAG_TODAY: TAG_TODAY,
    test: function () {
      fire('这是一条测试提醒', '能收到就说明提醒已经真正生效了 🔔', { tag: 'rgz-test', url: './' });
      return perm();
    }
  };
})();
