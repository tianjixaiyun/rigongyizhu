/* ============ 搭子（v32 · 4.7）：1v1 共享一个习惯 ============
 * 对标文档：房间是多人排名，这里补一个更轻的「搭子」——
 * 邀请一个朋友共享一个习惯，双方只看到「今日是否完成」与「连续天数」，
 * 可以互相送一次「提醒」；不做公开榜，也不显示具体数值；退出后数据互不可见。
 *
 * 同步走一个只存这三样的信箱（rigongyizhu-buddy）：
 *   { 昵称, 习惯名, 今天做没做, 连续几天, 一次打气 }
 * 本机永远是数据的主人 —— 断网不崩（联网后补传），退出即删（连不上也会补删）。
 */
window.Buddy = (function () {
  'use strict';

  /* 搭子接口和页面在同一个服务里（同源），所以这里不需要域名。
   * v32 最初把信箱单独部署，结果发布平台一个沙箱只跑一个服务 ——
   * 部署信箱就把页面挤掉、部署页面就把信箱挤掉，两个链接只能活一个。
   * 合成一个进程之后，接口走 /api/*，页面和接口永远同生共死。
   * 测试可以用 localStorage.__buddyApi 指到本地实例。 */
  const API = '';

  let pushTimer = null, lastFp = '', syncing = null, lastAt = 0;

  function base() {
    try { const o = localStorage.getItem('__buddyApi'); if (o) return String(o).replace(/\/+$/, ''); } catch (e) { }
    return API;
  }
  function mine() { return Store.s.buddy || null; }
  function has() { const b = mine(); return !!(b && b.code && b.token); }
  function habit() {
    const b = mine();
    if (!b) return null;
    return (Store.s.items || []).find(x => x.id === b.habitId && !x.deleted) || null;
  }
  function nick() { return String(Store.s.settings.nickname || '').trim().slice(0, 12); }
  function streakOf(it, d) {
    try { return Engine.isAvoid(it) ? Engine.cleanStreakOf(it.id, d) : Engine.streakOf(it.id, d); } catch (e) { return 0; }
  }
  function myState() {
    const it = habit();
    if (!it) return null;
    const d = U.today();
    return { nick: nick() || '我', habit: String(it.name || '').slice(0, 40), done: Engine.isDone(it, d), streak: streakOf(it, d), day: d };
  }
  function save(patch) { Store.commit(s => { s.buddy = Object.assign({}, s.buddy || {}, patch); }); }

  /* 同步只写 store、不重绘 —— 卡片上「对方今天完成」要等下一次 render 才看得见。
   * 但每 5 分钟的自动轮询不该整页重绘（会丢滚动位置、白闪一下），
   * 所以只在「对方的状态真的变了」时补一次重绘。 */
  function peerFp(p) {
    if (!p) return '';
    return [p.nick, p.habit, p.done, p.streak, p.day, p.cheerAt].join('|');
  }
  function repaint() {
    try { if (window.UI && UI.tab === 'today') UI.render(); } catch (e) { }
  }

  /* 8 秒超时：弱网下宁可放弃这一次，也不能把界面卡住 */
  function req(path, opt) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) { } }, 8000) : 0;
    const init = Object.assign({ method: 'GET', headers: { 'Content-Type': 'application/json' } }, opt || {});
    if (ctrl) init.signal = ctrl.signal;
    return fetch(base() + path, init)
      .then(r => r.json().catch(() => ({})).then(b => ({ status: r.status, body: b || {} })))
      .finally(() => { if (t) clearTimeout(t); });
  }

  /* ---------- 建立 / 加入 ---------- */
  async function create(habitId, name) {
    const it = (Store.s.items || []).find(x => x.id === habitId && !x.deleted);
    if (!it) return { ok: false, msg: '先选一个要共享的习惯' };
    const n = String(name || nick() || '').trim().slice(0, 12);
    if (!n) return { ok: false, msg: '先给自己起个名字，对方才知道是谁' };
    const d = U.today();
    const st = { nick: n, habit: String(it.name || '').slice(0, 40), done: Engine.isDone(it, d), streak: streakOf(it, d), day: d };
    try {
      const r = await req('/api/create', { method: 'POST', body: JSON.stringify(st) });
      if (!r.body || !r.body.ok) return { ok: false, msg: '创建失败，稍后再试' };
      Store.commit(s => {
        s.buddy = { code: r.body.code, token: r.body.token, habitId: it.id, nick: n, peer: null,
          joinedAt: Date.now(), lastSync: Date.now(), notifiedFor: '', lastCheerSeen: 0, lastError: '' };
        s.settings.nickname = n;
      });
      lastFp = [st.done, st.streak, st.habit, n].join('|');
      return { ok: true, code: r.body.code };
    } catch (e) {
      return { ok: false, msg: '连不上搭子服务，检查一下网络再试' };
    }
  }

  async function join(code, habitId, name) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return { ok: false, msg: '邀请码是 6 位字母数字' };
    const it = (Store.s.items || []).find(x => x.id === habitId && !x.deleted);
    if (!it) return { ok: false, msg: '先选一个要共享的习惯' };
    const n = String(name || nick() || '').trim().slice(0, 12);
    if (!n) return { ok: false, msg: '先给自己起个名字，对方才知道是谁' };
    const d = U.today();
    const st = { nick: n, habit: String(it.name || '').slice(0, 40), done: Engine.isDone(it, d), streak: streakOf(it, d), day: d };
    try {
      const r = await req('/api/join', { method: 'POST', body: JSON.stringify(Object.assign({ code }, st)) });
      if (r.status === 404) return { ok: false, msg: '找不到这个邀请，可能已经过期了' };
      if (r.status === 409) return { ok: false, msg: '这个搭子已经有两个人了' };
      if (!r.body || !r.body.ok) return { ok: false, msg: '加入失败，稍后再试' };
      const peer = r.body.peer || null;
      Store.commit(s => {
        s.buddy = { code: r.body.code, token: r.body.token, habitId: it.id, nick: n, peer: peer,
          joinedAt: Date.now(), lastSync: Date.now(),
          /* 对方今天已经完成了 —— 别在刚加入的一瞬间就弹提醒，先记成「已提醒」 */
          notifiedFor: peer && peer.done && peer.day === d ? d : '',
          lastCheerSeen: (peer && peer.cheerAt) || 0, lastError: '' };
        s.settings.nickname = n;
      });
      lastFp = [st.done, st.streak, st.habit, n].join('|');
      return { ok: true, code: r.body.code, peer };
    } catch (e) {
      return { ok: false, msg: '连不上搭子服务，检查一下网络再试' };
    }
  }

  /* ---------- 同步 ---------- */
  function checkPeer(peer) {
    const b = mine();
    if (!b || !peer) return;
    const today = U.today();
    /* 对方今天完成 → 一天最多提醒一次（按日期去重，跨天自然重置） */
    if (peer.done && peer.day === today && b.notifiedFor !== today) {
      save({ notifiedFor: today });
      try {
        U.toast('「' + peer.nick + '」今天也完成了' + (peer.streak > 1 ? '，连续 ' + peer.streak + ' 天' : ''));
        if (window.Feat && Feat.Notify) Feat.Notify.fire('搭子完成了', peer.nick + ' 今天完成了「' + peer.habit + '」');
      } catch (e) { }
    }
    /* 对方打气 → 只提示一次（按 cheerAt 去重） */
    if (peer.cheerAt && peer.cheerAt > (b.lastCheerSeen || 0)) {
      save({ lastCheerSeen: peer.cheerAt });
      try { U.toast('「' + peer.nick + '」给你打了个气 👋'); } catch (e) { }
    }
  }

  function sync(opt) {
    if (!has()) return Promise.resolve({ ok: false, msg: '还没有搭子' });
    if (syncing) return syncing;
    const st = myState();
    if (!st) return Promise.resolve({ ok: false, gone: true, msg: '共享的习惯不在了' });
    const b = mine();
    const body = Object.assign({ code: b.code, token: b.token }, st, opt && opt.cheer ? { cheer: true } : {});
    const prevFp = peerFp(b.peer);
    syncing = req('/api/state', { method: 'POST', body: JSON.stringify(body) })
      .then(r => {
        if (r.status === 404) {
          save({ peer: null, lastError: 'gone' });
          if (prevFp) repaint();
          return { ok: false, gone: true, msg: '这对搭子已经不存在了' };
        }
        if (r.status === 429) return { ok: false, cheerLimit: true, msg: '今天已经打过气了，明天再来' };
        if (!r.body || !r.body.ok) { save({ lastError: 'error' }); return { ok: false, msg: '同步失败，稍后再试' }; }
        save({ peer: r.body.peer || null, lastSync: Date.now(), lastError: '',
          myCheerAt: (r.body.me && r.body.me.cheerAt) || 0 });
        lastFp = [st.done, st.streak, st.habit, st.nick].join('|');
        checkPeer(r.body.peer);
        if (peerFp(r.body.peer) !== prevFp) repaint();
        return { ok: true, peer: r.body.peer || null };
      })
      .catch(() => { save({ lastError: 'offline' }); return { ok: false, msg: '暂时连不上，本机记录不受影响' }; })
      .finally(() => { syncing = null; });
    return syncing;
  }

  function cheer() { return sync({ cheer: true }); }

  /* ---------- 退出：连不上也要保证「对方看不到我」---------- */
  async function leave() {
    const b = mine();
    if (!b) return { ok: true };
    let cleared = false;
    try {
      const r = await req('/api/leave', { method: 'POST', body: JSON.stringify({ code: b.code, token: b.token }) });
      cleared = !!(r.body && r.body.ok);
    } catch (e) { cleared = false; }
    Store.commit(s => {
      s.buddy = null;
      /* 没删成功就留一张「待删条」，下次开机或联网时补删 */
      s.buddyLeave = cleared ? null : { code: b.code, token: b.token, at: Date.now() };
    });
    lastFp = '';
    return { ok: true, pending: !cleared };
  }

  async function flushLeave() {
    const p = Store.s.buddyLeave;
    if (!p || !p.code || !p.token) return;
    try {
      const r = await req('/api/leave', { method: 'POST', body: JSON.stringify({ code: p.code, token: p.token }) });
      if (r.body && r.body.ok) Store.commit(s => { s.buddyLeave = null; });
    } catch (e) { /* 下次再来 */ }
  }

  function inviteLink(code) {
    const b = mine();
    return location.origin + location.pathname + '#buddy=' + encodeURIComponent(code || (b && b.code) || '');
  }

  /* ---------- 自动同步 ----------
   * 只在我这边的「做没做 / 连续 / 习惯 / 昵称」真的变了才推，
   * 否则 sync 自己写回 peer 会触发 onChange → 再 sync，转成死循环。 */
  function observe() {
    if (!has()) return;
    const st = myState();
    if (!st) return;
    const fp = [st.done, st.streak, st.habit, st.nick].join('|');
    if (fp === lastFp) return;
    lastFp = fp;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; sync(); }, 2500);
  }
  Store.onChange(observe);

  function pull(force) {
    if (!has()) return Promise.resolve(null);
    if (!force && Date.now() - lastAt < 15000) return Promise.resolve(null);
    lastAt = Date.now();
    return sync();
  }
  window.addEventListener('online', () => { flushLeave(); pull(true); });
  window.addEventListener('focus', () => pull());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  setInterval(() => { if (!document.hidden) pull(true); }, 300000);

  return { base, mine, has, habit, nick, myState, create, join, sync, cheer, leave, flushLeave, inviteLink, pull, checkPeer };
})();
