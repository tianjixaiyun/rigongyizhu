/* ============ 月度打卡纸（v51）：把一个月打印成一张能贴在墙上的表 ============
 * 依据：HN 上有人说得挺直接 ——
 *   "printed habit trackers serve way better as motivators or reminders than phone apps."
 * 手机里的数据只有打开才看得见；贴在冰箱上的那张纸，一天会撞见十几次。
 * 所以这里给一张 A4 的月历表：一行一个习惯，一格一天，做完涂黑。
 *
 * 设计取舍：
 *  - 只画「这个月有安排」的习惯（暂停的、月底才建的都跳过），别让纸上一堆空格。
 *  - 格子里区分「完成 / 部分 / 请假 / 休息 / 没做」—— 打印出来最怕的是看不出差别。
 *  - 完全离线生成，不截图、不调后端；@media print 只留这一张纸。
 */
window.Paper = (function () {
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function daysInMonth(ym) {
    const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return new Date(y, m, 0).getDate();
  }
  function monthLabel(ym) {
    return ym.slice(0, 4) + ' 年 ' + (+ym.slice(5, 7)) + ' 月';
  }
  const WD = ['日', '一', '二', '三', '四', '五', '六'];

  /* 某天某习惯的状态 → 一个字符 + 一个 class。顺序即优先级：
   * 做了就是做了（哪怕只做了半个），其次请假，再其次休息，最后才是没做。 */
  function cellOf(it, date) {
    if (Engine.isDone(it, date)) return { ch: '✓', cls: 'done' };
    if (Engine.isPartial(it, date)) return { ch: '◐', cls: 'part' };
    if (Engine.isSkipped(date, it.id)) return { ch: '–', cls: 'skip' };
    if (Engine.isRestDay(it, date)) return { ch: '·', cls: 'rest' };
    if (!Engine.isDue(it, date)) return { ch: '', cls: 'off' };
    /* 今天还没过完：不画成「没做」，画个浅框，别让人一早看见满纸空白就泄气 */
    if (date === U.today()) return { ch: '', cls: 'todo' };
    return { ch: '', cls: 'miss' };
  }

  function build(ym) {
    const month = ym || U.today().slice(0, 7);
    const n = daysInMonth(month);
    const today = U.today();
    const dates = [];
    for (let d = 1; d <= n; d++) dates.push(month + '-' + pad2(d));

    /* 只留这个月真的有安排的习惯 */
    const items = Engine.items().filter(it => dates.some(d => Engine.isDue(it, d)));
    if (!items.length) {
      return '<div class="paper"><h1>日拱一卒 · ' + monthLabel(month) + '</h1>' +
        '<p class="pp-empty">这个月还没有安排任何习惯。</p></div>';
    }

    /* 表头：日 + 星期（星期用两种字母交替，扫一眼就知道周末在哪） */
    let head = '<tr><th class="pp-name">习惯</th>';
    dates.forEach(d => {
      const wd = U.weekdayOf(d);
      head += '<th class="pp-d' + (wd === 0 || wd === 6 ? ' pp-we' : '') +
        (d === today ? ' pp-today' : '') + '">' + (+d.slice(8, 10)) +
        '<i>' + WD[wd] + '</i></th>';
    });
    head += '<th class="pp-sum">做到</th></tr>';

    let body = '';
    items.forEach(it => {
      let done = 0, due = 0;
      let cells = '';
      dates.forEach(d => {
        const c = cellOf(it, d);
        if (c.cls !== 'off') due++;
        if (c.cls === 'done') done++;
        const wd = U.weekdayOf(d);
        cells += '<td class="pp-c ' + c.cls + (wd === 0 || wd === 6 ? ' pp-we' : '') +
          (d === today ? ' pp-today' : '') + '">' + c.ch + '</td>';
      });
      body += '<tr><th class="pp-name">' + U.esc(it.name) +
        (it.type === 'avoid' ? '<em>（别碰）</em>' : '') + '</th>' + cells +
        '<td class="pp-sum">' + done + '/' + due + '</td></tr>';
    });

    return '<div class="paper">' +
      '<div class="pp-head"><h1>日拱一卒 · ' + monthLabel(month) + '</h1>' +
      '<p>打印出来贴在看得见的地方。做完涂一格，比打开 App 管用。</p></div>' +
      '<table class="pp-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      '<div class="pp-legend">' +
      '<span><b class="done">✓</b> 完成</span>' +
      '<span><b class="part">◐</b> 做了一半以上（不断）</span>' +
      '<span><b class="skip">–</b> 请假</span>' +
      '<span><b class="rest">·</b> 休息日</span>' +
      '<span><b class="miss"></b> 没做</span>' +
      '</div>' +
      '<div class="pp-foot">导出时间 ' + U.today() + ' · 这一页只是记录，数据仍在这台设备上</div>' +
      '</div>';
  }

  /* 把纸放进 DOM（打印时只显示它），再调起打印 */
  function print(ym) {
    let host = document.getElementById('printSheet');
    if (!host) {
      host = document.createElement('div');
      host.id = 'printSheet';
      document.body.appendChild(host);
    }
    host.innerHTML = build(ym);
    /* 等一帧再打印：某些浏览器在 DOM 刚改完时截图会缺样式 */
    setTimeout(() => {
      try { window.print(); } catch (e) { }
    }, 60);
    return true;
  }

  return { build: build, print: print, daysInMonth: daysInMonth, monthLabel: monthLabel, cellOf: cellOf };
})();
