/* 隐私锁（v46 · 对标 Habitify 的 Privacy Lock）
 *
 * 说清楚它是什么、不是什么：
 *   · 它是**屏幕锁** —— 别人拿到你解锁着的手机、或者你把手机借给别人时，挡住应用内容。
 *   · 它**不是加密** —— 数据仍是明文存在浏览器里，能拿到设备文件的人照样能读。
 *     真要加密请用「我的 → 加密导出」。
 * 这句话必须同时出现在设置页和输入框下方，不能只在代码注释里。
 *
 * 存储：settings.lockHash / lockSalt / lockIter / lockScope。
 * 只存 PBKDF2-SHA256 的派生结果，不存 PIN 本身。迭代次数低于 Enc.ITER（21 万），
 * 因为 6 位数字本身熵就低，这里的目标是「挡人」不是「抗离线爆破」——
 * 所以额外加了「连续错 5 次后冷却」的节流。
 */
window.Lock = (function () {
  var ITER = 120000;
  var MAX_TRY = 5;
  var COOL_MS = 30000;      // 连错 5 次后冷却 30 秒
  var IDLE_MS = 5 * 60000;  // 切到后台超过 5 分钟回来，重新上锁

  var unlocked = false;     // 本次会话已解锁（内存态，刷新即失效）
  var tries = 0;
  var coolUntil = 0;
  var hiddenAt = 0;

  function S() { return window.Store && Store.s ? Store.s.settings : null; }
  function b64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function unb64(str) {
    var raw = atob(str), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function te() { return new TextEncoder(); }
  function subtle() {
    try { return (window.crypto && window.crypto.subtle) || null; } catch (e) { return null; }
  }
  function available() { return !!subtle(); }

  function enabled() {
    var st = S();
    return !!(st && st.lockHash && st.lockSalt);
  }
  function scope() {
    var st = S();
    return (st && st.lockScope) || 'all';
  }
  function isUnlocked() { return unlocked; }

  /* PBKDF2-SHA256 → base64 */
  function derive(pin, salt, iter) {
    var c = subtle();
    if (!c) return Promise.reject(new Error('这台设备不支持加密接口'));
    return c.importKey('raw', te().encode(String(pin)), 'PBKDF2', false, ['deriveBits'])
      .then(function (base) {
        return c.deriveBits({ name: 'PBKDF2', salt: salt, iterations: iter || ITER, hash: 'SHA-256' }, base, 256);
      })
      .then(function (bits) { return b64(bits); });
  }

  function setPin(pin, sc) {
    if (!available()) return Promise.reject(new Error('这台设备不支持加密接口，隐私锁不可用'));
    var p = String(pin || '');
    if (!/^\d{4,8}$/.test(p)) return Promise.reject(new Error('请用 4–8 位数字'));
    var salt = new Uint8Array(16);
    try { crypto.getRandomValues(salt); } catch (e) { return Promise.reject(new Error('取不到随机数')); }
    return derive(p, salt, ITER).then(function (hash) {
      Store.commit(function (s) {
        s.settings.lockHash = hash;
        s.settings.lockSalt = b64(salt);
        s.settings.lockIter = ITER;
        s.settings.lockScope = sc === 'diary' ? 'diary' : 'all';
      });
      unlocked = true;
      tries = 0;
      return true;
    });
  }

  function verify(pin) {
    var st = S();
    if (!st || !st.lockHash) return Promise.resolve(true);
    if (Date.now() < coolUntil) {
      return Promise.reject(new Error('试错次数太多，请 ' + Math.ceil((coolUntil - Date.now()) / 1000) + ' 秒后再试'));
    }
    var salt;
    try { salt = unb64(st.lockSalt); } catch (e) { return Promise.reject(new Error('锁数据损坏')); }
    return derive(pin, salt, st.lockIter || ITER).then(function (hash) {
      if (hash === st.lockHash) { unlocked = true; tries = 0; return true; }
      tries++;
      if (tries >= MAX_TRY) {
        coolUntil = Date.now() + COOL_MS;
        tries = 0;
        throw new Error('试错次数太多，请 ' + Math.ceil(COOL_MS / 1000) + ' 秒后再试');
      }
      throw new Error('密码不对');
    });
  }

  function disable(pin) {
    return verify(pin).then(function () {
      Store.commit(function (s) {
        delete s.settings.lockHash;
        delete s.settings.lockSalt;
        delete s.settings.lockIter;
        s.settings.lockScope = 'all';
      });
      unlocked = false;
      return true;
    });
  }

  /* ---------------- 遮罩层 ---------------- */
  function overlayHTML() {
    return '<div class="lock-mask" id="lockMask" role="dialog" aria-modal="true" aria-label="应用已锁定">' +
      '<div class="lock-box">' +
      '<div class="lock-ico" aria-hidden="true">🔒</div>' +
      '<div class="lock-t">应用已锁定</div>' +
      '<div class="lock-s">输入你设的 ' + '数字密码' + ' 继续</div>' +
      '<input class="lock-in" id="lockPin" type="password" inputmode="numeric" autocomplete="off" ' +
      'maxlength="8" placeholder="••••" aria-label="数字密码">' +
      '<div class="lock-err" id="lockErr" role="alert"></div>' +
      '<button class="btn lock-btn" id="lockGo">解锁</button>' +
      '<div class="lock-note">这是屏幕锁，不是加密 —— 能拿到设备文件的人仍可能读到数据。' +
      '要真正加密请用「我的 → 加密导出」。</div>' +
      '<button class="lock-forget" id="lockForget">忘记密码？</button>' +
      '</div></div>';
  }

  /* 显示遮罩；解锁后回调。已经解锁过就直接回调。 */
  function gate(cb) {
    if (!enabled() || unlocked) { if (cb) cb(); return; }
    var old = document.getElementById('lockMask');
    if (old) old.parentNode.removeChild(old);
    var host = document.createElement('div');
    host.innerHTML = overlayHTML();
    var mask = host.firstChild;
    document.body.appendChild(mask);
    try { document.body.style.overflow = 'hidden'; } catch (e) { }

    var inp = mask.querySelector('#lockPin');
    var err = mask.querySelector('#lockErr');
    var btn = mask.querySelector('#lockGo');

    function done() {
      mask.classList.add('off');
      setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 180);
      try { document.body.style.overflow = ''; } catch (e) { }
      if (cb) cb();
    }
    function attempt() {
      var v = (inp.value || '').trim();
      if (!v) { err.textContent = '请输入密码'; return; }
      btn.disabled = true;
      verify(v).then(function () { done(); }, function (e) {
        btn.disabled = false;
        err.textContent = (e && e.message) || '密码不对';
        inp.value = '';
        inp.focus();
      });
    }
    btn.onclick = attempt;
    inp.onkeydown = function (e) { if (e.key === 'Enter') attempt(); };
    mask.querySelector('#lockForget').onclick = function () {
      err.innerHTML = '密码无法找回（本机不存明文）。可以：<br>· 用之前导出的备份在另一台设备恢复；<br>· 或在浏览器设置里清掉本站数据后重新开始。';
    };
    setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (e) { } }, 80);
  }

  /* 切后台太久回来重新上锁（只对「锁整个应用」生效） */
  function watchIdle() {
    try {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
        if (!enabled() || scope() !== 'all' || !unlocked) return;
        if (hiddenAt && Date.now() - hiddenAt > IDLE_MS) { unlocked = false; gate(function () { }); }
        hiddenAt = 0;
      });
    } catch (e) { }
  }

  return {
    available: available, enabled: enabled, scope: scope, isUnlocked: isUnlocked,
    setPin: setPin, verify: verify, disable: disable,
    gate: gate, watchIdle: watchIdle,
    lockNow: function () { unlocked = false; },
    ITER: ITER
  };
})();
