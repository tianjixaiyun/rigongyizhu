/* ============ 日历导出（v51）：把习惯排程变成手机日历里的日程 ============
 * 为什么做这个：
 *  1) 我们自己的提醒状态里就写着「网页打开时提醒，关闭后请使用系统日历」——
 *     这句话一直是个空头承诺，因为没有导出功能。
 *  2) HN 上被反复提到的一条：the problem was never the tracking, it was that
 *     each one is an app I have to remember to open, and remembering to open
 *     an app is itself a habit I don't have.
 *     PWA 的系统通知只在页面活着时可靠，息屏 / 关标签页就没了；
 *     而系统日历是唯一一个「一定会响、且不需要记得打开任何 App」的提醒通道。
 *  3) 日历里的事件还能带 URL：点一下直接回到应用里打卡（?check=id）。
 *
 * 纯前端生成 .ics（RFC 5545），零依赖、不上传任何东西。
 * 用浮动本地时间（不带 Z），这样用户换时区也不会错位。
 */
window.ICS = (function () {
  const CRLF = '\r\n';
  const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const DURATION_MIN = 15;      // 日程长度：给 15 分钟，够在日历里看见且不占地方

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* 2026-10-26 + '09:00' → 20261026T090000（浮动时间，不带 Z） */
  function stamp(ymd, hhmm) {
    const p = String(hhmm || '09:00').split(':');
    const h = Math.min(23, Math.max(0, +p[0] || 0));
    const m = Math.min(59, Math.max(0, +p[1] || 0));
    return ymd.replace(/-/g, '') + 'T' + pad2(h) + pad2(m) + '00';
  }
  function plusMin(ymd, hhmm, min) {
    const p = String(hhmm || '09:00').split(':');
    let t = (+p[0] || 0) * 60 + (+p[1] || 0) + (min || 0);
    const d = Math.floor(t / 1440);
    t = ((t % 1440) + 1440) % 1440;
    return { ymd: U.shiftYmd(ymd, d), hhmm: pad2(Math.floor(t / 60)) + ':' + pad2(t % 60) };
  }

  /* RFC 5545 的 75 字节折行：长行必须折，否则部分客户端（Outlook）会截断。
   * 中文是 3 字节，所以按字节数折，不能按字符数。 */
  function fold(line) {
    let out = '', buf = '', bytes = 0, first = true;
    for (const ch of line) {
      const b = new TextEncoder().encode(ch).length;
      if (bytes + b > (first ? 75 : 74)) {
        out += (first ? '' : ' ') + buf + CRLF;
        first = false; buf = ''; bytes = 0;
      }
      buf += ch; bytes += b;
    }
    out += (first ? '' : ' ') + buf;
    return out;
  }
  /* 文本值里的特殊字符要转义：反斜杠、分号、逗号、换行 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /* 排程 → RRULE。认不出就按每天算（宁可多提醒一次，也不要导出一个永远不响的日程）。 */
  function rruleOf(it) {
    const sc = it.schedule || { type: 'daily' };
    if (sc.type === 'weekdays') {
      const days = (sc.days || [1, 2, 3, 4, 5]).map(d => BYDAY[d]).filter(Boolean);
      return 'FREQ=WEEKLY;BYDAY=' + (days.length ? days.join(',') : 'MO,TU,WE,TH,FR');
    }
    if (sc.type === 'interval') {
      const n = Math.max(1, Math.min(365, sc.n || 2));
      return 'FREQ=DAILY;INTERVAL=' + n;
    }
    if (sc.type === 'timesPerWeek') {
      /* 每周 N 次没有「具体哪几天」，取等距的几天：3 次 → 一三五，2 次 → 二四，4 次 → 一三四六。
       * 日历必须有确定的日期，这是最接近「分散开」的近似。 */
      const n = Math.max(1, Math.min(6, sc.n || 3));
      const picks = { 1: ['MO'], 2: ['TU', 'TH'], 3: ['MO', 'WE', 'FR'], 4: ['MO', 'TU', 'TH', 'SA'], 5: ['MO', 'TU', 'WE', 'TH', 'FR'], 6: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA'] };
      return 'FREQ=WEEKLY;BYDAY=' + (picks[n] || picks[3]).join(',');
    }
    if (sc.type === 'monthly') {
      const ds = (sc.days || [1]).map(d => Math.max(1, Math.min(31, +d || 1)));
      return 'FREQ=MONTHLY;BYMONTHDAY=' + (ds.length ? ds.join(',') : '1');
    }
    if (sc.type === 'yearly') {
      const d = (sc.dates || [])[0] || '';
      const mm = +d.slice(0, 2), dd = +d.slice(3, 5);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        return 'FREQ=YEARLY;BYMONTH=' + mm + ';BYMONTHDAY=' + dd;
      }
      return 'FREQ=YEARLY';
    }
    return 'FREQ=DAILY';
  }

  /* 年度型可能有多个日期，每个日期得单独一个事件（RRULE 里塞两组月日会变成「都要满足」） */
  function yearlyDates(it) {
    const sc = it.schedule || {};
    if (sc.type !== 'yearly') return [null];
    const list = (sc.dates || []).filter(d => /^\d{2}-\d{2}$/.test(d));
    return list.length ? list : [null];
  }

  /* 起始日：今天该做就用今天，否则往后找最近的一个该做的日子（最多找 400 天）。
   * 用「今天」当 DTSTART 有个好处：导入后从今天开始就有条目，用户立刻看得到效果。 */
  function startFor(it) {
    const today = U.today();
    let cur = today;
    for (let i = 0; i < 400; i++) {
      if (Engine.isDue(it, cur)) return cur;
      cur = U.shiftYmd(cur, 1);
    }
    return today;
  }

  function vevent(it, dateOverride) {
    const at = it.reminderAt || '09:00';
    let start = startFor(it);
    if (dateOverride) {
      /* 年度型：DTSTART 必须落在那个月日上，否则 RRULE 会从错的日子开始推 */
      const mm = +dateOverride.slice(0, 2), dd = +dateOverride.slice(3, 5);
      let y = +start.slice(0, 4);
      let cand = y + '-' + pad2(mm) + '-' + pad2(dd);
      if (cand < U.today()) cand = (y + 1) + '-' + pad2(mm) + '-' + pad2(dd);
      start = cand;
    }
    const end = plusMin(start, at, DURATION_MIN);
    const uid = 'rgz-' + it.id + (dateOverride ? '-' + dateOverride.replace('-', '') : '') + '@rigongyizhu';
    const lines = [
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + stamp(U.today(), '00:00') + 'Z',
      'DTSTART:' + stamp(start, at),
      'DTEND:' + stamp(end.ymd, end.hhmm),
      'RRULE:' + rruleOf(it),
      'SUMMARY:' + esc((it.type === 'avoid' ? '别碰：' : '') + it.name),
      'DESCRIPTION:' + esc(descOf(it)),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'TRIGGER:-PT0M',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + esc(it.name),
      'END:VALARM',
      'END:VEVENT'
    ];
    return lines.map(fold).join(CRLF);
  }

  function descOf(it) {
    const bits = [];
    if (it.cue) bits.push(it.cue);
    if (it.type !== 'check' && it.type !== 'avoid') {
      bits.push('目标 ' + U.num(it.target || 0) + (it.unit || ''));
    }
    if (it.type === 'avoid') bits.push('今天忍住了就点一下');
    bits.push('做完点这里记一笔：' + appUrl(it));
    return bits.join(' · ');
  }

  function appUrl(it) {
    try {
      const base = location.origin + location.pathname.replace(/[^/]*$/, '');
      return base + '?check=' + encodeURIComponent(it.id);
    } catch (e) { return ''; }
  }

  /* 生成整份日历。只导出「没暂停」的习惯 —— 暂停的导出去只会变成噪音。 */
  function build(list) {
    const items = (list || Engine.items()).filter(it => !it.pausedUntil || it.pausedUntil < U.today());
    const head = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//rigongyizhu//habit calendar//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + esc('日拱一卒 · 习惯'),
      'X-WR-TIMEZONE:' + tzName(),
      'X-WR-CALDESC:' + esc('由日拱一卒导出。日历响铃会提醒你，点开日程可以直接打卡。')
    ];
    const body = [];
    items.forEach(it => {
      yearlyDates(it).forEach(d => body.push(vevent(it, d)));
    });
    return head.map(fold).join(CRLF) + CRLF + (body.length ? body.join(CRLF) + CRLF : '') + 'END:VCALENDAR' + CRLF;
  }

  function tzName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'; } catch (e) { return 'Asia/Shanghai'; }
  }

  function fileName() {
    return 'rigongyizhu-' + U.today() + '.ics';
  }

  /* 下载。iOS 上会问「添加到日历」，Android 会问用哪个日历应用打开。 */
  function download() {
    const text = build();
    const count = (text.match(/BEGIN:VEVENT/g) || []).length;
    try {
      const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      /* 老浏览器兜底：直接开一个 data URL */
      location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text);
    }
    return count;
  }

  /* 复制到剪贴板（桌面端不想下载文件时的备用路径） */
  function copy() {
    const text = build();
    return U.copy ? U.copy(text) : false;
  }

  return {
    build: build, download: download, copy: copy,
    rruleOf: rruleOf, stamp: stamp, fold: fold, esc: esc,
    fileName: fileName, startFor: startFor, DURATION_MIN: DURATION_MIN
  };
})();
