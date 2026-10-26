/* ============ 交互细节层 ============
 * 1) 打卡按压音效（可开关，WebAudio 合成，不需要音频文件）
 * 2) 二次确认弹窗（删除等危险操作统一走这里）
 * 3) 防重复点击 / loading 状态
 * 4) 首页下拉刷新 + 励志语录
 * 5) 输入框字数限制与实时计数
 */
window.UX = (function () {

  /* ---------------- 1. 音效 ---------------- */
  let actx = null;
  function ac() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      if (!actx) actx = new C();
      if (actx.state === 'suspended' && actx.resume) actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function soundOn() {
    try { return !(window.Store && Store.s && Store.s.settings && Store.s.settings.sound === false); }
    catch (e) { return true; }
  }
  /* 单音：f0 -> f1 的短促滑动，带音量包络 */
  function tone(f0, f1, dur, vol, type) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function sfx(kind) {
    if (!soundOn()) return;
    try {
      if (kind === 'on') { tone(660, 990, 0.13, 0.17); tone(1320, 1320, 0.05, 0.05, 'triangle'); }
      else if (kind === 'off') { tone(520, 330, 0.12, 0.12); }
      else if (kind === 'all') {
        tone(523, 523, 0.12, 0.15, 'triangle');
        setTimeout(() => tone(659, 659, 0.12, 0.15, 'triangle'), 90);
        setTimeout(() => tone(784, 988, 0.26, 0.17, 'triangle'), 185);
      } else if (kind === 'tap') { tone(880, 880, 0.05, 0.07, 'triangle'); }
      else if (kind === 'refresh') { tone(700, 1180, 0.14, 0.12, 'triangle'); }
      else if (kind === 'err') { tone(300, 200, 0.18, 0.13, 'sawtooth'); }
    } catch (e) { }
  }

  /* 确认框图标：调用方传符号名（如 'warning-circle'）就走 sprite；
     传 HTML 或单个字符则原样输出，保持向后兼容 */
  function cfIcon(name, danger) {
    const n = name || (danger ? 'trash' : 'warning-circle');
    if (/^[a-z][a-z0-9-]*$/.test(n)) {
      return '<svg class="p-icon" aria-hidden="true"><use href="assets/icons.svg#' + n + '"></use></svg>';
    }
    return n;
  }

  /* ---------------- 2. 二次确认 ---------------- */
  function confirmBox(opt) {
    opt = opt || {};
    return new Promise(resolve => {
      const old = document.getElementById('cfMask');
      if (old) old.remove();
      const mask = document.createElement('div');
      mask.id = 'cfMask';
      mask.className = 'cf-mask';
      mask.innerHTML =
        '<div class="cf">' +
        '<div class="cf-ico">' + cfIcon(opt.icon, opt.danger) + '</div>' +
        '<div class="cf-t">' + U.esc(opt.title || '确认操作') + '</div>' +
        '<div class="cf-m">' + (opt.html || U.esc(opt.msg || '')) + '</div>' +
        '<div class="cf-row">' +
        '<button class="cf-btn ghost" data-cf="0">' + U.esc(opt.cancel || '取消') + '</button>' +
        '<button class="cf-btn' + (opt.danger ? ' danger' : '') + '" data-cf="1">' + U.esc(opt.ok || '确定') + '</button>' +
        '</div></div>';
      document.body.appendChild(mask);
      requestAnimationFrame(() => mask.classList.add('on'));
      function close(v) {
        mask.classList.remove('on');
        setTimeout(() => mask.remove(), 220);
        resolve(!!v);
      }
      mask.addEventListener('click', e => {
        const b = e.target.closest('[data-cf]');
        if (b) { sfx(b.dataset.cf === '1' ? 'tap' : 'off'); close(b.dataset.cf === '1'); return; }
        if (e.target === mask) close(false);
      });
    });
  }
  /* 单按钮提示 */
  function alertBox(title, msg) {
    return confirmBox({ icon: '🔔', title: title, html: msg, ok: '知道了', cancel: '关闭', danger: false });
  }
  /* 带输入框的弹窗：替代原生 prompt（原生那个在 PWA 独立窗口里样式很丑，iOS 上还会被拦）
   * resolve(null) = 取消，resolve(字符串) = 确定。 */
  function promptBox(opt) {
    opt = opt || {};
    return new Promise(resolve => {
      const old = document.getElementById('cfMask');
      if (old) old.remove();
      const mask = document.createElement('div');
      mask.id = 'cfMask';
      mask.className = 'cf-mask';
      mask.innerHTML =
        '<div class="cf">' +
        '<div class="cf-ico">' + (opt.icon ? cfIcon(opt.icon) : '✏️') + '</div>' +
        '<div class="cf-t">' + U.esc(opt.title || '输入') + '</div>' +
        (opt.msg ? '<div class="cf-m">' + U.esc(opt.msg) + '</div>' : '') +
        '<input class="cf-input" id="cfInput" type="' + (opt.type || 'text') + '" ' +
        'inputmode="' + (opt.inputmode || (opt.type === 'number' ? 'decimal' : 'text')) + '" ' +
        'value="' + U.esc(opt.value == null ? '' : opt.value) + '" ' +
        'placeholder="' + U.esc(opt.placeholder || '') + '">' +
        '<div class="cf-row">' +
        '<button class="cf-btn ghost" data-cf="0">' + U.esc(opt.cancel || '取消') + '</button>' +
        '<button class="cf-btn" data-cf="1">' + U.esc(opt.ok || '确定') + '</button>' +
        '</div></div>';
      document.body.appendChild(mask);
      requestAnimationFrame(() => mask.classList.add('on'));
      const inp = document.getElementById('cfInput');
      if (inp) setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) { } }, 60);
      function close(v) {
        mask.classList.remove('on');
        setTimeout(() => mask.remove(), 220);
        resolve(v);
      }
      function ok() {
        const v = inp ? inp.value : '';
        if (opt.required !== false && !String(v).trim()) {
          try { inp.focus(); } catch (e) { }
          return;
        }
        sfx('tap'); close(String(v).trim());
      }
      mask.addEventListener('click', e => {
        const b = e.target.closest('[data-cf]');
        if (b) { if (b.dataset.cf === '1') ok(); else { sfx('off'); close(null); } return; }
      });
      if (inp) inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); ok(); }
        if (e.key === 'Escape') close(null);
      });
    });
  }
  /* 删除类确认：统一文案 */
  function confirmDelete(what, extra) {
    return confirmBox({
      icon: '🗑️', danger: true,
      title: '确定删除「' + what + '」？',
      html: '<b style="color:var(--danger)">删除后数据不可恢复。</b>' +
        (extra ? '<div class="cf-sub">' + U.esc(extra) + '</div>' : ''),
      ok: '删除', cancel: '再想想'
    });
  }

  /* ---------------- 3. 防重复点击 / loading ---------------- */
  /* 这些动作是"开关 / 切换"，不需要 loading，也不该被锁 */
  /* plus/minus 是"累加器"：手速快时每一都必须生效，绝不能被 260ms 锁吞掉
   *（用户实测连点 28 下只生效 3 下，就是这个锁 + 节点被换掉造成的） */
  const NO_BUSY = {
    mood: 1, theme: 1, toggledark: 1, toggleslot: 1, toggleremind: 1,
    plus: 1, minus: 1, setval: 1, step: 1,
    noteinput: 1, moodx: 1, calprev: 1, calnext: 1, hkevent: 1, rcemo: 1, rcpublic: 1,
    copyurl: 1, copylink: 1, copycode: 1, roomcopycode: 1, roomcopylink: 1,
    copyreview: 1, copyreview30: 1, copystatus: 1, roomemo: 1, switchroom: 1
  };
  function busy(el, fn) {
    if (!el) return fn && fn(el);
    if (el.dataset.busy === '1') return;          // 连点直接忽略
    if (NO_BUSY[el.dataset.act]) return fn(el);
    el.dataset.busy = '1';
    el.classList.add('busy');
    let finished = false;
    function done() {
      if (finished) return;
      finished = true;
      try {
        el.classList.remove('busy');
        delete el.dataset.busy;
        if (el.tagName === 'BUTTON') el.disabled = false;
      } catch (e) { }
    }
    try {
      const r = fn(el);
      if (r && typeof r.then === 'function') {
        if (el.tagName === 'BUTTON') el.disabled = true;
        r.then(done, done);
      } else {
        // 同步动作：短暂锁定，防止手抖连点产生重复记录
        setTimeout(done, 260);
      }
    } catch (e) {
      done();
      console.error('[UX]', e);
      U.toast('操作失败：' + (e && e.message ? e.message : e));
    }
  }

  /* ---------------- 4. 励志语录 ---------------- */
  const QUOTES = [
    ['日拱一卒无有尽，功不唐捐终入海。', '《法句经》'],
    ['种一棵树最好的时间是十年前，其次是现在。', ''],
    ['不积跬步，无以至千里；不积小流，无以成江海。', '荀子'],
    ['今天不想跑，所以才去跑，这才是长距离跑者的思维方式。', '村上春树'],
    ['所谓天才，不过是把别人喝咖啡的功夫都用在工作上了。', '鲁迅'],
    ['我们重复做的事造就了我们。卓越不是行为，而是习惯。', '亚里士多德'],
    ['想放弃的时候，把目标降到原来的十分之一，先做完这一档。', ''],
    ['把目标切成最小的一步，然后今天只做这一步。', ''],
    ['慢一点没关系，只要别停。', ''],
    ['你不需要很厉害才能开始，但需要开始才能很厉害。', ''],
    ['自律不是苦行，是把选择权拿回自己手里。', ''],
    ['每天进步 1%，一年后是原来的 37 倍。', ''],
    ['行动可能不总带来幸福，但没有行动就根本没有幸福。', '迪斯雷利'],
    ['与其抱怨黑暗，不如提灯前行。', ''],
    ['伟大的作品不是靠力量完成的，而是靠坚持。', '塞缪尔·约翰逊'],
    ['一旦你承诺了自己，就要说到做到。', ''],
    ['今天流的汗，会变成明天的底气。', ''],
    ['没有人能替你坚持，也没有人能替你放弃。', ''],
    ['习惯是第二天性，它会替你完成意志力做不到的事。', ''],
    ['路虽远，行则将至；事虽难，做则必成。', '《荀子》'],
    ['把今天过好，明天自然会好。', ''],
    ['微小的改变，乘以时间，就是复利。', ''],
    ['别急着看结果，先把过程做对。', ''],
    ['你已经比昨天的自己多走了一步。', '']
  ];
  let qi = Math.floor(Math.random() * QUOTES.length);
  function quote() { return QUOTES[qi % QUOTES.length]; }
  function nextQuote() {
    let n = qi;
    if (QUOTES.length > 1) { while (n === qi) n = Math.floor(Math.random() * QUOTES.length); }
    qi = n;
    return quote();
  }
  /* 顶栏下方的一句鸡汤，带手动换一句 */
  function quoteHTML() {
    const q = quote();
    return '<div class="quote" id="quoteCard">' +
      '<span class="q-mark">❝</span>' +
      '<div class="q-body"><div class="q-t">' + U.esc(q[0]) + '</div>' +
      (q[1] ? '<div class="q-a">— ' + U.esc(q[1]) + '</div>' : '') + '</div>' +
      '<button class="q-btn" data-act="newquote" title="换一句" aria-label="换一句"><svg class="p-icon" aria-hidden="true"><use href="assets/icons.svg#refresh"></use></svg></button></div>';
  }
  /* 首页减负版：名言从一张卡片压成底部一行小字，点一下换一句 */
  function quoteLine() {
    const q = quote();
    return '<div class="q-line" id="quoteLine" data-act="newquote" role="button" tabindex="0" aria-label="换一句每日名言">' +
      '<span class="ql-t">' + U.esc(q[0]) + '</span>' +
      (q[1] ? '<span class="ql-a">— ' + U.esc(q[1]) + '</span>' : '') +
      '<span class="ql-b">↻</span></div>';
  }
  function repaintQuoteLine() {
    const c = document.getElementById('quoteLine');
    if (!c) return;
    const q = quote();
    const t = c.querySelector('.ql-t'), a = c.querySelector('.ql-a');
    if (t) t.textContent = q[0];
    if (a) a.textContent = q[1] ? '— ' + q[1] : '';
    c.classList.remove('flip'); void c.offsetWidth; c.classList.add('flip');
  }
  function rerollQuote() {
    repaintQuoteLine();
    nextQuote();
    const c = document.getElementById('quoteCard');
    if (c) {
      const q = quote();
      c.querySelector('.q-t').textContent = q[0];
      const a = c.querySelector('.q-a');
      if (a) a.textContent = q[1] ? '— ' + q[1] : '';
      c.classList.remove('flip'); void c.offsetWidth; c.classList.add('flip');
    }
  }

  /* ---------------- 下拉刷新 ---------------- */
  let ptrEl = null;
  function ptr() {
    if (ptrEl && ptrEl.parentNode) return ptrEl;
    const d = document.createElement('div');
    d.className = 'ptr';
    d.id = 'ptr';
    d.innerHTML = '<div class="ptr-pill"><span class="ptr-ico">↓</span><span class="ptr-txt">下拉刷新</span></div>';
    (document.getElementById('app') || document.body).appendChild(d);
    ptrEl = d;
    return d;
  }
  function setPtr(state, yPx) {
    const el = ptr();
    const pill = el.querySelector('.ptr-pill');
    const ico = el.querySelector('.ptr-ico');
    const txt = el.querySelector('.ptr-txt');
    el.classList.toggle('on', state !== 'idle');
    el.classList.toggle('spin', state === 'loading');
    el.style.transform = 'translateY(' + (yPx || 0) + 'px)';
    if (state === 'loading') { ico.textContent = '⟳'; txt.textContent = '正在刷新…'; }
    else if (state === 'ready') { ico.textContent = '↑'; txt.textContent = '松手刷新'; }
    else { ico.textContent = '↓'; txt.textContent = '下拉刷新'; }
    if (pill) pill.style.opacity = yPx > 6 ? 1 : 0;
  }
  let refreshing = false;
  function doRefresh() {
    if (refreshing) return;
    refreshing = true;
    setPtr('loading', 46);
    sfx('refresh');
    U.vibrate(10);
    rerollQuote();
    setTimeout(() => {
      try {
        if (window.UI) UI.render();
        if (window.Feat && Feat.Notify) Feat.Notify.badge();
      } catch (e) { }
      setTimeout(() => {
        setPtr('idle', 0);
        refreshing = false;
        U.toast('已刷新 · 换了一句鸡汤 ✨');
      }, 420);
    }, 480);
  }
  function initPullRefresh() {
    let startY = 0, dragging = false, dist = 0, ready = false;
    function canStart() { return window.scrollY <= 0 && !refreshing; }
    function onStart(y) { if (!canStart()) return false; startY = y; dragging = true; dist = 0; ready = false; return true; }
    function onMove(y, ev) {
      if (!dragging) return;
      dist = y - startY;
      if (dist <= 0 || window.scrollY > 0) { if (dragging) { dragging = false; setPtr('idle', 0); } return; }
      const d = Math.min(96, dist * 0.52);
      ready = d > 52;
      setPtr(ready ? 'ready' : 'pull', d);
      if (ev && ev.cancelable) ev.preventDefault();
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      if (ready) doRefresh(); else setPtr('idle', 0);
      ready = false;
    }
    document.addEventListener('touchstart', e => { if (e.touches.length === 1) onStart(e.touches[0].clientY); }, { passive: true });
    document.addEventListener('touchmove', e => { if (e.touches.length === 1) onMove(e.touches[0].clientY, e); }, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    // 桌面：按住空白处往下拉也能刷新
    let mdown = false;
    document.addEventListener('mousedown', e => { if (e.button === 0 && !e.target.closest('button,a,input,textarea,select')) mdown = onStart(e.clientY); });
    document.addEventListener('mousemove', e => { if (mdown) onMove(e.clientY, e); });
    document.addEventListener('mouseup', () => { if (mdown) { mdown = false; onEnd(); } });
  }

  /* ---------------- 5. 字数限制与计数 ---------------- */
  function bindCounters(root) {
    const scope = root || document;
    const els = scope.querySelectorAll('input[data-max],textarea[data-max]');
    for (const el of els) {
      if (el.dataset.cnt === '1') continue;
      el.dataset.cnt = '1';
      const max = parseInt(el.dataset.max, 10) || 100;
      el.setAttribute('maxlength', max);
      const box = document.createElement('div');
      box.className = 'counter';
      if (el.parentNode) el.parentNode.insertBefore(box, el.nextSibling);
      function upd() {
        const n = (el.value || '').length;
        box.textContent = n + ' / ' + max;
        box.classList.toggle('over', n >= max);
      }
      el.addEventListener('input', upd);
      el.addEventListener('change', upd);
      upd();
    }
  }

  return {
    sfx: sfx, soundOn: soundOn,
    confirm: confirmBox, confirmDelete: confirmDelete, alert: alertBox, prompt: promptBox,
    busy: busy, NO_BUSY: NO_BUSY,
    quote: quote, nextQuote: nextQuote, quoteHTML: quoteHTML, rerollQuote: rerollQuote,
    quoteLine: quoteLine, repaintQuoteLine: repaintQuoteLine,
    initPullRefresh: initPullRefresh, doRefresh: doRefresh,
    bindCounters: bindCounters,
    QUOTES: QUOTES
  };
})();
