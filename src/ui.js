/* ============ 界面渲染 ============ */
window.UI = (function () {
  const S = () => Store.s;
  const E = U.esc;
  /* 线性图标：和侧栏、顶栏同一族。emoji 只留给心情选择（那里是内容，不是图标） */
  const ico = name => '<svg class="p-icon i-inline" aria-hidden="true"><use href="assets/icons.svg#' + name + '"></use></svg>';
  let tab = 'today';

  const SLOT_NAME = { morning: '早晨', noon: '午间', afternoon: '下午', evening: '晚间', any: '随时' };
  const SLOT_ORDER = ['morning', 'noon', 'afternoon', 'evening', 'any'];
  /* 挑战图标：老数据（v26 之前建的）没有 icon 字段，按 key 兜底 */
  const CHAL_ICON = { early21: 'sun', water7: 'drop', read30: 'book-open', sport14: 'sneaker-move', zen7: 'lotus', diary21: 'pencil' };
  /* 心情刻度用线性笑脸：和全站 SVG 图标同一套笔触，不再混 emoji */
  const MOODS = ['face-1', 'face-2', 'face-3', 'face-4', 'face-5'];  /* v35 · 复盘三问（外部评审 P1-5）。参考 BeaverHabits 的每日备注与 Noted! 的快速输入：
   * 不新增一套数据结构，就复用正文 —— 复盘的价值在「当天写下」，不在格式。 */
  const REVIEW_Q = [
    { label: '做得好的', q: '今天做得好的：' },
    { label: '遇到的阻碍', q: '遇到的阻碍：' },
    { label: '明天最小一步', q: '明天最小一步：' }
  ];
  const MOOD_WORD = ['很差', '偏差', '一般', '不错', '很好'];

  /* v42 · 走查第 12 条（反馈渠道只说「发给我们」）：把收件箱写明。
   * 上线前把这个常量改成你自己的邮箱，全局只有这一处。 */
  const FEEDBACK_EMAIL = 'rigongyizhu@163.com';

  /* v41 · 报告五-5：更新日志。用户能看到「我的反馈被采纳了」，
   * 比任何一次版本说明都更能建立信任。新版本往最前面加一条即可。 */
  const CHANGELOG = [
    { v: 41, name: '更结实的地基', what: '本地快照搬进更大的存储（不再有配额上限）；备份文件带校验和，半截文件会被拦下来；回顾页可以生成年度海报。' },
    { v: 40, name: '看得见的规律', what: '智能洞察新增三条：下雨天最容易断、步数高的日子其他习惯也更容易完成、你实际都在几点做。' },
    { v: 39, name: '提醒不吵', what: '同时到点的几个习惯合成一条通知，30 分钟内不再响第二声；番茄钟可以绑定习惯，结束时一键把分钟数记进去。' },
    { v: 38, name: '口径对齐', what: '没登录时照片只说「只存在这台设备」；隐私说明加了一张「数据去哪了」的表；排行榜不再永远转圈。' },
    { v: 37, name: '提醒更扛事', what: '到点没打卡会再叫两次；习惯可以填「什么时候做」，写进提醒正文。' }
  ];

  function $(id) { return document.getElementById(id); }

  /* ---------------- 顶部 ---------------- */
  function paintTop() {
    const d = U.today();
    $('tDate').textContent = U.prettyDate(d);
    const r = Engine.todayRate(d);
    const nick = S().settings.nickname;
    $('tSub').textContent = r.total === 0 ? '还没有习惯，去「习惯」页添加'
      : r.pct === 100 ? (nick ? nick + '，今天全部完成 🎉' : '今天全部完成 🎉')
      : '今天还有 ' + (r.total - r.done) + ' 项待完成';
    $('ringPct').textContent = r.pct;
    const ringEl = $('ring');
    if (ringEl) {
      ringEl.setAttribute('aria-valuenow', r.pct);
      ringEl.setAttribute('aria-label', '今日完成率 ' + r.pct + '%，' + r.done + '/' + r.total + ' 项');
    }
    const C = 2 * Math.PI * 18.5;
    $('ringFg').style.strokeDashoffset = C * (1 - r.pct / 100);
    paintHeaderDots();
  }

  /* 提醒 / 云备份：有事儿才亮红点，没事不占地方 */
  function notifyNeeded() {
    if (!window.Remind) return false;
    try { if (Remind.needGuide()) return true; } catch (e) { }
    try { if (Remind.pendingList().length) return true; } catch (e) { }
    return false;
  }
  function cloudNeeded() {
    if (!window.Cloud) return false;
    try {
      /* 后端不在就别催用户登录 —— 点了也只会失败，反倒像应用坏了 */
      if (Cloud.backendState && Cloud.backendState().state === 'down') return false;
      return !Cloud.signedIn() && !!Cloud.isReady() && !S().settings.cloudHintOff;
    } catch (e) { return false; }
  }
  /* 提醒 / 云备份 已经收进「我的」：红点画在「我的」入口和页内两行上
   * （桌面是侧栏按钮，手机是底部 tab，两个都标） */
  function paintHeaderDots() {
    const need = notifyNeeded(), cloud = cloudNeeded();
    document.querySelectorAll('[data-nav-page="me"], #tab-me').forEach(el => {
      el.classList.toggle('has-dot', need || cloud);
    });
    const nd = $('meNotifyDot'); if (nd) nd.classList.toggle('on', need);
    const cd = $('meCloudDot'); if (cd) cd.classList.toggle('on', cloud);
  }

  /* ---------------- 今日 ---------------- */
  /* 右侧控件：打卡钮 / 加减计数器。单独抽出来，是为了连点时
   * 只改里面的数字文本，不换掉整个节点 —— 节点一换，手指底下那个
   * 按钮就消失了，快速连点会丢事件（点 20 下只生效 3 下）。 */
  function ctlHTML(it, d) {
    const lg = Engine.getLog(d, it.id) || {};
    if (it.type === 'check' || it.type === 'avoid') {
      const done = Engine.isDone(it, d);
      return '<button class="tick" data-act="tick" data-id="' + it.id + '" aria-pressed="' + done + '" aria-label="' + (done ? '撤销打卡 ' : '打卡 ') + E(it.name) + '" title="' + (done ? '撤销打卡' : it.type === 'avoid' ? '今天忍住了' : '打卡') + '"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    }
    /* 轻量完成：数值/时长型习惯今天只做了最小版，就不再摆一个「0」的加减器 ——
     * 那会让人以为「我什么都没做」，而实际上今天已经算完成了。 */
    if (lg.mini) {
      return '<button class="mini-chip on" data-act="minitoday" data-id="' + it.id + '" title="轻量完成，点一下取消">' +
        ico('sprout') + '<span>轻量</span></button>';
    }
    /* 时长型习惯（v31 · 4.6 计时绑定）：这一行的主角从「加减分钟」换成「计时」。
     * 点「开始」1 次就进入计时，到点自动打卡；要手动补录（没开 App 做的那次），
     * 点数值上的「快速记一笔」。
     * 之所以把加减器整组换掉而不是并排：chip + 完整加减器在 390px 下会把习惯名
     * 挤到 3px 宽（v26_touch / v26_a11y 抓到的塌陷热区），而计时才是时长习惯的主路径。 */
    if (it.type === 'duration') {
      const running = window.Timer && Timer.isFor(it.id);
      /* 数值丸只放数字：单位在下面 meta 行（目标 30 分钟）里，
         390px 上每一像素都得花在习惯名上 ——「读书 30 分钟」七个字容不得省略号。 */
      return '<span class="d-val" data-act="quickadd" data-id="' + it.id + '" role="button" tabindex="0" ' +
        'aria-label="给「' + E(it.name) + '」手动记一笔时长" title="点一下手动记一笔">' +
        U.numShort((lg.v || 0)) + '</span>' +
        (running
          ? '<button class="t-chip run" data-act="timeropen" data-id="' + it.id + '" title="正在计时，点开面板" aria-label="「' + E(it.name) + '」正在计时">' + ico('pause') + '<span>计时中</span></button>'
          : '<button class="t-chip" data-act="timerstart" data-id="' + it.id + '" title="开始计时，到点自动打卡" aria-label="开始计时：' + E(it.name) + '">' + ico('play') + '<span>开始</span></button>');
    }
    const v = U.numShort((lg.v || 0));
    /* 窄屏（<360px）把 stepper 收成一个「＋」：三件套在 320px 上会挤掉标题和 meta，
       而窄屏用户点加号的次数远多于点减号。CSS 负责切换，这里两份都渲染。 */
    return '<div class="stepper">' +
      '<button data-act="minus" data-id="' + it.id + '" aria-label="减少 ' + E(it.name) + '">−</button>' +
      '<span class="val" data-act="quickadd" data-id="' + it.id + '" role="button" tabindex="0" aria-label="记一笔 ' + E(it.name) + '：可以一次达标或手动输入" title="点一下：一次达标 / 手动输入">' + v + '<small style="font-size:12px;color:var(--txt-3)"> ' + E(it.unit || '') + '</small></span>' +
      '<button data-act="plus" data-id="' + it.id + '" aria-label="增加 ' + E(it.name) + '">+</button></div>' +
      '<button class="h-narrow-add" data-act="quickadd" data-id="' + it.id + '" aria-label="记一笔 ' + E(it.name) + '" title="记一笔">＋</button>';
  }

  /* 卡片左侧那行小字（目标 / 排程 / 强度…），打卡后会变，单独抽出来以便就地更新。
   * 每项都带一个语义 class：窄屏只留「时间 + 目标」，其余靠 CSS 收起，
   * 这样不用为断点渲染两套 DOM，也不会出现内容闪烁。 */
  /* 年度型排程的展示文案：'03-15' → '3/15'（v50） */
  function yearlyText(it) {
    const ds = ((it.schedule || {}).dates || []);
    return ds.map(md => (+md.slice(0, 2)) + '/' + (+md.slice(3))).join('、');
  }
  /* 休息额度的展示文案（v49 每周 / v51 每月）：一个地方出，卡片与详情不会说法不一致 */
  function restText(it) {
    const q = Engine.restQuota ? Engine.restQuota(it) : null;
    if (!q) return '';
    return (q.span === 'month' ? '每月' : '每周') + '可休 ' + q.n + ' 天';
  }

  function metaHTML(it, d) {
    const meta = [];
    const add = (cls, html) => meta.push('<span class="' + cls + '">' + html + '</span>');
    if (it.type !== 'check' && it.target) add('m-target', '目标 ' + U.num(it.target) + (it.unit || ''));
    /* v52 · 报告 P1-6：数值型卡片只说「目标 30 分钟」，不说「还差多少」——
     * 于是用户只能盯着 0 和 30 自己算，也就更容易觉得「差太远，算了」。
     * 只差一点的时候明确说出来，是最省力的推力。 */
    if (d && it.type !== 'check' && it.type !== 'avoid' && it.target && !Engine.isDone(it, d)) {
      const cur = (Engine.getLog(d, it.id) || {}).v || 0;
      const left = Math.round((it.target - cur) * 100) / 100;
      if (left > 0 && left < it.target) add('m-left', '还差 ' + U.numShort(left) + (it.unit || ''));
    }
    /* 提醒时间：钟面换成和侧栏同一族的线性图标 —— emoji 每个平台长得不一样，
       还比图标宽一截，卡片 meta 更容易折行（复检 3.6 / 3.1）。 */
    if (it.reminderAt) add('m-time', ico('clock') + ' ' + it.reminderAt);
    const sc = it.schedule || {};
    if (sc.type === 'timesPerWeek') {
      const wp = Engine.weekProgress(it, d);
      add('m-week', '本周 ' + (wp ? wp.done + '/' + wp.target : (sc.n || 1)));
    }
    if (sc.type === 'weekdays') add('m-days', '周' + (sc.days || []).map(x => '日一二三四五六'[x]).join(''));
    if (sc.type === 'interval') add('m-interval', '每 ' + sc.n + ' 天');
    if (sc.type === 'yearly') add('m-yearly', '每年 ' + yearlyText(it));
    /* 休息日（v49 每周 / v51 每月）：写在卡片上，是为了让「今天没做」这件事有个说清楚的余地 */
    if (Engine.restQuota(it)) add('m-rest', restText(it));
    /* 部分完成（v51）：做到一半以上时明确告诉用户「今天不算断」——
     * 不说这句，他看到没打勾就会以为又断了，剩下那一半也就懒得做。 */
    if (d && Engine.isPartial(it, d)) add('m-part', '已过半 · 今天不断');
    if (window.Extra) {
      const sco = Extra.scoreOf(it.id);
      /* 新习惯第一天就贴「脆弱」等于先给用户一个差评，改成「起步中」 */
      const ageDays = Math.floor((Date.now() - (it.createdAt || 0)) / 86400000);
      const kind = Engine.isAvoid(it) ? 'avoid' : '';
      const lv = ageDays < 7 ? { txt: '起步期', color: 'var(--txt-3)' } : Extra.scoreLevel(sco, kind);
      /* 数据不够 7 天时，强度分本身没有参考价值（分母太小），
         改成一句能看懂的具体进度，别用一个孤零零的「图标 + 7 起步中」占位。 */
      const tip = kind === 'avoid'
        ? '戒断强度：按连续未破戒天数计算，破戒会重置，历史最佳保留'
        : '习惯强度：看长期稳定性，漏一天不会归零';
      /* 走查第 7 条：「距 7 天还差 7 天」读起来别扭，而且新习惯当天 sco=0 时
       * 这一行什么都不显示。改成：不够 7 天就给一句具体进度 —— 首日是「今天开始积累」，
       * 2–6 天是「再坚持 N 天」，都不再重复「距 7 天」。 */
      if (ageDays < 7) add('m-score',
        '<span class="m-score" title="强度分要等数据攒满 7 天才开始算，现在说的是真实进度">' + ico('chart-line') + ' ' +
        (ageDays <= 1 ? '今天开始积累，攒满 7 天解锁强度分' : '再坚持 ' + (7 - ageDays) + ' 天解锁强度分') + '</span>');
      else if (sco > 0) add('m-score',
        '<span class="m-score" title="' + tip + '">' + ico('chart-line') + ' <b style="color:' + lv.color + '">' + sco + '</b> · ' + lv.txt + '</span>');
    }
    return meta.length ? meta.join('') : '<span class="muted">点击右侧打卡</span>';
  }

  /* 坚持的燃料：一行里塞进「当前连击 / 历史最佳 / 近 30 天完成率 / 本周 7 天圆点」。
   * 信息不少，但都压成 11px 的小字和 6px 的圆点，不抢打卡按钮的位置。 */
  function trendHTML(it, d) {
    const unit = Engine.streakUnit(it);
    /* 戒断型的「连续」= 连续未破戒天数，不是连续打勾天数：破戒那天本来就不该有打卡记录 */
    const avoid = Engine.isAvoid(it);
    const s = avoid ? Engine.cleanStreakOf(it.id, d) : Engine.streakOf(it.id, d);
    const best = avoid ? Engine.bestCleanStreak(it.id) : Engine.bestStreak(it.id);
    const rate = window.Extra ? Extra.rateOf(it, 30) : { pct: 0, done: 0, total: 0 };
    const dots = (window.Extra && Extra.weekDots) ? Extra.weekDots(it.id) : [];
    const ico = it.type === 'avoid' ? 'shield-check' : 'fire';
    /* 卡片上这个数字是「这个习惯自己」的连续，必须和首屏的「连续」区分开，
       否则同屏出现两个 🔥 N 天，用户根本分不清说的是哪个。
       完成率一律带样本量：样本不足 7 天不显示百分比，否则「1 天 100%」会被读成「30 天全勤」。 */
    let html = '<div class="h-trend">';
    html += '<span class="tr-st' + (s > 0 ? ' on' : '') + '" title="「' + E(it.name) + '」连续 ' + s + ' ' + unit + '；首屏的「连续」是全站口径">' + UI.icoIn(ico) + ' 连续 <b>' + s + '</b><small>' + unit + '</small></span>';
    if (best > s) html += '<span class="tr-best" title="这个习惯历史最长连续 ' + best + ' ' + unit + '">最佳 ' + best + '</span>';
    html += '<span class="tr-rate" title="近 30 天里，该做且没请假的日子里完成了 ' + rate.done + '/' + rate.total + ' 天">' +
      Engine.rateLabel(it.id, 30).text + '</span>';
    html += '<span class="dots" aria-label="本周完成情况">' + dots.map(x =>
      '<i class="d-' + x.state + (x.today ? ' now' : '') + '" title="' + U.prettyDate(x.date) + '"></i>').join('') + '</span>';
    html += '</div>';
    return html;
  }

  function cardHTML(it) {
    const d = U.today();
    const done = Engine.isDone(it, d);
    const lg = Engine.getLog(d, it.id) || {};
    const locked = it.dependsOn && !Engine.isDone((S().items || []).find(x => x.id === it.dependsOn) || {}, d);
    const p = Engine.progress(it, d);
    const ctl = ctlHTML(it, d);
    const meta = metaHTML(it, d);

    let stepsHTML = '';
    if ((it.steps || []).length) {
      stepsHTML = '<div class="h-bar" style="margin-top:9px"></div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' +
        it.steps.map((s, i) => {
          const on = lg.steps && lg.steps[i];
          return '<button class="chip' + (on ? ' on' : '') + '" data-act="step" data-id="' + it.id + '" data-i="' + i + '" style="font-size:12px;padding:4px 9px">' +
            (on ? '✓ ' : '') + E(s) + '</button>';
        }).join('') + '</div>';
    }

    const skipped = window.Extra ? Extra.isSkipped(d, it.id) : false;
    const slipped = it.type === 'avoid' && window.Engine.slipped && Engine.slipped(it, d);
    const miniDone = Engine.isMiniDone(it, d);

    /* 请假 / 破戒 / 补卡 / 统计 都收进长按菜单，卡片上只留打卡这一件事。
     * 手势：右滑打卡 / 取消，左滑开菜单 —— 揭示层必须在 .h-sw-body 之外，
     * 否则卡片内容一平移就把它一起带走了。 */
    return '<div class="hitem' + (done ? ' done' : '') + (locked ? ' locked' : '') + (skipped ? ' skipped' : '') + '" style="--c:' + (it.color || '#888') + '" data-id="' + it.id + '" data-sw="1">' +
      '<div class="h-sw h-sw-l" aria-hidden="true"><span class="h-sw-ico">' + ico('check') + '</span><b class="sw-t-on">完成</b><b class="sw-t-off">取消</b></div>' +
      '<div class="h-sw h-sw-r" aria-hidden="true"><span class="h-sw-ico">' + ico('dots-three') + '</span><b>更多</b></div>' +
      '<div class="h-sw-body">' +
      (window.Product ? Product.habitIcon(it) : '') +
      '<div class="h-main">' +
      '<div class="h-name" data-act="habitdetail" data-id="' + it.id + '" role="button" tabindex="0" aria-label="查看「' + E(it.name) + '」详情" style="cursor:pointer">' + E(it.name) +
      (locked ? ' <span class="muted lock-tip" style="font-size:12px">· 需先完成前置</span>' : '') +
      (skipped ? ' <span class="muted skip-tip" style="font-size:12px">· 今天请假，不算断</span>' : '') +
      (miniDone ? ' <span class="mini-tip">轻量完成</span>' : '') +
      (slipped ? ' <span class="muted" style="font-size:12px;color:var(--danger)">· 今天破戒了</span>' : '') +
      ' <span class="muted" style="font-size:12px">›</span></div>' +
      '<div class="h-meta">' + meta + '</div>' +
      trendHTML(it, d) +
      (it.type !== 'check' ? '<div class="h-bar"><i style="width:' + (p * 100) + '%"></i></div>' : '') +
      stepsHTML +
      '</div><div class="h-ctl">' + ctl + '</div>' +
      (window.Product ? '<button class="p-habit-menu" data-product="menu" data-id="' + E(it.id) + '" aria-label="管理' + E(it.name) + '">' + Product.icon('dots-three') + '</button>' : '') + '</div></div>';
  }

  /* 提醒状态文案（设置页） */
  function remindStatus() { return window.Remind ? Remind.statusText() : '到点弹出系统通知'; }

  /* 提醒引导卡：有习惯但从没授权通知时，在今日页顶部出现一次 */
  function remindGuideCard() {
    if (!window.Remind || !Remind.needGuide()) return '';
    return '<div class="quote remind-guide">' +
      '<span class="q-mark">🔔</span><div class="q-body">' +
      '<div class="q-t">你已经设好了提醒时间，但还没允许通知 —— 这样到点是不会响的。</div>' +
      '<div class="q-a">开启后，到点会弹系统通知，点「去打卡」即可直接记录。</div>' +
      '<div class="bc-acts" style="margin-top:10px">' +
      '<button class="chip on" data-act="remindon">开启提醒</button>' +
      '<button class="chip" data-act="remindlater">今天先不用</button>' +
      '<button class="chip" data-act="plg_calendar">改用系统日历</button>' +
      '</div></div></div>';
  }

  /* 未登录时的云备份引导：轻提示，可关闭且记住
   * 只在 boot 跑完、确认未登录时才显示，避免已登录用户每次开屏闪一下 */
  function cloudBackupHint(slim) {
    if (!window.Cloud || Cloud.signedIn()) return '';
    if (!Cloud.isReady()) return '';
    /* 后端不可用时这条"登录一次就不会丢"就是在画饼，直接不显示 */
    if (Cloud.backendState && Cloud.backendState().state === 'down') return '';
    if (S().settings.cloudHintOff) return '';
    if (slim) {
      return '<div class="hm-line"><span class="hm-ico">' + ico('cloud') + '</span>' +
        '<span class="hm-main"><b>还没开云备份</b>' +
        '<small>数据只在这台设备上，登录一次换手机也不丢</small></span>' +
        '<button class="btn sm ghost" data-act="cloudlogin">登录</button></div>';
    }
    return '<div class="cld-hint">' +
      '<span class="ci-ico">' + ico('cloud') + '</span>' +
      '<div class="ci-main">' +
      '<div class="ci-t">还没开云备份</div>' +
      '<div class="ci-s">现在的数据只在这台设备上。登录一次，换手机、清缓存都不会丢。</div>' +
      '</div>' +
      '<button class="btn sm" data-act="cloudlogin">登录</button>' +
      '<button class="ci-x" data-act="dismisscloudhint" aria-label="不再提示">' + ico('x') + '</button>' +
      '</div>';
  }

  /* 换地址提醒
   * 应用重新部署会换域名，而浏览器数据是按域名隔离的 —— 新地址上一片空白，
   * 用户的习惯和记录其实还留在旧地址下。这里检测到"这份数据来自别的地址"时
   * 明确告诉他，并把导入入口直接摆在面前，而不是让他对着空应用发呆。 */
  function movedHint(slim) {
    const st = S();
    if (st.settings.movedHintOff) return '';
    const from = st.settings.lastOrigin;
    let now = '';
    try { now = location.origin; } catch (e) { return ''; }
    if (!from || !now || from === now) return '';
    /* 只有当本机确实有数据时才有意义 —— 空的新地址上由导入引导负责 */
    const hasData = Object.keys(st.logs || {}).length > 0 || Object.keys(st.notes || {}).length > 0;
    if (!hasData) return '';
    let host = from;
    try { host = new URL(from).host; } catch (e) { }
    if (slim) {
      return '<div class="hm-line"><span class="hm-ico">' + ico('pin') + '</span>' +
        '<span class="hm-main"><b>应用换了网址</b>' +
        '<small>记录来自 ' + E(host) + '，导入旧备份可合并回来</small></span>' +
        '<button class="btn sm ghost" data-act="import">导入</button></div>';
    }
    return '<div class="cld-hint moved">' +
      '<span class="ci-ico">' + ico('pin') + '</span>' +
      '<div class="ci-main">' +
      '<div class="ci-t">应用换了网址</div>' +
      '<div class="ci-s">这份记录来自 <b>' + E(host) + '</b>。旧网址下的记录不在这台设备上，导入旧备份即可合并回来。</div>' +
      '</div>' +
      '<button class="btn sm" data-act="import">导入旧备份</button>' +
      '<button class="ci-x" data-act="dismissmovedhint" aria-label="不再提示">' + ico('x') + '</button>' +
      '</div>';
  }

  /* 该备份了：数据只在本机时，隔一段时间提醒一次
   * 这是"地址一变、或者换手机"时唯一能救命的东西，值得主动提醒一次。 */
  const BACKUP_REMIND_DAYS = 7;   // v44：按「建议每周导出一次」的口径（原 14 天）
  /* 手机端判定：和 assets/product.css 的 520px 断点保持一致。
   * 走查第 9 条的首屏瘦身只对窄屏生效，桌面端一律保持原样。 */
  function isNarrow() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 520px)').matches);
  }

  function backupDueHint(slim) {
    const st = S();
    if (st.settings.backupHintOff) return '';
    /* 已经开了云备份并且云端可用 → 不需要本地备份提醒 */
    if (window.Cloud && Cloud.signedIn() && Cloud.backendState && Cloud.backendState().state === 'up') return '';
    /* 数据太少的用户别打扰：但门槛要低，有真正记录在积累就该提醒了。
     * v52 · 报告 P1-4：原来是「有 1 条记录就提醒」—— 新用户第一天打完卡就被推一次导出，
     * 首屏上还挤着安装引导和下一步引导，一屏四张卡全是「你该做点什么」。
     * 改成攒到 3 天/3 条再说：那时候他才有东西值得备份。 */
    const logs = Object.keys(st.logs || {}).length;
    const notes = Object.keys(st.notes || {}).length;
    const todos = (st.todos || []).length;
    if (logs + notes + todos < 3) return '';
    const last = st.settings.lastBackupAt || 0;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    if (days !== null && days < BACKUP_REMIND_DAYS) return '';
    if (slim) {
      /* 手机端瘦身版：一行，不带自己的 ×（整条提示条共用一个 ×，见 homeHints） */
      return '<div class="hm-line"><span class="hm-ico">' + ico('package') + '</span>' +
        '<span class="hm-main"><b>' + (last ? '该备份了' : '还没备份过') + '</b>' +
        '<small>' + (last ? '上次导出在 ' + days + ' 天前 · ' : '') + '数据只在这台设备上，导出一次存好</small></span>' +
        '<button class="btn sm ghost" data-act="quickexport">导出</button></div>';
    }
    return '<div class="cld-hint backup">' +
      '<span class="ci-ico">' + ico('package') + '</span>' +
      '<div class="ci-main">' +
      '<div class="ci-t">' + (last ? '该备份了' : '还没备份过') + '</div>' +
      '<div class="ci-s">' + (last ? '上次导出在 ' + days + ' 天前。' : '') +
      '数据只在这台设备上，导出一次存好，换手机或清缓存都能救回来。</div>' +
      '</div>' +
      '<button class="btn sm" data-act="quickexport">导出</button>' +
      '<button class="ci-x" data-act="dismissbackuphint" aria-label="不再提示">' + ico('x') + '</button>' +
      '</div>';
  }

  /* 数据与存储 · 常驻状态条（v44 · 走查 P0-③）
   * 数据只在这台设备的浏览器里，没有服务器副本。用户最容易犯的错不是「忘了备份」，
   * 而是「根本不知道要备份」。所以这行常驻、不给关，就在「数据与存储」标题下面。 */
  function backupStatusLine() {
    const st = S();
    const last = st.settings.lastBackupAt || 0;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    let cloud = false;
    try { cloud = !!(window.Cloud && Cloud.signedIn() && Cloud.backendState && Cloud.backendState().state === 'up'); } catch (e) { }
    const stale = !cloud && (days === null || days >= 7);
    let txt;
    if (cloud) txt = '已开启云备份' + (days === null ? '' : ' · 上次本机导出在 ' + days + ' 天前');
    else if (days === null) txt = '还没导出过备份 · 数据只在这台设备（这个浏览器）里';
    else txt = '上次导出在 ' + (days === 0 ? '今天' : days + ' 天前') + ' · 建议每周一次';
    return '<div class="bk-bar' + (stale ? ' warn' : '') + '">' +
      '<span class="bk-ico">' + ico('package') + '</span>' +
      '<span class="bk-t">' + E(txt) + '</span>' +
      '<button class="btn sm ghost" data-act="quickexport">导出</button></div>';
  }

  /* 隐私锁（v46 · 对标 Habitify 的 Privacy Lock）
   * 文案里必须写清「这是屏幕锁、不是加密」—— 加密导出才是真加密，两者不能混着说。 */
  function lockCard() {
    if (!window.Lock) return '';
    if (!Lock.available()) {
      return '<div class="card"><div class="muted" style="line-height:1.7">这台设备或当前连接方式不支持加密接口，隐私锁不可用。' +
        '用 https 打开即可。</div></div>';
    }
    const on = Lock.enabled();
    if (!on) {
      return '<div class="card">' +
        cell('#lock', '开启隐私锁', '打开应用时要输 4–8 位数字，挡住随手翻看的人', 'locksetup') +
        '<div class="muted" style="margin-top:8px;line-height:1.7">' +
        '它是<b>屏幕锁</b>，不是加密 —— 能拿到设备文件的人仍可能读到数据；要真正加密请用「加密导出」。</div></div>';
    }
    const sc = Lock.scope();
    return '<div class="card">' +
      '<div class="line-cell"><div><div class="k">隐私锁已开启</div>' +
      '<div class="s">' + (sc === 'all' ? '每次打开应用都要解锁' : '只在打开日记页时解锁') + '</div></div>' +
      '<div class="sw on" data-act="locktogg" role="switch" aria-checked="true" tabindex="0"><i></i></div></div>' +
      '<div class="field" style="margin-top:12px"><label>锁定范围</label><div class="chips">' +
      [['all', '整个应用'], ['diary', '只锁日记']].map(o =>
        '<button class="chip' + (sc === o[0] ? ' on' : '') + '" data-act="lockscope" data-v="' + o[0] + '">' + o[1] + '</button>').join('') +
      '</div><div class="s" style="margin-top:6px">「只锁日记」适合家里共用一台设备：打卡不设防，日记要密码</div></div>' +
      '<button class="btn ghost" data-act="locknow" style="margin-top:10px">立即锁定</button>' +
      '<div class="muted" style="margin-top:8px;line-height:1.7;font-size:12px">' +
      '屏幕锁，不是加密。忘记密码无法找回（本机不存明文）—— 只能清掉本站数据，或用备份在别的设备恢复。</div></div>';
  }

  /* 设置 / 关闭隐私锁的两个弹窗（v46） */
  function openLockSetup() {
    const sc = (window.Lock && Lock.scope()) || 'all';
    sheet('设置隐私锁',
      '<div class="muted" style="margin-bottom:10px">设一个 4–8 位数字密码。它是<b>屏幕锁</b>，不是加密。</div>' +
      '<input class="input" id="pin1" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="输入数字密码" aria-label="数字密码">' +
      '<input class="input" id="pin2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="再输一次" aria-label="再次输入数字密码" style="margin-top:8px">' +
      '<div class="field" style="margin-top:12px"><label>锁定范围</label><div class="chips">' +
      [['all', '整个应用'], ['diary', '只锁日记']].map(o =>
        '<button class="chip' + (sc === o[0] ? ' on' : '') + '" data-act="pinscope" data-v="' + o[0] + '">' + o[1] + '</button>').join('') +
      '</div><div class="s" style="margin-top:6px">选「只锁日记」时，打卡不用密码，打开日记才要</div></div>' +
      '<div class="muted" id="pinErr" style="color:var(--danger);margin-top:8px;min-height:18px"></div>' +
      '<button class="btn" data-act="locksave" style="margin-top:4px">开启隐私锁</button>' +
      '<div class="muted" style="margin-top:10px;font-size:12px;line-height:1.7">忘记密码无法找回 —— 本机只存派生结果，不存密码本身。</div>');
    setTimeout(() => { const el = $('pin1'); if (el) el.focus({ preventScroll: true }); }, 80);
  }

  function openLockOff() {
    sheet('关闭隐私锁',
      '<div class="muted" style="margin-bottom:10px">先输入当前密码，确认是你本人。</div>' +
      '<input class="input" id="pinOff" type="password" inputmode="numeric" maxlength="8" placeholder="当前数字密码" aria-label="当前数字密码">' +
      '<div class="muted" id="pinOffErr" style="color:var(--danger);margin-top:8px;min-height:18px"></div>' +
      '<button class="btn danger" data-act="lockoff" style="margin-top:4px">关闭隐私锁</button>');
    setTimeout(() => { const el = $('pinOff'); if (el) el.focus({ preventScroll: true }); }, 80);
  }

  /* 首页顶部提示条汇总：按重要性排序，一次最多显示两条，免得糊一屏。
   * slim=true（手机端，走查第 9 条）时把它们合成一条提示条：各占一行、
   * 共用一个 ×，关掉后 7 天内不再出现；桌面端仍是原来的卡片，一条不多一条不少。 */
  function homeHints(slim) {
    const items = [];
    try { const h = movedHint(slim); if (h) items.push(h); } catch (e) { }
    try { const h = backupDueHint(slim); if (h) items.push(h); } catch (e) { }
    try { const h = cloudBackupHint(slim); if (h) items.push(h); } catch (e) { }
    if (!slim) return items.slice(0, 2).join('');
    const st = S();
    if (st.settings.hintSnoozeAt && Date.now() - st.settings.hintSnoozeAt < 7 * 86400000) return '';
    const lines = items.slice(0, 2);
    try { const b = buddyInviteLine(); if (b) lines.push(b); } catch (e) { }
    if (!lines.length) return '';
    return '<div class="home-hints">' + lines.join('') +
      '<button class="hh-x" data-act="hintsnooze" aria-label="7 天内不再提示">' + ico('x') + '</button></div>';
  }

  /* 自动保存的"回执"：写入是静默的，用户写完会怀疑到底存没存。
   * 失焦时给一颗一闪而过的小胶囊，不打断输入。 */
  let _savedEl = null, _savedT = null;
  function savedTip(msg) {
    let el = document.getElementById('savedTip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'savedTip';
      el.className = 'saved-tip';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    _savedEl = el;
    el.textContent = msg || '已保存';
    el.classList.add('on');
    clearTimeout(_savedT);
    _savedT = setTimeout(() => { try { el.classList.remove('on'); } catch (e) { } }, 1500);
  }

  /* 添加到桌面引导：习惯类 App 的留存几乎全靠「桌面图标 + 一点就开」，
   * 有 manifest/SW 却不说，等于白做。安卓拿到 beforeinstallprompt 直接装，
   * iOS 没有这个事件，只能教用户走「分享 → 添加到主屏幕」。 */
  function installCard() {
    const st = S();
    if (st.settings.pwaInstalled || st.settings.pwaHintOff) return '';
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return '';
    const canInstall = !!window.__pwaPrompt;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') && !window.navigator.standalone;
    if (!canInstall && !isIOS) return '';
    /* v52 · 报告 P1-4：安装引导不该跟「第一次打卡」抢首屏 ——
     * 先让他把今天的事做完，第二天再劝他装到桌面。 */
    if (Object.keys(st.logs || {}).length < 2) return '';
    return '<div class="pwa">' +
      '<span class="pw-ico">📲</span>' +
      '<div class="pw-main">' +
      '<div class="pw-t">把「日拱一卒」放到桌面</div>' +
      '<div class="pw-s">' + (canInstall ? '一点就能打卡，不用每次输网址。' : 'Safari 点底部「分享」→「添加到主屏幕」。') + '</div>' +
      '</div>' +
      '<button class="btn sm" data-act="installpwa">' + (canInstall ? '安装' : '看步骤') + '</button>' +
      '<button class="pw-x" data-act="dismisspwa" aria-label="不再提示">✕</button></div>';
  }

  /* 空状态引导插画：一棵刚发芽的小苗 */
  function emptyArt() {
    return '<svg class="e-art-svg" viewBox="0 0 200 140" width="170" height="119" aria-hidden="true">' +
      '<defs>' +
      '<radialGradient id="egGlow" cx="50%" cy="46%" r="52%">' +
      '<stop offset="0%" stop-color="var(--accent)" stop-opacity=".20"/>' +
      '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>' +
      '</radialGradient>' +
      '<linearGradient id="egLeaf" x1="0" y1="1" x2="1" y2="0">' +
      '<stop offset="0%" stop-color="#3ecf7a"/><stop offset="100%" stop-color="#8bdb9a"/>' +
      '</linearGradient>' +
      '<linearGradient id="egLeaf2" x1="1" y1="1" x2="0" y2="0">' +
      '<stop offset="0%" stop-color="#2f9870"/><stop offset="100%" stop-color="#63bd92"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<circle cx="100" cy="66" r="56" fill="url(#egGlow)"/>' +
      '<circle class="e-dot d1" cx="46" cy="34" r="3" fill="var(--accent)" opacity=".5"/>' +
      '<circle class="e-dot d2" cx="158" cy="44" r="4" fill="#ff9a3c" opacity=".45"/>' +
      '<circle class="e-dot d3" cx="150" cy="92" r="2.6" fill="var(--accent)" opacity=".4"/>' +
      '<path d="M58 106 q42 -15 84 0" fill="none" stroke="var(--line)" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M100 106 V60" fill="none" stroke="#3ecf7a" stroke-width="4" stroke-linecap="round"/>' +
      '<path class="e-leaf l1" d="M100 78 q-24 -3 -28 -24 q26 -1 28 24z" fill="url(#egLeaf)"/>' +
      '<path class="e-leaf l2" d="M100 66 q24 -4 28 -25 q-26 -1 -28 25z" fill="url(#egLeaf2)"/>' +
      '<circle cx="100" cy="54" r="5" fill="var(--accent)" opacity=".85"/>' +
      '</svg>';
  }
  /* 空态卡片。opt.trust=true 时在最后加一行「不用注册 · 数据只在这台设备 · 断网也能打卡」——
   * v48 加这一行的原因：这是本产品最硬的三条差异化，但之前一个字都没在界面上说过。
   * 外面（YouTube 上的同类产品、Habitfinity 之类）都把它当卖点单独宣传，
   * 我们只在分享卡片和隐私页里写了，第一次打开的人根本看不到。 */
  function emptyGuide(opt) {
    opt = opt || {};
    return '<div class="empty guide">' +
      '<div class="e-art">' + emptyArt() + '</div>' +
      '<div class="e-t">' + E(opt.title || '还没有习惯') + '</div>' +
      '<div class="e-d">' + E(opt.sub || '从一个小到不可能失败的目标开始，坚持 7 天就能看到变化') + '</div>' +
      '<div class="e-acts">' + (opt.actions || '<button class="btn" data-act="newhabit">＋ 添加第一个习惯</button>') + '</div>' +
      (opt.note ? '<div class="e-note">' + opt.note + '</div>' : '') +
      (opt.trust ? '<div class="e-trust">不用注册<i>·</i>数据只在这台设备<i>·</i>断网也能打卡</div>' : '') +
      /* v53 · 报告 P3-15：恢复入口从主按钮列降到页脚文字链。
       * 真正的第一次使用者用不到它，摆在主按钮旁边只会让人以为「数据本来该在」。 */
      (opt.footer ? '<div class="e-foot">' + opt.footer + '</div>' : '') +
      '</div>';
  }

  /* v52 · 报告 P0-1：数据还没从 IndexedDB 读完时的占位。
   * 为什么不能直接用骨架：骨架是 index.html 里的静态块，2600ms 兜底就会被撤掉；
   * 而这里的 render 可能比它更早跑完，撤掉骨架那一刻露出来的就是空态。
   * 所以「没读完」必须有自己的一句人话，而且不能带「从备份恢复」这种会引发误操作的按钮。 */
  function loadingGuide() {
    return '<div class="empty guide">' +
      '<div class="e-art">' + emptyArt() + '</div>' +
      '<div class="e-t">正在读这台设备上的记录…</div>' +
      '<div class="e-d">数据存在这个浏览器里，读完就好，不会丢。</div>' +
      '</div>';
  }

  function bundleHTML(b) {
    const d = U.today();
    const p = Engine.bundleProgress(b);
    const all = p.total > 0 && p.done === p.total;
    return '<div class="bundle" data-id="' + b.id + '"><div class="bundle-head">' +
      '<span class="bundle-emoji">' + ico('package') + '</span>' +
      '<span class="bundle-name">' + E(b.name) + '</span>' +
      '<span class="bundle-prog">' + p.done + '/' + p.total + '</span></div>' +
      '<div class="bundle-bar"><i style="width:' + p.pct + '%"></i></div>' +
      '<button class="btn-run' + (all ? ' done' : '') + '" data-act="runbundle" data-id="' + b.id + '">' +
      (all ? '✓ 已完成，点击撤销' : '一键完成') + '</button>' +
      '<div class="bundle-items">' + p.list.map(it =>
        '<span class="' + (Engine.isDone(it, d) ? 'ok' : '') + '">' + E(it.name) + '</span>').join('') + '</div></div>';
  }

  /* 例程卡：单独抽出来，打卡后 patchToday 可以只重画这一块 */
  function routineHTML(r, d) {
    d = d || U.today();
    const rs = Plus.routineState(r, d);
    if (!rs.total) return '';
    const allDone = rs.done >= rs.total;
    return '<div class="card routine' + (allDone ? ' done' : '') + '" data-id="' + r.id + '">' +
      '<div class="rt-head"><span class="rt-ico">🔗</span><span class="rt-name">' + E(r.name) + '</span>' +
      '<span class="rt-prog">' + rs.done + '/' + rs.total + '</span></div>' +
      '<div class="rt-bar"><i style="width:' + rs.pct + '%"></i></div>' +
      '<div class="rt-steps">' + rs.items.map(it => {
        const ok = Engine.isDone(it, d);
        const isNext = rs.next && rs.next.id === it.id;
        return '<button class="chip' + (ok ? ' on' : '') + (isNext ? ' next' : '') + '" data-act="tick" data-id="' + it.id + '" aria-label="打卡 ' + E(it.name) + '">' +
          (ok ? '✓ ' : (isNext ? '👉 ' : '')) + E(it.name) + '</button>';
      }).join('') + '</div>' +
      (allDone
        ? '<div class="rt-tip">这条例程今天全部完成 🎉</div>'
        : '<button class="btn sm block" data-act="rtdone" data-id="' + (rs.next ? rs.next.id : '') + '" data-r="' + r.id + '">' +
        (rs.next ? '完成下一步：' + E(rs.next.name) : '继续') + '</button>') +
      '</div>';
  }

  /* 顶部进度环 + 「今日打卡 X/Y」+ 标题角标：任何局部更新后都要跟一次 */
  /* 顶栏待办角标（走查第 5 条）：未完成数量，0 或没有待办模块时隐藏。
   * syncChrome / 渲染都会调，勾掉一条立刻变。 */
  function paintTodoBadge() {
    const el = $('todoBadge');
    if (!el) return;
    let n = 0;
    try { if (window.Todo) n = Todo.stats().open; } catch (e) { }
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n <= 0;
    const btn = $('btnTodo');
    if (btn) btn.setAttribute('aria-label', n > 0 ? '待办，还有 ' + n + ' 条未完成' : '待办');
  }

  function syncChrome() {
    const v = $('view');
    paintTop();
    paintTodoBadge();
    const cnt = v && v.querySelector('#todayCount');
    if (cnt) {
      const r = Engine.todayRate(U.today());
      cnt.textContent = r.done + '/' + r.total;
    }
    if (window.Product) Product.refresh();
    try { if (window.Feat) Feat.Notify.badge(); } catch (e) { }
    if (window.UX && v) UX.bindCounters(v);
  }

  /* 就地更新一张卡片：不动 .hitem / .h-ctl 节点本身，只改里面会变的部分。
   * keepMeta=true 时连 meta 都不碰（数值计数器连点用，避免按钮位移）。 */
  function patchCard(id, opt) {
    opt = opt || {};
    const v = $('view');
    if (!v) return false;
    const el = v.querySelector('.hitem[data-id="' + id + '"]');
    const it = (S().items || []).find(x => x.id === id);
    if (!el || !it) return false;
    const d = U.today();
    const done = Engine.isDone(it, d);
    const skipped = window.Extra ? Extra.isSkipped(d, it.id) : false;
    const locked = it.dependsOn && !Engine.isDone((S().items || []).find(x => x.id === it.dependsOn) || {}, d);
    el.classList.toggle('done', !!done);
    el.classList.toggle('skipped', !!skipped);
    el.classList.toggle('locked', !!locked);
    const tick = el.querySelector('.tick');
    if (tick) {
      tick.setAttribute('aria-pressed', String(done));
      tick.setAttribute('aria-label', (done ? '撤销打卡 ' : '打卡 ') + it.name);
      tick.title = done ? '撤销打卡' : it.type === 'avoid' ? '今天忍住了' : '打卡';
    }
    const bar = el.querySelector('.h-bar > i');
    if (bar) bar.style.width = (Engine.progress(it, d) * 100) + '%';
    const val = el.querySelector('.stepper .val');
    if (val) {
      const vv = U.numShort(((Engine.getLog(d, it.id) || {}).v) || 0);
      val.innerHTML = vv + '<small style="font-size:12px;color:var(--txt-3)"> ' + E(it.unit || '') + '</small>';
    }
    const nm = el.querySelector('.h-name');
    if (nm) {
      const lock = nm.querySelector('.lock-tip'), skp = nm.querySelector('.skip-tip');
      if (locked && !lock) nm.insertAdjacentHTML('beforeend', ' <span class="muted lock-tip" style="font-size:12px">· 需先完成前置</span>');
      if (!locked && lock) lock.remove();
      if (skipped && !skp) nm.insertAdjacentHTML('beforeend', ' <span class="muted skip-tip" style="font-size:12px">· 今天请假，不算断</span>');
      if (!skipped && skp) skp.remove();
    }
    if (!opt.keepMeta) {
      const m = el.querySelector('.h-meta');
      if (m) m.innerHTML = metaHTML(it, d);
      /* 连击 / 完成率 / 本周圆点：打卡后这些也会变，一起补上 */
      const tr = el.querySelector('.h-trend');
      if (tr) tr.outerHTML = trendHTML(it, d);
    }
    return true;
  }

  /* 连点停下来之后，把 meta（连续天数 / 强度）补齐 —— 只换 .h-meta，
   * 不动输入框，也不会打断正在打字的人。 */
  let _settleT = null, _settleIds = [];
  function settleLater(ids) {
    _settleIds = _settleIds.concat(ids || []).filter(Boolean);
    clearTimeout(_settleT);
    _settleT = setTimeout(function () {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) { settleLater([]); return; }
      const uniq = _settleIds.filter((x, i, a) => a.indexOf(x) === i);
      _settleIds = [];
      uniq.forEach(id => patchCard(id));
    }, 900);
  }

  /* 打卡后的快速路径：就地改变化的卡片，不整页重绘（列表长时差异很明显） */
  /* 下一步引导条：打卡后要能立刻长出来。patchToday 只重画卡片，不会重跑 renderToday，
   * 所以这里单独把这一条补上（走查第 6 条：首次打卡后应有引导）。
   * 只在「该显示哪一步」发生变化时动 DOM，避免每次打卡都抖一下。 */
  function patchNextStep() {
    if (tab !== 'today') return;
    const cur = document.querySelector('.ns-tip');
    const now = cur ? cur.dataset.step : '';
    const html = nextStepHTML();
    const next = html ? (/data-step="([^"]+)"/.exec(html) || [, ''])[1] : '';
    if (now === next) return;
    if (!html) { if (cur) cur.remove(); return; }
    if (cur) { const t = document.createElement('div'); t.innerHTML = html; if (t.firstChild) cur.replaceWith(t.firstChild); return; }
    /* 新长出的一条：插在安装引导前面（和 renderToday 里的顺序一致） */
    const anchor = document.querySelector('#view .pwa') || document.querySelector('#view .q-line');
    const t = document.createElement('div'); t.innerHTML = html;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(t.firstChild, anchor);
    else { const v = $('view'); if (v && t.firstChild) v.appendChild(t.firstChild); }
  }

  function patchToday(changedIds, opt) {
    if (window.Product && Product.filtered()) return false;
    const v = $('view');
    if (!v || tab !== 'today') return false;
    const ids = [].concat(changedIds || []).filter(Boolean);
    let hit = false;
    ids.forEach(id => { if (S().settings.gridView && window.Product ? Product.patchTile(id) : patchCard(id, opt)) hit = true; });
    /* 套餐 / 例程：这两个不是连点目标，整块换掉没问题 */
    (S().bundles || []).forEach(b => {
      const el = v.querySelector('.bundle[data-id="' + b.id + '"]');
      if (!el) return;
      const t = document.createElement('div');
      t.innerHTML = bundleHTML(b);
      if (t.firstChild) { el.replaceWith(t.firstChild); hit = true; }
    });
    if (window.Plus) {
      (Plus.routines() || []).forEach(r => {
        const el = v.querySelector('.routine[data-id="' + r.id + '"]');
        if (!el) return;
        const t = document.createElement('div');
        t.innerHTML = routineHTML(r);
        if (t.firstChild) { el.replaceWith(t.firstChild); hit = true; }
      });
    }
    syncChrome();
    if (opt && opt.keepMeta && ids.length && !S().settings.gridView) settleLater(ids);
    return hit;
  }

  /* 按名字找回习惯里写的「为什么」，最多显示 2 条 */
  function whyLines(names) {
    const all = Engine.items();
    const out = [];
    (names || []).forEach(n => {
      if (out.length >= 2) return;
      const it = all.find(x => x.name === n && x.why);
      if (it) out.push('<div class="why-line">「' + E(it.why) + '」</div>');
    });
    return out.length ? '<div style="margin-top:7px">' + out.join('') + '</div>' : '';
  }

  /* ---------- 回归模式（v28 · 4.3，对标 Duolingo 的「别让回来的人看到一屏零」）----------
   * 离开 3 天以上再打开，首页不是「0/4 · 连续 0 天」的判决书，而是一页重启：
   * 保留历史最佳与累计记录（这些不会因为断了就消失），送一张保护券，
   * 把今天的目标降到最小版本，只留一个动作「先做 1 分钟」。 */
  let _restart = null;
  function setRestart(v) { _restart = v || null; }
  function restartOn() { return !!_restart; }
  function restartHTML() {
    const info = _restart || {};
    const gap = info.days || 0;
    const list = Engine.items();
    const best = list.reduce((a, it) => Math.max(a, Engine.bestStreak(it.id) || 0), 0);
    const total = Engine.totalCheckins() || 0;
    const alive = list.filter(it => !it.archived).length;
    const undone = Engine.sorted().filter(it => Engine.isDue(it, U.today()) && !Engine.isDone(it, U.today()));
    const first = undone[0] || null;
    const miniTxt = first ? (Engine.miniOf(first) || '先做 1 分钟') : '先做 1 分钟';
    return '<div class="restart">' +
      '<div class="rs-mark">' + ico('sprout') + '</div>' +
      '<div class="rs-h">你回来了</div>' +
      '<div class="rs-s">上次打开是 <b>' + gap + ' 天前</b>。中间没记的那些日子，不算你失败 —— 只是没记。</div>' +
      '<div class="rs-stats">' +
      '<div class="rs-stat"><b>' + best + '</b><span>最长连续（天）</span></div>' +
      '<div class="rs-stat"><b>' + total + '</b><span>累计打卡（次）</span></div>' +
      '<div class="rs-stat"><b>' + alive + '</b><span>还在的习惯</span></div>' +
      '</div>' +
      '<div class="rs-gift">' + ico('ticket') + '送了你 1 张保护券，今天万一漏了也不会断</div>' +
      (first
        ? '<button class="btn block rs-cta" data-act="restartmini" data-id="' + first.id + '">' + E(miniTxt) + '</button>' +
          '<div class="rs-note">今天只做这一件就够了 · 其余的习惯明天再说</div>'
        : '<button class="btn block rs-cta" data-act="restartskip">看看今天</button>' +
          '<div class="rs-note">今天没有安排的习惯，先歇着也行</div>') +
      '<div class="rs-links">' +
      '<span data-act="restartgrow" role="button" tabindex="0">看看我的记录</span>' +
      '<span data-act="restartskip" role="button" tabindex="0">直接开始今天</span>' +
      '</div></div>';
  }

  /* 断签安抚（v49）：断的是「这一段」，不是你做到过的那些。
   * 连续天数会因为一天没做到而归零，累计次数和最长的一段不会 ——
   * 把这两个数摆出来，比说一句「别灰心」有用得多（它们是真的，不是鼓励）。 */
  function comebackLine() {
    const total = Engine.totalCheckins();
    if (!total) return '';
    let best = 0;
    Engine.items().forEach(it => {
      if (Engine.streakUnit(it) === '周') return;
      const n = Engine.bestStreak(it.id);
      if (n > best) best = n;
    });
    return '<div class="bc-come">断的是这一段，不是你做到过的那些 —— 累计 <b>' + total + '</b> 次' +
      (best >= 2 ? '，最长的一段是 <b>' + best + '</b> 天' : '') + '，都还在。</div>';
  }

  function renderToday() {
    const d = U.today();
    const st = S();
    /* 回归模式（v28 · 4.3）：离开 3 天以上再回来，先给一页「重启」，而不是一屏零。
     * 这是文档里「如果只做一件」的那一件 —— 它不增加功能，只决定离开的人还回不回来。 */
    if (_restart) return restartHTML();
    let html = window.Product ? Product.todayHeader() : '';
    /* 习惯列表：首页的绝对主角。顺序统一走 Engine.sorted() */
    const due = Engine.sorted().filter(it => Engine.isDue(it, d));
    const list = window.Product ? Product.filterToday(due) : due;
    if (window.Product) html += Product.todayTools();
    if (!list.length && due.length) {
      html += Product.emptyResults();
    } else if (!list.length && !(st.bundles || []).length) {
      /* v52 · 报告 P0-1：先分清「确实没有习惯」和「还没读完」。
       * 之前这里无条件渲染空态，有数据的用户刷新时会先闪一次「还没有习惯」，
       * 慌乱里点「从备份恢复」→ 导入旧 JSON → 习惯变成两份。 */
      if (!Store.isHydrated || !Store.isHydrated()) {
        html += loadingGuide();
      } else {
        /* 空设备首屏（走查 P0-③）：新网址 / 换手机 / 清了缓存的人打开就是一片空，
         * 必须有「从备份恢复」这条出口，否则他会以为数据没了。
         * v53 · 报告 P3-15：出口保留，但从主按钮列降到页脚文字链 —— 它服务的是
         * 「换设备的老用户」，不该和「添加第一个习惯」抢同一个视觉层级。 */
        const fresh = !Engine.items().length;
        html += emptyGuide({
          title: Engine.items().length ? '今天没有安排的习惯' : '还没有习惯',
          sub: Engine.items().length ? '你的习惯还在，今天可以按自己的节奏休息。' : '从一个小到不可能失败的目标开始，坚持 7 天就能看到变化',
          actions: '<button class="btn" data-act="newhabit">＋ 添加第一个习惯</button>' +
            '<button class="btn ghost" data-act="lib">从习惯库挑一个</button>',
          footer: fresh ? '<button data-act="import">换了手机或清了缓存？从备份恢复</button>' : '',
          trust: true
        });
      }
    } else if (list.length) {
      if (S().settings.gridView) {
        /* 网格视图：一屏看全，点一下完成（与列表视图互斥，按时段分组在网格下不适用） */
        html += Product.gridHTML(list);
      } else if (st.settings.groupBySlot) {
        SLOT_ORDER.forEach(slot => {
          const g = list.filter(it => (it.slot || 'any') === slot);
          if (!g.length) return;
          html += '<div class="slot-h">' + SLOT_NAME[slot] + '</div><div class="list">' + g.map(cardHTML).join('') + '</div>';
        });
      } else {
        if (!window.Product) html += '<div class="sec-title"><h3>今日打卡</h3><span class="more" id="todayCount">' +
          Engine.todayRate(d).done + '/' + Engine.todayRate(d).total + '</span></div>';
        html += '<div class="list">' + list.map(cardHTML).join('') + '</div>';
      }
      /* 长按是隐藏入口，得说一次，否则没人知道。
       * 「请假休息」写在最前面 —— 它是最容易被忽略、却最能救人于弃用的一个。 */
      if (!st.settings.hintLongPress) {
        html += '<div class="longpress-hint">长按卡片 → 请假休息 / 补卡 / 看统计</div>';
      }
    }

    let breakShown = false;      // 中断卡一旦出现，下面的「昨天漏卡」细条就不再重复

    /* 连击中断：反馈要明确，但语气得软 —— 断的是记录，不是你的努力。
     * 配一张补卡券 / 一条补录入口，让人知道还能接上。
     * 文案精确到"哪个习惯的连续断了"，避免和顶部「🔥 连续 N 天」自相矛盾。 */
    if (window.Extra && window.Extra.breakInfo) {
      const bk = Extra.breakInfo();
      if (bk) {
        breakShown = true;
        const canFreeze = bk.freezeLeft > 0;
        const bt = (bk.broke && bk.broke.length)
          ? '「' + E(bk.broke[0].name) + '」的连续记录断了' +
            (bk.broke.length > 1 ? '（还有 ' + (bk.broke.length - 1) + ' 个习惯）' : '') +
            (bk.broke[0].prev > 0 ? '，此前已连续 ' + bk.broke[0].prev + ' ' + (bk.broke[0].unit || '天') : '')
          : (bk.isYesterday ? '昨天' : U.prettyDate(bk.date)) + '有 ' + bk.count + ' 项没做完';
        html += '<div class="card break-card">' +
          /* 「知道了」收到右上角：三个按钮并排在 390px 上就要折成两行，整张卡因此多出 50px */
          '<button class="bc-x" data-act="dismissbreak" aria-label="知道了，不再显示中断提示">' + ico('x') + '</button>' +
          '<div class="bc-ico">' + ico('warning-circle') + '</div>' +
          '<div class="bc-main">' +
          '<div class="bc-t">' + bt + '</div>' +
          '<div class="bc-s">' + U.prettyDate(bk.date) + ' 有 ' + bk.count + ' 项没打卡：' + E(bk.names.slice(0, 3).join('、')) +
          (bk.names.length > 3 ? ' 等' : '') +
          (canFreeze ? ' · 补卡券还剩 ' + bk.freezeLeft + ' 张' : '') + '</div>' +
          /* 断的那一刻，把自己当初写的理由亮出来——道理讲不通的时候，只有自己的话管用 */
          whyLines(bk.names) +
          /* v49 · 断签安抚：这张卡原来的信息只有「断了」和「怎么补救」，
           * 看完的人记住的是失败。补一行不会归零的数字 —— 累计次数和最长的一段都还在。 */
          comebackLine() +
          '<div class="bc-acts">' +
          (bk.repair && bk.repair.ok
            ? '<button class="btn sm" data-act="repairday" data-d="' + bk.date + '">' + ico('ticket') +
              (bk.repair.via === 'freeze' ? '用 1 张保护券修好' : '用 ' + Extra.REPAIR_PTS + ' 积分修好') + '</button>'
            /* 修不了的时候，别把「需要 1 张保护券或 30 积分，现在都不够」当按钮文字 ——
             * 390px 下这句话会被按钮宽度切掉半截，看着像坏了。按钮说能做什么，原因单独一行。 */
            : '<button class="btn sm ghost" data-act="fixdates" title="查看漏卡记录并补救">' + ico('clock') +
              '怎么补救</button>') +
          '<button class="btn sm ghost" data-act="fixyesterday">补录那天</button>' +
          '</div>' +
          (bk.repair && bk.repair.ok
            ? '<div class="bc-fine">48 小时内可修复一次 · 本月还没用过</div>'
            : (bk.repair && bk.repair.reason ? '<div class="bc-fine">' + E(bk.repair.reason) + '</div>' : '')) +
          '</div></div>';
      }
    }

    /* 搭子（v32 · 4.7）：放在「断了怎么办」之后 —— 先处理自己的事，再想到朋友。
     * 手机端只留一行（并进下面的提示条，走查第 9 条）。 */
    const narrow = isNarrow();
    if (window.Buddy) html += buddyHTML(narrow);

    /* 时间胶囊：到期的一封来自过去的信 */
    if (window.Plus) {
      const caps = Plus.dueCapsules();
      caps.forEach(c => {
        const days = Math.max(0, U.daysBetween(U.ymd(new Date(c.createdAt || Date.now())), c.openAt));
        html += '<div class="card capsule"><div class="cap-ico">' + ico('clock') + '</div><div class="cap-main">' +
          '<div class="cap-t">来自 ' + days + ' 天前的你</div>' +
          '<div class="cap-b">' + E(c.text) + '</div>' +
          '<div class="bc-acts"><button class="btn sm" data-act="capsuleopen" data-id="' + c.id + '">收下这封信</button></div>' +
          '</div></div>';
      });
    }

    /* 昨天漏打卡：压成一条细条，别再占一整张卡。
     * 已经弹了中断卡时就不再重复（两处说同一件事，看着像 bug）。 */
    if (window.Extra && !breakShown) {
      const y = U.shiftYmd(d, -1);
      const created = U.ymd(new Date(Math.min.apply(null, Engine.items().map(it => it.createdAt || Date.now()).concat([Date.now()]))));
      if (y >= created) {
        const missed = Extra.missedOn(y).length;
        if (missed > 0) {
          html += '<div class="slim-tip" data-act="fixyesterday" role="button" tabindex="0" aria-label="补录昨天">' +
            '<span class="cell-ico">' + ico('clock') + '</span><b>昨天还有 ' + missed + ' 项没打卡</b>' +
            '<span class="st-go">补录 ›</span></div>';
        }
      }
    }

    /* 提示条：换地址 / 该备份了 / 云备份引导。
     * 放在习惯列表**之后**而不是页首 —— 打卡是这个应用唯一的高频动作，
     * 打开就要能看见今天的习惯，不能让提示条把主内容顶下去。
     * 手机端合成一条（走查第 9 条），桌面端一次最多两张卡。 */
    html += homeHints(narrow);

    /* v50 · 一句人话：近 14 天 vs 前 14 天，涨了还是跌了。
     * 放在周条之前 —— 它比周条更值得先看，也比周条更短。 */
    if (window.Product && Product.insightLine) html += Product.insightLine();

    /* 最近 7 天周条：原先在页首，会把习惯列表挤出首屏。挪到打卡区之后，
     * 想回顾的人照样看得到，首屏则留给"今天要做什么"。
     * 手机端再收成一行摘要，点开才展开（走查第 9 条）。 */
    const weekCardHTML = window.Product ? Product.weekCard() : '';
    if (weekCardHTML) {
      if (narrow) {
        const o = window.Product && Product.overview ? Product.overview() : null;
        html += '<details class="fold-line" data-fold="todayweek"><summary>' + ico('chart-bar') +
          '<span class="fl-t">最近 7 天</span>' +
          '<span class="fl-s">完成 ' + (o ? o.week.done : 0) + ' 次</span>' +
          '<span class="fr-go" aria-hidden="true">›</span></summary>' +
          '<div class="fl-body">' + weekCardHTML + '</div></details>';
      } else html += weekCardHTML;
    }

    /* 今日待办：今天到期 + 已逾期 + 高优先级的，最多露 3 条，点一下就能勾掉。
     * 习惯是「每天要做的」，待办是「今天得办完的」—— 后者也该在今日页露个面。 */
    if (window.Todo) {
      const focus = Todo.focus(d);
      if (focus.length) {
        html += '<div class="sec-title"><h3>今日待办 · ' + Todo.stats(d).open + '</h3>' +
          '<span class="more linkbtn" data-act="gotodos" style="color:var(--accent)">全部 ›</span></div>';
        html += '<div class="list">' + focus.slice(0, 3).map(function (t) {
          const over = Todo.isOverdue(t, d);
          return '<div class="todo compact' + (over ? ' over' : '') + '" data-id="' + t.id + '">' +
            '<button class="todo-tick" data-act="todotoggle" data-id="' + t.id + '" aria-label="完成待办"></button>' +
            '<div class="todo-main"><div class="todo-title">' + E(t.title) + '</div>' +
            '<div class="todo-meta">' +
            (t.due ? '<span class="todo-due' + (over ? ' over' : '') + '">' + E(Todo.dueText(t, d)) + '</span>' : '') +
            ((t.priority || 0) >= 2 ? '<span class="todo-prio p2">高优先级</span>' : '') +
            '</div></div></div>';
        }).join('') + '</div>';
        if (focus.length > 3) {
          html += '<div class="slim-tip" data-act="gotodos" role="button" tabindex="0" aria-label="查看全部待办">' +
            '<span>☑</span><b>还有 ' + (focus.length - 3) + ' 条待办</b><span class="st-go">去看 ›</span></div>';
        }
      }
    }

    /* 例程链：串起来的习惯，做完一个自动指向下一个 */
    if (window.Plus) {
      const rts = (Plus.routines() || []).filter(r => r.on !== false && (r.itemIds || []).length);
      rts.forEach(r => { html += routineHTML(r, d); });
    }

    /* 套餐 */
    if ((st.bundles || []).length) {
      html += '<div class="sec-title"><h3>套餐 · 一键完成</h3></div>';
      html += st.bundles.map(bundleHTML).join('');
    }

    /* 心情 + 笔记 + 照片
     * 收进一个可折叠块：今日页的主角是"打卡"，随手记属于低频动作。
     * 默认收起让页面更短；今天一旦有记录就自动展开，不把用户写的东西藏起来。
     * 用户手动开/关会被记住（Product.foldOpen），重绘不会自己弹回去。 */
    const note = st.notes[d] || { text: '', photos: [], audios: [] };
    const mood = st.moods[d];
    const recBits = [];
    if (mood) recBits.push('心情' + MOOD_WORD[mood - 1]);
    if (note.text) recBits.push('笔记 ' + note.text.length + ' 字');
    if ((note.photos || []).length) recBits.push(note.photos.length + ' 张照片');
    if ((note.videos || []).length) recBits.push(note.videos.length + ' 段视频');
    if ((note.audios || []).length) recBits.push(note.audios.length + ' 段语音');
    const hasRec = recBits.length > 0;
    const recOpen = window.Product ? Product.foldOpen('todayrec', hasRec) : hasRec;
    html += '<details class="fold-rec"' + (recOpen ? ' open' : '') + ' data-fold="todayrec">' +
      '<summary>' +
      '<span class="fr-ico" aria-hidden="true">' + ico(hasRec ? 'notebook' : 'pencil') + '</span>' +
      '<span class="fr-t">' + (hasRec ? '今天已记录' : '今天心情如何？随手记一笔') + '</span>' +
      (hasRec ? '<span class="fr-s">' + E(recBits.join(' · ')) + '</span>' : '') +
      '<span class="fr-go" aria-hidden="true">›</span>' +
      '</summary>' +
      '<div class="fr-body">' +
      '<div class="moods" role="group" aria-label="今日心情">' + MOODS.map((m, i) =>
        '<div class="mood' + (mood === i + 1 ? ' on' : '') + '" data-act="mood" data-v="' + (i + 1) + '"' +
        ' role="button" tabindex="0" aria-label="心情' + MOOD_WORD[i] + '">' + ico(m) +
        '<small>' + MOOD_WORD[i] + '</small></div>').join('') + '</div>' +
      '<textarea class="input" style="margin-top:12px" placeholder="今天发生了什么？随手记一笔…" data-act="noteinput" data-max="500">' + E(note.text || '') + '</textarea>' +
      '<div class="photos" id="photoGrid">' +
      (note.photos || []).map(p => '<img data-act="viewphoto" data-id="' + p.id + '" src="assets/icon.svg" alt="">').join('') +
      '<div class="add" data-act="addphoto" role="button" tabindex="0" aria-label="添加今天的照片">＋</div></div>' +
      '<div class="fr-acts"><button class="btn ghost sm" data-act="addvideo">' + ico('film') + '拍段视频</button>' +
      '<button class="btn ghost sm" data-act="godiary">去日记页写长篇 ›</button></div>' +
      '</div></details>';

    /* ---------- 下一步引导（走查第 6 条） ----------
     * 新用户完成第一次打卡后没有后续引导。这里给一条轻量提示链，一次只显示一条：
     *   ① 打过卡还没写过日记 → 去写两句
     *   ② 写过日记 → 去看看回顾页
     *   ③ 进入第二周（≥7 活跃日）→ 补卡规则与番茄钟
     * 每条都能被 × 永久关掉；做掉了对应动作就自动消失（不靠用户记得点）。 */
    html += nextStepHTML();

    /* 底部：安装引导 + 一行名言（都不该抢主角的位置）。
     * 手机端名言也收成一行摘要（走查第 9 条）。 */
    html += installCard();
    if (window.UX) {
      html += narrow
        ? '<details class="fold-line" data-fold="todayquote"><summary>' + ico('sparkle') +
          '<span class="fl-t">每日名言</span><span class="fl-s">点开看一句</span>' +
          '<span class="fr-go" aria-hidden="true">›</span></summary>' +
          '<div class="fl-body">' + UX.quoteLine() + '</div></details>'
        : UX.quoteLine();
    }

    return html;
  }

  /* 下一步引导条：返回 '' 表示现在没有该提示的事 */
  function nextStepHTML() {
    const st = S();
    const ns = st.settings.nextStep || {};
    if (ns.off) return '';
    const done = ns.done || [];
    const hasNote = Object.keys(st.notes || {}).some(d => (st.notes[d] || {}).text);
    const activeDays = Object.keys(st.logs || {}).length;
    let step = null;
    if (Engine.totalCheckins() >= 1 && !hasNote) step = 'diary';
    else if (hasNote && done.indexOf('grow') < 0) step = 'grow';
    else if (activeDays >= 7 && done.indexOf('week2') < 0) step = 'week2';
    if (!step) return '';
    const M = {
      diary: { ico: 'pencil', t: '写两句今天的日记', s: '记一句「为什么做到 / 没做到」，两周后回顾页会用它。', btn: '去写 ›', go: 'diary' },
      grow: { ico: 'chart-bar', t: '看看你的回顾页', s: '已经有记录了，那里会按数据量逐级解锁周报、热力图和规律。', btn: '去看看 ›', go: 'grow' },
      week2: { ico: 'ticket', t: '第二周了，两件事值得知道', s: '漏打卡 48 小时内能用保护券或积分接上；番茄钟可以绑习惯，结束时一键记录。', btn: '知道了', go: '' }
    }[step];
    /* 三格都用同一个动作 nextstepdone：点了就算这一步做过了（并按需跳转），
     * 否则「去回顾页」跳走之后这一步永远留着，第二天还在（走查第 6 条要求自动消失）。 */
    return '<div class="slim-tip ns-tip" data-step="' + step + '">' +
      '<span class="ns-ico" aria-hidden="true">' + ico(M.ico) + '</span>' +
      '<span class="ns-main" data-act="nextstepdone" role="button" tabindex="0" aria-label="' + E(M.t) + '">' +
      '<b>' + E(M.t) + '</b><small>' + E(M.s) + '</small></span>' +
      '<span class="st-go" data-act="nextstepdone" aria-hidden="true">' + E(M.btn) + '</span>' +
      '<button class="ns-x" data-act="nextstepoff" aria-label="不再显示下一步提示">' + ico('x') + '</button>' +
      '</div>';
  }

  async function paintPhotos() {
    const d = U.today();
    const note = S().notes[d] || { photos: [] };
    const grid = $('photoGrid');
    if (!grid) return;
    const imgs = grid.querySelectorAll('img[data-id]');
    for (const img of imgs) {
      try {
        const url = await Store.mediaURL(img.dataset.id);
        if (url) { img.src = url; img.dataset.url = url; img.title = '点击查看原图'; }
        else img.src = 'assets/icon.svg';
      } catch (e) { }
    }
  }

  /* ---------------- 日记 ---------------- */
  let diaryDate = null;      // 当前编辑的日期，null = 今天
  let diaryView = 'write';   // write | timeline | cal
  let diaryMonth = null;     // 日历当前月 'YYYY-MM'
  let diaryOffset = 0;       // 时间轴分页
  let diaryQuery = '';       // 搜索关键词
  let diaryFold = false;     // 月度小结是否被手动折叠
  let reportMonth = null;    // 月度报告当前月 'YYYY-MM'，null = 本月
  /* 已经为哪些日期做过「天气回填重绘」。ensureWeather 命中缓存时也会 resolve，
   * 没有这道闸就会 render → 回填 → render 无限循环，把整页卡死。 */
  const _wxPainted = Object.create(null);

  const dDate = () => diaryDate || U.today();

  /* 关键词高亮：先转义再套 <mark>，避免 XSS */
  function hlMark(txt, q) {
    let s = E(txt || '');
    const words = String(q || '').trim().split(/\s+/).filter(Boolean);
    words.forEach(w => {
      const ew = E(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!ew) return;
      try { s = s.replace(new RegExp(ew, 'gi'), m => '<mark>' + m + '</mark>'); } catch (e) { }
    });
    return s;
  }

  /* 连续写日记天数条 */
  function diaryStreakBar() {
    if (!window.Diary || !Diary.writeStreak) return '';
    const n = Diary.writeStreak();
    const gap = Diary.gapDays();
    const written = Diary.wroteDay(U.today());
    let sub;
    if (n >= 2) sub = '已经写了 ' + n + ' 天，别断在这儿';
    else if (gap < 0) sub = '还没写过，今天开始正好';
    else if (gap > 365) sub = '上次写是去年，想起来就补一笔';
    else if (gap > 30) sub = '上次写是 ' + Math.round(gap / 30) + ' 个月前，想起来就补一笔';
    else if (gap > 0) sub = '上次写是 ' + gap + ' 天前，想起来就补一笔';
    else sub = written ? '今天写过了，明天继续' : '今天还没写，随手记一句也算';
    return '<div class="card dy-streak">' +
      '<div class="dy-st-n">' + n + '</div>' +
      '<div class="dy-st-m"><b>连续写日记</b><small>' + E(sub) + '</small></div>' +
      '<div class="dy-st-dots">' + [0, 1, 2, 3, 4, 5, 6].map(i => {
        const d = U.shiftYmd(U.today(), -i);
        return '<i class="' + (Diary.wroteDay(d) ? 'on' : '') + '" title="' + d + '"></i>';
      }).reverse().join('') + '</div></div>';
  }

  /* 月度小结：每月 1~7 号自动展开上月回顾，之后折叠成一行 */
  function diaryMonthCard() {
    if (!window.Diary || !Diary.monthSummary) return '';
    const today = U.today();
    const dd = +today.slice(8, 10);
    const ym = Diary.prevMonth(today.slice(0, 7));
    const m = Diary.monthSummary(ym);
    if (!m.wrote && !m.checkins) return '';
    const auto = dd <= 7;
    const open = auto && !diaryFold;
    const bits = [];
    if (m.wrote) bits.push('写了 <b>' + m.wrote + '</b> 天');
    if (m.checkins) bits.push('打卡 <b>' + m.checkins + '</b> 次');
    if (m.rate) bits.push('完成率 <b>' + m.rate + '%</b>');
    if (m.photos) bits.push('照片 <b>' + m.photos + '</b> 张');
    if (m.videos) bits.push('视频 <b>' + m.videos + '</b> 段');
    if (m.mood) bits.push('平均心情 <b>' + m.mood + '</b>');
    let html = '<div class="card dy-month' + (open ? ' open' : '') + '">' +
      '<div class="dy-mh" data-act="dyfoldmonth">' +
      '<span class="dy-mh-ico">' + ico('calendar-dots') + '</span>' +
      '<div style="flex:1"><b>' + m.label + '小结</b>' +
      (open ? '' : '<small class="muted"> ' + bits.join(' · ').replace(/<\/?b>/g, '') + '</small>') + '</div>' +
      '<span class="dy-mh-ar">' + (open ? '收起' : '展开') + '</span></div>';
    if (open) {
      html += '<div class="dy-mb">' +
        '<div class="dy-meta" style="flex-wrap:wrap;gap:10px">' + bits.map(b =>
          '<span>' + b + '</span>').join('') + '</div>';
      if (m.top.length) {
        html += '<div class="dy-done" style="margin-top:10px">' + m.top.map(t =>
          '<span class="dy-chip"><i style="background:' + t.color + '"></i>' + E(t.name) + ' × ' + t.n + '</span>').join('') + '</div>';
      }
      html += '<div class="row" style="margin-top:12px">' +
        '<button class="btn sm ghost" data-act="dyexportmonth" data-m="' + m.ym + '">导出这月的 Markdown</button>' +
        '<button class="btn sm ghost" data-act="dyfoldmonth">收起</button></div></div>';
    }
    html += '</div>';
    return html;
  }

  /* 某一年里写过的所有打卡备注（按日期倒序） */
  function yearNotes(year) {
    const st = S();
    const byId = {};
    (st.items || []).forEach(it => { byId[it.id] = it; });
    const out = [];
    Object.keys(st.logs || {}).forEach(d => {
      if (String(d).slice(0, 4) !== String(year)) return;
      Object.keys(st.logs[d] || {}).forEach(id => {
        const note = (st.logs[d][id] || {}).note;
        if (note) out.push({ date: d, note: note, name: (byId[id] || {}).name || '已删除的习惯' });
      });
    });
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return out;
  }

  /* 搜索结果：日记正文 + 单次打卡备注（v28 · 4.5）。
   * 原来只搜日记，用户写过的「跑了 5 公里」散在记录里，等于写完就沉底。 */
  function diarySearch(q) {
    const list = Diary.search(q, 50);
    const nts = Engine.noteSearch ? Engine.noteSearch(q, 20) : [];
    const total = list.length + nts.length;
    let html = '<div class="sec-title"><h3>搜索「' + E(q) + '」</h3>' +
      '<span class="more">' + total + ' 条 · <span data-act="dyclearsearch" style="color:var(--accent);cursor:pointer">清除</span></span></div>';
    if (!total) {
      return html + '<div class="card"><div class="muted">没找到。换个词试试，或者搜更短一点。</div></div>';
    }
    if (list.length) {
      html += list.map(r => {
        const w = (Diary.raw(r.date) || {}).weather;
        return '<div class="card dy-tl" data-act="dyday" data-d="' + r.date + '">' +
          '<div class="dy-tl-h"><b>' + U.prettyDate(r.date) + '</b>' +
          (w && w.k ? '<span>' + Diary.wIcon(w.k) + '</span>' : '') +
          (r.mood ? '<span class="cell-ico">' + ico(MOODS[r.mood - 1]) + '</span>' : '') +
          (r.photos ? '<span class="muted">' + r.photos + ' 图</span>' : '') +
          '<span class="muted" style="margin-left:auto">' + (U.daysBetween(r.date, U.today()) || '今天') + '</span></div>' +
          '<div class="dy-tl-t">' + hlMark(r.snippet, q) + '</div></div>';
      }).join('');
    }
    if (nts.length) {
      html += '<div class="sec-title" style="margin-top:14px"><h3>打卡备注</h3><span class="more">' + nts.length + ' 条</span></div>';
      html += nts.map(n => '<div class="card dy-tl" data-act="dyday" data-d="' + n.date + '">' +
        '<div class="dy-tl-h"><b>' + U.prettyDate(n.date) + '</b><span>' + E(n.name) + '</span>' +
        '<span class="muted" style="margin-left:auto">' + (U.daysBetween(n.date, U.today()) || '今天') + '</span></div>' +
        '<div class="dy-tl-t">' + hlMark(n.note, q) + '</div></div>').join('');
    }
    return html;
  }

  /* 附件到底存哪儿：口径必须和 store.js 的 putMedia 完全一致
   * （Cloud.signedIn() && settings.cloudMedia !== false 才上云）。
   * v38 · 外部评审 P0-1：之前这里无条件写「自动压缩后存到云端」，
   * 和页脚「不开同步就不上传」互相打脸 —— 没登录的人会以为照片已经上了云。 */
  function mediaCloudOn() {
    try {
      return !!(window.Cloud && Cloud.signedIn && Cloud.signedIn() && S().settings.cloudMedia !== false);
    } catch (e) { return false; }
  }
  /* v52 · 报告 P0-2：云后端到底通不通，决定文案敢不敢提「登录云空间」。
   * 实测线上 Cloud.probe() 返回 down —— 这时候还在教用户「去登录」，
   * 等于让他点进一个必然失败的入口，比不说更糟。
   * 注意这里是「没确认可用就不承诺」：unknown（还没探测）/ down 一律算不可用。
   * 反过来写（只挡 down）会让首次打开的那几百毫秒里把空头承诺说出去。 */
  function cloudDown() {
    try {
      if (!window.Cloud || !Cloud.backendState) return true;
      return Cloud.backendState().state !== 'up';
    } catch (e) { return true; }
  }
  function mediaStoreHint(kind) {
    if (mediaCloudOn()) {
      return kind === 'video'
        ? '存进<b>你自己的云空间</b>后本机不占空间，换设备登录自动回来。'
        : '自动压缩后上传到<b>你自己的云空间</b>，本机只留缩略图，换设备登录自动回来。';
    }
    /* 云不通时不能把「登录云空间」当出口 —— 那是空头承诺。
     * 改说一条真的走得通的路：导出备份带过去（或连自己的网盘）。 */
    const away = cloudDown()
      ? '换设备想看到，用「导出备份」带过去（或在「连接」页连自己的网盘）。'
      : '换设备想看到，用「导出备份」带过去，或在「连接」页登录云空间。';
    return kind === 'video'
      ? '<b>只存在这台设备</b>，不会上传到任何服务器。' + away
      : '<b>只存在这台设备</b>（浏览器数据库），不会上传到任何服务器。' + away;
  }

  function diaryEditor(d) {
    const st = S();
    const n = Diary.raw(d) || { text: '', photos: [], audios: [] };
    const s = Diary.summary(d);
    const mood = (st.moods || {})[d] || 0;
    const w = n.weather;
    const isToday = d === U.today();
    const ago = U.daysBetween(d, U.today());
    let html = '';

    /* 日期导航 */
    html += '<div class="card dy-nav">' +
      '<button class="btn sm ghost" data-act="dyprev" data-d="' + d + '">‹</button>' +
      '<div class="dy-date"><b>' + U.prettyDate(d) + '</b>' +
      '<small>' + (isToday ? '今天' : ago > 0 ? ago + ' 天前' : (-ago) + ' 天后') + '</small></div>' +
      '<button class="btn sm ghost" data-act="dynext" data-d="' + d + '"' + (isToday ? ' disabled' : '') + '>›</button>' +
      (isToday ? '' : '<button class="btn sm" data-act="dytoday">回今天</button>') +
      '</div>';

    /* 天气 + 心情 */
    html += '<div class="card dy-wrow">' +
      '<button class="dy-w" data-act="dyweather">' +
      (w && w.k ? Diary.wIcon(w.k) + ' ' + Diary.wName(w.k) + (w.t ? ' ' + w.t + '°C' : '') : '＋ 加天气') +
      (w && w.city ? '<small> ' + E(w.city) + '</small>' : '') + '</button>' +
      '<div class="moods">' + MOODS.map((m, i) =>
        '<div class="mood' + (mood === i + 1 ? ' on' : '') + '" data-act="dymood" data-v="' + (i + 1) + '" role="button" tabindex="0" aria-label="心情' + MOOD_WORD[i] + '">' + ico(m) + '</div>').join('') +
      '</div></div>';

    /* 当天自动收录 */
    html += '<div class="sec-title"><h3>这天做了什么</h3>' +
      (s.rate.total ? '<span class="more">' + s.rate.done + '/' + s.rate.total + '</span>' : '') + '</div>';
    html += '<div class="card">' +
      '<div class="dy-meta">' +
      (s.rate.total ? '<span>完成率 <b>' + s.rate.pct + '%</b></span>' : '') +
      (s.streak ? '<span title="截至这天的全站连续（每天至少完成一个习惯）">全站连续 <b>' + s.streak + '</b> 天</span>' : '') +
      (s.points ? '<span>积分 <b>' + s.points + '</b></span>' : '') +
      '</div>' +
      (s.done.length
        ? '<div class="dy-done">' + s.done.map(x =>
          '<span class="dy-chip"><i style="background:' + x.color + '"></i>' + E(x.name) +
          (x.streak ? ' · 该习惯连续 ' + x.streak + ' 天' : '') + (x.ts ? ' · ' + U.hhmm(x.ts) : '') + '</span>').join('') + '</div>'
        : '<div class="muted">这天没有完成的习惯</div>') +
      (s.slipped.length ? '<div class="muted" style="margin-top:8px">破戒：' + s.slipped.map(x => E(x.name)).join('、') + '</div>' : '') +
      (s.skipped.length ? '<div class="muted" style="margin-top:4px">请假：' + s.skipped.map(x => E(x.name)).join('、') + '</div>' : '') +
      '</div>';

    /* 正文 */
    html += '<div class="sec-title"><h3>正文</h3><span class="more"><span id="dyCount">' + (n.text || '').length + '</span> 字</span></div>';
    /* v35 · 轻量复盘模板（外部评审 P1-5）：「打卡后记一句为什么」比逼写日记容易，
     * 这三问是把随手记变成可回看的最小集合。点一下就插进正文，不是弹新表单。 */
    html += '<div class="row" style="margin-bottom:8px">' +
      REVIEW_Q.map((q, i) => '<button class="chip" data-act="dyreview" data-i="' + i + '" ' +
        'title="把这一问插到正文里">' + E(q.label) + '</button>').join('') + '</div>';
    html += '<div class="card"><textarea class="input" id="dyText" style="min-height:170px" data-act="dytext" data-max="5000" ' +
      'placeholder="今天发生了什么？随手记一笔…&#10;写完不用点保存，自动存。">' + E(n.text || '') + '</textarea></div>';

    /* 图片：第一张（或你指定的那张）是封面，时间轴上露的就是它 */
    const ph = n.photos || [];
    const cover = Diary.coverOf ? Diary.coverOf(d) : '';
    html += '<div class="sec-title"><h3>图片</h3><span class="more">' + ph.length + ' / ' + Diary.MAX_PHOTOS + '</span></div>';
    html += '<div class="card"><div class="photos" id="dyPhotos">' +
      ph.map(p => '<div class="ph-wrap' + (p.id === cover ? ' cov' : '') + '" data-act="dyphoto" data-id="' + p.id + '">' +
        '<img data-media="' + p.id + '" src="assets/icon.svg" alt="">' +
        (p.id === cover ? '<span class="ph-cov" title="封面">★</span>' : '') +
        '</div>').join('') +
      '<div class="add" data-act="dyaddphoto">＋</div></div>' +
      '<div class="muted" style="margin-top:10px">' + mediaStoreHint('photo') +
      '点图片可以设为封面、调整顺序、删除。每天最多 ' + Diary.MAX_PHOTOS + ' 张。</div></div>';

    /* 视频：封面格 + 时长角标，点开全屏播放 */
    const vd = n.videos || [];
    html += '<div class="sec-title"><h3>视频</h3><span class="more">' + vd.length + ' / ' + Diary.MAX_VIDEOS + '</span></div>';
    html += '<div class="card"><div class="videos" id="dyVideos">' +
      vd.map(v => '<div class="vid-wrap" data-act="dyvideo" data-id="' + v.id + '">' +
        (v.poster
          ? '<img data-media="' + v.poster + '" src="assets/icon.svg" alt="">'
          : '<div class="vid-blank"></div>') +
        '<span class="vid-play">▶</span>' +
        (v.dur ? '<span class="vid-dur">' + U.dur(v.dur) + '</span>' : '') +
        '</div>').join('') +
      (vd.length < Diary.MAX_VIDEOS ? '<div class="add" data-act="dyaddvideo">＋</div>' : '') + '</div>' +
      '<div class="muted" style="margin-top:10px">一段视频顶一千个字。单条最长 ' + Diary.MAX_VIDEO_SEC +
      ' 秒、最大 ' + Diary.MAX_VIDEO_MB + 'MB，每天最多 ' + Diary.MAX_VIDEOS + ' 条。' +
      mediaStoreHint('video') + '</div></div>';

    /* 另一台设备上还有没上传的附件：必须说出来，否则用户会以为那天什么都没记 */
    if (n.pending) {
      html += '<div class="dy-pend">' + ico('clock') + ' 还有 <b>' + n.pending + '</b> 个附件在另一台设备上（没上传云端），' +
        '这台设备暂时看不到。回原设备登录云空间后会自动同步过来。</div>';
    }

    /* 语音：直接列出可播放/删除，不用再点一层菜单 */
    const au = n.audios || [];
    html += '<div class="sec-title"><h3>语音</h3><span class="more">' + au.length + ' 条</span></div>';
    html += '<div class="card"><div class="row">' +
      '<button class="btn sm" data-act="dyaddaudio">' + ico('microphone') + '录一段</button>' +
      '</div>' +
      (au.length
        ? '<div class="dy-au">' + au.map((a, i) =>
          '<div class="dy-au-i"><span class="dy-au-n">🎤 第 ' + (i + 1) + ' 条</span>' +
          '<span class="muted">' + U.hhmm(a.ts || Date.now()) + (a.dur ? ' · ' + a.dur + '秒' : '') + '</span>' +
          '<button class="btn sm" data-act="dyplayaudio" data-id="' + a.id + '">播放</button>' +
          '<button class="btn sm ghost" data-act="dydelaudio" data-id="' + a.id + '">删除</button></div>').join('') + '</div>'
        : '<div class="muted" style="margin-top:10px">不方便打字的时候，说一句也算数。</div>') +
      '</div>';

    return html;
  }

  function diaryTimeline() {
    const list = Diary.days(30, diaryOffset);
    const total = Diary.totalDays();
    let html = '<div class="sec-title"><h3>时间轴</h3><span class="more">共 ' + total + ' 天</span></div>';
    if (!list.length) {
      return html + '<div class="card"><div class="muted">还没有任何记录。去「今天」打几个卡，或在这儿写第一篇日记。</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="dytoday">写今天</button></div></div>';
    }
    list.forEach(d => {
      const n = Diary.raw(d) || {};
      const s = Diary.summary(d);
      const mood = (S().moods || {})[d] || 0;
      const w = n.weather;
      const ph = n.photos || [];
      const vds = n.videos || [];
      const cov = Diary.coverOf ? Diary.coverOf(d) : '';
      const txt = (n.text || '').trim();
      /* 遮罩开着时：正文和图片都糊掉，盖一层「轻触显示」。
       * 注意只在时间轴糊，日记编辑页不糊 —— 自己点进来就是要看的。 */
      const mask = !!(S().settings.diaryMask);
      html += '<div class="card dy-tl' + (mask ? ' masked' : '') + '" data-act="dyday" data-d="' + d + '">' +
        '<div class="dy-tl-h">' +
        '<b>' + U.prettyDate(d) + '</b>' +
        (w && w.k ? '<span>' + Diary.wIcon(w.k) + '</span>' : '') +
        (mood ? '<span class="cell-ico">' + ico(MOODS[mood - 1]) + '</span>' : '') +
        (vds.length ? '<span title="有视频">🎬 ' + vds.length + '</span>' : '') +
        (s.rate.total ? '<span class="muted">' + s.rate.done + '/' + s.rate.total + '</span>' : '') +
        '<span class="muted" style="margin-left:auto">' + (U.daysBetween(d, U.today()) || '今天') + (U.daysBetween(d, U.today()) ? ' 天前' : '') + '</span>' +
        '</div>' +
        (txt ? '<div class="dy-tl-t">' + E(txt.length > 120 ? txt.slice(0, 120) + '…' : txt) + '</div>' : '') +
        (cov
          ? '<div class="dy-tl-cov"><img data-media="' + cov + '" src="assets/icon.svg" alt="">' +
            (ph.length > 1 ? '<span class="dy-tl-more">共 ' + ph.length + ' 张</span>' : '') + '</div>'
          : ph.length ? '<div class="dy-tl-p">' + ph.slice(0, 4).map(p =>
            '<img data-media="' + p.id + '" src="assets/icon.svg" alt="">').join('') +
            (ph.length > 4 ? '<span class="dy-tl-more">+' + (ph.length - 4) + '</span>' : '') + '</div>' : '') +
        (mask ? '<div class="dy-mask">' + ico('eye') + '<span>轻触显示这篇</span></div>' : '') +
        '</div>';
    });
    if (total > diaryOffset + 30) {
      html += '<button class="btn ghost" style="width:100%;margin-top:6px" data-act="dymore">加载更早 30 天</button>';
    }
    return html;
  }

  function diaryCalendar() {
    const g = Diary.monthGrid(diaryMonth);
    const prev = U.shiftYmd(g.ym + '-01', -31).slice(0, 7);
    const next = U.shiftYmd(g.ym + '-28', 31).slice(0, 7);
    let html = '<div class="card dy-calnav">' +
      '<button class="btn sm ghost" data-act="dycal" data-m="' + prev + '">‹</button>' +
      '<b>' + g.label + '</b>' +
      '<button class="btn sm ghost" data-act="dycal" data-m="' + next + '">›</button>' +
      '</div>';
    html += '<div class="card"><div class="dy-week">' +
      ['一', '二', '三', '四', '五', '六', '日'].map(x => '<span>' + x + '</span>').join('') + '</div>';
    html += '<div class="dy-grid">' + g.cells.map(c => {
      let cls = 'dy-cell' + (c.inMonth ? '' : ' out') + (c.isToday ? ' today' : '');
      return '<div class="' + cls + '" data-act="dyday" data-d="' + c.date + '">' +
        '<span class="dy-d">' + c.day + '</span>' +
        '<span class="dy-mk">' + (c.hasNote ? '•' : '') + '</span>' +
        (c.mood ? '<span class="dy-mo">' + MOODS[c.mood - 1] + '</span>' : '') +
        '</div>';
    }).join('') + '</div>';
    html += '<div class="muted" style="margin-top:12px">有圆点的日子写了日记，点任意一天可以补写。</div></div>';
    return html;
  }

  function renderDiary() {
    let html = '<div class="seg">' +
      '<button class="' + (diaryView === 'write' ? 'on' : '') + '" data-act="dyview" data-v="write">写日记</button>' +
      '<button class="' + (diaryView === 'timeline' ? 'on' : '') + '" data-act="dyview" data-v="timeline">时间轴</button>' +
      '<button class="' + (diaryView === 'cal' ? 'on' : '') + '" data-act="dyview" data-v="cal">日历</button>' +
      '</div>';
    if (diaryView === 'write') {
      html += diaryStreakBar();
      html += diaryMonthCard();
      html += diaryEditor(dDate());
    } else if (diaryView === 'timeline') {
      html += '<div class="card dy-search"><span>🔍</span>' +
        '<input class="input" id="dySearch" data-act="dysearch" placeholder="搜日记正文，比如「面试」「跑步」" ' +
        'value="' + E(diaryQuery) + '"></div>';
      /* v35 · 日记遮罩（外部评审 P1-5）：在地铁、办公室打开应用时，
       * 时间轴上那一行行正文就是最不想被人看见的东西。开着遮罩时轻触一次才展开。 */
      const maskOn = !!(S().settings.diaryMask);
      html += '<div class="row" style="margin:8px 0 0">' +
        '<button class="btn sm ghost" data-act="dymask" style="flex:1">' + ico(maskOn ? 'eye-off' : 'eye') +
        (maskOn ? '日记已遮罩 · 轻触某条才显示' : '公共场所？给日记加遮罩') + '</button></div>';
      html += diaryQuery ? diarySearch(diaryQuery) : diaryTimeline();
    } else html += diaryCalendar();
    html += '<div class="row" style="margin-top:14px">' +
      '<button class="btn sm ghost" data-act="dyexportmd" style="flex:1">导出 Markdown</button></div>';
    return html;
  }

  /* ---------------- 习惯 ---------------- */
  /* ---------------- 待办（一次性任务） ----------------
   * 参考 Habitica 的 To-Dos：习惯是「要重复做的事」，待办是「做完就没了的事」。
   * 单独一页，不占今日页的地方，也不进完成率分母、不影响连击。 */
  function todoRow(t) {
    const sp = Todo.subProgress(t);
    const over = Todo.isOverdue(t);
    const due = Todo.dueText(t);
    const prio = t.priority || 0;
    const meta = [];
    if (due) meta.push('<span class="todo-due' + (over ? ' over' : '') + '">' + E(due) + '</span>');
    if (prio >= 2) meta.push('<span class="todo-prio p2">高优先级</span>');
    else if (prio === 1) meta.push('<span class="todo-prio p1">中优先级</span>');
    if (sp.total) meta.push('<span class="todo-sub">子任务 ' + sp.done + '/' + sp.total + '</span>');
    const subs = (t.subtasks || []).map(function (s2) {
      return '<div class="todo-sub-row">' +
        '<button class="sub-tick' + (s2.done ? ' on' : '') + '" data-act="todosub" data-id="' + t.id + '" data-sub="' + s2.id + '" aria-label="子任务"></button>' +
        '<span class="' + (s2.done ? 'done' : '') + '">' + E(s2.text) + '</span>' +
        '<button class="sub-del" data-act="todosubdel" data-id="' + t.id + '" data-sub="' + s2.id + '" aria-label="删除子任务">×</button></div>';
    }).join('');
    return '<div class="todo' + (t.done ? ' done' : '') + (over ? ' over' : '') + '" data-id="' + t.id + '">' +
      '<button class="todo-tick' + (t.done ? ' on' : '') + '" data-act="todotoggle" data-id="' + t.id + '" aria-label="完成"></button>' +
      '<div class="todo-main">' +
      '<div class="todo-title" data-act="todoedit" data-id="' + t.id + '" role="button" tabindex="0">' + E(t.title || '(未命名)') + '</div>' +
      (meta.length ? '<div class="todo-meta">' + meta.join('') + '</div>' : '') +
      (t.note ? '<div class="todo-note">' + E(t.note) + '</div>' : '') +
      (subs ? '<div class="todo-subs">' + subs + '</div>' : '') +
      '</div>' +
      '<button class="todo-more" data-act="todomenu" data-id="' + t.id + '" aria-label="更多操作">⋯</button>' +
      '</div>';
  }

  function renderTodos() {
    if (!window.Todo) return '<div class="card"><div class="muted">待办模块未加载</div></div>';
    const all = Todo.all();
    const open = Todo.sorted(all.filter(t => !t.done));
    const done = Todo.sorted(all.filter(t => t.done));
    const s = Todo.stats();
    let html = '';

    html += '<div class="grid3">' +
      '<div class="stat"><b>' + s.open + '</b><span>待完成</span></div>' +
      '<div class="stat"><b' + (s.overdue ? ' style="color:var(--danger)"' : '') + '>' + s.overdue + '</b><span>已逾期</span></div>' +
      '<div class="stat"><b>' + s.done + '</b><span>已完成</span></div></div>';

    html += '<div class="card"><textarea class="input" id="todoInput" data-max="120" placeholder="加一件要做的事，比如「买跑鞋」「给妈妈打电话」"></textarea>' +
      '<div class="row" style="margin-top:10px;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<div class="chips" id="todoPrio">' +
      [0, 1, 2].map(function (p) {
        return '<button class="chip' + (p === 1 ? ' on' : '') + '" data-act="todoprio" data-v="' + p + '">' + Todo.PRIO[p] + '</button>';
      }).join('') + '</div>' +
      '<input class="input" type="date" id="todoDue" style="max-width:150px">' +
      '<button class="btn" data-act="todoadd" style="margin-left:auto">添加</button></div></div>';

    html += '<div class="sec-title"><h3>待办 · ' + open.length + '</h3></div>';
    if (!open.length) {
      html += emptyGuide({
        title: '没有待办',
        sub: '习惯是「每天要做的事」，待办是「做完就没了的事」',
        actions: '<button class="btn ghost" data-act="todopreset">看看示例</button>'
      });
    } else {
      html += '<div class="list">' + open.map(todoRow).join('') + '</div>';
    }

    if (done.length) {
      html += '<div class="sec-title"><h3>已完成 · ' + done.length + '</h3>' +
        '<span class="more" data-act="todocleardone" style="color:var(--txt-3)">清空</span></div>';
      html += '<div class="list">' + done.slice(0, 30).map(todoRow).join('') + '</div>';
    }
    return html;
  }

  /* 习惯卡片：习惯页两种视图（平铺 / 分组）共用同一套结构 */
  function habitCardHTML(it, idx, total) {
    const sc = it.schedule || {};
    const desc = [
      ({ check: '打卡', number: '计数', duration: '时长' })[it.type],
      it.target ? '目标 ' + U.num(it.target) + (it.unit || '') : null,
      SLOT_NAME[it.slot || 'any'],
      it.reminderAt ? it.reminderAt : null,
      sc.type === 'timesPerWeek' ? '每周' + sc.n + '次' : null,
      sc.type === 'weekdays' ? '周' + (sc.days || []).map(x => '日一二三四五六'[x]).join('') : null,
      sc.type === 'interval' ? '每 ' + sc.n + ' 天' : null,
      sc.type === 'yearly' ? '每年 ' + yearlyText(it) : null,
      Engine.restQuota(it) ? restText(it) : null
    ].filter(Boolean).join(' · ');
    const running = window.Timer && Timer.isFor(it.id);
    /* 上移 / 下移 / 编辑 / 计时 全部收进「⋯」：四个小按钮并排会互相吞点击，
       也让一张卡片只剩「名字 + 状态」两行（复检 3.5：习惯页卡片拥挤）。 */
    return '<div class="hitem" style="--c:' + it.color + '" data-id="' + it.id + '"><div class="h-sw-body">' +
      '<div class="h-main"><div class="h-name" data-act="habitdetail" data-id="' + it.id + '" role="button" tabindex="0" aria-label="查看「' + E(it.name) + '」统计">' + E(it.name) + ' <span class="muted" style="font-size:12px">›</span></div>' +
      '<div class="h-meta">' + E(desc) + '</div>' +
      '<div class="h-meta" style="margin-top:4px"><span class="tag" title="这是「' + E(it.name) + '」这个习惯自己的' + (Engine.isAvoid(it) ? '「连续未破戒」记录（破戒会重置），' : '连续记录，') + '和「今日」概览卡里的「全站连续」分开算">' +
      (Engine.isAvoid(it)
        ? '未破戒 ' + Engine.cleanStreakOf(it.id, U.today()) + ' ' + Engine.streakUnit(it)
        : '连续 ' + Engine.streakOf(it.id, U.today()) + ' ' + Engine.streakUnit(it)) + '</span>' +
      '<span class="tag">' + Engine.rateLabel(it.id, 30).text + '</span></div></div>' +
      '<div class="h-ctl" style="display:flex;align-items:center">' +
      /* 时长型习惯在管理页也给一个计时入口（和今日页同一颗按钮） */
      (it.type === 'duration' && window.Timer
        ? (Timer.isFor(it.id)
          ? '<button class="t-chip run" data-act="timeropen" data-id="' + it.id + '" title="正在计时，点开面板" aria-label="' + E(it.name) + ' 正在计时">' + ico('pause') + '</button>'
          : '<button class="t-chip" data-act="timerstart" data-id="' + it.id + '" title="开始计时，到点自动打卡" aria-label="开始计时：' + E(it.name) + '">' + ico('play') + '</button>')
        : '') +
      '<button class="btn sm ghost" data-act="habitmenu" data-id="' + it.id + '" data-from="habits" aria-label="管理「' + E(it.name) + '」：上移、下移、编辑">⋯</button></div></div></div>';
  }

  /* 分组视图（参考 Habitify 的 Areas）：按第一个标签归类，习惯多了也能一眼看清 */
  const GROUP_ORDER = ['健康', '运动', '学习', '工作', '整理', '家庭', '理财'];
  let _folded = {};   // 折叠的分组名（内存态，不落盘）

  function groupOf(it) { return (it.tags && it.tags[0]) || '其他'; }
  function toggleGroup(name) { _folded[name] = !_folded[name]; }
  function groupList(active) {
    const map = {};
    active.forEach(it => { const g = groupOf(it); (map[g] = map[g] || []).push(it); });
    return Object.keys(map).sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }).map(name => ({ name: name, items: map[name] }));
  }
  function groupStat(items) {
    const today = U.today();
    const due = items.filter(it => Engine.isDue(it, today));
    const done = due.filter(it => Engine.isDone(it, today)).length;
    return { done: done, total: due.length, pct: due.length ? Math.round(done / due.length * 100) : 0 };
  }
  function hgroupHTML(g) {
    const st = groupStat(g.items);
    const fold = !!_folded[g.name];
    return '<div class="hgroup">' +
      '<div class="hgroup-head" data-act="hgroupfold" data-g="' + E(g.name) + '" role="button" tabindex="0">' +
      '<span class="hg-arrow' + (fold ? ' fold' : '') + '">▾</span>' +
      '<span class="hg-dot" style="background:' + ((g.items[0] && g.items[0].color) || '#888') + '"></span>' +
      '<span class="hg-name">' + E(g.name) + '</span>' +
      '<span class="hg-stat">' + st.done + '/' + st.total + ' · ' + st.pct + '%</span></div>' +
      (fold ? '' : '<div class="list" style="margin-top:8px">' +
        g.items.map((it, i) => habitCardHTML(it, i, g.items.length)).join('') + '</div>') +
      '</div>';
  }

  /* 引导式挑战（参考 Fabulous）：有名字、有天数、有终点，加入就自动挂一个习惯 */
  function challengeCard(c) {
    const p = Challenge.pct(c), left = Challenge.left(c);
    const done = !!c.doneAt;
    const it = (S().items || []).find(x => x.id === c.habitId);
    return '<div class="chal' + (done ? ' done' : '') + '">' +
      '<div class="chal-emoji">' + ico(CHAL_ICON[c.key] || 'target') + '</div>' +
      '<div class="chal-main">' +
      '<div class="chal-t">' + E(c.name) + (done ? ' <span class="chal-ok">已完成</span>' : '') + '</div>' +
      '<div class="chal-s">' + (done
        ? '恭喜通关，奖励 ' + (c.reward || 0) + ' 积分已到账'
        : '已完成 ' + Challenge.doneCount(c) + ' / ' + c.days + ' 天' + (it ? ' · 关联习惯「' + E(it.name) + '」' : '') + ' · 还差 ' + left + ' 天') + '</div>' +
      '<div class="chal-bar"><i style="width:' + p + '%"></i></div></div>' +
      '<button class="btn sm ghost" data-act="chaldetail" data-id="' + c.id + '">' + (done ? '查看' : '详情') + '</button>' +
      '</div>';
  }

  function challengeSection() {
    if (!window.Challenge) return '';
    Challenge.syncAll();
    const mine = Challenge.list();
    let html = '<div class="sec-title"><h3>' + ico('target') + '挑战</h3><span class="more">' + mine.length + ' 个进行中</span></div>';
    if (mine.length) {
      html += '<div class="list">' + mine.map(challengeCard).join('') + '</div>';
    } else {
      html += '<div class="card"><div class="muted" style="margin-bottom:10px">不知道从哪个习惯开始？挑一个挑战，加入就自动帮你建好习惯，坚持够天数拿奖励。</div>' +
        '<div class="chips">' + Challenge.PRESETS.slice(0, 4).map(p =>
          '<button class="chip" data-act="chaljoin" data-k="' + p.key + '">' + ico(p.icon || 'target') + ' ' + p.name + '</button>').join('') + '</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm ghost block" data-act="challib">查看全部挑战</button></div></div>';
    }
    return html;
  }

  function renderHabits() {
    const st = S();
    const allActive = Engine.sorted();
    const active = window.Product ? Product.filterHabits(allActive) : allActive;
    const arch = (st.items || []).filter(i => !i.deleted && i.archived);
    let html = '';

    if (window.Product) html += Product.habitsHeader();
    html += '<details class="p-quick-create"><summary>一句话快速创建</summary><div style="padding-top:12px">';
    html += '<div class="notice"><span class="cell-ico" style="color:var(--accent)">' + ico('lightning') + '</span><span>在下面输入一句话，比如「每天早上跑步 30 分钟」，自动填好全部设置</span></div>';
    html += '<div class="card"><textarea class="input" id="oneInput" data-max="100" placeholder="一句话建习惯：每天晚上读书 30 分钟"></textarea>' +
      '<div class="row end" style="margin-top:10px"><button class="btn" data-act="parseone">解析并创建</button></div>' +
      '<div id="parsePreview"></div></div></div></details>';

    html += '<div class="sec-title"><h3>我的习惯 · ' + active.length + '</h3>' +
      '<span class="more" style="display:flex;gap:10px;align-items:center">' +
      /* 新建入口只保留页首那一个；这里原来还有一个「＋ 新建」，两个按钮做同一件事 */
      (active.length > 1 ? '<button class="linkbtn' + (st.settings.habitGroups ? ' on' : '') + '" data-act="togglegroups" aria-label="' + (st.settings.habitGroups ? '切换为平铺列表' : '按时间段分组显示') + '">' + (st.settings.habitGroups ? ico('squares-four') + '分组' : ico('list') + '平铺') + '</button>' : '') +
      '</span></div>';
    if (window.Plus) {
      const rn = (Plus.routines() || []).length;
      html += '<div class="card" style="display:flex;align-items:center;gap:10px;margin-bottom:2px">' +
        '<span class="cell-ico" style="color:var(--accent)">' + ico('link') + '</span><div style="flex:1">' +
        '<div style="font-weight:650;font-size:14px">例程 · 把习惯串成一条链</div>' +
        '<div class="muted" style="font-size:12.5px">' + (rn ? '已建 ' + rn + ' 条，做完一个自动指向下一个' : '比如「早起 → 喝水 → 读书」，做完一个自动跳下一个') + '</div></div>' +
        '<button class="btn sm ghost" data-act="routines">管理</button></div>';
    }
    if (!active.length && allActive.length) {
      html += '<div class="p-empty-result"><h3>没有找到匹配的习惯</h3><p>试试其他名称或标签。</p></div>';
    } else if (!active.length) {
      /* 同上（报告 P0-1）：没读完之前不说「还没有习惯」，也不摆恢复入口 */
      if (!Store.isHydrated || !Store.isHydrated()) {
        html += loadingGuide();
      } else {
        html += emptyGuide({
          title: '还没有习惯',
          sub: '先加一个，或者从下面习惯库里挑一个现成的',
          actions: '<button class="btn" data-act="newhabit">＋ 添加第一个习惯</button>' +
            '<button class="btn ghost" data-act="lib">看看习惯库</button>',
          /* v53 · 报告 P3-15：同上，恢复入口降到页脚，不占主按钮列 */
          footer: '<button data-act="import">之前用过这个应用？从备份恢复</button>',
          trust: true
        });
      }
    } else if (st.settings.habitGroups) {
      html += groupList(active).map(hgroupHTML).join('');
    } else {
      html += '<div class="list">' + active.map((it, idx) => habitCardHTML(it, idx, active.length)).join('') + '</div>';
    }

    html += '<details class="p-quick-create"><summary>挑战与习惯组合 · 更多养成工具</summary><div style="padding-top:12px">';
    html += challengeSection();

    html += '<div class="sec-title"><h3>习惯套餐</h3><span class="more" data-act="newbundle" style="color:var(--accent)">＋ 新建</span></div>';
    if (!(st.bundles || []).length) {
      html += '<div class="card"><div class="muted" style="margin-bottom:10px">套餐可以把几个习惯合成一张卡，点一下全做完。试试这些：</div>' +
        '<div class="chips">' + Feat.BUNDLE_PRESET.map((p, i) =>
          '<button class="chip" data-act="presetbundle" data-i="' + i + '">' + ico(p.icon || 'package') + ' ' + p.name + '</button>').join('') + '</div></div>';
    } else {
      html += '<div class="list">' + st.bundles.map(b => {
        const p = Engine.bundleProgress(b);
        return '<div class="bundle"><div class="bundle-head"><span class="bundle-emoji">' + (b.emoji || '🧩') + '</span>' +
          '<span class="bundle-name">' + E(b.name) + '</span><span class="bundle-prog">' + p.done + '/' + p.total + '</span></div>' +
          '<div class="bundle-items">' + p.list.map(it => '<span class="' + (Engine.isDone(it, U.today()) ? 'ok' : '') + '">' + E(it.name) + '</span>').join('') + '</div>' +
          '<div class="row end" style="margin-top:10px"><button class="btn sm ghost" data-act="editbundle" data-id="' + b.id + '">编辑</button>' +
          '<button class="btn sm ghost" data-act="delbundle" data-id="' + b.id + '">删除</button></div></div>';
      }).join('') + '</div>';
    }

    html += '</div></details><div class="sec-title" id="libSec"><h3>习惯库</h3></div>';
    html += '<div class="card"><div class="chips">' + Feat.LIB.map((l, i) =>
      '<button class="chip" data-act="libadd" data-i="' + i + '">＋ ' + l.name + '</button>').join('') + '</div></div>';

    /* 模板包：一组配好的习惯一键导入（同名复用，不重复建），并自动打成套餐 */
    html += '<div class="sec-title"><h3>习惯模板包</h3><span class="more">一次导入一组，随时可改</span></div>';
    /* 模板包：一组配好的习惯一键导入（同名复用，不重复建），并自动打成套餐。
     * 12 个全平铺占 2000px 上下，是习惯页超高的第一来源。
     * 默认只露前 2 个，其余收进原生 <details>：无 JS、键盘可用、DOM 仍在（导入按钮照样点）。 */
    const packCard = (p, pi) =>
      '<div class="pack"><div class="pack-head"><span class="pack-emoji">' + ico(p.icon || 'target') + '</span>' +
      '<div class="pack-t"><b>' + E(p.name) + '</b><small>' + E(p.desc) + '</small></div></div>' +
      '<div class="pack-items">' + p.items.map(it => E(it.name)).join(' · ') + '</div>' +
      '<button class="btn sm" data-act="packadd" data-p="' + pi + '">导入 ' + p.items.length + ' 个习惯</button></div>';
    const packs = Feat.PACKS;
    html += '<div class="packs">' + packs.slice(0, 2).map((p, i) => packCard(p, i)).join('') + '</div>';
    if (packs.length > 2) {
      html += '<details class="packs-more"><summary>还有 ' + (packs.length - 2) + ' 个模板包 · 展开看看</summary>' +
        '<div class="packs">' + packs.slice(2).map((p, i) => packCard(p, i + 2)).join('') + '</div></details>';
    }

    if (arch.length) {
      html += '<div class="sec-title"><h3>已归档 · ' + arch.length + '</h3></div>';
      html += '<div class="list">' + arch.map(it =>
        '<div class="hitem" style="--c:' + it.color + ';opacity:.65"><div class="h-sw-body"><div class="h-main"><div class="h-name">' + E(it.name) + '</div></div>' +
        '<div class="h-ctl"><button class="btn sm ghost" data-act="unarchive" data-id="' + it.id + '">恢复</button></div></div></div>').join('') + '</div>';
    }
    return html;
  }

  /* 等级卡：Lv + 称号 + 经验条 + 还差多少升级
   * 经验不等同积分 —— 兑换礼物会让积分变少，但等级只升不降 */
  function levelCard() {
    const L = window.Level, s = L.state(), lc = L.leftChecks();
    return '<div class="card lvl">' +
      '<div class="lvl-badge"><b>' + s.lv + '</b><small>Lv</small></div>' +
      '<div class="lvl-main">' +
      '<div class="lvl-t">「' + E(s.title) + '」' +
      '<span class="lvl-xp">' + s.xp + ' XP</span></div>' +
      '<div class="bar lvl-bar"><i style="width:' + s.pct + '%"></i></div>' +
      '<div class="lvl-s">' + (s.left > 0
        ? '再 ' + s.left + ' XP 升到 Lv' + s.nextLv +
        /* 下一级称号和现在一样时别重复写，否则看着像没变化 */
        (s.next !== s.title ? '「' + E(s.next) + '」' : '') +
        (lc.perDay > 1 ? '<span class="muted" title="按最近 7 天的平均获得速度估算，会随记录变化"> · 按近 7 天速度约 ' + lc.days + ' 天</span>' : '')
        : '已是最高等级') + '</div>' +
      '</div></div>';
  }

  /* ---------------- 月度报告 ----------------
   * 自然月维度：日历网格 + 环比 + 出勤/最长连续 + 最稳的三个习惯。
   * 用「上一月 / 下一月」翻页，不能翻到未来月。 */
  function reportYm() { return reportMonth || U.today().slice(0, 7); }
  function monthReportHTML() {
    if (!window.Extra || !Extra.monthReport) return '';
    const ym = reportYm();
    const curYm = U.today().slice(0, 7);
    const r = Extra.monthReport(ym);
    const WD = U.weekLabels().map(w => w.replace('周', ''));
    const delta = r.hasPrev ? r.pct - r.prevPct : 0;
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
    const tone = delta > 0 ? 'var(--ok)' : delta < 0 ? 'var(--danger)' : 'var(--txt-3)';
    let html = '<div class="sec-title"><h3>' + ico('calendar-dots') + '月度报告</h3><span class="more">' +
      (ym === curYm ? '本月' : r.label) + '</span></div>';
    html += '<div class="card mrep">';
    html += '<div class="mrep-head">' +
      '<button class="mrep-nav" data-act="monthprev" aria-label="上一个月">‹</button>' +
      '<b>' + r.label + '</b>' +
      '<button class="mrep-nav" data-act="monthnext"' + (ym >= curYm ? ' disabled' : '') + ' aria-label="下一个月">›</button>' +
      '</div>';
    html += '<div class="mrep-big"><b>' + r.pct + '</b><i>%</i>' +
      (r.hasPrev
        ? '<span class="mrep-delta" style="color:' + tone + '">' + arrow + ' ' + Math.abs(delta) + ' 个百分点<small>较上月 ' + r.prevPct + '%</small></span>'
        : '<span class="mrep-delta" style="color:var(--txt-3)">本月刚开始<small>' + r.days + ' 天有记录</small></span>') +
      '</div>';
    html += '<div class="mrep-grid">' + WD.map(w => '<span class="wd">' + w + '</span>').join('') +
      r.cells.map(c => c === null
        ? '<span class="cal-cell blank"></span>'
        : '<span class="cal-cell lv' + (c.future ? 'f' : c.pct === 0 ? '0' : c.pct < 40 ? '1' : c.pct < 70 ? '2' : c.pct < 100 ? '3' : '4') +
        (c.today ? ' today' : '') + '" title="' + c.date + (c.future ? ' 未到' : ' ' + c.pct + '%') + '">' + (+c.date.slice(8)) + '</span>').join('') +
      '</div>';
    html += '<div class="mrep-kv">' +
      '<span><b>' + r.done + '</b><small>/' + r.total + ' 次</small></span>' +
      '<span><b>' + r.active + '</b><small> 天有打卡</small></span>' +
      '<span><b>' + r.bestRun + '</b><small> 天 · 全站最长连续</small></span></div>';
    if (r.items.length) {
      html += '<div class="mrep-list">' + r.items.map(x =>
        '<div class="mrep-row"><i style="background:' + (x.color || '#888') + '"></i>' +
        '<span class="nm">' + E(x.name) + '</span><span class="pc">' + x.pct + '%</span></div>').join('') + '</div>';
    } else {
      html += '<div class="muted" style="margin-top:12px;font-size:12.5px">这个月还没有安排任何习惯，去「习惯」页建一个吧。</div>';
    }
    html += '</div>';
    return html;
  }

  /* ---------------- 成长 ---------------- */
  /* v24 · 回顾页按数据量分级（评审 4.2）。
   * 数据越少界面越满，是新用户被空报表吓退的头号原因：同一个「回顾」，
   * 第 1 天和第一年看到的应该是两份界面。等级：
   *   lvl 0  0 条记录  → 引导 + 示例，不渲染任何统计卡
   *   lvl 1  1–6 天    → 本周完成 / 有行动的日子 / 最近 7 天 / 记录日历
   *   lvl 2  7–29 天   → 再加周报、近 12 周趋势、热力图、累计三卡、智能洞察
   *   lvl 3  ≥30 天    → 全部（年度、徽章、里程碑、月报…） */
  /* v34 · 解锁口径只在这里写一次（外部评审 P0-1）。
   * 之前 lvl0 的说明写「近 12 周趋势、热力图…攒满 30 天全部打开」，
   * 可它们第 7 个活跃日就出现了 —— 用户按说明等 30 天，等的其实早就在了。
   * 文案和实现分头写，就一定会漂。 */
  const GATE = {
    at7: '上周周报 · 近 12 周趋势 · 热力图',
    /* 徽章墙不在这串里了（走查第 2 条）：它跟着第一枚徽章走，不等 30 天 */
    at30: '智能洞察 · 年度回顾 · 多习惯对比',
    unit: '这里说的「天」都是<b>活跃日</b>：有打卡或数值记录的日子，不是自然日。' +
      '每周三次的习惯，攒 30 个活跃日大约要十周。'
  };
  /* 一句能救人的事实：习惯养成不是 21 天（Lally 等 2010 的实测是 18–254 天，中位数约 66 天）。
   * 第 20 天还没「自动自发」的人，看到这句才不会以为自己失败了。 */
  const SCIENCE = '研究里养成一个习惯平均要 66 天，18–254 天都算正常；漏一天也不会把之前的努力清零。';
  function recordLevel() {
    const st = S();
    let days = 0, done = 0, first = '';
    Object.keys(st.logs || {}).forEach(d => {
      let has = false;
      Object.values(st.logs[d] || {}).forEach(l => { if (l && (l.d || l.v)) { done++; has = true; } });
      if (has) { days++; if (!first || d < first) first = d; }
    });
    return { days: days, done: done, first: first, lvl: days === 0 ? 0 : days <= 6 ? 1 : days <= 29 ? 2 : 3 };
  }

  /* v34 · 早期也看得见的真实记录日历（外部评审 P0-1）。
   * 空白格分两种：还没开始记录（空心）、记录了但没完成（浅灰）。
   * 早期把这两种混成一片「0%」，用户会以为数据没存进去 —— 这是最伤信任的地方。 */
  function recordStrip(first) {
    const n = 28, heat = Engine.heatmap(n), today = U.today();
    const cells = heat.map(h => {
      const pre = first && h.date < first;
      const tip = pre ? h.date + ' 还没开始记录'
        : h.date + (h.level > 0 ? ' 完成 ' + h.pct + '%' : ' 没有记录');
      return '<i class="' + (pre ? 'pre' : 'l' + h.level) + (h.date === today && h.level > 0 ? ' beat' : '') +
        '" title="' + tip + '"></i>';
    }).join('');
    const span = first ? Math.round((Date.parse(today) - Date.parse(first)) / 86400000) + 1 : 0;
    return '<div class="ch-card-title" style="margin:18px 0 6px"><h3>' + ico('calendar-dots') +
      '记录日历 · 近 ' + n + ' 天</h3><span>空格是真的空</span></div>' +
      '<div class="card"><div class="heat heat-sm" data-days="' + n + '">' + cells + '</div>' +
      '<div class="legend legend-2"><i class="pre"></i>还没开始<i style="background:var(--line-2)"></i>有记录没完成' +
      '<i class="l2" style="background:#8ecfae"></i><i class="l4" style="background:#1f8a58"></i>越深完成越多</div>' +
      (first ? '<div class="muted" style="margin-top:10px;font-size:12px">从 ' + E(U.prettyDate(first)) +
        ' 开始记录，到今天第 ' + span + ' 天</div>' : '') +
      /* v37 · 早期最需要的不是功能，是一个不让人自我否定的锚点。
       * 市面横评开篇就在纠正「21 天养成一个习惯」这个流传太广的错误说法：
       * Lally 2010 的实测是 18–254 天、平均约 66 天。写在这里，第 20 天没「自动养成」的人
       * 才不会以为自己失败了。 */
      '<div class="muted" style="margin-top:8px;font-size:12px">' + SCIENCE + '</div>' +
      '</div>';
  }

  /* 智能洞察：样本不足（<14 个活跃日或 <10 次完成）时不出结论 ——
   * 拿 1 次打卡就讲「周六最弱」，是把噪声当规律，最伤信任。
   * v34 起这个门槛是唯一的一道：外层不再有「≥30 活跃日」的重复闸门。 */
  function insightsHTML() {
    const sm = Insights.sample ? Insights.sample() : { ok: true, daysLeft: 0, doneLeft: 0, days: 0, done: 0 };
    const ins = sm.ok ? Insights.all() : [];
    let h = '<div class="sec-title"><h3>' + ico('sparkle') + '智能洞察</h3><span class="more">从你的数据里算出来的</span></div>';
    h += ins.length
      ? ins.map(i => '<div class="card ins ' + (i.tone || 'info') + '">' +
          /* v39：这里原来直接把图标名当文本塞进去，卡片上显示的是「calendar-dots」这几个字 */
          '<div class="ins-ico">' + ico(i.icon) + '</div><div class="ins-main">' +
          '<div class="ins-t">' + E(i.title) + '</div>' +
          '<div class="ins-b">' + E(i.body) + '</div></div></div>').join('')
      : '<div class="card"><div class="muted">' +
        (sm.ok
          ? '再积累几天数据，这里会自动告诉你：周几最容易断、哪些习惯互相带动、最近是不是在下滑。'
          : '数据还不够：再攒 ' + (sm.daysLeft ? sm.daysLeft + ' 个活跃日' : '') +
            (sm.daysLeft && sm.doneLeft ? '、' : '') + (sm.doneLeft ? sm.doneLeft + ' 次完成' : '') +
            '，这里就能看出你周几最容易断。' +
            '（现在 ' + sm.days + ' 个活跃日 / ' + sm.done + ' 次，门槛是 14 个活跃日且 10 次）') +
        '</div></div>';
    h += '<div class="row" style="margin:10px 0 4px"><button class="btn sm ghost block" data-act="sharecard">' + ico('image') + '生成分享卡片</button></div>';
    return h;
  }

  /* v42 · 走查第 14 条：前 7 天回顾页几乎是空页。
   * 原来这一档只有一句「再攒 N 个活跃日解锁」—— 用户既不知道解锁后长什么样，
   * 也不知道自己走到哪了，页面读起来就是「这个 App 什么都没有」。
   * 现在给一块标注「示例」的灰色示意：假数据、去色、点不动、读屏跳过，
   * 下面紧跟真实进度「你已 X/7」。示意不参与任何统计，也不写进任何状态。 */
  function lockedPreview(days) {
    const bars = [22, 38, 30, 52, 61, 45, 70, 58, 40, 66, 74, 55];
    const mock =
      '<div class="card"><div class="row" style="align-items:flex-end;gap:14px">' +
      '<div style="font-size:34px;font-weight:800;line-height:1;color:var(--accent)">82%</div>' +
      '<div class="muted" style="flex:1;line-height:1.5">上周完成 <b>23</b> / 28 次 · 比上上周提升 6 个百分点</div></div>' +
      '<div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">' +
      '<span class="chip" style="pointer-events:none">最佳：晨读 100%</span>' +
      '<span class="chip" style="pointer-events:none">全站连续 12 天</span></div></div>' +
      '<div class="card"><div class="bars">' + bars.map(p =>
        '<div class="b' + (p >= 80 ? ' on' : '') + '" style="height:' + p + '%"></div>').join('') + '</div></div>' +
      '<div class="card"><div class="heat heat-sm">' +
      Array.from({ length: 28 }, (_, i) => '<i class="l' + (i % 5 === 0 ? 2 : (i % 4) + 1) + '"></i>').join('') +
      '</div></div>';
    return '<div class="locked">' +
      '<div class="locked-h"><div class="ch-card-title" style="margin:0"><h3>' + ico('sparkle') +
      '解锁后，这一页长这样</h3></div><span class="locked-tag">示例</span></div>' +
      '<div class="locked-body" aria-hidden="true">' + mock + '</div>' +
      '<div class="locked-foot">' +
      '<div class="row" style="justify-content:space-between;align-items:baseline;gap:12px">' +
      '<div style="font-size:15px;font-weight:700">攒满 7 个活跃日解锁，你已 <b style="color:var(--accent)">' + days + '</b>/7</div>' +
      '<div class="muted" style="font-size:12px">上面是示意，不是你的数据</div></div>' +
      '<div class="h-bar" style="margin-top:8px"><i style="width:' + Math.round(days / 7 * 100) + '%"></i></div>' +
      '</div></div>';
  }

  function renderGrow() {
    const L = recordLevel();
    const st = S();
    const heat = Engine.heatmap(119);
    const wk = Engine.weeklyTrend(12);
    const maxPct = Math.max(1, ...wk.map(w => w.pct));

    /* lvl 0：只给引导。没有数据时最该说的不是「0%」，而是「第一条记录之后这里会变成什么样」。 */
    if (L.lvl === 0) {
      return (window.Product ? Product.reviewEmpty() : '') +
        '<div class="sec-title"><h3>有了记录，这里会出现什么</h3></div>' +
        '<div class="card"><div class="muted" style="line-height:1.8">' +
        '第一条记录之后，这一页会按你已有的数据逐级解锁：<br>' +
        '· <b>第一条记录就有</b> —— 本周完成率、最近 7 天、记录日历<br>' +
        '· <b>攒满 7 个活跃日</b> —— ' + GATE.at7 + '<br>' +
        '· <b>攒满 30 个活跃日</b> —— ' + GATE.at30 + '<br>' +
        '<span style="font-size:12px">' + GATE.unit + '</span><br>' +
        '现在什么都不显示，是因为还看不出任何规律。</div></div>' +
        lockedPreview(0);
    }

    let html = window.Product ? Product.insights() : '';
    /* ---------- 徽章墙：拿到第一枚就开放（走查第 2 条） ----------
     * 原来它坐在「≥30 活跃日」那一组里，可「第一步」这枚徽章第 1 天就解锁了 ——
     * 用户拿到徽章却看不到墙，激励链路是断的。现在只要有一枚就画墙；
     * 一枚都没有时给一张「第一枚在哪」的指路卡（不是墙，别用一堆空格子占地方）。
     * 30 天门槛只留给统计类模块（智能洞察 / 年度回顾 / 多习惯对比）。
     * 位置在 lvl1 的提前返回之前：第一天的用户也该看见自己刚拿到的那枚。 */
    const gotBadges = window.Extra ? Extra.badges().filter(b => b.got).length : 0;
    if (gotBadges > 0) html += badgeWallHTML();
    else {
      const bs = window.Extra ? Extra.badges() : [];
      const first = bs[0];
      html += '<div class="ch-card-title" style="margin:18px 0 6px"><h3>' + ico('medal') + '徽章墙</h3><span>拿到第一枚就开放</span></div>' +
        '<div class="card"><div class="muted" style="line-height:1.75">' +
        (first ? '最近的一枚是<b>' + E(first.name) + '</b>：' + E(first.desc) + '。' : '完成第一次打卡就能拿到第一枚徽章。') +
        '<br>墙上有 ' + bs.length + ' 枚徽章和 ' + (window.Extra ? Extra.milestones().length : 0) +
        ' 级连击里程碑，达成后自动点亮 —— 不需要等任何天数门槛。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-act="badges">先看看都有什么</button></div></div>';
    }
    /* lvl 1（1–6 天）：三个模块 + 一条真实的 28 天记录日历 + 一张「下一步解锁什么」的卡。
       以前这一档页面是死的——用户看不到任何「再坚持几天会多出什么」的期待，
       下一页该出什么都得自己猜（复检 3.1 / 06 排期第 1 天）。 */
    if (L.lvl === 1) {
      html += recordStrip(L.first);
      html += '<div class="ch-card-title" style="margin:18px 0 6px"><h3>' + ico('ladder') + '再攒几个活跃日就能解锁</h3><span>按数据量逐级打开</span></div>' +
        '<div class="card"><div class="row" style="justify-content:space-between;align-items:baseline;gap:12px">' +
        '<div style="font-size:17px;font-weight:700">还差 <b style="color:var(--accent)">' + (7 - L.days) + '</b> 个活跃日</div>' +
        '<div class="muted" style="text-align:right">' + GATE.at7.replace(/ · /g, '<br>') + '</div></div>' +
        '<div class="h-bar" style="margin-top:10px"><i style="width:' + Math.round(L.days / 7 * 100) + '%"></i></div>' +
        '<div class="muted" style="margin-top:10px;line-height:1.7">满 7 个活跃日，多出上面这几块；' +
        '满 30 个活跃日，再打开 ' + GATE.at30 + '。' +
        '数据不够时这里什么都不给——比摆一堆 0% 更诚实。</div>' +
        '<div class="muted" style="margin-top:8px;font-size:12px;line-height:1.7">' + GATE.unit + '</div></div>' +
        lockedPreview(L.days);
      return html;
    }

    /* ---------- v20 · 上周周报卡 ---------- */
    if (window.Extra) {
      const lw = Extra.lastWeekReport();
      const weak = lw.items.length ? lw.items[lw.items.length - 1] : null;
      html += '<div class="ch-card-title" style="margin:18px 0 6px"><h3>' + ico('chart-bar') + '上周周报</h3><span>本机计算 · 不上传</span></div>' +
        (lw.total > 0
          ? '<div class="card"><div class="row" style="align-items:flex-end;gap:14px">' +
            '<div style="font-size:34px;font-weight:800;line-height:1;color:var(--accent)">' + lw.pct + '%</div>' +
            '<div class="muted" style="flex:1;line-height:1.5">上周完成 <b>' + lw.done + '</b> / ' + lw.total + ' 次' +
            (lw.prevPct || lw.total
              ? ' · 比上上周' + (lw.pct >= lw.prevPct ? '提升 ' + (lw.pct - lw.prevPct) : '下降 ' + (lw.prevPct - lw.pct)) + ' 个百分点'
              : '') + '</div></div>' +
            '<div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">' +
            (lw.items[0] ? '<span class="chip" style="pointer-events:none">' + ico('medal') + '最佳：' + E(lw.items[0].name) + ' ' + lw.items[0].pct + '%</span>' : '') +
            (weak && weak.pct < 100 ? '<span class="chip" style="pointer-events:none">' + ico('warning-circle') + '待加强：' + E(weak.name) + ' ' + weak.pct + '%</span>' : '') +
            '<span class="chip" style="pointer-events:none">' + ico('fire') + '全站连续 ' + Engine.globalStreak() + ' 天</span>' +
            '</div>' +
            '<ul class="wk-bullets">' + lw.bullets.map(b => '<li>' + E(b) + '</li>').join('') + '</ul>' +
            '</div>'
          : '<div class="card"><div class="muted">上周还没有记录 —— 这周开始，下周这里就有第一份周报了。</div></div>');
    }

    html += '<div class="sec-title"><h3>近 ' + wk.length + ' 周完成率</h3></div>';
    html += '<div class="card"><div class="bars">' + wk.map(w =>
      '<div class="b' + (w.pct >= 80 ? ' on' : '') + '" style="height:' + Math.max(3, w.pct / maxPct * 100) + '%" title="' + w.label + ' ' + w.pct + '%"></div>').join('') + '</div>' +
      '<div class="bars-x">' + wk.map(w => '<span>' + w.label + '</span>').join('') + '</div></div>';

    /* ---------- v55 · 打卡时段：一天里几点最稳 ----------
     * 外部调研（2026-10）收尾的最后一块：时段规律有文字洞察，但没有「一眼看到分布」。
     * 峰值只高亮、不说死结论；样本不足 20 次时讲清还差几次（v34 诚实门槛的同一套话术）。 */
    {
      const hd = Insights.hourDist ? Insights.hourDist() : null;
      if (hd) {
        html += '<div class="sec-title"><h3>打卡时段</h3><span>最近 90 天 · 只算当天打的卡</span></div>';
        if (hd.ok) {
          const maxB = Math.max(1, ...hd.bins);
          html += '<div class="card">' +
            '<div class="row" style="align-items:baseline;gap:10px;flex-wrap:wrap">' +
            '<div style="font-size:17px;font-weight:700">你最常在 <b style="color:var(--accent)">' + (hd.peak * 2) + '–' + (hd.peak * 2 + 2) + ' 点</b> 打卡</div>' +
            '<div class="muted">' + hd.bins[hd.peak] + ' 次 · 占 ' + Math.round(hd.bins[hd.peak] / hd.total * 100) + '%</div></div>' +
            '<div class="bars">' + hd.bins.map((n, i) =>
              '<div class="b' + (i === hd.peak ? ' on' : '') + '" style="height:' + Math.max(3, n / maxB * 100) + '%" title="' + (i * 2) + '–' + (i * 2 + 2) + ' 点 · ' + n + ' 次"></div>').join('') + '</div>' +
            '<div class="bars-x">' + hd.bins.map((_, i) => '<span>' + (i * 2) + '</span>').join('') + '</div>' +
            '<div class="muted" style="margin-top:8px;font-size:12px;line-height:1.6">提醒时间照着这个挪，响的时候正好是你本来就会做的时候。</div></div>';
        } else {
          html += '<div class="card"><div class="muted">带时刻的打卡攒够 20 次后，这里会告诉你一天里哪个时段你最稳（现在 ' + hd.total + ' 次，还差 ' + hd.left + ' 次）。</div></div>';
        }
      }
    }

    html += '<div class="grid3">' +
      '<div class="stat"><b>' + Engine.globalStreak() + '</b><span>全站连续天数</span></div>' +
      '<div class="stat"><b>' + Engine.totalCheckins() + '</b><span>累计打卡</span></div>' +
      '<div class="stat"><b>' + Engine.points() + '</b><span>可用积分</span></div></div>';

    /* 智能洞察：门槛只由样本决定（14 个活跃日且 10 次完成）。
     * 以前它被外层「≥30 活跃日」挡着，内层的样本检查成了永远用不到的代码 ——
     * 一个每周三次的人，本该第 5 周就看到规律，却要等到第 10 周（外部评审 P0-1）。 */
    if (window.Insights) html += insightsHTML();

    html += '<div class="sec-title"><h3>打卡热力图 · 近 ' + heat.length + ' 天</h3></div>';
    const today = U.today();
    html += '<div class="card"><div class="heat" data-days="' + heat.length + '">' + heat.map(h =>
      '<i class="l' + h.level + (h.date === today && h.level > 0 ? ' beat' : '') +
      '" title="' + h.date + ' ' + h.pct + '%"></i>').join('') + '</div>' +
      '<div class="legend">少 <i style="background:var(--line-2)"></i><i class="l1" style="background:#cfe0d8"></i>' +
      '<i style="background:#8ecfae"></i><i style="background:#4fae7f"></i><i style="background:#1f8a58"></i> 多</div></div>';

    if (L.lvl === 2) return html;

    /* ---------- 以下为 ≥30 天数据后的全量模块 ---------- */
    /* 等级 / 经验：给坚持一个身份感（经验只涨不跌，和会花掉的积分分开） */
    if (window.Level) html += levelCard();

    /* 智能洞察已上移到 lvl2（由它自己的样本门槛决定是否出结论），这里不再重复渲染 */

    /* ---------- 多习惯对比：本月谁强谁弱，一眼排出来 ---------- */
    if (window.Extra) {
      const mr = Extra.monthReport(U.today().slice(0, 7));
      if (mr.list && mr.list.length > 1) {
        html += '<div class="ch-card-title" style="margin:18px 0 6px"><h3>多习惯对比 · 本月</h3><span>按完成率排名</span></div>' +
          '<div class="card chart-card">' + Chart.hbars(mr.list) + '</div>';
      }
    }

    const corr = Engine.moodCorrelation();
    if (corr.length >= 2) {
      html += '<div class="sec-title"><h3>心情 × 完成率</h3></div>';
      html += '<div class="card"><div class="bars">' + corr.map(c =>
        '<div class="b" style="height:' + Math.max(3, c.pct) + '%" title="心情' + c.mood + ' 完成率 ' + c.pct + '%"></div>').join('') + '</div>' +
        '<div class="bars-x">' + corr.map(c => '<span>' + MOODS[c.mood - 1] + '</span>').join('') + '</div>' +
        '<div class="muted" style="margin-top:8px">心情越好，完成率往往越高 —— 共 ' + corr.reduce((a, c) => a + c.n, 0) + ' 天有记录</div></div>';
    }

    /* 没登录就别在回顾页摆一个「去登录」的坑：这块直接不出现，房间页才给引导 */
    if (signedInCloud()) {
      html += '<div class="sec-title"><h3>房间排行榜 · 今日</h3></div>';
      html += '<div class="card" id="growRank"><div class="muted">正在拉取…</div></div>';
      setTimeout(() => paintRoomRank('#growRank'), 60);
    }

    const y = Engine.yearly(new Date().getFullYear());
    html += '<div class="sec-title"><h3>' + y.year + ' 年度回顾</h3><span class="more linkbtn" data-act="yearposter" style="color:var(--accent)">做张年度海报 ›</span></div>';
    html += '<div class="card">' +
      '<div class="grid3" style="gap:8px">' +
      '<div class="stat" style="box-shadow:none;background:var(--bg-2)"><b>' + y.rate + '%</b><span>年度完成率</span></div>' +
      '<div class="stat" style="box-shadow:none;background:var(--bg-2)"><b>' + y.daysActive + '</b><span>有效天数</span></div>' +
      '<div class="stat" style="box-shadow:none;background:var(--bg-2)"><b>' + y.totalDone + '</b><span>完成次数</span></div></div>' +
      /* 习惯是年中才建的：说清楚统计从哪天开始，否则用户会以为 0% 是 bug */
      (y.from && y.from > (y.year + '-01-01')
        ? '<div class="muted" style="margin-top:10px;font-size:12px">统计自 ' + E(y.from.slice(5).replace('-', ' 月 ') + ' 日') + '起（第一个习惯的创建日），之前的日子不计入分母</div>'
        : '') +
      (y.top.length ? '<div style="margin-top:14px">' + y.top.map(t =>
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<span style="width:9px;height:9px;border-radius:50%;background:' + t.color + '"></span>' +
        '<span style="flex:1;font-size:14px">' + E(t.name) + '</span>' +
        '<span style="font-weight:650;font-size:13px">' + t.rate + '%</span></div>').join('') + '</div>' : '') +
      '<div class="row" style="margin-top:12px"><button class="btn sm ghost" data-act="poster">生成日签海报</button></div>' +
      '</div>';

    /* 今年写下的句子（v28 · 4.5）：年度回顾只给百分比太冷，而这些话是当时真发生的事。
     * 取最近 3 句，完整列表走日记搜索。 */
    const yn = yearNotes(y.year);
    if (yn.length) {
      html += '<div class="sec-title"><h3>今年写下的句子</h3><span class="more">共 ' + yn.length + ' 句</span></div>' +
        '<div class="card">' + yn.slice(0, 3).map(n =>
          '<div class="yn"><div class="yn-t">“' + E(n.note) + '”</div>' +
          '<div class="yn-m">' + E(n.name) + ' · ' + U.prettyDate(n.date) + '</div></div>').join('') +
        (yn.length > 3 ? '<div class="muted" style="margin-top:8px;font-size:12px">还有 ' + (yn.length - 3) + ' 句，在「日记 → 搜索」里能搜到</div>' : '') +
        '</div>';
    }

    /* 连续保护券 */
    if (window.Extra) {
      const fz = Extra.freezeInfo();
      html += '<div class="sec-title"><h3>' + ico('snowflake') + '连续保护券</h3><span class="more">' + fz.left + ' 张</span></div>';
      html += '<div class="card">' +
        '<div class="kv"><span>剩余</span><b>' + fz.left + ' 张</b></div>' +
        (fz.usedDates.length ? '<div class="kv"><span>已用于</span><b>' + E(fz.usedDates.slice(0, 3).join('、')) + '</b></div>' : '') +
        '<div class="muted" style="margin-top:8px">每月 1 号自动补 1 张（最多囤 2 张）。昨天漏打卡时会自动消耗一张保住连续记录，也可以在日历里手动给某天请假/保护。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="fixdates">打开补卡日历</button></div></div>';
    }

    /* 成就徽章墙已上移到 lvl2 上方「拿到第一枚就开放」（走查第 2 条），这里不再重复渲染 */

    /* 月度报告：自然月维度，和下面的「本周回顾」配成一组 */
    html += monthReportHTML();

    /* 周期回顾 */
    if (window.Extra) {
      const rv = Extra.review('week');
      html += '<div class="sec-title"><h3>' + ico('clipboard') + '本周回顾</h3><span class="more">' + rv.pct + '%</span></div>';
      html += '<div class="card">' + rv.bullets.map(t =>
        '<div style="display:flex;gap:7px;margin-bottom:7px"><span style="color:var(--accent)">·</span><span>' + E(t) + '</span></div>').join('') +
        '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="weekcard">' + ico('image') + '生成本周回顾卡片</button>' +
        '<button class="btn sm ghost" data-act="review30">看近 30 天</button>' +
        '<button class="btn sm ghost" data-act="copyreview">复制小结</button></div></div>';
    }

    return html;
  }

  /* ---------------- 我的 ---------------- */
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  /* ---------------- 我的 ----------------
   * v54 · 走查 P1-5：「我的」页原来一屏堆了十几组 —— 账号、常用、外观、提醒 5 项展开、
   * 隐私锁、数据与存储、导入导出 9 项、房间、时间胶囊、清理、安全网、清空、关于……
   * 滚动极长，找一项只能靠目测。现在收成「一级页 + 3 个分组」：
   *   一级页只留最常碰的三件事（提醒权限 / 云备份 / 主题 + 提醒开关 + 导出备份）
   *   以及三个入口，其余进二级页。
   * 为什么用「二级页」而不是手风琴：设置项有 20 多个，全展开等于没分组；
   * 收起的手风琴又会让「数据安全网」这种该被看见的东西默认不可见。 */
  let meSub = '';   // '' | 'settings' | 'data' | 'tools'

  function renderMe() {
    return meSub ? meSubPage(meSub) : meHome();
  }

  function meHome() {
    const st = S();
    /* 数据状态条常驻一级页：它回答的是「我的记录还在不在本机」，
     * 这个问题不该藏在二级页里。
     * 备份提醒条（v44 · 走查 P0-③）同样常驻 —— 它的设计原话就是「常驻、不给关」：
     * 用户最容易犯的错不是「忘了备份」，而是「根本不知道要备份」。
     * v54 分组时它一度被挪进二级页，线上验收当场抓住，这里放回。 */
    let html = window.Product ? Product.storageCard() : '';
    html += backupStatusLine();

    html += '<div class="card"><div style="display:flex;align-items:center;gap:12px">' +
      '<div style="width:46px;height:46px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-size:19px;font-weight:700">' +
      E((st.settings.nickname || '我').slice(0, 1)) + '</div>' +
      '<div style="flex:1"><div style="font-weight:650">' + E(st.settings.nickname || '还没设置昵称') + '</div>' +
      '<div class="muted">连续 ' + Engine.globalStreak() + ' 天 · 积分 ' + Engine.points() + '</div></div>' +
      '<button class="btn sm ghost" data-act="setname">设置</button></div></div>';

    /* 常用：提醒与通知 / 云备份 原来占着顶栏右半边，两个都是低频设置，
     * 顶栏只留「更多」。入口挪到这里，红点跟着挪过来。 */
    const rmPerm = (window.Remind && Remind.perm) ? Remind.perm() : 'unsupported';
    const rmSub = rmPerm === 'granted'
      ? (st.settings.remindEnabled ? '权限已开启 · 提醒总开关已开' : '权限已开启 · 提醒总开关关闭')
      : rmPerm === 'denied' ? '被浏览器拦住了，点这里看怎么改回来' : '还没授权系统通知';
    const cloudSub = (window.Cloud && Cloud.signedIn && Cloud.signedIn())
      ? '已开启，换设备登录自动恢复'
      : '未开启 · 清缓存或换手机就没了';
    html += '<div class="card">' +
      cell('#bell', '提醒与通知', rmSub, 'notifypanel', 'meNotifyDot') +
      cell('#cloud', '云备份', cloudSub, 'cloudpanel', 'meCloudDot') +
      '</div>';

    /* 快捷卡：走查要求「主题、提醒总开关、导出备份」留在一级直达 ——
     * 这三件是真正天天会碰的，藏进二级页会变成「每次多两次点击」。 */
    html += '<div class="card">' +
      '<div class="field"><label>主题</label><div class="chips" id="themeChips">' +
      ['system:跟随系统', 'light:浅色', 'dark:深色'].map(t => {
        const [v, n] = t.split(':');
        return '<button class="chip' + (st.settings.theme === v ? ' on' : '') + '" data-act="theme" data-v="' + v + '">' + n + '</button>';
      }).join('') + '</div></div>' +
      '<div class="line-cell"><div><div class="k">打卡提醒</div><div class="s">' + U.esc(remindStatus()) + '</div></div>' +
      '<div class="sw' + (st.settings.remindEnabled ? ' on' : '') + '" data-act="toggleremind"><i></i></div></div>' +
      '<div class="line-cell"><div><div class="k">导出备份</div><div class="s">存成 JSON 文件，可选是否连照片语音一起打包</div></div>' +
      '<button class="btn sm" data-act="export">立即导出</button></div>' +
      '</div>';

    html += '<div class="me-groups">' +
      meGroup('settings', 'dots-three-circle', '设置与提醒',
        '主题字号 · 4 种提醒的时间 · 补卡期限 · 一周从哪天开始') +
      meGroup('data', 'package', '数据与备份',
        backupSubLine()) +
      meGroup('tools', 'briefcase', '更多工具',
        '番茄钟 · 积分商店 · 徽章 · 房间 · 时间胶囊 · 隐私锁 · 帮助') +
      '</div>';

    html += '<div class="muted" style="text-align:center;padding:16px 0 4px">' +
      '日拱一卒 v' + E(U.VERSION) + ' · ' + E(U.VERSION_NAME) + '<br>' +
      '<span style="font-size:12px">数据只存在你自己的浏览器 / 账号里</span></div>';
    return html;
  }

  /* 分组入口的一行。副标题要带真实状态（尤其数据那组），
   * 否则用户还是得点进去才知道「我备份过没有」。 */
  function meGroup(key, icon, title, sub) {
    return '<button class="me-group" data-act="mesub" data-v="' + key + '">' +
      '<span class="me-group-ico">' + ico(icon) + '</span>' +
      '<span class="me-group-txt"><b>' + E(title) + '</b><span>' + E(sub) + '</span></span>' +
      ico('arrow-right') + '</button>';
  }

  /* 数据分组的副标题：备份状态 + 用量。两项都拿不到时退回一句静态说明。 */
  function backupSubLine() {
    const parts = [];
    try {
      const at = S().settings.lastExportAt || 0;
      if (!at) parts.push('还没导出过备份');
      else {
        const d = Math.floor((Date.now() - at) / 86400000);
        parts.push(d <= 0 ? '今天导出过备份' : d + ' 天前导出过备份');
      }
    } catch (e) { }
    if (parts.length) parts.push('导入导出 · 存储用量 · 数据安全网');
    return parts.join(' · ');
  }

  function meSubPage(key) {
    const T = {
      settings: ['设置与提醒', '外观、四种提醒的时间、补卡期限'],
      data: ['数据与备份', '导出、导入、存储用量与安全网'],
      tools: ['更多工具', '番茄钟、积分、徽章、房间、时间胶囊']
    };
    const t = T[key] || T.settings;
    let html = '<div class="me-sub-head">' +
      '<button class="me-back" data-act="mesub" data-v="" aria-label="返回我的">' + ico('arrow-right') + '</button>' +
      '<div><h1>' + E(t[0]) + '</h1><p>' + E(t[1]) + '</p></div></div>';
    html += key === 'data' ? meData() : key === 'tools' ? meTools() : meSettings();
    return html;
  }

  function meSettings() {
    const st = S();
    const rmNight = (window.Remind && Remind.nightCfg()) || { on: true, at: '21:30' };
    const rmNudge = (window.Remind && Remind.nudgeCfg && Remind.nudgeCfg()) || { on: true, at: '21:00' };
    const rmDiary = (window.Remind && Remind.diaryCfg()) || { on: true, at: '22:30' };
    const rmWeek = (window.Remind && Remind.weekCfg()) || { on: true, at: '20:30', wd: 0 };
    let html = '<div class="card">' +
      /* v58 · 商业软件对标（Streaks 78 主题的克制版）：8 个精选主题色。
       * 放设置页第一项 —— 外观是「我的」里最常被翻出来玩的。 */
      '<div class="field"><label>主题色</label><div class="chips" id="fAccent">' +
      (window.__ACCENTS__ || []).map(function (a) {
        return '<button class="chip' + ((st.settings.accentKey || 'indigo') === a.key ? ' on' : '') +
          '" data-act="setaccent" data-v="' + a.key + '" aria-label="主题色 ' + a.name +
          '" style="background:' + a.dot + ';width:34px;height:34px;padding:0;border-radius:50%"></button>';
      }).join('') + '</div>' +
      '<div class="s" style="margin-top:6px">整个应用的按钮、进度环、高亮都跟着换</div></div>' +
      /* v20 · 无障碍进阶：字号缩放 + 色盲友好模式。色盲友好的取舍见 assets/app.css：
       * 只换色相（红绿→蓝橙），深浅、图案、文字全保留，信息量不减。 */
      '<div class="field"><label>字号</label><div class="chips">' +
      [['normal', '标准'], ['large', '大字号']].map(function (o) {
        return '<button class="chip' + ((st.settings.fontScale === 'large' ? 'large' : 'normal') === o[0] ? ' on' : '') +
          '" data-act="setfs" data-v="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="s" style="margin-top:6px">整体放大文字与按钮，约 1.1 倍</div></div>' +
      '<div class="line-cell"><div><div class="k">色盲友好模式</div><div class="s">把红绿换成蓝橙，完成 / 未完成、进度深浅都不变</div></div>' +
      '<div class="sw' + (st.settings.colorBlind ? ' on' : '') + '" data-act="togglecb" role="switch" aria-checked="' + (st.settings.colorBlind ? 'true' : 'false') + '" aria-label="色盲友好模式"><i></i></div></div>' +
      '<div class="line-cell"><div><div class="k">按时段分组</div><div class="s">今日页按早/午/晚分组显示</div></div>' +
      '<div class="sw' + (st.settings.groupBySlot ? ' on' : '') + '" data-act="toggleslot"><i></i></div></div>' +
      '<div class="line-cell"><div><div class="k">打卡音效</div><div class="s">按下打卡键时"哒"一声，可随时关掉</div></div>' +
      '<div class="sw' + (st.settings.sound === false ? '' : ' on') + '" data-act="togglesound"><i></i></div></div>' +
      '</div>';

    html += '<div class="sec-title"><h3>提醒时间</h3></div>';
    html += '<div class="card">' +
      '<div class="line-cell"><div><div class="k">断签预警</div><div class="s">今天还差几个、而连续记录要断时，提前 3 小时提醒一次</div></div>' +
      '<div class="sw' + (rmNudge.on ? ' on' : '') + '" data-act="togglenudge"><i></i></div></div>' +
      '<div class="field"><label>预警时间</label><input class="input" type="time" id="rmNudgeAt" value="' + U.esc(rmNudge.at || '21:00') + '" data-act="setnudgeat" style="max-width:150px"></div>' +
      '<div class="line-cell"><div><div class="k">睡前兜底检查</div><div class="s">到时间还没打卡完，汇总提醒一次</div></div>' +
      '<div class="sw' + (rmNight.on ? ' on' : '') + '" data-act="togglenight"><i></i></div></div>' +
      '<div class="field"><label>兜底时间</label><input class="input" type="time" id="rmNightAt" value="' + U.esc(rmNight.at || '21:30') + '" data-act="setnightat" style="max-width:150px"></div>' +
      '<div class="line-cell"><div><div class="k">写日记提醒</div><div class="s">这天打了卡却还没写日记，到点提醒一次</div></div>' +
      '<div class="sw' + (rmDiary.on ? ' on' : '') + '" data-act="togglediary"><i></i></div></div>' +
      '<div class="field"><label>提醒时间</label><input class="input" type="time" id="rmDiaryAt" value="' + U.esc(rmDiary.at || '22:30') + '" data-act="setdiaryat" style="max-width:150px"></div>' +
      '<div class="line-cell"><div><div class="k">每周复盘</div><div class="s">周日晚推一次本周完成率 + 复盘要点</div></div>' +
      '<div class="sw' + (rmWeek.on ? ' on' : '') + '" data-act="toggleweek"><i></i></div></div>' +
      '<div class="field"><label>复盘时间</label><input class="input" type="time" id="rmWeekAt" value="' + U.esc(rmWeek.at || '20:30') + '" data-act="setweekat" style="max-width:150px"></div>' +
      '<button class="btn ghost" data-act="remindtest" style="margin-top:8px">发一条测试提醒</button>' +
      '</div>';

    /* v50 · 提醒学会闭嘴：自动关掉的东西必须摆到明处。
     * 悄悄不提醒，用户只会以为提醒坏了；说清楚「因为它你已经做到了」，
     * 再给一个「还是提醒我」的开关，这件事才算完整。 */
    html += (function () {
      if (!window.Remind || !Remind.maturity) return '';
      const list = Engine.items().filter(it => it.reminderAt && Remind.maturity(it).level > 0);
      if (!list.length) return '';
      return '<div class="card" style="margin-top:10px;background:var(--bg-2);box-shadow:none">' +
        '<div class="kv"><span>提醒学会闭嘴</span><b>' + list.length + ' 个已自动减少</b></div>' +
        list.map(it => {
          const m = Remind.maturity(it);
          return '<div class="line-cell"><div><div class="k">' + E(it.name) + '</div>' +
            '<div class="s">' + E((m.level === 2 ? '已经不再提醒 · ' : '只提醒一次 · ') + m.text) + '</div></div>' +
            '<div class="sw' + (it.remindAlways ? ' on' : '') + '" data-act="remindalways" data-id="' + it.id + '" role="switch" aria-checked="' + (it.remindAlways ? 'true' : 'false') + '" aria-label="还是提醒我：' + E(it.name) + '"><i></i></div></div>';
        }).join('') +
        '<div class="muted" style="margin-top:6px">做得稳的习惯就不再天天催 —— 提醒太多，最后是通知权限被整个关掉。想继续被提醒，打开右边开关。</div></div>';
    })();

    /* 日历订阅（v51）：网页通知只在页面活着时可靠，而系统日历是唯一
     * 「一定会响、且不需要记得打开 App」的通道。 */
    html += '<div class="sec-title"><h3>关掉网页也能收到提醒</h3></div>';
    html += '<div class="card">' +
      '<div class="line-cell"><div><div class="k">导出到手机日历</div>' +
      '<div class="s">按每个习惯的排程生成日程，系统日历到点响铃 —— 不依赖网页开着</div></div>' +
      '<button class="btn sm" data-act="exportics">导出 .ics</button></div>' +
      '<div class="muted" style="margin-top:6px">下载后：iPhone 打开文件选「添加到日历」；Android 用日历应用打开。' +
      '日历里的日程点开能直接回到这里打卡，做完照样算数。</div>' +
      /* 双保险：网页提醒只在页面活着时响。系统日历和手机推送各是一条独立通道，
       * 任一条就位，关掉页面 / 息屏也能收到。两条都没配时明确说"现在只有一条腿"。 */
      (function () {
        const push = window.Plugins && Plugins.hasChannel('remind');
        const legs = [];
        if (push) legs.push('手机推送已配置 ✓');
        else legs.push('手机推送还没配');
        if (st.settings.remindEnabled && !push) {
          return '<div class="card" style="margin-top:10px;background:var(--bg-2);box-shadow:none">' +
            '<div class="kv"><span>提醒通道</span><b>' + legs.join(' · ') + '</b></div>' +
            '<div class="muted" style="margin-top:6px">网页到点检查依赖页面运行；后台、息屏或关闭浏览器后可能不触发。需要独立提醒时，可配置系统日历：</div>' +
            '<div class="row" style="margin-top:10px"><button class="btn line" data-act="icsdl">' + ico('calendar-dots') + '下载系统日历（.ics）</button>' +
            '<button class="btn line" data-act="plg_hook">' + ico('device-mobile') + '配手机推送（Bark / Server酱）</button></div>' +
            '<div class="muted" style="margin-top:8px">日历通知取决于系统设置；仅配置手机推送地址不会自动创建后台定时任务。</div></div>';
        }
        return '';
      })() +
      '<div class="muted" style="margin-top:10px">想要息屏也提醒，还可以订阅「系统日历」—— 交给系统通知，效果以设备设置为准。</div>' +
      '<button class="btn line" data-act="plg_calendar" style="margin-top:10px">' + ico('calendar-dots') + '订阅到系统日历</button>' +
      '</div>';

    html += '<div class="sec-title"><h3>打卡规则</h3></div>';
    html += '<div class="card">' +
      '<div class="field"><label>补卡期限</label><div class="chips">' +
      [[1, '1 天'], [3, '3 天'], [7, '7 天'], [30, '30 天']].map(function (o) {
        return '<button class="chip' + (Engine.backfillDays() === o[0] ? ' on' : '') + '" data-act="setbackfill" data-v="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="s" style="margin-top:6px">超过期限的日期只能查看，不能补打卡 —— 补卡是救急用的，不是刷连击用的</div></div>' +
      /* v42 · 走查第 12 条：一周从周几开始。默认周一；周日开工的人（很多自由职业者、
       * 倒班的人）改成周日，上周周报、近 12 周趋势、月历就都跟着换。 */
      '<div class="field"><label>一周从哪天开始</label><div class="chips">' +
      [[1, '周一'], [0, '周日']].map(function (o) {
        return '<button class="chip' + (U.weekStart() === o[0] ? ' on' : '') + '" data-act="setweekstart" data-v="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="s" style="margin-top:6px">影响上周周报、近 12 周完成率和月历的排列；按周几统计（周几最容易断）和提醒时间都不变</div></div>' +
      '</div>';

    html += '<div class="sec-title"><h3>提醒自检</h3></div>';
    html += notifyDiagCard();
    return html;
  }

  function meData() {
    /* 备份提醒条已在一级页常驻（v44 的设计），这里不再重复 */
    let html = '<div class="card" id="quotaCard"><div class="muted">正在读取存储用量…</div></div>';
    setTimeout(paintQuota, 60);

    html += '<div class="sec-title"><h3>导出</h3></div>';
    html += '<div class="card">' +
      cell('#download', '导出备份', '存成 JSON 文件，可选是否连照片语音一起打包', 'export') +
      cell('#lock', '加密导出', '设一个密码再导出，文件被别人拿到也打不开', 'exportenc') +
      cell('#clipboard', '导出 CSV 表格', '导出成 Excel 能开的表格，自己分析、拿去分享', 'exportcsv') +
      cell('#book-open', '导出 Markdown', '导出一份能直接读的「我做到了什么」，换 App 或贴出来都合适', 'exporthmd') +
      '</div>';

    html += '<div class="sec-title"><h3>导入</h3></div>';
    html += '<div class="card">' +
      cell('#upload', '导入备份', '从 JSON 恢复，支持合并或覆盖（加密备份也能导）', 'import') +
      cell('#package', '从其他 App 导入', '支持 Loop Habit Tracker 等导出的 CSV，连历史一起搬过来', 'importcsv') +
      '</div>';

    html += '<div class="sec-title"><h3>数据安全网</h3></div>';
    html += safetyCard();

    html += '<div class="card"><div class="line-cell" style="border:none">' +
      '<div><div class="k" style="color:var(--danger)">清空全部数据</div><div class="s">不可恢复，请先导出备份</div></div>' +
      '<button class="btn sm danger" data-act="wipe">清空</button></div></div>';
    return html;
  }

  function meTools() {
    const st = S();
    let html = '<div class="card">' +
      cell('#timer', '番茄钟', '专注 ' + (st.settings.pomoLen || 25) + ' 分钟 / 休息 ' + (st.settings.breakLen || 5) + ' 分钟 · 可绑定习惯', 'openpomo') +
      cell('#gift', '积分商店', '当前 ' + Engine.points() + ' 分，可兑换奖励', 'rewards') +
      cell('#palette', '日签海报', '把今天的坚持做成一张图', 'poster') +
      /* 走查第 2 条：徽章墙原来锁在「30 个活跃日」后面，可用户第 1 天就解锁了
       * 「第一步」这枚徽章 —— 拿到了却看不到墙，激励链路是断的。
       * 这里给一个常驻入口：拿到第一枚就开放，不再等 30 天。 */
      cell('#medal', '我的徽章', badgeMeSub(), 'badges') +
      cell('#users', '我的房间', '和朋友在同一个房间里打卡排名', 'rooms') +
      cell('#clock', '时间胶囊', '给未来的自己写一句话，到期才解锁', 'capsules') +
      '</div>';

    html += '<div class="sec-title"><h3>隐私与安全</h3></div>';
    html += lockCard();

    html += '<div class="sec-title"><h3>关于与帮助</h3></div>';
    const errN = window.ErrLog ? ErrLog.count() : 0;
    html += '<div class="card">' +
      cell('#book-open', '使用帮助 · 常见问题', '打卡、补卡、提醒、备份怎么用', 'about') +
      cell('#shield-check', '隐私说明', '数据存在哪、能看到什么、怎么带走', 'about') +
      cell('#paper-plane', '反馈与建议', '写邮件给我们，附上版本和运行环境，不含你的记录', 'feedback') +
      (errN ? cell('#warning-circle', '异常记录', '本机记录到 ' + errN + ' 条运行异常，可查看或清除', 'errlog') : '') +
      '</div>';

    /* 清理无用媒体原来混在导入导出里，其实是「工具」而不是「备份」 */
    html += '<div class="sec-title"><h3>维护</h3></div>';
    html += '<div class="card">' +
      cell('#trash', '清理无用媒体', '删除没有被笔记引用的照片语音', 'gc') +
      '</div>';
    return html;
  }


  /* ---------------- 关于 · 帮助 · 隐私 ----------------
   * 交付给真实用户（尤其要卖给别人用）时，必须能回答三个问题：
   * 这版是什么版本、怎么用、我的数据在哪。以前这三件事都答不上来。 */
  function openAbout() {
    const v = 'v' + U.VERSION + ' · ' + U.VERSION_NAME;
    /* 有键盘（鼠标/触控板指向精确）才提示快捷键；纯触屏设备不显示 */
    const hasKeyboard = function () {
      try {
        return !window.matchMedia || !window.matchMedia('(pointer: coarse)').matches;
      } catch (e) { return true; }
    };
    const faq = [
      ['怎么打卡？', '今日页点右侧的圆圈或 ＋ −。计数型点中间的数字可以「一次达标」；长按卡片能请假 / 补卡 / 看统计。'],
      ['忘记打卡了怎么办？', '长按那张卡片 → 补卡，选日期补上（默认只能补最近 3 天，可在「我的 → 补卡期限」放宽）。请假和补卡都不会算断。'],
      ['提醒到点不响？', '网页提醒只有在页面开着时才会响，这是浏览器的限制。想要息屏也提醒：① 用「连接 → 消息推送」接 Bark / Server酱；② 用「连接 → 系统日历」订阅，交给系统闹钟。'],
      ['换手机数据会丢吗？', '不会。在「连接」页登录同一个账号即可自动同步；没登录的话，用「我的 → 导出备份」存一份 JSON，在新设备导入即可。'],
      ['为什么完成率不是 100%？', '只有「该做且没请假」的日子才进分母。请假的日子既不算完成、也不算该做。'],
      ['能把数据导出来自己分析吗？', '可以。「我的 → 导出 CSV 表格」会把每条记录（日期、状态、数值、备注）导成 Excel / WPS 能直接打开的表格，也能再导回来。'],
      ['不想注册账号，怎么换设备？', '填一次自己的网盘（Nextcloud / 群晖等支持 WebDAV 的），之后每天自动备份到那里；在新设备上「连接 → 从网盘恢复」就能把数据找回来。注意：坚果云这类网盘不允许网页直连，用不了。'],
      ['能不打开 App 就打卡吗？', '可以。把 App 添加到桌面后，长按图标有「完成下一个习惯 / 开始番茄钟 / 写日记」三个入口 —— 第一个是真正的「一键打卡」，不用等页面加载完再找。另外任意一条「index.html?cmd=1&do=tick&name=习惯名」链接（配合 iOS 快捷指令、安卓自动化、n8n）都能直接完成一次打卡，页面会给你回执。'],
      ['可以和朋友一起打卡吗？', '可以。在「房间」页建一个房间，把房间码或链接发给朋友，就能看到彼此的完成率排行。'],
      ['连续断了怎么办？', '断签当天的首页会弹一张卡，48 小时内可以「修一次」——用 1 张保护券，或者 30 积分（没有券时）。每月只能修一次，修好那天就等于被保护券接上，连续记录会接回去。'],
      ['好几天没打开，回来一片零怎么办？', '离开 3 天以上再回来，首页会换成「重启页」：历史最佳和累计次数都在，还送你 1 张保护券，只留一个「先做 1 分钟」的按钮。它只出现一次。'],
      ['今天实在没劲，算断吗？', '不算。在习惯详情页给它设一个「最小版本」（读书 30 分钟 → 读 1 页），做到这一档就算完成、不断签，只是强度分只记一半；首页会长按菜单里选「只做最小版」。'],
      ['以前写的备注去哪找？', '在「日记」页搜索框里搜内容，打卡备注也会一起被搜到；习惯详情页按时间列出了这个习惯写过的所有句子。'],
      /* v48：这两条是"信任类"问题 —— YouTube 上同类产品的宣传片反复打「no sign-up, no ads,
       * no tracking」，说明用户真的在担心这个。我们的答案比他们更硬（数据根本不出设备），
       * 但之前没在 App 里正面回答过。 */
      ['你们靠什么赚钱？会不会哪天突然收费？', '不靠这个赚钱，也不会突然收费。数据存在你自己设备上，我没有服务器成本要摊，所以没有广告、没有订阅、没有「免费版功能阉割」，也没有理由去卖数据 —— 数据从来没到过我这边。'],
      ['数据真的不会上传吗？', '默认不会。只有你主动做这三件事时数据才会离开这台设备：① 登录账号开云同步 ② 配置 WebDAV 网盘备份 ③ 把照片语音设成上传云端。三个都可以不开，全关也照样用。想更保险，可以用「我的 → 加密导出」把备份存成带密码的文件。']
    ];
    sheet('关于 · 帮助',
      '<div class="card" style="box-shadow:none;background:var(--accent-soft)">' +
      '<div style="font-weight:700;font-size:16px">日拱一卒 · 习惯打卡</div>' +
      '<div class="muted" style="margin-top:4px">版本 ' + E(v) + ' · 构建 ' + E(U.BUILD_DATE) + '</div>' +
      '<div class="muted" style="margin-top:6px">种一棵树最好的时间是十年前，其次是现在。</div>' +
      /* v48：把三条硬差异化放在最显眼的位置。它们本来就是事实，
       * 只是之前写在分享卡片和隐私页里，进来用的人反而看不到。 */
      '<div style="margin-top:10px;font-size:12px;color:var(--txt-3);line-height:1.9">' +
      '不用注册　·　数据只存在这台设备　·　没有广告和统计脚本</div></div>' +

      '<div class="sec-title"><h3>常见问题</h3></div>' +
      faq.map(f => '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-bottom:8px">' +
        '<div style="font-weight:650;font-size:14px">' + E(f[0]) + '</div>' +
        '<div class="muted" style="margin-top:5px;line-height:1.65">' + E(f[1]) + '</div></div>').join('') +

      /* 键盘快捷键只在「有键盘」的设备上提示：手机上列出来只会让人困惑 */
      (hasKeyboard() ?
        '<div class="sec-title"><h3>键盘快捷键</h3></div>' +
        '<div class="card"><div class="muted" style="line-height:2.1">' +
        '· <b>1 – 8</b>　直接切换到对应的底部页面<br>' +
        '· <b>←</b> <b>→</b> / <b>Home</b> <b>End</b>　在底部标签之间移动<br>' +
        '· <b>/</b>　跳到日记搜索<br>' +
        '· <b>Tab</b>　在弹窗内循环焦点，<b>Esc</b> 关闭当前弹窗' +
        '</div></div>' : '') +

      /* 右侧只标「当前 vNN」：CHANGELOG 第一条就是当前版本，再写一遍版本名会重复 */
      '<div class="sec-title"><h3>最近更新</h3><span class="more">当前 v' + U.VERSION + '</span></div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
      CHANGELOG.map(c => '<div style="padding:8px 0;border-top:1px solid var(--line)">' +
        '<div style="font-weight:600;color:var(--txt)">v' + c.v + ' · ' + E(c.name) + '</div>' +
        '<div class="muted" style="margin-top:3px;line-height:1.6">' + E(c.what) + '</div></div>').join('') +
      '</div>' +

      '<div class="sec-title"><h3>隐私说明</h3></div>' +
      '<div class="card"><div class="muted" style="line-height:1.8">' +
      '· <b>默认只保存在这台设备</b>：不登录云空间，习惯、打卡、日记、照片一个字节都不会上传。不注册也能用。<br>' +
      '· 只有你主动开启下面这些功能时，对应的数据才会离开这台设备：<br>' +
      /* v52 · 报告 P0-2：这里以前写「登录云空间 → 同步到你自己的账号」，
       * 但云后端实测是 down 的 —— 承诺一个打不开的通道，比不说更伤信任。
       * 现在按真实状态说：通就说同步，不通就直说没开通、并给出真能走的路。 */
      (cloudDown()
        ? '　· <b>云空间（当前未开通）</b> → 现在登录也同步不了。跨设备请用「导出备份」整份带走，或在「连接」页连自己的网盘。<br>'
        : '　· <b>登录云空间</b> → 同步到你<b>自己的账号</b>下，用于跨设备；我们不会拿它做别的用途，也不会卖给第三方。<br>') +
      /* WebDAV：备份只从这台设备直接送到用户自己的网盘，不过我们的服务器。
       * 但「密码只存在本机」这件事必须写出来，否则用户不敢用。 */
      '　· <b>自建网盘备份</b> → 备份从这台设备<b>直接传你填的那个网盘</b>（Nextcloud / 群晖等），不经过任何第三方服务器；网盘地址和密码只存在这台设备里。<br>' +
      /* 搭子（4.7）：只发四个字段，不说数值、备注、照片。退出即删。 */
      '　· <b>搭子</b> → 只把<b>昵称、习惯名、今天是否完成、连续天数</b>发给本站的搭子服务；' +
      '数值、备注、照片、日记一概不发，对方看不到。你退出时立刻删除，对方也再看不到你的状态。<br>' +
      '　· <b>语音输入</b> → 用的是浏览器自带的语音识别，录音由浏览器厂商（Chrome / Edge 背后的服务）处理，本站不保存音频。<br>' +
      '· 不读取通讯录、短信、精确位置。日记天气只按城市级别获取，不记录你的具体位置。<br>' +
      /* 评审 5.4：页面上确实有第三方脚本 —— 它不是应用自己的，是托管平台注入的访问统计。
       * 与其让「只存在本机」和它互相打脸，不如把这件事明说。
       * v36 起我们主动在服务端下 CSP 把它挡掉（见 server.js），文案同步改成事实：
       * 「平台注入了，但我们不让它加载」—— 别写成「没有这段脚本」，那是假的。 */
      '· 托管平台会在页面里注入一段访问统计脚本（beacon.cdn.qq.com）。本应用在服务端用内容安全策略把它拦在门外，正常情况下它连请求都发不出去；' +
      '即便在某些浏览器里没拦住，它最多也只能看到「有人打开了这个页面」，<b>你的打卡与日记从来没有上传过</b>。<br>' +
      '· 想要更稳妥的备份，可以用「我的 → 加密导出」：设一个密码，导出的文件连你自己换设备时也要输密码才能打开，密码不保存在任何地方。<br>' +
      '· 随时可以在「我的 → 导出备份」把全部数据带走，或「清空全部数据」彻底删除。' +
      '</div></div>' +

      /* v38 · 外部评审 P0-1：文字讲完还要有一张能一眼对照的表 ——
       * 「什么数据、存在哪、什么时候出网、发给谁」四列回答完，才叫说清楚了。 */
      '<div class="sec-title"><h3>数据去哪了（一张表看清）</h3></div>' +
      '<div class="card"><div class="muted" style="line-height:1.7">' +
      [
        ['习惯 · 打卡 · 日记正文', '这台设备的浏览器数据库', '默认不出网；只有你登录云空间或加入房间时才发对应字段', '你自己的云账号 / 同房间成员'],
        ['照片 · 视频 · 语音', '默认存这台设备；登录云空间且开关打开时才上传', '上传后从你自己的账号取回', '你自己的云账号'],
        ['网盘备份（WebDAV）', '你填的那个网盘，浏览器直连，不经过我们', '点「立即备份」时', '你填的网盘'],
        ['搭子 / 房间排行', '本站的搭子服务，只有昵称、习惯名、今日是否完成、连续天数', '加入后每天更新一次', '同房间成员'],
        ['加密导出文件', '你选择的下载位置', '由你拷走，我们不接收', '只有你（要密码才能打开）'],
        ['访问统计', '平台注入的脚本已被服务端拦下；本站不使用 Cookie', '—', '—']
      ].map(r => '<div style="padding:9px 0;border-top:1px solid var(--line)">' +
        '<div style="color:var(--txt);font-weight:600">' + r[0] + '</div>' +
        '<div style="margin-top:2px">存哪：' + r[1] + '</div>' +
        '<div>何时出网：' + r[2] + '</div>' +
        '<div>发给谁：' + r[3] + '</div></div>').join('') +
      '</div></div>' +

      '<div class="row" style="margin-top:12px">' +
      '<button class="btn block" data-act="feedback">' + ico('paper-plane') + '反馈与建议</button></div>' +
      '<div class="muted" style="margin-top:10px;text-align:center">感谢你把坚持交给它。</div>'
    );
  }

  /* 反馈：没有后端也能用 —— 把版本 / 环境 / 数据概况复制到剪贴板，
   * 用户粘到微信或邮件里即可，比"请描述你的问题"有用得多。 */
  function diagText() {
    const st = S();
    let line = '';
    try {
      const q = Engine.todayRate(U.today());
      line = '习惯 ' + Engine.items().length + ' 个 · 今日 ' + q.done + '/' + q.total +
        ' · 累计打卡 ' + Engine.totalCheckins();
    } catch (e) { }
    const ua = navigator.userAgent || '';
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ? '是' : '否';
    const cloud = (window.Cloud && Cloud.signedIn()) ? '已登录' : '未登录';
    const errs = (window.ErrLog ? ErrLog.recent(3) : []);
    const lines = [
      '【日拱一卒 反馈】',
      '版本：v' + U.VERSION + ' (' + U.VERSION_NAME + ') 构建 ' + U.BUILD_DATE,
      '数据：' + line,
      '云空间：' + cloud + ' · 独立窗口：' + standalone,
      '屏幕：' + innerWidth + '×' + innerHeight + ' · 主题：' + (document.documentElement.getAttribute('data-theme') || ''),
      '浏览器：' + ua
    ];
    if (errs.length) {
      lines.push('最近异常（共 ' + ErrLog.count() + ' 条，仅类型与消息）：');
      errs.forEach(e => lines.push('  · [' + e.kind + '] ' + String(e.msg).split('\n')[0].slice(0, 120)));
    }
    lines.push('问题描述：');
    return lines.join('\n');
  }

  /* 反馈邮件的 mailto 链接：收件人、主题、正文（诊断信息）一次带齐。
   * 单独拆出来，点按钮时由 main.js 赋给 location.href —— 写进 href 属性会被
   * HTML 实体和 CSP 的 form-action/navigate-to 规则干扰。 */
  function feedbackEmail() { return FEEDBACK_EMAIL; }
  function mailtoHref() {
    const subject = '日拱一卒 v' + U.VERSION + ' 反馈（' + U.today() + '）';
    return 'mailto:' + FEEDBACK_EMAIL +
      '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(diagText());
  }

  function openFeedback() {
    const txt = diagText();
    sheet('反馈与建议',
      '<div class="muted" style="line-height:1.7;margin-bottom:10px">' +
      '把遇到的问题写到邮件里发给我们。它包含版本号和运行环境，能帮我们更快定位问题 —— ' +
      '<b>不包含</b>你的日记内容或打卡记录。</div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
      '<div class="kv"><span>反馈邮箱</span><b style="word-break:break-all">' + E(FEEDBACK_EMAIL) + '</b></div>' +
      '<div class="muted" style="margin-top:6px">通常在 3 天内回复；如果是数据问题，建议先在「我的 → 导出备份」留一份。</div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn" data-act="mailus">' + ico('paper-plane') + '打开邮件</button>' +
      '<button class="btn ghost" data-act="copymail">复制邮箱</button></div></div>' +
      '<div class="sec-title" style="margin-top:16px"><h3>诊断信息</h3></div>' +
      '<div class="muted" style="line-height:1.7;margin-bottom:8px">点「打开邮件」会自动带上下面这段；不方便发邮件时，也可以只复制它，粘到微信里给我们。</div>' +
      '<textarea class="input" id="diagBox" style="min-height:150px;font-family:ui-monospace,Consolas,monospace;font-size:12px">' + E(txt) + '</textarea>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn ghost block" data-act="copydiag">复制诊断信息</button></div>' +
      '<div class="sec-title" style="margin-top:16px"><h3>还可以这样帮到我们</h3></div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2)"><div class="muted" style="line-height:1.8">' +
      '· 说清「你做了什么 → 期望什么 → 实际看到什么」，最好带一张截图。<br>' +
      '· 如果是数据问题，先「我的 → 导出备份」留一份，再操作，避免不可逆。<br>' +
      '· 遇到页面白屏，点「重新加载」即可；数据不会因此丢失。' +
      '</div></div>'
    );
  }

  /* 数据安全网：每天首次进入自动存一份本地快照，误删 / 导入错了能滚回去 */
  function safetyCard() {
    let snaps = [];
    try { if (window.Safety) snaps = Safety.list(); } catch (e) { }
    let body;
    if (!snaps.length) {
      body = '<div class="muted" style="font-size:13px">还没有本地快照。明天再打开就会自动存第一份（每天一份，只留最近 7 天）。</div>';
    } else {
      const today = U.today();
      body = snaps.map(s => {
        const isToday = s.date === today;
        return '<div class="snap">' +
          '<div class="snap-h">' +
          '<div style="flex:1">' +
          '<div class="snap-d">' + (isToday ? '今天开盘时' : U.prettyDate(s.date)) + '</div>' +
          '<div class="snap-m">' + s.items + ' 个习惯 · ' + s.done + ' 条打卡 · ' + U.bytes(s.size) + '</div>' +
          '</div>' +
          '<button class="snap-b danger" data-act="snaprestore" data-d="' + U.esc(s.date) + '">回到这天</button>' +
          '</div></div>';
      }).join('');
    }
    return '<div class="card">' +
      '<div class="line-cell" style="border:none;cursor:default"><span class="cell-ico"><svg class="p-icon i-inline" aria-hidden="true"><use href="assets/icons.svg#shield-check"></use></svg></span>' +
      '<div style="flex:1"><div class="k">本地快照 · 自动回滚点</div>' +
      '<div class="s">每天首次进入自动存一份，误删习惯、导入错了都能一键回到那天</div></div></div>' +
      body +
      (snaps.length ? '<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-act="snapclear">清除全部快照</button>' +
        '<button class="btn sm ghost" data-act="export">顺手导出一份</button></div>' : '') +
      '</div>';
  }

  /* 列表行。ico 可以是 emoji，也可以写成 '#bell' 走 assets/icons.svg 的线性图标；
   * dotId 传了就在图标上挂一颗红点（提醒 / 云备份用）。 */
  function cell(ico, title, sub, act, dotId) {
    const isSvg = typeof ico === 'string' && ico.charAt(0) === '#';
    const icon = isSvg
      ? '<svg class="p-icon" aria-hidden="true"><use href="assets/icons.svg' + ico + '"></use></svg>'
      : ico;
    return '<div class="line-cell" role="button" tabindex="0" data-act="' + act + '">' +
      '<span class="cell-ico">' + icon + (dotId ? '<i class="dot" id="' + dotId + '"></i>' : '') + '</span>' +
      '<div style="flex:1"><div class="k">' + title + '</div><div class="s">' + sub + '</div></div>' +
      '<span class="muted">›</span></div>';
  }

  async function paintQuota() {
    const box = $('quotaCard');
    if (!box) return;
    const q = await Promise.race([
      Store.quota(),
      new Promise(r => setTimeout(() => r({ usage: 0, quota: 0, media: { count: 0, bytes: 0, cloud: { count: 0, bytes: 0 } }, persisted: false, mediaPerDay: 0, cloudOn: false }), 1500))
    ]);
    const used = q.usage, total = q.quota;
    const pct = total ? Math.min(100, used / total * 100) : 0;
    // 年数只按「照片语音的真实增速」估算：纯文字记录一年只有几 MB，可忽略
    const rate = q.mediaPerDay || 0;
    let years = null;
    if (rate > 0 && total > used) years = (total - used) / rate / 365;
    const yearTxt = years === null ? '几乎用不完'
      : (years >= 100 ? '100 年以上' : Math.max(1, Math.round(years * 10) / 10) + ' 年');

    if (q.cloudOn) {
      box.innerHTML =
        '<div class="kv"><span>已用（本机合计）</span><b>' + U.bytes(used) + '</b></div>' +
        '<div class="quota"><i style="width:' + pct.toFixed(2) + '%"></i></div>' +
        '<div class="kv"><span>' + ico('cloud') + ' 云端占用</span><b style="color:var(--accent)">' + U.bytes((q.media.cloud || {}).bytes || 0) + ' · ' + ((q.media.cloud || {}).count || 0) + ' 个</b></div>' +
        '<div class="kv"><span>本机缓存（缩略图）</span><b>' + U.bytes(q.media.bytes || 0) + '</b></div>' +
        '<div class="kv"><span>持久化保护</span><b>' + (q.persisted ? '已开启 ✓' : '未开启') + '</b></div>' +
        '<div class="muted" style="margin-top:8px">照片和语音都存在<b style="color:var(--txt)">云端</b>：云空间是 GB 级容量、不占浏览器配额，按现在的记录习惯<b style="color:var(--txt)">用 10 年以上没问题</b>。' +
        '本机只留很小的缩略图（按当前增速，本机剩余配额还能存 ' + yearTxt + '）。想完全清空本机占用，点下面按钮，原图随时能从云端看。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="cacheclear">清理本机缓存（原图在云端）</button>' +
        '<button class="btn sm ghost" data-act="goconnect">管理云空间</button></div>';
    } else {
      box.innerHTML =
        '<div class="kv"><span>已用</span><b>' + U.bytes(used) + '</b></div>' +
        '<div class="quota"><i style="width:' + pct.toFixed(2) + '%"></i></div>' +
        '<div class="kv"><span>浏览器可用配额</span><b>' + U.bytes(total) + '</b></div>' +
        '<div class="kv"><span>照片 / 语音（本机）</span><b>' + q.media.count + ' 个 · ' + U.bytes(q.media.bytes || 0) + '</b></div>' +
        '<div class="kv"><span>持久化保护</span><b>' + (q.persisted ? '已开启 ✓' : '未开启') + '</b></div>' +
        '<div class="muted" style="margin-top:8px">' +
        (rate > 0
          ? '按你存照片/语音的真实增速（约 ' + U.bytes(rate) + ' / 天），本机空间还能记 <b style="color:var(--txt)">' + yearTxt + '</b>。'
          : '还没存过照片/语音。纯文字记录一年只有几 MB，这个配额按文字记 <b style="color:var(--txt)">100 年都用不完</b>；之前的导入是一次性的，不会每天重复占用。') +
        '想存大量照片又不占本机：去「连接」页登录云空间，照片自动上传云端、本机只留缩略图，<b style="color:var(--txt)">10 年以上随便记</b>。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="goconnect">登录云空间 · 容量升级</button>' +
        (q.persisted ? '' : '<button class="btn sm ghost" data-act="persist">申请持久化（防清理）</button>') + '</div>';
    }
  }

  /* ---------------- 抽屉 ---------------- */
  let sheetFocus = null, sheetOverflow = '';
  /* 抽屉打开后有一小段「防误关」窗口：长按/手势开菜单时，抬手会在遮罩上补一次 click，
   * 若直接放行，菜单会一闪而过。窗口内忽略遮罩点击。 */
  let sheetAt = 0;
  function sheetReady() { return Date.now() - sheetAt > 320; }
  function sheetKeys(event) {
    const panel = $('sheet');
    if (!panel.classList.contains('on') || document.getElementById('cfMask')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeSheet(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(panel.querySelectorAll('button, input, textarea, select, a[href], [tabindex="0"]'))
      .filter(el => !el.disabled && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); panel.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function sheet(title, bodyHTML) {
    const panel = $('sheet');
    sheetAt = Date.now();
    /* 徽章弹窗是 z-index 120 的模态，面板只有 51：不关掉它，刚打开的面板会被盖住最长 9 秒，
     * 用户会以为「点了没反应」。面板优先级永远高于这种一次性庆祝。 */
    const bp = document.getElementById('badgePop');
    if (bp) bp.remove();
    if (!panel.classList.contains('on')) {
      sheetFocus = document.activeElement;
      sheetOverflow = document.body.style.overflow;
    }
    $('sheetBody').onclick = null;
    $('sheetBody').innerHTML = '<div class="sheet-grab"></div><button type="button" class="sheet-close" aria-label="关闭弹窗">×</button><h3 id="sheetTitle">' + E(title) + '</h3>' + bodyHTML;
    $('sheetBody').querySelector('.sheet-close').addEventListener('click', closeSheet);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'sheetTitle');
    panel.setAttribute('tabindex', '-1');
    panel.removeAttribute('aria-hidden');
    if ($('app')) $('app').inert = true;
    document.body.style.overflow = 'hidden';
    document.removeEventListener('keydown', sheetKeys);
    document.addEventListener('keydown', sheetKeys);
    $('sheetMask').classList.add('on');
    panel.classList.add('on');
    panel.scrollTop = 0;
    panel.focus({ preventScroll: true });
    if (window.UX) UX.bindCounters($('sheetBody'));
  }
  function closeSheet() {
    stopTimerTick();
    $('sheetMask').classList.remove('on');
    $('sheet').classList.remove('on');
    $('sheet').setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', sheetKeys);
    if ($('app')) $('app').inert = false;
    document.body.style.overflow = sheetOverflow;
    if (sheetFocus && sheetFocus.isConnected) sheetFocus.focus({ preventScroll: true });
  }

  /* 首次进入：让用户自己挑，而不是一上来就塞 4 个示例习惯。
  /* v24 · 显示方式抽屉：今日页工具栏收敛后，「按时段 / 网格视图」收进这里。
   * 同一层级只留「筛选 + 搜索」——用户来今日页是为了勾掉今天的事，不是调布局。 */
  /* 显示方式抽屉（v26：开关换成真 switch，行本身可点、键盘可用）
   * 选中态统一走 setSwitch()：一次写 class 与 aria-checked，不让视觉和读屏各说一套。 */
  function openTools() {
    const slot = !!(S().settings.groupBySlot), grid = !!(S().settings.gridView);
    function row(on, act, k, s) {
      return '<div class="line-cell"><div><div class="k">' + k + '</div><div class="s">' + s + '</div></div>' +
        '<div class="sw' + (on ? ' on' : '') + '" role="switch" tabindex="0" aria-checked="' + on + '" aria-label="' + k + '" data-act="' + act + '"><i></i></div></div>';
    }
    sheet('显示方式',
      '<div class="card">' +
      row(slot, 'toggleslot', '按时段分组', '按早晨 / 下午 / 晚上分开列') +
      row(grid, 'togglegrid', '一屏网格视图', '每个习惯一个方块，一屏看全') +
      '</div><div class="muted" style="font-size:12px;margin-top:10px;line-height:1.6">两种视图都会记住你的选择；分组和网格互不影响，可以同时开。</div>');
  }

  /* 开关 / 芯片选中态的唯一入口：class 和 aria 一起写，避免「视觉换了、读屏没换」 */
  function setSelected(group, target) {
    if (!group) return;
    group.querySelectorAll('.chip,[role="switch"]').forEach(c => {
      const on = c === target;
      c.classList.toggle('on', on);
      if (c.hasAttribute('aria-checked')) c.setAttribute('aria-checked', String(on));
      if (c.hasAttribute('aria-pressed')) c.setAttribute('aria-pressed', String(on));
    });
  }

  /* v20 起收窄到「只建第 1 个」——首日塞满任务是弃用的头号原因，
   * 先跑通一个最小的正反馈循环，第二天再加第二个。 */
  function openOnboard() {
    const lib = (window.Feat && Feat.LIB) || [];
    /* 默认选中第一个：未选任何习惯时「就从这个开始」仍可点，点了只会 toast 一句，
       用户会以为按钮坏了。选中态先给出来，点下去必然有结果。 */
    sheet('先建第 1 个习惯',
      '<div class="muted" style="margin-bottom:12px;line-height:1.6">' +
      '第一天只建 <b>1 个</b> —— 一次塞太多是放弃的头号原因。先挑最容易做到的那个，先做起来再说；' +
      '别的随时能加，不用一次想全。</div>' +
      '<div class="card"><div class="chips" id="obChips">' + lib.map((l, i) =>
        '<button class="chip' + (i === 0 ? ' on' : '') + '" data-act="obpick" data-i="' + i + '" aria-pressed="' + (i === 0) + '" aria-label="选择习惯 ' + E(l.name) + '">' + E(l.name) + '</button>').join('') +
      '</div></div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn" data-act="obstart">就从这个开始</button>' +
      /* v52 · 报告 P1-7：这句话原来叫「先用推荐的 4 个」，和上面「第一天只建 1 个」
       * 摆在一起自相矛盾 —— 左边说不许多建，右边一键建 4 个。现在把代价说在明处。 */
      '<button class="btn ghost" data-act="obskip">用示例组合试试</button></div>' +
      '<div class="muted" style="margin-top:8px;font-size:11.5px">示例组合会一次建 4 个，适合想先看看长什么样的人 —— 不满意随时删。</div>');
  }

  /* v20 · 键盘快捷键说明（桌面 / 外接键盘） */
  function openKeys() {
    sheet('键盘快捷键',
      '<div class="card">' +
      '<div class="kv"><span>c</span><b>完成第一个待完成习惯（和点击同一个路径）</b></div>' +
      '<div class="kv"><span>g</span><b>切换网格 / 卡片视图</b></div>' +
      '<div class="kv"><span>n</span><b>新建习惯</b></div>' +
      '<div class="kv"><span>1 – 8</span><b>切换到第 1 – 8 个页面</b></div>' +
      '<div class="kv"><span>/</span><b>跳到日记搜索</b></div>' +
      '<div class="kv"><span>Esc</span><b>关闭浮层 / 退出输入框</b></div></div>' +
      '<div class="muted" style="margin-top:10px">桌面或外接键盘下使用；输入框中只有 Esc 生效，不会误触。</div>');
  }

  /* ---------- 健康数据自动勾选（v47）----------
   * 表单里那块「选指标 + 填阈值」的单位与说明文字。
   * 一定要说清「网页拿不到 HealthKit」—— 否则用户会以为设完就自动同步了。 */
  function autoUnitOf(rule) {
    if (!rule || !rule.key || !window.Health) return '';
    return Health.defOf(rule.key).unit || '';
  }
  function autoHintHTML(rule) {
    if (!window.Health) return '';
    const lines = [];
    if (rule && rule.key) {
      const d = Health.defOf(rule.key);
      const last = Health.latestOf(rule.key);
      lines.push(last
        ? ('最近一次数据：' + last.d.slice(5).replace('-', '/') + ' · ' + last.v + (d.unit || ''))
        : ('「' + d.label + '」还没有导入过数据，先去「我的 → 健康数据导入」导一次。'));
    } else {
      lines.push('例如设「步数 ≥ 8000」：手机记到 8000 步以上，这条习惯当天就自动完成。');
    }
    lines.push('网页拿不到 HealthKit，数据来自你导入的那份文件；导入一次之后每次打开都会自动比对。');
    return lines.map(s => '<div>' + E(s) + '</div>').join('');
  }

  function openHabit(it) {
    const pal = Store.palette();
    const v = it || {};
    const sc = v.schedule || { type: 'daily' };
    const steps = (v.steps || []).join('\n');
    const others = (S().items || []).filter(x => !x.deleted && !x.archived && x.id !== v.id);
    sheet(v.id ? '编辑习惯' : '新建习惯',
      '<div class="field"><label for="fName">名称</label><input class="input" id="fName" data-max="20" value="' + E(v.name || '') + '" placeholder="例如：跑步" aria-describedby="fNameHint">' +
      '<div class="p-field-hint" id="fNameHint">先给它起个名字，例如：跑步</div></div>' +
      '<div class="field"><label>类型</label><div class="chips" id="fType">' +
      [['check', '打卡'], ['number', '计数'], ['duration', '时长'], ['avoid', '戒断（少做）']].map(([t, n]) =>
        '<button class="chip' + ((v.type || 'check') === t ? ' on' : '') + '" data-f="type" data-v="' + t + '">' + n + '</button>').join('') + '</div></div>' +
      '<div class="row" id="fGoalFields" style="gap:10px' + (['number', 'duration'].includes(v.type) ? '' : ';display:none') + '"><div class="field" style="flex:1"><label for="fTarget">目标值</label>' +
      '<input class="input" id="fTarget" type="number" step="0.1" value="' + (v.target ?? '') + '" placeholder="30"></div>' +
      '<div class="field" style="flex:1"><label for="fUnit">单位</label><input class="input" id="fUnit" data-max="6" value="' + E(v.unit || '') + '" placeholder="分钟 / 公里 / 升"></div></div>' +
      '<div class="field"><label>时段</label><div class="chips" id="fSlot">' +
      Object.entries(SLOT_NAME).map(([k, n]) => '<button class="chip' + ((v.slot || 'any') === k ? ' on' : '') + '" data-f="slot" data-v="' + k + '">' + n + '</button>').join('') + '</div></div>' +
      '<div class="field"><label>频率</label><div class="chips" id="fSched">' +
      [['daily', '每天'], ['weekdays', '指定星期'], ['timesPerWeek', '每周几次'], ['interval', '隔 N 天'], ['monthly', '每月指定日'], ['yearly', '每年指定日']].map(([k, n]) =>
        '<button class="chip' + (sc.type === k ? ' on' : '') + '" data-f="sched" data-v="' + k + '">' + n + '</button>').join('') + '</div>' +
      '<div id="fSchedExtra" style="margin-top:8px"></div></div>' +
      /* 每周可以休息几天（v49）：「每天都要做」是最容易劝退的设计 —— 一周里总有
       * 一两天做不到，那天连击一归零，前面二十天在心理上就全废了。
       * 给一个额度：休息日不算断签、也不算没完成，额度按周重置。
       * 放在频率下面而不是「更多设置」里 —— 它就是频率的一部分，藏起来等于没有。 */
      '<div class="field"><label>每周可以休息几天</label><div class="chips" id="fRest">' +
      [['0', '不休息'], ['1', '1 天'], ['2', '2 天'], ['3', '3 天']].map(([k, n]) =>
        '<button class="chip' + (String(v.restPerWeek || 0) === k ? ' on' : '') + '" data-f="rest" data-v="' + k + '">' + n + '</button>').join('') + '</div>' +
      /* 每月额度（v51）：生活的不规律是按月来的 —— 这个月出差多、下个月很闲，
       * 按周切会把额度浪费在闲的那几周。两个额度互斥，选了这个上面那个自动归零。 */
      '<div class="chips" id="fRestM" style="margin-top:6px">' +
      [['0', '改成按每月'], ['2', '每月 2 天'], ['4', '每月 4 天'], ['6', '每月 6 天']].map(([k, n]) =>
        '<button class="chip' + (String(v.restPerMonth || 0) === k ? ' on' : '') + '" data-f="restm" data-v="' + k + '">' + n + '</button>').join('') + '</div>' +
      '<div class="muted" style="font-size:11.5px;margin-top:5px">休息那天不算断签，也不算没完成 —— 一周忙几天不至于前功尽弃。选「每月」更适合出差、加班不规律的月份。</div></div>' +
      '<div class="row" style="gap:10px"><div class="field" style="flex:1"><label for="fRemind">提醒时间</label>' +
      '<input class="input" id="fRemind" type="time" value="' + (v.reminderAt || '') + '"></div>' +
      '<div class="field" style="flex:1"><label for="fDep">前置习惯（依赖）</label><select class="input" id="fDep">' +
      '<option value="">无</option>' + others.map(o => '<option value="' + o.id + '"' + (v.dependsOn === o.id ? ' selected' : '') + '>' + E(o.name) + '</option>').join('') +
      '</select></div></div>' +
      /* 「什么时候做」是实现意图（在 X 之后做 Y）—— 习惯研究里最硬的证据之一，
       * 也是提醒文案唯一能变得具体的信息来源。所以放在主表单，不藏进「更多设置」。 */
      '<div class="field"><label for="fCue">什么时候做（可选）</label>' +
      '<input class="input" id="fCue" data-max="24" value="' + E(v.cue || '') + '" placeholder="例如：洗漱后、午饭前、到家换鞋后">' +
      '<div class="muted" style="font-size:11.5px;margin-top:5px">写一个具体场景，提醒里会带上它 ——「洗漱后做 10 个俯卧撑」比「该运动了」有效得多。</div></div>' +
      /* 健康数据自动勾选（v47 · 对标 Habitify 的「Apple Health 达标即完成」）：
       * 只做「数值达标 → 当天自动完成」这一件事，但它是从「要记得来打卡」变成
       * 「做完就算」的关键一步 —— 步数这种事，本来就不该再手动确认一遍。 */
      '<div class="field"><label for="fAuto">健康数据自动勾选（可选）</label>' +
      '<select class="input" id="fAuto"><option value="">不自动</option>' +
      (window.Health ? Health.TYPES.map(t => '<option value="' + t.key + '"' +
        ((v.autoHealth && v.autoHealth.key) === t.key ? ' selected' : '') + '>' + E(t.label) + '（' + E(t.unit) + '）</option>').join('') : '') +
      '</select>' +
      '<div class="row" id="fAutoThrRow" style="gap:10px;margin-top:8px' + (v.autoHealth && v.autoHealth.key ? '' : ';display:none') + '">' +
      '<div class="field" style="flex:1;margin:0"><label for="fAutoThr">达标阈值</label>' +
      '<input class="input" id="fAutoThr" type="number" min="0" step="1" value="' +
      (v.autoHealth && Number(v.autoHealth.thr) > 0 ? v.autoHealth.thr : '') + '" placeholder="8000"></div>' +
      '<div class="field" style="flex:1;margin:0"><label>单位</label>' +
      '<div class="input" id="fAutoUnit" style="display:flex;align-items:center;color:var(--muted)">' + E(autoUnitOf(v.autoHealth)) + '</div></div></div>' +
      '<div class="muted" id="fAutoHint" style="font-size:11.5px;margin-top:5px">' + autoHintHTML(v.autoHealth) + '</div></div>' +
      /* 「为什么」是习惯养成里最便宜也最有效的一件武器：
       * 想放弃的那一刻，道理讲不通，但你自己当初写下的那句话能把你拉回来。 */
      '<details class="p-advanced"><summary>更多设置 · 动机、子步骤与颜色</summary><div class="field"><label for="fWhy">我为什么要坚持它（可选）</label>' +
      '<input class="input" id="fWhy" data-max="40" value="' + E(v.why || '') + '" placeholder="例如：想有精力陪孩子跑、不想三十岁就喘">' +
      '<div class="muted" style="font-size:11.5px;margin-top:5px">写一句给自己看的。断卡那天，它会出现在你眼前。</div></div>' +
      '<div class="field"><label for="fSteps">子步骤（一行一个，可选）</label><textarea class="input" id="fSteps" data-max="200" placeholder="换上跑鞋\n出门\n拉伸">' + E(steps) + '</textarea></div>' +
      '<div class="field"><label>颜色</label><div class="chips" id="fColor">' +
      pal.map(c => '<button aria-label="颜色 ' + E(c) + '" class="chip' + (c === (v.color || pal[0]) ? ' on' : '') + '" data-f="color" data-v="' + c + '" style="background:' + c + ';width:34px;height:34px;padding:0;border-radius:50%"></button>').join('') + '</div></div></details>' +
      '<div class="p-form-err" id="fErr" role="alert" hidden></div>' +
      '<div class="row p-form-actions" style="margin-top:6px"><button class="btn block" id="fSave" data-act="savehabit" data-id="' + (v.id || '') + '"' + (v.id ? '' : ' disabled aria-disabled="true"') + '>' + (v.id ? '保存习惯' : '开始坚持它') + '</button></div>' +
      (v.id ? '<div class="row" style="margin-top:8px"><button class="btn block ghost" data-act="archivehabit" data-id="' + v.id + '">归档</button>' +
        '<button class="btn block ghost" data-act="delhabit" data-id="' + v.id + '" style="color:var(--danger)">删除</button></div>' : '')
    );
    const pick = { type: v.type || 'check', slot: v.slot || 'any', sched: sc.type || 'daily', color: v.color || pal[0], rest: String(v.restPerWeek || 0), restm: String(v.restPerMonth || 0) };
    function paintSchedule(val) {
      const box = $('fSchedExtra');
      if (val === 'timesPerWeek') box.innerHTML = '<label for="fSchedN">每周完成次数</label><input class="input" id="fSchedN" type="number" min="1" max="7" step="1" value="' + (sc.type === val ? sc.n || 3 : 3) + '">';
      else if (val === 'interval') box.innerHTML = '<label for="fSchedN">间隔天数</label><input class="input" id="fSchedN" type="number" min="2" max="30" step="1" value="' + (sc.type === val ? sc.n || 2 : 2) + '">';
      else if (val === 'weekdays') box.innerHTML = '<div class="chips" id="fDays">' + [1, 2, 3, 4, 5, 6, 0].map(d =>
        '<button class="chip' + ((sc.days || [1, 2, 3, 4, 5]).includes(d) ? ' on' : '') + '" data-fd="' + d + '">周' +
        ({ 0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' })[d] + '</button>').join('') + '</div>';
      else if (val === 'monthly') box.innerHTML = '<label for="fSchedDays">每月几号（用逗号分隔）</label><input class="input" id="fSchedDays" inputmode="decimal" value="' + E((sc.days || [1]).join(', ')) + '" placeholder="例如：1, 15, 28"><div class="muted">月份没有对应日期时，该月不安排。</div>';
      else if (val === 'yearly') box.innerHTML = '<label for="fSchedDays">每年哪几天（月-日，用逗号分隔）</label><input class="input" id="fSchedDays" value="' +
        E((sc.dates || []).map(md => (+md.slice(0, 2)) + '-' + (+md.slice(3))).join(', ')) +
        '" placeholder="例如：3-15, 12-1"><div class="muted">一年一次的事：生日、体检、年检、纪念日。2 月 29 日在平年不安排。</div>';
      else box.innerHTML = '';
    }
    paintSchedule(pick.sched);
    /* 空名字不给点：保存按钮置灰 + 输入框下常驻一行灰字说明为什么。
     * 比「点了没反应」清楚，也不用依赖 toast —— 浮层打开时 toast 沉在最底下，容易被面板盖住。 */
    const nameEl = $('fName'), saveEl = $('fSave');
    function syncSave() {
      const empty = !nameEl.value.trim();
      saveEl.disabled = empty; saveEl.setAttribute('aria-disabled', empty ? 'true' : 'false');
      /* 名字补上后，把之前因校验失败标红的红字清掉 */
      if (!empty && nameEl.getAttribute('aria-invalid') === 'true') {
        nameEl.setAttribute('aria-invalid', 'false');
        const b = $('fErr'); if (b) { b.hidden = true; b.textContent = ''; }
      }
    }
    nameEl.addEventListener('input', syncSave);
    syncSave();
    $('sheetBody').onclick = function (e) {
      const fd = e.target.closest('[data-fd]');
      if (fd) { fd.classList.toggle('on'); return; }
      const b = e.target.closest('[data-f]');
      if (!b) return;
      const f = b.dataset.f, val = b.dataset.v;
      pick[f] = val;
      setSelected(b.parentNode, b);
      if (f === 'sched') paintSchedule(val);
      /* 两个休息额度互斥（v51）：选了一个，另一个自动回到「0」并清掉高亮 ——
       * 同时生效会让「这周还剩几天」变成一道算术题。 */
      if (f === 'rest' && +val > 0) {
        pick.restm = '0';
        const box = $('fRestM');
        if (box) [].forEach.call(box.querySelectorAll('.chip'), c => c.classList.toggle('on', c.dataset.v === '0'));
      }
      if (f === 'restm' && +val > 0) {
        pick.rest = '0';
        const box = $('fRest');
        if (box) [].forEach.call(box.querySelectorAll('.chip'), c => c.classList.toggle('on', c.dataset.v === '0'));
      }
      if (f === 'type') {
        const goal = ['number', 'duration'].includes(val);
        $('fGoalFields').style.display = goal ? '' : 'none';
        if (goal && !$('fTarget').value) $('fTarget').value = val === 'duration' ? '30' : '1';
        if (goal && !$('fUnit').value) $('fUnit').value = val === 'duration' ? '分钟' : '次';
      }
    };
    sheetState = { pick, sc: Object.assign({}, sc) };
    /* 换指标时同步更新单位、默认阈值与说明（select 不参与上面的 data-f 委托） */
    const autoEl = $('fAuto');
    if (autoEl) {
      autoEl.addEventListener('change', function () {
        const key = autoEl.value;
        const row = $('fAutoThrRow'), unit = $('fAutoUnit'), hint = $('fAutoHint'), thr = $('fAutoThr');
        if (row) row.style.display = key ? '' : 'none';
        if (unit) unit.textContent = key ? autoUnitOf({ key: key }) : '';
        if (thr && key) thr.value = (window.Health ? Health.defOf(key).thr : '') || '';
        if (hint) hint.innerHTML = autoHintHTML(key ? { key: key } : null);
      });
    }
  }
  let sheetState = {};

  function collectHabit(id) {
    const st = S();
    const pick = (sheetState && sheetState.pick) || {};
    const type = pick.type || (id ? (st.items.find(x => x.id === id) || {}).type : 'check');
    const slot = pick.slot || 'any';
    const schedType = pick.sched || 'daily';
    const nEl = $('fSchedN');
    const schedule = schedType === 'timesPerWeek' ? { type: 'timesPerWeek', n: +(nEl && nEl.value || 3) }
      : schedType === 'interval' ? { type: 'interval', n: +(nEl && nEl.value || 2) }
        : schedType === 'weekdays' ? { type: 'weekdays', days: [...($('fDays') ? $('fDays').querySelectorAll('.on') : [])].map(b => +b.dataset.fd) }
          : schedType === 'monthly' ? { type: 'monthly', days: [...new Set(($('fSchedDays').value || '').split(/[,，\s]+/).filter(Boolean).map(Number))] }
            /* 年度型（v50）：'3-15' → '03-15'，只存月日，比月份年份都简单 */
            : schedType === 'yearly' ? {
              type: 'yearly', dates: [...new Set(($('fSchedDays').value || '').split(/[,，\s]+/).filter(Boolean).map(function (s) {
                const p = String(s).split(/[-\/月]/).filter(Boolean).map(Number);
                if (p.length < 2 || !p[0] || !p[1]) return '';
                return String(p[0]).padStart(2, '0') + '-' + String(p[1]).padStart(2, '0');
              }).filter(Boolean))]
            }
              : { type: 'daily' };
    const color = pick.color || (id ? (st.items.find(x => x.id === id) || {}).color : Store.palette()[0]);
    const targetRaw = $('fTarget').value;
    return {
      /* 这里不要给空名字兜底成「新习惯」—— 那样校验就永远看不到空值，
       * 用户点保存会悄悄建出一个叫「新习惯」的东西。留空交给 validateHabit 拦。 */
      name: ($('fName').value || '').trim(),
      type,
      target: targetRaw === '' ? null : parseFloat(targetRaw),
      unit: $('fUnit').value.trim(),
      slot,
      reminderAt: $('fRemind').value || null,
      dependsOn: $('fDep').value || null,
      why: $('fWhy') ? $('fWhy').value.trim() : (id ? ((st.items.find(x => x.id === id) || {}).why || '') : ''),
      cue: $('fCue') ? $('fCue').value.trim() : (id ? ((st.items.find(x => x.id === id) || {}).cue || '') : ''),
      steps: ($('fSteps').value || '').split('\n').map(s => s.trim()).filter(Boolean),
      schedule, color,
      /* 每周休息额度（v49）：0 = 每天都要做（默认，行为与以前完全一致） */
      restPerWeek: Math.max(0, Math.min(6, +(pick.rest || 0) || 0)),
      /* 每月休息额度（v51）：与每周互斥，引擎里按月那个优先 */
      restPerMonth: Math.max(0, Math.min(15, +(pick.restm || 0) || 0)),
      /* 健康数据自动勾选（v47）：没选指标就是 null，等于关掉 */
      autoHealth: (function () {
        const el = $('fAuto');
        const k = el ? el.value : '';
        if (!k) return null;
        const raw = parseFloat(($('fAutoThr') || {}).value || '');
        const def = window.Health ? Health.defOf(k) : { thr: 0 };
        return { key: k, thr: Number.isFinite(raw) && raw > 0 ? raw : (def.thr || 0) };
      })()
    };
  }

  /* 保存前的校验：以前是「填什么存什么」，空名字、重名、计数型没填目标都能存下来，
   * 之后在今日页表现得很怪（比如目标为空的计数习惯永远算不出完成）。
   * 这里统一拦一道，返回空串表示通过。 */
  function validateHabit(d, id) {
    const name = String((d && d.name) || '').trim();
    if (!name) return '给这个习惯起个名字吧';
    if (name.length > 20) return '名字最多 20 个字';
    const dup = (S().items || []).some(x =>
      !x.deleted && !x.archived && x.id !== id && String(x.name || '').trim() === name);
    if (dup) return '已经有一个叫「' + name + '」的习惯了，换个名字或直接编辑它';
    if (d.type === 'number' || d.type === 'duration') {
      if (!Number.isFinite(d.target) || d.target <= 0) {
        return (d.type === 'duration' ? '时长型' : '计数型') + '习惯需要一个大于 0 的目标值，比如 30';
      }
    }
    const sc = d.schedule || {};
    if (sc.type === 'timesPerWeek') {
      const n = +sc.n;
      if (!(Number.isInteger(n) && n >= 1 && n <= 7)) return '「每周几次」请填 1–7 之间的整数';
    }
    if (sc.type === 'interval') {
      const n = +sc.n;
      if (!(Number.isInteger(n) && n >= 2 && n <= 30)) return '「隔 N 天」请填 2–30 之间的整数';
    }
    if (sc.type === 'weekdays' && !((sc.days || []).length)) return '「工作日」至少选一个要打卡的星期';
    if (sc.type === 'monthly' && (!(sc.days || []).length || sc.days.some(n => !Number.isInteger(n) || n < 1 || n > 31))) return '每月日期请填 1–31 之间的整数，用逗号分隔';
    /* 年度型（v50）：没解析出任何合法「月-日」就拦下 —— 空着保存等于这个习惯永远不出现 */
    if (sc.type === 'yearly') {
      const ds = sc.dates || [];
      if (!ds.length) return '「每年指定日」请填月-日，例如：3-15';
      const bad = ds.some(md => !/^\d{2}-\d{2}$/.test(md) || +md.slice(0, 2) < 1 || +md.slice(0, 2) > 12 || +md.slice(3) < 1 || +md.slice(3) > 31);
      if (bad) return '「每年指定日」的月份请填 1–12、日期请填 1–31';
    }
    return '';
  }

  /* 面板内行内报错：浮层打开时 toast 沉在最底下、容易被面板盖住（评审实测空名保存「无提示」）。
   * 这里把错误写进 #fErr 并标红对应字段、把焦点移回去；找不到面板就用 toast 兜底。 */
  function formError(msg, fieldId) {
    const box = $('fErr');
    if (!box) { U.toast(msg); return; }
    box.textContent = msg; box.hidden = false;
    const f = fieldId ? $(fieldId) : null;
    if (f) { f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', 'fErr'); try { f.focus(); } catch (e) { } }
  }

  function openBundle(b) {
    const st = S();
    const v = b || { name: '', emoji: '🧩', itemIds: [] };
    const items = (st.items || []).filter(i => !i.deleted && !i.archived);
    sheet(v.id ? '编辑套餐' : '新建套餐',
      '<div class="field"><label>名称</label><input class="input" id="bName" data-max="24" value="' + E(v.name) + '" placeholder="例如：晨间仪式"></div>' +
      '<div class="field"><label>图标</label><div class="chips" id="bEmoji">' +
      ['🌅', '🌙', '💪', '🧘', '📚', '🏃', '🧩', '☀️', '🛁', '🎯'].map(e =>
        '<button class="chip' + (v.emoji === e ? ' on' : '') + '" data-fe="' + e + '" style="font-size:19px">' + e + '</button>').join('') + '</div></div>' +
      '<div class="field"><label>包含的习惯</label><div class="chips" id="bItems">' +
      items.map(i => '<button class="chip' + ((v.itemIds || []).includes(i.id) ? ' on' : '') + '" data-fi="' + i.id + '">' + E(i.name) + '</button>').join('') +
      (items.length ? '' : '<span class="muted">先去创建习惯</span>') + '</div></div>' +
      '<div class="row" style="margin-top:6px"><button class="btn block" data-act="savebundle" data-id="' + (v.id || '') + '">保存</button></div>'
    );
    const em = document.querySelectorAll('#bEmoji .chip');
    em.forEach(x => x.onclick = () => { em.forEach(y => y.classList.remove('on')); x.classList.add('on'); });
    document.querySelectorAll('#bItems .chip').forEach(x => x.onclick = () => x.classList.toggle('on'));
  }

  /* ---------------- 搭子（v32 · 4.7） ----------------
   * 只共享一个习惯：双方看得到「今天做没做」和连续天数，看不到数值、备注、照片。
   * 没搭子时是一张轻引导卡；有搭子时是一张对照卡，加一个「打个气」。
   * 位置放在「断了怎么办」之后 —— 先处理自己的事，再想到朋友。 */
  /* 搭子邀请什么时候可以出现（走查第 4 条）：三个条件任一满足才推，
   * 都不满足时今日页让位给「最近 7 天」周卡。 */
  function buddyWarm() {
    const st = S();
    if (!Engine.items().length) return false;
    const activeDays = Object.keys(st.logs || {}).length;
    return Engine.globalStreak() >= 3 || Engine.items().length >= 2 || activeDays >= 5;
  }
  /* 手机端瘦身版的一行（走查第 9 条：和备份提醒合成一条提示条） */
  function buddyInviteLine() {
    if (!window.Buddy) return '';
    const b = Buddy.mine();
    if (b && b.code) return '';
    if (!buddyWarm()) return '';
    return '<div class="hm-line"><span class="hm-ico">' + ico('users') + '</span>' +
      '<span class="hm-main"><b>找个搭子，一起坚持</b>' +
      '<small>只共享一个习惯，对方只看到「今天做没做」和连续天数</small></span>' +
      '<button class="btn sm ghost" data-act="buddynew">邀请</button></div>';
  }

  function buddyHTML(slim) {
    if (!window.Buddy) return '';
    const b = Buddy.mine();
    const d = U.today();
    if (!b || !b.code) {
      if (!buddyWarm()) return '';      // 还没习惯 / 数据太少，先别推销社交
      if (slim) return '';              // 手机端这一行由 homeHints 合成进提示条
      return '<div class="card buddy-card">' +
        '<div class="buddy-head"><span class="buddy-ico">' + ico('users') + '</span>' +
        '<div class="buddy-t">找个搭子，一起坚持</div></div>' +
        '<div class="buddy-s">只共享一个习惯。对方看得到「今天做没做」和连续天数，看不到你的数值和备注。</div>' +
        '<div class="bc-acts"><button class="btn sm" data-act="buddynew">邀请一个朋友</button></div>' +
        '</div>';
    }
    const it = Buddy.habit();
    const me = Buddy.myState();
    const peer = b.peer;
    const head = '<div class="buddy-head"><span class="buddy-ico">' + ico('users') + '</span>' +
      '<div class="buddy-t">' + (peer ? '和「' + E(peer.nick) + '」一起' : '搭子') + (it ? '「' + E(it.name) + '」' : '') + '</div>' +
      '<button class="buddy-more" data-act="buddymenu" aria-label="搭子设置">⋯</button></div>';
    if (!it) {
      return '<div class="card buddy-card">' + head +
        '<div class="buddy-s">共享的习惯不在了。换一个习惯，或者退出搭子。</div>' +
        '<div class="bc-acts"><button class="btn sm" data-act="buddyrepick">换一个习惯</button>' +
        '<button class="btn sm ghost" data-act="buddyleaveask">退出搭子</button></div></div>';
    }
    if (!peer) {
      return '<div class="card buddy-card">' + head +
        '<div class="buddy-s">还在等对方加入。把邀请链接发给他，点开就能进来。</div>' +
        '<div class="bc-acts"><button class="btn sm" data-act="buddyinvite">复制邀请链接</button>' +
        '<button class="btn sm ghost" data-act="buddysync">刷新</button></div>' +
        (b.lastError === 'offline' ? '<div class="buddy-fine">暂时连不上搭子服务，会自动重试</div>' : '') +
        '</div>';
    }
    const peerDone = !!(peer.done && peer.day === d);
    const peerStale = !!(peer.day && peer.day !== d);
    const mineDone = !!(me && me.done);
    const cheerToday = !!(b.myCheerAt && U.ymd(new Date(b.myCheerAt)) === d);
    return '<div class="card buddy-card">' + head +
      '<div class="buddy-rows">' +
      '<div class="buddy-row"><b>我</b><span class="bd-state' + (mineDone ? ' on' : '') + '">' +
      (mineDone ? '✓ 今天完成' : '○ 还没完成') + '</span>' +
      '<span class="bd-streak">连续 ' + ((me && me.streak) || 0) + ' 天</span></div>' +
      '<div class="buddy-row"><b>' + E(peer.nick) + '</b><span class="bd-state' + (peerDone ? ' on' : '') + '">' +
      (peerDone ? '✓ 今天完成' : peerStale ? '· 今天还没同步' : '○ 还没完成') + '</span>' +
      '<span class="bd-streak">连续 ' + (peer.streak || 0) + ' 天</span></div>' +
      '</div>' +
      '<div class="bc-acts">' +
      (cheerToday
        ? '<button class="btn sm ghost" data-act="buddynoop" disabled>今天已经打过气</button>'
        : '<button class="btn sm" data-act="buddycheer">' + ico('paper-plane') + ' 给他打个气</button>') +
      '<button class="btn sm ghost" data-act="buddysync">刷新</button>' +
      '</div>' +
      (b.lastError === 'offline' ? '<div class="buddy-fine">暂时连不上，显示的是上次同步的状态</div>' : '') +
      '</div>';
  }

  function openBuddyNew() {
    const list = Engine.items();
    if (!list.length) { toast('先建一个习惯，再找搭子'); return; }
    const opts = list.map((it, i) => '<option value="' + E(it.id) + '"' + (i === 0 ? ' selected' : '') + '>' + E(it.name) + '</option>').join('');
    sheet('找个搭子',
      '<div class="muted" style="line-height:1.75">挑一个习惯共享给朋友。他只看得到「今天做没做」和连续天数 —— 数值、备注、照片都不会传出去。</div>' +
      '<div class="field" style="margin-top:14px"><label for="bdHabit">共享哪个习惯</label><select class="input" id="bdHabit">' + opts + '</select></div>' +
      '<div class="field" style="margin-top:10px"><label for="bdNick">你的名字（对方会看到）</label><input class="input" id="bdNick" maxlength="12" value="' + E(Buddy.nick()) + '" placeholder="比如 小明"></div>' +
      '<div class="row" style="margin-top:16px"><button class="btn" data-act="buddycreate">生成邀请链接</button></div>' +
      '<div class="muted" style="margin-top:12px;font-size:12px;line-height:1.7">邀请链接里只有一串 6 位码，没有你的数据。</div>');
  }

  function openBuddyInvite(code) {
    const b = Buddy.mine();
    const c = code || (b && b.code);
    if (!c) return;
    const link = Buddy.inviteLink(c);
    sheet('邀请链接',
      '<div class="muted">把这个链接发给朋友，他点开就能加入。</div>' +
      '<div class="bd-link" id="bdLink">' + E(link) + '</div>' +
      '<div class="row" style="margin-top:12px;gap:10px"><button class="btn" data-act="buddycopy">复制链接</button>' +
      '<button class="btn ghost" data-act="buddyshare">分享…</button></div>' +
      '<div class="muted" style="margin-top:12px;font-size:12px;line-height:1.7">对方加入后，你打开应用就能看到他的状态。<br>链接里没有你的记录，只有一串 6 位码。</div>');
  }

  function openBuddyJoin(code) {
    const list = Engine.items();
    if (!list.length) { toast('先建一个要一起坚持的习惯，再来加入'); return; }
    const opts = list.map((it, i) => '<option value="' + E(it.id) + '"' + (i === 0 ? ' selected' : '') + '>' + E(it.name) + '</option>').join('');
    sheet('加入搭子',
      '<div class="muted" style="line-height:1.75">朋友邀请你加入一个搭子。选一个你自己的习惯一起坚持 —— 双方只看得到「今天做没做」和连续天数。</div>' +
      '<div class="field" style="margin-top:14px"><label for="bdHabit">用哪个习惯</label><select class="input" id="bdHabit">' + opts + '</select></div>' +
      '<div class="field" style="margin-top:10px"><label for="bdNick">你的名字（对方会看到）</label><input class="input" id="bdNick" maxlength="12" value="' + E(Buddy.nick()) + '" placeholder="比如 小林"></div>' +
      '<div class="row" style="margin-top:16px"><button class="btn" data-act="buddyjoin" data-code="' + E(code) + '">加入</button></div>' +
      '<div class="muted" style="margin-top:12px;font-size:12px;line-height:1.7">邀请码 ' + E(code) + ' · 加入后随时可以退出，退出就互相看不到了。</div>');
  }

  function openBuddyMenu() {
    if (!window.Buddy || !Buddy.has()) return;
    const html = '<div class="card">' +
      menuRow(ico('link'), '邀请链接', '对方点开就能加入', 'buddyinvite') +
      menuRow(ico('refresh'), '立即同步', '看看对方现在做完了没', 'buddysync') +
      menuRow(ico('x'), '退出搭子', '退出后互相看不到，服务端的数据会删掉', 'buddyleaveask') +
      '</div>';
    sheet('搭子设置', html);
  }

  function openBuddyLeaveAsk() {
    sheet('退出搭子？',
      '<div class="muted" style="line-height:1.75">退出后你们互相看不到对方的状态，服务端那两条记录会删掉。你本机的打卡记录不受影响。</div>' +
      '<div class="row" style="margin-top:16px;gap:10px"><button class="btn" data-act="buddyleave">退出</button>' +
      '<button class="btn ghost" data-act="buddyclose">再想想</button></div>');
  }

  /* ---------------- 习惯计时器 ----------------
   * 时长型习惯：按下计时 → 做完自动打卡。计时状态存在 Timer 里（持久化），
   * 关掉抽屉、切后台、甚至刷新页面都不会中断。 */
  let _timerTick = null;
  function stopTimerTick() { if (_timerTick) { clearInterval(_timerTick); _timerTick = null; } }
  function paintTimer() {
    const t = window.Timer ? Timer.active() : null;
    const big = $('timerBig');
    if (!t || !big) { stopTimerTick(); return; }
    const it = (S().items || []).find(x => x.id === t.itemId);
    const ms = Timer.elapsed(t);
    big.textContent = Timer.fmt(ms);
    const reached = !!(it && it.target && ms >= it.target * 60000);
    const sub = $('timerSub');
    if (sub && it && it.target) {
      const left = it.target * 60000 - ms;
      sub.textContent = (reached ? '已达标 ✓ ' : '') + '目标 ' + U.num(it.target) + (it.unit || '') +
        (reached ? ' · 可以收了' : ' · 还差 ' + Timer.fmt(left));
      sub.classList.toggle('ok', reached);
    }
    const bar = $('timerBar');
    if (bar && it && it.target) {
      bar.style.width = Math.min(100, ms / (it.target * 60000) * 100) + '%';
      bar.style.background = reached ? 'var(--ok)' : 'var(--accent)';
    }
    const btn = $('timerBtn');
    if (btn) btn.textContent = t.running ? '暂停' : '继续';
    /* 主按钮跟着状态变脸：到点了是「完成并打卡」，没到点是「记下 X 分钟」——
     * 中途收工同样保留已计时间，只是不算完成。 */
    const fin = $('timerFinish');
    if (fin) fin.textContent = reached ? '完成并打卡' : '记下 ' + Math.round(ms / 60000) + ' 分钟';
  }
  function startTimerTick() { stopTimerTick(); _timerTick = setInterval(paintTimer, 500); paintTimer(); }

  function openTimer(it) {
    if (!it || !window.Timer) return;
    const t = Timer.active();
    if (!t || t.itemId !== it.id) Timer.start(it.id);
    sheet('⏱ ' + E(it.name),
      '<div class="timer-panel">' +
      '<div class="timer-big" id="timerBig">00:00</div>' +
      '<div class="timer-sub" id="timerSub">' + (it.target ? '目标 ' + U.num(it.target) + (it.unit || '') : '没有设目标时长 · 结束时会记下已计时间') + '</div>' +
      '<div class="h-bar" style="margin:12px 2px 0"><i id="timerBar" style="width:0%"></i></div>' +
      '<div class="row" style="margin-top:18px;justify-content:center;gap:10px">' +
      '<button class="btn" data-act="timertoggle" id="timerBtn">暂停</button>' +
      '<button class="btn" data-act="timerfinish" id="timerFinish" style="background:var(--ok)">完成并打卡</button></div>' +
      '<div class="row" style="margin-top:12px;justify-content:center;gap:16px">' +
      '<button class="btn ghost sm" data-act="timerreset">重新开始</button>' +
      '<button class="btn ghost sm" data-act="timercancel" style="color:var(--danger)">删除这次计时</button></div>' +
      '<div class="muted" style="text-align:center;margin-top:14px;font-size:12px;line-height:1.7">' +
      '关掉这个面板计时也继续跑，到点自动打卡<br>中途结束会保留已经计到的时间</div>' +
      '</div>');
    startTimerTick();
  }

  /* ---------------- 待办 ----------------
   * 参考 Habitica 的 To-Dos：待办不进完成率分母、不影响连击，只服务「做完就没了的事」。 */
  function subRowsHTML(t) {
    const rows = (t.subtasks || []).map(s2 =>
      '<div class="todo-sub-row"><button class="sub-tick' + (s2.done ? ' on' : '') + '" data-act="todosub" data-id="' + t.id + '" data-sub="' + s2.id + '" aria-label="子任务"></button>' +
      '<span class="' + (s2.done ? 'done' : '') + '">' + E(s2.text) + '</span>' +
      '<button class="sub-del" data-act="todosubdel" data-id="' + t.id + '" data-sub="' + s2.id + '" aria-label="删除子任务">×</button></div>').join('');
    return rows || '<div class="muted" style="font-size:12.5px">还没有子任务</div>';
  }
  function openTodoEdit(t) {
    const v = t || {};
    const prio = v.priority == null ? 1 : v.priority;
    sheet(v.id ? '编辑待办' : '新建待办',
      '<div class="field"><label>要做什么</label><input class="input" id="tdTitle" data-max="60" value="' + E(v.title || '') + '" placeholder="例如：买跑鞋"></div>' +
      '<div class="field"><label>优先级</label><div class="chips" id="tdPrio">' +
      [0, 1, 2].map(p => '<button class="chip' + (prio === p ? ' on' : '') + '" data-act="tdprio" data-v="' + p + '">' + Todo.PRIO[p] + '</button>').join('') + '</div></div>' +
      '<div class="field"><label>截止日期（可选）</label><input class="input" id="tdDue" type="date" value="' + (v.due || '') + '"></div>' +
      '<div class="field"><label>备注（可选）</label><textarea class="input" id="tdNote" data-max="200" placeholder="补充信息">' + E(v.note || '') + '</textarea></div>' +
      (v.id ? '<div class="field"><label>子任务（可选）</label><div id="tdSubs">' + subRowsHTML(v) + '</div>' +
        '<div class="row" style="margin-top:8px"><input class="input" id="tdSubInput" data-max="40" placeholder="加一个子任务" style="flex:1">' +
        '<button class="btn sm ghost" data-act="todosubadd" data-id="' + v.id + '">添加</button></div></div>' : '') +
      '<div class="row" style="margin-top:10px"><button class="btn block" data-act="todosave" data-id="' + (v.id || '') + '">保存</button></div>' +
      (v.id ? '<div class="row" style="margin-top:8px"><button class="btn block ghost" data-act="tododel" data-id="' + v.id + '" style="color:var(--danger)">删除这条待办</button></div>' : '')
    );
  }
  function openTodoMenu(t) {
    sheet('「' + E(t.title || '未命名') + '」',
      '<div class="card">' +
      '<button class="line-cell" data-act="todoedit" data-id="' + t.id + '" style="width:100%;border:none;background:none;text-align:left;cursor:pointer">' +
      '<div><div class="k">编辑</div><div class="s">标题、优先级、截止日期、子任务</div></div><span style="color:var(--txt-3)">›</span></button>' +
      (t.done ? '' : '<button class="line-cell" data-act="todotoggle" data-id="' + t.id + '" style="width:100%;border:none;background:none;text-align:left;cursor:pointer">' +
        '<div><div class="k">标为已完成</div><div class="s">移到「已完成」</div></div><span style="color:var(--txt-3)">✓</span></button>') +
      '</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn block ghost" data-act="tododel" data-id="' + t.id + '" style="color:var(--danger)">删除这条待办</button></div>');
  }

  /* ---------------- 引导式挑战 ---------------- */
  function openChalDetail(c) {
    const p = Challenge.pct(c);
    const it = (S().items || []).find(x => x.id === c.habitId);
    const preset = Challenge.preset(c.key) || {};
    sheet(ico(c.icon || 'target') + ' ' + E(c.name),
      '<div class="card">' +
      '<div class="chal-bar big"><i style="width:' + p + '%"></i></div>' +
      '<div class="kv"><span>进度</span><b>' + Challenge.doneCount(c) + ' / ' + c.days + ' 天（' + p + '%）</b></div>' +
      '<div class="kv"><span>开始于</span><b>' + E(c.startedAt) + '</b></div>' +
      (it ? '<div class="kv"><span>关联习惯</span><b>' + E(it.name) + '</b></div>' : '') +
      (c.doneAt
        ? '<div class="kv"><span>状态</span><b style="color:var(--ok)">已通关 🎉</b></div>'
        : '<div class="kv"><span>还差</span><b>' + Challenge.left(c) + ' 天</b></div>') +
      (preset.desc ? '<div class="muted" style="margin-top:10px;line-height:1.6">' + E(preset.desc) + '</div>' : '') +
      '<div class="muted" style="margin-top:8px;font-size:12px;line-height:1.6">进度按「累计完成天数」算，漏一天不至于归零 —— 慢慢来，比断一次就放弃强。</div>' +
      '</div>' +
      (it ? '<div class="row" style="margin-top:12px"><button class="btn block ghost" data-act="chalhabit" data-id="' + it.id + '">去打卡这个习惯</button></div>' : '') +
      (c.doneAt ? '' : '<div class="row" style="margin-top:8px"><button class="btn block ghost" data-act="chalquit" data-id="' + c.id + '" style="color:var(--danger)">退出挑战</button></div>')
    );
  }
  function openChalLib() {
    const byKey = {};
    Challenge.list().forEach(c => { byKey[c.key] = c; });
    sheet('全部挑战',
      '<div class="muted" style="margin-bottom:12px;line-height:1.6">加入挑战会自动帮你建好对应的习惯，坚持够天数就拿积分。随时能退出。</div>' +
      '<div class="list">' + Challenge.PRESETS.map(p => {
        const c = byKey[p.key];
        return '<div class="chal">' +
          '<div class="chal-emoji">' + ico(p.icon || 'target') + '</div>' +
          '<div class="chal-main"><div class="chal-t">' + E(p.name) + '</div>' +
          '<div class="chal-s">' + E(p.desc) + '</div>' +
          '<div class="chal-s" style="color:var(--accent)">奖励 ' + p.reward + ' 积分</div></div>' +
          (c ? '<button class="btn sm ghost" data-act="chaldetail" data-id="' + c.id + '">进行中</button>'
            : '<button class="btn sm" data-act="chaljoin" data-k="' + p.key + '">加入</button>') +
          '</div>';
      }).join('') + '</div>');
  }

  function openPomo() {
    const today = U.today();
    const bound = (S().items || []).find(x => x.id === Feat.Pomo.habitId && !x.deleted) || null;
    /* 候选只列「今天该做且还没做」的习惯：专注完正好能补上一个坑 */
    const cand = Engine.items().filter(it => Engine.isDue(it, today) && !Engine.isDone(it, today)).slice(0, 8);
    sheet('番茄钟',
      '<div class="pomo"><div class="t" id="pomoTime">' +
      (Feat.Pomo.mode === 'idle' ? U.pad(S().settings.pomoLen || 25) + ':00' :
        U.pad(Math.floor(Feat.Pomo.left / 60)) + ':' + U.pad(Feat.Pomo.left % 60)) + '</div>' +
      '<div class="st" id="pomoState">' + (Feat.Pomo.mode === 'idle' ? '准备开始专注' :
        '专注中' + (bound ? ' · 为「' + E(bound.name) + '」' : '') + '，别看手机') + '</div></div>' +
      '<div class="row" style="justify-content:center"><button class="btn" data-act="pomostart">' +
      (Feat.Pomo.mode === 'idle' ? '开始专注' : '结束') + '</button>' +
      '<button class="btn ghost" data-act="pomobreak">休息 ' + (S().settings.breakLen || 5) + ' 分钟</button></div>' +
      /* v38 · 报告 P1-1：番茄钟 × 习惯绑定 */
      '<div class="sec-title"><h3>为哪个习惯专注</h3><span class="more">可选</span></div>' +
      '<div class="chips" id="pomoHabits">' +
      '<button class="chip' + (!Feat.Pomo.habitId ? ' on' : '') + '" data-act="pomohabit" data-id="">不限</button>' +
      cand.map(it => '<button class="chip' + (Feat.Pomo.habitId === it.id ? ' on' : '') +
        '" data-act="pomohabit" data-id="' + it.id + '">' + E(it.name) + '</button>').join('') +
      '</div>' +
      '<div class="muted" style="margin-top:6px">' +
      (cand.length
        ? '选一个：这段专注结束时会问你「要不要记进它」，一键打卡，不用再手动填。'
        : '今天该做的都做完了 —— 现在专注就只记在番茄统计里。') + '</div>' +
      '<div class="row" style="gap:10px;margin-top:14px"><div class="field" style="flex:1"><label>专注时长（分钟）</label>' +
      '<input class="input" id="pomoLen" type="number" value="' + (S().settings.pomoLen || 25) + '"></div>' +
      '<div class="field" style="flex:1"><label>休息时长（分钟）</label>' +
      '<input class="input" id="breakLen" type="number" value="' + (S().settings.breakLen || 5) + '"></div></div>' +
      '<div class="muted">今日已完成 ' + (S().sessions || []).filter(s => s.kind === 'focus' && U.ymd(new Date(s.at)) === U.today()).length + ' 个番茄</div>'
    );
  }

  function openRewards() {
    const st = S();
    const pts = Engine.points();
    sheet('积分商店',
      '<div class="card" style="box-shadow:none;background:var(--accent-soft)"><div style="font-size:13px;color:var(--txt-2)">可用积分</div>' +
      '<div style="font-size:30px;font-weight:700">' + pts + '</div></div>' +
      (st.rewards || []).map(r =>
        '<div class="line-cell"><span style="font-size:19px">' + (r.emoji || '🎁') + '</span>' +
        '<div style="flex:1"><div class="k">' + E(r.name) + '</div><div class="s">' + r.cost + ' 分</div></div>' +
        '<button class="btn sm' + (pts >= r.cost ? '' : ' ghost') + '" data-act="redeem" data-id="' + r.id + '"' + (pts >= r.cost ? '' : ' disabled') + '>兑换</button>' +
        '<button class="btn sm ghost" data-act="delreward" data-id="' + r.id + '">×</button></div>').join('') +
      '<div class="row" style="gap:8px;margin-top:14px"><input class="input" id="rwName" data-max="20" placeholder="奖励名称" style="flex:2">' +
      '<input class="input" id="rwCost" type="number" placeholder="分值" style="flex:1">' +
      '<button class="btn" data-act="addreward">添加</button></div>' +
      ((st.redemptions || []).length ? '<div class="sec-title"><h3>兑换记录</h3></div>' +
        st.redemptions.slice().reverse().slice(0, 10).map(r =>
          '<div class="line-cell"><div class="k">' + E(r.name) + '</div><div class="muted">' + U.prettyDate(U.ymd(new Date(r.at))) + ' · -' + r.cost + '</div></div>').join('') : '')
    );
  }

  /* v41 · 报告 P1-7：年度海报 —— 复用日签海报的保存动作，只换画法 */
  function openYearPoster() {
    const year = new Date().getFullYear();
    sheet(year + ' 年度海报',
      '<canvas id="posterCanvas"></canvas>' +
      '<div class="row" style="margin-top:12px"><button class="btn block" data-act="saveposter">保存到相册 / 下载</button></div>' +
      '<div class="muted" style="margin-top:8px">只放你自己的数字：完成率、有效天数、完成次数、最长连续。手机上长按图片即可保存。</div>'
    );
    setTimeout(() => {
      const c = $('posterCanvas');
      if (c) Feat.drawYearPoster(c);
    }, 40);
  }

  /* note = 纪念语（里程碑庆祝时传入）。带上它时标题也说明这是一张纪念版。 */
  function openPoster(note) {
    sheet(note ? '纪念日签' : '日签海报',
      '<canvas id="posterCanvas"></canvas>' +
      '<div class="row" style="margin-top:12px"><button class="btn block" data-act="saveposter">保存到相册 / 下载</button></div>' +
      '<div class="muted" style="margin-top:8px">' + (note ? '把这一天的连续纪录存下来，之后翻出来看很有用。' : '手机上长按图片即可保存') + '</div>'
    );
    setTimeout(() => {
      const c = $('posterCanvas');
      if (c) Feat.drawPoster(c, note);
    }, 40);
  }

  function openData(kind) {
    const d = U.today();
    const note = S().notes[d] || {};
    sheet('今日记录',
      '<div class="field"><label>笔记</label><textarea class="input" id="nText" data-max="1000" style="min-height:120px">' + E(note.text || '') + '</textarea></div>' +
      '<div class="row"><button class="btn" data-act="savenote">保存笔记</button>' +
      '<button class="btn ghost" data-act="addphoto">添加照片</button>' +
      '<button class="btn ghost" data-act="addaudio">录制语音</button></div>' +
      '<div class="photos" id="notePhotos"></div>' +
      '<div class="muted" style="margin-top:10px">' +
      (window.Cloud && Cloud.signedIn() && S().settings.cloudMedia !== false
        ? '照片、视频和语音会上传到云端，本机只留很小的预览图，不占手机和电脑空间。'
        : '照片、视频和语音存在浏览器数据库里，不产生你磁盘上的可见文件；想完全不占本机，去「连接」页登录云空间。') + '</div>'
    );
  }

  function openInvite() {
    const st = S();
    const link = location.origin + location.pathname + '#room=' + st.activeRoomId;
    sheet('邀搭子',
      '<div class="field"><label>我的名字</label><input class="input" id="myName" data-max="16" value="' + E(st.settings.nickname || '') + '" placeholder="朋友看到的名字"></div>' +
      '<div class="row"><button class="btn" data-act="savename">保存名字</button></div>' +
      '<div class="sec-title"><h3>邀请链接</h3></div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2);word-break:break-all;font-size:12.5px" id="inviteLink">' + E(link) + '</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn ghost" data-act="copylink">复制链接</button>' +
      '<button class="btn ghost" data-act="copycode">复制房间码</button></div>' +
      '<div class="muted" style="margin-top:10px">朋友打开链接后，把各自的「导出备份」发给你，用「导入备份 → 合并」就能看到彼此的打卡；打卡人名字会显示在记录上。</div>'
    );
  }

  /* ---------------- 云空间卡片 ---------------- */
  function cloudCardHTML() {
    const st = S();
    if (!window.Cloud || !Cloud.available()) {
      return '<div class="card"><div style="font-weight:650">' + ico('cloud') + ' 云空间</div>' +
        '<div class="muted" style="margin-top:6px">云端组件没加载出来（可能是网络问题）。照片和记录仍然安全地存在本机，联网后点下面重试。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="cloudretry">重新连接</button></div></div>';
    }
    /* 后端探活失败：明确说清状况，并且不给登录按钮 —— 免得用户填完手机号干等验证码 */
    const bk = Cloud.backendState ? Cloud.backendState() : { state: 'unknown' };
    if (!Cloud.signedIn() && bk.state === 'down') {
      return '<div class="card"><div style="display:flex;align-items:center;gap:8px">' +
        '<span class="cell-ico" style="color:var(--txt-3)">' + ico('cloud') + '</span><div style="flex:1;font-weight:650">云空间 · 暂时无法连接</div></div>' +
        '<div class="muted" style="margin-top:8px;line-height:1.65">云端服务当前连不上，登录和同步暂时用不了。<br>' +
        '<b>不影响本机使用</b>：打卡、日记、照片、语音全部照常，数据都存在这台设备上。</div>' +
        (bk.err ? '<div class="muted" style="margin-top:6px;font-size:12px">诊断：' + E(bk.err) + '</div>' : '') +
        '<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-act="cloudretry">重新检测</button></div></div>';
    }
    /* 探活还没出结果：先别说"未登录"，更别给登录按钮 ——
     * 后端不可达时探活要几秒，这期间让用户填手机号就是让他白等验证码。
     * v42 · 走查第 11 条：加一道看门狗。探活本身已经收紧到 5 秒，但 SDK 下载
     * 卡住、网关把请求挂起不返回时，这个「unknown」状态能赖十几秒。
     * 超过 6 秒还停在这儿，就明确说「暂时连不上」并给重试，不再让用户干等。 */
    if (!Cloud.signedIn() && bk.state === 'unknown') {
      const stuck = !bk.since || Date.now() - bk.since > 6000;
      if (stuck) {
        return '<div class="card"><div style="display:flex;align-items:center;gap:8px">' +
          '<span class="cell-ico" style="color:var(--txt-3)">' + ico('cloud') + '</span><div style="flex:1;font-weight:650">云空间 · 暂时连不上</div></div>' +
          '<div class="muted" style="margin-top:8px;line-height:1.65">云端服务半天没有回应，可能是网络或服务端临时忙。<br>' +
          '<b>不影响本机使用</b>：打卡、日记、照片、语音全部照常，数据都存在这台设备上。</div>' +
          '<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-act="cloudretry">重新检测</button></div></div>';
      }
      return '<div class="card"><div style="display:flex;align-items:center;gap:8px">' +
        '<span class="cell-ico" style="color:var(--txt-3)">' + ico('cloud') + '</span><div style="flex:1;font-weight:650">云空间 · 正在检测</div></div>' +
        '<div class="muted" style="margin-top:8px;line-height:1.65">正在确认云端服务是否可用…<br>' +
        '<b>不影响本机使用</b>：打卡、日记、照片、语音全部照常。</div></div>';
    }
    if (!Cloud.signedIn()) {
      return '<div class="card"><div style="font-weight:650">' + ico('cloud') + ' 云空间 · 未登录</div>' +
        '<div class="muted" style="margin-top:6px">登录后可同步习惯、打卡、日记和附件。<b>未登录时所有数据（含照片）只存这台设备，不会上传。</b>登录后请确认已同步成功，再清理原设备；本机仍会保留必要缓存。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn" data-act="cloudlogin">手机号登录 / 注册</button>' +
        '<button class="btn ghost" data-act="cloudwx">微信登录</button></div></div>';
    }
    return '<div class="card" id="cloudCard">' +
      '<div style="display:flex;align-items:center;gap:8px"><span class="cell-ico" style="color:var(--txt-3)">' + ico('cloud') + '</span>' +
      '<div style="flex:1"><div style="font-weight:650">云账号已登录</div>' +
      '<div class="muted" id="cloudSyncStatus" role="status">' + E(Cloud.status.msg || '尚未完成同步') + '</div><div class="muted" id="cloudLine">正在读取…</div></div>' +
      '<button class="btn sm ghost" data-act="cloudlogout">退出</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="cloudsync">立即同步</button>' +
      '<button class="btn sm ghost" data-act="cloudpull">从云端拉取</button>' +
      '<button class="btn sm ghost" data-act="cloudpush">上传到云端</button></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="cloudslim">释放本机空间</button>' +
      '<button class="btn sm ghost" data-act="cloudrestore">换设备恢复（覆盖本机）</button></div>' +
      '<div class="muted" style="margin-top:8px;line-height:1.6">先在原设备确认“已同步”，再用新设备打开同一网址、登录同一账号。未上传的照片与仅存本机的记录需要先备份。</div>' +
      '<div class="line-cell" style="margin-top:4px;border:none"><div><div class="k">照片视频语音存云端</div>' +
      '<div class="s">关闭后新附件只存本机</div></div>' +
      '<div class="sw' + (st.settings.cloudMedia !== false ? ' on' : '') + '" data-act="togglecloudmedia"><i></i></div></div>' +
      '<div class="line-cell"><div><div class="k">本机留缩略图</div>' +
      '<div class="s">保留预览缓存，减少等待</div></div>' +
      '<div class="sw' + (st.settings.keepThumb !== false ? ' on' : '') + '" data-act="togglekeepthumb"><i></i></div></div>' +
      '<div class="line-cell"><div><div class="k">自动同步</div>' +
      '<div class="s">修改后双向同步；联网、返回页面时重试</div></div>' +
      '<div class="sw' + (st.settings.autoSync !== false ? ' on' : '') + '" data-act="toggleautosync"><i></i></div></div>' +
      '</div>';
  }

  async function paintCloud() {
    const line = $('cloudLine');
    if (!line) return;
    const u = await Cloud.mediaUsage().catch(() => ({ count: 0, bytes: 0 }));
    const q = await Store.quota().catch(() => ({ media: { bytes: 0 } }));
    const last = S().settings.lastCloudAt;
    line.textContent = '当前附件 ' + u.count + ' 个文件 · ' + U.bytes(u.bytes) +
      ' · 本机缓存 ' + U.bytes((q.media && q.media.bytes) || 0) +
      ' · ' + (last ? '上次同步 ' + U.hhmm(last) : '尚未同步');
  }

  /* ---------------- WebDAV 自建网盘备份（v27 · 4.6） ----------------
   * 给「不想注册账号」的人第二条路：备份放进自己的 Nextcloud / 群晖，
   * 换设备从同一个文件恢复。UI 上必须把三件事说清楚：
   * ① 只备份文字，照片语音不进网盘；② 发现别人写过更新的备份时会问，不静默覆盖；
   * ③ 有些网盘（坚果云）不允许网页直连，会直接告诉用户换一个，而不是甩错误码。
   * v35 · 外部评审 P1-4：第 ① 条不能只说一句「不含照片」，要真的数出来
   * 「照片 N 张 / 语音 M 条 / 视频 K 条 没被备份覆盖」，并给一个一键完整导出的入口 ——
   * 用户以为备份好了，结果换设备发现照片没了，是最伤的一类事故。 */
  function mediaStat() {
    const m = (S().media) || {};
    let photo = 0, audio = 0, video = 0;
    Object.keys(m).forEach(k => {
      const t = (m[k] || {}).kind;
      if (t === 'photo') photo++;
      else if (t === 'audio') audio++;
      else if (t === 'video') video++;
    });
    return { photo: photo, audio: audio, video: video, total: photo + audio + video };
  }
  function webdavCardHTML() {
    const st = S();
    const c = st.settings.webdav;
    if (!window.WebDAV || !c || !c.url) {
      return '<div class="card"><div style="display:flex;align-items:center;gap:8px">' +
        '<span class="cell-ico" style="color:var(--txt-3)">' + ico('upload') + '</span>' +
        '<div style="flex:1"><div style="font-weight:650">自建网盘备份 · 未设置</div>' +
        '<div class="muted">把备份存进自己的 Nextcloud / 群晖，不注册账号</div></div>' +
        '<button class="btn sm" data-act="webdavcfg">设置</button></div>' +
        '<div class="muted" style="margin-top:8px;line-height:1.65">填一次地址和「应用密码」，之后每天自动备份一份。' +
        '照片和语音体积大，不含在网盘备份里（会单独说明）。</div></div>';
    }
    const last = c.lastUploadAt;
    const err = c.lastError;
    const ms = mediaStat();
    /* 「覆盖」要说清哪些没被覆盖：一个数字都不给，等于没说 */
    const cover = ms.total
      ? '文字已备份 · <b>照片 ' + ms.photo + ' 张、语音 ' + ms.audio + ' 条、视频 ' + ms.video +
        ' 条未覆盖</b>（网盘备份只存文字）'
      : '文字已备份 · 当前没有照片语音，无需额外处理';
    return '<div class="card" id="webdavCard">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<span class="cell-ico" style="color:var(--txt-3)">' + ico('upload') + '</span>' +
      '<div style="flex:1"><div style="font-weight:650">自建网盘备份 · 已设置</div>' +
      '<div class="muted" id="webdavLine">' + E(c.user) + '@' + E(String(c.url).replace(/^https?:\/\//, '')) +
      ' / ' + E(c.dir || '') + '</div></div></div>' +
      '<div class="muted" style="margin-top:8px" id="webdavStat">' +
      (last ? '上次备份 ' + U.ymd(new Date(last)) + ' ' + U.hhmm(last) +
        (c.lastUploadBytes ? ' · ' + U.bytes(c.lastUploadBytes) : '') +
        '（已传到网盘）' : '还没有备份过') +
      (err ? '<br><span style="color:var(--danger)">上次自动备份失败：' + E(err) + '</span>' : '') + '</div>' +
      '<div class="muted" style="margin-top:8px;line-height:1.65" id="webdavCover">' + cover + '</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="webdavup">立即备份</button>' +
      '<button class="btn sm ghost" data-act="webdavdown">从网盘恢复</button>' +
      '<button class="btn sm ghost" data-act="webdavtest">检测连接</button></div>' +
      (ms.total
        ? '<div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="export">导出含照片语音的完整备份</button></div>'
        : '') +
      '<div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="webdavcfg">修改设置</button>' +
      '<button class="btn sm ghost" data-act="webdavhist">历史备份</button>' +
      '<button class="btn sm ghost" data-act="webdavoff">断开</button></div>' +
      '<div class="muted" style="margin-top:8px;line-height:1.6">只备份习惯、打卡、日记、备注；照片和语音不传网盘。' +
      '若网盘上的备份来自另一台设备，会先问你要保留哪一份，不会悄悄覆盖。</div></div>';
  }

  function openWebDAVConfig() {
    const c = S().settings.webdav || { url: '', user: '', pass: '', dir: '日拱一卒备份' };
    sheet('自建网盘备份',
      '<div class="muted" style="margin-bottom:10px;line-height:1.65">把每天一份的备份存进自己的网盘。' +
      '支持 <b>Nextcloud</b>、<b>群晖 DSM</b> 等提供 WebDAV 的服务；坚果云等不允许网页直连的网盘用不了。</div>' +
      '<div class="field"><label>服务器地址</label><input class="input" id="wvUrl" placeholder="https://你的域名/remote.php/dav/files/用户名" value="' + E(c.url) + '"></div>' +
      '<div class="field"><label>目录名（要先在网盘里建好）</label><input class="input" id="wvDir" placeholder="日拱一卒备份" value="' + E(c.dir || '日拱一卒备份') + '"></div>' +
      '<div class="field"><label>用户名</label><input class="input" id="wvUser" autocomplete="username" placeholder="网盘用户名" value="' + E(c.user) + '"></div>' +
      '<div class="field"><label>密码 / 应用密码</label><input class="input" id="wvPass" type="password" autocomplete="current-password" placeholder="多数网盘要用「应用密码」" value="' + E(c.pass) + '"></div>' +
      '<div class="muted" style="margin:8px 0 12px;line-height:1.65">账号密码只存在这台设备的浏览器里，不会发到别处；' +
      '换设备要在新设备上再填一次。</div>' +
      '<div class="row"><button class="btn" data-act="webdavsave">保存并测试连接</button>' +
      '<button class="btn ghost" data-act="webdavcancel">取消</button></div>' +
      '<div id="wvTest" class="muted" style="margin-top:10px;line-height:1.65"></div>'
    );
    setTimeout(() => { const el = document.getElementById('wvUrl'); if (el) el.focus(); }, 60);
  }

  /* 连接页（云空间卡片之后）挂一张 WebDAV 卡：备份相关功能都在「连接与备份」这一页 */
  function renderWebDAV() {
    return '<div class="sec-title"><h3>自建网盘备份</h3></div>' + webdavCardHTML();
  }

  function renderConnect() {
    let html = '';
    html += '<div class="sec-title"><h3>云空间</h3></div>';
    html += cloudCardHTML();
    setTimeout(paintCloud, 80);
    /* 云端组件是首个用到的页面才加载：进"连接与备份"就把它拉起来，
       拉完重画一次 —— 否则这一页会一直停在"重新连接"那张占位卡上。 */
    if (window.Cloud && !Cloud.sdkLoaded()) {
      Cloud.ensureSdk().then(() => { if (UI.tab === 'connect') UI.render(); }).catch(() => { });
    }

    /* WebDAV 自建网盘备份（4.6）：不依赖任何账号的第二条备份路，
     * 放在「连接与备份」这一页 —— 用户找备份功能只会来这里。 */
    html += renderWebDAV();

    html += '<div class="sec-title"><h3>插件 · 和其他应用联动</h3></div>';
    html += '<div class="card">' +
      cell('#calendar-dots', '系统日历', '把习惯提醒导出 .ics，导入 iOS / 安卓 / Google 日历', 'plg_calendar') +
      cell('#bell', '消息推送', '打卡后自动发到飞书 / 钉钉 / 企微 / Telegram / Discord', 'plg_hook') +
      cell('#lightning', '快捷指令 & URL', '一条网址就能打卡，接 iOS 快捷指令、n8n、Home Assistant', 'plg_shortcut') +
      cell('#chart-line', '健康数据导入', '手机、手环记的步数睡眠，导进来按天补打卡', 'plg_health') +
      cell('#pencil', '导出到笔记', '导出 Markdown / Obsidian / CSV 日记', 'plg_export') +
      cell('#link', '开放接口', 'URL 命令与今日状态 JSON，给别的应用调用', 'plg_api') +
      '</div>';
    html += '<div class="muted" style="text-align:center;padding:14px 0 4px">数据默认只在你的账号里；只有你主动填了机器人地址，才会往那个地址发消息</div>';
    return html;
  }

  /* ---------- 插件抽屉 ---------- */
  function openLogin() {
    /* 后端探活失败时，别把用户引到注定失败的登录流程里 */
    const bk = (window.Cloud && Cloud.backendState) ? Cloud.backendState() : { state: 'unknown' };
    if (bk.state === 'down') {
      sheet('登录 · 云空间',
        '<div class="notice"><span class="cell-ico" style="color:var(--warn)">' + ico('cloud') + '</span><span><b>云端服务当前连不上，暂时无法登录。</b><br>' +
        '打卡、日记、照片这些本地功能完全不受影响，数据都在这台设备上。</span></div>' +
        (bk.err ? '<div class="muted" style="margin-top:10px;font-size:12px">诊断：' + E(bk.err) + '</div>' : '') +
        '<div class="row" style="margin-top:14px"><button class="btn block" data-act="cloudretry">重新检测</button></div>' +
        '<div class="muted" style="margin-top:10px">如果你刚开通了云服务，点上面重试即可。</div>'
      );
      return;
    }
    /* 还在检测中：先别让用户开始填手机号，等探活出结果再说 */
    if (bk.state === 'unknown') {
      sheet('登录 · 云空间',
        '<div class="notice"><span class="cell-ico" style="color:var(--txt-3)">' + ico('cloud') + '</span><span><b>正在确认云端服务是否可用…</b><br>' +
        '请稍等几秒再试。打卡、日记、照片不受影响。</span></div>' +
        '<div class="row" style="margin-top:14px"><button class="btn block" data-act="cloudretry">立即检测</button></div>'
      );
      return;
    }
    sheet('登录 · 云空间',
      '<div class="field"><label>手机号</label><input class="input" id="lgPhone" inputmode="numeric" placeholder="11 位手机号"></div>' +
      '<div class="row" style="margin-top:10px"><input class="input" id="lgCode" placeholder="验证码" style="flex:1">' +
      '<button class="btn ghost" data-act="cloudsend">获取验证码</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn block" data-act="cloudverify">登录 / 注册</button></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn ghost block" data-act="cloudwx">微信扫码登录</button></div>' +
      '<div class="muted" style="margin-top:10px">同一账号在手机和电脑上登录即可同步。<b>登录后</b>照片语音默认上传到<b>你自己的账号</b>下（可在「连接」页关掉，关掉后只存本机）。</div>'
    );
  }

  function openCalendar() {
    const c = Plugins.cfg();
    const r = Plugins.icsText(c.ics.weeks || 8);
    sheet('系统日历',
      '<div class="field"><label>导出未来</label><div class="chips" id="icsWeeks">' +
      [4, 8, 12, 26].map(w => '<button class="chip' + ((c.ics.weeks || 8) === w ? ' on' : '') + '" data-act="icsweeks" data-v="' + w + '">' + w + ' 周</button>').join('') +
      '</div></div>' +
      '<div class="line-cell"><div><div class="k">每个事件带提醒</div><div class="s">到点由系统日历弹通知</div></div>' +
      '<div class="sw' + (c.ics.alarms !== false ? ' on' : '') + '" data-act="icsalarm"><i></i></div></div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:10px">' +
      '共 <b>' + r.count + '</b> 个事件 · 约 ' + U.bytes(r.text.length) + '</div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="icsdl">下载 .ics</button>' +
      '<button class="btn ghost" data-act="icscopy">复制内容</button></div>' +
      '<div class="notice" style="margin-top:14px"><span>💡</span><span>网页通知只在页面开着时响。<b>想让提醒在息屏时也响，就把日程放进系统日历</b> —— 由系统闹钟负责，最可靠。</span></div>' +
      '<div class="sec-title" style="margin-top:14px"><h3>三步订阅</h3></div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
      '<div class="k" style="font-weight:600">iPhone / iPad</div>' +
      '<div class="muted" style="margin-top:4px;line-height:1.7">1. 点上面「下载 .ics」<br>2. 在「文件」App 里点开它（或直接在 Safari 下载栏点一下）<br>3. 选「日历 → 添加全部事件」<br>之后每次到点由系统弹通知。</div>' +
      '<div class="k" style="font-weight:600;margin-top:12px">安卓</div>' +
      '<div class="muted" style="margin-top:4px;line-height:1.7">1. 下载 .ics<br>2. 系统日历 App → 设置 → 导入日程 → 选该文件<br>（Google 日历：网页版 → 设置 → 导入和导出 → 导入）</div>' +
      '<div class="k" style="font-weight:600;margin-top:12px">电脑 Outlook / 系统日历</div>' +
      '<div class="muted" style="margin-top:4px;line-height:1.7">文件 → 打开 → 导入，选择下载的 .ics 即可。</div>' +
      '</div>' +
      '<div class="muted" style="margin-top:10px">注意：新增习惯或改了提醒时间后，需要<b>重新下载一次</b>再导入（日历里旧的事件不会自动变）。</div>'
    );
  }

  function openHooks() {
    const c = Plugins.cfg();
    const EVENTS = [['checkin', '每次打卡'], ['remind', '到点提醒'], ['night', '睡前兜底'], ['achieve', '解锁成就'], ['allDone', '今日全完成'], ['daily', '每日汇报']];
    const rows = (c.hooks || []).map((h, i) =>
      '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-bottom:8px">' +
      '<div style="display:flex;gap:8px;align-items:center"><span>' + (h.on ? '🔔' : '🔕') + '</span>' +
      '<div style="flex:1"><div style="font-weight:650">' + E(Plugins.hookDef(h.type).name) + '</div>' +
      '<div class="muted" style="font-size:12px;word-break:break-all">' + E(String(h.url).slice(0, 90)) + '</div>' +
      '<div class="muted" style="font-size:12px">触发：' + ((h.events || []).map(v => (EVENTS.find(e => e[0] === v) || [v, v])[1]).join('、') || '全部') + '</div></div></div>' +
      '<div class="row" style="margin-top:8px">' +
      '<button class="btn sm ghost" data-act="hooktoggle" data-i="' + i + '">' + (h.on ? '暂停' : '开启') + '</button>' +
      '<button class="btn sm ghost" data-act="hooktest" data-i="' + i + '">发测试</button>' +
      '<button class="btn sm danger" data-act="hookdel" data-i="' + i + '">删除</button></div></div>'
    ).join('') || '<div class="muted">还没有添加机器人</div>';

    sheet('消息推送',
      '<div class="notice" style="margin-bottom:10px"><span>📱</span><span><b>想让提醒在手机息屏时也响</b>，就加一个 <b>Bark</b>（iPhone）或 <b>Server酱</b>（微信里收），并把触发时机勾上「到点提醒」。网页通知只在页面开着时才有用。</span></div>' +
      '<div class="muted" style="margin-bottom:10px">粘贴群机器人 / 推送通道的地址，到点或打卡时自动发一条。</div>' + rows +
      '<div class="sec-title"><h3>添加一个</h3></div>' +
      '<div class="field"><label>类型</label><select class="input" id="hkType" data-act="hooktype">' +
      Plugins.HOOKS.map(h => '<option value="' + h.id + '">' + E(h.name) + '</option>').join('') + '</select>' +
      '<div class="muted" id="hkHint" style="margin-top:6px;line-height:1.6">' + E(Plugins.HOOKS[0].hint || Plugins.HOOKS[0].tpl) + '</div></div>' +
      '<div class="field"><label>Webhook 地址</label><input class="input" id="hkUrl" placeholder="' + E(Plugins.HOOKS[0].tpl) + '"></div>' +
      '<div class="field"><label>触发时机（可多选）</label><div class="chips" id="hkEvents">' +
      EVENTS.map(e => '<button class="chip" data-act="hkevent" data-v="' + e[0] + '">' + e[1] + '</button>').join('') +
      '</div></div>' +
      '<div class="field"><label>每日汇报时间</label><input class="input" id="hkDailyAt" type="time" value="' + E((c.daily || {}).at || '21:30') + '"></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn" data-act="hookadd">添加</button>' +
      '<button class="btn ghost" data-act="dailysave">保存汇报时间</button></div>' +
      '<div class="muted" style="margin-top:10px">某些机器人地址会被浏览器跨域拦截；遇到时会自动改用「尽力发送」再试一次，群里仍可能收到。</div>'
    );
  }

  /* ---------------- 例程链 ---------------- */
  var _rtSel = [];
  function openRoutines() {
    _rtSel = [];
    const rts = Plus.routines();
    const rows = rts.map(r => {
      const rs = Plus.routineState(r, U.today());
      return '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<span>🔗</span><div style="flex:1"><div style="font-weight:650">' + E(r.name) + '</div>' +
        '<div class="muted" style="font-size:12px">' + rs.items.map(i => E(i.name)).join(' → ') + ' · 今日 ' + rs.done + '/' + rs.total + '</div></div>' +
        '<button class="btn sm ghost" data-act="rtdel" data-id="' + r.id + '">删除</button></div></div>';
    }).join('') || '<div class="muted">还没有例程</div>';

    const chips = Engine.items().map(it =>
      '<button class="chip" data-act="rtpick" data-id="' + it.id + '">' + E(it.name) + '</button>').join('') ||
      '<div class="muted">先去创建几个习惯</div>';

    sheet('例程 · 把习惯串成一条链',
      '<div class="muted" style="margin-bottom:10px">例程会显示在每个习惯列表上方，做完一个自动指向下一个，形成「晨间流程」「睡前流程」这类固定顺序。</div>' +
      rows +
      '<div class="sec-title"><h3>新建例程</h3></div>' +
      '<div class="field"><label>名称</label><input class="input" id="rtName" data-max="16" placeholder="例如：晨间例程"></div>' +
      '<div class="field"><label>按顺序点选要串起来的习惯</label><div class="chips" id="rtPick">' + chips + '</div></div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2)"><div class="k" style="font-size:12px">已选顺序</div>' +
      '<div id="rtOrder" class="muted" style="font-size:13px;margin-top:4px">（还没选）</div></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="rtadd">保存例程</button></div>'
    );
  }
  function rtToggle(id) {
    const name = (Engine.items().find(x => x.id === id) || {}).name || '';
    const i = _rtSel.indexOf(id);
    if (i >= 0) _rtSel.splice(i, 1); else _rtSel.push(id);
    const names = _rtSel.map(x => ((Store.s.items || []).find(y => y.id === x) || {}).name).filter(Boolean);
    const el = $('rtOrder');
    if (el) el.textContent = names.length ? names.join(' → ') : '（还没选）';
    document.querySelectorAll('#rtPick .chip').forEach(c => c.classList.toggle('on', _rtSel.indexOf(c.dataset.id) >= 0));
    return name;
  }
  function rtSelected() { return _rtSel.slice(); }

  /* ---------------- 时间胶囊 ---------------- */
  function openCapsules() {
    const list = Plus.capsules();
    const rows = list.slice().reverse().map(c => {
      const opened = !!c.seenAt;
      const d = U.daysBetween(U.ymd(new Date(c.createdAt || Date.now())), c.openAt);
      return '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-bottom:8px">' +
        '<div style="display:flex;gap:8px"><span>' + (opened ? ico('paper-plane') : ico('clock')) + '</span>' +
        '<div style="flex:1"><div class="muted" style="font-size:12px">' + (opened ? '写于 ' + U.prettyDate(U.ymd(new Date(c.createdAt))) : d + ' 天后解锁 · ' + c.openAt) + '</div>' +
        '<div style="font-size:13.5px;line-height:1.6;margin-top:4px">' + E(c.text) + '</div></div></div></div>';
    }).join('') || '<div class="muted">还没有写过信</div>';

    sheet('时间胶囊',
      '<div class="muted" style="margin-bottom:10px">写一句话给未来的自己。到期那天，它会出现在今日页顶部。</div>' + rows +
      '<div class="sec-title"><h3>写一封</h3></div>' +
      '<textarea class="input" id="capText" data-max="300" style="min-height:90px" placeholder="现在的我正在为什么努力？想对那时的我说什么？"></textarea>' +
      '<div class="field" style="margin-top:10px"><label>多久之后解锁</label><div class="chips" id="capDays">' +
      [30, 90, 180, 365].map(d => '<button class="chip' + (d === 90 ? ' on' : '') + '" data-act="capday" data-v="' + d + '">' + d + ' 天</button>').join('') +
      '</div></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="capsuleadd">封存</button></div>'
    );
  }

  /* ---------------- 分享卡片 ---------------- */
  function openShareCard() {
    sheet('分享卡片', '<div id="shareWrap"><div class="muted">正在生成…</div></div>');
    Plus.shareCard().then(r => {
      const w = $('shareWrap');
      if (!w) return;
      window.__shareURL = r.url;
      w.innerHTML = '<img src="' + r.url + '" style="width:100%;border-radius:14px;display:block" alt="分享卡片">' +
        '<div class="muted" style="margin-top:10px;text-align:center;font-size:12.5px">手机上长按图片即可保存 / 分享</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="sharecardsave">下载图片</button>' +
        '<button class="btn ghost" data-act="sharecardtext">复制文案</button></div>';
    });
  }

  /* ---------------- CSV 导入 ----------------
   * 认两种表：Loop 的宽表（第一列日期，其余每列一个习惯）
   * 和本产品自己导出的长表（date,habit,type,value,unit,status,note,schema）。
   * 后者按列名取值，所以「导出 → 导回」能一字不差地闭环。 */
  function openImportCSV() {
    sheet('从其他 App 导入',
      '<div class="muted" style="margin-bottom:10px">支持 <b>Loop Habit Tracker</b> 导出的两种 CSV：' +
      '宽表（第一列日期，其余每列一个习惯，单元格填 1 / ✓ 表示完成）和长表（<b>Date,Habit,Value</b>，一行一次记录）。' +
      'Habitica 等同格式的导出也能用。</div>' +
      '<div class="muted" style="margin-bottom:10px">也支持<b>本产品导出的 CSV 表格</b>（表头是 date,habit,type,value,unit,status,note）：把「我的 → 导出 CSV 表格」存下来的文件直接导回来，记录、数值、备注原样还原。</div>' +
      '<textarea class="input" id="csvText" style="min-height:150px;font-family:ui-monospace,Consolas,monospace;font-size:12px" placeholder="Date,跑步,读书&#10;2026-01-01,1,0&#10;2026-01-02,1,1"></textarea>' +
      '<div id="csvPreview" style="margin-top:10px"></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="csvparse">预览</button>' +
      '<button class="btn ghost" data-act="csvpick">选择 CSV 文件</button></div>' +
      '<div class="muted" style="margin-top:10px">导入只做「新增」：同名习惯会沿用，历史打卡会补进去，不会覆盖你现有的数据。</div>'
    );
  }
  function csvPreview(text) {
    const r = Plus.parseCSV(text);
    const el = $('csvPreview');
    if (!el) return r;
    if (!r.habits.length) { el.innerHTML = '<div class="muted">没认出数据：需要第一列是日期（2026-01-01），其余列是习惯名。</div>'; return r; }
    el.innerHTML = '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
      '<div style="font-weight:650;margin-bottom:6px">识别到 ' + r.habits.length + ' 个习惯 · ' +
      r.rows + (r.kind === 'long' ? ' 条记录' : ' 天记录') + '</div>' +
      r.habits.slice(0, 8).map(h => '<div class="kv"><span>' + E(h.name) + '</span><b>' +
        (h.recs ? h.recs.length + ' 条' : h.dates.length + ' 次') + '</b></div>').join('') +
      '<div class="row" style="margin-top:10px"><button class="btn" data-act="csvimport">确认导入</button></div></div>';
    return r;
  }

  function cmdRow(title, url, tip) {
    return '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:8px">' +
      '<div style="font-weight:650;font-size:13px">' + E(title) + '</div>' +
      '<div class="muted" style="word-break:break-all;font-size:12px;margin:4px 0 8px">' + E(url) + '</div>' +
      (tip ? '<div class="muted" style="font-size:12px;margin-bottom:8px">' + E(tip) + '</div>' : '') +
      '<button class="btn sm ghost" data-act="copyurl" data-url="' + E(url) + '">复制链接</button></div>';
  }

  function openShortcut() {
    const base = location.origin + location.pathname;
    sheet('快捷指令 & URL',
      '<div class="muted">复制下面任意一条链接，粘到 iOS「快捷指令」的「打开 URL」、n8n / Home Assistant 的 Webhook，就能从外部触发打卡。</div>' +
      cmdRow('打开今日页', base + '#today') +
      cmdRow('打卡某个习惯', Plugins.cmdUrl({ do: 'tick', name: '喝水' }), '把 name= 后面的名字换成你的习惯名') +
      cmdRow('记一个数值', Plugins.cmdUrl({ do: 'val', name: '跑步', v: 30 })) +
      cmdRow('执行套餐', Plugins.cmdUrl({ do: 'bundle', name: '晨间仪式' })) +
      cmdRow('写一句笔记', Plugins.cmdUrl({ do: 'note', text: '今天状态不错' })) +
      cmdRow('读取今日状态', Plugins.cmdUrl({ do: 'status' }), '打开后页面会显示并复制状态 JSON') +
      cmdRow('触发一次云同步', Plugins.cmdUrl({ do: 'sync' })) +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="cmdgen">按我的习惯生成</button>' +
      '<button class="btn ghost" data-act="copystatus">复制今日状态</button></div>' +
      '<div class="muted" style="margin-top:10px">iOS：快捷指令 → 新建 → 添加「打开 URL」→ 粘贴 → 可加到主屏幕，或设成自动化（如每天 22:00 自动打卡「早睡」）。</div>'
    );
  }

  function openHealth() {
    sheet('从健康 App 导入',
      '<div class="muted">手机、手环记的<b>步数、睡眠、锻炼时长</b>不用手打：导进来，按「一天够不够」自动补打卡。</div>' +
      '<div class="muted" style="margin-top:8px;font-size:12.5px;line-height:1.7">' +
      '· iPhone：健康 App → 右上角头像 → 导出所有健康数据 → 解压，选里面的 <b>export.xml</b><br>' +
      '· 更省事：装 <b>Health Auto Export</b>，导出一份 JSON<br>' +
      '· Google Fit Takeout、小米 / 华为运动健康导出的 CSV 也认' +
      '</div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="healthpick">选择文件</button>' +
      '<button class="btn ghost" data-act="healthpaste">粘贴文本</button></div>' +
      '<div id="healthPaste" style="display:none;margin-top:10px">' +
      '<textarea class="input" id="hText" style="min-height:100px;font-family:ui-monospace,Consolas,monospace;font-size:12px" placeholder="粘贴 CSV / JSON…"></textarea>' +
      '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="healthparse">解析</button></div>' +
      '</div>' +
      '<div id="healthPreview"></div>' +
      '<div class="muted" style="margin-top:10px;font-size:12px">只补空缺：你自己打过卡的日子不会被改，也不会因此涨积分 —— 补历史不算「今天做到了」。</div>' +
      healthAutoCardHTML()
    );
  }

  /* 自动勾选现状（v47）：告诉用户「数据新不新、有几条规则在跑」。
   * 这一块的存在感要低（灰色小字），但必须有 —— 否则「设了规则却没反应」时无处可查。 */
  function healthAutoCardHTML() {
    if (!window.Health) return '';
    const rules = Health.autoList();
    const at = Health.lastImportAt();
    const when = at ? (new Date(at).getMonth() + 1) + '/' + new Date(at).getDate() : '';
    return '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:10px">' +
      '<div style="font-weight:650;font-size:13px">自动勾选</div>' +
      '<div class="muted" style="font-size:12.5px;line-height:1.7;margin-top:4px">' +
      (rules.length
        ? ('有 <b>' + rules.length + '</b> 条习惯设了自动勾选：' + rules.slice(0, 3).map(r => E(r.name)).join('、') +
          (rules.length > 3 ? ' 等' : '') + '。<br>每次打开都会按最新数值判一次，达标就自动完成。')
        : '还没有习惯开启。编辑习惯时可以选「健康数据自动勾选」，例如「步数 ≥ 8000 自动完成」。') +
      (at ? '<br>最近一次导入：' + when + '（只留最近 120 天的按天数值）' : '') +
      '</div>' +
      (rules.length ? '<div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="healthauto">现在检查一次</button></div>' : '') +
      '</div>';
  }

  /* 指标卡：每个指标一张，选目标习惯 + 门槛。门槛就是「一天多少算完成」，
   * 步数 8000、睡眠 7 小时、锻炼 30 分钟是常见口径，用户可改。 */
  function healthMetricsHTML(ms) {
    const items = (S().items || []).filter(i => !i.deleted && !i.archived);
    if (!ms || !ms.length) {
      return '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:10px">' +
        '<div style="font-weight:650">没认出数据</div>' +
        '<div class="muted" style="margin-top:6px;font-size:12.5px;line-height:1.7">' +
        'Apple 健康导出的是一个 zip，请先解压，选里面的 <b>export.xml</b>（别选 zip 本身）。<br>' +
        'CSV 至少要有「日期」列和一个数值列。' +
        '</div></div>';
    }
    const total = ms.reduce((a, m) => a + m.count, 0);
    return '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:10px">识别到 <b>' + ms.length + '</b> 个指标，共 <b>' + total + '</b> 天数据</div>' +
      ms.map((m, i) =>
        '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">' +
        '<div style="font-weight:650">' + E(m.label) +
        (m.unit ? '<span class="muted" style="font-weight:400;font-size:12px">（' + E(m.unit) + '）</span>' : '') + '</div>' +
        '<div class="muted" style="font-size:12px;white-space:nowrap">' + m.count + ' 天</div>' +
        '</div>' +
        '<div class="muted" style="font-size:12px;margin-top:4px">' + E(m.from) + ' ~ ' + E(m.to) +
        ' · 日均 ' + U.numShort(m.avg) + ' · 合计 ' + U.numShort(m.total) + '</div>' +
        '<div class="field" style="margin-top:8px"><label>写进哪个习惯</label>' +
        '<select class="input" id="hItem_' + i + '"><option value="new">新建「' + E(m.label) + '」习惯</option>' +
        items.map(it => '<option value="' + E(it.id) + '">' + E(it.name) + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>一天超过多少算完成' +
        (m.agg === 'avg' ? '（心率、体重这类留 0：有记录就算）' : '') + '</label>' +
        '<input class="input" id="hThr_' + i + '" type="number" inputmode="decimal" value="' + (m.thr || 0) + '"></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="healthapply" data-idx="' + i + '">导入这 ' + m.count + ' 天</button></div>' +
        '</div>'
      ).join('') +
      (ms.length > 1 ? '<div class="row" style="margin-top:10px"><button class="btn" data-act="healthall">全部导入</button></div>' : '');
  }

  function openExport() {
    sheet('导出到笔记',
      '<div class="muted">把打卡日记导成文件，丢进 Obsidian、印象笔记或任何 Markdown 编辑器。</div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-act="exportmd">Markdown 日记</button></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn ghost" data-act="exportobs">Obsidian 格式</button>' +
      '<button class="btn ghost" data-act="exportcsv">CSV 表格</button></div>' +
      '<div class="muted" style="margin-top:10px">Markdown 版会把云端照片换成直链（有效期 1 小时）。</div>'
    );
  }

  function openApi() {
    const j = JSON.stringify(Plugins.statusJSON(), null, 2);
    sheet('开放接口',
      '<div class="muted">任何能「打开网页 / 发 HTTP 请求」的应用都能用这些命令，例如 iOS 快捷指令、Android 宏、n8n、IFTTT、Home Assistant、Raycast。</div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:10px;font-size:12.5px">' +
      '<b>命令格式</b><br>' + E(Plugins.cmdUrl({ do: 'tick', name: '习惯名' })) +
      '<br><br><b>do 可选值</b><br>tick 打卡 / check 同 tick<br>val 记数值（需 v=）<br>bundle 跑套餐<br>' +
      'note 写笔记（需 text=）<br>status 今日状态<br>sync 云同步<br><br>' +
      '<b>参数</b>：name 习惯名或套餐名 · v 数值 · text 笔记文字</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="copystatus">复制今日状态 JSON</button>' +
      '<button class="btn sm ghost" data-act="plg_shortcut">生成链接</button></div>' +
      '<pre style="font-size:12px;white-space:pre-wrap;background:var(--bg-2);padding:10px;border-radius:8px;margin-top:10px">' + E(j) + '</pre>'
    );
  }

  /* ---------------- 房间 ---------------- */
  function renderRooms() {
    const st = S();
    const p = Rooms.profile();
    const rooms = Rooms.myRooms();
    const code = Rooms.activeCode();
    const cur = Rooms.findRoom(code);
    let html = '';

    html += '<div class="card"><div style="display:flex;align-items:center;gap:12px">' +
      '<div class="av" style="width:46px;height:46px;border-radius:50%;background:var(--accent-soft);display:grid;place-items:center;font-size:24px">' + E(p.emoji) + '</div>' +
      '<div style="flex:1"><div style="font-weight:650">' + E(p.nickname || '还没设置昵称') + '</div>' +
      '<div class="muted">' + (Rooms.isAnon() ? '尚未登录 · 好友房间需要登录' : '已登录 · 以云端同步状态为准') +
      ' · 今日 ' + Engine.todayRate(U.today()).done + '/' + Engine.todayRate(U.today()).total + '</div></div>' +
      '<button class="btn sm ghost" data-act="roomprofile">修改</button></div></div>';

    /* 先是可经营的小屋（打卡积分买家具），再是和朋友一起的房间 */
    html += '<details class="v19-home"><summary>我的小屋 · 积分装扮</summary>' + roomHomeHTML() + '</details>';

    html += '<div class="v19-page-title"><h1>和朋友一起，坚持一点</h1><p>分享自己选中的习惯，给彼此一点动力。</p></div>';
    if (window.Friends) html += Friends.archiveHTML();
    html += '<div class="sec-title"><h3>搭子房间</h3></div>';
    if (rooms.length) {
      html += '<div class="card">' + rooms.map(r =>
        '<div class="line-cell' + (r.code === code ? ' on' : '') + '" data-act="switchroom" data-code="' + E(r.code) + '">' +
        '<span style="font-size:18px">' + E(r.emoji || '🏠') + '</span>' +
        '<div style="flex:1"><div class="k">' + E(r.name || r.code) + (r.owner ? ' <span class="muted">· 房主</span>' : '') + '</div>' +
        '<div class="s">房间码 ' + E(r.code) + (r.visibility === 'public' ? ' · 公开' : ' · 私密') + '</div></div>' +
        '<span class="muted">' + (r.code === code ? '当前' : '›') + '</span></div>').join('') + '</div>';
    } else {
      html += '<div class="card"><div class="muted">还没有加入任何房间。建一个房间，把房间码或链接发给朋友，大家就能在同一个房间里打卡排名。</div></div>';
    }

    html += '<div class="card"><div class="row">' +
      '<button class="btn" data-act="roomcreate">＋ 建房间</button>' +
      '<button class="btn ghost" data-act="roomjoin">输房间码</button>' +
      '<button class="btn ghost" data-act="roomplaza">公开广场</button></div></div>';

    if (cur) {
      html += '<div class="sec-title"><h3>' + E(cur.name || '房间') + ' · 邀请</h3></div>';
      html += '<div class="card">' +
        '<div style="display:flex;align-items:center;gap:10px"><div style="flex:1"><div class="k">房间码</div>' +
        '<div style="font-size:22px;font-weight:700;letter-spacing:3px" id="roomCodeText">' + E(cur.code) + '</div></div>' +
        '<button class="btn sm ghost" data-act="roomcopycode">复制</button></div>' +
        '<div class="card" style="box-shadow:none;background:var(--bg-2);word-break:break-all;font-size:12px;margin-top:10px" id="roomInviteLink">' + E(Rooms.inviteLink(cur.code)) + '</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-act="roomcopylink">复制邀请链接</button>' +
        '<button class="btn sm ghost" data-act="roomsync">同步我的成绩</button></div>' +
        '<div class="line-cell" style="border:none"><div><div class="k">公开到广场</div>' +
        '<div class="s">打开后陌生人能在广场看到并加入</div></div>' +
        '<button class="sw' + (cur.visibility === 'public' ? ' on' : '') + '" data-act="roompublic"' + (cur.owner ? '' : ' disabled aria-label="仅房主可修改公开状态"') + '><i></i></button></div>' +
        '<div class="row" style="margin-top:6px">' + (cur.owner ? '' : '<button class="btn sm danger ghost" data-act="roomleave">退出房间</button>') +
        (cur.owner ? '<button class="btn sm danger ghost" data-act="roomdissolve">归档房间</button>' : '') + '</div>' +
        '</div>';
    }

    if (window.Friends) html += Friends.section(cur);
    html += '<div class="sec-title"><h3>排行榜 · 今日</h3></div>';
    html += '<div class="card" id="roomRank"><div class="muted">正在拉取…</div></div>';
    setTimeout(() => paintRoomRank('#roomRank'), 60);

    html += '<div class="muted" style="padding:14px 4px 4px;text-align:center">' +
      '每个人各用各的设备和账号，数据互不干扰；同房间成员可看到昵称、今日完成率、连续天数和积分，以及你主动共享的习惯；日记与附件保持私密。</div>';
    return html;
  }

  /* v38 · 外部评审 P0-5：排行榜不能永远停在「正在拉取…」。
   * 三条终态必须齐全：① 没登录 → 说清要账号 + 去登录；② 没房间 → 引导建/加入；
   * ③ 拉取失败或超时 → 给重试。之前只有第 ② 条，未登录时 rpc 卡在云 SDK 加载上，
   * 页面就一直转 —— 用户看到的是「坏了」，而不是「需要登录」。 */
  function signedInCloud() {
    try { return !!(window.Cloud && Cloud.signedIn && Cloud.signedIn()); } catch (e) { return false; }
  }
  function raceTimeout(p, ms) {
    return Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
  }
  async function paintRoomRank(sel) {
    const box = $(String(sel || '#roomRank').replace('#', ''));
    if (!box) return;
    if (!signedInCloud()) {
      box.innerHTML = '<div class="muted">房间排行需要一个账号来认人。登录云空间后，才能看到同房间成员的完成率和连续天数。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="goconnect">去登录</button></div>';
      return;
    }
    const code = Rooms.activeCode();
    if (!code) { box.innerHTML = '<div class="muted">还没有加入房间，先建一个或输入朋友的房间码</div>'; return; }
    box.innerHTML = '<div class="muted">正在拉取…</div>';
    const r = await raceTimeout(Rooms.ranking(code), 8000);
    if (!box.isConnected || code !== Rooms.activeCode()) return;
    if (!r) {
      box.innerHTML = '<div class="muted">拉取超时，可能是网络不好。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-act="rankretry">重试</button></div>';
      return;
    }
    if (!r.ok) {
      box.innerHTML = '<div class="muted">' + E(r.msg || '拉取失败') + '</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-act="rankretry">重试</button></div>';
      return;
    }
    if (!r.list.length) { box.innerHTML = '<div class="muted">房间里还没有人，把房间码发给朋友吧</div>'; return; }
    box.innerHTML = r.list.map((m, i) =>
      '<div class="rank' + (m.me ? ' me' : '') + '"><div class="medal">' + (['🥇', '🥈', '🥉'][i] || (i + 1)) + '</div>' +
      '<div class="av">' + E(m.emoji || '🙂') + '</div>' +
      '<div class="nm">' + E(m.name) + (m.me ? ' <span class="muted">（我）</span>' : '') +
      (m.stale ? ' <span class="muted">· 未更新</span>' : '') + '</div>' +
      '<div class="pc">' + m.rate + '% · 连续 ' + m.streak + ' 天 · ' + m.points + '分</div></div>').join('');
  }

  function openRoomProfile() {
    const p = Rooms.profile();
    const EMO = ['🙂', '😎', '🐱', '🐶', '🦊', '🐼', '🌱', '🔥', '⭐', '🌙'];
    sheet('我的身份',
      '<div class="field"><label>昵称</label><input class="input" id="roomNick" data-max="12" value="' + E(p.nickname) + '" placeholder="房间里显示的名字"></div>' +
      '<div class="field"><label>头像</label><div class="chips" id="roomEmoChips">' +
      EMO.map(e => '<button class="chip' + (p.emoji === e ? ' on' : '') + '" data-act="roomemo" data-v="' + e + '">' + e + '</button>').join('') +
      '</div></div>' +
      '<div class="row"><button class="btn" data-act="roomsaveprofile">保存</button></div>' +
      '<div class="muted" style="margin-top:10px">好友房间需要登录。昵称用于房间展示；个人记录是否已跨设备保存，请查看云同步状态。</div>'
    );
  }

  function openRoomCreate() {
    sheet('建一个房间',
      '<div class="field"><label>房间名</label><input class="input" id="rcName" data-max="20" value="我的房间"></div>' +
      '<div class="field"><label>一句话简介（可选）</label><input class="input" id="rcIntro" data-max="60" placeholder="比如：早起打卡小队"></div>' +
      '<div class="field"><label>图标</label><div class="chips" id="rcEmoChips">' +
      ['🏠', '🌅', '💪', '📚', '🧘', '🏃', '🎯', '🌙'].map((e, i) =>
        '<button class="chip' + (i === 0 ? ' on' : '') + '" data-act="rcemo" data-v="' + e + '">' + e + '</button>').join('') +
      '</div></div>' +
      '<div class="line-cell"><div><div class="k">公开到广场</div><div class="s">打开后任何人都能在广场找到并加入</div></div>' +
      '<div class="sw" id="rcPublic" data-act="rcpublic"><i></i></div></div>' +
      '<p class="v19-privacy">房间默认私密。成员可看到昵称与汇总成绩；具体习惯由你另行选择共享。</p><div class="row" style="margin-top:12px"><button class="btn" data-act="roomdocreate">创建</button></div>'
    );
  }

  function openRoomJoin() {
    sheet('加入房间',
      '<div class="field"><label>房间码</label><input class="input" id="rjCode" placeholder="6 位字母数字" maxlength="6" style="letter-spacing:4px;font-size:20px;text-transform:uppercase"></div>' +
      '<p class="v19-privacy">加入后，同房间成员可看到你的昵称、今日完成率、连续天数和积分。具体习惯默认不共享，可随后单独选择；日记与附件不共享。</p><div class="row"><button class="btn" data-act="roomdojoin">确认加入</button></div>' +
      '<div class="muted" style="margin-top:10px">房间码朋友可以在「房间」页的邀请卡片里找到，也可以直接点他发给你的邀请链接。</div>'
    );
  }

  async function openPlaza() {
    sheet('公开广场', '<div class="muted">正在加载…</div>');
    const r = await Rooms.plaza();
    const body = $('sheetBody');
    if (!r.ok) { body.innerHTML = '<div class="muted">' + E(r.msg || '加载失败') + '</div>'; return; }
    if (!r.list.length) {
      body.innerHTML = '<div class="muted">广场上还没有公开房间。你可以把自己的房间设为公开，它就会出现在这里。</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="roomcreate">去建房间</button></div>';
      return;
    }
    body.innerHTML = '<div class="muted">这些房间公开可加入，点进去即可。</div>' +
      '<div class="card" style="margin-top:10px">' + r.list.map(x =>
        '<div class="line-cell" data-act="plzjoin" data-code="' + E(x.code) + '">' +
        '<span style="font-size:18px">' + E(x.emoji) + '</span>' +
        '<div style="flex:1"><div class="k">' + E(x.name) + '</div>' +
        '<div class="s">' + E(x.intro || ('房间码 ' + x.code)) + ' · ' + x.count + ' 人</div></div>' +
        '<span class="muted">' + (x.joined ? '已加入' : '加入 ›') + '</span></div>').join('') + '</div>';
  }

  /* ---------------- 习惯详情 ---------------- */
  function miniStat(b, s) {
    return '<div class="stat" style="box-shadow:none;background:var(--bg-2)"><b>' + b + '</b><span>' + s + '</span></div>';
  }

  /* 完成率趋势图：按天数取 rolling 数据后交给 Chart.line 画。
   * 注意要先 slice 到目标天数：rolling 需要 7 天窗口的历史才能算出第一个点，
   * 所以取的数据要比展示的天数多一点，取完再截尾，否则"近 30 天"会画出 60 天。 */
  function trendChartHTML(id, days) {
    if (!window.Chart) return '';
    const heat = Engine.itemHeat(id, Math.max(days + 10, 60));
    const rows = Chart.rolling(heat, 7).slice(-days);
    const it = (S().items || []).find(x => x.id === id);
    return Chart.line(rows, { label: (it ? it.name + ' ' : '') + '近 ' + days + ' 天完成率趋势' });
  }

  /* 切换时间范围：只重画趋势图容器，面板其它部分不动 */
  function repaintTrendChart(el) {
    const host = $('habitChart');
    if (!host || !el) return;
    host.innerHTML = trendChartHTML(el.dataset.id, +el.dataset.days || 30);
    document.querySelectorAll('[data-act="chartrange"]').forEach(b =>
      b.setAttribute('aria-pressed', String(b === el)));
  }

  /* ---------- 单次打卡备注（v27 · 4.3）----------
   * 一行输入、可跳过：目标是「打卡 + 一句话」三秒内完成，不打断连续打卡的节奏。
   * 不做成必填弹窗 —— 那会把顺手打卡变成一道手续。 */
  function openNoteSheet(itemId, date, from) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return;
    const d = date || U.today();
    const cur = Engine.noteOf(itemId, d);
    const done = Engine.isDone(it, d);
    sheet('给这次打卡记一句',
      '<div class="muted" style="margin-bottom:10px">' + E(it.name) + ' · ' + E(U.prettyDate(d)) +
      (done ? ' · 已完成' : ' · 还没打卡') + '</div>' +
      '<input class="input" id="noteInput" maxlength="' + Engine.NOTE_MAX + '" ' +
      'placeholder="比如：跑了 5 公里 / 读了 30 页 / 今天只做了 10 分钟" value="' + E(cur) + '" aria-label="这次打卡的备注">' +
      '<div class="muted" style="margin-top:6px;font-size:12px">可跳过。写下来的这句会出现在当天时间轴和年度回顾里。</div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn" data-act="savenote" data-id="' + itemId + '" data-d="' + d + '" data-from="' + E(from || '') + '">保存</button>' +
      '<button class="btn ghost" data-act="closenote">跳过</button></div>');
    setTimeout(() => { const el = $('noteInput'); if (el) el.focus({ preventScroll: true }); }, 60);
  }

  /* 最小版本（v28 · 4.4）：一句话就够，别让用户在这里写计划书 */
  function openMiniSheet(itemId) {
    const it = (S().items || []).find(x => x.id === itemId);
    if (!it) return;
    const cur = Engine.miniOf(it);
    const samples = it.type === 'duration' || (it.target && it.unit)
      ? ['只做 1 分钟', '做到一半也算']
      : ['只做 1 页', '只做 1 个', '只做 1 分钟'];
    sheet('最小版本',
      '<div class="muted" style="margin-bottom:10px">' + E(it.name) + ' · 做不到时，只做这一点也算完成。</div>' +
      '<input class="input" id="miniInput" maxlength="30" placeholder="比如：读 1 页 / 走 5 分钟 / 3 次呼吸" value="' + E(cur) + '" aria-label="最小版本内容">' +
      '<div class="row" style="margin-top:8px">' + samples.map(s =>
        '<button class="chip" data-act="minipick" data-v="' + E(s) + '">' + E(s) + '</button>').join('') + '</div>' +
      '<div class="muted" style="margin-top:10px;font-size:12px">做到最小版本：算完成、不断签，强度分只记一半。留空就取消最小版本。</div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn" data-act="savemini" data-id="' + itemId + '">保存</button>' +
      '<button class="btn ghost" data-act="closenote">取消</button></div>');
    setTimeout(() => { const el = $('miniInput'); if (el) el.focus({ preventScroll: true }); }, 60);
  }

  function openHabitDetail(id) {
    const dt = Extra.habitDetail(id);
    if (!dt) return;
    /* 心情和颜色按类型分开：打卡型的好是绿色的安全感，戒断型的好是「还没破戒」的警觉 */
    const isAvoid = dt.kind === 'avoid';
    const ageDays = Math.floor((Date.now() - (dt.item.createdAt || 0)) / 86400000);
    const lv = ageDays < 7 ? { txt: '起步期', color: 'var(--txt-3)' } : Extra.scoreLevel(dt.score, dt.kind);
    let html = '<button class="btn sm ghost v19-habit-share" data-friend="habit" data-id="' + E(id) + '">设置好友共享</button>';
    /* 先把自己当初写下的理由摆在最上面：这是打开详情页最该看到的东西 */
    if (dt.item.why) {
      html += '<div class="why-box"><div class="why-q">我为什么要坚持它</div>' +
        '<div class="why-a">“' + E(dt.item.why) + '”</div>' +
        '<button class="why-e" data-act="openhabit" data-id="' + id + '">修改这句话</button></div>';
    }
    /* 「什么时候做」：没填的时候给一句可点击的提示 —— 这是最容易补、效果最明显的一项 */
    if (dt.item.cue) {
      html += '<div class="cf-sub" style="margin:-4px 0 10px">什么时候做：<b>' + E(dt.item.cue) + '</b></div>';
    } else {
      html += '<div class="cf-sub" style="margin:-4px 0 10px">还没写「什么时候做」。' +
        '<button class="linkbtn" data-act="openhabit" data-id="' + id + '">补一句</button>' +
        ' —— 绑上具体场景（比如「洗漱后」），比记着「要运动」管用得多。</div>';
    }
    /* 健康数据自动勾选（v47）：规则 + 最近数值 + 手动跑一次。
     * 放在「什么时候做」之后、强度卡之前 —— 它和「什么时候做」同属"这条习惯怎么运转"。 */
    if (window.Health && dt.item.autoHealth && dt.item.autoHealth.key) {
      const rule = dt.item.autoHealth;
      const hd = Health.defOf(rule.key);
      const last = Health.latestOf(rule.key);
      html += '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:8px">' +
        '<div class="kv"><span>健康数据自动勾选</span><b>' + E(Health.ruleText(rule)) + '</b></div>' +
        '<div class="kv"><span>最近一次数据</span><b>' +
        (last ? (last.d.slice(5).replace('-', '/') + ' · ' + last.v + (hd.unit || '')) : '还没导入过') + '</b></div>' +
        '<div class="row end" style="margin-top:8px"><button class="btn sm ghost" data-act="healthauto">现在检查一次</button></div>' +
        '</div>';
    }

    html += '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
      '<div style="display:flex;align-items:center;gap:10px"><div style="flex:1"><div style="font-weight:650">' +
      (isAvoid ? '戒断强度' : '习惯强度') + '</div>' +
      '<div class="muted">' + (isAvoid
        ? '按连续未破戒天数计算；破戒会重置连胜，历史最佳保留'
        : '按长期稳定性计算，漏一天不会归零') + '</div></div>' +
      '<div style="text-align:right"><div style="font-size:26px;font-weight:700;color:' + lv.color + '">' + dt.score + '</div>' +
      '<div class="muted">' + lv.txt + '</div></div></div>' +
      '<div class="h-bar" style="margin-top:8px"><i style="width:' + dt.score + '%"></i></div></div>' +
      /* v57 · 细节审计（对标连击心理学「逐步撤出外部激励 / 行为迁移」）：
       * 提醒维度 v50 的 maturity 已经做了（做得稳 → 提醒闭嘴）；这里是叙事的另一半 ——
       * 到「牢固」后不再堆激励，改说「它已经是你的一部分」，把动力交还给用户自己。 */
      (lv.txt === '牢固' ? '<div class="muted" style="font-size:12px;margin-top:8px;line-height:1.7">它已经长在生活里了 —— 到这一步，偶尔漏几天也撼不动它。接下来不用天天盯着，让它自己长。</div>' : '') +
      (lv.txt === '稳住了' ? '<div class="muted" style="font-size:12px;margin-top:8px;line-height:1.7">已经稳住了 —— 到这一步，偶尔一次反复也撼不动它。警觉可以慢慢放下，习惯还在。</div>' : '');

    /* 戒断型：把四类日子数摆出来。口径写在脸上，用户才不用猜「我今天算成功还是失败」 */
    if (isAvoid && dt.avoid) {
      const a = dt.avoid;
      html += '<div class="avoid-explain">' +
        '近 ' + a.days + ' 天：<b>忍住 ' + a.kept + ' 天</b>、<b>破戒 ' + a.slip + ' 次</b>' +
        (a.exempt ? '、请假 ' + a.exempt + ' 天' : '') +
        '<br>破戒会清零「连续未破戒」，但历史最佳 ' + a.bestClean + ' 天不会被抹掉。</div>';
    }

    /* 连击 + 里程碑：纪录写清楚，离下一级还差多少也写清楚 */
    const ms = window.Extra && Extra.milestoneOf
      ? Extra.milestoneOf(dt.item, isAvoid && dt.avoid ? dt.avoid.bestClean : undefined)
      : null;
    const unit = Engine.streakUnit(dt.item);
    const rl = Engine.rateLabel(id, 30);
    /* 戒断型的三个数字换口径：未破戒天数 / 最佳未破戒 / 破戒次数。
     * 用「连续打卡」会误导 —— 破戒那天本来就不该有打卡记录。 */
    const stat1 = isAvoid && dt.avoid
      ? miniStat(dt.avoid.clean + '<small style="font-size:12px">天</small>', '未破戒')
      : miniStat(dt.streak + '<small style="font-size:12px">' + unit + '</small>', '连续');
    const stat2 = isAvoid && dt.avoid
      ? miniStat(dt.avoid.bestClean + '<small>天</small>', '最佳纪录')
      : miniStat(dt.best + '<small>' + unit + '</small>', '最佳纪录');
    const stat3 = isAvoid && dt.avoid
      ? miniStat(dt.avoid.slip + '<small>次</small>', '近 30 天破戒')
      /* 样本不足 7 天不给百分比：1 天 100% 会被读成「30 天全勤」（复检 5.2） */
      : (rl.enough
        ? miniStat(rl.pct + '%', '近 30 天')
        : miniStat(rl.days + '<small>天</small>', '数据天数'));
    html += '<div class="grid3" style="gap:8px;margin-top:10px">' + stat1 + stat2 + stat3 + '</div>';
    /* 累计做到多少次（v49）：三个格子里最容易被忽略的就是「断过几次」以外的东西，
     * 而断签那天唯一能证明「我没白做」的就是这个只增不减的数。
     * 60 次是参考线（Lally 的研究里习惯平均 66 天成型、Not Boring 干脆用「完成 60 次」当目标）。 */
    const doneN = Engine.doneCount ? Engine.doneCount(id) : 0;
    if (doneN) {
      html += '<div class="muted" style="margin-top:8px;font-size:12px;line-height:1.6">从开始到现在，一共做到 <b style="color:var(--txt)">' +
        doneN + '</b> 次' + (doneN < 60 ? ' —— 做到 60 次左右，它就基本长在身上了。' : '。') + '</div>';
    }
    if (ms) {
      /* 戒断型的纪录叫「未破戒」，不叫「连续」—— 破戒那天本来就不该有打卡记录 */
      const msWord = isAvoid ? '未破戒' : '连续';
      html += '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:8px">' +
        '<div class="kv"><span>下一个里程碑</span><b>' + (ms.next ? '距离' + msWord + ' ' + ms.next.n + ' ' + unit : '全部达成') + '</b></div>' +
        (ms.next ? '<div class="kv"><span>还差</span><b>' + ms.need + ' ' + unit + '</b></div>' +
          '<div class="h-bar" style="margin-top:8px"><i style="width:' + ms.pct + '%"></i></div>' : '') +
        '</div>';
    }

    /* ---------- 历史连续段（v45）----------
     * 「最佳 12 天」只是一个数字；「3/2–3/13、5/4–5/12、本周还在走」才是能回看的实证。
     * 只在按天计的普通习惯上出现：周频次的段单位是周、戒断型的纪录叫「未破戒」，口径不同不混排。 */
    if (!isAvoid && unit === '天' && Engine.streakRuns) {
      const runs = Engine.streakRuns(id, 3).filter(r => r.n >= 2);
      if (runs.length) {
        const fmt = r => r.from.slice(5).replace('-', '/') + (r.from === r.to ? '' : '–' + r.to.slice(5).replace('-', '/'));
        html += '<div class="ch-card-title" style="margin:16px 0 6px"><h3>最长的几段</h3><span>历史前三</span></div>' +
          '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
          runs.map((r, i) => '<div class="kv"' + (i ? ' style="margin-top:6px"' : '') + '>' +
            '<span>' + ['①', '②', '③'][i] + ' ' + E(fmt(r)) + '</span>' +
            '<b>' + r.n + ' 天</b></div>').join('') +
          '<div class="muted" style="margin-top:8px;font-size:12px;line-height:1.6">' +
          '这些是你已经做到过的事，不是目标 —— 断过一次不代表做不到第二次。</div></div>';
      }
    }

    /* ---------- 强度变化（v27 · 4.2）----------
     * 强度分原来只有一个当前值，用户看不到它是怎么变的。
     * 一条 90 天曲线能把「漏几天只是变弱、不会清零」这件事直接画出来——
     * 这正是本产品与「断链焦虑」类产品最核心的差异，也是 Loop 的 Habit score 的做法。 */
    const series = Extra.scoreSeries ? Extra.scoreSeries(id, 90) : [];
    html += '<div class="ch-card-title" style="margin:16px 0 6px"><h3>' +
      (isAvoid ? '戒断强度变化' : '强度变化') + '</h3><span>近 90 天</span></div>' +
      '<div class="card chart-card">' +
      Chart.line(series, {
        label: E(dt.item.name) + ' 近 90 天' + (isAvoid ? '戒断强度' : '习惯强度'),
        target: null,
        cls: isAvoid ? 'ch-avoid' : ''
      }) +
      '<div class="ch-hint">' + (isAvoid
        ? '纵轴是强度分，不是连胜：连续未破戒越久越高，破戒会掉下来但历史最佳不会被抹掉。'
        : '纵轴是强度分，不是连胜：漏几天只会让它变弱，不会清零。') + '</div></div>';

    /* ---------- 完成率趋势（30 / 90 天切换） ----------
     * 单日完成率只有 0 / 100，画出来是一排针；用 7 天滚动窗口才能读出趋势。
     * 切换按钮走 data-act 委托，只重画 #habitChart 这一块，不重建整个面板。 */
    html += '<div class="ch-card-title" style="margin:16px 0 6px"><h3>完成率趋势</h3>' +
      '<div class="p-segments" role="group" aria-label="选择时间范围">' +
      [30, 90].map(d => '<button data-act="chartrange" data-days="' + d + '" data-id="' + id + '" aria-pressed="' + (d === 30) + '">近 ' + d + ' 天</button>').join('') +
      '</div></div>' +
      '<div class="card chart-card" id="habitChart">' + trendChartHTML(id, 30) + '</div>';

    /* ---------- 本月日历点阵：一格一天，颜色深浅 = 完成程度 ---------- */
    html += '<div class="ch-card-title" style="margin:16px 0 6px"><h3>本月日历点阵</h3><span>' + E(U.today().slice(0, 7).replace('-', ' 年 ') + ' 月') + '</span></div>' +
      '<div class="card chart-card">' + Chart.monthMatrix(Chart.monthCells(id, U.today().slice(0, 7)), { label: E(dt.item.name) + ' 本月完成情况' }) + '</div>';

    /* 一年 365 天：GitHub 贡献图那种，点格子看那天 / 补卡 */
    html += yearHeatHTML(dt.item, 365);

    html += '<div class="sec-title"><h3>近 10 周</h3></div>' +
      '<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:3px">' +
      dt.calendar.map(x => {
        const cls = x.done ? 'l4' : (x.sk ? 'l1' : 'l0');
        return '<i class="' + cls + '" style="' + (x.due ? '' : 'opacity:.3') + '" title="' + x.date + (x.done ? ' 已完成' : x.sk ? ' 请假' : ' 未完成') + '"></i>';
      }).join('') + '</div>';

    html += '<div class="sec-title"><h3>一周分布</h3></div><div class="bars">' +
      dt.weekday.map((v, i) => {
        const h = dt.weekdayDue[i] ? Math.max(4, Math.round(v / dt.weekdayDue[i] * 100)) : 4;
        return '<div class="b" style="height:' + h + '%" title="周' + '日一二三四五六'[i] + ' ' + v + '/' + dt.weekdayDue[i] + '"></div>';
      }).join('') + '</div>' +
      '<div class="bars-x">' + dt.weekday.map((_, i) => '<span>周' + '日一二三四五六'[i] + '</span>').join('') + '</div>';

    /* ---------- 最小版本（v28 · 4.4）----------
     * 文档里最狠的一句是「把全有或全无变成有总比没有好」。
     * 所以这里不是一个开关，而是一句用户自己写的话：做不到时，只做这个。 */
    const miniLabel = Engine.miniOf(dt.item);
    html += '<div class="sec-title"><h3>低能量日的最小版本</h3></div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
      (miniLabel
        ? '<div class="kv"><span>做不到时，只做</span><b>' + E(miniLabel) + '</b></div>' +
          '<div class="muted" style="margin-top:6px">做到这一档也算完成、不断签，强度分记一半。</div>'
        : '<div class="muted">还没设。给自己留一条「小到不可能失败」的退路 —— 读书 30 分钟做不到时，「读 1 页」也算数。</div>') +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn sm' + (miniLabel ? ' ghost' : '') + '" data-act="setmini" data-id="' + id + '">' +
      (miniLabel ? '改一下' : '设一个最小版本') + '</button>' +
      (miniLabel && !Engine.isDone(dt.item, U.today())
        ? '<button class="btn sm ghost" data-act="minitoday" data-id="' + id + '">今天只做最小版</button>' : '') +
      '</div></div>';

    /* ---------- 这一次的备注（v28 · 4.5）----------
     * 入口不再只活在「打卡后 3 秒」的撤销条里 —— 那时候用户正在忙别的。
     * 详情页给一个常驻入口，并把写过的句子按时间列出来。 */
    const nts = Engine.notesOf ? Engine.notesOf(id, 5) : { list: [], total: 0 };
    html += '<div class="sec-title"><h3>这一次的备注</h3><span class="more">' + nts.total + ' 条</span></div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
      (nts.list.length
        ? nts.list.map(n => '<div class="hnote"><span class="hn-d">' + U.prettyDate(n.date) + '</span>' +
          '<span class="hn-t">' + E(n.note) + '</span></div>').join('')
        : '<div class="muted">还没有。打卡后顺手写一句，明年回看时最值钱的就是这些。</div>') +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn sm ghost" data-act="notenow" data-id="' + id + '">今天记一句</button></div></div>';

    html += '<div class="sec-title"><h3>累计数据</h3></div>' +
      '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
      '<div class="kv"><span>累计完成</span><b>' + dt.totalDone + ' 次</b></div>' +
      '<div class="kv"><span>应做天数</span><b>' + dt.dueCount + ' 天</b></div>' +
      '<div class="kv"><span>总成功率</span><b>' + dt.rateAll.pct + '%</b></div>' +
      (dt.item.type !== 'check' ? '<div class="kv"><span>累计' + E(dt.item.unit || '数值') + '</span><b>' + U.numShort(dt.totalVal) + '</b></div>' : '') +
      '</div>';

    html += '<div class="row" style="margin-top:12px"><button class="btn ghost" data-act="openhabit" data-id="' + id + '">编辑这个习惯</button></div>';
    sheet(dt.item.name, html);
  }

  /* ---------------- 补卡日历 ---------------- */
  let calMonth = null;
  function openDatePicker(ym) {
    const today = U.today();
    if (ym) calMonth = ym; else if (!calMonth) calMonth = today.slice(0, 7);
    const cells = Extra.monthGrid(calMonth);
    let html = '<div class="row" style="justify-content:space-between;align-items:center">' +
      '<button class="btn sm ghost" data-act="calprev">‹ 上月</button>' +
      '<b>' + calMonth + '</b>' +
      '<button class="btn sm ghost" data-act="calnext">下月 ›</button></div>';
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:12px;text-align:center">' +
      U.weekLabels().map(w => '<div class="muted" style="font-size:12px">' + w.replace('周', '') + '</div>').join('') +
      cells.map(c => {
        if (!c) return '<div></div>';
        const cls = 'cal-cell' + (c.future ? ' future' : c.level >= 3 ? ' done beat' : c.level > 0 ? ' part' : '') + (c.today ? ' today' : '');
        return '<div class="' + cls + '" data-act="openday" data-d="' + c.date + '" title="' + c.date + ' ' + c.pct + '%">' + c.day + '</div>';
      }).join('') + '</div>';
    html += '<div class="muted" style="margin-top:12px">点任意过去的一天，可以补打卡、请假或用保护券；颜色越深那天完成度越高。</div>';
    sheet('补卡日历', html);
  }
  function shiftCal(n) {
    const ym = calMonth || U.today().slice(0, 7);
    const d = U.parseYmd(ym + '-01');
    d.setMonth(d.getMonth() + n);
    openDatePicker(U.ymd(d).slice(0, 7));
  }

  function openDayPanel(date) {
    const today = U.today();
    /* 补卡是救急用的，不是刷连击用的：超过期限只能看，不能改 */
    const can = Engine.canBackfill(date);
    const limit = Engine.backfillDays();
    const list = Engine.items().filter(it => U.ymd(new Date(it.createdAt || Date.now())) <= date);
    let html = '<div class="muted">' + E(U.prettyDate(date)) + ' · ' + (date === today ? '今天' : '补录') + '</div>';
    if (!can && date !== today) {
      html += '<div class="warn-box">这天已经超过补卡期限（只能补最近 ' + limit + ' 天），现在只能查看。放宽期限去「我的 → 外观与提醒」。</div>';
    }
    html += '<div class="card" style="margin-top:10px">' + (list.length ? list.map(it => {
      const due = Engine.isDue(it, date), done = Engine.isDone(it, date), sk = Engine.isSkipped(date, it.id);
      const note = Engine.noteOf(it.id, date);
      return '<div class="line-cell"><span style="color:' + (it.color || '#888') + '">●</span>' +
        '<div style="flex:1"><div class="k">' + E(it.name) + (due ? '' : ' <span class="muted">· 当天不安排</span>') + '</div>' +
        '<div class="s">' + (done ? '已完成' : sk ? '已请假' : '未完成') +
        /* 单次备注就挂在这一次打卡下面：时间轴上一眼能看到「那次为什么」 */
        (note ? ' · <span class="ln-note-t">“' + E(note) + '”</span>' : '') + '</div></div>' +
        '<button class="btn sm' + (done ? '' : ' ghost') + '" data-act="daytick" data-id="' + it.id + '" data-d="' + date + '"' + (can ? '' : ' disabled') + '>' +
        (done ? '撤销' : '打卡') + '</button>' +
        (done ? '<button class="btn sm ghost" data-act="daynote" data-id="' + it.id + '" data-d="' + date + '"' + (can ? '' : ' disabled') + '>' + (note ? '改备注' : '记一句') + '</button>' : '') +
        '<button class="btn sm ghost" data-act="dayskip" data-id="' + it.id + '" data-d="' + date + '"' + (can ? '' : ' disabled') + '>' + (sk ? '取消请假' : '请假') + '</button></div>';
    }).join('') : '<div class="muted">那天还没有习惯</div>') + '</div>';
    const fz = Extra.freezeInfo();
    html += '<div class="card"><div class="line-cell" style="border:none">' +
      '<div><div class="k">用保护券保住这一天</div><div class="s">剩余 ' + fz.left + ' 张，用了之后连续记录不断</div></div>' +
      '<button class="btn sm ghost" data-act="dayfreeze" data-d="' + date + '"' + (can ? '' : ' disabled') + '>使用</button></div></div>';
    sheet('补录 · ' + date, html);
  }

  function openBadges() {
    const bs = Extra.badges();
    const got = bs.filter(b => b.got).length;
    sheet('成就徽章',
      '<div class="muted">已解锁 ' + got + '/' + bs.length + ' 枚，达成后自动点亮。</div>' +
      '<div class="card" style="margin-top:10px">' + bs.map(b =>
        '<div class="line-cell" style="opacity:' + (b.got ? 1 : 0.45) + '"><span class="cell-ico">' + ico(b.icon || 'medal') + '</span>' +
        '<div style="flex:1"><div class="k">' + E(b.name) + '</div><div class="s">' + E(b.desc) + '</div></div>' +
        '<span class="muted">' + (b.got ? '✓ 已解锁' : '未解锁') + '</span></div>').join('') + '</div>');
  }

  /* 「连续」到底怎么算 —— 全站连续 / 单习惯连续是两套算法，
   * 芯片长得像，用户很容易看混。这里把口径摊开讲清楚。 */
  function openStreakInfo() {
    let days=0,weeks=0;
    Engine.items().forEach(it => { const n=Engine.bestStreak(it.id); if(Engine.streakUnit(it)==='周') weeks=Math.max(weeks,n); else days=Math.max(days,n); });
    sheet('连续记录怎么算',
      '<div class="v19-definitions"><p><b>全站连续：'+Engine.globalStreak()+' 天</b><br>每天至少完成一个习惯；今天尚未完成不会提前判定中断；被保护券覆盖的日子同样算不断。</p>' +
      '<p><b>按天最佳：'+days+' 天</b><br>每日、指定星期、间隔与月度计划按应执行日计算，休息日不打断。</p>' +
      '<p><b>按周最佳：'+weeks+' 周</b><br>每个 7 天窗口达到该习惯设定次数才计为完成一周，不能与天数直接比较。</p>' +
      '<p>请假不计入完成次数；连续是否保持按该习惯的排程与保护券规则计算。</p></div>');
  }

  async function paintMedia(root) {
    const imgs = (root || document).querySelectorAll('img[data-media]');
    for (const img of imgs) {
      if (img.dataset.loaded) continue;
      try {
        const url = await Store.mediaURL(img.dataset.media);
        if (url) { img.src = url; img.dataset.loaded = '1'; }
      } catch (e) { }
    }
  }

  /* ---------------- 长按 / 左滑菜单 ----------------
   * 请假、补卡、统计这三个动作不是每天都要用，摆在卡片上就是噪音。
   * 收进长按菜单：卡片只留「打卡」这一件事。 */
  function menuRow(emoji, title, sub, act, id, extra) {
    return '<div class="line-cell menu-row" role="button" tabindex="0" data-act="' + act + '" data-id="' + E(id || '') + '"' + (extra || '') + '>' +
      '<span style="font-size:18px">' + emoji + '</span>' +
      '<div style="flex:1"><div class="k">' + title + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>' +
      '<span class="muted">›</span></div>';
  }
  function openHabitMenu(id, from) {
    const it = (S().items || []).find(x => x.id === id);
    if (!it) return;
    const d = U.today();
    const skipped = window.Extra ? Extra.isSkipped(d, it.id) : false;
    const slipped = it.type === 'avoid' && Engine.slipped && Engine.slipped(it, d);
    const bf = Engine.backfillDays();
    Store.commit(s => { s.settings.hintLongPress = 1; });
    let html = '<div class="muted">' + E(it.name) + (it.why ? ' · 「' + E(it.why) + '」' : '') + '</div>';
    html += '<div class="card" style="margin-top:10px">';
    /* 习惯页的「⋯」：排序是这里最高频的操作，放最前面 */
    if (from === 'habits') {
      const list = Engine.sorted();
      const at = list.findIndex(x => x.id === id);
      html += menuRow('↑', '上移一位', at <= 0 ? '已经是第一个了' : '排在「' + E((list[at - 1] || {}).name || '') + '」前面', 'moveup', id, at <= 0 ? ' style="opacity:.45"' : '');
      html += menuRow('↓', '下移一位', at >= list.length - 1 ? '已经是最后一个了' : '排在「' + E((list[at + 1] || {}).name || '') + '」后面', 'movedown', id, at >= list.length - 1 ? ' style="opacity:.45"' : '');
      /* v56 · 交互走查：习惯多时一格一挪太费手指，补两个直达项（拖拽会和滑动手势打架，不做） */
      html += menuRow('⏫', '移到最前', at <= 0 ? '已经是第一个了' : '排到今日页第一个做', 'movetop', id, at <= 0 ? ' style="opacity:.45"' : '');
      html += menuRow('⏬', '移到最后', at >= list.length - 1 ? '已经是最后一个了' : '排到列表末尾', 'movebottom', id, at >= list.length - 1 ? ' style="opacity:.45"' : '');
      if (it.type === 'duration') {
        const running = window.Timer && Timer.isFor(it.id);
        html += menuRow(running ? ico('pause') : ico('play'), running ? '正在计时 · 点此继续' : '开始计时', '到点自动打卡，中途结束保留已计时间', 'timeropen', id);
      }
    }
    html += menuRow(ico('chart-bar'), '查看统计', '一年热力图 · 连击 · 完成率', 'habitdetail', id);
    /* 番茄钟绑定（走查第 10 条）：从卡片菜单一步进入，并自动绑定这个习惯 */
    html += menuRow(ico('timer'), '为这个习惯专注 25 分钟', '结束时会问你要不要记进去', 'pomohabit', id);
    html += menuRow(skipped ? ico('refresh') : ico('snowflake'), skipped ? '取消请假' : '今天请假', '请假不算断连击', 'skiptoday', id);
    /* 最小版本（v28 · 4.4）：低能量日不用跟自己较劲，做一个小的也算数。
     * 放在「请假」下面 —— 两者的区别是「今天不算」和「今天算一点」，这个顺序符合从松到紧。 */
    if (Engine.miniOf(it) && !Engine.isDone(it, d)) {
      html += menuRow(ico('sprout'), '只做最小版', E(Engine.miniOf(it)) + ' · 算完成，不断签，强度记一半', 'minitoday', id);
    }
    if (it.type === 'avoid') html += menuRow(skipped ? ico('refresh') : ico('shield-check'), slipped ? '撤销破戒' : '没忍住，记一笔', '破戒不算完成，但会记下来', 'slip', id);
    html += menuRow(ico('calendar-dots'), '补卡 · 最近 ' + bf + ' 天', '更早的只能看不能改，防止刷连击', 'hlpbackfill', id);
    html += menuRow(ico('chart-line'), '习惯强度与洞察', '周几最容易断、和谁互相带动', 'gogrow', id);
    html += menuRow(ico('pencil'), '编辑这个习惯', '', 'openhabit', id);
    html += menuRow(ico('package'), it.archived ? '取消归档' : '归档（暂时不做）', '归档后不在今日列表出现，记录都留着', 'hlparchive', id);
    html += '</div>';
    sheet('操作 · ' + it.name, html);
  }

  /* ---------------- 数值型习惯：快速增量 ----------------
   * 每次都要弹输入框填数字，是数值型习惯最大的摩擦。
   * 点数字就出这张面板：一按到位，真要填别的再走手动输入。 */
  function openQuickAdd(id) {
    const it = (S().items || []).find(x => x.id === id);
    if (!it) return;
    const d = U.today();
    const lg = Engine.getLog(d, it.id) || {};
    const curRaw = lg.v || 0;
    const cur = U.numShort(curRaw);          // 展示用：大数不拖一串小数
    const target = U.num(it.target || 1);
    const unit = it.unit || '';
    const left = Math.max(0, Math.round((target - curRaw) * 100) / 100);
    const mid = Math.max(1, Math.round(target / 4 * 100) / 100);
    let html = '<div class="muted">当前 <b>' + cur + unit + '</b> · 目标 ' + target + unit + '</div>';
    html += '<div class="qa-grid">';
    html += '<button class="qa" data-act="qadd" data-id="' + id + '" data-v="1">+1<small>' + E(unit) + '</small></button>';
    html += '<button class="qa" data-act="qadd" data-id="' + id + '" data-v="' + mid + '">+' + mid + '<small>' + E(unit) + '</small></button>';
    html += '<button class="qa main" data-act="qadd" data-id="' + id + '" data-v="full"' + (left <= 0 ? ' disabled' : '') + '>一次达标<small>+' + left + E(unit) + '</small></button>';
    html += '<button class="qa" data-act="qadd" data-id="' + id + '" data-v="-1">−1<small>' + E(unit) + '</small></button>';
    html += '<button class="qa" data-act="qadd" data-id="' + id + '" data-v="0">清零</button>';
    html += '<button class="qa" data-act="qset" data-id="' + id + '">手动输入<small>填任意值</small></button>';
    html += '</div>';
    html += '<div class="muted" style="margin-top:10px;font-size:12px">' +
      (it.type === 'duration'
        ? '平时点卡片上的「开始」计时就行，到点自动打卡；这里用于手动补录（没开 App 做的那次）。'
        : '点「一次达标」直接记满目标；连续加减还是用卡片上的 ＋ − 更快。') +
      '</div>';
    sheet('记一笔 · ' + it.name, html);
  }

  /* ---------------- 年度热力图（单习惯，GitHub 贡献图那种） ----------------
   * 一格一天，深浅 = 完成程度；数值型习惯按「目标达成比例」决定深浅。
   * 手机上横向可滑，点任意一天看当天详情（在期限内还能直接补卡）。 */
  function yearHeatHTML(it, days) {
    if (!window.Extra || !Extra.yearGrid) return '';
    const g = Extra.yearGrid(it.id, days || 365);
    if (!g) return '';
    const today = U.today();
    let html = '<div class="sec-title"><h3>一年 365 天</h3><span class="more">' + g.pct + '% · ' + g.done + '/' + g.due + '</span></div>';
    html += '<div class="yg-wrap"><div class="yg-inner">';
    html += '<div class="yg-months">' + g.months.map(m =>
      '<span style="grid-column:' + (m.col + 1) + '">' + m.label + '</span>').join('') + '</div>';
    html += '<div class="yg">' + g.cells.map(c => {
      if (!c) return '<i class="yg-blank"></i>';
      const cls = c.lv < 0 ? 'lv-none' : (c.lv === 1 && c.sk) ? 'lv-sk' : 'lv' + c.lv;
      const tip = c.date + (c.lv < 0 ? ' 还没开始' : c.sk ? ' 请假' : !c.due ? ' 不安排' : c.done ? ' 已完成' : ' 没完成');
      return '<i class="' + cls + (c.date === today ? ' now' : '') + '" data-act="openday" data-d="' + c.date + '" title="' + tip + '"></i>';
    }).join('') + '</div>';
    html += '</div></div>';
    html += '<div class="legend" style="justify-content:flex-start">' +
      '<span class="muted">少</span>' +
      '<i class="lv0"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i>' +
      '<span class="muted">多</span>' +
      '<span class="muted" style="margin-left:8px">点格子看那天 · ' + Engine.backfillDays() + ' 天内可补卡</span></div>';
    return html;
  }

  /* ---------------- 通知 / 云备份：收进右上角 ---------------- */
  function notifyPanelHTML() {
    if (!window.Remind) return '<div class="muted">这个浏览器不支持系统通知</div>';
    const st = S();
    const p = Remind.perm();
    const MAP = {
      granted: ['check-circle', '权限已开启', 'var(--ok)'],
      denied: ['ban', '被浏览器拦住了', 'var(--danger)'],
      default: ['warning-circle', '还没授权', 'var(--warn,#e0a020)'],
      unsupported: ['dots-three-circle', '浏览器不支持', 'var(--txt-3)']
    };
    const m = MAP[p] || MAP.default;
    const pend = Remind.pendingList ? Remind.pendingList() : [];
    let html = '<div class="card"><div class="line-cell" style="border:none;cursor:default">' +
      '<span class="cell-ico" style="color:' + m[2] + '">' + ico(m[0]) + '</span>' +
      '<div style="flex:1"><div class="k" style="color:' + m[2] + '">' + m[1] + '</div>' +
      '<div class="s">' + U.esc(Remind.statusText()) + '</div></div></div>' +
      '<div class="kv"><span>提醒总开关</span><b>' + (st.settings.remindEnabled ? '已开' : '关闭') + '</b></div>' +
      '<div class="kv"><span>设了提醒时间的习惯</span><b>' + Engine.items().filter(it => it.reminderAt).length + ' 个</b></div>' +
      '<div class="kv"><span>今天到点未打卡</span><b>' + pend.length + ' 个</b></div>' +
      /* v37：把「会补叫」写出来，否则用户以为响一次就结束了 */
      '<div class="muted" style="margin-top:8px;font-size:12px">到点没打卡，会在 ' +
      (Remind.REPEAT_MIN || [40, 90]).join(' 分钟、') + ' 分钟后再提醒两次（一共三次机会）。' +
      '点通知上的「稍后」会重新计时。<br>' +
      /* v38 · P1-10：合并窗口也要说出来，否则用户会以为漏提醒了 */
      '同时到点的几个习惯会合成一条通知；同一件事 ' + (Remind.MERGE_MIN || 30) + ' 分钟内不会再响第二声。</div>';
    html += '<div class="row" style="margin-top:10px">' +
      '<button class="btn sm" data-act="remindreauth">重新申请权限</button>' +
      '<button class="btn sm ghost" data-act="remindtest">发测试提醒</button>' +
      (pend.length ? '<button class="btn sm ghost" data-act="openmissed">去补上</button>' : '') +
      '</div>';
    if (p === 'denied') {
      html += '<div class="muted" style="margin-top:10px;font-size:12px">权限被拒后浏览器不会再弹授权框，需要去浏览器「网站设置 → 通知」手动改成允许，回来再点一次上面的按钮。</div>';
    }
    html += '</div>';
    html += '<div class="card"><div class="line-cell" style="border:none">' +
      '<div><div class="k">' + ico('calendar-dots') + '订阅到系统日历</div><div class="s">息屏也响，交给系统闹钟最可靠</div></div>' +
      '<button class="btn sm ghost" data-act="plg_calendar">去订阅</button></div></div>';
    return html;
  }
  function openNotifyPanel() { sheet('提醒与通知', notifyPanelHTML()); }

  function openCloudPanel() {
    let html = '';
    if (window.Cloud && Cloud.signedIn()) {
      html += '<div class="card"><div class="kv"><span>云备份</span><b style="color:var(--ok)">已开启</b></div>' +
        '<div class="muted" style="margin-top:8px">换设备、清缓存后登录同一个账号，数据会整体恢复回来。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-act="cloudsync">立即同步一次</button></div></div>';
    } else {
      html += '<div class="card"><div class="k">数据只在这台设备上</div>' +
        '<div class="s" style="margin-top:6px">清浏览器缓存、换手机就没了。登录一次，之后换设备自动回来。</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="cloudlogin">登录 / 绑定</button>' +
        '<button class="btn sm ghost" data-act="dismisscloudhint">不再提示</button></div></div>';
    }
    sheet('云备份', html);
  }

  /* ---------------- 补卡提醒兜底：网页没开时到点没响，回来补上 ---------------- */
  function openMissedPanel() {
    const list = window.Remind ? Remind.pendingList() : [];
    if (!list.length) { toast('今天没有漏掉的提醒'); return; }
    let html = '<div class="muted">下面这些习惯提醒时间已经过了，还没打卡 —— 现在补上还来得及。</div>';
    html += '<div class="card" style="margin-top:10px">' + list.map(it =>
      '<div class="line-cell"><span style="color:' + (it.color || '#888') + '">●</span>' +
      '<div style="flex:1"><div class="k">' + E(it.name) + '</div>' +
      '<div class="s">提醒时间 ' + E(it.reminderAt) + (it.target ? ' · 目标 ' + U.num(it.target) + (it.unit || '') : '') + '</div></div>' +
      '<button class="btn sm" data-act="missedcheck" data-id="' + it.id + '">打卡</button></div>').join('') + '</div>';
    sheet('补卡提醒 · ' + list.length + ' 项', html);
  }

  /* ---------------- 本周回顾卡片（可保存成图） ---------------- */
  function weekKey() {
    const t = U.today();
    return U.weekStartOf(t);                      // 本周第一天，按一周起始日算
  }
  function openWeekCard() {
    if (!window.Extra) return;
    const c = Extra.weekCard();
    const sd = c.streak;
    let html = '<div class="wk-card" id="wkCard">' +
      '<div class="wk-h"><span class="wk-t">本周回顾</span><span class="wk-r">' + E(c.range) + '</span></div>' +
      '<div class="wk-big"><b>' + c.pct + '</b><small>%</small></div>' +
      '<div class="wk-sub">本周完成率' + (c.prevPct ? ' · 上周 ' + c.prevPct + '%' : '') + '</div>' +
      '<div class="wk-stats">' +
      '<div><b>' + c.checkins + '</b><span>打卡次数</span></div>' +
      '<div><b>' + c.total + '</b><span>应打卡数</span></div>' +
      '<div><b>' + sd.now + '<small>' + (sd.delta >= 0 ? '+' : '') + sd.delta + '</small></b><span>全站连击</span></div>' +
      '</div>';
    html += '<div class="wk-list">' + (c.top3 || []).map(x =>
      '<div class="wk-row"><span class="wk-n">' + E(x.name) + '</span>' +
      '<span class="wk-bar"><i style="width:' + x.pct + '%;background:' + (x.color || 'var(--accent)') + '"></i></span>' +
      '<span class="wk-p">' + x.pct + '%</span></div>').join('') +
      (c.worst ? '<div class="wk-foot">最容易掉链子：' + E(c.worst.name) + '（' + c.worst.pct + '%），下周先搞定它</div>' : '') +
      '</div>';
    html += '<div class="wk-sign">日拱一卒 · 功不唐捐</div></div>';
    html += '<div class="row" style="margin-top:12px">' +
      '<button class="btn sm" id="wkSave" data-act="weeksave">保存为图片</button>' +
      '<button class="btn sm ghost" data-act="weekcopy">复制文字</button></div>' +
      '<div class="muted" style="margin-top:8px;font-size:12px">手机上也可以直接长按上面的卡片保存。</div>';
    sheet('本周回顾', html);
    setTimeout(function () { try { paintWeekCanvas(); } catch (e) { } }, 60);
  }

  /* 把卡片画成真正的图片（手机长按保存 / 点按钮下载都用它） */
  function paintWeekCanvas() {
    const host = $('wkCard');
    if (!host || !window.Extra) return;
    const c = Extra.weekCard();
    const W = 750, H = 1000;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg = dark ? '#15171f' : '#ffffff';
    const ink = dark ? '#e8eaf2' : '#1b1d26';
    const sub = dark ? '#9aa0b4' : '#6b7183';
    const line = dark ? '#262a36' : '#e9ebf2';
    const accent = '#4f6bed';
    const F = function (w, s) { return w + ' ' + s + 'px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif'; };

    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const grd = g.createLinearGradient(0, 0, W, 200);
    grd.addColorStop(0, accent); grd.addColorStop(1, dark ? '#2b3550' : '#8b7bff');
    g.fillStyle = grd; g.fillRect(0, 0, W, 190);

    g.fillStyle = '#fff';
    g.font = F('600', 34); g.fillText('本周回顾', 56, 84);
    g.globalAlpha = .85; g.font = F('400', 22); g.fillText(c.range, 56, 126); g.globalAlpha = 1;
    g.font = F('700', 92); g.fillText(String(c.pct), 56, 186);
    const pw = g.measureText(String(c.pct)).width;
    g.globalAlpha = .8; g.font = F('600', 32); g.fillText('%', 56 + pw + 10, 186); g.globalAlpha = 1;

    let x = 56, y = 292;
    const stats = [
      [String(c.checkins), '打卡次数'],
      [String(c.total), '应打卡数'],
      [String(c.streak.now) + (c.streak.delta >= 0 ? '+' : '') + c.streak.delta, '全站连击']
    ];
    stats.forEach(function (s) {
      g.fillStyle = ink; g.font = F('700', 50); g.fillText(s[0], x, y);
      g.fillStyle = sub; g.font = F('400', 22); g.fillText(s[1], x, y + 36);
      x += 220;
    });

    y = 396;
    g.strokeStyle = line; g.lineWidth = 2;
    g.beginPath(); g.moveTo(56, y); g.lineTo(W - 56, y); g.stroke();

    y = 458;
    g.fillStyle = ink; g.font = F('600', 26); g.fillText('完成率排行', 56, y);
    y += 38;
    (c.top3 || []).forEach(function (it) {
      g.fillStyle = ink; g.font = F('400', 26);
      const nm = it.name.length > 8 ? it.name.slice(0, 8) + '…' : it.name;
      g.fillText(nm, 56, y + 26);
      const bx = 300, bw = W - 56 - bx - 90;
      g.fillStyle = line; g.fillRect(bx, y + 8, bw, 20);
      g.fillStyle = it.color || accent; g.fillRect(bx, y + 8, Math.round(bw * (it.pct || 0) / 100), 20);
      g.fillStyle = ink; g.font = F('600', 26); g.fillText(it.pct + '%', W - 56 - 70, y + 28);
      y += 72;
    });

    if (c.worst) {
      y += 16;
      g.fillStyle = sub; g.font = F('400', 24);
      g.fillText('最容易掉链子：' + c.worst.name + '（' + c.worst.pct + '%）', 56, y + 20);
    }

    g.fillStyle = sub; g.font = F('400', 22);
    g.fillText('日拱一卒 · 功不唐捐', 56, H - 56);

    let img = host.querySelector('img.wk-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'wk-img';
      img.alt = '本周回顾';
      host.appendChild(img);
    }
    try { img.src = cv.toDataURL('image/png'); } catch (e) { }
    host._canvas = cv;
  }

  function saveWeekCard() {
    const host = $('wkCard');
    const cv = host && host._canvas;
    if (!cv) { toast('卡片还没画好，稍等一下'); return; }
    const name = '本周回顾-' + weekKey() + '.png';
    try {
      if (cv.toBlob) {
        cv.toBlob(function (b) {
          const url = URL.createObjectURL(b);
          const a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
          toast('已保存 ' + name);
        }, 'image/png');
      } else {
        const a = document.createElement('a');
        a.href = cv.toDataURL('image/png'); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        toast('已保存');
      }
    } catch (e) { toast('保存失败：' + e.message); }
  }

  /* ---------------- 我的小屋：用积分把房间经营起来 ---------------- */
  function roomHomeHTML() {
    if (!window.Decor) return '';
    const lv = Decor.level();
    const items = Decor.roomItems();
    const pts = Engine.points();
    let html = '<div class="sec-title"><h3>' + ico('house') + '我的小屋</h3><span class="more">' + ico(lv.cur.icon || 'house') + ' ' + lv.cur.name + ' · ' + pts + ' 分</span></div>';
    html += '<div class="card home">';
    html += '<div class="home-room">' + (items.length
      ? items.map(function (it) { return '<span class="hm-item" title="' + E(it.name) + '">' + it.emoji + '</span>'; }).join('')
      : '<span class="home-empty">空荡荡的一间房 · 用打卡积分添置第一件东西</span>') + '</div>';
    html += '<div class="home-lv"><div class="hl-bar"><i style="width:' + lv.pct + '%"></i></div>' +
      '<div class="hl-t">' + (lv.next
        ? '再投入 ' + (lv.next.n - lv.invested) + ' 分升级为「' + lv.next.name + '」'
        : '已经是最高等级「' + lv.cur.name + '」') + '</div></div>';
    html += '<div class="row" style="margin-top:10px">' +
      '<button class="btn sm" data-act="decorshop">' + ico('cart') + '家具商店</button>' +
      '<button class="btn sm ghost" data-act="decorstorage">' + ico('package') + '仓库</button>' +
      '<button class="btn sm ghost" data-act="rewards">积分商店</button></div>';
    html += '</div>';
    return html;
  }

  function openDecorShop(cat) {
    if (!window.Decor) return;
    const pts = Engine.points();
    const cats = Decor.cats();
    const cur = cat || cats[0];
    let html = '<div class="muted">当前积分 <b>' + pts + '</b> · 打卡一次 +10，全勤再 +30</div>';
    html += '<div class="chips" style="margin:10px 0">' + cats.map(function (c) {
      return '<button class="chip' + (c === cur ? ' on' : '') + '" data-act="decorcat" data-v="' + E(c) + '">' + E(c) + '</button>';
    }).join('') + '</div>';
    html += '<div class="card">' + Decor.CATALOG.filter(function (it) { return it.cat === cur; }).map(function (it) {
      const own = Decor.owned(it.id);
      const afford = pts >= it.cost;
      return '<div class="line-cell"><span style="font-size:22px">' + it.emoji + '</span>' +
        '<div style="flex:1"><div class="k">' + E(it.name) + (own ? ' <span class="muted">×' + own + '</span>' : '') + '</div>' +
        '<div class="s">' + E(it.desc) + ' · ' + it.cost + ' 分</div></div>' +
        '<button class="btn sm' + (afford ? '' : ' ghost') + '" data-act="decorbuy" data-id="' + it.id + '"' + (afford ? '' : ' disabled') + '>' +
        (afford ? '买下' : '分不够') + '</button></div>';
    }).join('') + '</div>';
    const st2 = Decor.storage();
    if (st2.length) {
      html += '<div class="sec-title"><h3>仓库（买了没摆出来的）</h3></div><div class="card">' +
        st2.map(function (x) {
          return '<div class="line-cell"><span style="font-size:20px">' + x.item.emoji + '</span>' +
            '<div style="flex:1"><div class="k">' + E(x.item.name) + ' ×' + x.n + '</div></div>' +
            '<button class="btn sm ghost" data-act="decorplace" data-id="' + x.item.id + '">摆出来</button>' +
            '<button class="btn sm ghost" data-act="decorsell" data-id="' + x.item.id + '">退回</button></div>';
        }).join('') + '</div>';
    }
    html += '<div class="muted" style="margin-top:10px;font-size:12px">房间最多同时摆 ' + Decor.SLOTS + ' 件，多出来的进仓库；退回能拿回一半积分。</div>';
    sheet('家具商店', html);
  }

  function openDecorStorage() {
    if (!window.Decor) return;
    const placed = Decor.placed();
    const st2 = Decor.storage();
    let html = '<div class="sec-title"><h3>房间里（' + placed.length + '/' + Decor.SLOTS + '）</h3></div>';
    let body = '';
    placed.forEach(function (id) {
      const it = Decor.item(id);
      if (!it) return;
      body += '<div class="line-cell"><span style="font-size:20px">' + it.emoji + '</span>' +
        '<div style="flex:1"><div class="k">' + E(it.name) + '</div></div>' +
        '<button class="btn sm ghost" data-act="decorunplace" data-id="' + id + '">收进仓库</button></div>';
    });
    html += '<div class="card">' + (body || '<div class="muted">房间还空着，去商店买一件吧</div>') + '</div>';
    if (st2.length) {
      html += '<div class="sec-title"><h3>仓库</h3></div><div class="card">' + st2.map(function (x) {
        return '<div class="line-cell"><span style="font-size:20px">' + x.item.emoji + '</span>' +
          '<div style="flex:1"><div class="k">' + E(x.item.name) + ' ×' + x.n + '</div></div>' +
          '<button class="btn sm" data-act="decorplace" data-id="' + x.item.id + '">摆出来</button></div>';
      }).join('') + '</div>';
    }
    sheet('我的仓库', html);
  }

  /* ---------------- 徽章墙 ---------------- */
  /* 「我的」页那一行的副标题：拿到第一枚就报进度，一枚都没有时告诉人「第一枚在哪」。
   * 走查第 2 条：徽章墙不再等 30 个活跃日。 */
  function badgeMeSub() {
    if (!window.Extra) return '记录你的每一次坚持';
    const bs = Extra.badges();
    const got = bs.filter(b => b.got).length;
    if (got > 0) return '已解锁 ' + got + ' / ' + bs.length + ' 枚';
    const first = bs[0];
    return first ? '第一枚：' + first.name + ' · ' + first.desc : '记录你的每一次坚持';
  }
  function badgeWallHTML() {
    if (!window.Extra) return '';
    const bs = Extra.badges();
    const m = Extra.metrics();
    const gotN = bs.filter(function (b) { return b.got; }).length;
    let html = '<div class="sec-title"><h3>' + ico('medal') + '徽章墙</h3><span class="more">' + gotN + '/' + bs.length + '</span></div>';
    html += '<div class="card"><div class="bwall">' + bs.map(function (b) {
      const p = Extra.badgeProgress(m, b);
      return '<div class="bw' + (b.got ? ' got' : '') + '" data-act="badges" role="button" tabindex="0" aria-label="' + E(b.name) + '">' +
        '<div class="bw-i">' + ico(b.icon || 'medal') + '</div>' +
        '<div class="bw-n">' + E(b.name) + '</div>' +
        (b.got ? '<div class="bw-ok">已解锁</div>'
          : '<div class="bw-p"><i style="width:' + (p ? p.pct : 0) + '%"></i></div>' +
          '<div class="bw-s">' + (p ? p.cur + '/' + p.need : E(b.desc)) + '</div>') +
        '</div>';
    }).join('') + '</div>';
    html += '<div class="row" style="margin-top:12px"><button class="btn sm ghost" data-act="badges">查看全部成就</button></div></div>';

    const ms = Extra.milestones();
    html += '<div class="sec-title"><h3>' + ico('ladder') + '连击里程碑</h3><span class="more">' +
      ms.filter(function (x) { return x.got; }).length + '/' + ms.length + '</span></div>';
    html += '<div class="card"><div class="ladder">' + ms.map(function (x) {
      return '<div class="ld' + (x.got ? ' got' : '') + '">' +
        '<div class="ld-i">' + ico(x.icon || 'fire') + '</div>' +
        '<div class="ld-n">' + x.n + '</div>' +
        '<div class="ld-t">' + E(x.name) + '</div>' +
        '<div class="ld-p"><i style="width:' + Math.round(x.cur / x.n * 100) + '%"></i></div>' +
        '</div>';
    }).join('') + '</div>' +
      '<div class="muted" style="margin-top:10px;font-size:12px">按你历史最长的连续记录计算 —— 断过也没关系，纪录不会清零。</div></div>';
    return html;
  }

  /* 提醒权限诊断：很多人「设了时间却没收到」，问题往往出在权限被拒 */
  function notifyDiagCard() {
    if (!window.Remind) return '';
    const st = S();
    const p = Remind.perm();
    const MAP = {
      granted: ['check-circle', '权限已开启', 'var(--ok)'],
      denied: ['ban', '权限被浏览器拦住', 'var(--danger)'],
      default: ['warning-circle', '还没授权', 'var(--warn,#e0a020)'],
      unsupported: ['dots-three-circle', '这个浏览器不支持', 'var(--txt-3)']
    };
    const m = MAP[p] || MAP.default;
    const pend = Remind.pendingList ? Remind.pendingList().length : 0;
    const withRemind = Engine.items().filter(function (it) { return it.reminderAt; }).length;
    const risky = (p !== 'granted') && withRemind > 0;
    return '<div class="card">' +
      '<div class="line-cell" style="border:none;cursor:default">' +
      '<span class="cell-ico" style="color:' + m[2] + '">' + ico(m[0]) + '</span>' +
      '<div style="flex:1"><div class="k" style="color:' + m[2] + '">通知权限：' + m[1] + '</div>' +
      '<div class="s">' + U.esc(Remind.statusText()) + '</div></div></div>' +
      (risky ? '<div class="warn-box">你已经给 ' + withRemind + ' 个习惯设了提醒时间，但通知权限没开 —— 到点是不会响的。</div>' : '') +
      '<div class="kv"><span>提醒总开关</span><b>' + (st.settings.remindEnabled ? '已开' : '关闭') + '</b></div>' +
      '<div class="kv"><span>今天到点未打卡</span><b>' + pend + ' 个</b></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn sm" data-act="remindreauth">重新申请权限</button>' +
      '<button class="btn sm ghost" data-act="remindtest">发测试提醒</button>' +
      (pend ? '<button class="btn sm ghost" data-act="openmissed">去补上</button>' : '') +
      '</div>' +
      (p === 'denied' ? '<div class="muted" style="margin-top:8px;font-size:12px">被拒后浏览器不会再弹授权框：去浏览器「网站设置 → 通知」改成允许，再回来点上面的按钮。</div>' : '') +
      '</div>';
  }

  /* ---------------- 渲染入口 ---------------- */
  /* v54 · P2-8 拆包守卫：日记 / 回顾 / 房间的模块是 async 加载的，可能还没到。
   * 直接进渲染函数会 ReferenceError（那里开头就在读 Diary.xxx / Rooms.xxx），
   * 所以先摆一句「正在准备」，模块到了自动重绘。
   * 这三个 tab 是新用户不会在第一秒点到的，正常网络下也不会真出现这句。 */
  const CHUNK_GATE = { diary: 'Diary', grow: 'Insights', rooms: 'Rooms' };
  function chunkMissing() {
    const g = CHUNK_GATE[tab];
    return g && !window[g] ? g : '';
  }
  function chunkLoadingGuide() {
    return '<div class="empty guide"><div class="e-art">' + emptyArt() + '</div>' +
      '<div class="e-t">正在准备这一页…</div>' +
      '<div class="e-d">第一次打开要下载一点点额外内容，之后断网也能用。</div></div>';
  }
  /* 轮询而不是监听事件：chunk 可能在注册监听之前就已经执行完了，
   * 事件已经派发过就永远等不到。轮询没有这个先后问题。 */
  function waitChunk(name, cb) {
    let n = 0;
    const iv = setInterval(function () {
      if (window[name]) { clearInterval(iv); cb(); return; }
      if (++n > 60) clearInterval(iv);   // 15 秒还没到就别再轮询了
    }, 250);
  }

  /* animate 只在切页时为真：打卡后的重绘不再整页重播入场动画（既省性能也不闪） */
  function render(opts) {
    document.dispatchEvent(new Event('rigong:before-render'));
    paintTop();
    paintTodoBadge();
    const v = $('view');
    const miss = chunkMissing();
    const atTab = tab;
    v.innerHTML = miss ? chunkLoadingGuide()
      : tab === 'today' ? renderToday()
        : tab === 'todos' ? renderTodos()
          : tab === 'diary' ? renderDiary()
            : tab === 'habits' ? renderHabits()
              : tab === 'rooms' ? renderRooms()
                : tab === 'grow' ? renderGrow()
                  : tab === 'connect' ? renderConnect()
                    : renderMe();
    if (miss) waitChunk(miss, function () { if (tab === atTab) render(); });
    document.querySelectorAll('.tab').forEach(t => {
      const active = t.dataset.tab === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      // roving tabindex：整组 tab 只留一个可 Tab 进入的停靠点，组内用方向键切换
      t.setAttribute('tabindex', active ? '0' : '-1');
      if (active) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    // 主区域跟着当前页更新可访问名称，屏幕阅读器报「今日 标签页」而不是空
    const curTab = document.querySelector('.tab[data-tab="' + tab + '"]');
    if (curTab) {
      v.setAttribute('aria-labelledby', curTab.id);
      v.setAttribute('aria-label', curTab.getAttribute('aria-label') || '');
    }
    if (tab === 'today') paintPhotos();
    syncFab();
    if (window.Product) Product.refresh();
    Feat.Notify.badge();
    // 输入框字数计数
    if (window.UX) UX.bindCounters(v);
    // 日记里的图片是异步取的（可能来自云端），渲染完再回填
    paintMedia(v);
    // 写日记页：这天还没天气就顺手拉一次（失败静默，可手动点选）
    // 注意：同一天只允许回填重绘一次，否则会陷入 render 自循环
    if (tab === 'diary' && diaryView === 'write' && window.Diary) {
      const wd = dDate();
      Diary.ensureWeather(wd).then(function (w) {
        if (!w || tab !== 'diary' || _wxPainted[wd]) return;
        _wxPainted[wd] = 1;
        render();
      }).catch(function () { });
    }
    // 切页时重新播放"淡入上移"动画
    if (window.FX && opts && opts.animate) FX.pageIn(v);
  }
  function go(t) {
    if (!['today', 'todos', 'diary', 'habits', 'rooms', 'grow', 'connect', 'me'].includes(t)) return;
    /* 隐私锁（v46）：只锁日记时，第一次进日记页先要密码。
     * gate 成功会把 unlocked 置 true，所以递归回来这一条就不会再进。 */
    if (t === 'diary' && window.Lock && Lock.enabled() && Lock.scope() === 'diary' && !Lock.isUnlocked()) {
      Lock.gate(function () { go(t); });
      return;
    }
    document.dispatchEvent(new Event('rigong:before-render'));
    /* v54 · 「我的」页二级分组：进「我的」或离开「我的」都回到一级页。
     * 不做这件事的话，用户从二级页切到今日页再切回来，会停在上次的二级页里 ——
     * 而底部「我的」这个 tab 的语义是「我的首页」。 */
    if (t === 'me' || tab === 'me') meSub = '';
    tab = t; render({ animate: true }); window.scrollTo(0, 0);
  }

  /* 番茄钟悬浮球什么时候露脸：
   * 它固定在右下角，会压住卡片右侧的「⋯」和「我的」页的开关 —— 那些都是可点区域，
   * 被挡住就是真的点不到。v24 起只在计时进行中显示：常驻的「25:00」既没有上下文，
   * 又实实在在挡住了一个按钮。入口移到「更多 → 番茄钟」。 */
  function syncFab() {
    const fab = $('fabPomodoro');
    if (!fab) return;
    const running = !!(window.Feat && Feat.Pomo && Feat.Pomo.mode !== 'idle');
    const show = running;
    fab.classList.toggle('hide', !show);
    const v = $('view');
    if (v) v.classList.toggle('has-fab', show);
  }

  return {
    render, go, get tab() { return tab; },
    /* v54 · 「我的」页二级分组（走查 P1-5） */
    get meSub() { return meSub; },
    setMeSub(v) { meSub = v || ''; render({ animate: true }); window.scrollTo(0, 0); },
    patchToday, patchNextStep, patchCard, syncChrome, savedTip, syncFab,
    openRoutines, rtToggle, rtSelected, openCapsules, openShareCard, openImportCSV, csvPreview,
    webdavCardHTML, renderWebDAV, openWebDAVConfig, mediaStat, REVIEW_Q,
    sheet, closeSheet, paintTop, paintQuota, paintCloud, formError, openTools, setSelected, icoIn: ico,
    sheetReady,
    openHabitDetail, openNoteSheet, openMiniSheet, setRestart, restartOn, yearNotes,
    openBuddyNew, openBuddyInvite, openBuddyJoin, openBuddyMenu, openBuddyLeaveAsk,
    openDatePicker, shiftCal, openDayPanel, openBadges, badgeWallHTML,
    openHabitMenu, openQuickAdd, yearHeatHTML, openWeekCard, saveWeekCard, weekKey,
    openLockSetup, openLockOff,
    openStreakInfo, repaintTrendChart,
    openNotifyPanel, openCloudPanel, openMissedPanel, notifyDiagCard, paintHeaderDots,
    roomHomeHTML, openDecorShop, openDecorStorage,
    openHabit, collectHabit, validateHabit, openBundle, openPomo, openRewards, openPoster, openYearPoster, openData, openInvite,
    openLogin, openCalendar, openHooks, openShortcut, openHealth, openExport, openApi, openOnboard, openKeys,
    openAbout, openFeedback, diagText, mailtoHref, feedbackEmail,
    openTimer, openTodoEdit, openTodoMenu, openChalDetail, openChalLib,
    subRowsHTML, toggleGroup,
    renderRooms, paintRoomRank, openRoomProfile, openRoomCreate, openRoomJoin, openPlaza,
    healthMetricsHTML, cloudCardHTML, renderConnect,
    paintPhotos, paintMedia,
    /* 日记页状态：改完让 main.js 触发重绘 */
    setDiaryDate(d) { diaryDate = d || null; diaryView = 'write'; },
    /* 月度报告：切换月份后重绘成长页 */
    reportYm: reportYm,
    setReportMonth(m) { reportMonth = m || null; },    setDiaryView(v) { diaryView = v || 'write'; },
    setDiaryMonth(m) { diaryMonth = m || null; },
    diaryMore() { diaryOffset += 30; },
    diaryResetPage() { diaryOffset = 0; },
    setDiaryQuery(q) { diaryQuery = q || ''; diaryOffset = 0; },
    diaryQuery() { return diaryQuery; },
    toggleMonthFold() { diaryFold = !diaryFold; },
    diaryState() {
      return { date: dDate(), view: diaryView, month: diaryMonth, offset: diaryOffset, q: diaryQuery };
    }
  };
})();
