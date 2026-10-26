/* ============ 视觉特效：彩纸庆祝 / 数字跳动 / 页面入场 ============ */
(function () {
  var COLORS = ['#4f6bed', '#8b7bff', '#ff9a3c', '#ff5e7e', '#3ecf7a', '#22d3ee', '#facc15', '#f472b6'];
  var reduce = false;
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { }

  function layer() {
    var el = document.getElementById('fxLayer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fxLayer';
      el.className = 'fx-layer';
      document.body.appendChild(el);
    }
    return el;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* 彩纸飘落：count 片，可指定从某点喷出。
     分批插入（每帧最多 24 片），避免一次性塞进上百个元素导致掉帧 */
  function confetti(count, opt) {
    if (reduce) return;
    opt = opt || {};
    var n = Math.min(count || 60, 160);
    var host = layer();
    var ox = opt.x == null ? window.innerWidth / 2 : opt.x;
    var oy = opt.y == null ? -20 : opt.y;
    var spread = opt.spread == null ? window.innerWidth * 0.98 : opt.spread;

    function batch(from, to) {
      var frag = document.createDocumentFragment();
      for (var i = from; i < to; i++) {
        var p = document.createElement('i');
        p.className = 'fx-piece';
        var c = opt.colors ? opt.colors[i % opt.colors.length] : COLORS[i % COLORS.length];
        p.style.background = c;
        p.style.left = (ox - spread / 2 + Math.random() * spread) + 'px';
        p.style.top = (oy + rnd(-10, 10)) + 'px';
        p.style.width = rnd(6, 11) + 'px';
        p.style.height = rnd(9, 17) + 'px';
        if (Math.random() < 0.3) p.style.borderRadius = '50%';
        p.style.setProperty('--dx', rnd(-160, 160) + 'px');
        p.style.setProperty('--rot', rnd(320, 1100) + 'deg');
        p.style.animationDuration = rnd(1.5, 2.9) + 's';
        p.style.animationDelay = (Math.random() * (opt.delay || 0.5)).toFixed(2) + 's';
        p.style.opacity = rnd(0.75, 1);
        frag.appendChild(p);
      }
      host.appendChild(frag);
    }

    var STEP = 24;
    var done = 0;
    (function next() {
      var to = Math.min(n, done + STEP);
      batch(done, to);
      done = to;
      if (done < n) requestAnimationFrame(next);
    })();

    setTimeout(function () {
      var kids = host.querySelectorAll('.fx-piece');
      for (var k = 0; k < kids.length; k++) kids[k].remove();
    }, 3800);
  }

  /* 数字滚动跳动 */
  function numRoll(el, to, dur, suffix, from) {
    if (!el) return;
    if (reduce) { el.textContent = to + (suffix || ''); return; }
    /* 先写终值，动画只做视觉增强。
     * 卡慢时 requestAnimationFrame 可能迟迟不触发，用户会先看到一块空白；
     * 「从 0 数到 38」也会被误读成「正在统计」。所以起点一不可信就不演，直接给终值。 */
    var cur = parseInt(String(el.textContent).replace(/\D/g, ''), 10);
    if (from == null) from = cur;
    if (isNaN(from) || isNaN(cur)) { el.textContent = to + (suffix || ''); return; }
    var t0 = performance.now();
    dur = dur || 700;
    function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e) + (suffix || '');
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* 元素弹一下（用于环形百分比、卡片） */
  function bump(el, cls) {
    if (!el) return;
    var c = cls || 'bump';
    el.classList.remove(c);
    void el.offsetWidth;
    el.classList.add(c);
    setTimeout(function () { el.classList.remove(c); }, 700);
  }

  /* 全屏庆祝：彩纸 + 大数字跳动 */
  function celebrate(num, text, opt) {
    opt = opt || {};
    confetti(opt.count || 90, { y: -20 });
    if (reduce) { opt.onEnd && opt.onEnd(); return; }
    var box = document.createElement('div');
    box.className = 'celeb';
    box.innerHTML =
      '<div class="celeb-in">' +
      '<div class="celeb-num"><span id="celebNum">0</span><small>%</small></div>' +
      (text ? '<div class="celeb-badge">' + text + '</div>' : '') +
      '</div>';
    document.body.appendChild(box);
    numRoll(box.querySelector('#celebNum'), num, 900, '');
    setTimeout(function () { confetti(40, { y: -10, delay: 0.2 }); }, 260);
    setTimeout(function () {
      box.remove();
      opt.onEnd && opt.onEnd();
    }, 1750);
  }

  /* 轻量庆祝：单次打卡，从按钮位置喷一小把彩纸 */
  function pop(x, y, color) {
    confetti(14, { x: x, y: y, spread: 190, delay: 0.12, colors: color ? [color, '#3ecf7a', '#ffffff'] : null });
  }

  /* 页面进入动画：重新触发 .view 的淡入上移 */
  function pageIn(v) {
    if (!v) return;
    v.style.animation = 'none';
    void v.offsetWidth;
    v.style.animation = '';
  }

  window.FX = {
    confetti: confetti, celebrate: celebrate, numRoll: numRoll,
    bump: bump, pop: pop, pageIn: pageIn, reduced: reduce
  };
})();
