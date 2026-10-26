/* ============ 智能洞察：从你自己的数据里发现规律 ============
 * 参考 Frequent Habits 的 "Algorithmic Smart Insights"：
 * 不做鸡汤，只讲数据里真实存在的东西 —— 周几最容易断、什么习惯拉低了别的习惯、
 * 近期是不是在下滑、离下一个里程碑还差几天。
 * 全部本地计算，不上传任何数据。
 */
var _iroot = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
_iroot.Insights = (function () {
  var CACHE = { rev: -1, list: null };

  function logs() { return (Store.s && Store.s.logs) || {}; }
  function items() { return Engine.items(); }

  function doneOn(it, date) {
    var lg = (logs()[date] || {})[it.id];
    if (!lg) return false;
    if (it.type === 'check' || it.type === 'avoid') return !!lg.d;
    return (lg.v || 0) >= (it.target || 1);
  }

  /* 某习惯在一批日期上的完成情况 */
  function series(it, dates) {
    var ok = 0, due = 0;
    dates.forEach(function (d) {
      if (!Engine.isDue(it, d)) return;
      due++;
      if (doneOn(it, d)) ok++;
    });
    return { due: due, ok: ok, rate: due ? ok / due : 0 };
  }
  function lastDays(n) {
    var out = [], t = U.today();
    for (var i = 0; i < n; i++) out.push(U.shiftYmd(t, -i));
    return out;
  }
  function prevDays(n, skip) {
    var out = [], t = U.shiftYmd(U.today(), -(skip || 0));
    for (var i = 0; i < n; i++) out.push(U.shiftYmd(t, -i));
    return out;
  }
  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function pct(x) { return Math.round(x * 100); }

  /* ---------- 1. 周几规律 ---------- */
  function weekdayOfHabit(it) {
    var ds = lastDays(120);
    var stat = [];
    for (var w = 0; w < 7; w++) {
      var days = ds.filter(d => U.weekdayOf(d) === w);
      var s = series(it, days);
      if (s.due >= 3) stat.push({ w: w, rate: s.rate, n: s.due });
    }
    if (stat.length < 3) return null;
    stat.sort((a, b) => b.rate - a.rate);
    var best = stat[0], worst = stat[stat.length - 1];
    if (best.rate - worst.rate < 0.25) return null;
    return {
      kind: 'weekday',
      icon: 'calendar-dots', tone: worst.rate < 0.5 ? 'warn' : 'info',
      title: '「' + it.name + '」' + WD[worst.w] + '最容易断',
      body: WD[best.w] + '完成率 ' + pct(best.rate) + '%，' + WD[worst.w] + '只有 ' + pct(worst.rate) +
        '%。要不要给' + WD[worst.w] + '加个更低的底线目标？'
    };
  }

  function weekdayOverall() {
    var ds = lastDays(120).slice(0, 91);
    var list = items();
    if (!list.length) return null;
    var stat = [];
    for (var w = 0; w < 7; w++) {
      var days = ds.filter(d => U.weekdayOf(d) === w);
      if (days.length < 4) continue;
      var ok = 0, due = 0;
      days.forEach(function (d) {
        list.forEach(function (it) {
          if (!Engine.isDue(it, d)) return;
          due++;
          if (doneOn(it, d)) ok++;
        });
      });
      stat.push({ w: w, rate: due ? ok / due : 0 });
    }
    if (stat.length < 4) return null;
    stat.sort((a, b) => b.rate - a.rate);
    var best = stat[0], worst = stat[stat.length - 1];
    if (best.rate - worst.rate < 0.12) return null;
    return {
      kind: 'weekday-all', icon: 'chart-bar', tone: 'info',
      title: '你的' + WD[worst.w] + '是一周里最弱的一天',
      body: '整体完成率：' + WD[best.w] + ' ' + pct(best.rate) + '% vs ' + WD[worst.w] + ' ' + pct(worst.rate) + '%。' +
        '把重要的习惯尽量排在' + WD[best.w] + '，' + WD[worst.w] + '只留最简单的。'
    };
  }

  /* ---------- 2. 下滑预警 ---------- */
  function riskOf(it) {
    var recent = series(it, lastDays(7));
    var base = series(it, prevDays(60, 7));
    if (recent.due < 3 || base.due < 8) return null;
    if (recent.rate >= base.rate * 0.7) return null;
    var st = Engine.streakOf(it.id, U.today());
    return {
      kind: 'risk', icon: 'chart-line', tone: 'warn',
      title: '「' + it.name + '」最近在下滑',
      body: '近 7 天完成率 ' + pct(recent.rate) + '%，之前 60 天是 ' + pct(base.rate) + '%。' +
        (st > 0 ? '当前连续 ' + st + ' 天，先守住底线。' : '连续记录已断，重新开始也不迟。')
    };
  }

  /* ---------- 3. 习惯联动（A 做了 B 更容易做） ---------- */
  function pairs() {
    var list = items();
    if (list.length < 2) return null;
    var ds = lastDays(120);
    var best = null;
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < list.length; j++) {
        if (i === j) continue;
        var A = list[i], B = list[j];
        var withA = 0, withAn = 0, withoutA = 0, withoutAn = 0;
        ds.forEach(function (d) {
          if (!Engine.isDue(A, d) || !Engine.isDue(B, d)) return;
          if (doneOn(A, d)) { withAn++; if (doneOn(B, d)) withA++; }
          else { withoutAn++; if (doneOn(B, d)) withoutA++; }
        });
        if (withAn < 4 || withoutAn < 4) continue;
        var r1 = withA / withAn, r2 = withoutA / withoutAn;
        var lift = r1 - r2;
        if (lift > 0.2 && (!best || lift > best.lift)) {
          best = { A: A, B: B, lift: lift, r1: r1, r2: r2 };
        }
      }
    }
    if (!best) return null;
    return {
      kind: 'pair', icon: 'link', tone: 'good',
      title: '做完「' + best.A.name + '」后更容易完成「' + best.B.name + '」',
      body: '做了' + best.A.name + '的日子，' + best.B.name + '完成率 ' + pct(best.r1) + '%；没做的日子只有 ' + pct(best.r2) + '%。' +
        '可以把它们绑成一条例程。'
    };
  }

  /* ---------- 4. 里程碑临近 ---------- */
  var MILES = [7, 21, 30, 66, 100, 180, 365];
  function milestone() {
    var best = null;
    items().forEach(function (it) {
      var s = Engine.streakOf(it.id, U.today());
      if (s < 3) return;
      for (var i = 0; i < MILES.length; i++) {
        var m = MILES[i];
        if (s < m) {
          var left = m - s;
          if (left <= 7 && (!best || left < best.left)) best = { it: it, s: s, m: m, left: left };
          break;
        }
      }
    });
    if (!best) return null;
    return {
      kind: 'mile', icon: 'target', tone: 'good',
      title: '「' + best.it.name + '」再坚持 ' + best.left + ' 天就到 ' + best.m + ' 天',
      body: '「' + best.it.name + '」已经连续 ' + best.s + ' 天了。' + best.m + ' 天通常是一个习惯真正稳下来的节点，别在最后几天松掉。'
    };
  }

  /* ---------- 5. 你的最佳时段 ---------- */
  function slotStat() {
    var map = { morning: '早上', afternoon: '下午', evening: '晚上', night: '深夜', any: '不限' };
    var ds = lastDays(60);
    var stat = {};
    items().forEach(function (it) {
      var slot = it.slot || 'any';
      var s = series(it, ds);
      if (s.due < 6) return;
      (stat[slot] = stat[slot] || { ok: 0, due: 0 }).ok += s.ok;
      stat[slot].due += s.due;
    });
    var arr = Object.keys(stat).filter(k => k !== 'any').map(k => ({ k: k, rate: stat[k].ok / stat[k].due, n: stat[k].due }));
    if (arr.length < 2) return null;
    arr.sort((a, b) => b.rate - a.rate);
    var best = arr[0], worst = arr[arr.length - 1];
    if (best.rate - worst.rate < 0.15) return null;
    return {
      kind: 'slot', icon: 'clock', tone: 'info',
      title: map[best.k] + '的习惯你完成得最好',
      body: (map[best.k]) + '段完成率 ' + pct(best.rate) + '%，' + (map[worst.k]) + '段只有 ' + pct(worst.rate) + '%。' +
        '难的习惯尽量往' + (map[best.k]) + '挪。'
    };
  }

  /* ---------- 6. 心情与完成率 ---------- */
  function moodInsight() {
    var moods = (Store.s && Store.s.moods) || {};
    var ds = lastDays(90);
    var hi = [], lo = [];
    ds.forEach(function (d) {
      var m = moods[d];
      if (!m) return;
      var r = 0, n = 0;
      items().forEach(function (it) {
        if (!Engine.isDue(it, d)) return;
        n++; if (doneOn(it, d)) r++;
      });
      if (!n) return;
      (m >= 4 ? hi : (m <= 2 ? lo : [])).push(r / n);
    });
    if (hi.length < 4 || lo.length < 4) return null;
    var a = hi.reduce((x, y) => x + y, 0) / hi.length;
    var b = lo.reduce((x, y) => x + y, 0) / lo.length;
    if (a - b < 0.12) return null;
    return {
      kind: 'mood', icon: 'sparkle', tone: 'good',
      title: '心情好的日子，你完成率高 ' + pct(a - b) + ' 个百分点',
      body: '心情好时平均完成 ' + pct(a) + '%，低落时 ' + pct(b) + '%。状态差的日子允许「最低剂量」，别一次全放弃。'
    };
  }

  /* ---------- 7. 天气与完成率（v39 · 报告 P1-4 相关性洞察） ----------
   * 天气是日记模块自动抓的（Open-Meteo / wttr.in），本来就躺在 notes[d].weather 里，
   * 一直没人用。它不是「心情」的替代品 —— 下雨天不想动是真实存在的模式，
   * 说出来比讲道理有用：知道「雨天最容易断」，就可以提前给那天设最小版。 */
  var WK = { sunny: '晴天', cloudy: '多云', overcast: '阴天', fog: '雾天', rain: '下雨', snow: '下雪', storm: '雷雨' };
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function weatherInsight() {
    var notes = (Store.s && Store.s.notes) || {};
    var bucket = {};
    lastDays(120).forEach(function (d) {
      var w = notes[d] && notes[d].weather && notes[d].weather.k;
      if (!w || !WK[w]) return;
      var r = 0, n = 0;
      items().forEach(function (it) {
        if (!Engine.isDue(it, d)) return;
        n++; if (doneOn(it, d)) r++;
      });
      if (!n) return;
      (bucket[w] = bucket[w] || []).push(r / n);
    });
    var arr = Object.keys(bucket).filter(function (k) { return bucket[k].length >= 4; })
      .map(function (k) { return { k: k, rate: avg(bucket[k]), n: bucket[k].length }; });
    if (arr.length < 2) return null;
    arr.sort(function (a, b) { return b.rate - a.rate; });
    var best = arr[0], worst = arr[arr.length - 1];
    if (best.rate - worst.rate < 0.12) return null;
    return {
      kind: 'weather', icon: 'cloud', tone: worst.rate < 0.5 ? 'warn' : 'info',
      title: WK[worst.k] + '你最容易断（' + pct(worst.rate) + '%）',
      body: WK[best.k] + '平均完成 ' + pct(best.rate) + '%（' + best.n + ' 天），' +
        WK[worst.k] + '只有 ' + pct(worst.rate) + '%（' + worst.n + ' 天）。' +
        '这种天提前给自己设「最小版」，比硬扛有效。'
    };
  }

  /* ---------- 8. 身体状态与完成率（健康导入的数据） ----------
   * 从 Apple 健康 / Google Fit 导进来的步数、睡眠，落成了「标签含导入」的习惯。
   * 用它去解释「为什么有些天就是做不动」—— 比单纯说「你最近下滑了」有用得多。 */
  function healthInsight() {
    var srcs = items().filter(function (it) { return (it.tags || []).indexOf('导入') >= 0; });
    if (!srcs.length) return null;
    var best = null;
    srcs.forEach(function (src) {
      var rows = [];
      lastDays(120).forEach(function (d) {
        var lg = (logs()[d] || {})[src.id];
        if (!lg || lg.v == null) return;
        var r = 0, n = 0;
        items().forEach(function (it) {
          if (it.id === src.id) return;
          if (!Engine.isDue(it, d)) return;
          n++; if (doneOn(it, d)) r++;
        });
        if (!n) return;
        rows.push({ v: lg.v, rate: r / n });
      });
      if (rows.length < 10) return;
      var sorted = rows.slice().sort(function (a, b) { return a.v - b.v; });
      var mid = sorted[Math.floor(sorted.length / 2)].v;
      var hi = rows.filter(function (x) { return x.v >= mid; });
      var lo = rows.filter(function (x) { return x.v < mid; });
      if (hi.length < 4 || lo.length < 4) return;
      var a = avg(hi.map(function (x) { return x.rate; }));
      var b = avg(lo.map(function (x) { return x.rate; }));
      if (a - b < 0.12) return;
      if (!best || a - b > best.lift) best = { src: src, a: a, b: b, lift: a - b, mid: mid, hi: hi.length, lo: lo.length };
    });
    if (!best) return null;
    var unit = best.src.unit || '';
    return {
      kind: 'health', icon: 'sneaker-move', tone: 'good',
      title: '「' + best.src.name + '」高的日子，其他习惯也更容易完成',
      body: best.src.name + ' ≥ ' + U.num(best.mid) + unit + ' 的 ' + best.hi + ' 天，完成率 ' + pct(best.a) + '%；' +
        '低于这个数的 ' + best.lo + ' 天只有 ' + pct(best.b) + '%。' +
        '先把' + best.src.name + '稳住，别的会跟着来。'
    };
  }

  /* ---------- 9. 你实际都在几点做（v39 · 报告 P1-5 最佳时段） ----------
   * 用打卡时间戳（log.t）反推真实节奏，再跟提醒时间比。
   * 只统计「当天当场打的」：补卡、导入的 t 是操作时刻，不是行为时刻，混进来会算错。 */
  function hourInsight() {
    var list = items().filter(function (it) { return it.reminderAt; });
    var best = null;
    list.forEach(function (it) {
      var hrs = [];
      lastDays(90).forEach(function (d) {
        var lg = (logs()[d] || {})[it.id];
        if (!lg || !lg.t || !doneOn(it, d)) return;
        if (U.ymd(new Date(lg.t)) !== d) return;     // 补卡 / 导入，不算真实时刻
        hrs.push(new Date(lg.t).getHours());
      });
      if (hrs.length < 8) return;
      var sorted = hrs.slice().sort(function (a, b) { return a - b; });
      var med = sorted[Math.floor(sorted.length / 2)];
      var near = hrs.filter(function (h) { return Math.abs(h - med) <= 1; }).length;
      var set = String(it.reminderAt).split(':');
      var setMin = (+set[0] || 0) * 60 + (+set[1] || 0);
      var diff = med * 60 + 30 - setMin;
      if (Math.abs(diff) < 60) return;               // 差不到 1 小时，别啰嗦
      if (!best || Math.abs(diff) > Math.abs(best.diff)) {
        best = { it: it, med: med, near: near, n: hrs.length, set: it.reminderAt, diff: diff };
      }
    });
    if (!best) return null;
    return {
      kind: 'hour', icon: 'clock', tone: 'info',
      title: '「' + best.it.name + '」你其实都在 ' + U.pad(best.med) + ':00 前后做',
      body: '最近 ' + best.n + ' 次里有 ' + best.near + ' 次落在 ' + U.pad(best.med) + ' 点前后一小时，' +
        '提醒却定在 ' + best.set + '。把提醒改到 ' + U.pad(best.med) + ':00，响的时候正好是你本来就会做的时候。'
    };
  }

  /* ---------- 8. 打卡时段分布（v55）----------
   * 「一天里几点最稳」—— 最近 90 天所有带真实时刻的完成，按 2 小时一桶。
   * 只算当天打的卡：补卡/导入的 t 是补的那一秒，与 hourInsight 同一条口径。
   * 不足 20 次不出结论 —— 分母太小，任何「规律」都只是噪声（与 sample() 同一哲学）。 */
  function hourDist() {
    var bins = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var lg = logs(), its = items();
    lastDays(90).forEach(function (d) {
      its.forEach(function (it) {
        var e = (lg[d] || {})[it.id];
        if (!e || !e.t || !doneOn(it, d)) return;
        if (U.ymd(new Date(e.t)) !== d) return;      // 补卡 / 导入，不算真实时刻
        bins[Math.min(11, Math.floor(new Date(e.t).getHours() / 2))]++;
      });
    });
    var total = bins.reduce(function (a, b) { return a + b; }, 0);
    var peak = 0;
    for (var i = 1; i < 12; i++) if (bins[i] > bins[peak]) peak = i;
    return { bins: bins, total: total, peak: peak, ok: total >= 20, left: Math.max(0, 20 - total) };
  }

  /* ---------- 汇总 ---------- */
  /* 样本门槛（评审 4.3）：分母太小的时候，任何「规律」都只是噪声。
   * 门槛：至少 14 天有记录、且至少 10 次完成。不够就不出结论，
   * 同时把 sample() 暴露给界面，让它说清「还差多少」。 */
  function sample() {
    var lg = logs(), days = 0, done = 0;
    Object.keys(lg).forEach(function (d) {
      var has = false;
      Object.keys(lg[d] || {}).forEach(function (k) {
        var v = lg[d][k] || {};
        if (v.d || v.v) { done++; has = true; }
      });
      if (has) days++;
    });
    return {
      days: days, done: done,
      ok: days >= 14 && done >= 10,
      daysLeft: Math.max(0, 14 - days), doneLeft: Math.max(0, 10 - done)
    };
  }

  function build() {
    var out = [];
    var list = items();
    if (!list.length) return out;
    if (!sample().ok) return out;   // 样本不足，一条结论都不给

    var m = milestone(); if (m) out.push(m);
    var r = null;
    list.forEach(function (it) { if (!r) r = riskOf(it); });
    if (r) out.push(r);
    var w = weekdayOverall(); if (w) out.push(w);
    var p = pairs(); if (p) out.push(p);
    var s = slotStat(); if (s) out.push(s);
    var mo = moodInsight(); if (mo) out.push(mo);
    /* 单个习惯的周几规律：挑完成率最低的那个说。
     * Engine.itemRate 返回的是 0–100 的百分数（不是 0–1 的小数），阈值必须写 80。 */
    var weakest = null;
    list.forEach(function (it) {
      var st = Engine.itemRate(it.id, 60);
      if (weakest === null || st < weakest.rate) weakest = { it: it, rate: st };
    });
    if (weakest && weakest.rate < 80) {
      var wi = weekdayOfHabit(weakest.it);
      if (wi) out.push(wi);
    }
    /* v39 起的三条交叉洞察放最后：它们依赖日记/健康数据，样本更稀，
     * 排在「周几最容易断」这类硬结论后面才不会喧宾夺主。 */
    var hh = hourInsight(); if (hh) out.push(hh);
    var we = weatherInsight(); if (we) out.push(we);
    var he = healthInsight(); if (he) out.push(he);
    return out.slice(0, 8);
  }

  function all() {
    var rev = (typeof Store !== 'undefined' && Store && Store.rev) || 0;
    if (CACHE.rev === rev && CACHE.list) return CACHE.list;
    var l = build();
    CACHE.rev = rev; CACHE.list = l;
    return l;
  }

  /* 给推送 / 分享用的一句话 */
  function headline() {
    var l = all();
    if (!l.length) return '今天也要加油 🌱';
    return l[0].title;
  }

  /* ---------- 一句人话（v50）----------
   * 横评里反复出现的一句抱怨：「图表很漂亮，但完全看不出我到底有没有在变好」。
   * 洞察列表回答的是「哪里最容易断」，而没人问出口的那句「我在变好吗」反倒没人回答。
   * 这里只用一句话回答它：近 14 天 vs 前 14 天，涨了还是跌了，差几个百分点。
   * 口径与别处一致：只数「该做且没请假」的日子，样本不足 7 天就不下结论。 */
  function rateOver(ds) {
    var list = items(), due = 0, ok = 0;
    ds.forEach(function (d) {
      list.forEach(function (it) {
        if (!Engine.isDue(it, d)) return;
        if (Engine.isSkipped(d, it.id)) return;
        due++;
        if (doneOn(it, d)) ok++;
      });
    });
    return { due: due, ok: ok, pctv: due ? Math.round(ok / due * 100) : 0 };
  }
  function verdict() {
    /* 都取完整的 14 天，不含今天 —— 今天还没过完，算进去只会把「现在」压低 */
    var cur = rateOver(prevDays(14, 1));
    var prev = rateOver(prevDays(14, 15));
    if (cur.due < 7 || prev.due < 7) return null;
    return { cur: cur.pctv, prev: prev.pctv, delta: cur.pctv - prev.pctv, due: cur.due };
  }
  function oneLine() {
    var v = verdict();
    if (!v) return '';
    var cmp = v.delta > 0 ? ('比前 14 天提高 ' + v.delta + ' 个百分点')
      : v.delta < 0 ? ('比前 14 天下降 ' + Math.abs(v.delta) + ' 个百分点')
        : '和前 14 天一样';
    var tail = v.delta >= 3 ? '在变好。' : v.delta <= -3 ? '有点下滑，先守住底线。' : '稳住了。';
    return '近 14 天完成率 ' + v.cur + '%，' + cmp + ' —— ' + tail;
  }

  return {
    all: all, headline: headline, doneOn: doneOn, series: series, lastDays: lastDays, sample: sample,
    verdict: verdict, oneLine: oneLine, hourDist: hourDist,
    bust: function () { CACHE.rev = -1; }
  };
})();
