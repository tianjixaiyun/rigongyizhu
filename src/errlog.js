/* ============ 异常记录：让「出了问题」这件事可被带走 ============
 * 之前全局报错只 console.error 一下，再弹一张自救卡。问题是：
 * 用户想反馈时，控制台里的信息他拿不到，我们只能靠猜。
 * 这里把最近 20 条异常压进 localStorage，反馈时随诊断信息一起复制出去。
 *
 * 只记「出错的类型 + 消息 + 时间 + 版本」，不记任何用户内容，
 * 所以贴给别人也不泄露日记和打卡记录。
 */
window.ErrLog = (function () {
  const KEY = 'rigongyizhu.errlog';
  const KEEP = 20;

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function write(arr) {
    try { localStorage.setItem(KEY, JSON.stringify(arr.slice(-KEEP))); return true; }
    catch (e) { return false; }   // 配额满时静默失败：记日志本身绝不能把主流程搞崩
  }

  function push(kind, err) {
    try {
      const msg = (err && (err.stack || err.message)) || String(err == null ? '' : err);
      const arr = read();
      arr.push({
        kind: kind || 'error',
        msg: String(msg).slice(0, 400),
        at: Date.now(),
        v: (window.U && U.VERSION) || ''
      });
      write(arr);
    } catch (e) { }
  }

  return {
    push,
    all: read,
    clear() { try { localStorage.removeItem(KEY); } catch (e) { } },
    count() { return read().length; },
    recent(n) { const a = read(); return a.slice(-(n || 3)); }
  };
})();
