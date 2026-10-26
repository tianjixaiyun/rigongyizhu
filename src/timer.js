/* ============ 习惯计时器（时长型习惯） ============
 * 参考 DropDrop / Streaks：像「冥想 10 分钟」「读书 30 分钟」这类习惯，
 * 光靠手填一个数字并不符合真实动作 —— 应该能按下计时、做完自动打卡。
 * 计时状态写进 st.timer 并持久化：中途刷新页面、切后台回来，计时不会丢。
 *
 * v31 · 4.6 计时绑定（对标文档第 2 周）：
 * 1) 到点自动打卡 —— 后台一个 500ms 的心跳，到了目标时长就自己写日志，
 *    用户不用再点一次「完成」；计时面板关着、手机锁屏也同样会触发
 *    （心跳用 Date.now() 算账，浏览器把后台定时器调慢也不影响准度）。
 * 2) 中途结束保留已用时间 —— 提前收工把已计分钟写进当天日志，未达标不算完成。
 * 3) 跨天的旧会话不跟着时钟无限涨 —— 开机对账时发现 timer.date 不是今天，
 *    把已计时间记到它开始的那天（上限为目标时长）然后清掉。
 */
window.Timer = (function () {

  let _auto = null;   // 到点自动打卡的心跳句柄

  function active() { return Store.s.timer || null; }
  function isFor(itemId) { const t = active(); return !!t && t.itemId === itemId; }
  function itemOf(itemId) { return (Store.s.items || []).find(x => x.id === itemId) || null; }
  function item() {
    const t = active();
    return t ? itemOf(t.itemId) : null;
  }

  /* 已计时毫秒：暂停时就是 accum，运行中再加「本次已跑多久」 */
  function elapsed(t) {
    t = t || active();
    if (!t) return 0;
    return (t.accum || 0) + (t.running ? Date.now() - (t.startAt || Date.now()) : 0);
  }

  function targetMs(it) { return it && it.target ? it.target * 60000 : 0; }

  function start(itemId) {
    const it = itemOf(itemId);
    if (!it || it.deleted) return null;
    const cur = active();
    if (cur && cur.itemId === itemId) return cur;
    const t = { itemId: itemId, date: U.today(), startAt: Date.now(), accum: 0, running: true };
    Store.commit(st => { st.timer = t; });
    startAuto();
    return t;
  }

  function pause() {
    const t = active();
    if (!t || !t.running) return;
    const acc = (t.accum || 0) + (Date.now() - (t.startAt || Date.now()));
    stopAuto();   // 暂停期间不到点自动收工，免得用户只是想歇一下却被打卡
    Store.commit(st => { if (st.timer) { st.timer.accum = acc; st.timer.running = false; } });
  }

  function resume() {
    const t = active();
    if (!t || t.running) return;
    Store.commit(st => { if (st.timer) { st.timer.startAt = Date.now(); st.timer.running = true; } });
    startAuto();
  }

  function toggle() { const t = active(); if (!t) return; t.running ? pause() : resume(); }

  function cancel() {
    stopAuto();
    Store.commit(st => { st.timer = null; });
  }

  /* 重新开始：从 0 再计（点错习惯、或者中途走神了想重来） */
  function reset() {
    const t = active();
    if (!t) return;
    Store.commit(st => { if (st.timer) { st.timer.accum = 0; st.timer.startAt = Date.now(); st.timer.running = true; } });
    startAuto();
  }

  /* 收工：把计到的分钟数记进这个习惯，顺手打卡。
   * 不足 1 分钟按 1 分钟算（用户既然按了完成，就认这一笔）。 */
  function finish() {
    const t = active();
    if (!t) return null;
    const it = itemOf(t.itemId);
    const ms = elapsed(t);
    const minutes = Math.max(1, Math.round(ms / 60000));
    const date = t.date || U.today();
    stopAuto();
    Store.commit(st => { st.timer = null; });
    if (it && window.Engine) {
      Engine.addValue(it, date, minutes);
      Store.commit();
    }
    return { item: it, minutes: minutes };
  }

  /* 中途收工（v31 · 4.6「中途退出保留已用时间」）：
   * 把已计分钟数写进当天日志 —— 未达标就不算完成，但时间不白费。
   * 不足 1 分钟什么都不写：点错了一下不该留下痕迹。 */
  function keepStop() {
    const t = active();
    if (!t) return null;
    const it = itemOf(t.itemId);
    const minutes = Math.max(0, Math.round(elapsed(t) / 60000));
    const date = t.date || U.today();
    stopAuto();
    Store.commit(st => { st.timer = null; });
    if (it && minutes > 0 && window.Engine) {
      Engine.addValue(it, date, minutes);
      Store.commit();
    }
    return { item: it, minutes: minutes };
  }

  /* ---------- 到点自动打卡 ---------- */
  function startAuto() {
    stopAuto();
    if (typeof setInterval !== 'function') return;
    try { _auto = setInterval(checkAuto, 500); } catch (e) { /* 老浏览器大不了不自动 */ }
  }
  function stopAuto() {
    if (_auto) { try { clearInterval(_auto); } catch (e) { } _auto = null; }
  }

  function checkAuto() {
    const t = active();
    if (!t || !t.running) { stopAuto(); return; }
    const it = itemOf(t.itemId);
    if (!it || !targetMs(it)) return;   // 没设目标就当秒表用，不自动收工
    if (elapsed(t) >= targetMs(it)) autoFinish();
  }

  /* 到点自己写日志：记目标时长（不把超时的部分也算上），打卡 + 提示 + 通知。
   * 面板开着就替用户关掉它 —— 事已经办完了，不用再让人点一次。 */
  function autoFinish() {
    const t = active();
    if (!t) return null;
    const it = itemOf(t.itemId);
    const date = t.date || U.today();
    const minutes = targetMs(it) ? Math.round(it.target) : Math.max(1, Math.round(elapsed(t) / 60000));
    stopAuto();
    Store.commit(st => { st.timer = null; });
    if (it && window.Engine) {
      Engine.addValue(it, date, minutes);
      Store.commit();
    }
    try {
      U.toast('「' + (it ? it.name : '习惯') + '」专注 ' + minutes + ' 分钟完成，已自动打卡 ✓');
      U.vibrate([80, 60, 80]);
      if (window.Feat && Feat.Notify) Feat.Notify.fire('专注完成', (it ? it.name : '习惯') + ' 已自动打卡');
      if (window.UI) { UI.closeSheet(); UI.render(); }
    } catch (e) { }
    return { item: it, minutes: minutes, auto: true };
  }

  /* 开机对账：必须放在 store ready 之后调用（和 v29 保护券结算同一个道理 ——
   * boot() 同步段的写入会被 Store.init() 整体换掉）。
   * - 昨天的旧会话：已计时间记到昨天（上限目标时长）然后清掉，不跟着时钟无限涨
   * - 今天的会话：心跳接着跑，到点照样自动打卡 */
  function bootCheck() {
    const t = active();
    if (!t) return null;
    const it = itemOf(t.itemId);
    if (!it) { Store.commit(st => { st.timer = null; }); return null; }   // 习惯删了
    const today = U.today();
    const date = t.date || today;
    if (date !== today) {
      const mins = Math.round(elapsed(t) / 60000);
      const keep = targetMs(it) ? Math.min(mins, Math.round(it.target)) : mins;
      stopAuto();
      Store.commit(st => { st.timer = null; });
      if (keep > 0 && window.Engine) { Engine.addValue(it, date, keep); Store.commit(); }
      return { item: it, minutes: keep, stale: true };
    }
    if (t.running) { startAuto(); checkAuto(); }
    return null;
  }

  function fmt(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? (h + ':' + U.pad(m) + ':' + U.pad(sec)) : (U.pad(m) + ':' + U.pad(sec));
  }

  /* 是否已达该习惯的目标时长（用于给计时面板一个「够了」的提示） */
  function reached(it) {
    if (!it || !it.target) return false;
    const t = active();
    if (!t || t.itemId !== it.id) return false;
    return elapsed(t) >= it.target * 60000;
  }

  return { active, isFor, itemOf, item, elapsed, targetMs, start, pause, resume, toggle, cancel, reset,
    finish, keepStop, fmt, reached, bootCheck, startAuto, stopAuto };
})();
