/* ============ 存储层：IndexedDB（大容量 / 持久化）+ 导入导出 ============ */
window.Store = (function () {
  const DB = 'rigongyizhu', VER = 1;
  let db = null, ready = false;
  /* v52 · 报告 P0-1：`ready` 只表示「有个 state 能用了」，不等于「真数据读完了」——
   * initSync() 从 localStorage 快照造出来的空 state 也会让它变 true。
   * 于是首帧 render() 会照着这个空 state 渲染出「还没有习惯 / 从备份恢复」，
   * 有数据的用户刷新时先看到一次「数据丢了」，慌乱里点「从备份恢复」就会导入重复习惯。
   * hydrated 只在 IndexedDB 真的读完（或确认读不到）之后才置 true，
   * UI 用 isHydrated() 区分「确实空」和「还没读完」。 */
  let hydrated = false;

  function open() {
    return new Promise((res, rej) => {
      if (db) return res(db);
      const rq = indexedDB.open(DB, VER);
      rq.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media');
      };
      rq.onsuccess = e => { db = e.target.result; res(db); };
      rq.onerror = e => rej(e.target.error);
    });
  }
  function tx(store, mode) { return open().then(d => d.transaction(store, mode).objectStore(store)); }
  function idbPut(store, k, v) {
    return tx(store, 'readwrite').then(os => new Promise((res, rej) => {
      // 请求成功之后事务仍可能回滚，必须等事务完成才报告保存成功。
      const transaction = os.transaction;
      transaction.oncomplete = () => res(true);
      transaction.onerror = () => rej(transaction.error || new Error('存储事务失败'));
      transaction.onabort = () => rej(transaction.error || new Error('存储事务已取消'));
      os.put(v, k);
    }));
  }
  function idbGet(store, k) {
    return tx(store, 'readonly').then(os => new Promise((res, rej) => {
      const r = os.get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  }
  function idbKeys(store) {
    return tx(store, 'readonly').then(os => new Promise((res, rej) => {
      const r = os.getAllKeys(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    }));
  }
  function idbDel(store, k) {
    return tx(store, 'readwrite').then(os => new Promise((res, rej) => {
      const r = os.delete(k); r.onsuccess = () => res(true); r.onerror = () => rej(r.error);
    }));
  }

  /* ---------- 默认状态 ---------- */
  const PALETTE = ['#4f6bed', '#1D9E75', '#BA7517', '#378ADD', '#7F77DD', '#D4537E', '#E05252', '#0f9b8e'];
  function palette() { return PALETTE.slice(); }

  function defaultState() {
    const roomId = U.uid('room');
    const now = Date.now();
    /* v24 起全新用户拿到的是真正的空状态，而不是 4 个被渲染成「自己习惯」的预置示例
     * （评审实测：干净浏览器打开就看到「全部 4 / 0/4 / 连续 0 天」，引导却写「先建第 1 个习惯」，
     * 两处自相矛盾）。示例通过首次引导的「先用推荐的 4 个」按需建立。 */
    return {
      version: 7,
      deviceId: U.uid('dev'),
      activeRoomId: roomId,
      rooms: [{ id: roomId, name: '我的房间', createdAt: now, updatedAt: now, deleted: false }],
      items: [],
      bundles: [],
      logs: {},
      notes: {},
      moods: {},
      /* 健康数据缓存（v47 · 自动勾选的数据底座）：{at: 上次导入时间, days: {steps: {'2026-10-26': 9231}}}
       * 只留按天的汇总值，原始记录不落库 —— export.xml 动辄几百 MB。 */
      health: null,
      /* 用户手动取消过自动打卡的日子：{'日期|习惯id': 1}。有这个标记就不再自动勾回来。 */
      autoVeto: {},
      buddy: null,        // 搭子（v32 · 4.7）：{code, token, habitId, nick, peer, ...}
      buddyLeave: null,   // 没删成功就留一张待删条，联网后补删
      rewards: [
        { id: U.uid('rw'), name: '看一集剧', cost: 50, emoji: '📺', createdAt: now },
        { id: U.uid('rw'), name: '一杯奶茶', cost: 120, emoji: '🧋', createdAt: now },
        { id: U.uid('rw'), name: '半日休息', cost: 400, emoji: '🛋️', createdAt: now }
      ],
      redemptions: [],
      sessions: [],
      members: [],
      media: {},          // id -> {kind:'photo'|'audio', date, ts, size, mime, cloud, path}
      routines: [],       // 例程（习惯链）：{id,name,slot,itemIds,on}
      capsules: [],       // 时间胶囊：{id,text,openAt,createdAt,seenAt}
      todos: [],          // 待办（一次性任务）：{id,title,note,due,priority,done,doneAt,subtasks[],...}
      challenges: [],     // 引导式挑战：{id,key,name,emoji,days,habitId,startedAt,doneDates{},doneAt,reward}
      timer: null,        // 习惯计时器（时长型习惯）：{itemId,date,startAt,accum,running}
      settings: {
        theme: 'system', remindEnabled: false, groupBySlot: false, nickname: '',
        autoBackup: false, lastBackupAt: 0, seedPts: 0, pomoLen: 25, breakLen: 5,
        habitGroups: false,   // 习惯页：按领域/标签分组显示
        colorBlind: false,    // 色盲友好模式：红绿语义色换成蓝橙（v20）
        fontScale: 'normal',  // 字号缩放：normal / large（v20）
        weekStart: 1,         // 一周从周几开始：1=周一（默认）/ 0=周日（走查第 12 条）
        /* 隐私锁（v46 · 对标 Habitify 的 Privacy Lock）
         * 只存 PBKDF2 派生结果，不存 PIN；lockScope: 'all'=启动就锁 / 'diary'=只在日记页锁。 */
        lockScope: 'all',
        celebrated: [],        // 已庆祝过的全站连续里程碑档（3/7/14/21/30/50/100），记这里就不会重复弹（走查第 6 条）
        lastWeeklyTip: '',    // 周一「上周周报」toast 已提示过的日期（v20）
        /* 上次使用本应用的网站地址。
         * 浏览器的数据是按"网站地址"隔离的 —— 应用换个网址部署，新地址上就是一份
         * 全新的空数据，老记录还在旧地址下。记住这一项，才能在搬家和导入时提醒用户。 */
        lastOrigin: '',
        movedHintOff: 0,      // 关掉「应用换了网址」提示
        backupHintOff: 0,     // 关掉「该备份了」提示
        /* 回归模式（v28 · 4.3）：记住上次打开是哪天。
         * 离开 3 天以上再回来，首页换成一页「重启」，而不是一屏零。 */
        lastOpenDay: '',
        restartFor: '',       // 重启页只出现一次：记下已经展示过的日期
        /* 断签预警（v28 · 4.2）：当天结束前 3 小时提醒「还差几个」 */
        nudge: null,          // null = 用默认 {on:true, at:'21:00'}
        repairMonth: '',      // 本月是否已经用过「断签修复」
        /* 云空间 */
        cloudMedia: true,     // 照片语音上传到云端
        keepThumb: true,      // 本机只留小缩略图（关闭后本机 0 占用）
        autoSync: true,       // 有改动自动同步到云
        lastCloudAt: 0,
        plugins: {}           // 插件配置（webhook / 日历 / 定时汇报）
      }
    };
  }

  /* ---------- 内存态 ---------- */
  let state = null;
  const listeners = [];
  const thumbCache = new Map();     // 媒体 id -> objectURL（缩略图）
  function dropThumb(id) {
    if (thumbCache.has(id)) { try { URL.revokeObjectURL(thumbCache.get(id)); } catch (e) { } thumbCache.delete(id); }
  }

  /* 追踪「本机新增媒体字节」，用于按真实增速估算空间可用年数 */
  function trackMedia(bytes) {
    if (!state) return;
    state.mediaStats = state.mediaStats || { added: 0, since: Date.now() };
    state.mediaStats.added += bytes || 0;
  }

  /* 缩略图：只为「秒开」服务，一张约 30–60KB */
  async function makeThumb(blob, max) {
    if (!blob || String(blob.type || '').indexOf('image') !== 0) return null;
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, (max || 480) / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.62));
    } catch (e) { return null; }
  }

  /* 视频封面：浏览器里没有 ffmpeg，用 <video> + canvas 抽一帧。
   * 取 0.1 秒处（或总长的 1/10）——开场第一帧经常是纯黑，抽出来是一块黑板。
   * 任何一步失败都返回 null，由 UI 降级成 ▶ 占位；绝不因为抽帧失败就拒绝存视频。 */
  async function videoPoster(blob, max) {
    if (!blob || String(blob.type || '').indexOf('video') !== 0) return null;
    if (typeof document === 'undefined' || !document.createElement) return null;
    let url = null, v = null;
    try {
      url = URL.createObjectURL(blob);
      v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
      const meta = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('读视频超时')), 12000);
        v.onloadedmetadata = () => { clearTimeout(t); res({ w: v.videoWidth || 0, h: v.videoHeight || 0, dur: v.duration || 0 }); };
        v.onerror = () => { clearTimeout(t); rej(new Error('视频无法解码')); };
      });
      const dur = Math.round((meta.dur || 0) * 10) / 10;
      const at = Math.max(0, Math.min(0.1, (meta.dur || 0) / 10));
      await new Promise(res => {
        const t = setTimeout(res, 3000);
        v.onseeked = () => { clearTimeout(t); res(); };
        try { v.currentTime = at; } catch (e) { clearTimeout(t); res(); }
      });
      const w = meta.w || 640, h = meta.h || 360;
      const scale = Math.min(1, (max || 640) / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const cover = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.7));
      if (!cover) return null;
      return { blob: cover, w: w, h: h, dur: dur };
    } catch (e) {
      return null;
    } finally {
      try { if (v) { v.removeAttribute('src'); if (v.load) v.load(); } } catch (e) { }
      try { if (url) URL.revokeObjectURL(url); } catch (e) { }
    }
  }

  /* 数据版本号：一有写入就 +1，统计缓存据此失效 */
  let rev = 0;
  let saveWarning = false;
  let lastSaveAt = 0;
  let saveStatus = { state: 'idle', at: 0 };
  function reportSave(status, at) {
    saveStatus = { state: status, at: at || saveStatus.at || 0 };
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent('rigong:save-status', { detail: saveStatus }));
    }
  }
  const BACKUP_KEY = 'rigongyizhu.state';
  function readFallback() {
    try { return JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function warnSave(message) {
    console.warn(message);
    if (!saveWarning) { saveWarning = true; U.toast(message); }
  }

  // 旧备份缺字段时补齐默认设置；拒绝明显损坏的文件，先验证再改内存。
  const ARRAY_KEYS = ['items', 'bundles', 'rewards', 'redemptions', 'sessions', 'members', 'rooms', 'routines', 'capsules', 'todos', 'challenges'];
  const RECORD_KEYS = ['logs', 'notes', 'moods', 'media', 'settings', 'checkRewards', 'freezes', 'achievements', 'decor'];
  function record(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function validateState(src) {
    if (!record(src) || (!Array.isArray(src.items) && !record(src.logs))) throw new Error('这不是日拱一卒的数据备份');
    function safe(value, depth) {
      if (depth > 60) throw new Error('备份层级过深');
      if (!value || typeof value !== 'object') return;
      for (const key of Object.keys(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('备份包含不支持的字段');
        safe(value[key], depth + 1);
      }
    }
    safe(src, 0);
    for (const key of ARRAY_KEYS) {
      if (src[key] != null && (!Array.isArray(src[key]) || src[key].some(x => !record(x) || typeof x.id !== 'string'))) {
        throw new Error('备份中的「' + key + '」格式不正确');
      }
    }
    for (const key of RECORD_KEYS) if (src[key] != null && !record(src[key])) throw new Error('备份中的「' + key + '」格式不正确');
    for (const day of Object.values(src.logs || {})) {
      if (!record(day) || Object.values(day).some(log => !record(log) || (log.v != null && !Number.isFinite(log.v)))) {
        throw new Error('备份中的打卡记录格式不正确');
      }
    }
    for (const note of Object.values(src.notes || {})) if (!record(note)) throw new Error('备份中的日记格式不正确');
    return src;
  }
  function normalized(src) {
    const defaults = defaultState();
    const next = Object.assign(defaults, src);
    next.settings = Object.assign({}, defaultState().settings, src.settings || {});
    return next;
  }

  const api = {
    palette,
    get s() { return state; },
    get rev() { return rev; },
    get saveStatus() { return Object.assign({}, saveStatus); },
    /* 外部改了 state（如云端合并）时手动让缓存失效 */
    bump() { rev++; if (window.Engine && Engine.bustCache) Engine.bustCache(); },
    onChange(fn) { listeners.push(fn); },
    emit() { listeners.forEach(f => { try { f(state); } catch (e) { console.warn(e); } }); },

    /* 数据第一次落地时，把"所属网址"确定下来。
     * 只在 lastOrigin 为空时写 —— 已有值说明这份数据是从别处来的，必须保留原值，
     * 否则跨地址搬家的痕迹会被抹掉。 */
    _stampOrigin() {
      try {
        if (state && state.settings && !state.settings.lastOrigin) state.settings.lastOrigin = location.origin;
      } catch (e) { }
    },

    /* 同步初始化：先让界面能画出来，IndexedDB 稍后接管 */
    initSync() {
      let loaded = null;
      try {
        const old = localStorage.getItem('rigongyizhu.state');
        if (old) loaded = JSON.parse(old);
      } catch (e) { }
      state = loaded && loaded.version ? Object.assign(defaultState(), loaded) : defaultState();
      /* v52 · 报告 P2-11：init() 里有逐字段补齐，initSync 没有 ——
       * 老用户升级后首帧读到的是旧快照，新版本新增的 settings 字段全是 undefined，
       * 在 init() 回来之前就可能抛错（或在首帧把默认值当成"用户关掉了"）。
       * 这里补上同一套兜底，两处口径保持一致。 */
      const d0 = defaultState();
      for (const k in d0) if (state[k] == null) state[k] = d0[k];
      for (const k in d0.settings) if (state.settings[k] == null) state.settings[k] = d0.settings[k];
      api._stampOrigin();
      if (window.SyncModel) SyncModel.prepare(state, !loaded);
      ready = true;
      return state;
    },

    async init() {
      let loaded = null;
      try { loaded = await idbGet('kv', 'state'); } catch (e) { console.warn('IDB 读取失败', e); }
      const fallback = readFallback();
      if (fallback && fallback.version && (!loaded || (fallback.__savedAt || 0) > (loaded.__savedAt || 0))) loaded = fallback;
      if (!loaded) {
        // 兼容：从 localStorage 迁移旧数据
        try {
          const old = localStorage.getItem('rigongyizhu.state');
          if (old) loaded = JSON.parse(old);
        } catch (e) { }
      }
      const base = state || defaultState();
      state = loaded && loaded.version ? Object.assign(defaultState(), loaded) : Object.assign(defaultState(), base);
      // 补齐缺失字段
      const d = defaultState();
      for (const k in d) if (state[k] == null) state[k] = d[k];
      for (const k in d.settings) if (state.settings[k] == null) state.settings[k] = d.settings[k];
      if (!Array.isArray(state.bundles)) state.bundles = [];
      if (!state.media) state.media = {};
      api._stampOrigin();     // 字段补齐后再确立所属网址（已有值不动）
      if (window.SyncModel) SyncModel.prepare(state, !loaded);
      ready = true;
      /* 整份 state 被换掉了，必须让版本号往前走一步：
       * Engine 的统计缓存是「版本号 + 3 秒 TTL」，不 bump 的话，
       * initSync 那一次空 render 算出来的空结果会被继续复用 3 秒 ——
       * 启动时的 URL 命令、漏提醒判断都会读到空数据（表现为「没有这个习惯」）。 */
      api.bump();
      /* 真数据到位（或确认读不到）—— 从这里开始「空」才是真空 */
      hydrated = true;
      // 申请持久化存储（避免浏览器在磁盘紧张时清掉数据）
      api.requestPersistent();
      return state;
    },
    /* 数据是否已经从 IndexedDB 落定。false 时界面不该说「还没有习惯」 */
    isHydrated() { return hydrated; },

    async requestPersistent() {
      try {
        if (navigator.storage && navigator.storage.persist) {
          const has = await navigator.storage.persisted();
          if (!has) await navigator.storage.persist();
        }
      } catch (e) { }
    },

    /* 任何写入都先让统计缓存失效（rev++），落盘本身再防抖 */
    save() { if (window.SyncModel) SyncModel.observe(state); rev++; reportSave('pending'); if (api._doSave) api._doSave(); },

    /* 真正的落盘动作放在 _doSave（防抖 260ms）：IndexedDB 用结构化克隆存快照，
       不必再在主线程做一次全量 JSON 深拷贝（数据大时那一步很卡） */
    _doSave: null,

    saveNow() {
      if (!ready || !state) return Promise.resolve();
      if (window.SyncModel) SyncModel.observe(state);
      lastSaveAt = Math.max(Date.now(), lastSaveAt + 1, (state.__savedAt || 0) + 1);
      state.__savedAt = lastSaveAt;
      /* 注意：这里**不能**把 settings.lastOrigin 刷成当前地址。
       * lastOrigin 的含义是"这份数据最初来自哪个网址"，用于识别跨地址搬家。
       * 如果每次保存都更新它，那么用户在新地址一打开、一保存，"来自旧地址"的
       * 信息就没了 —— 换地址提示永远不会出现。它只在数据建立与导入时确立。 */
      const snapshot = Object.assign({}, state);
      const savingRev = rev;
      reportSave('saving');
      return idbPut('kv', 'state', snapshot).then(() => {
        const fallback = readFallback();
        if (fallback && (fallback.__savedAt || 0) <= snapshot.__savedAt) {
          try { localStorage.removeItem(BACKUP_KEY); } catch (e) { }
        }
        saveWarning = false;
        reportSave(savingRev === rev ? 'saved' : 'pending', snapshot.__savedAt);
        return true;
      }).catch(error => {
        try {
          localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
          warnSave('浏览器数据库暂不可用，文字记录已存备用缓存，请及时导出备份');
          reportSave(savingRev === rev ? 'fallback' : 'pending', snapshot.__savedAt);
          return true;
        } catch (fallbackError) {
          warnSave('保存失败，请保持页面打开并立即导出备份');
          reportSave('error');
          throw error;
        }
      });
    },

    commit(fn) { if (fn) fn(state); rev++; api.save(); api.emit(); },

    /* ---------- 媒体（照片 / 语音 / 视频）：优先云端，本机只留小图 ---------- */
    async putMedia(id, blob, meta) {
      const m = Object.assign({ ts: Date.now(), size: blob.size, mime: blob.type }, meta || {});
      /* 封面与照片是"小图"，必须在本机留一份；视频与语音是大件，上云后本机清零 */
      const small = m.kind === 'photo' || m.kind === 'poster';
      const canCloud = window.Cloud && Cloud.signedIn() && state.settings.cloudMedia !== false;
      if (canCloud) {
        try {
          m.path = await Cloud.uploadMedia(id, blob, m);
          m.cloud = 1;
          if (state.settings.keepThumb !== false && small) {
            /* 封面本身已经是 640px 的 jpeg，再压一遍只会更糊，直接用 */
            const th = m.kind === 'poster' ? blob : await makeThumb(blob, 480);
            if (th) { await idbPut('media', id, th); m.local = th.size; m.thumb = 1; }
            else { try { await idbDel('media', id); } catch (e) { } m.local = 0; }
          } else {
            try { await idbDel('media', id); } catch (e) { }
            m.local = 0;
          }
          trackMedia(m.local || 0);
          state.media[id] = m;
          api.save();
          return id;
        } catch (e) {
          console.warn('[云] 上传失败，回落本机', e);
          U.toast('云端上传失败，已暂存在本机');
        }
      }
      await idbPut('media', id, blob);
      m.local = blob.size; m.cloud = 0;
      trackMedia(blob.size);
      state.media[id] = m;
      api.save();
      return id;
    },

    /* full=true 时绕开缩略图，直接取云端原图 */
    async getMedia(id, full) {
      if (!full) {
        try {
          const b = await idbGet('media', id);
          if (b) return b;
        } catch (e) { }
      }
      if ((state.media[id] || {}).cloud && window.Cloud && Cloud.signedIn()) {
        const cb = await Cloud.downloadMedia(id);
        if (cb) return cb;
      }
      try { return await idbGet('media', id); } catch (e) { return null; }
    },

    /* 给 <img src> 用的地址；本机没有就回源云端。
       缩略图地址会缓存，避免每次重绘都重新读一遍 IndexedDB + 新建 objectURL（会漏内存） */
    async mediaURL(id, full) {
      if (!full && thumbCache.has(id)) return thumbCache.get(id);
      const b = await api.getMedia(id, full);
      if (!b) return null;
      const url = URL.createObjectURL(b);
      if (!full) {
        if (thumbCache.size > 120) {
          const first = thumbCache.keys().next().value;
          try { URL.revokeObjectURL(thumbCache.get(first)); } catch (e) { }
          thumbCache.delete(first);
        }
        thumbCache.set(id, url);
      }
      return url;
    },

    async delMedia(id) {
      try { await idbDel('media', id); } catch (e) { }
      if ((state.media[id] || {}).cloud && window.Cloud && Cloud.signedIn()) {
        try { await Cloud.deleteMedia(id); } catch (e) { }
      }
      delete state.media[id];
      dropThumb(id);
      api.save();
    },

    async mediaUsage() {
      const keys = await idbKeys('media');
      let localBytes = 0, videoBytes = 0, videoCount = 0;
      keys.forEach(k => { localBytes += (state.media[k] && state.media[k].local) || 0; });
      Object.keys(state.media || {}).forEach(k => {
        const m = state.media[k];
        if (m && m.kind === 'video') { videoBytes += m.size || 0; videoCount++; }
      });
      let cloud = { count: 0, bytes: 0 };
      if (window.Cloud && Cloud.signedIn()) {
        cloud = await Promise.race([
          Cloud.mediaUsage().catch(() => ({ count: 0, bytes: 0 })),
          new Promise(r => setTimeout(() => r({ count: 0, bytes: 0 }), 2500))
        ]);
      }
      const cloudN = Object.keys(state.media || {}).filter(k => state.media[k] && state.media[k].cloud).length;
      return {
        count: Math.max(keys.length, cloudN, cloud.count), localBytes, cloud,
        videoBytes, videoCount
      };
    },

    /* 一键释放本机空间：删掉本机所有媒体副本和缩略图缓存，云端那份原图原样保留，
       下次要看时自动从云端取回。习惯、打卡记录这些文字数据完全不动。 */
    async slimLocal() {
      const keys = (await idbKeys('media')).filter(k => state.media[k] && state.media[k].cloud);
      let freed = 0, n = 0;
      for (const k of keys) {
        freed += ((state.media || {})[k] && state.media[k].local) || 0;
        await idbDel('media', k);
        dropThumb(k);
        if (state.media && state.media[k]) { state.media[k].local = 0; state.media[k].thumb = 0; }
        n++;
      }
      api.save();
      return { files: n, bytes: freed };
    },

    async gcMedia() {
      // 清理没有被引用的媒体（本机 + 云端）
      /* 视频的封面是独立一条 media 记录，只被 videos[].poster 引用，
       * 漏掉它会把封面当垃圾删掉，日记里的视频格全变破图。 */
      const used = new Set();
      Object.values(state.notes || {}).forEach(n => {
        (n.photos || []).forEach(p => used.add(p.id));
        (n.audios || []).forEach(p => used.add(p.id));
        (n.videos || []).forEach(v => { if (v && v.id) { used.add(v.id); if (v.poster) used.add(v.poster); } });
      });
      const keys = await idbKeys('media');
      let n = 0;
      for (const k of keys) if (!used.has(k)) { await idbDel('media', k); dropThumb(k); n++; }
      if (window.Cloud && Cloud.signedIn()) {
        const list = await Cloud.listMedia().catch(() => []);
        for (const f of list) {
          if (!used.has(f.mid)) {
            await Cloud.deleteMedia(f.mid).catch(() => { });
            delete state.media[f.mid]; n++;
          }
        }
      }
      api.save();
      return n;
    },

    /* ---------- 配额 ---------- */
    /* 云端已有原图时，清掉本机缩略图缓存，本机占用归零 */
    async clearLocalMedia() {
      const ids = Object.keys(state.media || {}).filter(k => state.media[k] && state.media[k].cloud);
      let n = 0;
      for (const k of ids) {
        try { await idbDel('media', k); state.media[k].local = 0; dropThumb(k); n++; } catch (e) { }
      }
      api.save();
      return n;
    },

    async quota() {
      let est = { usage: 0, quota: 0 };
      try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (e) { }
      const m = await Promise.race([
        api.mediaUsage().catch(() => ({ count: 0, localBytes: 0, cloud: { count: 0, bytes: 0 } })),
        new Promise(r => setTimeout(() => r({ count: 0, localBytes: 0, cloud: { count: 0, bytes: 0 } }), 1800))
      ]);
      let persisted = false;
      try { persisted = await navigator.storage.persisted(); } catch (e) { }
      const ms = state.mediaStats || { added: 0, since: Date.now() };
      const dayMs = Math.max(86400000, Date.now() - (ms.since || Date.now()));
      return {
        usage: est.usage || 0, quota: est.quota || 0, persisted,
        media: { count: m.count || 0, bytes: m.localBytes || 0, cloud: m.cloud || { count: 0, bytes: 0 } },
        mediaPerDay: (ms.added || 0) / (dayMs / 86400000),
        cloudOn: !!(window.Cloud && Cloud.signedIn())
      };
    },

    /* 索引与二进制对账：清掉「有索引、没文件」的幽灵记录。
     * 触发场景：只导文字的备份（只有索引没 blob）、回滚旧快照、云端文件被外部删除。
     * cloud=1 的记录一律保留 —— 登录后还能从云端下载，不能当垃圾删。 */
    async reconcileMedia(opts) {
      const dropOrphans = !!(opts && opts.orphans);
      const keys = new Set(await idbKeys('media').catch(() => []));
      let ghosts = 0;
      Object.keys(state.media || {}).forEach(id => {
        const m = state.media[id] || {};
        if (m.cloud) return;
        if (keys.has(id)) return;
        delete state.media[id]; ghosts++;
      });
      let orphans = 0;
      if (dropOrphans) {
        Object.values(state.notes || {}).forEach(n => {
          ['photos', 'audios', 'videos'].forEach(k => {
            const list = n[k] || [];
            const kept = list.filter(x => x && state.media[x.id]);
            if (kept.length !== list.length) { n[k] = kept; orphans += list.length - kept.length; }
          });
          (n.videos || []).forEach(v => { if (v.poster && !state.media[v.poster]) v.poster = ''; });
        });
      }
      if (ghosts || orphans) api.save();
      return { ghosts, orphans };
    },

    /* ---------- 导出 / 导入 ---------- */
    /* 视频 base64 内联后约为原文件的 1.37 倍，一条 60MB 就能把整份备份顶到 80MB+。
     * 这里给个总量闸门：超了就先跳过大视频，并如实告诉用户，而不是假装导出成功。 */
    async exportJSON(withMedia) {
      /* v41 · 报告 P2-7：导出文件头带上 schema 与校验和。
       * 半截文件（传输被截断、U 盘没写完）导进主库是最难查的一类事故：
       * 数据看着"有一部分"，用户不会怀疑文件，只会觉得应用把记录弄丢了。 */
      const out = { app: '日拱一卒', schema: 7, exportedAt: Date.now(), state: JSON.parse(JSON.stringify(state)) };
      if (withMedia) {
        const pack = {};
        const ids = Object.keys(state.media || {});
        let packed = 0, skippedVideos = 0;
        const LIMIT = 90 * 1024 * 1024;   // base64 字符数上限，约 66MB 原文件
        for (const k of ids) {
          const meta = state.media[k] || {};
          let blob = null;
          try { blob = await api.getMedia(k, true); } catch (e) { }
          if (!blob) { if (meta.kind === 'video') skippedVideos++; continue; }
          if (meta.kind === 'video' && packed + blob.size * 1.37 > LIMIT) { skippedVideos++; continue; }
          const url = await new Promise(res => {
            const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob);
          });
          if (typeof url !== 'string') { if (meta.kind === 'video') skippedVideos++; continue; }
          pack[k] = url; packed += url.length;
        }
        out.media = pack;
        if (skippedVideos) {
          out.mediaNote = skippedVideos + ' 条视频体积过大，未打进这份备份（其余内容完整）';
        }
      }
      return out;
    },

    async importJSON(text, mode) {
      const data = typeof text === 'string' ? JSON.parse(text) : text;
      if (!record(data)) throw new Error('文件格式不正确');
      const src = validateState(data.state || data);
      if (data.media != null && (!record(data.media) || Object.values(data.media).some(url => typeof url !== 'string' || !/^data:(image|audio|video)\/[a-z0-9.+-]+;base64,/i.test(url)))) {
        throw new Error('备份中的媒体必须是内嵌的图片、音频或视频');
      }
      if (mode === 'replace') {
        state = normalized(src);
        if (window.SyncModel) SyncModel.prepare(state, false);
      } else {
        // 合并：习惯、日志、笔记、心情、积分、成员、套餐
        const mergeArr = key => {
          state[key] = state[key] || [];
          const have = new Map(state[key].map((x, i) => [x.id, i]));
          (src[key] || []).forEach(x => {
            if (!have.has(x.id)) { have.set(x.id, state[key].length); state[key].push(x); }
            else {
              const i = have.get(x.id), current = state[key][i];
              if ((x.updatedAt || x.createdAt || 0) > (current.updatedAt || current.createdAt || 0)) state[key][i] = x;
            }
          });
        };
        ARRAY_KEYS.forEach(mergeArr);
        Object.entries(src.logs || {}).forEach(([d, day]) => {
          const target = state.logs[d] = state.logs[d] || {};
          Object.entries(day).forEach(([id, log]) => {
            if (!target[id] || (log.t || 0) > (target[id].t || 0)) target[id] = log;
          });
        });
        Object.entries(src.notes || {}).forEach(([d, n]) => {
          const current = state.notes[d];
          if (!current) { state.notes[d] = n; return; }
          const newer = (n.updatedAt || 0) > (current.updatedAt || 0);
          const merged = Object.assign({}, current, newer ? n : {});
          if (!merged.text && n.text) merged.text = n.text;
          ['photos', 'audios', 'videos'].forEach(key => {
            const all = new Map();
            (current[key] || []).concat(n[key] || []).forEach(x => { if (x && x.id) all.set(x.id, x); });
            merged[key] = Array.from(all.values());
          });
          state.notes[d] = merged;
        });
        Object.entries(src.moods || {}).forEach(([d, m]) => { if (state.moods[d] == null) state.moods[d] = m; });
        state.media = Object.assign({}, src.media || {}, state.media);
        ['freezes', 'achievements', 'decor', 'checkRewards'].forEach(key => {
          state[key] = Object.assign({}, src[key] || {}, state[key] || {});
        });
        Object.assign(state.settings, src.settings || {});
      }
      if (data.media) {
        for (const [k, url] of Object.entries(data.media)) {
          try {
            const r = await fetch(url); const b = await r.blob();
            const meta = (src.media && src.media[k]) || state.media[k] || {};
            if (window.Cloud && Cloud.signedIn() && state.settings.cloudMedia !== false) {
              const path = await Cloud.uploadMedia(k, b, Object.assign({ kind: 'photo', date: meta.date || U.today() }, meta));
              state.media[k] = Object.assign({ ts: Date.now(), size: b.size, mime: b.type, cloud: 1, path, local: 0 }, meta);
              /* 封面和照片是小图，云端有一份的同时本机也留一份，否则恢复后网格全是破图 */
              if (meta.kind === 'photo' || meta.kind === 'poster') {
                try { await idbPut('media', k, b); state.media[k].local = b.size; } catch (e) { }
              }
            } else {
              await idbPut('media', k, b);
              state.media[k] = Object.assign({ ts: Date.now(), size: b.size, mime: b.type, local: b.size, cloud: 0 }, meta);
            }
          } catch (e) { }
        }
      }
      /* 导入收尾对账：备份里没有 blob 的索引（「只导文字」导出、外部删过云端文件）
       * 会变成永远打不开的格子，这里一并清掉，并把悬空的附件引用摘除。 */
      await api.reconcileMedia({ orphans: true });
      api.bump();
      await api.saveNow();
      api.emit();
      return true;
    },

    /* 覆盖恢复前保留文字备份；媒体原件不删除。 */
    async saveRecovery() {
      await idbPut('kv', 'pre-cloud-restore-' + Date.now(), JSON.parse(JSON.stringify(state)));
    },

    /* ---------- 危险操作 ---------- */
    async wipe(alsoCloud) {
      if (alsoCloud && window.Cloud && Cloud.signedIn()) await Cloud.wipeRemote();
      try { await idbDel('kv', 'state'); } catch (e) { }
      try { localStorage.removeItem('rigongyizhu.state'); } catch (e) { }
      const keys = await idbKeys('media');
      for (const k of keys) await idbDel('media', k);
      state = defaultState();
      if (window.SyncModel) SyncModel.prepare(state, true);
      rev++;
      await api.saveNow();
      api.emit();
    }
  };

  /* 真正的落盘动作（防抖 260ms）：IndexedDB 用结构化克隆存快照，
     不必再在主线程做一次全量 JSON 深拷贝（数据大时那一步很卡） */
  api._doSave = U.debounce(function () {
    if (!ready || !state) return;
    api.saveNow().then(() => {
      if (window.Cloud && state.settings.autoSync !== false) {
        try { Cloud.schedulePush(); } catch (e) { }
      }
    }).catch(e => console.warn('保存失败', e));
  }, 260);

  /* v41 · 报告 P2-7：轻量校验和（FNV-1a 32 位 + 长度），用来发现"半截文件"。
   * 不做加密用途，只回答一个问题：这份备份是不是完整地到了这里。 */
  function checksum(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8) + '-' + str.length.toString(36);
  }

  /* 给日记模块用的两个工具：抽视频封面、丢掉某个媒体的缩略图缓存 */
  api.videoPoster = videoPoster;
  api.dropThumb = dropThumb;
  /* v41 · 报告 P2-6：把 IDB 原语暴露出去，让本地快照（Safety）能从 localStorage 搬进来。
   * localStorage 只有 5MB，7 份快照就能撑爆，而且写失败是静默的 —— 用户以为有备份，其实没有。 */
  api.idb = { put: idbPut, get: idbGet, del: idbDel, keys: idbKeys };
  api.checksum = checksum;

  return api;
})();
