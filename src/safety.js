/* ============ Safety：数据安全网 ============
 * 习惯 App 最不能接受的事，是"记录没了"。
 * 打卡记录是一个人几个月的生活证据，一旦因为误删 / 导入错误 / 升级异常丢掉，
 * 用户不会怪自己，只会卸载。所以这里做三件事，成本都很低但都是保命的：
 *
 *   1. 每日快照：每天首次进入时把当天"开盘"状态存一份到本地（localStorage），
 *      只留最近 7 天。误操作后可以一键回到今天早上 / 昨天 / 前几天。
 *   2. 离线提示：断网时明确告诉用户"数据已存本地，联网后自动同步"，
 *      否则用户会以为打卡没记上，反复点。
 *   3. 错误自救卡：渲染崩溃时给一张能操作的卡片（重试 / 导出 / 回滚），
 *      而不是一行灰色的报错文字——那样用户只能干瞪眼，数据还锁在里面。
 *
 * 快照刻意只存"文字骨架"（不含照片语音二进制），一份通常几十 KB，
 * localStorage 5MB 配额放 7 天绰绰有余。照片语音在 IndexedDB 里另存，
 * 回滚不会动它们，所以回滚是安全的：最多是某天的笔记少几张新图。
 */
var _sfroot = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
_sfroot.Safety = (function () {

  var KEY = 'rigongyizhu.snaps';
  var IDB_KEY = 'snaps';      // v41 起快照主体存在 IndexedDB（'kv' 表）
  var KEEP = 7;          // 保留最近 7 天
  /* v41 · 报告 P2-6：原来单份上限 900KB，7 份就超过 localStorage 的 5MB，
   * 而且 localStorage 写满时是静默失败 —— 用户以为每天都有备份，其实早就停了。
   * 搬到 IndexedDB 后配额宽松得多，上限提到 2MB（纯文字骨架正常只有几十 KB）。 */
  var MAX_CHARS = 2000000;
  var CACHE = null;           // 载入后是唯一数据源；init 之前退回 localStorage

  function idb() {
    try { return (window.Store && Store.idb) || null; } catch (e) { return null; }
  }
  function legacyRead() {
    try {
      var raw = localStorage.getItem(KEY);
      var o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  function legacyWrite(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
  }
  function dropLegacy() { try { localStorage.removeItem(KEY); } catch (e) { } }

  /* localStorage 在隐私模式 / 配额满时会抛异常，全部吞掉，绝不能因为备份把主流程搞崩 */
  function readAll() {
    if (CACHE) return CACHE;
    return legacyRead();
  }
  function writeAll(o) {
    CACHE = o;
    var h = idb();
    if (!h) return legacyWrite(o);
    /* 先认账、再落盘：IDB 写失败时退回 localStorage，至少不会两边都没有 */
    h.put('kv', IDB_KEY, o).then(dropLegacy).catch(function () { legacyWrite(o); });
    return true;
  }

  /* 启动时调一次：把旧 localStorage 里的快照并进 IndexedDB，然后清掉那份（腾出 5MB 配额）。 */
  function init() {
    var h = idb();
    if (!h) { CACHE = legacyRead(); return Promise.resolve(false); }
    return h.get('kv', IDB_KEY).then(function (v) {
      var legacy = legacyRead();
      var merged = {};
      var fromIdb = (v && typeof v === 'object') ? v : {};
      Object.keys(legacy).forEach(function (k) { merged[k] = legacy[k]; });
      Object.keys(fromIdb).forEach(function (k) { merged[k] = fromIdb[k]; });
      var days = Object.keys(merged).sort();
      while (days.length > KEEP) { delete merged[days[0]]; days = Object.keys(merged).sort(); }
      CACHE = merged;
      if (Object.keys(legacy).length) {
        return h.put('kv', IDB_KEY, merged).then(dropLegacy).catch(function () { return false; });
      }
      return true;
    }).catch(function () { CACHE = legacyRead(); return false; });
  }

  /* 媒体索引骨架：只留重建可访问性必需的字段。
   * local 是本机字节数，回滚后没意义，剔除可以省一半体积；
   * path 必须留 —— 云端附件的 path 一旦丢了就再也取不回来。 */
  var MEDIA_KEYS = ['kind', 'date', 'size', 'cloud', 'path', 'dur', 'poster', 'thumb'];

  function slimMedia(media) {
    if (!media || typeof media !== 'object' || Array.isArray(media)) return {};
    var out = {};
    Object.keys(media).forEach(function (id) {
      var m = media[id];
      if (!m || typeof m !== 'object') return;
      var o = {};
      MEDIA_KEYS.forEach(function (k) { if (m[k] !== undefined && m[k] !== null) o[k] = m[k]; });
      out[id] = o;
    });
    return out;
  }

  /* 去掉不该进备份的东西：会话态。
   * 打卡记录（logs）、笔记文字（notes.text）、习惯定义、积分、设置、媒体索引 —— 全部保留。
   * 媒体索引曾经被整块剔除，导致回滚后 state.media 变空、云端附件永久失联，见 v22 修复。 */
  function slim(st) {
    if (!st) return null;
    var out = {};
    Object.keys(st).forEach(function (k) {
      if (k === 'sessions' || k === 'media') return;
      out[k] = st[k];
    });
    out.media = slimMedia(st.media);
    out.__snapAt = Date.now();
    return out;
  }

  /* 每天一份：以日期为键，同一天重复进入不覆盖（保住"当天开盘"那一刻的状态） */
  function snapshot(date, st) {
    var d = date || (window.U ? U.today() : new Date().toISOString().slice(0, 10));
    var s = st || (window.Store && Store.s);
    if (!s) return false;
    var body = slim(s);
    if (!body) return false;
    var txt;
    try { txt = JSON.stringify(body); } catch (e) { return false; }
    if (txt.length > MAX_CHARS) {
      /* 带上媒体索引后可能撑爆配额：优先保住打卡与日记文字，索引退让。
       * 退让后仍然超限就干脆不存，宁可不备份也不能撑爆 localStorage。 */
      delete body.media;
      try { txt = JSON.stringify(body); } catch (e) { return false; }
      if (txt.length > MAX_CHARS) return false;
    }
    var all = readAll();
    if (all[d]) return false;                    // 今天已经存过，保持最早那份
    all[d] = { ts: Date.now(), n: (body.items || []).length, txt: txt };
    var days = Object.keys(all).sort();
    while (days.length > KEEP) { delete all[days[0]]; days = Object.keys(all).sort(); }
    return writeAll(all);
  }

  /* 启动后调用：今天还没快照就存一份（此时是"今天还没打卡"的干净状态） */
  function daily() {
    var d = window.U ? U.today() : null;
    if (!d) return false;
    var all = readAll();
    if (all[d]) return false;
    return snapshot(d);
  }

  /* 列表：不读 txt，只给元信息，避免设置页一次解出几 MB */
  function list() {
    var all = readAll();
    return Object.keys(all).sort().reverse().map(function (d) {
      var o = all[d] || {};
      var logs = 0, done = 0;
      try {
        var st = JSON.parse(o.txt || '{}');
        var L = st.logs || {};
        Object.keys(L).forEach(function (day) {
          Object.keys(L[day] || {}).forEach(function (id) { logs++; if (L[day][id]) done++; });
        });
      } catch (e) { }
      return { date: d, ts: o.ts || 0, items: o.n || 0, logs: logs, done: done, size: (o.txt || '').length };
    });
  }

  /* 回滚：把某天的快照整体写回。返回 {ok,msg} */
  function restore(date) {
    var all = readAll();
    var o = all[date];
    if (!o) return { ok: false, msg: '没有这一天的备份' };
    var st;
    try { st = JSON.parse(o.txt); } catch (e) { return { ok: false, msg: '备份文件损坏' }; }
    if (!st || !st.items) return { ok: false, msg: '备份内容不完整' };
    if (!window.Store) return { ok: false, msg: '存储未就绪' };
    /* v21 及以前的快照里没有 media 键（当时被整块剔除）。回滚这种旧快照时，
     * 必须用当前索引补齐，否则附件全部失联 —— 这是 v22 修的那个 P0。 */
    if (!st.media || typeof st.media !== 'object' || Array.isArray(st.media)) {
      st.media = (Store.s && Store.s.media) || {};
    }
    try {
      /* 先把当前状态再存一份，回滚本身也是危险操作，得留退路 */
      snapshot('pre-restore-' + Date.now(), Store.s);
      Store.commit(function (s) {
        Object.keys(s).forEach(function (k) { delete s[k]; });
        Object.keys(st).forEach(function (k) { if (k !== '__snapAt') s[k] = st[k]; });
      });
      return { ok: true, msg: '已回到 ' + date };
    } catch (e) {
      return { ok: false, msg: '回滚失败：' + (e && e.message || e) };
    }
  }

  function clear() {
    CACHE = {};
    var h = idb();
    if (h) { h.del('kv', IDB_KEY).catch(function () { }); }
    try { localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  /* ---------- 离线 ---------- */
  function online() {
    try { return navigator.onLine !== false; } catch (e) { return true; }
  }
  /* 监听网络变化，回调收到布尔值。返回取消函数。 */
  function watch(cb) {
    if (typeof window === 'undefined' || !window.addEventListener) return function () { };
    var last = online();
    function fire() {
      var now = online();
      if (now !== last) { last = now; try { cb(now); } catch (e) { } }
    }
    window.addEventListener('online', fire);
    window.addEventListener('offline', fire);
    return function () { window.removeEventListener('online', fire); window.removeEventListener('offline', fire); };
  }

  /* ---------- 错误自救 ---------- */
  /* 渲染崩了的时候塞进 #view 的卡片。三个出口：重试、导出数据、回滚。
   * 关键是"导出"——哪怕应用彻底坏了，用户还能把记录拿走。 */
  function rescueHTML(err) {
    var msg = (err && (err.message || err)) || '未知错误';
    var snaps = [];
    try { snaps = list().slice(0, 3); } catch (e) { }
    var snapBtns = snaps.length
      ? snaps.map(function (s) {
        return '<button class="btn sm ghost" data-act="snaprestore" data-d="' + U.esc(s.date) + '">' +
          '回到 ' + (window.U ? U.prettyDate(s.date) : s.date) + '</button>';
      }).join('')
      : '<div class="muted" style="font-size:12px">还没有可用的本地备份（每天首次进入会自动存一份）</div>';
    return '<div class="card" style="border-left:3px solid var(--danger)">' +
      '<div style="color:var(--danger)"><svg class="p-icon i-inline" aria-hidden="true"><use href="assets/icons.svg#shield-check"></use></svg></div>' +
      '<div style="font-weight:700;margin:6px 0">页面出了点问题</div>' +
      '<div class="muted" style="font-size:12px;word-break:break-all;margin-bottom:10px">' + U.esc(String(msg).slice(0, 200)) + '</div>' +
      '<div class="muted" style="font-size:13px;margin-bottom:10px">你的打卡记录还在本机，没丢。先导出一份留底，再重试。</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
      '<button class="btn sm" data-act="rescueexport">导出数据备份</button>' +
      '<button class="btn sm" data-act="rescueretry">重新加载</button>' +
      '</div>' +
      '<div style="margin-top:10px;font-size:12px" class="muted">或者回滚到早些时候：</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">' + snapBtns + '</div>' +
      '</div>';
  }

  return {
    snapshot, daily, list, restore, clear, init,
    online, watch, rescueHTML
  };
})();
