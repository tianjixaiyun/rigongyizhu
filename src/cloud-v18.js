/* WorkBuddy 官方 SDK 适配层。服务端 RPC 见 backend/001_cloud_sync.sql。 */
window.Cloud = (function () {
  'use strict';
  const CFG = Object.assign({
    endpoint: 'https://rigong-yizhu-habits.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_eH6NLcQs8Anku6XJkJhPSH_g1rRF2Kmeh42pEvcYtDIYEMMfrJG8sXi'
  }, window.RIGONG_CLOUD_CONFIG || {});
  let client, session = null, pending = null, ready = false, booting, authSubscribed = false;
  let backend = { state: 'unknown', at: 0, since: 0, err: '' }, probing, status = { state: 'off', msg: '' };
  let flight = null, timer = null, failures = 0, generation = 0;
  const listeners = [];
  function emit() { listeners.forEach(fn => { try { fn(api); } catch (e) { console.warn(e); } }); }
  function setStatus(state, msg = '') {
    if (status.state === state && status.msg === msg) return;
    status = { state, msg }; emit();
  }
  function humanError(e) {
    const m = String(e && e.message || e || '');
    if (/PGRST202|rigong_sync.*schema cache|function.*does not exist/i.test(m)) return '云同步数据库尚未安装，请在 WorkBuddy 原项目执行安装脚本';
    if (/failed to fetch|network|load failed|request failed before/i.test(m)) return '暂时连不上云服务，记录保留在本机';
    if (/abort|timeout/i.test(m)) return '云服务响应超时，稍后重试';
    if (/42501|permission denied|forbidden|403/i.test(m)) return '云端权限校验未通过，请在原 WorkBuddy 检查权限配置';
    if (/401|unauthenticated/i.test(m)) return '登录已过期，请重新登录';
    return m || '云服务请求失败';
  }
  async function boundedFetch(url, opt = {}) {
    const ctl = new AbortController(), abort = () => ctl.abort();
    if (opt.signal) { if (opt.signal.aborted) abort(); else opt.signal.addEventListener('abort', abort, { once: true }); }
    const timeout = setTimeout(abort, 30000);
    try { return await fetch(url, Object.assign({}, opt, { signal: ctl.signal })); }
    finally { clearTimeout(timeout); if (opt.signal) opt.signal.removeEventListener('abort', abort); }
  }
  /* cloud-sdk.js 有 62KB，和首屏、和"今天要做什么"一点关系都没有。
     原来它跟着 index.html 一起下载，纯粹是给启动流程添堵 —— 现在改成用到才加载：
     登录、同步、探活、上传附件，任何一个动作第一次碰到它时才去拉。 */
  let sdkLoading = null, sdkFailed = false;
  function loadSdk() {
    if (window.WorkBuddyCloud) return Promise.resolve();
    if (sdkLoading) return sdkLoading;
    sdkLoading = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'vendor/cloud-sdk.js?v=' + (window.RIGONG_VERSION || '');
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { sdkLoading = null; sdkFailed = true; reject(new Error('云服务组件下载失败，请检查网络')); };
      document.head.appendChild(el);
    });
    return sdkLoading;
  }
  async function sdk() {
    if (!client && !window.WorkBuddyCloud) await loadSdk();
    if (!client && window.WorkBuddyCloud) client = WorkBuddyCloud.createWorkBuddyCloud(Object.assign({}, CFG, { fetch: boundedFetch }));
    return client;
  }
  function signedIn() { return !!(session && session.user && session.user.id && !session.user.isAnonymous); }
  function uid() { return signedIn() ? session.user.id : ''; }
  /* 探活专用超时。普通请求用 30 秒（上传大附件需要耐心），但"这台服务器还在不在"
   * 不该等那么久：网关不通时浏览器会挂起十几秒，这段时间里界面会误显示"未登录"
   * 并给出登录按钮 —— 用户填完手机号却等不到验证码。收紧到 5 秒，让"连不上"
   * 尽快变成一个明确状态。
   * v42 · 走查第 11 条：原来 8 秒，叠加 SDK 下载和网关挂起，「正在检测」能停留
   * 十几秒。现在探活 5 秒封顶，UI 侧再看门狗 6 秒（见 ui.js 的 cloudCardHTML）。 */
  const PROBE_TIMEOUT = 5000;
  async function probe(force) {
    if (!force && Date.now() - backend.at < 30000) return backend.state;
    if (probing) return probing;
    probing = (async () => {
      probeArmed = true;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
      try {
        const r = await fetch(CFG.endpoint + '/.cloud/auth/v1/user/me', { headers: { 'x-wb-webapp-access-key': CFG.publishableKey }, cache: 'no-store', signal: controller.signal });
        if (!(r.headers.get('content-type') || '').includes('json') || ![200, 401].includes(r.status)) throw new Error('云服务配置或网关异常（HTTP ' + r.status + '）');
        backend = { state: 'up', at: Date.now(), since: Date.now(), err: '' };
      } catch (e) { backend = { state: 'down', at: Date.now(), since: Date.now(), err: humanError(e) }; }
      finally { clearTimeout(timer); }
      emit(); return backend.state;
    })().finally(() => { probing = null; });
    return probing;
  }
  function updateSession(next) {
    const before = uid(); session = next || null;
    if (before !== uid()) { plane = 'rpc'; generation++; clearTimeout(timer); timer = null; }
    setStatus(signedIn() ? 'signed' : 'off');
  }
  async function boot() {
    if (booting) return booting;
    booting = (async () => {
      try {
        const c = await sdk();
        if (!c) throw new Error('云服务组件未加载，请刷新重试');
        setStatus('loading', '正在连接云端…');
        if (!authSubscribed) {
          client.auth.onAuthStateChange((event, next) => { updateSession(next); if (ready && signedIn()) schedulePush(0); });
          authSubscribed = true;
        }
        const callback = await client.auth.handleWechatWebCallback();
        if (callback && callback.error) throw callback.error;
        const result = await client.auth.getSession();
        if (result && result.error) throw result.error;
        updateSession(result && result.data);
        await probe(true);
        if (backend.state === 'down') setStatus('down', backend.err);
        return session;
      } catch (e) { setStatus('error', humanError(e)); return null; }
      finally { ready = true; }
    })().finally(() => { booting = null; });
    return booting;
  }
  async function refresh() {
    const r = await (await sdk()).auth.getSession(); if (r.error) throw r.error;
    updateSession(r.data); return session;
  }
  async function signOut() {
    generation++; clearTimeout(timer); timer = null;
    const r = await (await sdk()).auth.signOut();
    if (r && r.error) throw new Error(humanError(r.error));
    updateSession(null); pending = null;
  }
  async function sendCode(phone) {
    if (!/^1\d{10}$/.test(phone)) throw new Error('请输入正确的 11 位手机号');
    const c0 = await sdk(); if (!c0) throw new Error('云服务组件未加载');
    const r = await client.auth.sendOtp({ phone });
    if (r.error) throw new Error(humanError(r.error));
    pending = Object.assign({ phone }, r.data); return true;
  }
  async function verifyCode(phone, token) {
    if (!pending || pending.phone !== phone) throw new Error('请先为当前手机号获取验证码');
    const r = await (await sdk()).auth.verifyOtp({ phone, token, verificationId: pending.verificationId, isExistingUser: pending.isExistingUser });
    if (r.error) throw new Error(humanError(r.error));
    pending = null; await refresh();
    if (!signedIn()) throw new Error('登录未完成，请重试');
    return session.user;
  }
  async function wechatLogin() {
    const r = await (await sdk()).auth.signInWithOAuth({ provider: 'wechat', redirectTo: location.origin });
    if (r.error) throw new Error(humanError(r.error));
    if (r.data && r.data.url) location.assign(r.data.url);
  }
  async function guard() {
    if (!signedIn() || !(await sdk())) throw new Error('请先登录');
    const owner = Store.s.settings.cloudAccountId;
    if (owner && owner !== uid()) throw new Error('本机记录属于另一个账号。请登录原账号；使用其他账号前先导出备份，并在另一浏览器中登录');
    if (!owner) Store.s.settings.cloudAccountId = uid();
    return { owner: uid(), generation };
  }
  function still(ctx) {
    if (ctx.owner !== uid() || ctx.generation !== generation) throw new Error('账号已变化，本次同步已停止');
  }
  async function rpc(name, args, ctx) {
    still(ctx); const result = await (await sdk()).database.rpc(name, args || {}); still(ctx);
    if (result.error) {
      /* humanError 会把消息翻译成人话，降级判断却需要原始英文错误
       * （PostgREST 的 "…in the schema cache"），所以一并带上。 */
      const err = new Error(humanError(result.error));
      err.raw = String(result.error.message || '');
      err.code = String(result.error.code || '');
      throw err;
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || row.owner_id !== ctx.owner || !Number.isSafeInteger(Number(row.revision))) throw new Error('云端账号或版本响应异常');
    if (row.payload) SyncModel.validate(row.payload);
    backend = { state: 'up', at: Date.now(), since: Date.now(), err: '' }; return row;
  }
  /* 仅缺失主 RPC 时使用同样校验账号和 revision 的兼容 RPC；从不直读未知权限的旧表。 */
  let plane = 'rpc';
  function missingFn(e) {
    return !!e && (e.code === 'PGRST202' || e.code === '42883') &&
      /(?:rigong_sync_pull|rigong_sync_push)/i.test(e.raw || '') &&
      /could not find|does not exist|schema cache/i.test(e.raw || '');
  }
  async function pullRemote(ctx) {
    let row;
    try { row = await rpc(plane === 'rpc' ? 'rigong_sync_pull' : 'rigong_sync_compat_pull', {}, ctx); }
    catch (e) {
      if (plane !== 'rpc' || !missingFn(e)) throw e;
      row = await rpc('rigong_sync_compat_pull', {}, ctx);
      plane = 'compat';
    }
    return { payload: row.payload || null, revision: Number(row.revision), at: Date.parse(row.updated_at) || 0 };
  }
  async function pushRemote(payload, remote, ctx) {
    const row = await rpc(plane === 'rpc' ? 'rigong_sync_push' : 'rigong_sync_compat_push',
      { p_revision: Number(remote.revision) || 0, p_payload: payload }, ctx);
    return { conflict: !!row.conflict, payload: row.payload || payload, revision: Number(row.revision) };
  }
  async function pullState() {
    const ctx = await guard(), r = await pullRemote(ctx);
    return r.payload ? { payload: r.payload, revision: Number(r.revision) || 0, at: r.at } : null;
  }
  async function mergePayload(payload) {
    await guard(); document.dispatchEvent(new CustomEvent('rigong:before-sync'));
    const n = SyncModel.merge(Store.s, payload);
    if (n) {
      Store.bump(); await Store.saveNow(); Store.emit();
      document.dispatchEvent(new CustomEvent('rigong:cloud-merged'));
    }
    return n;
  }
  function isFreshState() { return !!(Store.s._sync && Store.s._sync.pristine); }
  async function replace(payload) {
    SyncModel.validate(payload); await Store.saveRecovery();
    const local = Store.s, device = local.deviceId, settings = Object.assign({}, local.settings);
    const next = Object.assign({}, local, payload, { deviceId: device, settings: Object.assign(settings, payload.settings || {}) });
    await Store.importJSON(next, 'replace'); SyncModel.prepare(Store.s, false);
    return (payload.items || []).length;
  }
  async function restoreFromCloud() {
    const remote = await pullState(); if (!remote) throw new Error('云端还没有数据');
    return replace(remote.payload);
  }
  async function uploadPending(ctx) {
    if (Store.s.settings.cloudMedia === false) return;
    for (const [id, meta] of Object.entries(Store.s.media || {})) {
      if (meta.cloud) continue;
      still(ctx); const blob = await Store.getMedia(id, true);
      if (!blob) throw new Error('有附件仅存在原设备，请在原设备登录并同步');
      const path = await uploadMedia(id, blob, meta); still(ctx);
      if (Store.s.media[id] === meta) { meta.cloud = 1; meta.path = path; }
    }
  }
  async function runSync() {
    document.dispatchEvent(new CustomEvent('rigong:before-sync'));
    const ctx = await guard();
    if (navigator.onLine === false) throw new Error('当前离线，记录已保留，联网后继续同步');
    setStatus('loading', '正在同步…');
    let remote = await pullRemote(ctx), pulled = 0, restored = false;
    if (remote.payload && isFreshState()) { pulled = await replace(remote.payload); restored = true; }
    for (let attempt = 0; attempt < 5; attempt++) {
      still(ctx);
      if (remote.payload) pulled += await mergePayload(remote.payload);
      await uploadPending(ctx);
      const payload = SyncModel.payload(Store.s); await Store.saveNow(); still(ctx);
      if (SyncModel.canonical(payload) !== SyncModel.canonical(remote.payload)) {
        const res = await pushRemote(payload, remote, ctx);
        if (res.conflict) { remote = await pullRemote(ctx); continue; }
        remote = { payload: res.payload, revision: res.revision, at: Date.now() };
      }
      still(ctx); Store.s.settings.lastCloudAt = Date.now();
      await Store.saveNow(); failures = 0;
      setStatus('signed', '已同步 ' + U.hhmm(Store.s.settings.lastCloudAt));
      if (SyncModel.canonical(SyncModel.payload(Store.s)) !== SyncModel.canonical(remote.payload)) schedulePush();
      return { pulled, restored, at: Store.s.settings.lastCloudAt };
    }
    throw new Error('其他设备正在频繁修改，稍后会继续同步');
  }
  function syncNow() {
    if (flight) return flight;
    clearTimeout(timer); timer = null;
    flight = runSync().catch(e => {
      failures++; setStatus('error', humanError(e));
      if (failures < 8) schedulePush(Math.min(120000, 3000 * Math.pow(2, failures)));
      throw e;
    }).finally(() => { flight = null; }); return flight;
  }
  function automatic() { return signedIn() && Store.s && Store.s.settings.autoSync !== false; }
  function schedulePush(delay = 2500) {
    if (!automatic()) return;
    clearTimeout(timer);
    if (!failures) setStatus(flight ? 'loading' : 'pending', flight ? '正在同步…' : '本机有待同步记录');
    timer = setTimeout(() => { timer = null; if (automatic() && navigator.onLine !== false) syncNow().catch(() => {}); }, delay);
  }
  /* 云端对象名带正确扩展名：视频被写成 .jpg 会让部分 CDN 回错 Content-Type，播放器直接罢工 */
  function mediaExt(kind, mime) {
    const t = String(mime || '');
    if (t.indexOf('video/mp4') === 0) return '.mp4';
    if (t.indexOf('video/quicktime') === 0) return '.mov';
    if (t.indexOf('video/webm') === 0) return '.webm';
    if (t.indexOf('video/') === 0) return '.mp4';
    if (t.indexOf('audio/mp4') === 0) return '.m4a';
    if (t.indexOf('audio/') === 0) return '.webm';
    if (t.indexOf('image/png') === 0) return '.png';
    if (t.indexOf('image/') === 0) return '.jpg';
    if (kind === 'video') return '.mp4';
    if (kind === 'audio') return '.webm';
    return '.jpg';
  }
  function mediaPath(id, kind, mime) { return (client || {}).storage.userPath(uid(), 'media/' + id + mediaExt(kind, mime)); }
  async function uploadMedia(id, blob, meta) {
    const ctx = await guard(), path = mediaPath(id, meta && meta.kind, (meta && meta.mime) || (blob && blob.type));
    const r = await (await sdk()).storage.upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: true }); still(ctx);
    if (r.error) throw new Error(humanError(r.error)); return path;
  }
  async function findMedia(id) {
    await guard(); const meta = Store.s.media[id];
    return meta && meta.cloud ? Object.assign({}, meta, { path: meta.path || mediaPath(id, meta.kind, meta.mime) }) : null;
  }
  async function downloadMedia(id) {
    const ctx = await guard(), row = await findMedia(id); if (!row) return null;
    const r = await (await sdk()).storage.download(row.path); still(ctx);
    if (r.error) throw new Error(humanError(r.error)); return r.data;
  }
  async function signedUrl(id, ttl) {
    const ctx = await guard(), row = await findMedia(id); if (!row) return null;
    const r = await (await sdk()).storage.createSignedUrl(row.path, Math.min(ttl || 3600, 3600)); still(ctx);
    if (r.error) throw new Error(humanError(r.error)); return r.data && (r.data.signedUrl || r.data.url);
  }
  // 保留历史备份引用的云对象，附件删除只传播索引删除标记。
  async function deleteMedia() { await guard(); }
  async function listMedia() { await guard(); return Object.entries(Store.s.media).filter(([, x]) => x.cloud).map(([mid, x]) => Object.assign({ mid }, x)); }
  async function mediaUsage() { const list = await listMedia(); return { count: list.length, bytes: list.reduce((sum, x) => sum + (x.size || 0), 0) }; }
  async function wipeRemote() { throw new Error('云端清空需在 WorkBuddy 原项目审核执行；本次更新不自动删除云端备份'); }
  const api = {
    CFG, boot, refresh, signOut, sendCode, verifyCode, wechatLogin, probe, humanError,
    signedIn, uid, syncNow, pullState, mergePayload, isFreshState, restoreFromCloud,
    schedulePush, pushState: syncNow, uploadMedia, downloadMedia, signedUrl,
    deleteMedia, findMedia, mediaUsage, listMedia, wipeRemote,
    ensureSdk: async () => { try { return !!await sdk(); } catch (e) { return false; } },
    sdkLoaded: () => !!(window.WorkBuddyCloud || client),
    available: async () => { try { return !!await sdk(); } catch (e) { return false; } },
    usable: async () => { try { return !!await sdk() && backend.state === 'up'; } catch (e) { return false; } },
    db: async () => (await sdk()) && client.database, isReady: () => ready, backendState: () => backend,
    onChange: fn => listeners.push(fn), emit,
    get status() { return status; }, get session() { return session; }, get user() { return session && session.user; }
  };
  window.addEventListener('online', () => { failures = 0; schedulePush(0); });
  window.addEventListener('focus', () => schedulePush(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedulePush(0); });
  setInterval(() => { if (!document.hidden && automatic()) syncNow().catch(() => {}); }, 60000);
  /* v42 · 走查第 11 条：探活看门狗。
   * probe() 自己有 5 秒超时，但它要等 boot() 把 62KB 的 SDK 拉下来才会被调用 ——
   * SDK 下载卡住时，「正在检测」能赖在屏幕上十几秒。这里补一道：只要真的探过
   * （probeArmed，不给不碰云的人白发请求）却还停在 unknown 超过 6 秒，就自己再探一次。
   * 探活是一次裸 fetch，不等 SDK，所以 SDK 卡住时它照样能跑。 */
  let probeArmed = false, lastKick = 0;
  setInterval(() => {
    if (!probeArmed || probing || backend.state !== 'unknown') return;
    if (Date.now() - (backend.since || 0) < 6000 || Date.now() - lastKick < 10000) return;
    lastKick = Date.now();
    probe(true).catch(() => { });
  }, 2000);
  return api;
})();
