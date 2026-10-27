/* ============ 启动与事件 ============ */
(function () {
  const $ = id => document.getElementById(id);

  /* 全局错误兜底：出错时给一张能操作的自救卡（重试 / 导出 / 回滚），
   * 而不是一行灰色报错——那样用户只能干瞪眼，数据还锁在页面里。 */
  function showRescue(err) {
    const v = $('view');
    if (!v || !window.Safety) return;
    if (v.querySelector('[data-act="rescueretry"]')) return;   // 已经显示过，别覆盖
    v.innerHTML = Safety.rescueHTML(err);
  }
  window.addEventListener('error', e => {
    console.error('[日拱一卒]', e.message, e.filename, e.lineno);
    try { if (window.ErrLog) ErrLog.push('error', e.error || e.message); } catch (_e) { }
    showRescue(e.error || e.message);
  });
  window.addEventListener('unhandledrejection', e => {
    console.error('[日拱一卒] unhandled', e.reason);
    try { if (window.ErrLog) ErrLog.push('rejection', e.reason); } catch (_e) { }
    try {
      const pre = document.createElement('pre');
      pre.style.display = 'none';
      pre.id = 'unhandledErr';
      pre.textContent = 'REJECTION: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason);
      document.body.appendChild(pre);
    } catch (_e) { }
  });

  /* ---------- 主题 ---------- */
  /* v58 · 商业软件对标（Streaks 78 主题的唯一克制版回应）：8 个精选主题色。
   * 每组 [浅色accent, 浅色soft, 深色accent, 深色soft]；只换强调色，不动画背景不换图标 ——
   * 个性化但不失控。首帧镜像走 rgz.accent（存值不存 key，内联脚本不用再带一份表）。 */
  const ACCENTS = {
    indigo: { name: '靛蓝', v: ['#3c5bcc', '#eaeefe', '#8ba4ff', '#252a3f'] },
    teal:   { name: '青碧', v: ['#0e8f7e', '#e0f4ef', '#6fd0be', '#1e3a36'] },
    green:  { name: '松林', v: ['#3f8b52', '#e4f2e6', '#82d498', '#233928'] },
    amber:  { name: '琥珀', v: ['#a8741c', '#f6eedb', '#e6c26e', '#3a3120'] },
    clay:   { name: '陶土', v: ['#c05f3e', '#f8e9e2', '#eda184', '#3f2a23'] },
    rose:   { name: '绯红', v: ['#b84a68', '#f8e5eb', '#ef95ad', '#3e2530'] },
    violet: { name: '黛紫', v: ['#7a4ebd', '#efeafa', '#c29ff2', '#312845'] },
    slate:  { name: '石墨', v: ['#59636f', '#ebeef0', '#a6afb9', '#2b2f36'] }
  };
  function applyAccent() {
    const key = (Store.s.settings && Store.s.settings.accentKey) || 'indigo';
    const a = ACCENTS[key] || ACCENTS.indigo;
    try { localStorage.setItem('rgz.accent', JSON.stringify({ l: [a.v[0], a.v[1]], d: [a.v[2], a.v[3]] })); } catch (e) { }
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const rs = document.documentElement.style;
    rs.setProperty('--accent', dark ? a.v[2] : a.v[0]);
    rs.setProperty('--accent-soft', dark ? a.v[3] : a.v[1]);
  }
  /* 供设置页渲染色板（UI 与 main 同 IIFE 域之外，走 window；u.js 侧有守卫） */
  window.__ACCENTS__ = Object.keys(ACCENTS).map(k => ({ key: k, name: ACCENTS[k].name, dot: ACCENTS[k].v[0] }));
  function applyTheme() {
    let t = Store.s.settings.theme || 'system';
    try {
      const qp = new URLSearchParams(location.search).get('theme');
      if (qp) t = qp;
    } catch (e) { }
    /* v52 · 报告 P0-3：主题要同步写一份到 localStorage。
     * 首帧的内联脚本在 defer 脚本之前跑，那时 IndexedDB 还没打开，
     * 它只能读 localStorage —— 而 state 早已迁到 IDB 并从 localStorage 删掉，
     * 所以它读到的永远是空，手选浅色 + 系统深色的人每次冷启动都要闪一下黑白。
     * 这里每次应用主题都镜像一次，老用户升级后第一次启动就自动补上这个 key。 */
    try { localStorage.setItem('rgz.theme', t); } catch (e) { }
    let v = t;
    if (t === 'system') v = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', v);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', v === 'dark' ? '#12141c' : '#f6f7fb');
    syncThemeIco(v);
    applyA11y();
    applyAccent();
  }
  /* v20 · 无障碍进阶：色盲友好模式 + 字号缩放。
   * 只往 <html> 上写 data-cb / data-fs，具体色板和放大在 app.css 里，
   * 所以切换即时生效、不需要重建 DOM；没数据时（settings 还没就绪）直接跳过。 */
  function applyA11y() {
    const st = Store.s && Store.s.settings;
    if (!st) return;
    document.documentElement.setAttribute('data-cb', st.colorBlind ? '1' : '0');
    document.documentElement.setAttribute('data-fs', st.fontScale === 'large' ? 'large' : 'normal');
  }
  /* 长按主题按钮「恢复跟随系统」的时间戳：用来把紧随其后那次 click 挡掉 */
  let themeFollowAt = 0;
  /* 顶栏主题图标跟随当前深浅色 */
  function syncThemeIco(v) {
    const el = document.getElementById('themeIco');
    if (!el) return;
    const dark = v == null ? document.documentElement.getAttribute('data-theme') === 'dark' : v === 'dark';
    if (window.Product) el.innerHTML = Product.icon(dark ? 'sun' : 'moon');
    else el.textContent = dark ? '☀️' : '🌙';
    const btn = document.getElementById('btnTheme');
    if (btn) btn.classList.toggle('on', dark);
  }

  /* ---------- 提示 ---------- */
  function toast(m) { U.toast(m); }

  /* ---------- 房间：打卡后把成绩同步到房间（20 秒内最多一次） ---------- */
  let roomSyncAt = 0, roomSyncTimer = null, pendingRoomCode = '';
  function pushRoom(force) {
    if (Store.s.settings.autoSync === false) return;
    if (window.Rooms && Rooms.isAnon && Rooms.isAnon()) return;   // 未登录不写房间表
    if (!window.Rooms || !Rooms.profile().nickname) return;
    if (!Rooms.myRooms().length) return;
    const now = Date.now();
    if (!force && now - roomSyncAt < 20000) { clearTimeout(roomSyncTimer); roomSyncTimer = setTimeout(() => pushRoom(true), 20000 - (now - roomSyncAt)); return; }
    clearTimeout(roomSyncTimer);
    roomSyncAt = now;
    Rooms.sync().catch(() => { });
  }
  /* 只在这次要用到社交功能时才问，而且一次会话最多弹一次 ——
   * 之前点「成长 / 房间」会被同一张 bottom sheet 反复拦住，很烦。 */
  let nickAsked = false;
  function nickFirst() {
    if (window.Rooms && Rooms.profile().nickname) return true;
    if (nickAsked) return false;
    nickAsked = true;
    UI.openRoomProfile(); toast('先设置一个昵称，朋友才知道你是谁');
    return false;
  }
  async function doJoin(code) {
    const r = await Rooms.join(code);
    if (!r.ok) { toast(r.msg); return false; }
    UI.go('rooms'); toast('已加入：' + r.name);
    return true;
  }
  /* 打卡后：如果它属于某条例程，提示下一个该做什么 */
  function hintNext(itemId) {
    if (!window.Plus) return;
    try {
      const n = Plus.nextAfter(itemId, U.today());
      if (!n) return;
      setTimeout(() => toast('🔗 下一步：' + n.item.name + (n.left > 1 ? '（还剩 ' + n.left + ' 步）' : '（最后一步）')), 420);
    } catch (e) { }
  }

  /* 成就：打卡后检查是否解锁，解锁就提示。
     统计要扫全部历史，放到空闲时段跑，别拖慢打卡那一刻 */
  let badgeTimer = 0;
  function checkBadges() {
    if (!window.Extra) return;
    clearTimeout(badgeTimer);
    const run = () => {
      try {
        const news = Extra.checkAchievements();
        if (news.length) setTimeout(() => celebrateBadges(news), 350);
      } catch (e) { }
    };
    if (window.requestIdleCallback) badgeTimer = setTimeout(() => requestIdleCallback(run, { timeout: 1200 }), 300);
    else badgeTimer = setTimeout(run, 600);
    checkLevelUp();
  }

  /* 徽章解锁：只在「今天全部完成」时弹窗。
   * 第一次打卡最关键的 3 秒是「打上了吗 → 下一个」，用颁奖礼打断动作就是摩擦；
   * 平时只给一行 toast，3 秒自己走。 */
  function celebrateBadges(list) {
    if (!list || !list.length) return;
    const b = list[0];
    const allDone = Engine.todayRate(U.today()).pct >= 100;
    if (!allDone) {
      if (window.UX) UX.sfx('badge');
      toast('🎉 解锁徽章 · ' + b.name + (list.length > 1 ? ' 等 ' + list.length + ' 枚' : ''));
      return;
    }
    /* 面板开着（最常见：刚打卡完正在写「记一句」）就别弹模态——
     * 它会盖住面板、把焦点从输入框抢走。徽章已经记进徽章墙，一行 toast 告知即可。 */
    const sheetEl = document.getElementById('sheet');
    if (sheetEl && sheetEl.classList.contains('on')) {
      if (window.UX) UX.sfx('badge');
      toast('🎉 解锁徽章 · ' + b.name + (list.length > 1 ? ' 等 ' + list.length + ' 枚' : ''));
      return;
    }
    if (window.FX) FX.confetti(120, { y: -20 });
    if (window.UX) UX.sfx('all');
    let box = document.getElementById('badgePop');
    if (box) box.remove();
    const prevFocus = document.activeElement;
    box = document.createElement('div');
    box.id = 'badgePop';
    box.className = 'badge-pop';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '解锁新徽章');
    box.innerHTML = '<div class="bp-in">' +
      '<div class="bp-ico" aria-hidden="true">' + UI.icoIn(b.icon || 'medal') + '</div>' +
      '<div class="bp-t">解锁新徽章</div>' +
      '<div class="bp-n">' + U.esc(b.name) + '</div>' +
      '<div class="bp-d">' + U.esc(b.desc) + '</div>' +
      (list.length > 1 ? '<div class="bp-more">同时解锁 ' + list.length + ' 枚：' +
        U.esc(list.slice(1).map(x => x.name).join('、')) + '</div>' : '') +
      '<div class="bp-row"><button class="btn sm" id="bpOk">收下</button>' +
      '<button class="btn sm ghost" id="bpWall">看看徽章墙</button></div></div>';
    document.body.appendChild(box);
    const close = function () {
      if (box && box.parentNode) box.remove();
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    };
    const ok = box.querySelector('#bpOk'), wl = box.querySelector('#bpWall');
    if (ok) ok.onclick = close;
    if (wl) wl.onclick = function () { close(); UI.go('grow'); };
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    if (ok) ok.focus({ preventScroll: true });
    setTimeout(close, 9000);
  }

  /* 升级：数据够格了就撒花 + 提示。Level 内部会记住已庆祝到的等级，不会重复弹 */
  function checkLevelUp() {
    if (!window.Level) return;
    try {
      const up = Level.checkUp();
      if (!up) return;
      if (window.FX) FX.confetti(90, { y: -20 });
      setTimeout(() => toast('🎉 升到 Lv' + up.to + '「' + up.title + '」，继续！'), 500);
    } catch (e) { }
  }

  /* ---------- 打卡后的视觉反馈 ---------- */
  function ringPct() {
    const el = $('ringPct');
    return el ? (parseInt(el.textContent, 10) || 0) : 0;
  }
  /* ---------- 连续里程碑庆祝（走查第 6 条） ----------
   * 3/7/14/21/30/50/100 天各庆祝一次，记进 settings.celebrated，不会重复弹。
   * 只在「当天真打卡」时触发：补卡走的是 daytick（直接 toggle，不过 afterCheck），
   * 所以补出来的连续不会庆祝 —— 补卡是补救，不是当天的努力。
   * 和「今天全部完成」同时发生时，先弹里程碑（更值得记住的一件事）。 */
  const CELEBRATE_DAYS = [3, 7, 14, 21, 30, 50, 100];
  const MS_EMOJI = { 3: '🌱', 7: '🔥', 14: '⚡', 21: '🧠', 30: '📅', 50: '🏔', 100: '👑' };
  const MS_WORD = {
    3: '三天了，习惯开始发芽',
    7: '七天不断，第一周拿下',
    14: '两周，已经有点样子了',
    21: '21 天，新版图上叫「起步完成」',
    30: '整月不断，这个月全勤',
    50: '五十天，多数人到这里就赢了',
    100: '一百天。百日传说'
  };
  function checkMilestone(onAllDone) {
    try {
      const n = Engine.globalStreak();
      if (CELEBRATE_DAYS.indexOf(n) < 0) return false;
      const done = Store.s.settings.celebrated || [];
      if (done.indexOf(n) >= 0) return false;
      Store.commit(s => { s.settings.celebrated = (s.settings.celebrated || []).concat([n]); });
      if (window.UX) UX.sfx('all');
      if (window.FX) FX.celebrate(100, '连续 ' + n + ' 天');
      showMilestonePop(n, onAllDone);
      return true;
    } catch (e) { return false; }
  }
  /* 复用徽章弹窗的样式（同一套 .badge-pop / .bp-*），不另造一套 CSS。
   * onClose：里程碑关掉后要做的事（同一天既到里程碑又全完成时，用来补弹「今天全部完成」）。 */
  function showMilestonePop(n, onClose) {
    let box = document.getElementById('msPop');
    if (box) box.remove();
    const prevFocus = document.activeElement;
    box = document.createElement('div');
    box.id = 'msPop';
    box.className = 'badge-pop';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '连续里程碑');
    box.innerHTML = '<div class="bp-in">' +
      '<div class="bp-ico" aria-hidden="true">' + (MS_EMOJI[n] || '🎉') + '</div>' +
      '<div class="bp-t">全站连续 ' + n + ' 天</div>' +
      '<div class="bp-n">' + U.esc(MS_WORD[n] || '又往前走了一步') + '</div>' +
      '<div class="bp-d">研究里养成一个习惯平均要 66 天 —— 这一段路你已经走了 ' + n + ' 天。</div>' +
      '<div class="bp-row"><button class="btn sm" id="msOk">收下</button>' +
      '<button class="btn sm ghost" id="msPoster">做张纪念日签</button></div></div>';
    document.body.appendChild(box);
    let closed = false;
    const close = function () {
      if (closed) return;
      closed = true;
      if (box && box.parentNode) box.remove();
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      if (onClose) { try { onClose(); } catch (e) { } }
    };
    const ok = box.querySelector('#msOk'), poster = box.querySelector('#msPoster');
    if (ok) ok.onclick = close;
    if (poster) poster.onclick = function () {
      close();
      UI.openPoster('连续 ' + n + ' 天 · ' + (MS_WORD[n] || ''));
    };
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    if (ok) ok.focus({ preventScroll: true });
    setTimeout(close, 12000);
  }

  /* 环形数字跳动 + 卡片弹动 + 彩纸；当日全部完成时全屏庆祝 */
  function afterCheck(it, o) {
    o = o || {};
    const pct = Engine.todayRate(U.today()).pct;
    if (window.FX) {
      FX.bump(document.querySelector('.ring-txt'), 'bump');
      FX.numRoll($('ringPct'), pct, 650, '', o.from);
    }
    if (!o.on) return;
    if (it) {
      const card = document.querySelector('.hitem[data-id="' + it.id + '"]');
      if (card) { card.classList.add('pop'); setTimeout(() => card.classList.remove('pop'), 620); }
    }
    if (window.FX && o.x != null) FX.pop(o.x, o.y, it && it.color);
    /* 里程碑优先于「今天全部完成」：同一天两件事时，先记住更难的那一件。
     * 若今天既到里程碑又全完成，先弹里程碑；里程碑关掉后再弹常规的「今天全部完成」。 */
    const fireAllDone = function () {
      if (window.UX) UX.sfx('all');
      if (window.FX) FX.celebrate(100, '今天全部完成 🎉');
      toast('今天全部完成 🎉');
      if (window.Plugins) Plugins.fire('allDone', '🎉 今天全部完成');
    };
    const msFired = o.on ? checkMilestone(pct === 100 ? fireAllDone : null) : false;
    /* 下一步引导（走查第 6 条）：首次打卡后该长出「去写日记」那条了。
     * patchToday 只重画卡片，这里单独把提示条补上。 */
    if (window.UI && UI.patchNextStep) UI.patchNextStep();
    if (pct === 100 && !msFired) fireAllDone();
  }

  /* ---------- 误触撤销：打卡后 8 秒内可反悔 ----------
   * 打卡是最高频动作，手滑一下就得多点两下改回来，很容易让人烦躁。
   * 5 秒对"正在走路 / 单手操作"的人来说太短，给到 8 秒；积分也连带退回，不留脏数据。 */
  let undoT = null;
  /* 通用撤销条：打卡和删视频共用同一条，后到的顶掉先到的（单例，不叠罗汉） */
  function offerUndoBar(text, label, onUndo, ms, extra) {
    const bar = $('undoBar');
    if (!bar) return;
    /* extra = { label, fn }：打卡后除了「撤销」还给一个「记一句」的入口。
     * 用现成的撤销条而不是新弹窗 —— 多一个浮层就多一次打断。 */
    bar.innerHTML = '<span class="ub-t">' + U.esc(text) + '</span>' +
      (extra ? '<button class="ub-b ghost" id="undoExtra" aria-label="' + U.esc(extra.label) + '">' + U.esc(extra.label) + '</button>' : '') +
      '<button class="ub-b" id="undoBtn" aria-label="' + U.esc(label) + '">' + U.esc(label) + '</button>';
    bar.classList.add('on');
    clearTimeout(undoT);
    undoT = setTimeout(hideUndo, ms || 5000);
    if (extra) {
      const ex = $('undoExtra');
      if (ex) ex.onclick = () => { try { extra.fn(); } finally { hideUndo(); } };
    }
    const btn = $('undoBtn');
    if (!btn) return;
    btn.onclick = () => {
      try { onUndo(); } finally { hideUndo(); }
    };
  }
  function offerUndo(it, date, previousLog) {
    offerUndoBar('已打卡 · ' + it.name, '撤销', () => {
      if (Engine.isDone(it, date)) {
        Engine.restoreLog(it, date, previousLog);
        Store.commit();
        if (!(window.UI && UI.patchToday && UI.patchToday(it.id))) UI.render();
      }
      toast('已撤销');
    }, 8000, { label: '记一句', fn: () => UI.openNoteSheet(it.id, date) });
  }
  function hideUndo() {
    const bar = $('undoBar');
    if (bar) bar.classList.remove('on');
    clearTimeout(undoT);
  }

  /* ---------- 动作分发 ---------- */
  /* 隐私锁设置弹窗里「锁定范围」的临时选择（不落盘，点「开启」才写进 settings） */
  let pinScope = 'all';
  const ACT = {
    /* 打卡 */
    tick(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      const date = U.today();
      const previous = Engine.getLog(date, it.id);
      const previousLog = previous ? Object.assign({}, previous, { steps: Object.assign({}, previous.steps) }) : null;
      const on = Engine.toggle(it, date);
      Store.commit();
      /* v47：手动取消一条自动勾上的记录 → 记一笔否决，别在下次打开时又给勾回来 */
      if (it.autoHealth && window.Health) {
        if (on) Health.unveto(date, it.id); else Health.veto(date, it.id);
      }
      if (window.UX) UX.sfx(on ? 'on' : 'off');
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      U.vibrate(on ? 14 : 8);
      if (on) hintNext(it.id);
      const from = ringPct();
      if (!(window.UI && UI.patchToday && UI.patchToday(it.id))) UI.render();
      afterCheck(it, { x: cx, y: cy, on, from });
      if (on) { offerUndo(it, date, previousLog); Plugins.fire('checkin', '✅ 打卡：' + it.name); }
      else hideUndo();
      pushRoom(); checkBadges();
      /* 打卡后顺手推进挑战进度：攒够天数就通关发奖 */
      if (window.Challenge) { const cl = Challenge.syncAll(); if (cl.length) toast('🎉 挑战完成：' + cl[0].name); }
    },
    /* 连点 +/−：走 keepMeta 的就地更新，DOM 节点不动，每一都算数 */
    plus(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      const step = it.type === 'duration' ? 5 : (it.unit === '升' ? 0.25 : 1);
      const was = Engine.isDone(it, U.today());
      Engine.addValue(it, U.today(), step);
      Store.commit();
      const from = ringPct();
      if (!UI.patchToday(it.id, { keepMeta: true })) UI.render();
      afterCheck(it, { on: !was && Engine.isDone(it, U.today()), from });
      pushRoom();
    },
    minus(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      const step = it.type === 'duration' ? 5 : (it.unit === '升' ? 0.25 : 1);
      Engine.addValue(it, U.today(), -step);
      Store.commit();
      const from = ringPct();
      if (!UI.patchToday(it.id, { keepMeta: true })) UI.render();
      afterCheck(it, { on: false, from });
    },
    async setval(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      const cur = Engine.getLog(U.today(), it.id);
      /* 原生 prompt 在 PWA 独立窗口里样式突兀、iOS 上还常被拦，换成自绘输入弹窗 */
      const raw = await UX.prompt({
        icon: it.emoji || '✏️',
        title: it.name + ' 今天完成了多少？',
        msg: it.unit ? '单位：' + it.unit + (it.target ? ' · 目标 ' + U.num(it.target) + ' ' + it.unit : '') : '',
        type: 'number', inputmode: 'decimal',
        value: (cur && cur.v) != null ? U.num(cur.v) : '',
        placeholder: '例如 ' + (it.type === 'duration' ? '30' : '1.5'),
        ok: '记下', cancel: '取消'
      });
      if (raw === null) return;
      const n = raw.trim() ? Number(raw) : NaN;
      if (!Number.isFinite(n) || n < 0) { toast('请填一个有效的非负数字'); return; }
      const was = Engine.isDone(it, U.today());
      Engine.setValue(it, U.today(), n);
      Store.commit();
      UX.sfx('tap');
      const from = ringPct();
      if (!UI.patchToday(it.id)) UI.render();
      afterCheck(it, { on: !was && Engine.isDone(it, U.today()), from });
    },
    step(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      const was = Engine.isDone(it, U.today());
      Engine.toggleStep(it, U.today(), +el.dataset.i);
      Store.commit();
      const from = ringPct();
      if (!UI.patchToday(it.id)) UI.render();
      afterCheck(it, { on: !was && Engine.isDone(it, U.today()), from });
    },
    runbundle(el) {
      const b = Store.s.bundles.find(x => x.id === el.dataset.id);
      if (!b) return;
      const on = Engine.runBundle(b);
      Store.commit();
      const r = el.getBoundingClientRect();
      const from = ringPct();
      if (!UI.patchToday(b.itemIds || [])) UI.render();
      afterCheck(null, { x: r.left + r.width / 2, y: r.top + r.height / 2, on, from });
      toast(on ? '「' + b.name + '」一键完成' : '已撤销');
      U.vibrate(16);
      pushRoom();
    },
    mood(el) {
      const v = +el.dataset.v;
      Store.commit(s => { s.moods[U.today()] = v; });
      UI.render();
    },
    addphoto() { pickFile('image/*', savePhoto); },
    addaudio() { recordAudio(); },

    /* ---- 日记本 ---- */
    dyview(el) { flushDiary(); UI.setDiaryView(el.dataset.v); UI.render(); },
    dyday(el) {
      /* 遮罩开着时第一次轻触只揭开这一条：连着点两次才觉得「怎么点不动」比多一次点击更烦 */
      if (el.classList.contains('masked')) { el.classList.remove('masked'); const m = el.querySelector('.dy-mask'); if (m) m.remove(); return; }
      flushDiary(); UI.setDiaryDate(el.dataset.d); UI.render();
    },
    dyprev(el) { flushDiary(); UI.setDiaryDate(U.shiftYmd(el.dataset.d, -1)); UI.render(); },
    dynext(el) {
      const d = U.shiftYmd(el.dataset.d, 1);
      if (d > U.today()) return toast('还没到那天');
      flushDiary();
      UI.setDiaryDate(d); UI.render();
    },
    dytoday() { flushDiary(); UI.setDiaryDate(null); UI.render(); },
    godiary() { UI.setDiaryDate(null); UI.setDiaryView('write'); UI.go('diary'); },
    dymore() { UI.diaryMore(); UI.render(); },
    dycal(el) { UI.setDiaryMonth(el.dataset.m); UI.render(); },

    /* 搜索：防抖 400ms 后重绘，重绘完把光标还回输入框（否则打一个字就失焦） */
    dysearch(el) {
      const v = el.value;
      clearTimeout(_dsTimer);
      _dsTimer = setTimeout(() => {
        UI.setDiaryQuery(v);
        UI.render();
        const box = document.getElementById('dySearch');
        if (box) {
          box.focus();
          try { box.setSelectionRange(v.length, v.length); } catch (e) { }
        }
      }, 400);
    },
    dyclearsearch() { UI.setDiaryQuery(''); UI.render(); },
    dyfoldmonth() { UI.toggleMonthFold(); UI.render(); },
    async dyexportmonth(el) {
      const m = el.dataset.m;
      const r = Diary.exportMarkdown(m + '-01', m + '-31');
      if (!r.n) return toast('那个月还没有记录');
      U.download('日拱一卒-日记-' + m + '.md', r.text, 'text/markdown;charset=utf-8');
      toast('已导出 ' + r.n + ' 天');
    },
    dysetcover(el) {
      Diary.setCover(UI.diaryState().date, el.dataset.id);
      UI.closeSheet(); UI.render(); toast('已设为封面');
    },

    dymood(el) {
      Diary.setMood(UI.diaryState().date, +el.dataset.v);
      UI.render();
    },

    /* 正文：输入即存（500ms 防抖），不用点保存 */
    dytext(el) {
      const d = UI.diaryState().date;
      const text = el.value;
      _dyPending = { date: d, text };
      clearTimeout(_dyTimer);
      _dyTimer = setTimeout(() => {
        Diary.setText(d, text);
        _dyPending = null;
        const c = document.getElementById('dyCount');
        if (c) c.textContent = el.value.length;
      }, 500);
    },

    dyaddphoto() {
      const d = UI.diaryState().date;
      if (Diary.countPhotos(d) >= Diary.MAX_PHOTOS) {
        return toast('每天最多 ' + Diary.MAX_PHOTOS + ' 张，删掉几张再来');
      }
      pickFile('image/*', f => savePhoto(f, d));
    },

    dyphoto(el) {
      const id = el.dataset.id;
      const d = UI.diaryState().date;
      const isCover = Diary.coverOf(d) === id;
      UI.sheet('照片',
        '<div class="field"><label>查看与顺序</label><div class="row">' +
        '<button class="btn" data-act="viewphoto" data-id="' + id + '">查看原图</button>' +
        '<button class="btn ghost" data-act="dymove" data-id="' + id + '" data-dir="-1">← 前移</button>' +
        '<button class="btn ghost" data-act="dymove" data-id="' + id + '" data-dir="1">后移 →</button>' +
        '</div></div>' +
        '<div class="field"><label>封面</label>' +
        (isCover
          ? '<button class="btn ghost" style="width:100%" data-act="dysetcover" data-id="">取消封面（用第一张）</button>'
          : '<button class="btn" style="width:100%" data-act="dysetcover" data-id="' + id + '">★ 设为这天封面</button>') +
        '<div class="muted" style="margin-top:8px">封面是时间轴上露的那张图，选最好看的一张。</div></div>' +
        '<button class="btn danger" style="width:100%;margin-top:12px" data-act="dydelphoto" data-id="' + id + '">删除这张照片</button>');
    },
    dymove(el) {
      Diary.movePhoto(UI.diaryState().date, el.dataset.id, +el.dataset.dir);
      UI.closeSheet(); UI.render();
    },
    dydelphoto(el) {
      Diary.removePhoto(UI.diaryState().date, el.dataset.id);
      UI.closeSheet(); UI.render(); toast('已删除');
    },

    /* ---- 视频 ---- */
    addvideo() {
      const d = U.today();
      if (Diary.countVideos(d) >= Diary.MAX_VIDEOS) {
        return toast('每天最多 ' + Diary.MAX_VIDEOS + ' 条视频，去日记页删掉一条再来');
      }
      pickFile('video/*', f => saveVideo(f, d));
    },
    dyaddvideo() {
      const d = UI.diaryState().date;
      if (Diary.countVideos(d) >= Diary.MAX_VIDEOS) {
        return toast('每天最多 ' + Diary.MAX_VIDEOS + ' 条视频，删掉一条再来');
      }
      pickFile('video/*', f => saveVideo(f, d));
    },
    dyvideo(el) {
      const id = el.dataset.id;
      const d = UI.diaryState().date;
      const v = ((Diary.raw(d) || {}).videos || []).find(x => x.id === id) || {};
      UI.sheet('视频',
        '<div class="muted">' + (v.dur ? '时长 ' + U.dur(v.dur) + ' · ' : '') +
        '存于' + ((Store.s.media[id] || {}).cloud ? '云端' : '本机') + '</div>' +
        '<div class="row" style="margin-top:12px">' +
        '<button class="btn" data-act="dyplayvideo" data-id="' + id + '">▶ 播放</button>' +
        '</div>' +
        '<button class="btn danger" style="width:100%;margin-top:12px" data-act="dydelvideo" data-id="' + id + '">删除这段视频</button>');
    },
    async dyplayvideo(el) {
      const id = el.dataset.id;
      UI.closeSheet();
      toast('正在载入…');
      try {
        const url = await Store.mediaURL(id, true);
        if (!url) return toast('这段视频还没同步回来，联网后再试');
        videoPlayer(url, U.prettyDate(UI.diaryState().date));
      } catch (e) { toast('播放失败：' + e.message); }
    },
    async dydelvideo(el) {
      const id = el.dataset.id;
      const ok = await UX.confirm({
        icon: 'film', danger: true, title: '删除这段视频？',
        html: '视频和它的封面会一起删掉。' +
          '<div class="cf-sub">删掉后 5 秒内还能撤销；过了就找不回来了。同一天的其他照片、文字、语音不受影响。</div>',
        ok: '删除', cancel: '再想想'
      });
      if (!ok) return;
      const r = Diary.removeVideo(UI.diaryState().date, id);
      UI.closeSheet(); UI.render();
      if (!r || !r.ok) return toast('这条视频已经不在了');
      offerUndoBar('已删除视频', '撤销', () => {
        const u = Diary.undoRemoveVideo();
        if (u.ok) { UI.render(); toast('已恢复'); }
        else toast('这段视频已无法恢复');
      }, 5000);
    },

    dyweather() {
      const d = UI.diaryState().date;
      const cur = (Diary.raw(d) || {}).weather;
      UI.sheet('天气',
        '<div class="field"><label>' + U.prettyDate(d) + '</label>' +
        '<div class="row" style="flex-wrap:wrap">' +
        Diary.WEATHER.map(w => '<button class="btn sm' + (cur && cur.k === w.k ? '' : ' ghost') +
          '" data-act="dypickweather" data-k="' + w.k + '">' + w.e + ' ' + w.n + '</button>').join('') +
        '</div></div>' +
        '<div class="row"><button class="btn ghost" data-act="dyreweather">重新获取</button>' +
        '<button class="btn ghost" data-act="dyclearweather">清除</button></div>' +
        '<div class="muted" style="margin-top:10px">自动获取只精确到城市，不记录你的具体位置；获取不到就留空，手动点一个也行。</div>');
    },
    dypickweather(el) {
      Diary.setWeather(UI.diaryState().date, { k: el.dataset.k, t: '', city: '', auto: 0 });
      UI.closeSheet(); UI.render();
    },
    async dyreweather() {
      toast('正在获取天气…');
      const w = await Diary.fetchWeather();
      if (!w) return toast('没获取到，手动选一个吧');
      Diary.setWeather(UI.diaryState().date, w);
      UI.closeSheet(); UI.render(); toast('已更新');
    },
    dyclearweather() {
      Diary.clearWeather(UI.diaryState().date);
      UI.closeSheet(); UI.render();
    },

    async dyaddaudio() { await recordAudio(UI.diaryState().date); },
    async dylistaudio() {
      const d = UI.diaryState().date;
      const list = ((Diary.raw(d) || {}).audios) || [];
      if (!list.length) return toast('这天没有语音');
      UI.sheet('语音 · ' + list.length + ' 条', list.map((a, i) =>
        '<div class="line-cell"><span>🎤</span>' +
        '<div style="flex:1"><div class="k">第 ' + (i + 1) + ' 条</div><div class="s">' + U.hhmm(a.ts || Date.now()) + '</div></div>' +
        '<button class="btn sm" data-act="dyplayaudio" data-id="' + a.id + '">播放</button>' +
        '<button class="btn sm ghost" data-act="dydelaudio" data-id="' + a.id + '">删除</button></div>').join(''));
    },
    async dyplayaudio(el) {
      try {
        const url = await Store.mediaURL(el.dataset.id, true);
        if (!url) return toast('这条语音还没同步回来');
        const a = new Audio(url);
        await a.play();
      } catch (e) { toast('播放失败：' + e.message); }
    },
    dydelaudio(el) {
      const d = UI.diaryState().date;
      const id = el.dataset.id;
      Store.commit(s => {
        const n = s.notes[d];
        if (n && n.audios) n.audios = n.audios.filter(x => x.id !== id);
      });
      if (Store.dropThumb) Store.dropThumb(id);
      UI.closeSheet(); UI.render(); toast('已删除');
    },

    /* v35 · 复盘三问：点一下就插进正文，走和手打一样的 input 事件（自动保存） */
    dyreview(el) {
      const ta = document.getElementById('dyText');
      const i = Number(el.dataset.i);
      const q = (window.UI && UI.REVIEW_Q) ? UI.REVIEW_Q[i] : null;
      if (!ta || !q) return;
      const cur = ta.value;
      ta.value = cur ? (cur.replace(/\s+$/, '') + '\n' + q.q + '\n') : (q.q + '\n');
      try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { }
      const c = document.getElementById('dyCount');
      if (c) c.textContent = String(ta.value.length);
      ta.focus();
      toast('已插入「' + q.label + '」，接着写就行');
    },
    /* 遮罩开关：只影响时间轴的显示，不改数据 */
    dymask() {
      Store.commit(s => { s.settings.diaryMask = s.settings.diaryMask ? 0 : 1; });
      UI.render();
      toast(S().settings.diaryMask ? '日记已遮罩，轻触某一条才显示' : '遮罩已关');
    },
    /* 遮罩开着时，卡片上的第一次轻触只揭开这一条，不跳转 */
    dyreveal(el) {
      el.classList.remove('masked');
      const m = el.querySelector('.dy-mask');
      if (m) m.remove();
    },
    async dyexportmd() {
      toast('正在生成…');
      try {
        const r = Diary.exportMarkdown();
        if (!r.n) return toast('还没有可导出的日记');
        U.download('日拱一卒-日记-' + U.today() + '.md', r.text, 'text/markdown;charset=utf-8');
        toast('已导出 ' + r.n + ' 天');
      } catch (e) { toast('导出失败：' + e.message); }
    },
    async viewphoto(el) {
      toast('正在载入原图…');
      const url = await Store.mediaURL(el.dataset.id, true);
      if (!url) return toast('载入失败，可能已被清理');
      lightbox(url);
    },

    /* 习惯 */
    newhabit() { UI.openHabit(null); },
    edit(el) { UI.openHabit(findItem(el.dataset.id)); },
    savehabit(el) {
      const id = el.dataset.id;
      const data = UI.collectHabit(id);
      /* 校验放在这里（而不是输入框上）：名字、重名、目标值这些要跨字段判断，
       * 逐字段的 required 拦不住，也说不清为什么不能存。 */
      const err = UI.validateHabit ? UI.validateHabit(data, id) : '';
      if (err) { UI.formError(err, /名字/.test(err) ? 'fName' : ''); return; }
      if (id) Feat.updateItem(id, data); else Feat.addItem(data);
      /* v47：刚设上「健康数据自动勾选」就立刻判一次 —— 数据早就导过了，
       * 还让用户等到下次打开才生效，会以为没起作用。 */
      if (data.autoHealth) runHealthAuto();
      UI.closeSheet(); UI.render();
      if (id) return toast('已保存');
      /* v37 · 一次只加一个新习惯。
       * 市面横评里一条反复出现的经验：同时上线 4 个以上新习惯，失败率明显上升；
       * 更稳的节奏是等上一个稳定两周再加。这里不拦人，只在第 4 个时劝一次，
       * 而且只劝一次（记在 settings 里）—— 劝第二次就成唠叨了。 */
      const n = (Store.s.items || []).filter(x => !x.deleted && !x.archived).length;
      if (n >= 4 && !Store.s.settings.multiHintShown) {
        Store.commit(s => { s.settings.multiHintShown = 1; });
        return toast('现在有 ' + n + ' 个习惯了。研究里同时上 4 个以上，失败率会明显变高 —— 先把前几个稳住，两周后再加新的也不迟', 6500);
      }
      toast('习惯已创建');
    },
    /* 排序：上移 / 下移。顺序就是今日页的显示顺序 */
    moveup(el) { moveHabit(el.dataset.id, -1); },
    movedown(el) { moveHabit(el.dataset.id, 1); },
    /* v56 · 交互走查：习惯多时「上移一位」要点 N 次（菜单注释自己都说排序是最高频操作）。
     * 补「移到最前/最后」两个直达项；拖拽手柄会和右滑/长按手势打架，不做。 */
    movetop(el) { moveHabitTo(el.dataset.id, 'top'); },
    movebottom(el) { moveHabitTo(el.dataset.id, 'bottom'); },
    /* 习惯页「⋯」：排序 / 编辑 / 计时都收在这里，卡片上只留名字和状态 */
    habitmenu(el) { UI.openHabitMenu(el.dataset.id, el.dataset.from); },
    archivehabit(el) {
      Feat.updateItem(el.dataset.id, { archived: true });
      UI.closeSheet(); UI.render(); toast('已归档');
    },
    async delhabit(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      let n = 0;
      Object.values(Store.s.logs || {}).forEach(d => { if (d[it.id] && d[it.id].d) n++; });
      const ok = await UX.confirmDelete(it.name,
        '这个习惯的 ' + n + ' 条打卡记录会一起删除，无法找回。只是想暂时停用，用「归档」更合适。');
      if (!ok) return;
      Feat.removeItem(el.dataset.id);
      UI.closeSheet(); UI.render(); toast('已删除');
    },
    unarchive(el) { Feat.updateItem(el.dataset.id, { archived: false }); UI.render(); },
    parseone() {
      const txt = ($('oneInput') || {}).value || '';
      if (!txt.trim()) return toast('先写一句话');
      const d = Parse.habit(txt);
      $('parsePreview').innerHTML =
        '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:10px">' +
        '<div style="font-weight:650">' + U.esc(d.name) + '</div>' +
        '<div class="muted" style="margin-top:4px">类型：' + ({ check: '打卡', number: '计数', duration: '时长' })[d.type] +
        (d.target ? ' · 目标 ' + d.target + d.unit : '') + ' · ' + d.slot + ' · 提醒 ' + (d.reminderAt || '无') + '</div>' +
        '<div class="row end" style="margin-top:10px"><button class="btn sm" data-act="confirmparse">确认创建</button></div></div>';
      window._draft = d;
    },
    confirmparse() {
      const d = window._draft;
      if (!d) return;
      Feat.addItem(d);
      window._draft = null;
      UI.render(); toast('已创建：' + d.name);
    },
    /* ---------- 首次进入引导 ---------- */
    /* v20：单选一个 —— 点到别的就换选，不再多选。首日只建 1 个习惯 */
    opentools() { UI.openTools(); },
    obpick(el) {
      /* 选中态唯一入口：class 与 aria-pressed 由同一个函数写，
         否则会出现「视觉换了人、读屏还在上一个」的漂移（v25 复检 5.1）。 */
      const group = document.getElementById('obChips');
      const on = !el.classList.contains('on');
      if (!on) { el.classList.remove('on'); el.setAttribute('aria-pressed', 'false'); return; }
      UI.setSelected(group, el);
    },
    obstart() {
      const picked = [].slice.call(document.querySelectorAll('#obChips .chip.on'))
        .map(c => Feat.LIB[+c.dataset.i]).filter(Boolean);
      if (!picked.length) { toast('至少挑一个吧 🙂'); return; }
      // 用户自己挑了，就把示例习惯收起来，别一上来就七八个（能走到这里说明还没有任何打卡记录）
      Store.commit(s => { s.items.forEach(it => { it.deleted = true; }); });
      picked.slice(0, 1).forEach(t => Feat.addItem(Object.assign({}, t)));
      Store.commit(s => { s.settings.onboarded = 1; });
      UI.closeSheet(); UI.go('today');
      toast('已创建「' + picked[0].name + '」，从今天开始；别的随时能加 🌱');
    },
    /* 「先用推荐的 4 个」：v24 起全新默认是空状态，所以这 4 个示例从这里建出来，
     * 而不是像以前那样硬编码在 defaultState 里（会被渲染成用户自己的习惯）。 */
    obskip() {
      const RECOMMENDED = [
        { name: '早起', type: 'check', slot: 'morning', reminderAt: '07:00', tags: ['健康'], schedule: { type: 'daily' }, color: '#BA7517' },
        { name: '运动', type: 'number', target: 30, unit: '分钟', slot: 'evening', reminderAt: '19:00', tags: ['运动'], schedule: { type: 'timesPerWeek', n: 3 }, color: '#1D9E75' },
        { name: '读书', type: 'duration', target: 30, unit: '分钟', slot: 'evening', reminderAt: '21:00', tags: ['学习'], schedule: { type: 'daily' }, color: '#7F77DD' },
        { name: '喝水', type: 'number', target: 1.5, unit: '升', slot: 'afternoon', reminderAt: '15:00', tags: ['健康'], schedule: { type: 'daily' }, color: '#378ADD' }
      ];
      RECOMMENDED.forEach(t => Feat.addItem(Object.assign({ steps: [] }, t)));
      Store.commit(s => { s.settings.onboarded = 1; });
      UI.closeSheet(); UI.go('today');
      toast('已帮你建好 4 个示例，先跑通一个正循环 🌱');
    },
    libadd(el) {
      const t = Feat.LIB[+el.dataset.i];
      Feat.addItem(Object.assign({}, t));
      UI.render(); toast('已添加：' + t.name);
    },
    packadd(el) {
      const p = Feat.PACKS[+el.dataset.p];
      if (!p) return;
      const r = Feat.applyPack(p);
      UI.render();
      toast('已导入「' + p.name + '」：新建 ' + r.added + ' 个' + (r.reused ? '，复用已有 ' + r.reused + ' 个' : '') + '，已打成一个套餐');
    },

    /* 套餐 */
    newbundle() { UI.openBundle(null); },
    editbundle(el) { UI.openBundle(Store.s.bundles.find(x => x.id === el.dataset.id)); },
    async delbundle(el) {
      const b = Store.s.bundles.find(x => x.id === el.dataset.id);
      if (!b) return;
      const ok = await UX.confirmDelete(b.name, '套餐本身会被删除，里面的习惯不受影响。');
      if (!ok) return;
      Feat.removeBundle(el.dataset.id); UI.render();
    },
    savebundle(el) {
      const id = el.dataset.id;
      const name = ($('bName').value || '').trim() || '新套餐';
      const emoji = (document.querySelector('#bEmoji .chip.on') || {}).dataset.fe || '🧩';
      const itemIds = [...document.querySelectorAll('#bItems .chip.on')].map(b => b.dataset.fi);
      if (!itemIds.length) return toast('至少选一个习惯');
      if (id) Feat.updateBundle(id, { name, emoji, itemIds });
      else Feat.addBundle({ name, emoji, itemIds });
      UI.closeSheet(); UI.render(); toast('套餐已保存');
    },
    presetbundle(el) {
      const p = Feat.BUNDLE_PRESET[+el.dataset.i];
      Feat.applyPreset(p);
      UI.render(); toast('已创建套餐：' + p.name);
    },

    /* 番茄钟 */
    openpomo() { UI.openPomo(); },
    /* 下一步引导（走查第 6 条）：点了哪一步，那一步就算做过了，按需跳转。
     * × = 整条链永久关闭。两者都写进 settings.nextStep，重绘不会回来。 */
    nextstepdone(el) {
      const tip = el && el.closest ? el.closest('.ns-tip') : null;
      const step = tip ? tip.dataset.step : '';
      Store.commit(s => {
        s.settings.nextStep = s.settings.nextStep || {};
        s.settings.nextStep.done = (s.settings.nextStep.done || []).concat([step]);
      });
      UI.render();
      if (step === 'diary') { UI.setDiaryDate(null); UI.setDiaryView('write'); UI.go('diary'); }
      else if (step === 'grow') { UI.closeSheet(); UI.go('grow'); }
    },
    nextstepoff() {
      Store.commit(s => {
        s.settings.nextStep = s.settings.nextStep || {};
        s.settings.nextStep.off = 1;
      });
      UI.render();
      toast('已关闭下一步提示，随时可以在「我的」里找到这些功能');
    },
    /* 手机端合并提示条的 ×（走查第 9 条）：搭子 / 备份 / 换地址一行一个，
     * 关掉之后 7 天内不再出现，不是永久关闭 —— 备份提醒该回来时还是会回来。 */
    hintsnooze() {
      Store.commit(s => { s.settings.hintSnoozeAt = Date.now(); });
      UI.render();
      toast('7 天内不再提示这些');
    },
    pomohabit(el) { Feat.Pomo.habitId = el.dataset.id || ''; UI.openPomo(); },
    pomostart() {
      if (Feat.Pomo.mode === 'idle') {
        const len = +($('pomoLen') || {}).value || 25;
        Store.commit(s => { s.settings.pomoLen = len; });
        Feat.Pomo.start(len, '专注', Feat.Pomo.habitId);
      } else Feat.Pomo.stop();
      UI.openPomo();
    },
    pomobreak() {
      const len = +($('breakLen') || {}).value || 5;
      Store.commit(s => { s.settings.breakLen = len; });
      Feat.Pomo.start(len, '休息');
      UI.closeSheet();
      toast('开始休息 ' + len + ' 分钟');
    },

    /* 积分 */
    rewards() { UI.openRewards(); },
    redeem(el) {
      const r = Store.s.rewards.find(x => x.id === el.dataset.id);
      if (!r) return;
      if (Engine.points() < r.cost) return toast('积分不够');
      const rec = { id: U.uid('rd'), rewardId: r.id, name: r.name, cost: r.cost, at: Date.now() };
      Store.commit(s => { s.redemptions.push(rec); });
      UI.openRewards(); UI.render();
      /* v56 · 交互走查：兑换原来没有任何确认/撤销 —— 误触（按钮旁边就是删除）
       * 会白扣积分且无从反悔，而后果轻得多的「删除奖励」反而有确认，轻重倒挂。
       * 这里用和打卡同款的撤销条（单例、8 秒），点撤销整笔退回，不留脏数据。
       * 兑换奖励是自我契约里最开心的时刻，顺手撒一小把彩纸。 */
      if (window.FX && FX.confetti) FX.confetti(45, { y: -12 });
      U.vibrate(10);
      offerUndoBar('已兑换 · ' + r.name + '（-' + r.cost + ' 分）', '撤销', () => {
        Store.commit(s => { s.redemptions = s.redemptions.filter(x => x.id !== rec.id); });
        UI.openRewards(); UI.render();
        toast('已撤销，积分退回');
      }, 8000);
    },
    async delreward(el) {
      const r = Store.s.rewards.find(x => x.id === el.dataset.id);
      if (!r) return;
      const ok = await UX.confirmDelete(r.name, '兑换记录会保留，但奖励本身删除后不可恢复。');
      if (!ok) return;
      Store.commit(s => { s.rewards = s.rewards.filter(x => x.id !== el.dataset.id); });
      UI.openRewards();
    },
    addreward() {
      const n = ($('rwName').value || '').trim();
      const c = +($('rwCost').value || 0);
      if (!n || !c) return toast('填写名称和分值');
      Store.commit(s => { s.rewards.push({ id: U.uid('rw'), name: n, cost: c, emoji: '🎁', createdAt: Date.now() }); });
      UI.openRewards();
    },

    /* 海报 */
    poster() { UI.openPoster(); },
    yearposter() { UI.openYearPoster(); },

    /* 关于 / 帮助 / 反馈 */
    about() { UI.openAbout(); },
    feedback() { UI.openFeedback(); },
    /* 走查第 12 条：反馈要有明确收件箱。「打开邮件」把收件人、主题、
     * 诊断信息一次带齐，用户只补一句「我做了什么」。 */
    mailus() {
      const href = UI.mailtoHref();
      if (!href) return;
      try { location.href = href; } catch (e) { toast('请手动发到 ' + UI.feedbackEmail()); }
    },
    copymail() {
      copy(UI.feedbackEmail());
      toast('邮箱已复制');
    },
    async copydiag() {
      const txt = UI.diagText();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
        else {
          const ta = document.createElement('textarea');
          ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); ta.remove();
        }
        toast('诊断信息已复制，粘贴给我们即可');
      } catch (e) { toast('复制失败，请手动长按选中复制'); }
    },

    /* 异常记录：只展示类型 / 消息 / 时间，不含任何用户内容 */
    errlog() {
      const list = window.ErrLog ? ErrLog.all() : [];
      if (!list.length) { toast('暂无异常记录'); return; }
      const rows = list.slice().reverse().map(e => {
        const t = new Date(e.at);
        const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
        const day = (t.getMonth() + 1) + '/' + t.getDate();
        const msg = U.esc(String(e.msg).split('\n')[0].slice(0, 160));
        return '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-bottom:8px">' +
          '<div class="muted" style="font-size:12px">' + day + ' ' + hh + ' · ' + U.esc(e.kind) + ' · v' + U.esc(e.v || '') + '</div>' +
          '<div style="margin-top:5px;font-size:13px;line-height:1.6;word-break:break-all">' + msg + '</div>' +
          '</div>';
      }).join('');
      UI.sheet('异常记录 · ' + list.length + ' 条',
        '<div class="muted" style="line-height:1.7;margin-bottom:10px">' +
        '这些是本机运行过程中记录到的异常，<b>只有出错类型和消息，不含你的日记与打卡内容</b>。' +
        '反馈问题时点下面「复制诊断信息」，会连最近 3 条一起带上。</div>' +
        rows +
        '<div class="row" style="margin-top:12px">' +
        '<button class="btn block" data-act="copydiag">复制诊断信息</button></div>' +
        '<div class="row" style="margin-top:8px">' +
        '<button class="btn ghost block" data-act="errlogclear">清除全部异常记录</button></div>'
      );
    },
    errlogclear() {
      if (window.ErrLog) ErrLog.clear();
      UI.closeSheet();
      UI.render();
      toast('已清除异常记录');
    },
    saveposter() {
      const c = $('posterCanvas');
      if (!c) return;
      try {
        const url = c.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url; a.download = '日拱一卒-' + U.today() + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        toast('已保存到下载目录');
      } catch (e) { toast('保存失败：' + e.message); }
    },

    /* 记录 */
    /* 注意：这里的「保存笔记」和「单次打卡备注」共用 savenote 这个动作名，
     * 具体走哪条路由 handler 里按 data-id 分流（v28 修：v27 加备注时不小心把这个覆盖了，
     * 导致「保存笔记」按钮点了只关面板、内容丢掉）。 */

    /* 数据 */
    /* 注意：点击委托会把这个元素当第一个参数传进来（UX.busy 里 fn(el)），
     * 所以这里必须先判类型，否则「导出备份」这一格永远跳过「全量 / 只导文字」的选择，
     * 直接按「有值=含媒体」全量导出（v41 修）。 */
    async export(arg) {
      let withMedia = (typeof arg === 'boolean') ? arg : undefined;
      /* 自救卡里直接给的是"纯文字快速导出"，不再问一遍 */
      if (withMedia === undefined) {
        withMedia = await UX.confirm({
          icon: 'package', title: '导出备份',
          html: '<b>全量导出</b>：包含照片、视频和语音，文件较大，适合换设备整体搬家。<br>' +
            '<b>只导文字</b>：体积小，适合日常留底。<div class="cf-sub">两种都包含全部打卡记录和日记文字。</div>',
          ok: '全量导出（含照片视频语音）', cancel: '只导文字'
        });
      }
      toast('正在打包…');
      try {
        const data = withChecksum(await Store.exportJSON(withMedia));
        const name = '日拱一卒-备份-' + U.today().replace(/-/g, '') + '.json';
        const text = JSON.stringify(data);
        const how = await U.saveTextFile(name, text, 'application/json');
        if (how === 'fail') return toast('保存失败，请换用电脑浏览器导出');
        /* 只有真的存出去了才记时间，否则"该备份了"的提醒会被误判成已完成 */
        Store.commit(s => { s.settings.lastBackupAt = Date.now(); });
        /* 视频太大被跳过时要说出来 —— 让用户以为"全都备份好了"才是最危险的 */
        if (data.mediaNote) return toast('已导出，但' + data.mediaNote);
        toast(how === 'share' ? '已保存（可在分享面板里存到文件或发给自己）'
          : how === 'clipboard' ? '已复制到剪贴板，粘到备忘录里保存即可'
            : '已导出到下载目录');
      } catch (e) { toast('导出失败：' + e.message); }
    },
    import() { pickFile('.json,application/json', importFile); },
    /* v36 · 密码加密导出（外部评审 P1-4 最后一条）。
     * 顺序刻意是「先选范围、再设密码」：密码要输两遍，先让人知道自己在导什么，
     * 免得输完密码才发现文件几百 MB 想反悔。 */
    async exportenc() {
      if (!window.Enc || !Enc.available()) {
        return toast('这个地址不支持加密导出（加密需要 https 或本机地址打开）');
      }
      const withMedia = await UX.confirm({
        icon: 'lock', title: '加密导出',
        html: '<b>连照片语音一起</b>：换设备整体搬家用，文件较大。<br>' +
          '<b>只导文字</b>：体积小，日常留底够用。' +
          '<div class="cf-sub">两种都会用你的密码加密，别人拿到文件也打不开。</div>',
        ok: '连照片语音一起', cancel: '只导文字'
      });
      const pw = await askPassword();
      if (!pw) return;
      toast('正在加密…');
      try {
        const data = withChecksum(await Store.exportJSON(withMedia));
        const plainText = JSON.stringify(data);
        const env = await Enc.encrypt(plainText, pw);
        /* 恢复校验：先用同一个密码解一遍再落盘。
         * 解不开就说明这份文件将来也打不开，宁可不存 —— 让用户以为"备份好了"最危险。 */
        let plain = null;
        try { plain = await Enc.decrypt(env, pw); } catch (e) { plain = null; }
        if (!plain || plain.length !== plainText.length) {
          return toast('加密自检没通过，这份文件没有存出去，请重试');
        }
        const name = '日拱一卒-加密备份-' + U.today().replace(/-/g, '') + '.json';
        const how = await U.saveTextFile(name, JSON.stringify(env), 'application/json');
        if (how === 'fail') return toast('保存失败，请换用电脑浏览器导出');
        Store.commit(s => { s.settings.lastBackupAt = Date.now(); });
        if (data.mediaNote) return toast('已加密导出，但' + data.mediaNote);
        toast('已加密导出 · 密码别丢，忘了这份文件就打不开了');
      } catch (e) { toast('加密导出失败：' + e.message); }
    },
    /* 提示条上的一键导出：不弹选择，直接用「只导文字」快速留底。
     * 提示条的目的是"让用户现在就把备份存下来"，多一次选择就多一次放弃的理由。
     * 想连照片一起搬家的用户，从「我的 → 导出备份」走完整流程。 */
    quickexport() { ACT.export(false); },
    /* 提示条的"✕"：关掉就记住，别每次开屏都来一遍 */
    dismisscloudhint() { Store.commit(s => { s.settings.cloudHintOff = 1; }); UI.render(); },
    dismissmovedhint() { Store.commit(s => { s.settings.movedHintOff = 1; }); UI.render(); },
    dismissbackuphint() { Store.commit(s => { s.settings.backupHintOff = 1; }); UI.render(); },

    /* ---------- 隐私锁（v46 · 对标 Habitify Privacy Lock） ---------- */
    locksetup() { UI.openLockSetup(); },
    pinscope(el) {
      pinScope = el && el.dataset && el.dataset.v === 'diary' ? 'diary' : 'all';
      const all = document.querySelectorAll('[data-act="pinscope"]');
      for (let i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i].dataset.v === pinScope);
    },
    locksave() {
      const a = $('pin1'), b = $('pin2'), err = $('pinErr');
      const p1 = ((a && a.value) || '').trim(), p2 = ((b && b.value) || '').trim();
      if (!/^\d{4,8}$/.test(p1)) { if (err) err.textContent = '请用 4–8 位数字'; return; }
      if (p1 !== p2) { if (err) err.textContent = '两次输入不一致'; return; }
      if (!window.Lock) return;
      Lock.setPin(p1, pinScope).then(function () {
        UI.closeSheet(); UI.render(); toast('隐私锁已开启');
      }, function (e) { if (err) err.textContent = (e && e.message) || '设置失败'; });
    },
    /* 关闭必须先验密码：不然谁拿到你解锁的手机都能一键关掉 */
    locktogg() { UI.openLockOff(); },
    lockoff() {
      const el = $('pinOff'), err = $('pinOffErr');
      const v = ((el && el.value) || '').trim();
      if (!v) { if (err) err.textContent = '请输入当前密码'; return; }
      Lock.disable(v).then(function () {
        UI.closeSheet(); UI.render(); toast('隐私锁已关闭');
      }, function (e) { if (err) err.textContent = (e && e.message) || '密码不对'; });
    },
    locknow() { if (window.Lock) { Lock.lockNow(); Lock.gate(function () { }); } },

    /* ---- 数据安全网：自救 / 快照回滚 ---- */
    rescueexport() { ACT.export(false); },          // 页面已经崩了，只走纯文字快速导出，别再弹选择
    rescueretry() { location.reload(); },
    async snaprestore(el) {
      const d = el.dataset.d;
      const ok = await UX.confirm({
        icon: 'refresh', danger: true, title: '回到 ' + U.prettyDate(d) + ' 的状态？',
        html: '会把全部数据替换成那天的备份。<b style="color:var(--danger)">之后新增的打卡和日记会丢失。</b>' +
          '<div class="cf-sub">当前状态也会先存一份快照，回滚后还能再回滚回来一次。</div>',
        ok: '回滚', cancel: '再想想'
      });
      if (!ok) return;
      const r = Safety.restore(d);
      if (!r.ok) { toast(r.msg); return; }
      applyTheme(); UI.render(); toast(r.msg + '，可在设置里再回滚回来');
    },
    netclose() { const b = $('netbar'); if (b) b.className = 'netbar'; },
    /* v54 · 走查 P1-5：「我的」页收成 3 个分组。data-v 为空即返回一级页。
     * 注意第一个参数一定是 DOM 元素（UX.busy 传进来的），别当成布尔值用。 */
    mesub(el) {
      const v = (el && el.dataset && el.dataset.v) || '';
      if (UI.setMeSub) UI.setMeSub(v);
    },
    async swupdate() {
      flushDiary();
      try { await Store.saveNow(); }
      catch (e) { toast('保存未完成，请先导出备份再刷新'); return; }
      try { localStorage.setItem('rigongyizhu.updated', '1'); } catch (e) { }
      /* v53 · 报告 P2-10：新版本装好后会停在 waiting 等我们让路（sw.js 不再自己
       * skipWaiting）。所以这里要先发 SKIP_WAITING，等它真正接管（controllerchange）
       * 再刷新 —— 顺序反了的话刷完还是旧 SW 在管，用户会以为"点了没用"。
       * 1.5 秒兜底：万一 controllerchange 没来（某些浏览器/隐私模式），照常刷新。 */
      let done = false;
      const go = () => { if (done) return; done = true; location.reload(); };
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const w = reg && reg.waiting;
        if (w) {
          navigator.serviceWorker.addEventListener('controllerchange', go);
          w.postMessage({ type: 'SKIP_WAITING' });
          setTimeout(go, 1500);
          return;
        }
      } catch (e) { }
      go();
    },
    async snapclear() {
      const ok = await UX.confirm({
        icon: 'broom', title: '清除全部本地快照？',
        html: '只清除每天自动存的回滚点，<b>不影响当前数据</b>。',
        ok: '清除', cancel: '保留'
      });
      if (!ok) return;
      Safety.clear(); UI.render(); toast('已清除本地快照');
    },
    async gc() {
      const n = await Store.gcMedia();
      UI.render(); toast('清理了 ' + n + ' 个无用文件');
    },
    async persist() {
      await Store.requestPersistent();
      UI.paintQuota(); toast(await navigator.storage.persisted() ? '已开启持久化保护' : '浏览器未授予持久化');
    },
    async cacheclear() {
      toast('正在清理…');
      const n = await Store.clearLocalMedia();
      UI.paintQuota(); UI.render();
      toast(n ? ('已清理 ' + n + ' 个本机缓存，原图都在云端') : '本机没有可清理的缓存');
    },
    async wipe() {
      const ok = await UX.confirm({
        icon: 'warning-circle', danger: true, title: '清空全部数据？',
        html: '<b style="color:var(--danger)">删除后数据不可恢复。</b>' +
          '<div class="cf-sub">所有习惯、打卡记录、照片语音都会被清空。建议先去「导出备份」存一份。</div>',
        ok: '我已备份，继续', cancel: '先不清'
      });
      if (!ok) return;
      let alsoCloud = false;
      if (window.Cloud && Cloud.signedIn()) {
        alsoCloud = await UX.confirm({
          icon: 'cloud', danger: true, title: '云端也要一起清空吗？',
          html: '当前账号下的云端数据会一并删除；<b>只清本机</b>则云端仍保留一份，换设备还能拉回来。',
          ok: '云端也清空', cancel: '只清本机'
        });
      }
      const ok2 = await UX.confirm({
        icon: 'trash', danger: true, title: '最后确认一次',
        html: '<b style="color:var(--danger)">这一步之后就没有回头路了。</b>',
        ok: '确认清空', cancel: '算了'
      });
      if (!ok2) return;
      await Store.wipe(alsoCloud);
      UI.render(); toast('已清空');
    },
    invite() { UI.openInvite(); },
    setname() { UI.openInvite(); },
    savename() {
      const n = ($('myName').value || '').trim();
      Store.commit(s => { s.settings.nickname = n; });
      UI.closeSheet(); UI.render(); toast('名字已保存');
    },
    copylink() { copy($('inviteLink').textContent); },
    copycode() { copy(Store.s.activeRoomId); },

    /* 设置 */
    theme(el) {
      Store.commit(s => { s.settings.theme = el.dataset.v; });
      applyTheme(); UI.render();
    },
    /* 深浅色一键切换（我的页面开关 / 顶栏按钮共用） */
    toggledark() {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark';
      Store.commit(s => { s.settings.theme = cur ? 'light' : 'dark'; });
      applyTheme(); UI.render();
      toast(cur ? '已切换到浅色 ☀️' : '已切换到深色 🌙');
    },
    /* v58：主题色（8 色精选，ACCENTS 表在 applyTheme 旁）。点完即时生效并落盘。 */
    setaccent(el) {
      const k = el.dataset.v;
      if (!ACCENTS[k]) return;
      Store.commit(s => { s.settings.accentKey = k; });
      applyTheme();
      UX.sfx('tap');
      toast('主题色：' + ACCENTS[k].name);
    },
    toggleremind() {
      const cur = Store.s.settings.remindEnabled;
      if (cur) {
        Store.commit(s => { s.settings.remindEnabled = false; });
        UI.render(); toast('提醒已关闭');
        return;
      }
      Remind.enable().then(p => {
        if (p === 'granted') toast('提醒已开启 · 到点会弹系统通知 🔔');
        else if (p === 'denied') toast('通知被浏览器拦住了，需去网站设置里放行');
        UI.render();
      });
    },
    /* 引导卡：开启 / 稍后 */
    remindon() {
      Remind.enable().then(p => {
        UI.render();
        if (p === 'granted') { Remind.tick(); toast('提醒已开启 🔔'); }
        else if (p === 'denied') UX.alert('通知被拦住了', '浏览器已拒绝本站的通知权限。<br>请点地址栏左侧的图标 → 网站设置 → 通知 → 允许，再回来打开开关。');
      });
    },
    remindlater() { Remind.dismissGuide(); UI.render(); },
    remindtest() {
      const p = Remind.test();
      toast(p === 'granted' ? '已发一条测试通知' : (p === 'denied' ? '通知权限被拒绝' : '浏览器不支持通知'));
    },
    /* v50 · 「还是提醒我」：学会闭嘴是好事，但自动关掉的东西必须能手动开回来。
     * 第一参数是 DOM 元素（点击委托会把元素传进来），别拿它当布尔值用。 */
    remindalways(el) {
      const id = el && el.dataset ? el.dataset.id : '';
      const it = (Store.s.items || []).find(x => x.id === id);
      if (!it) return;
      const on = !it.remindAlways;
      Feat.updateItem(id, { remindAlways: on });
      UI.render();
      toast(on ? '好，继续提醒「' + it.name + '」' : '「' + it.name + '」又交回给自动判断了');
    },
    togglenight() {
      const c = Remind.nightCfg();
      Store.commit(s => { s.settings.remindNight.on = !c.on; });
      UI.render();
    },
    /* v51 · 日历导出：把排程交给系统日历，网页关掉也能响。
     * 注意这里第一参数是 DOM 元素，所以不要靠参数判断「是否要导出」——
     * 老坑：ACT 的第一个参数永远是「可选值」，点击委托会把元素塞进来。 */
    exportics() {
      if (!window.ICS) return toast('这个版本没有日历导出');
      const n = ICS.download();
      toast(n ? '已导出 ' + n + ' 个日程 · 用手机日历打开这个文件' : '还没有可以导出的习惯');
    },
    /* v51 · 打印月度打卡纸（纸贴在墙上比 App 更容易撞见） */
    printsheet() {
      if (!window.Paper) return toast('这个版本没有打印功能');
      Paper.print();
      toast('已生成这个月的打卡纸');
    },
    setnightat(el) {
      const v = el.value || '21:30';
      Store.commit(s => { s.settings.remindNight.at = v; });
    },
    /* 断签预警（v28 · 4.2） */
    togglenudge() {
      const c = Remind.nudgeCfg();
      Store.commit(s => { s.settings.nudge = Object.assign({}, c, { on: !c.on }); });
      UI.render();
    },
    setnudgeat(el) {
      const v = el.value || '21:00';
      Store.commit(s => { s.settings.nudge = Object.assign({}, Remind.nudgeCfg(), { at: v }); });
    },
    togglediary() {
      const c = Remind.diaryCfg();
      Store.commit(s => { s.settings.remindDiary.on = !c.on; });
      UI.render();
    },
    setdiaryat(el) {
      const v = el.value || '22:30';
      Store.commit(s => {
        s.settings.remindDiary = s.settings.remindDiary || { on: true };
        s.settings.remindDiary.at = v;
      });
    },
    toggleweek() {
      const c = Remind.weekCfg();
      Store.commit(s => { s.settings.remindWeek.on = !c.on; });
      UI.render();
    },
    setweekat(el) {
      const v = el.value || '20:30';
      Store.commit(s => {
        s.settings.remindWeek = s.settings.remindWeek || { on: true, wd: 0 };
        s.settings.remindWeek.at = v;
      });
    },
    /* 重画「显示方式」抽屉后把焦点还给刚才那枚开关 —— 不还的话键盘用户按一下就掉到
       body 上，等于键盘操作断了（v26 复检 5.1 的同类问题）。两个开关共用一份。 */
    repaintTools() {
      const ae = document.activeElement;
      const act = ae && ae.getAttribute ? ae.getAttribute('data-act') : null;
      const open = document.getElementById('sheet') && document.getElementById('sheet').classList.contains('on');
      if (open) {
        UI.openTools();
        if (act) {
          const el = document.querySelector('#sheetBody [data-act="' + act + '"]');
          if (el) el.focus({ preventScroll: true });
        }
      } else UI.render();
    },
    toggleslot() {
      Store.commit(s => { s.settings.groupBySlot = !s.settings.groupBySlot; });
      ACT.repaintTools();
    },
    /* 手机端搜索框默认收起，点放大镜展开并聚焦；清空后自动收回 */
    tosearch(el) {
      const tools = el && el.closest ? el.closest('.p-tools') : null;
      if (!tools) return;
      tools.classList.add('searching');
      const input = tools.querySelector('.p-search input');
      if (!input) return;
      input.focus();
      input.onblur = () => { if (!input.value.trim()) tools.classList.remove('searching'); };
    },
    /* 一屏网格视图（P1-2）：图标方块点一下完成，和卡片视图互斥，选择会被记住 */
    togglegrid() {
      Store.commit(s => { s.settings.gridView = !s.settings.gridView; });
      if (document.getElementById('sheet') && document.getElementById('sheet').classList.contains('on')) ACT.repaintTools();
      else toast(Store.s.settings.gridView ? '已切换网格视图，点一下就能完成' : '已切换卡片视图');
    },
    /* v20 · 色盲友好模式：红绿语义色换成蓝橙，深浅不变 */
    togglecb() {
      Store.commit(s => { s.settings.colorBlind = !s.settings.colorBlind; });
      applyA11y(); UI.render();
      toast(Store.s.settings.colorBlind ? '色盲友好模式已开启：红绿已换成蓝橙' : '色盲友好模式已关闭');
    },
    /* v20 · 字号缩放 */
    setfs(el) {
      const v = el && el.dataset ? el.dataset.v : 'normal';
      Store.commit(s => { s.settings.fontScale = v === 'large' ? 'large' : 'normal'; });
      applyA11y(); UI.render();
      toast(v === 'large' ? '已切换大字号' : '已恢复标准字号');
    },
    /* 打卡音效开关 */
    togglesound() {
      const on = Store.s.settings.sound === false;
      Store.commit(s => { s.settings.sound = on; });
      if (on && window.UX) UX.sfx('on');
      UI.render();
      toast(on ? '打卡音效已开启 🔔' : '打卡音效已关闭 🔇');
    },

    /* ---------- 交互细节：语录 / 下拉刷新 / 连续中断 ---------- */
    newquote() { if (window.UX) { UX.rerollQuote(); UX.sfx('tap'); } },
    refresh() { if (window.UX) UX.doRefresh(); },
    lib() {
      UI.go('habits');
      setTimeout(() => {
        const el = document.getElementById('libSec');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    },
    async usefreezebreak(el) {
      const d = el.dataset.d || U.shiftYmd(U.today(), -1);
      const r = Extra.useFreezeManual(d);
      if (!r.ok) { toast(r.msg); UI.render(); return; }
      if (window.UX) UX.sfx('all');
      UI.render();
      if (window.FX) FX.confetti(40, { y: -10 });
      toast('已用补卡券接上，连续记录保住了 🧊（剩 ' + r.left + ' 张）');
    },
    dismissbreak() {
      if (window.Extra) Extra.dismissBreak();
      UI.render();
      toast('已忽略，明天再提醒你');
    },
    /* 断签修复（v28 · 4.2）：48 小时内一次，每月一次，代价可见 */
    repairday(el) {
      const r = Extra.repair(el.dataset.d);
      if (!r.ok) { toast(r.msg); UI.render(); return; }
      if (window.UX) UX.sfx('all');
      if (window.FX) FX.confetti(50, { y: -10 });
      UI.render();
      toast(r.via === 'freeze' ? '已修好，连续记录接上了（用了 1 张保护券）' : '已修好，连续记录接上了（用了 ' + Extra.REPAIR_PTS + ' 积分）');
    },
    /* ---------- 回归模式（v28 · 4.3） ---------- */
    restartmini(el) {
      const it = findItem(el.dataset.id) || Engine.sorted().find(x => Engine.isDue(x, U.today()) && !Engine.isDone(x, U.today()));
      UI.setRestart(null);
      if (!it) { UI.render(); return; }
      if (!Engine.isDone(it, U.today())) Engine.toggleMini(it, U.today());
      Store.commit();
      UI.render();
      if (window.UX) UX.sfx('on');
      if (window.FX) FX.celebrate(Engine.todayRate(U.today()).pct, '今天算数了：' + it.name);
      toast('今天就到这里，剩下的明天再说');
    },
    restartskip() { UI.setRestart(null); UI.render(); },
    restartgrow() { UI.setRestart(null); UI.go('grow'); },
    /* ---------- 最小版本（v28 · 4.4） ---------- */
    minitoday(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      UI.closeSheet();
      const on = Engine.toggleMini(it, U.today());
      Store.commit(); UI.render();
      if (on && window.FX) FX.celebrate(Engine.todayRate(U.today()).pct, '轻量完成也算数');
      toast(on ? '记下了：今天只做了最小版，不断签' : '已取消');
    },
    setmini(el) { UI.openMiniSheet(el.dataset.id); },
    minipick(el) { const i = $('miniInput'); if (i) { i.value = el.dataset.v || ''; i.focus(); } },
    savemini(el) {
      const i = $('miniInput');
      const v = Extra.setMiniLabel(el.dataset.id, i ? i.value : '');
      UI.closeSheet();
      UI.openHabitDetail(el.dataset.id);
      toast(v ? '已设置：做不到时只做「' + v + '」' : '已取消最小版本');
    },
    notenow(el) { UI.openNoteSheet(el.dataset.id, U.today(), 'detail'); },

    dismisscloudhint() {
      Store.commit(s => { s.settings.cloudHintOff = 1; });
      UI.render();
    },
    dismissmovedhint() {
      Store.commit(s => { s.settings.movedHintOff = 1; });
      UI.render();
    },
    dismissbackuphint() {
      Store.commit(s => { s.settings.backupHintOff = 1; });
      UI.render();
    },

    /* ---------- 添加到桌面 ---------- */
    async installpwa() {
      const p = window.__pwaPrompt;
      if (p) {
        try {
          p.prompt();
          const r = await p.userChoice;
          if (r && r.outcome === 'accepted') toast('正在添加到桌面…');
        } catch (e) { }
        window.__pwaPrompt = null;
        Store.commit(s => { s.settings.pwaHintOff = 1; });
        UI.render();
        return;
      }
      UI.sheet('添加到桌面', '<div class="card"><div style="font-weight:650;margin-bottom:8px">iPhone / iPad（Safari）</div>' +
        '<div class="muted" style="line-height:1.9">1. 用 Safari 打开本页<br>2. 点底部中间的「分享」<br>3. 向下找到「添加到主屏幕」<br>4. 点「添加」</div></div>' +
        '<div class="card"><div style="font-weight:650;margin-bottom:8px">安卓（Chrome / Edge）</div>' +
        '<div class="muted" style="line-height:1.9">1. 点右上角「⋮」菜单<br>2. 选「安装应用」或「添加到主屏幕」</div></div>' +
        '<div class="card"><div class="muted">装到桌面后打开就是一个独立 App：全屏、离线可用、图标进应用列表，打卡少点两步。</div></div>');
    },
    dismisspwa() {
      Store.commit(s => { s.settings.pwaHintOff = 1; });
      UI.render();
    },

    /* ---------- 房间 ---------- */
    rooms() { UI.go('rooms'); },
    invite() { UI.go('rooms'); },
    setname() { UI.go('rooms'); },
    roomprofile() { UI.openRoomProfile(); },
    roomemo(el) {
      Rooms.setProfile(Rooms.profile().nickname, el.dataset.v);
      UI.openRoomProfile();
    },
    roomsaveprofile() {
      const n = ($('roomNick').value || '').trim();
      if (!n) { toast('请填一个昵称'); return; }
      Rooms.setProfile(n);
      UI.closeSheet(); UI.render(); toast('已保存');
      if (pendingRoomCode) { const c = pendingRoomCode; pendingRoomCode = ''; UI.openRoomJoin(); $('rjCode').value = c; }
      else pushRoom(true);
    },
    roomcreate() { if (nickFirst()) UI.openRoomCreate(); },
    rcemo(el) {
      document.querySelectorAll('#rcEmoChips .chip').forEach(c => c.classList.toggle('on', c === el));
    },
    rcpublic(el) { el.classList.toggle('on'); },
    async roomdocreate() {
      const name = ($('rcName').value || '').trim() || '我的房间';
      const intro = ($('rcIntro').value || '').trim();
      const emo = document.querySelector('#rcEmoChips .chip.on');
      const pub = ($('rcPublic') && $('rcPublic').classList.contains('on'));
      const r = await Rooms.create({ name, intro, emoji: emo ? emo.dataset.v : '🏠', visibility: pub ? 'public' : 'private' });
      if (!r.ok) { toast(r.msg); return; }
      UI.closeSheet(); UI.go('rooms'); toast('房间已创建 · 房间码 ' + r.code);
    },
    roomjoin() { if (nickFirst()) UI.openRoomJoin(); },
    async roomdojoin() {
      const c = ($('rjCode').value || '').trim().toUpperCase();
      if (!c) { toast('请输入房间码'); return; }
      const ok = await doJoin(c);
      if (ok) UI.closeSheet();
    },
    async roomplaza() { UI.openPlaza(); },
    /* 排行榜超时/失败后的重试（v38 · 外部评审 P0-5）：哪个框在页面上就刷哪个 */
    rankretry() { UI.paintRoomRank('#roomRank'); UI.paintRoomRank('#growRank'); },
    async plzjoin(el) { UI.openRoomJoin(); $('rjCode').value = el.dataset.code; },
    switchroom(el) { Rooms.setActive(el.dataset.code); UI.render(); },
    roomcopycode() { copy($('roomCodeText').textContent); },
    roomcopylink() { copy($('roomInviteLink').textContent); },
    async roomsync() {
      toast('同步中…');
      const r = await Rooms.sync();
      toast(r.ok ? ('已同步 ' + r.msg) : (r.msg || '同步失败'));
      UI.render();
    },
    async roompublic(el) {
      const code = Rooms.activeCode(); if (!code) return;
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      const r = await Rooms.setVisibility(code, on ? 'public' : 'private');
      if (!r.ok) { el.classList.toggle('on', !on); toast(r.msg); }
      else toast(on ? '已公开到广场' : '已改为私密');
    },
    async roomleave() {
      const code = Rooms.activeCode(); if (!code) return;
      const ok = await UX.confirm({
        icon: 'arrow-right', danger: true, title: '退出这个房间？',
        html: '退出后排行榜和共享习惯将不再显示你；个人记录保留，之后可凭邀请重新加入。',
        ok: '退出房间', cancel: '再想想'
      });
      if (!ok) return;
      const r = await Rooms.leave(code); if (!r.ok) return toast(r.msg); UI.render(); toast('已退出');
    },
    /* ---------- 强度 / 跳过 / 补卡 / 成就 ---------- */
    habitdetail(el) { UI.openHabitDetail(el.dataset.id); },
    skiptoday(el) {
      const id = el.dataset.id, d = U.today();
      Extra.skip(d, id, !Extra.isSkipped(d, id));
      Store.commit(); UI.render();
      toast(Extra.isSkipped(d, id) ? '今天请假已记录，连续天数不受影响' : '已取消请假');
    },
    slip(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      const on = Engine.slip(it, U.today());
      Store.commit(); UI.render();
      toast(on ? '记下了 · 明天继续，别自责' : '已撤销破戒记录');
    },
    /* ---- 例程链 ---- */
    routines() { UI.openRoutines(); },
    rtpick(el) { UI.rtToggle(el.dataset.id); if (window.UX) UX.sfx('tap'); },
    rtadd() {
      const name = (($('rtName') || {}).value || '').trim();
      const ids = UI.rtSelected();
      if (!ids.length) return toast('至少选一个习惯');
      Plus.addRoutine(name || '我的例程', 'any', ids);
      UI.openRoutines(); toast('例程已保存');
    },
    rtdel(el) { Plus.delRoutine(el.dataset.id); UI.openRoutines(); toast('已删除例程'); },
    rtdone(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      Engine.toggle(it, U.today()); Store.commit(); UI.render();
      hintNext(it.id);
    },

    /* ---- 时间胶囊 ---- */
    capsules() { UI.openCapsules(); },
    capday(el) {
      document.querySelectorAll('#capDays .chip').forEach(c => c.classList.toggle('on', c === el));
    },
    capsuleadd() {
      const t = (($('capText') || {}).value || '').trim();
      if (!t) return toast('先写点什么吧');
      const on = document.querySelector('#capDays .chip.on');
      const days = +(on ? on.dataset.v : 90);
      Plus.addCapsule(t, U.shiftYmd(U.today(), days));
      UI.openCapsules(); toast('封存好了 · ' + days + ' 天后解锁');
    },
    capsuleopen(el) { Plus.openCapsule(el.dataset.id); UI.render(); toast('✉️ 已收下'); },

    /* ---- 分享卡片 ---- */
    sharecard() { UI.openShareCard(); },
    sharecardsave() {
      if (!window.__shareURL) return toast('还没有生成');
      const a = document.createElement('a');
      a.href = window.__shareURL; a.download = '日拱一卒-' + U.today() + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      toast('已下载，可发朋友圈 / 群里');
    },
    sharecardtext() {
      const gs = Engine.globalStreak(), r = Engine.todayRate(U.today());
      copy('日拱一卒 · 已连续 ' + gs + ' 天，今天完成 ' + r.done + '/' + r.total + '（' + r.pct + '%）。' +
        (window.Insights ? Insights.headline() : ''));
    },

    /* ---- CSV 导入 ---- */
    importcsv() { UI.openImportCSV(); },
    csvparse() { UI.csvPreview((($('csvText') || {}).value || '')); },
    csvpick() { pickFile('.csv,text/csv,text/plain', txt => { const el = $('csvText'); if (el) el.value = txt; UI.csvPreview(txt); }); },
    csvimport() {
      const txt = (($('csvText') || {}).value || '');
      const r = Plus.importCSV(txt);
      if (!r.ok) return toast(r.msg);
      UI.closeSheet(); UI.render();
      const more = r.kept ? '（' + r.kept + ' 条已有记录未覆盖）' : '';
      toast('已导入 ' + r.total + ' 个习惯 · ' + r.logs + ' 条历史记录' + more);
    },

    /* ---- CSV 导出（v27 · 4.4，对标 Loop 的 Take control of your data）---- */
    async exportcsv() {
      const st = Store.s;
      const items = (st.items || []).filter(i => !i.deleted);
      if (!items.length) return toast('还没有任何习惯');
      const nLog = Object.keys(st.logs || {});
      if (!nLog.length) return toast('还没有打卡记录，导出来只有习惯名单');
      const csv = Plus.exportCSV();
      const rows = csv.split('\r\n').length - 2; /* 去掉表头和结尾换行 */
      const ok = await UX.confirm({
        icon: 'clipboard', title: '导出 CSV 表格',
        html: '共 ' + items.length + ' 个习惯、<b>' + rows + '</b> 条记录，导出成 Excel / WPS 能直接打开的表格。' +
          '文件里包含每条记录的日期、状态、数值和备注。<div class="cf-sub">表格能看出习惯的全貌，' +
          '但也别把里面的隐私信息随手转发给别人。</div>',
        ok: '导出表格', cancel: '再想想'
      });
      if (!ok) return;
      const name = '日拱一卒-' + U.today() + '.csv';
      try {
        const how = await U.saveTextFile(name, csv, 'text/csv');
        Store.commit(s => { s.settings.lastBackupAt = Date.now(); });
        toast(how === 'share' ? '已保存（可在分享面板里存到文件）'
          : how === 'clipboard' ? '已复制到剪贴板，粘到表格软件里保存即可'
            : '已导出，可用 Excel / 表格软件打开');
      } catch (e) { toast('导出失败：' + (e.message || '换个浏览器试试')); }
    },

    /* v35 · Markdown 迁出：和 CSV 分工 —— CSV 给机器，Markdown 给人。
     * 换 App、发给教练、打印出来贴墙，都是「读」的场景。
     * 注意不能叫 exportmd：插件面已经有一个同名动作（导日记），同名会被覆盖掉。 */
    async exporthmd() {
      const st = Store.s;
      const items = (st.items || []).filter(i => !i.deleted);
      if (!items.length) return toast('还没有任何习惯');
      const days = Object.keys(st.logs || {});
      if (!days.length) return toast('还没有打卡记录，导出来只有习惯名单');
      const md = Plus.exportMarkdown();
      const ok = await UX.confirm({
        icon: 'book-open', title: '导出 Markdown',
        html: '共 ' + items.length + ' 个习惯、<b>' + days.length + '</b> 天记录，导出成一份能直接读的 Markdown 文件。' +
          '里面是习惯清单（含完成次数与连续天数）和最近 180 天的每日明细，备注也会带上。' +
          '<div class="cf-sub">要全量历史请用「导出备份」（JSON）；日记文字另有「日记 → 导出 Markdown」。</div>',
        ok: '导出文件', cancel: '再想想'
      });
      if (!ok) return;
      try {
        const how = await U.saveTextFile('日拱一卒-' + U.today() + '.md', md, 'text/markdown');
        Store.commit(s => { s.settings.lastBackupAt = Date.now(); });
        toast(how === 'share' ? '已保存（可在分享面板里存到文件）'
          : how === 'clipboard' ? '已复制到剪贴板' : '已导出 Markdown');
      } catch (e) { toast('导出失败：' + (e.message || '换个浏览器试试')); }
    },

    fixyesterday() { UI.openDayPanel(U.shiftYmd(U.today(), -1)); },    fixdates() { UI.openDatePicker(); },
    calprev() { UI.shiftCal(-1); },
    calnext() { UI.shiftCal(1); },
    openday(el) { UI.openDayPanel(el.dataset.d); },
    daytick(el) {
      const it = findItem(el.dataset.id), d = el.dataset.d;
      if (!it) return;
      if (d !== U.today() && !Engine.canBackfill(d)) { toast('这天已超过补卡期限'); return; }
      Engine.toggle(it, d); Store.commit(); pushRoom(true);
      UI.openDayPanel(d); UI.render();
      checkBadges();
    },
    dayskip(el) {
      const id = el.dataset.id, d = el.dataset.d;
      if (d !== U.today() && !Engine.canBackfill(d)) { toast('这天已超过补卡期限'); return; }
      Extra.skip(d, id, !Extra.isSkipped(d, id));
      Store.commit(); UI.openDayPanel(d); UI.render();
    },
    /* 单次打卡备注（v27 · 4.3）：打开输入面板 / 保存 / 跳过 */
    daynote(el) { UI.openNoteSheet(el.dataset.id, el.dataset.d || U.today(), 'day'); },
    savenote(el) {
      /* 不带 data-id = 当天的日记笔记（老入口）；带 data-id = 这一次打卡的备注。
       * 两个入口共用动作名，必须在这里分流，否则后加的那个会把前一个吃掉。 */
      if (!el.dataset.id) {
        const t = ($('nText') || {}).value || '';
        Store.commit(s => {
          const d = U.today();
          s.notes[d] = s.notes[d] || { text: '', photos: [], audios: [] };
          s.notes[d].text = t;
        });
        UI.closeSheet(); UI.render(); toast('笔记已保存');
        return;
      }
      const id = el.dataset.id, d = el.dataset.d || U.today();
      const inp = document.getElementById('noteInput');
      const v = Engine.setNote(id, d, inp ? inp.value : '');
      Store.commit();
      UI.closeSheet();
      /* 从日面板进来的要回到日面板，否则用户会以为自己被弹回首页了 */
      if (el.dataset.from === 'day') UI.openDayPanel(d);
      UI.render();
      toast(v ? '已记下' : '已清空备注');
    },
    closenote() { UI.closeSheet(); },
    async dayfreeze(el) {
      if (el.dataset.d !== U.today() && !Engine.canBackfill(el.dataset.d)) { toast('这天已超过补卡期限'); return; }
      const r = Extra.useFreezeManual(el.dataset.d);
      toast(r.ok ? ('已保护这天，剩余 ' + r.left + ' 张') : r.msg);
      UI.openDayPanel(el.dataset.d);
    },
    /* 编辑习惯（详情页 / 长按菜单共用） */
    openhabit(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      UI.closeSheet();
      UI.openHabit(it);
    },
    gogrow() { UI.closeSheet(); UI.go('grow'); },

    /* ---------- 长按菜单里的动作 ---------- */
    hlpbackfill(el) {
      UI.closeSheet();
      UI.openDatePicker(U.today().slice(0, 7));
      toast('只能补最近 ' + Engine.backfillDays() + ' 天，更早的只能查看');
    },
    hlparchive(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      const to = !it.archived;
      Feat.updateItem(it.id, { archived: to });
      UI.closeSheet(); UI.render();
      toast(to ? '已归档 · 记录都留着，随时能恢复' : '已恢复');
    },

    /* ---------- 数值型快速增量 ---------- */
    qadd(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      const v = el.dataset.v;
      const target = Number(it.target) || 1;
      const was = Engine.isDone(it, U.today());
      if (v === 'full') Engine.setValue(it, U.today(), target);
      else if (v === '0') Engine.setValue(it, U.today(), 0);
      else Engine.addValue(it, U.today(), parseFloat(v) || 0);
      Store.commit();
      if (window.UX) UX.sfx('tap');
      const from = ringPct();
      UI.closeSheet();
      if (!UI.patchToday(it.id)) UI.render();
      afterCheck(it, { on: !was && Engine.isDone(it, U.today()), from });
      checkBadges();
    },
    /* 点卡片上的数字 = 快速增量面板（比每次弹输入框填数字快得多） */
    quickadd(el) { UI.openQuickAdd(el.dataset.id); },
    async qset(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      UI.closeSheet();
      await ACT.setval({ dataset: { id: it.id } });
    },

    /* ---------- 本周回顾卡片 ---------- */
    weekcard() { UI.openWeekCard(); },
    weeksave() { UI.saveWeekCard(); },
    weekcopy() {
      if (!window.Extra) return;
      const c = Extra.weekCard();
      const lines = ['本周回顾 · ' + c.range,
        '完成率 ' + c.pct + '%（上周 ' + c.prevPct + '%）',
        '打卡 ' + c.checkins + ' 次 / 应打 ' + c.total + ' 次',
        '全站连击 ' + c.streak.now + ' 天（' + (c.streak.delta >= 0 ? '+' : '') + c.streak.delta + '）'];
      (c.top3 || []).forEach(x => lines.push('· ' + x.name + ' ' + x.pct + '%'));
      if (c.worst) lines.push('最容易掉链子：' + c.worst.name + '（' + c.worst.pct + '%）');
      lines.push('— 日拱一卒');
      copy(lines.join('\n'));
    },

    /* ---------- 通知 / 云备份（右上角图标） ---------- */
    notifypanel() { UI.openNotifyPanel(); },
    cloudpanel() { UI.openCloudPanel(); },
    async remindreauth() {
      if (!window.Remind) return;
      const p = await Remind.enable();
      UI.render();
      if (p === 'granted') { toast('通知已开启，到点会响'); Remind.fire('提醒已开启', '之后到点就会收到通知 🔔', { tag: 'rgz-on' }); }
      else if (p === 'denied') toast('还是被拦住了 · 需去浏览器网站设置里放行');
      else toast('这次没授权，之后再点还能再申请');
    },
    openmissed() { UI.openMissedPanel(); },
    missedcheck(el) {
      const it = findItem(el.dataset.id);
      if (!it) return;
      const d = U.today();
      const was = Engine.isDone(it, d);
      Engine.toggle(it, d);
      Store.commit();
      const from = ringPct();
      UI.patchToday(it.id);
      afterCheck(it, { on: !was && Engine.isDone(it, d), from });
      checkBadges();
      const left = window.Remind ? Remind.pendingList().length : 0;
      if (left > 0) UI.openMissedPanel();
      else { Remind.dismissMissed(); UI.closeSheet(); toast('全部补上了 🎉'); }
    },
    closemissed() {
      if (window.Remind) Remind.dismissMissed();
      UI.closeSheet();
    },
    async cloudsync() {
      if (!window.Cloud || !Cloud.signedIn()) { UI.openCloudPanel(); return; }
      /* 后端没了的话，同步必然失败 —— 说清楚，别让用户以为是网络抖动反复点 */
      const bk = Cloud.backendState ? Cloud.backendState() : { state: 'unknown' };
      if (bk.state === 'down') return toast('云端暂未开通：' + (bk.err || '连不上服务器'));
      try { await Cloud.syncNow(); toast('已同步'); } catch (e) { toast('同步失败：' + e.message); }
      UI.render();
    },

    /* ---------- 我的小屋（积分家具） ---------- */
    decorshop(el) { UI.openDecorShop(el && el.dataset.v); },
    decorstorage() { UI.openDecorStorage(); },
    decorbuy(el) {
      if (!window.Decor) return;
      const r = Decor.buy(el.dataset.id);
      if (!r.ok) { toast(r.msg || '买不了'); return; }
      if (window.UX) UX.sfx('all');
      toast('🛒 添置了 ' + r.item.emoji + ' ' + r.item.name);
      UI.openDecorShop();
      UI.render();
    },
    decorplace(el) {
      if (!window.Decor) return;
      const r = Decor.place(el.dataset.id);
      if (!r.ok) { toast(r.msg || '摆不下'); return; }
      toast('已摆进房间');
      UI.openDecorStorage(); UI.render();
    },
    decorunplace(el) {
      if (!window.Decor) return;
      Decor.unplace(el.dataset.id);
      UI.openDecorStorage(); UI.render();
    },
    async decorsell(el) {
      if (!window.Decor) return;
      const it = Decor.item(el.dataset.id);
      const ok = await UX.confirm({
        icon: 'refresh', title: '退回「' + (it ? it.name : '') + '」？',
        msg: '退回能拿回一半积分（' + (it ? Math.round(it.cost / 2) : 0) + ' 分），房间里的它会被收走。',
        ok: '退回', cancel: '再想想', danger: true
      });
      if (!ok) return;
      const r = Decor.sell(el.dataset.id);
      if (!r.ok) { toast(r.msg || '退不了'); return; }
      toast('已退回，+' + r.back + ' 积分');
      UI.openDecorShop(); UI.render();
    },

    /* ---------- 补卡期限 ---------- */
    setbackfill(el) {
      const n = +el.dataset.v || 3;
      Store.commit(s => { s.settings.backfillDays = n; });
      UI.render();
      toast('补卡期限：' + (n >= 30 ? '不限' : '最近 ' + n + ' 天'));
    },

    /* ---------- 一周从周几开始（走查第 12 条） ---------- */
    setweekstart(el) {
      const v = +el.dataset.v === 0 ? 0 : 1;
      Store.commit(s => { s.settings.weekStart = v; });
      UI.render();
      toast(v === 0 ? '一周从周日开始，周报和月历已跟着换' : '一周从周一开始，周报和月历已跟着换');
    },

    badges() { UI.openBadges(); },
    review30() {
      const r = Extra.review('month');
      UI.sheet('近 30 天回顾',
        '<div class="card" style="box-shadow:none;background:var(--bg-2)">' +
        r.bullets.map(t => '<div style="margin-bottom:7px">· ' + U.esc(t) + '</div>').join('') + '</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="copyreview30">复制这份小结</button></div>');
    },
    copyreview() { copy(Extra.review('week').text); },
    copyreview30() { copy(Extra.review('month').text); },
    /* 月度报告翻页：只能往过去翻，翻到未来月没意义 */
    monthprev() {
      const cur = UI.reportYm ? UI.reportYm() : U.today().slice(0, 7);
      const y = +cur.slice(0, 4), m = +cur.slice(5, 7) - 1;
      UI.setReportMonth(U.ymd(new Date(y, m - 1, 1)).slice(0, 7));
      UI.render();
    },
    monthnext() {
      const cur = UI.reportYm ? UI.reportYm() : U.today().slice(0, 7);
      const now = U.today().slice(0, 7);
      if (cur >= now) return;
      const y = +cur.slice(0, 4), m = +cur.slice(5, 7) - 1;
      const next = U.ymd(new Date(y, m + 1, 1)).slice(0, 7);
      UI.setReportMonth(next >= now ? null : next);
      UI.render();
    },

    async roomdissolve() {
      const code = Rooms.activeCode(); if (!code) return;
      const room = Rooms.findRoom(code);
      const ok = await UX.confirm({
        icon: 'warning-circle', danger: true, title: '归档「' + (room ? room.name : '这个房间') + '」？',
        html: '<b>归档后暂停加入和共享，保留成员及原有记录。</b>' +
          '<div class="cf-sub">房主可在归档列表恢复房间；恢复后具体习惯仍需重新开启共享。</div>',
        ok: '归档房间', cancel: '再想想'
      });
      if (!ok) return;
      const r = await Rooms.dissolve(code);
      if (!r.ok) { toast(r.msg); return; }
      UI.render(); toast('房间已归档，可在归档列表恢复');
    },

    /* ---------- 云空间 ---------- */
    goconnect() { UI.go('connect'); },
    async cloudretry() {
      toast('正在连接云端…');
      await Cloud.boot();
      UI.render();
      if (Cloud.signedIn()) return toast('已登录');
      const bk = Cloud.backendState ? Cloud.backendState() : { state: 'unknown' };
      if (bk.state === 'down') return toast('云端暂未开通：' + (bk.err || '连不上服务器'));
      if (!Cloud.available()) return toast('云端组件加载失败，请检查网络');
      toast('云端已就绪，登录即可使用');
    },
    cloudlogin() { UI.openLogin(); },
    async cloudsend() {
      const phone = (($('lgPhone') || {}).value || '').trim();
      if (!/^1\d{10}$/.test(phone)) return toast('请输入正确的 11 位手机号');
      try {
        await Cloud.sendCode(phone);
        toast('验证码已发送');
      } catch (e) { toast(e.message || '发送失败'); }
    },
    async cloudverify() {
      const phone = (($('lgPhone') || {}).value || '').trim();
      const code = (($('lgCode') || {}).value || '').trim();
      if (!code) return toast('请输入验证码');
      try {
        await Cloud.verifyCode(phone, code);
        UI.closeSheet();
        UI.render();
        toast('登录成功，开始同步…');
        await Cloud.syncNow();
        UI.render();
        toast('已同步');
      } catch (e) { toast(e.message || '登录失败'); }
    },
    async cloudwx() {
      try { await Cloud.wechatLogin(); }
      catch (e) { toast(e.message || '微信登录不可用'); }
    },
    async cloudlogout() {
      const ok = await UX.confirm({
        icon: 'link', title: '退出云空间？',
        html: '本机数据仍会保留，只是不再同步到云端。' +
          '<div class="cf-sub">云端的数据不会删除，下次登录还能拉回来。</div>',
        ok: '退出登录', cancel: '继续用'
      });
      if (!ok) return;
      await Cloud.signOut();
      UI.render();
      toast('已退出');
    },
    async cloudsync() {
      if (!Cloud.signedIn()) return toast('请先登录');
      toast('同步中…');
      try {
        const r = await Cloud.syncNow();
        UI.render();
        toast(r.restored ? ('已从云端恢复 ' + r.pulled + ' 个习惯，数据回来了')
          : (r.pulled ? ('已同步，从云端合并了 ' + r.pulled + ' 项') : '已同步'));
      } catch (e) { toast('同步失败：' + e.message); }
    },
    async cloudpull() {
      if (!Cloud.signedIn()) return toast('请先登录');
      try {
        const r = await Cloud.pullState();
        if (!r) return toast('云端还没有数据，先上传一次');
        const n = await Cloud.mergePayload(r.payload);
        UI.render(); toast('已从云端合并 ' + n + ' 项');
      } catch (e) { toast('拉取失败：' + e.message); }
    },
    async cloudpush() {
      if (!Cloud.signedIn()) return toast('请先登录');
      try { await Cloud.pushState(); toast('已上传到云端'); UI.render(); }
      catch (e) { toast('上传失败：' + e.message); }
    },
    /* 换设备 / 清缓存后：用云端那份整体覆盖本机 */
    async cloudrestore() {
      if (!Cloud.signedIn()) return toast('请先登录');
      const ok = await UX.confirm({
        icon: 'cloud', title: '从云端恢复？',
        html: '会用云端那份数据<b>完全替换</b>本机内容。<br>换设备、清过缓存时用它把数据找回来。',
        ok: '恢复', cancel: '再想想'
      });
      if (!ok) return;
      toast('正在从云端恢复…');
      try {
        const n = await Cloud.restoreFromCloud();
        UI.render();
        toast('已恢复 ' + n + ' 个习惯的记录');
      } catch (e) { toast('恢复失败：' + e.message); }
    },
    /* 不占本机：删掉本机的照片/语音副本，云端那份留着，要看时再取 */
    async cloudslim() {
      const r = await Store.slimLocal();
      UI.render();
      if (!r.files) return toast('本机没有可释放的缓存了');
      toast('已释放本机 ' + U.bytes(r.bytes) + '（' + r.files + ' 个文件，云端仍有原图）');
    },
    togglecloudmedia() {
      Store.commit(s => { s.settings.cloudMedia = s.settings.cloudMedia === false; });
      UI.render();
      toast(Store.s.settings.cloudMedia === false ? '新附件将只存本机' : '新附件会上传到云端');
    },
    togglekeepthumb() {
      Store.commit(s => { s.settings.keepThumb = s.settings.keepThumb === false; });
      UI.render();
      toast(Store.s.settings.keepThumb === false ? '本机不再保留缩略图（看图需联网）' : '本机保留缩略图');
    },
    toggleautosync() {
      Store.commit(s => { s.settings.autoSync = s.settings.autoSync === false; });
      UI.render();
    },

    /* ---------- 自建网盘备份 WebDAV（v27 · 4.6）----------
     * 与云端是两条独立的路：这里不碰 Cloud，只读写用户自己的网盘。
     * 所有失败都要落到用户能懂的一句话上（CORS / 401 / 404 的文案在 webdav.js 里）。 */
    webdavcfg() { UI.openWebDAVConfig(); },
    webdavcancel() { UI.closeSheet(); },
    async webdavsave(el) {
      const url = (document.getElementById('wvUrl') || {}).value || '';
      const dir = (document.getElementById('wvDir') || {}).value || '';
      const user = (document.getElementById('wvUser') || {}).value || '';
      const pass = (document.getElementById('wvPass') || {}).value || '';
      const box = document.getElementById('wvTest');
      if (box) box.innerHTML = '<span class="muted">正在连接网盘…</span>';
      const btn = el;
      if (btn) { btn.disabled = true; btn.textContent = '连接中…'; }
      try {
        const r = await WebDAV.save({ url: url, dir: dir, user: user, pass: pass });
        if (!r.ok) {
          if (box) box.innerHTML = '<span style="color:var(--danger)">' + E(r.msg || '连不上') + '</span>';
          return;
        }
        UI.closeSheet(); UI.render();
        toast('网盘已连上，之后每天会自动备份');
      } catch (e) {
        if (box) box.innerHTML = '<span style="color:var(--danger)">出错了：' + E(e.message || e) + '</span>';
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '保存并测试连接'; }
      }
    },
    async webdavtest() {
      toast('正在检测连接…');
      const r = await WebDAV.probe();
      UI.render();
      toast(r.ok ? '连接正常' : (r.msg || '连不上'));
    },
    async webdavup() {
      if (!WebDAV.has()) return UI.openWebDAVConfig();
      toast('正在备份到网盘…');
      let r;
      try { r = await WebDAV.upload({}); }
      catch (e) { return toast('备份失败：' + (e.message || e)); }
      if (r.ok) {
        UI.render();
        /* 成功的瞬间就要说清覆盖范围：等用户换设备时才发现照片没了，已经晚了 */
        const ms = (window.UI && UI.mediaStat) ? UI.mediaStat() : { total: 0 };
        return toast('已备份到网盘' + (ms.total ? '（照片语音未覆盖，换设备前先导出完整备份）' : '') +
          (r.history ? '' : ' · 历史文件没存上，最新那份是好的'));
      }
      if (r.conflict) return ACT.webdavconflict(r);
      UI.render();
      toast(r.msg || '备份失败');
    },
    /* 冲突：让用户选，绝不静默覆盖。 */
    async webdavconflict(r) {
      r = r || {};
      const m = r.meta || {};
      const when = m.savedAt ? U.ymd(new Date(m.savedAt)) + ' ' + U.hhmm(m.savedAt) : '时间未知';
      const remote = '另一台设备在 <b>' + E(when) + '</b> 备份过' +
        (m.habits != null ? '（' + m.habits + ' 个习惯、' + (m.days || 0) + ' 天记录）' : '') + '。';
      const ok = await UX.confirm({
        icon: 'upload', title: '网盘上有一份更新的备份',
        html: remote + '<br><b>用网盘的</b>：下载并覆盖本机（本机现有记录会被替换）。<br>' +
          '<b>保留本机的</b>：把本机这份传上去，覆盖网盘。<br>' +
          '<span class="cf-sub">不确定就先「用网盘的」——那份里面大概率有你这台设备上没有的记录。' +
          '两种操作前都会先在本机存一份快照，可在「我的 → 数据安全网」回滚。</span>',
        ok: '用网盘的', cancel: '保留本机的'
      });
      if (ok) {
        const p = await WebDAV.pull();
        if (!p.ok) return toast(p.msg || '拉取失败');
        if (window.Safety) Safety.snapshot('pre-webdav-' + Date.now());
        await ACT.webdavapply(p.text, 'replace');
      } else {
        toast('正在用本机数据覆盖网盘…');
        const u = await WebDAV.upload({ force: true });
        UI.render();
        toast(u.ok ? '本机数据已上传，网盘上的旧备份被替换' : (u.msg || '上传失败'));
      }
    },
    /* 把一份备份文本落到本机：合并或覆盖 */
    async webdavapply(txt, mode) {
      try {
        if (window.Safety) Safety.snapshot('pre-import-' + Date.now());
        await Store.importJSON(txt, mode);
        Store.commit(s => { s.settings.movedHintOff = 1; try { s.settings.lastOrigin = location.origin; } catch (e) { } });
        applyTheme(); UI.render();
        toast(mode === 'replace' ? '已用网盘的备份恢复本机' : '导入成功');
      } catch (e) { toast('导入失败：' + e.message); }
    },
    async webdavdown() {
      if (!WebDAV.has()) return UI.openWebDAVConfig();
      toast('正在读取网盘备份…');
      const p = await WebDAV.pull();
      if (!p.ok) return toast(p.msg || '拉取失败');
      const m = p.meta || {};
      const when = m.savedAt ? U.ymd(new Date(m.savedAt)) + ' ' + U.hhmm(m.savedAt) : '';
      const ok = await UX.confirm({
        icon: 'download', title: '从网盘恢复？',
        html: '网盘上的备份来自 <b>' + E(when) + '</b>' +
          (m.habits != null ? '，共 ' + m.habits + ' 个习惯、' + (m.days || 0) + ' 天记录' : '') + '。<br>' +
          '<b>合并</b>：保留本机现有记录，把备份并进来（推荐）。<br>' +
          '<b>覆盖</b>：用备份完全替换本机数据。<br>' +
          '<span class="cf-sub">两种前都会先在本机存一份快照。</span>',
        ok: '覆盖本机', cancel: '合并进来'
      });
      if (ok) {
        if (window.Safety) Safety.snapshot('pre-webdav-' + Date.now());
        await ACT.webdavapply(p.text, 'replace');
      } else {
        await ACT.webdavapply(p.text, 'merge');
      }
      WebDAV.markSeen();
    },
    async webdavhist() {
      if (!WebDAV.has()) return UI.openWebDAVConfig();
      toast('正在读取目录…');
      const r = await WebDAV.list();
      if (!r.ok) return toast(r.msg || '读不到目录');
      if (!r.files.length) return toast('网盘目录里还没有备份文件');
      UI.sheet('网盘里的备份',
        r.files.slice(0, 30).map(f =>
          '<div class="line-cell" style="border:none"><div style="flex:1"><div class="k">' + E(f.name) + '</div>' +
          '<div class="s">' + U.bytes(f.bytes || 0) + (f.when ? ' · ' + E(f.when) : '') + '</div></div>' +
          '<button class="btn sm ghost" data-act="webdavget" data-n="' + E(f.name) + '">恢复这份</button></div>'
        ).join('') +
        '<div class="muted" style="margin-top:10px">带时间戳的历史备份不会被覆盖；恢复其中某一份时，' +
        '会用它的内容合并进本机（也会先存快照）。</div>');
    },
    async webdavget(el) {
      const name = el && el.dataset.n;
      if (!name) return;
      toast('正在读取…');
      const r = await WebDAV.pullNamed(name);
      if (!r.ok) return toast(r.msg || '读不到这份备份');
      await ACT.webdavapply(r.text, 'merge');
    },
    async webdavoff() {
      const ok = await UX.confirm({
        icon: 'upload', danger: true, title: '断开网盘备份？',
        html: '只是不再自动备份，<b>已经存在网盘里的文件不会被删</b>。之后想连回来，重新填一次地址即可。',
        ok: '断开', cancel: '取消'
      });
      if (!ok) return;
      WebDAV.clear();
      UI.render();
      toast('已断开，网盘里的备份还在');
    },

    /* ---------- 插件 ---------- */
    plg_calendar() { UI.openCalendar(); },
    icsweeks(el) {
      Plugins.cfg().ics.weeks = +el.dataset.v;
      Store.save(); UI.openCalendar();
    },
    icsalarm() {
      const c = Plugins.cfg();
      c.ics.alarms = c.ics.alarms === false;
      Store.save(); UI.openCalendar();
    },
    icsdl() { Plugins.downloadIcs(); },
    icscopy() {
      copy(Plugins.icsText(Plugins.cfg().ics.weeks || 8).text);
      toast('已复制，可粘贴到日历的「导入」框');
    },

    plg_hook() { UI.openHooks(); },
    hkevent(el) { el.classList.toggle('on'); },
    hookadd() {
      const url = (($('hkUrl') || {}).value || '').trim();
      if (!/^https?:\/\//.test(url)) return toast('请填写以 http(s) 开头的地址');
      const events = [...document.querySelectorAll('#hkEvents .chip.on')].map(b => b.dataset.v);
      Plugins.cfg().hooks.push({
        id: U.uid('hk'), type: ($('hkType') || {}).value || 'custom',
        url: url, events: events, on: true
      });
      Store.save(); UI.openHooks(); toast('已添加');
    },
    dailysave() {
      const c = Plugins.cfg();
      c.daily.at = (($('hkDailyAt') || {}).value || '21:30');
      c.daily.enabled = true;
      Store.save(); toast('每日汇报时间已保存：' + c.daily.at);
    },
    hooktoggle(el) {
      const h = Plugins.cfg().hooks[+el.dataset.i];
      if (h) { h.on = !h.on; Store.save(); UI.openHooks(); }
    },
    hookdel(el) {
      const c = Plugins.cfg();
      c.hooks.splice(+el.dataset.i, 1);
      Store.save(); UI.openHooks(); toast('已删除');
    },
    async hooktest(el) {
      const h = Plugins.cfg().hooks[+el.dataset.i];
      if (!h) return;
      toast('发送中…');
      const r = await Plugins.post(h, Plugins.todayText('test', '这是一条测试消息'));
      toast(r.ok ? (r.unsure ? '已尽力发送（结果不可确认）' : '发送成功') : ('发送失败：' + (r.err || r.status)));
    },

    plg_shortcut() { UI.openShortcut(); },
    copyurl(el) { copy(el.dataset.url); },
    copystatus() { copy(JSON.stringify(Plugins.statusJSON(), null, 2)); toast('状态 JSON 已复制'); },
    cmdgen() {
      const items = Engine.items();
      if (!items.length) return toast('还没有习惯');
      const html = '<div class="muted">复制后粘到快捷指令的「打开 URL」里</div>' +
        items.map(it => {
          const q = it.type === 'check' ? { do: 'tick', name: it.name }
            : { do: 'val', name: it.name, v: it.target || 1 };
          const url = Plugins.cmdUrl(q);
          return '<div class="card" style="box-shadow:none;background:var(--bg-2);margin-top:8px">' +
            '<div style="font-weight:650;font-size:13px">' + U.esc(it.name) + '</div>' +
            '<div class="muted" style="word-break:break-all;font-size:12px;margin:4px 0 8px">' + U.esc(url) + '</div>' +
            '<button class="btn sm ghost" data-act="copyurl" data-url="' + U.esc(url) + '">复制链接</button></div>';
        }).join('');
      UI.sheet('我的习惯链接', html);
    },

    plg_health() { UI.openHealth(); },
    healthpaste() {
      const el = $('healthPaste');
      if (el) el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
    },
    healthpick() {
      pickFile('.xml,.csv,.txt,.json,text/xml,text/csv,application/json', async f => {
        if (!f) return;
        if (!window.Health) return toast('导入模块没加载出来，刷新一下再试');
        const big = f.size > 30 * 1024 * 1024;
        toast(big ? '文件有点大，正在解析（只取最近 400 天）…' : '正在读取…');
        try {
          const r = await Health.scanFile(f);
          const ms = Health.metrics(r.acc);
          window._healthMs = ms;
          const box = $('healthPreview');
          if (box) box.innerHTML = UI.healthMetricsHTML(ms);
          toast(ms.length ? ('识别到 ' + ms.length + ' 个指标') : '没认出数据：zip 要先解压，选里面的 export.xml');
        } catch (e) {
          toast('读取失败：' + (e && e.message ? e.message : '文件格式不支持'));
        }
      });
    },
    healthparse() {
      const t = (($('hText') || {}).value || '').trim();
      if (!t) return toast('先粘贴数据');
      if (!window.Health) return toast('导入模块没加载出来，刷新一下再试');
      const r = Health.parseText(t);
      const ms = Health.metrics(r.acc);
      window._healthMs = ms;
      const box = $('healthPreview');
      if (box) box.innerHTML = UI.healthMetricsHTML(ms);
      toast(ms.length ? ('识别到 ' + ms.length + ' 个指标') : '没认出数据');
    },
    /* 单个指标导入：目标习惯可以现场新建（默认），阈值来自输入框 */
    healthapply(el) {
      const i = Number((el && el.dataset && el.dataset.idx) || -1);
      const m = (window._healthMs || [])[i];
      if (!m) return toast('先选文件解析一下');
      const sel = ($('hItem_' + i) || {}).value || 'new';
      const thr = parseFloat(($('hThr_' + i) || {}).value || '0') || 0;
      const id = sel === 'new' ? Health.makeHabit(m) : sel;
      const r = Health.apply(m, id, { thr: thr, mode: 'empty' });
      /* v47：顺手把按天数值存进缓存 —— 设了「自动勾选」的习惯以后就靠这份数据自己打勾 */
      try { Health.remember([m]); } catch (e) { }
      const at = runHealthAuto();
      UI.closeSheet(); UI.render();
      const autoTip = autoTipOf(at);
      toast(r.ok
        ? (r.days === 0
          ? ('「' + r.name + '」这 ' + r.skipped + ' 天都已经有记录了，没动它们' + autoTip)
          : ('「' + r.name + '」补了 ' + r.days + ' 天' + (r.skipped ? '，跳过已有 ' + r.skipped + ' 天' : '') + '，其中 ' + r.done + ' 天算完成' + autoTip))
        : r.msg);
    },
    healthall() {
      const ms = window._healthMs || [];
      if (!ms.length) return toast('先选文件解析一下');
      let days = 0, habits = 0, done = 0;
      ms.forEach((m, i) => {
        const sel = ($('hItem_' + i) || {}).value || 'new';
        const thr = parseFloat(($('hThr_' + i) || {}).value || '0') || 0;
        const id = sel === 'new' ? Health.makeHabit(m) : sel;
        const r = Health.apply(m, id, { thr: thr, mode: 'empty' });
        if (r.ok) { days += r.days; done += r.done; habits++; }
      });
      try { Health.remember(ms); } catch (e) { }
      const at = runHealthAuto();
      UI.closeSheet(); UI.render();
      toast('导入了 ' + habits + ' 个指标、' + days + ' 天数据，其中 ' + done + ' 天算完成' + autoTipOf(at));
    },
    /* 手动跑一次自动勾选规则（面板上的「现在检查一次」） */
    healthauto() {
      const at = runHealthAuto();
      UI.render();
      if (!Health.autoList().length) return toast('还没有习惯设「健康数据自动勾选」，编辑习惯时可以打开');
      if (at.ticks.length) return toast('刚自动勾选了 ' + at.ticks.length + ' 条：' + at.ticks.map(t => t.name).slice(0, 3).join('、'));
      toast(at.noData ? '最近两天还没有这些指标的数值，先把健康数据导进来' : '最近两天没有新的达标数据，暂时不用勾');
    },

    plg_export() { UI.openExport(); },
    async exportmd() {
      toast('正在生成…');
      try {
        U.download('日拱一卒-日记-' + U.today() + '.md', await Plugins.exportMarkdown('md'), 'text/markdown;charset=utf-8');
        toast('已导出');
      } catch (e) { toast('导出失败：' + e.message); }
    },
    async exportobs() {
      toast('正在生成…');
      try {
        U.download('日拱一卒-Obsidian-' + U.today() + '.md', await Plugins.exportMarkdown('obsidian'), 'text/markdown;charset=utf-8');
        toast('已导出');
      } catch (e) { toast('导出失败：' + e.message); }
    },
    exportcsv() {
      U.download('日拱一卒-打卡明细-' + U.today() + '.csv', Plugins.exportCSV(), 'text/csv;charset=utf-8');
      toast('已导出 CSV');
    },
    plg_api() { UI.openApi(); },

    /* ---------- 待办（一次性任务） ---------- */
    todoadd() {
      const box = $('todoInput');
      const title = ((box && box.value) || '').trim();
      if (!title) { toast('先写点内容'); if (box) box.focus(); return; }
      const prioEl = document.querySelector('#todoPrio .chip.on');
      const dueEl = $('todoDue');
      Todo.add({
        title: title,
        priority: prioEl ? Number(prioEl.dataset.v) : 1,
        due: (dueEl && dueEl.value) || null
      });
      if (box) { box.value = ''; box.focus(); }
      if (dueEl) dueEl.value = '';
      if (window.UX) UX.sfx('tap');
      UI.render();
      toast('已添加');
    },
    todotoggle(el) {
      const on = Todo.toggle(el.dataset.id);
      if (window.UX) UX.sfx(on ? 'on' : 'off');
      U.vibrate(on ? 14 : 8);
      UI.closeSheet();
      UI.render();
      if (on) toast('完成 ✓');
    },
    todoedit(el) { const t = Todo.find(el.dataset.id); if (t) UI.openTodoEdit(t); },
    todomenu(el) { const t = Todo.find(el.dataset.id); if (t) UI.openTodoMenu(t); },
    todoprio(el) {
      el.parentNode.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      el.classList.add('on');
    },
    todosave(el) {
      const id = el.dataset.id;
      const title = (($('tdTitle') || {}).value || '').trim();
      if (!title) { toast('标题不能为空'); return; }
      const prioEl = document.querySelector('#tdPrio .chip.on');
      const patch = {
        title: title,
        priority: prioEl ? Number(prioEl.dataset.v) : 1,
        due: (($('tdDue') || {}).value) || null,
        note: (($('tdNote') || {}).value || '').trim()
      };
      if (id) Todo.update(id, patch); else Todo.add(patch);
      UI.closeSheet(); UI.render(); toast('已保存');
    },
    tododel(el) {
      const t = Todo.find(el.dataset.id);
      if (!t) return;
      Todo.remove(t.id);
      UI.closeSheet(); UI.render(); toast('已删除');
    },
    todosub(el) { Todo.toggleSub(el.dataset.id, el.dataset.sub); UI.render(); },
    todosubdel(el) {
      Todo.delSub(el.dataset.id, el.dataset.sub);
      const t = Todo.find(el.dataset.id), box = $('tdSubs');
      if (box && t) box.innerHTML = UI.subRowsHTML(t);
      UI.render();
    },
    todosubadd(el) {
      const id = el.dataset.id;
      const inp = $('tdSubInput');
      const text = ((inp && inp.value) || '').trim();
      if (!text) { toast('先写点内容'); return; }
      Todo.addSub(id, text);
      if (inp) { inp.value = ''; inp.focus(); }
      const t = Todo.find(id), box = $('tdSubs');
      if (box && t) box.innerHTML = UI.subRowsHTML(t);
    },
    todocleardone() {
      const done = Todo.all().filter(t => t.done);
      if (!done.length) return toast('没有已完成的待办');
      const ids = done.map(t => t.id);
      Store.commit(s => {
        (s.todos || []).forEach(t => {
          if (ids.indexOf(t.id) >= 0) { t.deleted = true; t.updatedAt = Date.now(); }
        });
      });
      UI.render(); toast('已清理 ' + done.length + ' 条');
    },
    todopreset() {
      [['买跑鞋', 2, null], ['给妈妈打个电话', 1, U.today()], ['整理桌面', 0, null]].forEach(function (x) {
        Todo.add({ title: x[0], priority: x[1], due: x[2] });
      });
      UI.render(); toast('加了 3 条示例，随手改就行');
    },

    /* ---------- 引导式挑战 ---------- */
    chaljoin(el) {
      const c = Challenge.join(el.dataset.k);
      if (!c) return;
      UI.closeSheet(); UI.go('habits');
      toast('已加入「' + c.name + '」，习惯也建好了');
    },
    chalquit(el) {
      const c = Challenge.find(el.dataset.id);
      if (!c) return;
      Challenge.leave(c.id);
      UI.closeSheet(); UI.render(); toast('已退出挑战（习惯会保留）');
    },
    chaldetail(el) { const c = Challenge.find(el.dataset.id); if (c) UI.openChalDetail(c); },
    challib() { UI.openChalLib(); },
    /* v59 · 自建挑战：名称 + 绑已有习惯（或自动建同名）+ 天数，奖励在 Challenge.createCustom 里按天数算 */
    chalcreate() {
      const name = ($('chName').value || '').trim();
      const days = +($('chDays').value || 0) || 21;
      if (!name) return toast('先给挑战起个名字');
      const hv = $('chHabit').value;
      const it = hv ? (Store.s.items || []).find(x => x.id === hv && !x.deleted && !x.archived) : null;
      const c = Challenge.createCustom({ name, days, habitName: it ? it.name : name });
      if (!c) return toast('没建成 —— 天数要在 7 到 100 之间');
      UI.closeSheet(); UI.render();
      UX.sfx('tap');
      toast('挑战开始 · 通关奖励 ' + c.reward + ' 分 🎯');
    },
    chalhabit() { UI.closeSheet(); UI.go('today'); },

    /* ---------- 搭子（v32 · 4.7） ---------- */
    buddynew() { UI.openBuddyNew(); },
    async buddycreate() {
      const habitId = ($('bdHabit') || {}).value;
      const name = ($('bdNick') || {}).value || '';
      const r = await Buddy.create(habitId, name);
      if (!r.ok) { toast(r.msg); return; }
      UI.openBuddyInvite(r.code);
      UI.render();
    },
    async buddyjoin(el) {
      const habitId = ($('bdHabit') || {}).value;
      const name = ($('bdNick') || {}).value || '';
      const r = await Buddy.join(el.dataset.code, habitId, name);
      if (!r.ok) { toast(r.msg); return; }
      UI.closeSheet(); UI.render();
      toast(r.peer ? '加入成功，和「' + r.peer.nick + '」一起坚持' : '加入成功，等对方也打开应用');
    },
    buddyinvite() { UI.openBuddyInvite(); },
    async buddysync() {
      const r = await Buddy.sync();
      UI.render();
      toast(r.ok ? (r.peer ? '已同步' : '还没等到对方加入') : r.msg);
    },
    async buddycheer() {
      const r = await Buddy.cheer();
      UI.render();
      if (r.ok) { if (window.UX) UX.sfx('on'); toast('气已经送到 👋'); }
      else toast(r.msg);
    },
    buddymenu() { UI.openBuddyMenu(); },
    buddyleaveask() { UI.openBuddyLeaveAsk(); },
    async buddyleave() {
      const r = await Buddy.leave();
      UI.closeSheet(); UI.render();
      toast(r.pending ? '已退出，服务端那条记录会在联网后补删' : '已退出搭子');
    },
    buddyrepick() { Buddy.leave().then(() => { UI.render(); UI.openBuddyNew(); }); },
    buddyclose() { UI.closeSheet(); },
    async buddycopy() {
      const b = Buddy.mine();
      const link = Buddy.inviteLink(b && b.code);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(link);
        else {
          const ta = document.createElement('textarea');
          ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); ta.remove();
        }
        toast('链接已复制');
      } catch (e) { toast('复制失败，长按上面的链接手动复制'); }
    },
    async buddyshare() {
      const b = Buddy.mine();
      const link = Buddy.inviteLink(b && b.code);
      try {
        if (navigator.share) await navigator.share({ title: '一起坚持一个习惯', text: '我在「日拱一卒」给你留了个搭子位，点开就能加入：', url: link });
        else await ACT.buddycopy();
      } catch (e) { /* 用户取消分享，什么都不做 */ }
    },

    /* ---------- 习惯计时器 ---------- */
    timeropen(el) { const it = findItem(el.dataset.id); if (it) UI.openTimer(it); },
    /* 卡片上的「开始」（v31 · 4.6）：1 次点击开始计时并弹出面板。
     * 换习惯计时时，先把上一个已计的时间留下，别让人白计。 */
    timerstart(el) {
      const it = findItem(el.dataset.id);
      if (!it || !window.Timer) return;
      const cur = Timer.active();
      if (cur && cur.itemId !== it.id) {
        const r = Timer.keepStop();
        if (r && r.minutes > 0) toast('已结束「' + (r.item ? r.item.name : '上一个') + '」的计时，保留 ' + r.minutes + ' 分钟');
      }
      Timer.start(it.id);
      UI.render();          // 卡片上的「开始 → 计时中」要立刻变脸
      UI.openTimer(it);
    },
    timertoggle() { Timer.toggle(); },
    timerfinish() {
      const t = Timer.active();
      const it = t ? Timer.item() : null;
      const reached = !!(it && it.target && Timer.elapsed(t) >= it.target * 60000);
      const r = reached ? Timer.finish() : Timer.keepStop();
      UI.closeSheet(); UI.render();
      if (r && r.item) {
        if (reached) { if (window.UX) UX.sfx('on'); toast('记下 ' + r.minutes + ' 分钟，今天已完成 ✓'); }
        else if (r.minutes > 0) toast('已保留 ' + r.minutes + ' 分钟，还差 ' + Math.max(0, Math.round((it.target || 0) - r.minutes)) + ' 分钟达标');
        else toast('不足 1 分钟，没有记录');
      }
    },
    timercancel() { Timer.cancel(); UI.closeSheet(); UI.render(); toast('已删除这次计时，没有记录'); },
    timerreset() { Timer.reset(); toast('已从 0 开始重新计时'); },

    /* ---------- 习惯分组视图 ---------- */
    togglegroups() { Store.commit(s => { s.settings.habitGroups = !s.settings.habitGroups; }); UI.render(); },
    hgroupfold(el) { UI.toggleGroup(el.dataset.g); UI.render(); },
    gotodos() { UI.go('todos'); },

    /* 「连续」口径说明：全站连续 / 单习惯连续 / 该习惯连续是三种东西，摊开讲清楚 */
    streakinfo() { if (window.UI) UI.openStreakInfo(); },

    /* 习惯详情里的趋势图：切换 30 / 90 天，只重画图表那一块 */
    chartrange(el) { if (window.UI) UI.repaintTrendChart(el); }
  };

  let _dyTimer = null;   // 日记正文防抖保存
  let _dyPending = null;
  let _dsTimer = null;   // 日记搜索防抖

  /* 切日期 / 切视图前把还没落盘的字先存掉，避免防抖窗口内丢内容 */
  function flushDiary() {
    clearTimeout(_dyTimer);
    try {
      if (_dyPending && window.Diary) {
        Diary.setText(_dyPending.date, _dyPending.text);
        _dyPending = null;
      }
    } catch (e) { }
  }

  function findItem(id) { return (Store.s.items || []).find(x => x.id === id); }

  /* 习惯排序：把某个习惯在"活跃列表"里上/下挪一格，然后重排整个列表的 sort。
   * 不做增量交换 —— 老数据里 sort 可能重复或缺失（导入 / 早期版本），
   * 整体重排一次最省心，也保证今日页顺序与习惯页一致。 */
  function moveHabit(id, dir) {
    let moved = false;
    Store.commit(st => {
      /* 与 Engine.sorted() 同一套排序规则（这里要就地改 sort，故不能直接用缓存结果） */
      const list = (st.items || [])
        .filter(x => !x.deleted && !x.archived)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const i = list.findIndex(x => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      const arr = list.slice();
      arr.splice(j, 0, arr.splice(i, 1)[0]);
      arr.forEach((x, k) => { x.sort = k; });
      moved = true;
    });
    if (!moved) return;
    UI.render();
    U.vibrate(8);
  }

  /* v56：把习惯直接移到列表头/尾（排序菜单的直达项，省去一格一挪） */
  function moveHabitTo(id, edge) {
    let moved = false;
    Store.commit(st => {
      const list = (st.items || [])
        .filter(x => !x.deleted && !x.archived)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const i = list.findIndex(x => x.id === id);
      if (i < 0 || list.length < 2) return;
      const j = edge === 'top' ? 0 : list.length - 1;
      if (i === j) return;
      const arr = list.slice();
      arr.splice(j, 0, arr.splice(i, 1)[0]);
      arr.forEach((x, k) => { x.sort = k; });
      moved = true;
    });
    if (!moved) return;
    UI.render();
    U.vibrate(8);
  }

  /* 视频播放浮层：全屏、带原生控件、点背景关闭。
   * 用 <video> 而不是弹新窗口 —— iOS 上弹新窗口会把 PWA 踢到浏览器里。 */
  function videoPlayer(url, title) {
    let d = $('vidbox');
    if (!d) {
      d = document.createElement('div');
      d.id = 'vidbox';
      d.style.cssText = 'position:fixed;inset:0;z-index:130;background:rgba(0,0,0,.94);display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;padding:16px';
      d.innerHTML = '<video controls playsinline preload="metadata" ' +
        'style="max-width:100%;max-height:78vh;border-radius:12px;background:#000"></video>' +
        '<div style="display:flex;gap:10px;margin-top:14px">' +
        '<button class="btn sm ghost" id="vidClose">关闭</button></div>' +
        '<div id="vidTip" style="color:#bbb;font-size:12px;margin-top:8px;text-align:center"></div>';
      d.addEventListener('click', e => {
        if (e.target === d || e.target.id === 'vidClose') {
          const v = d.querySelector('video');
          try { v.pause(); } catch (err) { }
          d.style.display = 'none';
        }
      });
      document.body.appendChild(d);
    }
    const v = d.querySelector('video');
    v.src = url;
    d.querySelector('#vidTip').textContent = title || '';
    d.style.display = 'flex';
    try { v.play().catch(() => { }); } catch (e) { }
  }

  function lightbox(url) {
    let d = $('lightbox');
    if (!d) {
      d = document.createElement('div');
      d.id = 'lightbox';
      d.style.cssText = 'position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
      d.innerHTML = '<img style="max-width:100%;max-height:100%;border-radius:8px">';
      d.addEventListener('click', () => { d.style.display = 'none'; });
      document.body.appendChild(d);
    }
    d.querySelector('img').src = url;
    d.style.display = 'flex';
  }

  function copy(txt) {
    try {
      navigator.clipboard.writeText(txt).then(() => toast('已复制'), () => toast('复制失败'));
    } catch (e) { toast('复制失败'); }
  }

  function pickFile(accept, cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => { const f = inp.files[0]; if (f) cb(f); };
    inp.click();
  }

  /* 统一走日记模块的压缩上传：长边 1600px、JPEG 0.82，本机只留缩略图 */
  async function savePhoto(file, date) {
    const d = date || U.today();
    const r = await Diary.addPhoto(d, file);
    if (!r.ok) return toast(r.msg || '保存失败');
    UI.render();
    toast(r.skipped ? '照片已保存' : '已压缩到 ' + U.bytes(r.size) + '（原图 ' + U.bytes(r.raw) + '）');
  }

  /* 视频：不压缩（浏览器里没有可靠的转码方案），靠大小 / 时长 / 条数三道闸门兜住。
   * 保存过程要解码抽封面，60MB 的文件在手机上要几秒，所以先给一个"正在处理"的反馈。 */
  async function saveVideo(file, date) {
    const d = date || U.today();
    if (!file) return;
    const mb = (file.size || 0) / 1048576;
    if (mb > Diary.MAX_VIDEO_MB) {
      return toast('这段视频 ' + mb.toFixed(1) + 'MB，超过 ' + Diary.MAX_VIDEO_MB + 'MB 上限；先裁短一点再传');
    }
    toast('正在处理视频…');
    const r = await Diary.addVideo(d, file);
    if (!r.ok) return toast(r.msg || '保存失败');
    UI.render();
    const bits = [U.dur(r.dur) || '', U.bytes(r.size)].filter(Boolean).join(' · ');
    toast('视频已保存' + (bits ? '（' + bits + '）' : ''));
  }

  async function recordAudio(date) {
    const d = date || U.today();
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast('当前浏览器不支持录音');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const id = U.uid('au');
        await Store.putMedia(id, blob, { kind: 'audio', date: d });
        Store.commit(s => {
          if (!s.notes) s.notes = {};
          s.notes[d] = s.notes[d] || { text: '', photos: [], audios: [] };
          s.notes[d].audios = s.notes[d].audios || [];
          s.notes[d].audios.push({ id, ts: Date.now() });
        });
        toast('语音已保存');
        if (window.UI) UI.render();
      };
      rec.start();
      toast('开始录音，5 秒后自动结束');
      setTimeout(() => { try { rec.stop(); } catch (e) { } }, 5000);
    } catch (e) { toast('无法录音：' + e.message); }
  }

  /* v36 · 设密码：两遍一致 + 至少 8 位。最多三轮，不把用户困在循环里。
   * 密码只活在这个函数的局部变量里，不写 state、不写 localStorage、不发请求。 */
  async function askPassword() {
    for (let i = 0; i < 3; i++) {
      const a = await UX.prompt({
        icon: 'lock', title: '设置备份密码',
        msg: '至少 8 位。密码不会存在任何地方，忘了这份备份就打不开。',
        type: 'password', placeholder: '输入密码'
      });
      if (a == null) return null;
      if (String(a).length < 8) { toast('密码至少 8 位'); continue; }
      const b = await UX.prompt({
        icon: 'lock', title: '再输一次',
        msg: '确认没有打错 —— 打错了这份备份就真的打不开了。',
        type: 'password', placeholder: '再输一次'
      });
      if (b == null) return null;
      if (a !== b) { toast('两次输入不一致，再来一次'); continue; }
      return a;
    }
    return null;
  }

  /* v41 · 报告 P2-7：给导出文件加校验和。
   * 半截文件是最难查的事故 —— 数据"有一部分"，用户不会怀疑文件，只会觉得记录丢了。
   * 算法只用 Store.checksum（FNV-1a + 长度），不是安全用途，只回答「文件完整吗」。 */
  function withChecksum(data) {
    try {
      data.checksum = Store.checksum(JSON.stringify(data));
    } catch (e) { }
    return data;
  }

  async function importFile(file) {
    try {
      const txt0 = await file.text();
      let txt = txt0;
      let peek = null;
      try { peek = JSON.parse(txt0); } catch (e) { peek = null; }
      /* v36 · 加密备份：先要密码，解开之后走和普通备份一模一样的流程
       * （预览、合并/覆盖、导入前快照都在后面，不需要另开一套）。 */
      let wasEnc = false;
      if (window.Enc && Enc.isEnvelope(peek)) {
        if (!Enc.available()) { toast('这个地址不支持解密，请用 https 或本机地址打开'); return; }
        const pw = await UX.prompt({
          icon: 'lock', title: '这份备份是加密的',
          msg: '输入导出时设的密码。密码错了打不开，也没有别的办法能绕过。',
          type: 'password', placeholder: '密码'
        });
        if (pw == null) return;
        try { txt = await Enc.decrypt(peek, pw); }
        catch (e) { return toast(e && e.message ? e.message : '解密失败'); }
        wasEnc = true;
        try { peek = JSON.parse(txt); } catch (e) { peek = null; }
      }
      /* v41 · 报告 P2-7：校验和。老备份没有这个字段，有就必须对得上。 */
      if (peek && peek.checksum && window.Store && Store.checksum) {
        const copy = Object.assign({}, peek);
        delete copy.checksum;
        let sum = '';
        try { sum = Store.checksum(JSON.stringify(copy)); } catch (e) { sum = ''; }
        if (sum && sum !== peek.checksum) {
          const go = await UX.confirm({
            icon: 'warning-circle', danger: true, title: '这份备份可能不完整',
            html: '校验和对不上 —— 文件在传输或保存时可能被截断了。' +
              '<div class="cf-sub">继续导入可能只恢复一部分记录。建议重新拷一份原文件再来。</div>',
            ok: '仍然导入', cancel: '取消'
          });
          if (!go) return;
        }
      }
      let mode = 'merge';
      /* 先看一眼备份是从哪来的：如果来自别的网址，说明用户在跨地址搬家，
       * 这时"合并"几乎是唯一正确的选择（本机多半是空的），要主动替他选好。 */
      let fromHost = '';
      let backupHint = '';
      try {
        /* 加密备份这里已经解过一遍了，别重复 parse（大文件 parse 两次很贵） */
        const src = peek && peek.state ? peek.state : peek;
        const fromOrigin = src && src.settings && src.settings.lastOrigin;
        if (fromOrigin && fromOrigin !== location.origin) {
          try { fromHost = new URL(fromOrigin).host; } catch (e) { fromHost = fromOrigin; }
        }
        const n = src && src.items ? (src.items || []).length : 0;
        const days = src && src.logs ? Object.keys(src.logs).length : 0;
        /* v35 · 外部评审 P1-4：预览要能回答「我到底会得到什么、会不会和现有数据打架」。
         * 只报「N 个习惯、M 天记录」不够 —— 日期范围、附件在不在、哪些日子已经有过记录，
         * 这三件事缺一件，用户就是在盲猜。 */
        const ds = src && src.logs ? Object.keys(src.logs).sort() : [];
        const cur = Store.s || {};
        const curNames = {};
        (cur.items || []).forEach(i => { if (i && i.name) curNames[String(i.name)] = 1; });
        const sameName = (src.items || []).filter(i => i && i.name && curNames[String(i.name)]).length;
        const overlap = ds.filter(d => (cur.logs || {})[d] && Object.keys((cur.logs || {})[d] || {}).length).length;
        const med = peek && peek.media ? peek.media : null;
        const medN = med ? Object.keys(med).length : 0;
        const notes = src && src.notes ? Object.keys(src.notes).length : 0;
        let line = '这份备份共 <b>' + n + '</b> 个习惯、<b>' + days + '</b> 天记录、<b>' + notes + '</b> 天日记';
        if (ds.length) line += '，日期从 ' + U.esc(ds[0]) + ' 到 ' + U.esc(ds[ds.length - 1]);
        line += '。';
        backupHint = '<div class="cf-sub">' + line + '</div>';
        backupHint += '<div class="cf-sub">附件：' + (medN ? '内嵌 ' + medN + ' 个（照片/语音/视频，导入时会一起还原）' : '这份备份没有内嵌附件') + '</div>';
        backupHint += '<div class="cf-sub">与当前数据的关系：' +
          (sameName ? '<b>' + sameName + '</b> 个习惯和本机同名（合并时会并到一起）' : '没有同名习惯') + '；' +
          (overlap ? '<b>' + overlap + '</b> 天本机已有记录（合并时保留较新的那条）' : '没有重叠日期') + '。</div>';
        if (fromHost) backupHint = '<div class="cf-sub">来自 <b>' + U.esc(fromHost) + '</b>，跨地址搬家。</div>' + backupHint;
        if (wasEnc) backupHint = '<div class="cf-sub">这份备份是加密的，密码已通过校验。</div>' + backupHint;
        /* 来自更新版本的备份：说清楚，别让用户以为丢数据是应用的问题 */
        if (peek && peek.schema && peek.schema > 7) {
          backupHint = '<div class="cf-sub">这份备份来自更新的版本（schema ' + peek.schema + '），个别新字段可能读不出来。</div>' + backupHint;
        }
      } catch (e) { /* 解析失败留给 importJSON 报错，这里不拦 */ }
      if (window.Safety) Safety.snapshot('pre-import-' + Date.now());   // 导入前先留一份退路
      const replace = await UX.confirm({
        icon: 'download', title: '怎么导入这份备份？',
        html: '<b>合并</b>：保留当前数据，把备份里的记录并进来（推荐）。<br>' +
          '<b>覆盖</b>：用备份完全替换当前数据，本机现有记录会被清掉。' +
          backupHint +
          '<div class="cf-sub">两种都会先在本机存一份导入前快照，可在「我的 → 数据安全网」回滚。</div>',
        ok: '覆盖当前数据', cancel: '合并到当前数据'
      });
      mode = replace ? 'replace' : 'merge';
      await Store.importJSON(txt, mode);
      /* 已经搬过来了，换地址提示的使命完成。同时把"所属网址"改成当前地址 ——
       * 之后再换地址时，提示才会针对这次的地址重新出现。 */
      Store.commit(s => {
        s.settings.movedHintOff = 1;
        try { s.settings.lastOrigin = location.origin; } catch (e) { }
      });
      applyTheme(); UI.render();
      toast(fromHost ? ('导入成功，' + fromHost + ' 的记录已合并回来') : '导入成功');
    } catch (e) { toast('导入失败：' + e.message); }
  }

  /* ---------- 语音 ---------- */
  function startVoice() {
    if (!Feat.Voice.supported()) { toast('当前浏览器不支持语音识别'); return; }
    $('btnVoice').classList.add('on');
    const ok = Feat.Voice.start(text => {
      $('btnVoice').classList.remove('on');
      if (!text) return;
      const r = Feat.Voice.run(text);
      applyTheme(); UI.render();
      toast(r ? r.msg : '没听懂');
    });
    if (!ok) $('btnVoice').classList.remove('on');
  }

  /* ---------- 外部 URL 命令 ----------
   * 注意这是 async：WebDAV 命令要等网盘回应，而 url 命令本来就是
   * 「打到地址栏 / 快捷指令里」的入口，晚 200ms 出回执没有人在意。 */
  async function runUrlCommand() {
    let q = null;
    try {
      const sp = new URLSearchParams(location.search);
      if (sp.get('cmd')) q = sp;
      else {
        const h = location.hash.replace(/^#/, '');
        if (h.indexOf('cmd') === 0) {
          const i = h.indexOf('?');
          q = new URLSearchParams(i >= 0 ? h.slice(i + 1) : h.slice(3));
        }
      }
    } catch (e) { }
    if (!q) return;
    /* 先擦参数再执行：一条 URL 只该干一次活。
     * 不擦的话，用户刷新页面会把刚才的打卡再切换一次（toggle 语义下等于取消），
     * 或者状态页把用户正在看的界面整个替换掉 —— 这就是"闹鬼"。 */
    try {
      const url = new URL(location.href);
      if (url.searchParams.get('cmd')) url.searchParams.delete('cmd');
      ['do', 'act', 'name', 'habit', 'v', 'value', 't', 'text'].forEach(k => url.searchParams.delete(k));
      if (location.hash.indexOf('cmd') === 0) {
        history.replaceState(history.state, '', url.pathname + url.search);
      } else {
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      }
    } catch (e) { }
    /* runCommand 改 async 了（WebDAV 命令要等网盘回应），这里统一 await：
     * 同步命令返回普通对象，await 一下也不会有差别。 */
    const r = await Plugins.runCommand(q);
    if (r.status) {
      const j = JSON.stringify(Plugins.statusJSON(), null, 2);
      try { navigator.clipboard.writeText(j); } catch (e) { }
      const v = $('view');
      if (v) {
        v.innerHTML = '<div class="card"><div style="font-weight:650;margin-bottom:8px">今日状态</div>' +
          '<pre style="white-space:pre-wrap;font-size:12px;margin:0">' + U.esc(j) + '</pre>' +
          '<div class="muted" style="margin-top:8px">已复制到剪贴板</div></div>';
      }
    } else {
      /* 确认回执：成功失败都要在页面上说明白。
       * 自动化调用方（iOS 快捷指令 / 安卓自动化 / n8n）是"看不见 toast"的 ——
       * 它们只认页面内容。以前只弹一个两秒就消失的提示，等于没有回执。 */
      const v = $('view');
      if (v) {
        v.innerHTML = '<div class="card"><div style="font-weight:650;margin-bottom:8px">' +
          (r.ok ? '已执行' : '没执行成功') + '</div>' +
          '<div style="font-size:15px;' + (r.ok ? '' : 'color:var(--danger)') + '">' + U.esc(r.msg || '未知结果') + '</div>' +
          '<div class="muted" style="margin-top:10px">这条链接的命令已执行过一次，参数已从地址栏移除；' +
          '需要再执行一次就重新打开原链接。</div></div>';
      } else {
        toast(r.msg);
      }
    }
  }

  /* ---------- PWA 快捷菜单（manifest 的 shortcuts） ----------
   * 长按桌面图标出来的三个入口（对标建议 4.5）：?go=today / ?pomo=1 / ?write=1。
   * 参数要从地址栏擦掉 —— 否则刷新一次就又触发一次（用户会以为"闹鬼"）。 */
  function runShortcuts() {
    let sp = null;
    try { sp = new URLSearchParams(location.search); } catch (e) { return; }
    const hasQuick = sp.get('quickadd') === '1', hasVoice = sp.get('voice') === '1';
    const hasPomo = sp.get('pomo') === '1', hasWrite = sp.get('write') === '1';
    const go = sp.get('go');
    if (!hasQuick && !hasVoice && !hasPomo && !hasWrite && !go) return;
    /* 先擦参数，再干正事 */
    try {
      const url = new URL(location.href);
      url.searchParams.delete('quickadd'); url.searchParams.delete('voice');
      url.searchParams.delete('pomo'); url.searchParams.delete('write');
      if (go) url.searchParams.delete('go');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch (e) { }
    if (hasQuick) {
      const d = U.today();
      const it = (Store.s.items || []).find(x => !x.deleted && !x.archived && Engine.isDue(x, d) && !Engine.isDone(x, d));
      if (!it) toast('今天没有待完成的习惯 🎉');
      else if (it.type === 'check' || it.type === 'avoid') {
        Engine.toggle(it, d); Store.commit(); UI.render();
        if (window.UX) UX.sfx('on');
        if (window.FX) FX.celebrate(Engine.todayRate(d).pct, '已完成：' + it.name);
        /* v48：长按图标的快捷入口没有页面可看，必须给一句回执，
         * 否则用户不确定到底打上了没有（彩带动画在系统启动时可能被跳过）。 */
        toast('已完成：' + it.name);
      } else UI.openQuickAdd(it.id);
    }
    if (hasVoice) {
      const btn = document.getElementById('btnVoice');
      if (btn) btn.click();
      else toast('当前浏览器不支持语音打卡');
    }
    /* 番茄钟：打开面板并直接开始一段专注，长按图标一步到位 */
    if (hasPomo) {
      UI.go('today');
      UI.openPomo();
      if (window.Feat && Feat.Pomo && Feat.Pomo.mode === 'idle') {
        const len = Store.s.settings.pomoLen || 25;
        Feat.Pomo.start(len, '专注');
        UI.openPomo();
      }
    }
    /* 写日记：直接落到「写」视图，不要再让用户点一次 Tab 再点一次 */
    if (hasWrite) {
      if (window.UI.setDiaryDate) UI.setDiaryDate(null);
      if (window.UI.setDiaryView) UI.setDiaryView('write');
      UI.go('diary');
    }
  }

  /* ---------- 事件绑定 ---------- */
  /* 手速快时会重复触发的动作。UX.busy 的锁打在元素 dataset 上，
   * 但 render / patchToday 会把元素整个换掉 —— 锁随之失效，连点照样穿透。
   * 所以在委托层再兜一道时间锁，只按 act 记时间，跟元素无关。 */
  const THROTTLE = {
    tick: 80, addphoto: 200, addaudio: 200, viewphoto: 80, delphoto: 200,
    dyaddphoto: 200, dyaddaudio: 200, dyphoto: 80, dymove: 80, dydelphoto: 200,
    dydelaudio: 200, dyplayaudio: 200, mood: 80, newhabit: 200, addbundle: 200,
    /* 视频要解码抽帧，手机上几秒才回来；不锁的话连点会同时开三条解码 */
    addvideo: 1500, dyaddvideo: 1500, dyvideo: 200, dyplayvideo: 600, dydelvideo: 600,
    usefreezebreak: 300, fixyesterday: 300, sharecard: 400, importcsv: 400,
    /* 导出 CSV 走系统保存面板，点两下会弹两次，锁 1.2s */
    exportcsv: 1200,
    /* 导出会走系统分享面板，点两下会弹两次面板，必须锁掉 */
    quickexport: 800, dismissmovedhint: 200, dismissbackuphint: 200
  };
  const _lastHit = {};

  /* 长按菜单弹出后，手指抬起时浏览器还会补一个 click —— 会误触发卡片上的打卡 */
  let _suppressClick = 0;
  function onClick(e) {
    if (Date.now() < _suppressClick) return;
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'noteinput' || act === 'moodx') return;
    if (typeof ACT[act] !== 'function') return;
    e.preventDefault();
    const gap = THROTTLE[act];
    if (gap) {
      const now = Date.now();
      if (_lastHit[act] && now - _lastHit[act] < gap) return;
      _lastHit[act] = now;
    }
    // 统一防重复点击 + loading 状态（异步动作会一直转到 Promise 结束）
    if (window.UX) UX.busy(el, ACT[act]);
    else ACT[act](el);
  }

  /* ---------- 卡片手势：右滑打卡 / 左滑菜单 / 长按菜单 ----------
   * 请假、补卡、统计这些低频动作不该占卡片的位置，收进手势里；
   * 打卡是最高频动作，值得给它一个单手就能完成的滑动。
   * 三个坑必须处理对：
   *   ① 手指一移动就取消长按定时器（否则滚动列表会误弹菜单）；
   *   ② 首次移动先判主轴：竖了就把手势彻底让给滚动，绝不抢；
   *   ③ 滑出动作后挡掉随之而来的那一次 click（否则会顺手再打一次卡）。 */
  function bindHabitGestures() {
    const v = $('view');
    if (!v) return;
    const OPEN = 62, MAX = 104, FAST = 0.55;
    let t = null, id = null, sx = 0, sy = 0, moved = false;
    let _card = null, _body = null, axis = null, dx = 0, lx = 0, lt = 0, vel = 0;

    function slide(el, x) { if (el) el.style.transform = x ? ('translateX(' + x + 'px)') : ''; }
    function clearState() {
      clearTimeout(t); t = null;
      if (_card) _card.classList.remove('swiping');
      _card = null; _body = null; id = null; moved = false; axis = null; dx = 0; vel = 0;
    }
    function reset() { if (_body) slide(_body, 0); clearState(); }

    /* 开菜单：先把手势状态清干净，再挡掉这次 click，最后震动 + 弹面板 */
    function open(itemId) {
      if (!itemId) return;
      clearState();
      _suppressClick = Date.now() + 800;
      U.vibrate(14);
      UI.openHabitMenu(itemId);
    }
    function onCtl(e) {
      return e.target.closest && (e.target.closest('.h-ctl') || e.target.closest('[data-act="tick"]') ||
        e.target.closest('[data-act="plus"]') || e.target.closest('[data-act="minus"]') ||
        e.target.closest('[data-act="setval"]') || e.target.closest('[data-act="step"]'));
    }

    function start(el, x, y) {
      _card = el; _body = el.querySelector('.h-sw-body'); id = el.dataset.id;
      sx = x; sy = y; moved = false; axis = null; dx = 0; lx = x; lt = Date.now(); vel = 0;
      clearTimeout(t);
      t = setTimeout(function () { if (id && !moved) open(id); }, 460);
    }
    function move(x, y, ev) {
      if (!_card) return;
      const ddx = x - sx, ddy = y - sy;
      if (axis === null) {
        if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
        moved = true;
        clearTimeout(t); t = null;
        /* 横向位移要明显大于纵向才判成横滑，避免斜着划时误抢滚动 */
        if (Math.abs(ddx) > Math.abs(ddy) * 1.25) {
          axis = 'x';
          if (_card.dataset.sw === '1' && _body) _card.classList.add('swiping');
        } else { axis = 'y'; clearState(); return; }
      }
      if (axis !== 'x' || !_body) return;
      if (ev && ev.cancelable) ev.preventDefault();
      /* 阻尼：越过阈值后位移减速，手感更"实"，也提示用户已经拉到头了 */
      let d = ddx;
      if (d > MAX) d = MAX + (d - MAX) * 0.28;
      if (d < -MAX) d = -MAX + (d + MAX) * 0.28;
      dx = d;
      const now = Date.now();
      if (now - lt > 16) { vel = (x - lx) / Math.max(1, now - lt); lx = x; lt = now; }
      slide(_body, d);
    }
    function end() {
      if (!_card) { clearState(); return; }
      const c = _card, d = dx, fast = Math.abs(vel) > FAST;
      clearTimeout(t); t = null;
      c.classList.remove('swiping');
      if (_body) slide(_body, 0);
      const itemId = id;
      const canTick = c.dataset.sw === '1';
      _card = null; _body = null; id = null; axis = null; dx = 0; moved = false; vel = 0;
      if (d <= -OPEN || (d < -26 && vel < -FAST)) { open(itemId); return; }
      if (canTick && (d >= OPEN || (d > 26 && vel > FAST))) {
        _suppressClick = Date.now() + 620;
        U.vibrate(16);
        ACT.tick(c);
      }
    }

    v.addEventListener('touchstart', function (e) {
      const el = e.target.closest && e.target.closest('.hitem');
      if (!el || onCtl(e) || (e.touches && e.touches.length !== 1)) return;
      start(el, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    v.addEventListener('touchmove', function (e) {
      if (!_card || !e.touches || !e.touches[0]) return;
      move(e.touches[0].clientX, e.touches[0].clientY, e);
    }, { passive: false });
    v.addEventListener('touchend', end);
    v.addEventListener('touchcancel', reset);

    /* 桌面端：鼠标长按 + 右键 */
    v.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      const el = e.target.closest && e.target.closest('.hitem');
      if (!el || onCtl(e)) return;
      start(el, e.clientX, e.clientY);
    });
    v.addEventListener('mousemove', function (e) {
      if (!_card) return;
      if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) moved = true;
    });
    v.addEventListener('mouseup', clearState);
    v.addEventListener('mouseleave', clearState);
    v.addEventListener('contextmenu', function (e) {
      const el = e.target.closest && e.target.closest('.hitem');
      if (!el) return;
      e.preventDefault();
      open(el.dataset.id);
    });
  }

  /* ---------- 页面"活着"的心跳 ----------
   * 系统通知只在页面活着时才可能弹出来。判断「提醒到底有没有送到」，
   * 靠的是上次页面活跃的时间戳：离开超过 5 分钟，提醒基本就是漏了。 */
  function markAlive() {
    try { localStorage.setItem('rgz.lastSeen', String(Date.now())); } catch (e) { }
  }
  function wasAway(minutes) {
    let last = 0;
    try { last = parseInt(localStorage.getItem('rgz.lastSeen') || '0', 10); } catch (e) { }
    if (!last) return true;                       // 第一次打开，当"之前没开"
    return (Date.now() - last) > (minutes || 5) * 60000;
  }

  /* 兜底弹窗：提醒时间过了、页面当时没开 → 这次打开时把漏掉的习惯列出来 */
  function maybeMissedReminder() {
    if (!window.Remind || !Remind.pendingList) return;
    if (Remind.missedDismissed()) return;
    const list = Remind.pendingList();
    if (!list.length) return;
    /* 页面一直开着的话，通知刚才已经弹过了，不必再打扰一次 */
    if (!wasAway(5)) return;
    setTimeout(function () { try { UI.openMissedPanel(); } catch (e) { } }, 1500);
  }

  /* 周日 / 周一打开时，主动把本周回顾递到眼前（一周只递一次） */
  function maybeWeekCard() {
    if (!window.Extra || !window.UI) return;
    const st = Store.s;
    if (!st) return;
    try { if ((Engine.totalCheckins() || 0) < 3) return; } catch (e) { return; }
    const wd = new Date().getDay();
    if (wd !== 0 && wd !== 1) return;
    const key = UI.weekKey();
    if (st.settings.weekCardKey === key) return;
    Store.commit(function (s) { s.settings.weekCardKey = key; });
    setTimeout(function () { try { UI.openWeekCard(); } catch (e) { } }, 2000);
  }

  /* ---------------- 键盘与无障碍 ----------------
   * 目标：不碰鼠标也能把常用动作做完。
   *   · Tab 组内：← → Home End 切页（WAI-ARIA tabs 的标准做法）
   *   · 全局：1–8 直接跳页、/ 跳到日记搜索、Esc 关掉当前浮层
   * 只在「焦点不在输入框」时响应，避免打字被快捷键抢走。 */
  function isTyping(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
  }
  function tabList() { return Array.prototype.slice.call(document.querySelectorAll('.tabbar .tab')); }
  function overlayOpen() {
    const sh = document.getElementById('sheet');
    if (sh && sh.classList.contains('on')) return true;
    if (document.getElementById('cfMask')) return true;      // 确认框
    if (document.getElementById('badgePop')) return true;    // 徽章弹窗
    const vo = document.getElementById('voiceOverlay');
    if (vo && vo.classList.contains('on')) return true;
    return false;
  }

  function bindTabsKeyboard() {
    const bar = document.getElementById('tabbar');
    if (!bar) return;
    bar.addEventListener('keydown', function (e) {
      const list = tabList();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      let next = -1;
      if (e.key === 'ArrowRight') next = i < 0 ? 0 : (i + 1) % list.length;
      else if (e.key === 'ArrowLeft') next = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      else return;
      e.preventDefault();
      const t = list[next];
      flushDiary();
      UI.go(t.dataset.tab);
      // tabbar 是常驻节点（不在 #view 里），重绘不会把它换掉，焦点可以保留
      t.focus({ preventScroll: true });
    });
  }

  function bindGlobalKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 浮层打开时把按键让给浮层（抽屉自己的 Esc / 焦点陷阱在 ui.js 里）
      if (overlayOpen()) {
        if (e.key === 'Escape' && document.getElementById('badgePop')) {
          const bp = document.getElementById('badgePop');
          if (bp && bp.parentNode) bp.parentNode.removeChild(bp);
          e.preventDefault();
        }
        return;
      }
      if (isTyping(document.activeElement)) {
        // 输入框里只保留 Esc：退出输入，之后快捷键重新可用
        if (e.key === 'Escape') { document.activeElement.blur(); e.preventDefault(); }
        return;
      }
      const list = tabList();
      if (e.key >= '1' && e.key <= '8' && list.length) {
        const t = list[(+e.key) - 1];
        if (t) { e.preventDefault(); flushDiary(); UI.go(t.dataset.tab); t.focus({ preventScroll: true }); }
        return;
      }
      if (e.key === '/') {
        // 全站唯一的全文搜索在日记的「时间轴」视图里；先切过去，再聚焦
        e.preventDefault();
        flushDiary();
        if (UI.setDiaryView) UI.setDiaryView('timeline');
        UI.go('diary');
        const box = document.getElementById('dySearch');
        if (box) { box.focus(); if (box.select) box.select(); }
        return;
      }
      /* ---------- v20 · 桌面快捷键 ----------
       * 键位避开了已有的 1–8（跳页）/ /（搜索）/ Esc（关浮层）/ 方向键（Tab 组）。
       * c 不直接调 Engine：那样会漏掉打卡动效、撤销条、房间同步和徽章检查，
       * 所以找到真实按钮走 click，和手指点一下完全同一条路径。 */
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        const btn = document.querySelector('[data-act="tick"][aria-pressed="false"]');
        if (btn) btn.click();
        else toast('今天的待完成习惯已全部搞定 🎉');
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        if (ACT.togglegrid) ACT.togglegrid();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        UI.go('habits');
        if (UI.openHabit) UI.openHabit();
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        if (UI.openKeys) UI.openKeys();
        return;
      }
      if (e.key === 'Escape') {
        let closed = false;
        const ce = document.querySelector('.celeb');
        if (ce && ce.parentNode) { ce.parentNode.removeChild(ce); closed = true; }
        const ub = document.getElementById('undoBar');
        if (ub && ub.classList.contains('on')) { ub.classList.remove('on'); closed = true; }
        /* v54 · 「我的」二级页按 Esc 回一级页。有浮层开着时不抢 ——
         * 那时 Esc 的语义是「关掉这一层」，先关浮层才符合预期。 */
        const mask = document.getElementById('sheetMask');
        const sheetOn = !!(mask && mask.classList.contains('on'));
        if (!closed && !sheetOn && UI.tab === 'me' && UI.meSub) {
          UI.setMeSub('');
          closed = true;
        }
        if (closed) e.preventDefault();
      }
    });
  }

  function bind() {
    document.getElementById('view').addEventListener('click', onClick);
    document.getElementById('sheetBody').addEventListener('click', onClick);
    /* v53：顶部的状态条（离线提示 / 新版本已就绪）在 #view 之外，
     * 以前它的「关闭」「刷新」两个按钮根本点不动 —— 事件委托只挂在 #view 和
     * #sheetBody 上，点上去没人接。离线条的「关闭」用户点了没反应会以为坏了，
     * 更新条的「刷新」更是 P2-10 的整个出口，必须接上。 */
    const nbar = document.getElementById('netbar');
    if (nbar) nbar.addEventListener('click', onClick);
    /* 折叠块的开关状态要记住：<details> 的 toggle 事件不冒泡，只能在捕获阶段接。
     * 不接的话，用户刚收起的块会在下一次重绘时自己弹回来。 */
    document.addEventListener('toggle', e => {
      const dt = e.target;
      if (dt && dt.tagName === 'DETAILS' && dt.dataset.fold && window.Product) {
        Product.setFold(dt.dataset.fold, dt.open);
      }
    }, true);
    document.addEventListener('rigong:before-render', flushDiary);
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { flushDiary(); UI.go(t.dataset.tab); }));
    bindTabsKeyboard();
    bindGlobalKeys();
    const flushPage = () => { flushDiary(); Store.saveNow().catch(e => console.warn('保存失败', e)); };
    window.addEventListener('pagehide', flushPage);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushPage(); });
    $('sheetMask').addEventListener('click', () => { if (!UI.sheetReady || UI.sheetReady()) UI.closeSheet(); });
    /* 主题按钮只在「浅色 ↔ 深色」之间切换（走查第 1 条：三态循环在系统本身就是
     * 深色时，点第一下界面毫无变化，用户会以为按钮坏了）。
     * 「跟随系统」不收进循环，改成按钮的长按 / 右键 —— 想回去的人不必去设置里翻。 */
    $('btnTheme').addEventListener('click', () => {
      /* 长按已经改过主题了，别让紧随其后的那次 click 又切一遍 */
      if (Date.now() - themeFollowAt < 900) return;
      ACT.toggledark();
    });
    (function bindThemeFollow() {
      const el = $('btnTheme'); if (!el) return;
      let hold = 0;
      const follow = () => {
        if ((Store.s.settings.theme || 'system') === 'system') { toast('已经是在跟随系统了'); return; }
        themeFollowAt = Date.now();
        Store.commit(s => { s.settings.theme = 'system'; });
        applyTheme(); UI.render();
        toast('已恢复跟随系统');
      };
      el.addEventListener('contextmenu', e => { e.preventDefault(); follow(); });
      el.addEventListener('pointerdown', () => { clearTimeout(hold); hold = setTimeout(follow, 550); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(k =>
        el.addEventListener(k, () => clearTimeout(hold)));
    })();
    /* 提醒 / 云备份 已从顶栏移到「我的」，这里不再绑图标点击；
     * 保留空判断是为了兼容仍然开着旧页面的标签页。 */
    const nb = $('btnNotify'); if (nb) nb.addEventListener('click', () => ACT.notifypanel());
    const cb = $('btnCloud'); if (cb) cb.addEventListener('click', () => ACT.cloudpanel());
    /* 待办入口（走查第 5 条）：顶栏图标，一次点击可达；角标显示未完成数 */
    const tb = $('btnTodo'); if (tb) tb.addEventListener('click', () => { UI.go('todos'); });
    bindHabitGestures();
    $('btnVoice').addEventListener('click', startVoice);
    /* 「连续」芯片在概览卡里、会被重绘换掉，所以走 data-act 委托；
       再补 Enter/Space —— role=button 的元素必须能用键盘触发。 */
    /* role=button / role=switch 的元素必须能用键盘触发（无障碍底线）。
       以前只有「连续」芯片有单独一份，现在统一成通用规则。 */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const t = e.target;
      if (!t || !t.closest || isTyping(t)) return;
      const el = t.closest('[role="button"][tabindex],[role="switch"][tabindex]');
      if (!el) return;
      e.preventDefault();
      el.click();
    });
    $('voiceCancel').addEventListener('click', Feat.Voice.stop);
    $('fabPomodoro').addEventListener('click', () => UI.openPomo());
    /* 桌面端顶栏的番茄钟按钮（浮动球在宽屏隐藏） */
    const pt = $('btnPomoTop'); if (pt) pt.addEventListener('click', () => UI.openPomo());

    // 日记正文：边打边存（防抖 500ms）
    document.addEventListener('input', e => {
      const a = e.target.dataset && e.target.dataset.act;
      if (a === 'dytext') ACT.dytext(e.target);
      if (a === 'noteinput') {
        Store.commit(s => {
          const d = U.today();
          s.notes[d] = s.notes[d] || { text: '', photos: [], audios: [] };
          s.notes[d].text = e.target.value;
          s.notes[d].updatedAt = Date.now();
        });
      }
    });

    // 今日笔记：失焦自动保存
    document.addEventListener('change', e => {
      const a = e.target.dataset && e.target.dataset.act;
      if (a === 'setnightat') { ACT.setnightat(e.target); return; }
      if (a === 'setnudgeat') { ACT.setnudgeat(e.target); return; }
      if (a === 'setdiaryat') { ACT.setdiaryat(e.target); return; }
      if (a === 'dytext') {
        ACT.dytext(e.target);
        flushDiary();
        // 写完失焦：给一个「已保存」的回执，别让人怀疑没存上
        if ((e.target.value || '').trim()) UI.savedTip('日记已保存');
        return;
      }
      if (a === 'hooktype') {
        const def = Plugins.hookDef(e.target.value);
        const hint = $('hkHint'); if (hint) hint.textContent = def.hint || def.tpl;
        const url = $('hkUrl'); if (url && !url.value) url.placeholder = def.tpl;
        return;
      }
      if (a === 'noteinput') {
        Store.commit(s => {
          const d = U.today();
          s.notes[d] = s.notes[d] || { text: '', photos: [], audios: [] };
          s.notes[d].text = e.target.value;
        });
        if ((e.target.value || '').trim()) UI.savedTip('已保存');
      }
    });
  }

  /* ---------- 启动 ---------- */
  /* 隐私锁的闸门：可重复调用，已经盖着就不再盖。 */
  function maybeGateLock() {
    if (!window.Lock) return;
    try {
      if (!Lock.enabled() || Lock.scope() !== 'all') return;
      if (document.getElementById('lockMask')) return;
      Lock.watchIdle();
      Lock.gate(function () { try { UI.render(); } catch (e) { } });
    } catch (e) { }
  }
  /* 只在「全新用户」时才引导：已经有打卡记录 / 自己加过习惯的人直接跳过 */
  function maybeOnboard() {
    const st = Store.s;
    if (!st || st.settings.onboarded) return;
    const used = Object.keys(st.logs || {}).length > 0 ||
      Object.keys(st.notes || {}).length > 0 ||
      (st.items || []).length > 0;
    if (used) { Store.commit(s => { s.settings.onboarded = 1; }); return; }
    if (window.UI) UI.openOnboard();
  }

  /* ---------- 健康数据自动勾选（v47 · 对标 Habitify 的 Apple Health 自动完成）----------
   * 规则挂在习惯上（item.autoHealth = {key, thr}），数值来自「我的 → 健康数据导入」。
   * 每次打开、每次跨零点各跑一次：达标就把当天勾上，用户不用再点那一下。
   * 不弹窗、不 toast 报喜 —— 自动完成是安静的好事，一响就像在讨表扬。 */
  function runHealthAuto() {
    const empty = { ticks: [], checked: 0, noData: 0 };
    if (!window.Health || !Store.s || !Store.s.items) return empty;
    try {
      if (!Health.autoList().length) return empty;
      const r = Health.autoTick({ days: 2 }) || empty;
      if (r.ticks && r.ticks.length) {
        try { Store.commit(); } catch (e) { }
        try { UI.render(); } catch (e) { }
      }
      return r;
    } catch (e) { console.warn('[HealthAuto]', e); return empty; }
  }
  function autoTipOf(at) {
    const n = (at && at.ticks) ? at.ticks.length : 0;
    if (!n) return '';
    return '；顺带自动勾选了 ' + n + ' 条（' + at.ticks.slice(0, 2).map(t => t.name).join('、') + (n > 2 ? ' 等' : '') + '）';
  }

  /* ---------- 跨零点 ----------
   * 习惯 App 最容易被忽略的一个坑：页面一直开着（或手机从后台恢复），
   * 过了午夜日期变了，界面却还停在昨天 —— 用户对着昨天的面板点一下，
   * 记录就记到昨天去了。这里盯住日期变化，变了就整体刷新。 */
  function watchDayChange() {
    let cur = U.today();
    function onNewDay() {
      try { if (window.Insights && Insights.bust) Insights.bust(); } catch (e) { }
      try { if (window.Extra && Extra.reconcile) Extra.reconcile(); } catch (e) { }
      try { if (window.Safety) Safety.daily(); } catch (e) { }   // 新的一天再存一份开盘快照
      /* 新的一天：昨天导进来的数据可能刚好够勾昨天那条，顺手补判一次 */
      try { runHealthAuto(); } catch (e) { }
      try { UI.render(); } catch (e) { showRescue(e); }
      try { Feat.Pomo.paint(); } catch (e) { }
      toast('新的一天开始了 🌅');
    }
    function check() {
      markAlive();
      const now = U.today();
      if (now === cur) return;
      cur = now;
      onNewDay();
    }
    setInterval(check, 30000);
    // 手机从后台切回前台是最常见的触发时机，单独再查一次
    if (document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        markAlive();
        if (document.visibilityState === 'visible') check();
      });
    }
  }

  /* ---------- 待挺久了提醒（v60 · 对标抖音唯一「反着学」的一条）----------
   * 抖音的设计目标是让你停不下来；打卡应用的目标是用完就走。
   * 用户在这一个工具上连续停留很久，本身就是个信号：今天该做的可能还没做。
   * 于是借抖音自己的「时间提醒」设计反打一次 —— 每次冷启动最多提醒一次，
   * 今天全部做完就永不提示（都做完了，多待会儿也没关系，不需要被打断）。 */
  function watchSession() {
    let activeMs = 0, lastTick = Date.now(), nudged = false;
    function tick() {
      if (document.visibilityState === 'visible') activeMs += Date.now() - lastTick;
      lastTick = Date.now();
      if (nudged) return;
      const min = (Store.s && Store.s.settings && Store.s.settings.sessNudgeMin);
      const limit = (min == null ? 8 : +min) * 60000;
      if (activeMs < limit) return;
      nudged = true;
      try {
        const r = Engine.todayRate(U.today());
        if (!(r.total > 0) || r.pct >= 100) return;   // 都做完了：多待会儿没关系，不打扰
        toast('在这待挺久了 —— 该做的还等着呢，去吧 💪', 6000);
        if (window.UX) UX.sfx('tap');
      } catch (e) { }
    }
    setInterval(tick, 15000);
    if (document.addEventListener) {
      document.addEventListener('visibilitychange', () => { lastTick = Date.now(); });
    }
  }

  /* 新版本已就绪：顶部一条绿色提示，点「刷新」才开始用新版。
   * 不自动刷新——用户正在写日记时被打断比用旧版更糟。 */
  function showUpdateBar() {
    const b = $('netbar');
    if (!b) return;
    b.className = 'netbar on ok';
    b.innerHTML = '<span>新版本已就绪</span>' +
      '<button class="nb-x" data-act="swupdate">刷新</button>' +
      '<button class="nb-x" data-act="netclose">稍后</button>';
  }

  /* ---------- 离线状态条 ----------
   * 断网时不说清楚，用户会以为打卡没记上，然后反复点、反复刷新。
   * 明确告诉他"已存本地、联网自动同步"，他就安心了。 */
  function watchNetwork() {
    if (!window.Safety) return;
    const bar = $('netbar');
    if (!bar) return;
    function paint(online, justBack) {
      if (!online) {
        bar.className = 'netbar on';
        bar.innerHTML = '<span>离线中 · 打卡照常记录，联网后自动同步</span>';
      } else if (justBack) {
        bar.className = 'netbar on ok';
        bar.innerHTML = '<span>✅ 已恢复联网' +
          (window.Cloud && Cloud.signedIn() ? ' · 正在同步' : '') + '</span>' +
          '<button class="nb-x" data-act="netclose">关闭</button>';
        setTimeout(() => { bar.className = 'netbar'; }, 2600);
      } else {
        bar.className = 'netbar';
      }
    }
    paint(Safety.online(), false);
    Safety.watch(function (online) { paint(online, online); });
  }

  /* ---------- 回归模式（v28 · 4.3）----------
   * 离开 3 天以上再回来，首页换成一页「重启」。判断必须用上次打开日，
   * 不能用「上次打卡日」—— 有人天天打开但只看不打卡，那不该被当成流失。
   * 只出现一次：记下 restartFor=今天，同一天再开就是正常首页。 */
  let _restartChecked = false;
  function maybeRestart() {
    if (_restartChecked) return;
    _restartChecked = true;
    const st = Store.s;
    if (!st || !st.settings) return;
    const today = U.today();
    const last = st.settings.lastOpenDay || '';
    const gap = last ? U.daysBetween(last, today) : 0;
    const hasHabits = (Engine.items() || []).length > 0;
    if (last && gap >= 3 && hasHabits && st.settings.restartFor !== today) {
      Store.commit(s => {
        s.settings.restartFor = today;
        /* 送一张保护券：回来的人最需要的是「今天漏了也不会立刻归零」的底气 */
        s.settings.freezeLeft = Math.min(2, (s.settings.freezeLeft == null ? 1 : s.settings.freezeLeft) + 1);
      });
      UI.setRestart({ days: gap });
    }
    Store.commit(s => { s.settings.lastOpenDay = today; });
  }

  function boot() {
    // 1) 同步初始化，先把界面画出来（弱网 / 隐私模式下 IndexedDB 可能很慢）
    Store.initSync();
    applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((Store.s.settings.theme || 'system') === 'system') applyTheme();
    });
    bind();
    UI.render();
    Feat.Pomo.paint();
    watchSession();
    /* 隐私锁（v46 · 对标 Habitify Privacy Lock）：先画完首帧再盖遮罩 ——
     * 一进来就是一片白再弹锁，会让人以为应用坏了。
     * 注意它必须在 boot 同步段和 onStoreReady 里各判一次：initSync 读的是
     * localStorage 快照，真正的 settings 要等 IndexedDB 回来才齐全 ——
     * 只在同步段判一次，会出现「刷新后锁没生效」这种最要命的问题。 */
    maybeGateLock();
    // 下拉刷新 + 励志语录
    if (window.UX) UX.initPullRefresh();

    // 2) IndexedDB 就绪后，用真实数据再画一次
    //    这里不能用 Promise.race([init, timeout])：IDB 慢于 2 秒时超时先赢，
    //    race 只结算一次，等 init 真正完成已经没有回调了 —— 页面会永远停在
    //    initSync 的旧数据上（打卡数显示 0、习惯列表为空）。
    //    正确做法：兜底定时器保证不白屏 + init.then 无论快慢都必再渲染。
    let startedRemind = false;
    function startRemind() {
      if (startedRemind) return;
      startedRemind = true;
      if (window.Remind) {
        Remind.start();
        // 从通知「去打卡」回到已打开的页面时，SW 会 postMessage 过来
        if (navigator.serviceWorker) {
          navigator.serviceWorker.addEventListener('message', e => {
            const d = e.data || {};
            if (d.type === 'remind-click') Remind.handleClick(d.url);
            /* 通知上点了「稍后提醒」：延后 N 分钟，并给一句回执 */
            if (d.type === 'remind-snooze') {
              const at = Remind.snooze(d.id, d.min);
              const it = (Store.s.items || []).find(x => x.id === d.id);
              if (at) toast('已推迟' + (d.min || 30) + ' 分钟' + (it ? '：' + it.name : ''));
            }
          });
        }
        // 直接用带 ?check=id 的链接打开（冷启动）
        const m = /[?&]check=([^&]+)/.exec(location.search);
        if (m) Remind.handleClick(location.search);
      } else if (window.Feat) Feat.Notify.startLoop();
    }
    /* v54 · P2-8 拆包后：chunk 是 async 加载的，启动那一刻可能还没到。
     * onStoreReady 里这几件事都带 `if (window.Xxx)` 守卫 —— 模块不在就静默跳过，
     * 用户看不到报错，但功能会悄悄少一块（搭子退出没补发、健康数据没自动勾选、
     * 升级没提示）。所以 chunk 到齐后再补跑一次。
     * 三件事都是幂等的：搭子只补「该删没删掉」的、健康只补空缺、升级只报新档。 */
    let storeIsReady = false;
    let bootedBuddy = false, bootedHealth = false, bootedLevel = false;
    function runDeferredBoot() {
      if (!storeIsReady) return;
      if (!bootedBuddy && window.Buddy) {
        bootedBuddy = true;
        try { Buddy.flushLeave(); Buddy.pull(true); } catch (e) { console.warn('[Buddy]', e); }
      }
      if (!bootedHealth && window.Health) {
        bootedHealth = true;
        try { runHealthAuto(); } catch (e) { console.warn('[Health]', e); }
      }
      if (!bootedLevel && window.Level) {
        bootedLevel = true;
        try { checkLevelUp(); } catch (e) { }
      }
    }
    /* 每个 chunk 执行完会 dispatch 一次，谁到算谁的 */
    window.addEventListener('rgz:chunk', runDeferredBoot);

    function onStoreReady() {
      storeIsReady = true;
      /* v52 · 报告 P0-1：骨架屏跟着数据撤，不再死等 index.html 里那个 2600ms 兜底。
       * 两个方向都修：数据来得快 → 立刻撤（以前白遮 2.5 秒）；
       * 数据来得慢 → 撤掉时露出的已经是「正在读…」而不是空态（见 UI.loadingGuide）。
       * 幂等：IDB 完成和兜底超时都可能走到这里。 */
      try {
        const sk = document.getElementById('skel');
        if (sk && sk.parentNode && !sk._gone) {
          sk._gone = true;
          sk.classList.add('out');
          setTimeout(function () { if (sk.parentNode) sk.parentNode.removeChild(sk); }, 200);
        }
      } catch (e) { }
      /* 隐私锁：IndexedDB 回来后才看得到真正的 settings（见 maybeGateLock 注释） */
      maybeGateLock();
      /* 保护券结算必须放在这里，不能放在 boot() 的同步段里。
       * boot() 同步跑的时候 Store.init() 还没回来，此时 mutate 的是 initSync
       * 造出来的那个 state 对象；等 IndexedDB 读完了，Store.init() 会
       * `Object.assign(defaultState(), loaded)` 整体换一个新对象 ——
       * 刚才写进去的 freezes[y]=1、freezeLeft-- 跟着旧对象一起被丢掉，
       * 而 toast 已经说出去了。表现为「提示说保住了，首页却显示连续 0 天」。
       * 放到这里，改的就是最终生效的那一份。 */
      try {
        const fz = Extra.reconcile();
        if (fz.used) setTimeout(() => toast('昨天有漏打卡，已自动用掉 1 张保护券，连续记录保住了 🧊'), 1200);
      } catch (e) { console.warn('[Extra]', e); }
      maybeRestart();
      /* 里程碑（走查第 6 条）：老用户升上来时，已经跨过的连击档不该再弹庆祝，
       * 但「连击里程碑」这一栏要如实反映「你到过哪」—— 否则墙上是空的、和真记录对不上。
       * 首次进入（celebrated 还没建）按当前全站连击把已跨过的档一次性记上，
       * 之后只等新档；新用户（连击 0）记上空数组，照常逐档庆祝。 */
      try {
        if (Store.s.settings.celebrated === undefined) {
          const g = Engine.globalStreak();
          Store.commit(s => { s.settings.celebrated = CELEBRATE_DAYS.filter(d => d <= g); });
        }
      } catch (e) { console.warn('[milestone seed]', e); }
      /* 计时器对账（v31 · 4.6）：昨天的旧会话把已计时间记到昨天；
       * 今天的会话接着跑，到点自动打卡。和保护券结算同理，
       * 必须放在 store ready 之后 —— boot() 同步段的写入会被 Store.init() 换掉。 */
      try { if (window.Timer) Timer.bootCheck(); } catch (e) { console.warn('[Timer]', e); }
      /* 搭子（v32 · 4.7）：先把「该删没删掉」的退出请求补上，再同步一次。
       * 同样要等 store ready —— 不然写入会被 Store.init() 换掉。 */
      try { if (window.Buddy) { Buddy.flushLeave(); Buddy.pull(true); } } catch (e) { console.warn('[Buddy]', e); }
      /* 健康数据自动勾选（v47）：必须等真实数据到位再跑 —— 同步段还没有 health 缓存 */
      runHealthAuto();
      try { applyTheme(); UI.render(); } catch (e) { console.error('[boot] render', e); showRescue(e); }
      startRemind();
      // 徽章与升级：延迟 300ms + 空闲回调，天然晚于 Store.init()，放这里一样安全
      checkBadges();
      // 必须等真实数据到位再判断，否则会拿 initSync 的空状态误伤老用户
      maybeOnboard();
      // 提醒兜底：网页当时没开 → 这次打开把漏掉的那几次列出来
      markAlive();
      maybeMissedReminder();
      maybeWeekCard();
      // 每天首次进入存一份"当天开盘"快照，之后误删 / 导入错误都能滚回来
      // v41：先 init 把快照从 localStorage 搬进 IndexedDB，再决定要不要存今天的
      try {
        if (window.Safety) {
          (Safety.init ? Safety.init() : Promise.resolve()).then(function () {
            try { Safety.daily(); } catch (e) { }
          }).catch(function () { try { Safety.daily(); } catch (e) { } });
        }
      } catch (e) { }
      watchNetwork();
      watchDayChange();
      // 等真实数据到位再处理快捷菜单参数（quickadd 要能找到"第一个没完成的习惯"）
      runShortcuts();
      // 外部命令（快捷指令 / n8n / 浏览器书签）：?cmd=1&do=tick&name=喝水
      // 必须放在 store ready 之后 —— 否则数据还没读出来，命令会打空
      runUrlCommand();
      /* WebDAV 自建网盘备份（4.6）：一天一份，开机时补上。
       * 延迟几秒再跑 —— 首屏要的是"立刻能打卡"，备份是后台事。
       * 冲突不自动二选一：只 toast 提示，让用户去「连接」页处理。 */
      if (window.WebDAV && WebDAV.has()) {
        setTimeout(function () {
          WebDAV.autoTick({ toast: false }).then(function (r) {
            if (r && r.conflict) toast('网盘上有另一台设备的新备份，去「连接」页选保留哪一份');
          }).catch(function () { });
        }, 4000);
      }
      /* v54 · 上面那些 `if (window.Xxx)` 有可能因为 chunk 还没到而跳过，这里补一次 */
      runDeferredBoot();
      /* v54 · P2-8：首屏跑完、空闲时再拉按需 chunk。
       * 不能用 <script async> 提前并行 —— 实测限速下小脚本会跟 core 抢带宽，
       * 首屏反而慢 488ms（见 tools/bundle.cjs 的注释）。渲染完再注入，
       * core 独占带宽先把页面亮出来，chunk 晚 1–2 秒到，不挡任何人的路。 */
      const loadChunks = function () {
        if (!window.__RGZ_SPLIT__) return;
        ['diary', 'grow', 'social', 'plus'].forEach(function (k) {
          if (window.__rgzChunk && window.__rgzChunk[k]) return;
          const s = document.createElement('script');
          s.src = 'src/chunk-' + k + '.js?v=' + U.VERSION;
          s.async = true;
          document.head.appendChild(s);
        });
      };
      if (window.requestIdleCallback) requestIdleCallback(loadChunks, { timeout: 4000 });
      else setTimeout(loadChunks, 1500);
    }
    let idbFallback = setTimeout(function () {
      // IDB 还没好也先把界面画出来，别让用户对着空白发呆
      console.warn('[boot] IndexedDB 超时，先用本地缓存渲染');
      onStoreReady();
    }, 2000);
    const storeReady = Store.init().then(function () {
      clearTimeout(idbFallback);
      onStoreReady();
    }, function (e) {
      clearTimeout(idbFallback);
      console.warn('存储初始化失败', e);
      onStoreReady();          // 失败了也要渲染，不能卡在空页面
    });
    // 直达某个页面：#rooms / #grow / #habits / #connect / #me
    const tabs = ['today', 'todos', 'diary', 'habits', 'rooms', 'grow', 'connect', 'me'];
    const h = location.hash.replace(/^#/, '').split('&')[0];
    if (tabs.indexOf(h) >= 0) UI.go(h);
    // PWA 快捷菜单：?go=grow 这类直达（擦参数在 runShortcuts 里做）
    const goParam = new URLSearchParams(location.search).get('go');
    if (goParam && tabs.indexOf(goParam) >= 0) UI.go(goParam);

    // 外部命令（快捷指令 / n8n / 浏览器书签）：?cmd=1&do=tick&name=喝水
    // 注意：真正执行在 onStoreReady 里，这里不能跑（数据还没到位）

    // PWA：拿到安装事件就留在手里，等用户在今日页点「安装」再用
    // （直接弹会打断操作，Chrome 也不允许不经用户手势触发）
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      window.__pwaPrompt = e;
      try { UI.render(); } catch (err) { }
    });
    window.addEventListener('appinstalled', () => {
      window.__pwaPrompt = null;
      Store.commit(s => { s.settings.pwaInstalled = 1; });
      try { UI.render(); } catch (err) { }
      toast('已添加到桌面 🎉');
    });

    // 云端：连接 + 登录后自动同步
    if (window.Cloud) {
      let cloudIdentity = null;
      let remoteRenderPending = false;
      const paintRemote = () => {
        if (document.activeElement && document.activeElement.matches('input,textarea,[contenteditable="true"]')) {
          remoteRenderPending = true; return;
        }
        remoteRenderPending = false;
        try { UI.render(); } catch (e) { }
      };
      document.addEventListener('rigong:before-sync', flushDiary);
      document.addEventListener('rigong:cloud-merged', paintRemote);
      document.addEventListener('focusout', () => { if (remoteRenderPending) setTimeout(paintRemote, 0); });
      Cloud.onChange(() => {
        const identity = Cloud.uid() + ':' + Cloud.backendState().state;
        if (cloudIdentity !== identity) {
          cloudIdentity = identity;
          try { UI.render(); } catch (e) { }
          if (Cloud.signedIn() && window.Rooms) Rooms.migrate().then(n => { if (n) pushRoom(true); }).catch(() => { });
        }
        const status = document.getElementById('cloudSyncStatus');
        if (status) status.textContent = Cloud.status.msg || '尚未完成同步';
        if (window.Product && Store.s) Product.refresh();
        // 登录后把匿名房间记录迁到账号下
      });
      /* 云端：连接 + 登录后自动同步。
       * vendor/cloud-sdk.js 有 62KB，和「今天要做什么」毫无关系，所以启动时不再拉它：
       *  - 本机留过 cloudAccountId（登录过）→ 空闲时后台连上，恢复自动同步；
       *  - 从没登录过 → 等用户自己点「云同步」或「登录」时再连。
       * 后台那个端点至今没开通，开机就探活只是让首屏多等一个必然失败的请求。 */
      storeReady.then(async () => {
        const everSignedIn = !!(Store.s.settings && Store.s.settings.cloudAccountId);
        if (!everSignedIn) return;
        const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
        await new Promise(r => idle(r));
        try { await Cloud.boot(); } catch (e) { return; }
        if (!Cloud.signedIn() || Store.s.settings.autoSync === false) return;
        try {
          const r = await Cloud.syncNow();
          UI.render();
          if (r.pulled) toast('已从云端合并 ' + r.pulled + ' 项数据');
        } catch (e) { console.warn('云同步失败', e); }
      }).catch(e => console.warn('云端初始化失败', e));
    }

    // 房间邀请链接：#room=ABC123
    const m = location.hash.match(/room=([^&]+)/);
    if (m && window.Rooms) {
      const code = String(m[1] || '').toUpperCase();
      if (Rooms.findRoom(code)) { Rooms.setActive(code); UI.go('rooms'); }
      else if (Rooms.profile().nickname) { UI.openRoomJoin(); $('rjCode').value = code; }
      else { pendingRoomCode = code; UI.openRoomProfile(); toast('设置昵称后确认加入房间 ' + code); }
    }

    // 搭子邀请链接：#buddy=ABC234（处理完就把 hash 清掉，刷新不会重复弹）
    const bm = location.hash.match(/buddy=([A-Za-z0-9]{4,12})/);
    if (bm && window.Buddy) {
      const bcode = String(bm[1] || '').toUpperCase();
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { }
      if (Buddy.has()) toast('你已经有搭子了，先退出再加入新的');
      else UI.openBuddyJoin(bcode);
    }

    // 已加入房间：进入时刷新房间信息 + 上报成绩
    if (window.Rooms && Rooms.myRooms().length) {
      Rooms.refreshInfo().then(() => { if (UI.tab === 'rooms') UI.render(); }).catch(() => { });
      setTimeout(() => pushRoom(true), 1200);
    }
    /* Service Worker：后台装好新版后提示一下，否则用户会一直用着旧版还以为没更新。
     * v53 · 报告 P2-10：sw.js 不再自己 skipWaiting，装好的新版会停在 waiting 等页面
     * 发 SKIP_WAITING。所以这里除了监听 updatefound，还要在注册时检查一次
     * reg.waiting —— 上次弹过提示但用户点了「稍后」的，这次打开还得告诉他。 */
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
        if (!reg) return;
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar();
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar();
          });
        });
      }).catch(() => { });
    }
    // 静默申请持久化保护，防浏览器自动清理数据
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { }); } catch (e) { }
    // 调试：?debug 把布局宽度写进标题
    if (location.search.indexOf('debug') >= 0) {
      setTimeout(() => {
        let wide = [];
        document.querySelectorAll('body *').forEach(el => {
          if (el.scrollWidth > 320 && wide.length < 8) {
            wide.push((el.id || el.className || el.tagName) + '=' + el.scrollWidth);
          }
        });
        document.title = 'W:' + innerWidth + ' sw:' + document.documentElement.scrollWidth + ' | ' + wide.join(',');
      }, 3000);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
