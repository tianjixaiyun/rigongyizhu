/* 产品体验层：复用 Store / Engine / UI，不建立第二套记录或账号。 */
window.Product = (function () {
  const E = text => U.esc(text);
  const icon = name => '<svg class="p-icon" aria-hidden="true"><use href="assets/icons.svg#' + name + '"></use></svg>';
  const PAGES = [
    ['today', '今日', 'sun'], ['habits', '习惯', 'squares-four'],
    ['diary', '日记', 'notebook'], ['grow', '回顾', 'chart-bar'], ['me', '我的', 'user-circle'],
    ['todos', '待办', 'check-square'], ['rooms', '房间', 'users'], ['connect', '连接与备份', 'cloud']
  ];
  let todayFilter = 'all', todayQuery = '', habitQuery = '', inputTimer = 0;
  /* 折叠状态记忆：key -> 用户手动选择的开/关。
   * 页面重绘会重建 DOM，若不记住用户的选择，用户刚收起的块会自己弹回来。
   * 由 main.js 用捕获阶段的 toggle 监听写入（<details> 的 toggle 不冒泡，只能捕获）。 */
  const foldState = Object.create(null);
  function foldOpen(key, def) {
    const v = foldState[key];
    return v === undefined ? !!def : !!v;
  }
  function setFold(key, open) { foldState[key] = !!open; }
  function filterToday(list) {
    const date = U.today(), q = todayQuery.trim().toLocaleLowerCase();
    return list.filter(it => {
      if (q && !(it.name + ' ' + (it.tags || []).join(' ')).toLocaleLowerCase().includes(q)) return false;
      const done = Engine.isDone(it, date), skipped = Engine.isSkipped(date, it.id);
      return todayFilter === 'done' ? done : todayFilter === 'pending' ? !done && !skipped : true;
    });
  }
  function filterHabits(list) {
    const q = habitQuery.trim().toLocaleLowerCase();
    return q ? list.filter(it => (it.name + ' ' + (it.tags || []).join(' ')).toLocaleLowerCase().includes(q)) : list;
  }
  function period(from, days) {
    let done = 0, total = 0, active = 0;
    const rows = [];
    for (let i = 0; i < days; i++) {
      const date = U.shiftYmd(from, i), rate = Engine.todayRate(date);
      done += rate.done; total += rate.total;
      if (rate.done) active++;
      rows.push({ date, done: rate.done, total: rate.total, pct: rate.pct });
    }
    return { done, total, active, pct: total ? Math.round(done / total * 100) : 0, rows };
  }
  function overview() {
    const today = U.today(), rate = Engine.todayRate(today);
    return { today, rate, week: period(U.shiftYmd(today, -6), 7), previous: period(U.shiftYmd(today, -13), 7) };
  }
  function weekStrip() {
    const today = U.today();
    return '<div class="p-week" aria-label="最近七天，点击查看当天记录">' + period(U.shiftYmd(today, -6), 7).rows.map(row => {
      const current = row.date === today;
      return '<button class="p-day' + (current ? ' current' : '') + '" data-product="history" data-date="' + row.date + '" aria-label="' + E(U.prettyDate(row.date)) + '，完成 ' + row.done + '/' + row.total + '">' +
        '<span>' + (current ? '今天' : U.WEEK[U.weekdayOf(row.date)].replace('周', '')) + '</span><b>' + U.parseYmd(row.date).getDate() + '</b>' +
        '<i class="p-day-dot' + (row.done ? ' filled' : '') + '"></i></button>';
    }).join('') + '</div>';
  }
  /* 「连续」是两种口径，必须在看得见的地方写清楚是谁的连续。
   * 全站连续：每天至少完成一个习惯；单习惯最佳：所有习惯里最长的那个。
   * 芯片放在今日概览卡里 —— 顶栏那两个在 v17 改版后被 CSS 隐藏成了死代码，用户根本看不到。 */
  function bestOfAllHabits() {
    let days = 0, weeks = 0;
    Engine.items().forEach(it => {
      const n = Engine.bestStreak(it.id);
      if (Engine.streakUnit(it) === '周') weeks = Math.max(weeks,n);
      else days = Math.max(days,n);
    });
    return { best:days,unit:'天',weeks };
  }
  /* 概览卡里的三个 chip 已合并成首屏一行文字，这里保留计算函数供别处复用 */
  /* 首屏只留三件事：一句问候、一行进度、一行连续。
   * 大标题第一遍看是鼓励，第二遍打开就是每天重复的 90px 噪音；
   * 打卡是最高频动作，首屏必须让给习惯列表。 */
  function greetLine(rate) {
    const nick = Store.s.settings.nickname;
    const hour = new Date().getHours();
    const g = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const who = nick ? g + '，' + nick : g;
    /* 剩余项数由下面的进度条承担，这里只在「没有安排 / 全部完成」两个特殊状态下补一句，
       否则同一屏会出现「还有 4 项」「0/4」「待完成 4」三个重复数字。 */
    if (!rate.total) return who + ' · 今天没有安排';
    return who + (rate.done >= rate.total ? ' · 今天都完成了' : '');
  }

  function todayHeader() {
    const o = overview(), b = bestOfAllHabits();
    return '<section class="p-today-head" aria-labelledby="todayHeading">' +
      '<div class="p-greet-row">' +
      '<h1 id="todayHeading" class="p-greet">' + E(greetLine(o.rate)) + '</h1>' +
      '<button class="btn p-new" data-act="newhabit" aria-label="新建习惯">' + icon('plus') + '新建</button>' +
      '</div>' +
      '<div class="p-progress-line">' +
      '<span class="p-pl-num"><b id="pDone">' + o.rate.done + '</b><i>/<span id="pTotal">' + o.rate.total + '</span></i></span>' +
      '<span class="p-pl-track" id="pPlTrack" role="progressbar" aria-label="今日完成率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + o.rate.pct + '">' +
      '<i id="pPlBar" style="width:' + o.rate.pct + '%"></i></span>' +
      '<span class="p-pl-pct" id="pPercent">' + o.rate.pct + '%</span>' +
      '</div>' +
      streakLine(b) +
      '</section>';
  }
  /* 顶部这一行是「我做得怎么样」的唯一答案，所以它必须经得起断签那一天的检验（v49）。
   * 旧写法是「连续 <b>0</b> 天」—— 断一次就把前面二十天一笔勾销，这是把人劝退的最短路径。
   * 现在两档：
   *   还在连着 → 「连续 N 天 · 本月 X/Y 天」
   *   断了      → 「今天重新开始 · 本月 X/Y 天」（不出现 0，也不假装没断过）
   * 「本月 X/Y 天」是完成度视角：本月有安排的日子里有多少天做到了。它不会因为断一天归零。
   * 最佳纪录挪进点开的说明里 —— 首屏一行字，塞不下三个数字。 */
  function streakLine(b) {
    const g = Engine.globalStreak();
    const m = Engine.monthRate();
    const seg = g > 0
      ? '连续 <b id="streakNum">' + g + '</b> 天'
      : '今天重新开始<b id="streakNum" hidden>0</b>';
    let tail = '';
    if (m.total) tail += ' · 本月 <b id="monthNum">' + m.done + '</b>/<b id="monthTotal">' + m.total + '</b> 天';
    tail += ' · 累计 <b id="checksNum">' + Engine.totalCheckins() + '</b> 次';
    const aria = g > 0 ? ('连续 ' + g + ' 天，' + (m.total ? '本月完成 ' + m.done + '/' + m.total + ' 天，' : '') +
      '累计打卡 ' + Engine.totalCheckins() + ' 次。点开看计算方式')
      : ('新的连续从今天开始，' + (m.total ? '本月完成 ' + m.done + '/' + m.total + ' 天，' : '') +
        '累计打卡 ' + Engine.totalCheckins() + ' 次。点开看计算方式');
    return '<button class="p-streak-line" data-act="streakinfo" aria-label="' + E(aria) + '">' +
      seg + tail + ' <span aria-hidden="true">›</span></button>' +
      /* 最佳纪录：不再挤在首屏那一行里，但也不能丢 —— 断签那天最该看见的就是它 */
      (b && (b.best || b.weeks)
        ? '<div class="p-best-line">之前最长的一段：' + (b.best ? '<b id="bestNum">' + b.best + '</b> 天' : '') +
          (b.best && b.weeks ? ' · ' : '') + (b.weeks ? '<b id="bestWeeks">' + b.weeks + '</b> 周' : '') + '</div>'
        : '');
  }
  /* 最近 7 天周条：从页首挪到习惯列表之后。
   * 首屏的第一任务是「把今天该做的点掉」，周条属于回顾型内容。
   * 放在打卡区之后，既不影响随时查看，也不会把习惯列表挤出屏幕。 */
  /* 一句人话（v50）：「我在变好吗」是所有图表都没回答、而人最想知道的那句。
   * 近 14 天 vs 前 14 天，涨了几个百分点 —— 一句话说完就走，不占首屏。
   * 样本不足时 Insights 会返回空串，那就什么都不显示（宁可不说，也不说错的）。 */
  function insightLine() {
    if (!window.Insights || !Insights.oneLine) return '';
    const t = Insights.oneLine();
    if (!t) return '';
    return '<div class="p-insight-line">' + icon('chart-line') + '<span>' + E(t) + '</span></div>';
  }
  function weekCard() {
    const o = overview();
    return '<section class="p-week-card"><div class="p-card-title"><h3>一步一步，积累起来</h3><span>最近 7 天</span></div>' + weekStrip() +
      '<div class="p-week-summary"><span>近 7 天已完成 <b id="pWeekDone">' + o.week.done + '</b> 次</span><button class="p-text-button" data-product="go" data-page="grow">查看回顾 ' + icon('arrow-right') + '</button></div></section>';
  }
  function todayTools() {
    const list = Engine.sorted().filter(it => Engine.isDue(it, U.today()));
    const counts = { all: list.length, pending: list.filter(it => !Engine.isDone(it, U.today()) && !Engine.isSkipped(U.today(), it.id)).length, done: list.filter(it => Engine.isDone(it, U.today())).length };
    return '<section class="p-habit-section"><div class="p-list-heading"><h2>今日习惯</h2><div class="p-list-actions">' +
      /* 番茄钟快捷入口（走查第 10 条）：手机端原来要「⋯ → 番茄钟」两步，这里一步到位。
         和右边的「⋯」并排，不新占一行。 */
      '<button class="p-text-button p-tools-btn" data-act="openpomo" aria-label="打开番茄钟" title="番茄钟">' + icon('timer') + '</button>' +
      '<button class="p-text-button p-tools-btn" data-act="opentools" aria-label="显示方式：按时段分组、网格视图" title="显示方式">⋯</button></div></div>' +
      '<div class="p-tools"><div class="p-segments" aria-label="按完成状态筛选">' + [['all','全部'],['pending','待完成'],['done','已完成']].map(([key, label]) =>
        '<button data-product="filter" data-filter="' + key + '" aria-pressed="' + (todayFilter === key) + '" class="' + (todayFilter === key ? 'selected' : '') + '">' + label + ' <span data-count="' + key + '">' + counts[key] + '</span></button>').join('') + '</div>' +
      /* 手机端搜索默认收起：一个常驻输入框要占 50px，而首屏最缺的就是这 50px */
      '<button class="p-search-btn" data-act="tosearch" aria-label="搜索今日习惯">' + icon('magnifying-glass') + '</button>' +
      '<label class="p-search">' + icon('magnifying-glass') + '<input id="todaySearch" type="search" data-product-input="today" value="' + E(todayQuery) + '" placeholder="搜索习惯或标签" aria-label="搜索今日习惯"></label></div></section>';
  }
  function emptyResults() {
    return '<div class="p-empty-result">' + icon(todayFilter === 'pending' ? 'check-circle' : 'magnifying-glass') + '<h3>' +
      (todayQuery ? '没有找到匹配的习惯' : todayFilter === 'pending' ? '这一刻，没有待完成的习惯' : '还没有完成记录') +
      '</h3><p>' + (todayQuery ? '换个关键词，或者回到全部习惯。' : '每天一点点就很好，按你的节奏来。') + '</p><button class="btn ghost" data-product="reset">查看全部习惯</button></div>';
  }
  /* ---------- 一屏网格视图（P1-2，对标 Streaks） ----------
   * 重度用户的诉求是"一屏看全、点一下完成"：每个习惯一个方块，
   * 图标 + 名称 + 环形进度，不占滚动。与卡片视图互斥，开关存在 settings 里。
   * 打卡型点一下即完成；计数 / 时长型点一下开快速记一笔的面板（不然点一次只 +1 很别扭）。 */
  function tileHTML(it) {
    const d = U.today();
    const done = Engine.isDone(it, d);
    const part = Engine.isPartial(it, d);      /* v51：过半但没到目标 —— 不算完成，也不算没做 */
    const skipped = window.Extra ? Extra.isSkipped(d, it.id) : false;
    const pct = Math.round(Engine.progress(it, d) * 100);
    const lg = Engine.getLog(d, it.id) || {};
    const cur = it.type === 'check' || it.type === 'avoid' ? (done ? 1 : 0) : Math.round((lg.v || 0) * 100) / 100;
    const act = it.type === 'check' || it.type === 'avoid' ? 'tick' : 'quickadd';
    const label = it.type === 'check' || it.type === 'avoid'
      ? (done ? '撤销打卡 ' : it.type === 'avoid' ? '今天忍住了 ' : '打卡 ') + it.name
      : '记一笔：' + it.name + '（已完成 ' + cur + '/' + (it.target || 0) + (it.unit || '') + '）';
    return '<div class="p-tile-wrap" data-id="' + it.id + '" style="--c:' + (it.color || '#888') + '">' +
      '<button class="p-tile' + (done ? ' done' : '') + (part ? ' partial' : '') + (skipped ? ' skipped' : '') + '" data-act="' + act + '" data-id="' + it.id + '" ' +
      'style="--p:' + pct + '" aria-pressed="' + done + '" aria-label="' + E(label) + '" title="' + E(label) + '">' +
      '<span class="p-tile-ring"><i></i><b class="p-tile-done">✓</b>' +
      (part ? '<b class="p-tile-part" aria-hidden="true">◐</b>' : '') +
      (it.type !== 'check' && it.type !== 'avoid' ? '<b class="p-tile-num">' + (it.target || 0) + '<small>' + E(it.unit || '') + '</small></b>' : '') +
      '</span><span class="p-tile-name">' + E(it.name) + '</span></button>' +
      '<button class="p-tile-more" data-product="menu" data-id="' + it.id + '" aria-label="更多操作：' + E(it.name) + '">' + icon('dots-three') + '</button></div>';
  }
  function gridHTML(list) {
    return '<div class="p-grid" aria-label="今日习惯，一屏网格视图">' + list.map(tileHTML).join('') + '</div>';
  }
  /* 打卡后就地换掉这一块，不整页重绘（和 patchCard 一个思路） */
  function patchTile(id) {
    const el = document.querySelector('.p-tile-wrap[data-id="' + id + '"]');
    if (!el) return false;
    const it = (window.Store && Store.s.items || []).find(x => x.id === id);
    if (!it) return false;
    const temp = document.createElement('div');
    temp.innerHTML = tileHTML(it);
    const focused=el.contains(document.activeElement) ? (document.activeElement.classList.contains('p-tile-more') ? '.p-tile-more' : '.p-tile') : '';
    const next=temp.firstElementChild; el.replaceWith(next);
    if(focused) next.querySelector(focused).focus({preventScroll:true});
    return true;
  }
  function habitsHeader() {
    return '<div class="p-page-heading"><div><p class="p-eyebrow">属于你的日常</p><h1>习惯管理</h1><p class="p-intro">目标清楚一点，坚持就容易一点。</p></div><button class="btn" data-act="newhabit">' + icon('plus') + '新建习惯</button></div>' +
      '<label class="p-search p-search-wide">' + icon('magnifying-glass') + '<input id="habitSearch" type="search" data-product-input="habits" value="' + E(habitQuery) + '" placeholder="搜索名称或标签" aria-label="搜索我的习惯"></label>';
  }
  function quickNav() {
    return '<section class="p-shortcuts" aria-label="更多功能">' + PAGES.slice(5).map(([key, title, name]) =>
      '<button data-product="go" data-page="' + key + '">' + icon(name) + '<span>' + title + '</span>' + icon('arrow-right') + '</button>').join('') + '</section>';
  }
  function insights() {
    const o = overview();
    const delta = o.week.pct - o.previous.pct;
    const comparison = !o.previous.total ? '积累记录后，可以查看前后两周的变化' : '比前 7 天' + (delta > 0 ? '提高 ' + delta : delta < 0 ? '下降 ' + Math.abs(delta) : '持平，变化 0') + ' 个百分点';
    return '<div class="p-page-heading"><div><p class="p-eyebrow">看见坚持的力量</p><h1>进度回顾</h1><p class="p-intro">数据来自真实记录。休息日不计入计划；请假不计完成，连续纪录按排程计算。</p></div>' +
      '<div class="p-heading-actions"><button class="btn ghost" data-act="printsheet">' + icon('clipboard') + '打印这个月</button>' +
      '<button class="btn ghost" data-act="fixdates">' + icon('calendar-dots') + '查看日历</button></div></div>' +
      '<div class="p-review-summary"><div><span>当前习惯 · 近 7 天完成率</span><b>' + o.week.pct + '<small>%</small></b><p>' + comparison + '</p></div>' +
      '<div><span>完成次数</span><b>' + o.week.done + '</b><p>本周计划 ' + o.week.total + ' 次（' + Engine.items().length + ' 个习惯 × 每天）</p></div><div><span>有行动的日子</span><b>' + o.week.active + '<small> / 7 天</small></b><p>做过，就留下了痕迹</p></div></div>' +
      '<section class="p-chart-card"><div class="p-card-title"><h3>最近 7 天</h3><span>每日完成率 · 点击查看记录</span></div><div class="p-bars">' + o.week.rows.map(row =>
        '<button class="p-bar-column" data-product="history" data-date="' + row.date + '" aria-label="' + E(U.prettyDate(row.date)) + ' 完成率 ' + row.pct + '%"><span>' + row.pct + '%</span><div class="p-bar-track"><i style="height:' + row.pct + '%"></i></div><small>' + U.parseYmd(row.date).getDate() + '日</small></button>').join('') + '</div></section>';
  }
  /* v24 · 回顾页 0 条数据时的引导态：不渲染任何统计卡，只告诉用户这里会出现什么。
   * 评审 4.2：新用户第一次打开就看到 14 个模块与 26 处「0%」，等于被一份空报表劝退。 */
  function reviewEmpty() {
    const n = Engine.items().length;
    return '<div class="p-page-heading"><div><p class="p-eyebrow">看见坚持的力量</p><h1>进度回顾</h1>' +
      '<p class="p-intro">第一条记录之后，这一页才会亮起来。</p></div><button class="btn ghost" data-act="fixdates">' + icon('calendar-dots') + '查看日历</button></div>' +
      '<section class="p-week-card"><div class="p-card-title"><h3>' + (n ? '今天先完成第一条' : '先建第一个习惯') + '</h3><span>三步就能解锁这一页</span></div>' +
      '<div class="p-first-steps">' +
      '<div class="p-first-step"><b>1</b><div><strong>' + (n ? '去今日页打卡' : '建 1 个习惯') + '</strong><span>' + (n ? '点一下右侧的勾选就算完成' : '越小越好，比如「读 5 页书」') + '</span></div></div>' +
      '<div class="p-first-step"><b>2</b><div><strong>坚持两三天</strong><span>这里会先出现本周完成率、最近 7 天和记录日历</span></div></div>' +
      '<div class="p-first-step"><b>3</b><div><strong>攒满 7 个活跃日</strong><span>上周周报、近 12 周趋势、热力图打开；30 个活跃日再开智能洞察与徽章</span></div></div>' +
      '</div><div class="p-week-summary"><span>数据不够时，这里什么都不显示 —— 比显示一堆 0% 更诚实</span></div>' +
      '<div class="p-week-summary"><span>研究里养成一个习惯平均要 66 天，18–254 天都算正常；漏一天也不会把之前的努力清零。</span></div></section>';
  }
  function habitIcon(it) {
    const text = it.name + ' ' + (it.tags || []).join(' ');
    const name = /水|饮/.test(text) ? 'drop' : /读|书|学习/.test(text) ? 'book-open' : /跑|运|健|步/.test(text) ? 'sneaker-move' : /睡|早起|休息/.test(text) ? 'moon' : it.type === 'duration' ? 'timer' : it.type === 'avoid' ? 'shield-check' : 'check-circle';
    return '<span class="p-habit-icon">' + icon(name) + '</span>';
  }
  /* 状态行只回答两件事：数据在不在本机、云端连没连上。
   * 成功绿不承载失败信息；超时 / 401 这类技术错误进 console 与诊断页，不进 UI。 */
  function statusHTML() {
    const status = Store.saveStatus || { state: 'idle' };
    const labels = { idle: '本机记录', pending: '正在保存', saving: '正在保存', saved: '已保存到本机', fallback: '已存备用缓存', error: '保存失败，请导出备份' };
    const cloud = window.Cloud && Cloud.status;
    const signed = !!(window.Cloud && Cloud.signedIn());
    const cs = (cloud && cloud.state) || 'off';
    const cloudLine = !signed ? '云端未登录 · 点此连接'
      : (cs === 'down' || cs === 'error') ? '云端未连接 · 点此重试'
        : cs === 'pending' ? '有记录待同步 · 点此查看'
          : cs === 'loading' ? '正在同步…'
            : '云端已同步';
    const isErr = status.state === 'error';
    const warn = !isErr && signed && (cs === 'down' || cs === 'error');
    return '<button class="p-storage-status' + (isErr ? ' error' : warn ? ' warn' : '') + '" data-product="storage" aria-label="' +
      E(labels[status.state] + '，' + cloudLine) + '">' +
      '<i class="p-status-dot" aria-hidden="true"></i>' +
      '<span>' + labels[status.state] + '<small>' + E(cloudLine) + '</small></span></button>';
  }
  function refresh() {
    if (!window.Store || !Store.s || !window.UI) return;
    const o = overview();
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('pDone', o.rate.done); set('pTotal', o.rate.total); set('pWeekDone', o.week.done);
    const greet = document.getElementById('todayHeading');
    if (greet) greet.textContent = greetLine(o.rate);
    /* 连续与进度在首屏，打卡 / 撤销后要就地更新，不能等下次切页 */
    const g = Engine.globalStreak(), bs = bestOfAllHabits();
    set('streakNum', g); set('bestNum', bs.best); set('bestWeeks', bs.weeks);
    set('pPercent', o.rate.pct + '%');
    const bar = document.getElementById('pPlBar');
    if (bar) bar.style.width = o.rate.pct + '%';
    const track = document.getElementById('pPlTrack');
    if (track) track.setAttribute('aria-valuenow', o.rate.pct);
    const due = Engine.sorted().filter(it => Engine.isDue(it, U.today()));
    const counts = { all: due.length, pending: due.filter(it => !Engine.isDone(it, U.today()) && !Engine.isSkipped(U.today(), it.id)).length, done: due.filter(it => Engine.isDone(it, U.today())).length };
    document.querySelectorAll('[data-count]').forEach(el => { el.textContent = counts[el.dataset.count]; });
    document.querySelectorAll('[data-nav-page]').forEach(el => {
      const current = el.dataset.navPage === UI.tab;
      el.classList.toggle('active', current); if (current) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    document.querySelectorAll('.sw[data-act]').forEach(el => {
      el.setAttribute('role', 'switch'); el.setAttribute('tabindex', '0');
      el.setAttribute('aria-checked', String(el.classList.contains('on')));
      const label = el.parentElement.querySelector('.k'); if (label) el.setAttribute('aria-label', label.textContent);
    });
    const page = PAGES.find(row => row[0] === UI.tab);
    set('pPageTitle', page ? page[1] : '今日');
    document.querySelectorAll('[data-storage-host]').forEach(host => {
      const current = host.querySelector('.p-storage-status');
      if (!current) { host.innerHTML = statusHTML(); return; }
      const temp = document.createElement('div'); temp.innerHTML = statusHTML();
      current.className = temp.firstElementChild.className;
      if (current.innerHTML !== temp.firstElementChild.innerHTML) current.innerHTML = temp.firstElementChild.innerHTML;
    });
    document.querySelectorAll('.p-week .p-day').forEach(button => {
      const row = o.week.rows.find(row => row.date === button.dataset.date); if (!row) return;
      button.setAttribute('aria-label', U.prettyDate(row.date) + '，完成 ' + row.done + '/' + row.total);
      button.querySelector('.p-day-dot').classList.toggle('filled', !!row.done);
    });
  }
  function showStorage() {
    const status = Store.saveStatus || { state: 'idle' };
    const last = status.at ? '最近保存时间：' + U.hhmm(status.at) : '尚无本次会话的保存时间。';
    UI.sheet('记录与备份', '<div class="p-storage-panel">' + statusHTML() + '<p>' + E(last) + '</p><p>未登录时，记录只保存在当前浏览器。更换设备、浏览器或清除网站数据前，请先导出备份。</p>' +
      '<div class="row"><button class="btn" data-act="export">导出备份</button><button class="btn ghost" data-product="go" data-page="connect">连接云账号</button></div></div>');
  }
  function rerenderSearch(input) {
    const kind = input.dataset.productInput, value = input.value;
    if (kind === 'today') todayQuery = value; else habitQuery = value;
    const start = input.selectionStart, end = input.selectionEnd, id = input.id;
    if (!input.isConnected) return;
    UI.render();
    const replacement = document.getElementById(id);
    if (replacement) { replacement.focus({ preventScroll: true }); try { replacement.setSelectionRange(start, end); } catch (e) {} }
  }
  document.addEventListener('input', event => {
    const input = event.target;
    if (!input.dataset || !input.dataset.productInput || event.isComposing) return;
    clearTimeout(inputTimer); inputTimer = setTimeout(() => rerenderSearch(input), 160);
  });
  document.addEventListener('compositionend', event => {
    if (event.target.dataset && event.target.dataset.productInput) {
      clearTimeout(inputTimer); inputTimer = setTimeout(() => rerenderSearch(event.target), 160);
    }
  });
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-product]'); if (!el || !window.UI) return;
    const act = el.dataset.product; event.preventDefault();
    if (act === 'filter') { todayFilter = el.dataset.filter; UI.render(); }
    if (act === 'reset') { todayFilter = 'all'; todayQuery = ''; UI.render(); }
    if (act === 'go') { clearTimeout(inputTimer); UI.closeSheet(); UI.go(el.dataset.page); }
    if (act === 'history') UI.openDayPanel(el.dataset.date);
    if (act === 'menu') UI.openHabitMenu(el.dataset.id);
    if (act === 'storage') showStorage();
    if (act === 'theme') document.getElementById('btnTheme').click();
    if (act === 'voice') { UI.closeSheet(); document.getElementById('btnVoice').click(); }
    /* 「更多功能」原来把 8 个页面又抄了一遍（复检 5.3：导航复制品）——
       底部 5 个标签、桌面侧栏、我的页的「更多入口」都已经能到这些页面。
       这里只放真正的工具：主题、番茄钟、语音打卡 + 存储状态。 */
    if (act === 'more') UI.sheet('更多功能', '<div class="p-more-grid">' +
      '<button data-product="theme">' + icon('moon') + '<span>切换深浅主题</span></button>' +
      '<button data-act="openpomo">' + icon('timer') + '<span>番茄钟</span></button>' +
      '<button data-product="voice">' + icon('microphone') + '<span>语音打卡</span></button>' +
      '</div><div class="muted" style="margin:14px 0 10px">页面入口在底部标签栏和「我的」里，这里只放工具。</div>' +
      '<div data-storage-host>' + statusHTML() + '</div>');
  });
  // 所有已有 role=button 入口都可用 Enter / Space，避免只能鼠标点击。
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = event.target.closest('[role="button"][data-act], [role="switch"][data-act]');
    if (!el || el.tagName === 'BUTTON' || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    event.preventDefault(); el.click();
  });
  document.addEventListener('rigong:save-status', refresh);
  return { icon, filterToday, filterHabits, todayHeader, todayTools, weekCard, habitsHeader, insights, reviewEmpty, quickNav, emptyResults, habitIcon, overview, refresh,
    foldOpen, setFold, tileHTML, gridHTML, patchTile, insightLine, streakLine,
    storageCard: () => '<div class="p-mobile-storage" data-storage-host>' + statusHTML() + '</div>',
    filtered: () => todayFilter !== 'all', state: () => ({ todayFilter, todayQuery, habitQuery }) };
})();
