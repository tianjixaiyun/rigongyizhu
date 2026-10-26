/* ============ 图表库：SVG / CSS 统一出口 ============
 * 回顾页与习惯详情要放三种新图：折线趋势、单习惯月历点阵、多习惯横向对比。
 * 全部集中在这里画，ui.js 只负责取数 —— 否则 ui.js（已经 3200 行）会被
 * 一堆坐标计算撑爆，而且每种图的配色 / 圆角 / 触摸目标会慢慢变得不一致。
 *
 * 约定：
 *   · 尺寸用 viewBox + width:100%，由 CSS 控制实际宽度，图表自动缩放
 *   · 颜色一律走 CSS 变量 / class，不写死色值，深浅色主题自动跟随
 *   · 每个数据点都带 <title>，手机上长按也能看到当天数值
 *   · 触控目标 ≥ 32px（移动端规范 44px 做不到的地方至少保证可点区域连续） */
window.Chart = (function () {
  const round = n => Math.round(n * 100) / 100;
  const pad2 = n => String(n).padStart(2, '0');
  const mmdd = date => date.slice(5).replace('-', '/');

  /* ---------------- 折线趋势 ----------------
   * rows: [{ date, pct }]  已完成率序列（0–100），由 Chart.rolling() 生成
   * opt:  { label, target } target 为参考线（默认 80%），null 则不画
   * opt:  { cls } 追加到 svg 上的 class（如 'ch-avoid' 让线走暖色 —— 戒断型评分曲线的配色）
   *
   * 为什么用"滚动窗口"而不是"当天完成率"：单日只有 0/100 两个值，
   * 画出来是一排针，看不出趋势；7 天滚动率才是一条能读懂的线。 */
  function line(rows, opt) {
    opt = opt || {};
    if (!rows || !rows.length) return '<div class="muted" style="font-size:12px;padding:14px 0">数据还不够，再坚持几天就能看到趋势线。</div>';
    const W = 320, H = 132;
    const L = 26, R = 8, T = 10, B = 20;
    const iw = W - L - R, ih = H - T - B;
    const step = iw / Math.max(1, rows.length - 1);
    const x = i => round(L + i * step);
    const y = v => round(T + ih - (v / 100) * ih);
    const pts = rows.map((r, i) => [x(i), y(r.pct)]);
    const dPath = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
    const area = dPath + ' L' + x(rows.length - 1) + ' ' + y(0) + ' L' + L + ' ' + y(0) + ' Z';
    const target = opt.target === undefined ? 80 : opt.target;
    const last = rows[rows.length - 1].pct;
    const avg = Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length);
    let s = '<svg class="ch-svg ch-line' + (opt.cls ? ' ' + opt.cls : '') + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      (opt.label || '完成率趋势') + '，从 ' + mmdd(rows[0].date) + ' 的 ' + rows[0].pct + '% 到 ' +
      mmdd(rows[rows.length - 1].date) + ' 的 ' + last + '%，平均 ' + avg + '%">';
    /* 横向参考线 */
    [0, 50, 100].forEach(v => {
      s += '<line class="ch-grid" x1="' + L + '" y1="' + y(v) + '" x2="' + (W - R) + '" y2="' + y(v) + '"></line>';
      s += '<text class="ch-ax" x="' + (L - 5) + '" y="' + (y(v) + 3.5) + '" text-anchor="end">' + v + '</text>';
    });
    if (target !== null) s += '<line class="ch-target" x1="' + L + '" y1="' + y(target) + '" x2="' + (W - R) + '" y2="' + y(target) + '"></line>';
    s += '<path class="ch-area" d="' + area + '"></path>';
    s += '<path class="ch-path" d="' + dPath + '"></path>';
    /* 末尾点要大一点、要能按住看详情；中间点只在数据点多时才画 */
    const showDots = rows.length <= 45;
    pts.forEach((p, i) => {
      const r = rows[i];
      if (!showDots && i !== pts.length - 1) return;
      s += '<circle class="ch-dot' + (i === pts.length - 1 ? ' last' : '') + '" cx="' + p[0] + '" cy="' + p[1] + '" r="' +
        (i === pts.length - 1 ? 3.6 : 2.2) + '"><title>' + mmdd(r.date) + '　' + r.pct + '%</title></circle>';
    });
    /* x 轴只标首 / 中 / 尾，避免糊成一片 */
    const idx = [0, Math.floor(rows.length / 2), rows.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    idx.forEach(i => {
      const anchor = i === 0 ? 'start' : (i === rows.length - 1 ? 'end' : 'middle');
      s += '<text class="ch-ax" x="' + x(i) + '" y="' + (H - 5) + '" text-anchor="' + anchor + '">' + mmdd(rows[i].date) + '</text>';
    });
    s += '</svg>';
    s += '<div class="ch-legend"><span><i class="k-path"></i>完成率</span>' +
      (target !== null ? '<span><i class="k-target"></i>目标 ' + target + '%</span>' : '') +
      '<span class="ch-num">平均 <b>' + avg + '%</b></span></div>';
    return s;
  }

  /* ---------------- 单习惯月历点阵（对标 Streaks） ----------------
   * cells: [{ date, level }]  level: -1 未创建 / 0 未做或没排 / 1 请假 / 2~4 完成程度递增
   * 和"年度贡献图"的区别：这里是单月放大版，一格一天，颜色直接读完成度。 */
  function monthMatrix(cells, opt) {
    opt = opt || {};
    if (!cells || !cells.length) return '<div class="muted" style="font-size:12px;padding:14px 0">这个月还没有安排。</div>';
    const CELL = 30, GAP = 5, COLS = 7;
    const rows = Math.ceil(cells.length / COLS);
    const W = COLS * CELL + (COLS - 1) * GAP + 2;
    const H = rows * CELL + (rows - 1) * GAP + 2;
    const x = i => round(1 + (i % COLS) * (CELL + GAP));
    const y = i => round(1 + Math.floor(i / COLS) * (CELL + GAP));
    let s = '<svg class="ch-svg ch-cal" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="日历点阵，' +
      (opt.label || '本月完成情况') + '">';
    cells.forEach((c, i) => {
      /* 未来 → 浅底无框；习惯还没建 → 虚线框；其余按完成度分档 */
      const cls = 'ch-cell ' + (c.future ? 'lf' : (c.level < 0 ? 'lx' : 'l' + c.level));
      const TIP = { 0: '未完成', 1: '请假', 2: '完成了一部分', 3: '完成过半', 4: '已完成' };
      const tip = c.date + (c.future ? ' 还没到'
        : c.level < 0 ? ' 还没建这个习惯'
        : c.done ? ' ' + TIP[4]
        : ' ' + (TIP[c.level] || TIP[2]));
      s += '<rect class="' + cls + '" x="' + x(i) + '" y="' + y(i) + '" width="' + CELL + '" height="' + CELL +
        '" rx="9"><title>' + tip + '</title></rect>';
    });
    s += '</svg>';
    const done = cells.filter(c => c.done).length, due = cells.filter(c => c.due).length;
    s += '<div class="ch-legend"><span class="ch-num">本月 ' + done + '/' + due + ' 天</span>' +
      '<span class="ch-scale"><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i></span></div>';
    return s;
  }

  /* ---------------- 多习惯横向对比 ----------------
   * rows: [{ name, color, pct, done, total }] 按 pct 降序
   * 用 HTML/CSS 而不是 SVG：习惯名长度不可控，SVG 里截断很丑，
   * 而且 CSS 版天然换行 / 适配窄屏 / 能被朗读。 */
  function hbars(rows, opt) {
    opt = opt || {};
    if (!rows || !rows.length) return '<div class="muted" style="font-size:12px">这个月还没有数据。</div>';
    const avg = Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length);
    let s = '<div class="ch-hbars">';
    rows.forEach(r => {
      s += '<div class="ch-hb"><span class="ch-hb-n" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
        '<span class="ch-hb-t"><i style="width:' + r.pct + '%;background:' + (r.color || 'var(--accent)') + '"></i></span>' +
        '<b class="ch-hb-v">' + r.pct + '%</b></div>';
    });
    s += '</div><div class="ch-legend"><span class="ch-num">平均 <b>' + avg + '%</b></span>' +
      '<span>' + rows.length + ' 个习惯 · ' + rows.reduce((a, r) => a + r.done, 0) + ' 次完成</span></div>';
    return s;
  }

  function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------------- 滚动态数据 ----------------
   * heat: Engine.itemHeat(itemId, days) 的数组
   * win:  窗口长度（天）
   * 输出可直接喂给 line()：窗口内"应做且没请假"的天数够多才算一个点，
   * 否则整段跳过（否则三天打鱼两天晒网的习惯会出现大量空窗锯齿）。 */
  function rolling(heat, win) {
    win = win || 7;
    const out = [];
    for (let i = 0; i < heat.length; i++) {
      let d = 0, t = 0;
      for (let k = Math.max(0, i - win + 1); k <= i; k++) {
        if (heat[k].due) { t++; if (heat[k].done) d++; }
      }
      if (t >= Math.max(1, Math.round(win * 0.6))) out.push({ date: heat[i].date, pct: Math.round(d / t * 100) });
    }
    return out;
  }

  /* 某自然月的点阵数据：从 itemHeat 里挑出这个月的格子。
   * 必须区分三种空格子：未来（还没到）/ 习惯还没建 / 当天没安排。
   * 混成一种的话，月末那一大片会看起来像"习惯不存在"。 */
  function monthCells(itemId, ym) {
    const [y, m] = ym.split('-');
    const dim = new Date(+y, +m, 0).getDate();
    const today = window.U.today();
    const heat = window.Engine.itemHeat(itemId, 366);
    const map = {};
    heat.forEach(h => { map[h.date] = h; });
    const out = [];
    for (let d = 1; d <= dim; d++) {
      const date = ym + '-' + pad2(d);
      const h = map[date];
      out.push({
        date: date, future: date > today, level: h ? h.lv : -1, due: !!(h && h.due), done: !!(h && h.done)
      });
    }
    return out;
  }

  return { line, monthMatrix, hbars, rolling, monthCells };
})();
