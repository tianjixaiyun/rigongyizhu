/* ============ WebDAV 备份（v27 · 4.6）============
 * 对标 mhabit 的 "WebDAV Sync — Own Your Data"。
 * 定位：给「不想注册账号」的用户第二条同步/备份通道 —— 把备份放进自己的
 * Nextcloud / 群晖 / 支持 WebDAV 的网盘，换设备时从同一个文件恢复。
 *
 * 三条设计底线（都是用户能感知的）：
 * ①  只备份「文字数据」（习惯、打卡、日记、备注）。照片语音体积大且要 base64，
 *     放进 WebDAV 会让一次上传拖到几分钟，所以明确不备，UI 里说清楚。
 * ②  绝不静默覆盖。上传前先看远端：如果这份文件是别的设备写的、而且比我们
 *     上次见过的更新，就返回 conflict，让用户选「用网盘的」还是「保留本机的」。
 * ③  浏览器跨域是硬限制。很多网盘（典型如坚果云）不给网页发 CORS 头，
 *     这时必须明说「这个网盘不让网页直连」，而不是甩一个 "Failed to fetch"。
 */
window.WebDAV = (function () {
  const LATEST = 'latest.json';                 // 永远被覆盖的那份：恢复从这里读
  const HIST_PREFIX = 'rigongyizu-';            // 带时间戳的历史备份：永不覆盖
  const TIMEOUT = 30000;

  function cfg() { return (Store.s && Store.s.settings.webdav) || null; }
  function has() { return !!cfg(); }

  /* 设备标识：区分「这份远端备份是我写的还是别的设备写的」 */
  function deviceId() {
    let c = cfg();
    if (!c) return '';
    if (!c.deviceId) {
      c.deviceId = U.uid('dev');
      Store.commit(s => { s.settings.webdav.deviceId = c.deviceId; });
    }
    return c.deviceId;
  }

  /* ---------------- 地址处理 ----------------
   * 用户填的是「根地址 + 目录」，拼出来的文件地址要把每一段分别编码：
   * 目录名带中文很常见（「日拱一卒备份」），整条编码会把 / 也编掉。 */
  function seg(u, name) {
    const base = String(u || '').replace(/\/+$/, '');
    const dir = String(name || '').replace(/^\/+|\/+$/g, '');
    if (!dir) return base + '/';
    return base + '/' + dir.split('/').filter(Boolean).map(encodeURIComponent).join('/') + '/';
  }
  function fileUrl(name) {
    const c = cfg();
    return seg(c.url, c.dir) + encodeURIComponent(name);
  }
  function authHeader() {
    const c = cfg();
    const raw = (c.user || '') + ':' + (c.pass || '');
    try { return 'Basic ' + btoa(unescape(encodeURIComponent(raw))); }
    catch (e) { return 'Basic ' + btoa(raw); }
  }

  /* 把 fetch 的失败翻译成用户能懂的话。
   * 浏览器里跨域被拒和「网盘挂了」长得一模一样（都是 TypeError），
   * 但原因和解决办法完全相反，必须分开说。 */
  function explain(method, url, status, err) {
    if (err && (err.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(String(err.message || err)))) {
      return {
        ok: false, code: 'cors',
        msg: '连不上这个网盘。最常见的原因是<b>它不允许网页直接访问</b>（浏览器的安全限制），' +
          '并不是密码错了。<br>可以换成 Nextcloud、群晖 DSM 这类支持网页直连的服务再试；' +
          '不方便换的话，用「导出备份」存一份 JSON 也一样安全。'
      };
    }
    if (status === 401 || status === 403) {
      return { ok: false, code: 'auth', msg: '网盘说账号或密码不对。多数网盘要用「应用密码 / 授权码」，不要用登录密码。' };
    }
    if (status === 404) {
      return { ok: false, code: '404', msg: '地址不存在。检查一下：服务器地址、目录名有没有写错（目录要已经建好）。' };
    }
    if (status === 405) return { ok: false, code: '405', msg: '这个地址不接受 ' + method + ' 请求，可能目录路径少写了一级。' };
    if (status === 409) return { ok: false, code: '409', msg: '目录不存在，网盘拒绝了写入。请先在网盘里把这个文件夹建好。' };
    if (status >= 500) return { ok: false, code: status, msg: '网盘服务器出错（' + status + '），过一会儿再试。' };
    return { ok: false, code: status || 'net', msg: '操作失败（' + (status || '网络错误') + '）。' };
  }

  async function req(method, url, body, headers) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    let res = null, err = null;
    try {
      res = await fetch(url, {
        method: method,
        headers: Object.assign({ 'Authorization': authHeader() }, headers || {}),
        body: body === undefined ? undefined : body,
        signal: ctl.signal,
        credentials: 'omit'
      });
    } catch (e) { err = e; }
    clearTimeout(timer);
    if (err) {
      if (err.name === 'AbortError') return { ok: false, code: 'timeout', msg: '等太久了，网盘没回应。' };
      return explain(method, url, 0, err);
    }
    if (!res.ok) {
      /* HTTP 有响应但状态码不对（401/404/409/500…）：也要翻译成人话。
       * 以前这里只把 status 抛出去，上层再包一层「连不上」，
       * 用户看到的永远是同一句话，压根不知道该改密码还是该建目录。 */
      const e = explain(method, url, res.status, null);
      return { ok: false, status: res.status, code: e.code, msg: e.msg, res: res };
    }
    return { ok: true, status: res.status, res: res };
  }

  /* ---------------- 连接检测 ----------------
   * 用 PROPFIND 问一句「这个目录在吗」，比真的传一份文件轻得多，
   * 配置时点「测试连接」用，用户改完地址也能立刻验证。 */
  async function probe() {
    if (!has()) return { ok: false, code: 'nocfg', msg: '还没配置网盘。' };
    const c = cfg();
    const url = seg(c.url, c.dir);
    const r = await req('PROPFIND', url, undefined, { 'Depth': '0' });
    if (!r.ok) {
      /* 有的服务只开 PUT 不开 PROPFIND，退回用 HEAD 问一次。
       * 两次都失败时用第二次的结论说活：PROPFIND 被禁不算真错。 */
      const h = await req('HEAD', url);
      if (h.ok) return { ok: true, via: 'head' };
      return h.msg ? h : { ok: false, code: h.code, msg: h.msg || '连不上。' };
    }
    return { ok: true, via: 'propfind' };
  }

  /* ---------------- 备份内容 ----------------
   * 只导文字：照片语音不进 WebDAV（见文件头 ①）。
   * schema/version 用来在恢复时判断「这份备份是不是本产品写的」。 */
  async function buildBackup() {
    const data = await Store.exportJSON(false);
    const d = new Date();
    const pad = n => ('0' + n).slice(-2);
    return JSON.stringify({
      app: '日拱一卒',
      kind: 'webdav-backup',
      schema: 1,
      savedAt: Date.now(),
      deviceId: deviceId(),
      device: (navigator.userAgent || '').slice(0, 120),
      habits: (data.state.items || []).filter(i => !i.deleted).length,
      days: Object.keys(data.state.logs || {}).length,
      stamp: d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()),
      data: data
    });
  }

  /* 远端最新那份的「身份证」：谁写的、什么时候写的。
   * 同时把内层数据取出来备用 —— 网盘上是「我们包的壳」（多带 savedAt/deviceId 便于判断），
   * 而 Store.importJSON 认的是「内层那份导出 JSON」。两边的形状必须在这里对上，
   * 否则恢复时会报「这不是日拱一卒的数据备份」，而用户明明刚备份过。 */
  async function readRemoteMeta() {
    const r = await req('GET', fileUrl(LATEST));
    if (!r.ok) {
      if (r.status === 404) return { ok: true, exists: false };
      return { ok: false, msg: r.msg || '读不到网盘上的备份。' };
    }
    let txt = '';
    try { txt = await r.res.text(); } catch (e) { return { ok: false, msg: '网盘返回的内容读不出来。' }; }
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { return { ok: true, exists: true, foreign: true, raw: txt.slice(0, 200) }; }
    if (!j || j.kind !== 'webdav-backup' || !j.data) {
      return { ok: true, exists: true, foreign: true, raw: txt.slice(0, 200) };
    }
    return {
      ok: true, exists: true,
      savedAt: j.savedAt || 0,
      deviceId: j.deviceId || '',
      habits: j.habits, days: j.days,
      bytes: txt.length,
      text: JSON.stringify(j.data),      // 内层：给 Store.importJSON 用
      wrapper: txt                        // 外壳：排查问题时才能看清是谁写的
    };
  }

  /* ---------------- 冲突判断 ----------------
   * 「静默覆盖」是备份功能最伤人的 bug：两台设备各写各的，后上传的那台
   * 把另一台几周的打卡抹掉，而用户毫无知觉。
   * 判据：远端那份是别的设备写的，而且诞生时间晚于我们最后一次「见过它」。
   * 自己写的重复上传不冲突（覆盖自己的旧版是应该的）。 */
  async function checkConflict() {
    const c = cfg();
    const meta = await readRemoteMeta();
    if (!meta.ok) return meta;
    if (!meta.exists) return { ok: true, conflict: false, meta: meta };
    const mine = meta.deviceId && meta.deviceId === deviceId();
    /* 没见过远端（刚配置、或从没下载过）→ 不猜，按「有冲突」处理更安全：
     * 用户第一次上传前会被问一次，之后就有基线了。 */
    if (!c.seenRemoteAt) {
      if (mine) return { ok: true, conflict: false, meta: meta };
      return { ok: true, conflict: true, reason: 'unseen', meta: meta };
    }
    if (mine) return { ok: true, conflict: false, meta: meta };
    if (meta.savedAt > (c.seenRemoteAt || 0)) return { ok: true, conflict: true, reason: 'newer', meta: meta };
    return { ok: true, conflict: false, meta: meta };
  }

  /* ---------------- 上传 ----------------
   * 同时写两份：latest.json（恢复用，可被覆盖）+ 一份带时间戳的历史文件（不覆盖）。
   * 历史文件是「上周的记录被新版冲掉了」时的退路，成本只是一次 PUT。 */
  async function upload(opt) {
    opt = opt || {};
    if (!has()) return { ok: false, msg: '还没配置网盘。' };
    const chk = await checkConflict();
    if (!chk.ok) return chk;
    if (chk.conflict && !opt.force) {
      return {
        ok: false, conflict: true, meta: chk.meta, reason: chk.reason,
        msg: '网盘上有一份更新的备份（来自另一台设备）。要保留哪一份？'
      };
    }
    const text = await buildBackup();
    const c = cfg();
    const d = new Date();
    const pad = n => ('0' + n).slice(-2);
    const histName = HIST_PREFIX + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
    const put = async (name) => {
      const r = await req('PUT', fileUrl(name), text, { 'Content-Type': 'application/json' });
      return r;
    };
    const a = await put(LATEST);
    if (!a.ok) return { ok: false, msg: a.msg || '上传失败。' };
    let histOk = true;
    if (!opt.skipHistory) {
      const b = await put(histName);
      histOk = !!b.ok;
    }
    Store.commit(s => {
      s.settings.webdav.lastUploadAt = Date.now();
      s.settings.webdav.lastUploadBytes = text.length;
      s.settings.webdav.lastHistName = HIST_PREFIX + histName;
      s.settings.webdav.seenRemoteAt = Date.now();
      s.settings.webdav.lastError = '';
    });
    if (typeof Engine !== 'undefined' && Engine.bustCache) Engine.bustCache();
    return { ok: true, bytes: text.length, history: histOk, name: histName };
  }

  /* ---------------- 恢复 ---------------- */
  async function pull() {
    if (!has()) return { ok: false, msg: '还没配置网盘。' };
    const meta = await readRemoteMeta();
    if (!meta.ok) return meta;
    if (!meta.exists) return { ok: false, msg: '网盘上还没有备份，先在这台设备上传一次。' };
    if (meta.foreign) return { ok: false, msg: '网盘上那个文件不是本产品写的，不敢动它。' };
    return { ok: true, text: meta.text, meta: meta };
  }

  /* 看过远端就把「见过的时间」记下来：这是后续冲突判断的基线 */
  function markSeen() {
    Store.commit(s => { s.settings.webdav.seenRemoteAt = Date.now(); });
  }

  /* 恢复指定的一份历史备份（用户在列表里点「恢复这份」） */
  async function pullNamed(name) {
    if (!has()) return { ok: false, msg: '还没配置网盘。' };
    if (!/^[A-Za-z0-9._-]+$/.test(String(name))) return { ok: false, msg: '文件名不太对，不敢读。' };
    const r = await req('GET', fileUrl(name));
    if (!r.ok) {
      if (r.status === 404) return { ok: false, msg: '网盘上没有这个文件了。' };
      return { ok: false, msg: r.msg || '读不到这份备份。' };
    }
    let txt = '';
    try { txt = await r.res.text(); } catch (e) { return { ok: false, msg: '内容读不出来。' }; }
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { return { ok: false, msg: '这个文件不是本产品写的备份。' }; }
    if (!j || j.kind !== 'webdav-backup' || !j.data) return { ok: false, msg: '这个文件不是本产品写的备份。' };
    return { ok: true, text: JSON.stringify(j.data) };
  }

  /* ---------------- 历史备份列表 ----------------
   * PROPFIND 拿文件名和大小，让用户能看到「我到底有哪些备份」。 */
  async function list() {
    if (!has()) return { ok: false, msg: '还没配置网盘。' };
    const c = cfg();
    const r = await req('PROPFIND', seg(c.url, c.dir), undefined, { 'Depth': '1' });
    if (!r.ok) return { ok: false, msg: r.msg || '读不到目录。' };
    let xml = '';
    try { xml = await r.res.text(); } catch (e) { return { ok: false, msg: '目录内容读不出来。' }; }
    const out = [];
    const re = /<d:href>([^<]+)<\/d:href>([\s\S]*?)<\/d:response>/g;
    let m;
    while ((m = re.exec(xml))) {
      const href = decodeURIComponent(m[1].replace(/^https?:\/\/[^/]+/, ''));
      const name = href.split('/').filter(Boolean).pop() || '';
      if (!name || name === decodeURIComponent(c.dir || '')) continue;
      const size = /<d:getcontentlength>(\d+)</.exec(m[2]);
      const mod = /<d:getlastmodified>([^<]+)</.exec(m[2]);
      out.push({ name: name, bytes: size ? +size[1] : 0, when: mod ? mod[1] : '' });
    }
    out.sort((a, b) => (b.when || '').localeCompare(a.when || ''));
    return { ok: true, files: out.filter(f => /\.json$/i.test(f.name)) };
  }

  /* ---------------- 配置 ----------------
   * 存之前先测通：用户最恨的不是失败，是"保存成功"之后才发现地址写错。 */
  async function save(next) {
    const c = Object.assign({}, cfg() || {}, next || {});
    c.url = String(c.url || '').trim().replace(/\s+/g, '');
    c.dir = String(c.dir || '日拱一卒备份').trim();
    c.user = String(c.user || '').trim();
    if (!/^https?:\/\//i.test(c.url)) return { ok: false, msg: '服务器地址要以 http:// 或 https:// 开头。' };
    if (!c.user) return { ok: false, msg: '填一下网盘的用户名。' };
    if (!c.pass) return { ok: false, msg: '填一下网盘的密码（多数网盘要用「应用密码」）。' };
    /* 用临时配置探一次，通过才落库 */
    const prev = cfg();
    Store.commit(s => { s.settings.webdav = c; });
    const r = await probe();
    if (!r.ok) {
      Store.commit(s => { s.settings.webdav = prev; });   // 不留一份连不上的配置误导用户
      return r;
    }
    return { ok: true, via: r.via };
  }

  function clear() {
    Store.commit(s => { s.settings.webdav = null; });
  }

  /* ---------------- 每天自动备份一次 ----------------
   * 判据是「日期」而不是时间间隔：用户的预期是"一天一份"，
   * 隔 12 小时传一次会莫名其妙地多出好几份。 */
  async function autoTick(opt) {
    opt = opt || {};
    const c = cfg();
    if (!c || !c.url) return { ok: false, skipped: true };
    if (opt.force) { /* 手动点「立即备份」不走日期判断 */ }
    else {
      const today = U.today();
      if (c.lastAutoDay === today) return { ok: false, skipped: true };
      const items = (Store.s.items || []).filter(i => !i.deleted);
      if (!items.length) return { ok: false, skipped: true };
    }
    const r = await upload({ skipHistory: false });
    if (r.ok) {
      Store.commit(s => { s.settings.webdav.lastAutoDay = U.today(); });
      if (opt.toast !== false) toast('已自动备份到网盘');
      return r;
    }
    if (r.conflict) return r;                       // 冲突留给 UI 问，不能自动二选一
    Store.commit(s => { if (s.settings.webdav) s.settings.webdav.lastError = String(r.msg || '').slice(0, 200); });
    return r;
  }

  return {
    has: has, cfg: cfg, probe: probe, upload: upload, pull: pull, pullNamed: pullNamed,
    list: list, save: save, clear: clear, autoTick: autoTick, markSeen: markSeen,
    checkConflict: checkConflict, buildBackup: buildBackup,
    LATEST: LATEST, HIST_PREFIX: HIST_PREFIX
  };
})();
