/* ============ 日记本：每天一页 ============
 * 数据层：复用已有的 notes[日期] = { text, photos[], audios[], videos[] } 与 moods[日期]，
 * 不另起一套结构 —— 这样云端同步、语音笔记、Markdown 导出都能直接吃到同一份数据。
 * 额外只加 weather 字段（天气）与 updatedAt（用于多设备合并取新）。
 *
 * 浏览器专属能力（压缩图片、拉天气）都做了存在性判断，
 * 小程序端 require 本文件不会报错，只是那两个函数返回 null。
 */
var _droot = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
_droot.Diary = (function () {

  var MAX_PHOTOS = 20;          // 每天图片软上限
  var MAX_SIDE = 1600;          // 压缩后长边
  var QUALITY = 0.82;           // JPEG 质量
  var KEEP_UNDER = 220 * 1024;  // 小于这个体积就不折腾，直接存原图
  var MAX_VIDEOS = 3;           // 每天视频条数上限
  var MAX_VIDEO_MB = 60;        // 单条视频体积上限
  var MAX_VIDEO_SEC = 120;      // 单条视频时长上限（秒）

  /* ---------------- 天气 ---------------- */
  var WEATHER = [
    { k: 'sunny', e: '☀️', n: '晴' },
    { k: 'cloudy', e: '⛅', n: '多云' },
    { k: 'overcast', e: '☁️', n: '阴' },
    { k: 'rain', e: '🌧️', n: '雨' },
    { k: 'snow', e: '❄️', n: '雪' },
    { k: 'fog', e: '🌫️', n: '雾' },
    { k: 'wind', e: '💨', n: '大风' },
    { k: 'storm', e: '⛈️', n: '雷雨' }
  ];
  function wOf(k) {
    for (var i = 0; i < WEATHER.length; i++) if (WEATHER[i].k === k) return WEATHER[i];
    return null;
  }
  function wIcon(k) { var w = wOf(k); return w ? w.e : ''; }
  function wName(k) { var w = wOf(k); return w ? w.n : ''; }

  /* WMO 天气码 -> 我们的图标键 */
  function mapWmo(code) {
    var c = parseInt(code, 10);
    if (isNaN(c)) return 'cloudy';
    if (c === 113) return 'sunny';
    if (c === 116) return 'cloudy';
    if (c === 119 || c === 122) return 'overcast';
    if (c === 143 || c === 248 || c === 260) return 'fog';
    if (c === 200 || c === 386 || c === 389 || c === 392 || c === 395) return 'storm';
    if (c === 227 || c === 230 || (c >= 320 && c <= 338) || (c >= 368 && c <= 377)) return 'snow';
    if ((c >= 176 && c <= 182) || (c >= 263 && c <= 314) || (c >= 350 && c <= 365)) return 'rain';
    if (c === 185 || c === 263 || c === 317) return 'rain';
    return 'cloudy';
  }

  function fetchJSON(url, ms) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('no fetch'));
    return new Promise(function (res, rej) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); rej(new Error('timeout')); }, ms || 3500);
      fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(res).catch(function (e) { clearTimeout(timer); rej(e); });
    });
  }

  function geolocate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
    return new Promise(function (res) {
      navigator.geolocation.getCurrentPosition(
        function (p) { res({ lat: p.coords.latitude, lon: p.coords.longitude }); },
        function () { res(null); },
        { timeout: 6000, maximumAge: 30 * 60 * 1000 }
      );
    });
  }

  /* 自动获取天气：wttr.in（按 IP，一个请求拿全）失败再回退 open-meteo（需定位）
   * 全部失败返回 null —— 绝不抛错，页面照常渲染，用户可以手动点选。 */
  function fetchWeather() {
    return fetchJSON('https://wttr.in/?format=j1', 3500).then(function (j) {
      var cur = (j.current_condition || [])[0];
      if (!cur) throw new Error('bad payload');
      var area = (j.nearest_area || [])[0] || {};
      var pick = function (arr) { return arr && arr[0] && arr[0].value || ''; };
      var city = pick(area.areaName) || pick(area.region) || pick(area.country) || '';
      return { k: mapWmo(cur.weatherCode), t: cur.temp_C, city: city, auto: 1, at: Date.now() };
    }).catch(function () {
      return geolocate().then(function (pos) {
        if (!pos) return null;
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + pos.lat +
          '&longitude=' + pos.lon + '&current=temperature_2m,weather_code';
        return fetchJSON(url, 3500).then(function (j) {
          var c = j && j.current;
          if (!c) return null;
          return { k: mapWmo(c.weather_code), t: String(Math.round(c.temperature_2m)), city: '', auto: 1, at: Date.now() };
        }).catch(function () { return null; });
      });
    });
  }

  /* 当天还没天气就试着拉一次；拉不到就留空，不影响页面。
   * 同一天 10 分钟内只试一次 —— 免得网络不好时每次重绘都发一遍请求。 */
  var _wt = { d: null, at: 0 };
  /* 返回「这次是否取到了新天气」：
   * 已经有天气时返回 null —— 调用方据此决定要不要重绘，
   * 若这里回吐已缓存的天气，上层 render 会被反复触发（见 ui.js render）。 */
  function ensureWeather(date) {
    var d = date || U.today();
    var st = Store.s;
    if (!st || st.settings.weatherAuto === false) return Promise.resolve(null);
    var n = raw(d);
    if (n && n.weather && n.weather.k) return Promise.resolve(null);
    if (_wt.d === d && Date.now() - _wt.at < 600000) return Promise.resolve(null);
    _wt.d = d; _wt.at = Date.now();
    return fetchWeather().then(function (w) {
      if (!w) return null;
      setWeather(d, w);
      return w;
    }).catch(function () { return null; });
  }

  function setWeather(date, w) {
    if (!w) return;
    Store.commit(function (st) {
      var n = note(st, date);
      n.weather = { k: w.k, t: w.t == null ? '' : String(w.t), city: w.city || '', auto: w.auto ? 1 : 0, at: Date.now() };
    });
  }
  function clearWeather(date) {
    Store.commit(function (st) { var n = raw(date); if (n) delete n.weather; });
  }

  /* ---------------- 读写 ---------------- */
  function note(st, date) {
    st = st || Store.s;
    var d = date || U.today();
    if (!st.notes) st.notes = {};
    if (!st.notes[d]) st.notes[d] = { text: '', photos: [], audios: [], videos: [] };
    var n = st.notes[d];
    if (!n.photos) n.photos = [];
    if (!n.audios) n.audios = [];
    if (!n.videos) n.videos = [];
    return n;
  }
  /* 不创建的版本：只取已有的 */
  function raw(date) {
    var st = Store.s;
    if (!st || !st.notes) return null;
    return st.notes[date || U.today()] || null;
  }

  function setText(date, txt) {
    Store.commit(function (st) {
      var n = note(st, date);
      n.text = txt;
      n.updatedAt = Date.now();
    });
  }
  function setMood(date, v) {
    Store.commit(function (st) {
      if (!st.moods) st.moods = {};
      st.moods[date] = Math.max(1, Math.min(5, +v || 1));
      var n = note(st, date);
      n.updatedAt = Date.now();
    });
  }

  function hasContent(date) {
    var n = raw(date);
    if (!n) return false;
    return !!(n.text || (n.photos && n.photos.length) || (n.audios && n.audios.length) || (n.videos && n.videos.length));
  }
  /* 提醒用：今天打了卡但一个字都没写 */
  function needsWrite(date) {
    var d = date || U.today();
    var r = Engine.todayRate(d);
    return r.done > 0 && !hasContent(d);
  }

  /* ---------------- 当天自动收录 ---------------- */
  /* 全站连击在「某天」是多少：从那天往回数，当天及之前每天至少完成一个习惯。
   * 看历史某天时，"连续"必须按那天算，不能用今天的全局连击。 */
  function globalStreakAtDate(date) {
    var n = 0, cur = date;
    for (var i = 0; i < 3650; i++) {
      if (Engine.todayRate(cur).done > 0) n++; else break;
      cur = U.shiftYmd(cur, -1);
    }
    return n;
  }
  function summary(date) {
    var d = date || U.today();
    var out = { done: [], skipped: [], slipped: [], rate: { done: 0, total: 0, pct: 0 }, streak: 0, points: 0 };
    try {
      var items = Engine.items();
      items.forEach(function (it) {
        if (!Engine.isDue(it, d)) return;
        if (Engine.isDone(it, d)) {
          var lg = Engine.getLog(d, it.id) || {};
          out.done.push({
            id: it.id, name: it.name, color: it.color || 'var(--accent)',
            ts: lg.t || 0, streak: Engine.streakOf(it.id, d)
          });
        } else if (Engine.isSkipped && Engine.isSkipped(d, it.id)) {
          out.skipped.push({ id: it.id, name: it.name });
        } else if (Engine.slipped && Engine.slipped(it, d)) {
          out.slipped.push({ id: it.id, name: it.name });
        }
      });
      out.rate = Engine.todayRate(d);
      // 看历史某天时，「连续」必须按那天算，不能用今天的全局连击（否则回到一个月前仍显示「连续 120 天」）
      out.streak = globalStreakAtDate(d);
      out.points = Engine.points();
    } catch (e) { }
    return out;
  }

  /* ---------------- 时间轴 / 日历 ---------------- */
  /* 有东西可看的日子：写了日记、有图、有语音、有心情，或当天打过卡 */
  function days(limit, offset) {
    var st = Store.s;
    if (!st) return [];
    var set = {};
    Object.keys(st.notes || {}).forEach(function (d) { if (hasContent(d)) set[d] = 1; });
    Object.keys(st.moods || {}).forEach(function (d) { set[d] = 1; });
    Object.keys(st.logs || {}).forEach(function (d) {
      var day = st.logs[d];
      if (day && Object.keys(day).length) set[d] = 1;
    });
    var arr = Object.keys(set).sort().reverse();
    var from = offset || 0;
    return arr.slice(from, from + (limit || 30));
  }
  function totalDays() {
    var st = Store.s;
    if (!st) return 0;
    var set = {};
    Object.keys(st.notes || {}).forEach(function (d) { if (hasContent(d)) set[d] = 1; });
    Object.keys(st.moods || {}).forEach(function (d) { set[d] = 1; });
    Object.keys(st.logs || {}).forEach(function (d) {
      var day = st.logs[d];
      if (day && Object.keys(day).length) set[d] = 1;
    });
    return Object.keys(set).length;
  }

  /* 月历网格：42 格，周一开头 */
  function monthGrid(ym) {
    var ym2 = ym || U.today().slice(0, 7);
    var first = U.parseYmd(ym2 + '-01');
    var y = first.getFullYear(), m = first.getMonth();
    var lead = (first.getDay() + 6) % 7;            // 周一=0
    var start = new Date(y, m, 1 - lead);
    var today = U.today();
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var ds = U.ymd(dt);
      var n = st_note(ds);
      var r = { done: 0, total: 0 };
      try { r = Engine.todayRate(ds); } catch (e) { }
      cells.push({
        date: ds, day: dt.getDate(), inMonth: dt.getMonth() === m,
        isToday: ds === today,
        hasNote: !!(n && (n.text || (n.photos && n.photos.length) || (n.videos && n.videos.length))),
        photos: n && n.photos ? n.photos.length : 0,
        videos: n && n.videos ? n.videos.length : 0,
        cover: coverOf(ds),
        mood: (Store.s && Store.s.moods && Store.s.moods[ds]) || 0,
        done: r.done, total: r.total
      });
    }
    return { ym: ym2, label: y + '年' + (m + 1) + '月', cells: cells };
  }
  function st_note(d) { var st = Store.s; return (st && st.notes && st.notes[d]) || null; }

  /* ---------------- 图片 ---------------- */
  function countPhotos(date) { var n = raw(date); return n && n.photos ? n.photos.length : 0; }

  /* 压缩：长边缩到 MAX_SIDE，JPEG 0.82。原图够小就原样返回。
   * 修 EXIF 方向（手机竖拍常见），否则存下来是躺着的。 */
  function compressImage(file) {
    var small = file && file.size && file.size < KEEP_UNDER;
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
      return Promise.resolve({ blob: file, w: 0, h: 0, size: file && file.size || 0, skipped: true });
    }
    if (small) return Promise.resolve({ blob: file, w: 0, h: 0, size: file.size, skipped: true });
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); res(img); };
        img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('bad image')); };
        img.src = url;
      });
    }).then(function (src) {
      var w = src.width || 0, h = src.height || 0;
      if (!w || !h) return { blob: file, w: 0, h: 0, size: file.size, skipped: true };
      var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
      var cv = document.createElement('canvas');
      cv.width = tw; cv.height = th;
      var g = cv.getContext('2d');
      g.drawImage(src, 0, 0, tw, th);
      if (src.close) { try { src.close(); } catch (e) { } }
      return new Promise(function (res) {
        cv.toBlob(function (b) {
          if (!b || b.size >= file.size) res({ blob: file, w: w, h: h, size: file.size, skipped: true });
          else res({ blob: b, w: tw, h: th, size: b.size, skipped: false });
        }, 'image/jpeg', QUALITY);
      });
    }).catch(function () {
      return { blob: file, w: 0, h: 0, size: file && file.size || 0, skipped: true };
    });
  }

  /* 加一张：先压再传云端（Store.putMedia 内部负责上云 + 只留缩略图） */
  function addPhoto(date, file) {
    var d = date || U.today();
    if (countPhotos(d) >= MAX_PHOTOS) {
      return Promise.resolve({ ok: false, msg: '每天最多 ' + MAX_PHOTOS + ' 张，删掉几张再来吧' });
    }
    return compressImage(file).then(function (r) {
      var id = U.uid('ph');
      return Store.putMedia(id, r.blob, { kind: 'photo', date: d, w: r.w, h: r.h, raw: file.size || 0 })
        .then(function () {
          Store.commit(function (st) {
            var n = note(st, d);
            n.photos.push({ id: id, ts: Date.now() });
            n.updatedAt = Date.now();
          });
          return { ok: true, id: id, size: r.size, raw: file.size || 0, skipped: r.skipped };
        });
    }).catch(function (e) {
      return { ok: false, msg: '保存失败：' + (e && e.message || '未知错误') };
    });
  }

  function removePhoto(date, id) {
    var d = date || U.today();
    Store.commit(function (st) {
      var n = note(st, d);
      n.photos = (n.photos || []).filter(function (p) { return p.id !== id; });
      n.updatedAt = Date.now();
    });
    if (Store.dropThumb) Store.dropThumb(id);
    return true;
  }
  function movePhoto(date, id, dir) {
    var d = date || U.today();
    Store.commit(function (st) {
      var n = note(st, d);
      var i = (n.photos || []).findIndex(function (p) { return p.id === id; });
      if (i < 0) return;
      var j = i + (dir < 0 ? -1 : 1);
      if (j < 0 || j >= n.photos.length) return;
      var t = n.photos[i]; n.photos[i] = n.photos[j]; n.photos[j] = t;
      n.updatedAt = Date.now();
    });
  }

  /* ---------------- 视频 ----------------
   * 和照片同一套索引与云端策略，但有三个硬边界：单条 60MB、120 秒、每天 3 条。
   * 浏览器里没有可靠的视频转码方案，与其假装能压，不如把边界说清楚。 */
  function countVideos(date) {
    var n = raw(date || U.today());
    return n && n.videos ? n.videos.length : 0;
  }

  /* 配额闸门：浏览器配额打满时 IndexedDB 写入会整体失败，会连带把打卡记录拖下水。
   * 留 20% 余量 —— 宁可拒绝这一段视频，也不能让主数据出问题。 */
  function quotaGuard(bytes) {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) return Promise.resolve(true);
      return navigator.storage.estimate().then(function (est) {
        if (!est || !est.quota) return true;
        return (est.quota - (est.usage || 0)) > bytes * 1.2;
      }).catch(function () { return true; });
    } catch (e) { return Promise.resolve(true); }
  }

  function addVideo(date, file) {
    var d = date || U.today();
    if (!file) return Promise.resolve({ ok: false, msg: '没选到文件' });
    if (countVideos(d) >= MAX_VIDEOS) {
      return Promise.resolve({ ok: false, msg: '每天最多 ' + MAX_VIDEOS + ' 条视频，删掉一条再来吧' });
    }
    if (String(file.type || '').indexOf('video/') !== 0) {
      return Promise.resolve({ ok: false, msg: '这不是视频文件' });
    }
    var mb = (file.size || 0) / 1048576;
    if (mb > MAX_VIDEO_MB) {
      return Promise.resolve({ ok: false, msg: '这段视频 ' + mb.toFixed(1) + 'MB，超过 ' + MAX_VIDEO_MB + 'MB 上限；先裁短一点再传' });
    }
    return quotaGuard(file.size || 0).then(function (enough) {
      if (!enough) return { ok: false, msg: '本机剩余空间放不下这段视频，先去「连接 → 释放本机空间」腾一点' };
      /* 一次解码同时拿封面和时长，避免把 60MB 读两遍 */
      return Store.videoPoster(file, 640).then(function (cover) {
        if (cover && cover.dur > MAX_VIDEO_SEC) {
          return { ok: false, msg: '这段 ' + Math.round(cover.dur) + ' 秒，超过 ' + MAX_VIDEO_SEC + ' 秒上限；先裁短一点' };
        }
        var vid = U.uid('vd'), pid = cover ? U.uid('pv') : '';
        var chain = Promise.resolve();
        if (cover) {
          chain = chain.then(function () {
            return Store.putMedia(pid, cover.blob, { kind: 'poster', date: d, w: cover.w, h: cover.h });
          });
        }
        return chain.then(function () {
          return Store.putMedia(vid, file, {
            kind: 'video', date: d,
            dur: cover ? cover.dur : 0, w: cover ? cover.w : 0, h: cover ? cover.h : 0, poster: pid
          });
        }).then(function () {
          Store.commit(function (st) {
            var n = note(st, d);
            n.videos.push({ id: vid, ts: Date.now(), poster: pid, dur: cover ? cover.dur : 0 });
            n.updatedAt = Date.now();
          });
          return { ok: true, id: vid, size: file.size, dur: cover ? cover.dur : 0, cover: !!cover };
        });
      });
    }).catch(function (e) {
      return { ok: false, msg: '保存失败：' + (e && e.message || '未知错误') };
    });
  }

  /* 删除后给 5 秒反悔窗口：60MB 的视频误触一次，重新拍是拍不回来的。
   * 窗口内只摘引用、不删 blob，撤销就是把引用放回去，零成本。 */
  var pendingDel = null;

  function hardDelVideo(id, poster) {
    if (Store.delMedia) {
      Store.delMedia(id).catch(function () { });
      if (poster) Store.delMedia(poster).catch(function () { });
    } else if (Store.dropThumb) {
      Store.dropThumb(id); if (poster) Store.dropThumb(poster);
    }
  }

  function removeVideo(date, id, opts) {
    var d = date || U.today();
    var poster = '', entry = null;
    Store.commit(function (st) {
      var n = note(st, d);
      (n.videos || []).forEach(function (v) { if (v.id === id) { poster = v.poster || ''; entry = v; } });
      n.videos = (n.videos || []).filter(function (v) { return v.id !== id; });
      n.updatedAt = Date.now();
    });
    if (!entry) return { ok: false };
    if (opts && opts.immediate) { hardDelVideo(id, poster); return { ok: true, entry: entry }; }
    if (pendingDel) pendingDel.commit();      // 上一条立即落定，避免两条删除窗口互相踩
    var rec = { date: d, entry: entry, poster: poster, timer: 0 };
    rec.commit = function () {
      clearTimeout(rec.timer);
      hardDelVideo(id, poster);
      if (pendingDel === rec) pendingDel = null;
    };
    rec.timer = setTimeout(rec.commit, 5000);
    pendingDel = rec;
    return { ok: true, entry: entry };
  }

  function undoRemoveVideo() {
    if (!pendingDel) return { ok: false };
    var rec = pendingDel;
    clearTimeout(rec.timer);
    pendingDel = null;
    Store.commit(function (st) {
      var n = note(st, rec.date);
      if (!(n.videos || []).some(function (v) { return v.id === rec.entry.id; })) n.videos.push(rec.entry);
      n.videos.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      n.updatedAt = Date.now();
    });
    return { ok: true, date: rec.date };
  }

  /* 封面：时间轴卡片露的那张图。没指定就用第一张。 */
  function setCover(date, id) {
    Store.commit(function (st) {
      var n = note(st, date);
      if (id && !(n.photos || []).some(function (p) { return p.id === id; })) return;
      n.cover = id || '';
      n.updatedAt = Date.now();
    });
  }
  function coverOf(date) {
    var n = raw(date);
    if (!n) return '';
    var ph = n.photos || [];
    if (!ph.length) return '';
    if (n.cover && ph.some(function (p) { return p.id === n.cover; })) return n.cover;
    return ph[0].id;
  }

  /* ---------------- 搜索 ---------------- */
  function norm(s) { return String(s || '').toLowerCase(); }

  /* 关键词搜索正文（+ 天气城市也顺带命中），返回倒序结果，带高亮片段 */
  function search(q, limit) {
    var st = Store.s;
    var kw = norm(q || '').trim();
    if (!kw || !st || !st.notes) return [];
    var words = kw.split(/\s+/).filter(Boolean);
    var out = [];
    Object.keys(st.notes).forEach(function (d) {
      var n = st.notes[d];
      var txt = n && n.text ? n.text : '';
      var city = n && n.weather && n.weather.city ? n.weather.city : '';
      var hay = norm(txt + ' ' + city);
      var hitAll = words.every(function (w) { return hay.indexOf(w) >= 0; });
      if (!hitAll) return;
      out.push({
        date: d,
        text: txt,
        snippet: snippet(txt, words[0]),
        photos: (n.photos || []).length,
        mood: (st.moods && st.moods[d]) || 0
      });
    });
    out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return out.slice(0, limit || 50);
  }

  /* 截一段含关键词的上下文，前后各留 30 字 */
  function snippet(txt, word) {
    var t = String(txt || '');
    var pos = norm(t).indexOf(norm(word));
    if (pos < 0) return t.slice(0, 80) + (t.length > 80 ? '…' : '');
    var from = Math.max(0, pos - 30), to = Math.min(t.length, pos + word.length + 50);
    return (from > 0 ? '…' : '') + t.slice(from, to) + (to < t.length ? '…' : '');
  }

  /* ---------------- 月度小结 ---------------- */
  /* 某个月的汇总：写了几天、打卡多少、完成率、照片数、平均心情、最勤的习惯 */
  function monthSummary(ym) {
    var ym2 = ym || U.today().slice(0, 7);
    var parts = ym2.split('-');
    var last = new Date(+parts[0], +parts[1], 0).getDate();   // 当月天数：下个月第 0 天
    var out = { ym: ym2, label: '', wrote: 0, checkins: 0, rate: 0, photos: 0, videos: 0, mood: 0, moodN: 0, top: [], days: [] };
    out.label = (+parts[1]) + ' 月';
    var st = Store.s;
    if (!st) return out;
    var rateSum = 0, rateN = 0, moodSum = 0;
    var tally = {};
    for (var i = 1; i <= last; i++) {
      var d = ym2 + '-' + String(i).padStart(2, '0');
      var n = st.notes && st.notes[d];
      var wrote = !!(n && ((n.text && n.text.trim()) || (n.photos && n.photos.length) || (n.videos && n.videos.length)));
      if (wrote) { out.wrote++; out.days.push(d); }
      if (n && n.photos) out.photos += n.photos.length;
      if (n && n.videos) out.videos += n.videos.length;
      if (st.moods && st.moods[d]) { moodSum += st.moods[d]; out.moodN++; }
      var r = { done: 0, total: 0, pct: 0 };
      try { r = Engine.todayRate(d); } catch (e) { }
      if (r.total) { out.checkins += r.done; rateSum += r.pct; rateN++; }
      try {
        (Engine.items() || []).forEach(function (it) {
          if (Engine.isDue(it, d) && Engine.isDone(it, d)) tally[it.id] = (tally[it.id] || 0) + 1;
        });
      } catch (e) { }
    }
    out.rate = rateN ? Math.round(rateSum / rateN) : 0;
    out.mood = out.moodN ? Math.round(moodSum / out.moodN * 10) / 10 : 0;
    var ids = Object.keys(tally);
    out.top = ids.map(function (id) {
      var it = (st.items || []).find(function (x) { return x.id === id; });
      return { name: it ? it.name : '已删除', n: tally[id], color: it ? (it.color || 'var(--accent)') : 'var(--line-2)' };
    }).sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
    return out;
  }

  /* 上一个月的 ym */
  function prevMonth(ym) {
    var ym2 = ym || U.today().slice(0, 7);
    var p = ym2.split('-');
    var y = +p[0], m = +p[1] - 1;
    if (m < 1) { m = 12; y--; }
    return y + '-' + String(m).padStart(2, '0');
  }

  /* ---------------- 连续写日记 ---------------- */
  /* 算"写了"的标准：有正文、有图、或有视频（语音不算，避免误触算数） */
  function wroteDay(d) {
    var n = raw(d);
    return !!(n && ((n.text && n.text.trim()) || (n.photos && n.photos.length) || (n.videos && n.videos.length)));
  }

  /* 连续写作天数。今天还没写不算断 —— 从昨天往前数，今天写了就接上。 */
  function writeStreak(date) {
    var d = date || U.today();
    var n = 0;
    var cur = wroteDay(d) ? d : U.shiftYmd(d, -1);
    var guard = 0;
    while (wroteDay(cur) && guard < 3650) { n++; cur = U.shiftYmd(cur, -1); guard++; }
    return n;
  }

  /* 昨天漏写了（前天写了、昨天没写）—— 用于温和提示，不是惩罚 */
  function missedYesterday(date) {
    var d = date || U.today();
    return wroteDay(U.shiftYmd(d, -2)) && !wroteDay(U.shiftYmd(d, -1));
  }

  /* 断写后隔了几天没写（0 = 没断）。返回 -1 表示「从未写过任何日记」，
   * 这样调用方能区分「断了一阵子」和「从没开始过」，而不会把 365 这个搜索上限
   * 当成真实天数泄漏出来（评审实测：干净用户看到「上次写是 365 天前」）。 */
  function gapDays(date) {
    var d = date || U.today();
    if (wroteDay(d)) return 0;
    if (!(Store.s && Store.s.diary) || !Object.keys(Store.s.diary).length) return -1;
    var g = 0, cur = U.shiftYmd(d, -1), guard = 0;
    while (!wroteDay(cur) && guard < 365) { g++; cur = U.shiftYmd(cur, -1); guard++; }
    return g;
  }

  /* ---------------- Markdown 导出 ---------------- */
  var MOOD_FACE = ['', '😞', '🙁', '😐', '🙂', '😄'];

  function dayMarkdown(d) {
    var n = raw(d);
    var s = summary(d);
    var mood = (Store.s && Store.s.moods && Store.s.moods[d]) || 0;
    var w = n && n.weather;
    var head = '## ' + U.prettyDate(d);
    if (w && w.k) head += ' ' + wIcon(w.k) + (w.t ? ' ' + w.t + '°C' : '') + (w.city ? ' · ' + w.city : '');
    var lines = [head, ''];
    var meta = [];
    if (mood) meta.push('心情 ' + (MOOD_FACE[mood] || '') + ' ' + mood + '/5');
    if (s.rate.total) meta.push('完成 ' + s.rate.done + '/' + s.rate.total + '（' + s.rate.pct + '%）');
    if (s.streak) meta.push('连续 ' + s.streak + ' 天');
    if (meta.length) lines.push('- ' + meta.join(' · '), '');
    if (s.done.length) {
      lines.push('### 完成');
      s.done.forEach(function (x) {
        lines.push('- ✅ ' + x.name + (x.streak ? '（连续 ' + x.streak + ' 天）' : '') + (x.ts ? ' · ' + U.hhmm(x.ts) : ''));
      });
      lines.push('');
    }
    if (s.slipped && s.slipped.length) {
      lines.push('### 破戒');
      s.slipped.forEach(function (x) { lines.push('- ⚠️ ' + x.name); });
      lines.push('');
    }
    if (s.skipped && s.skipped.length) {
      lines.push('### 请假');
      s.skipped.forEach(function (x) { lines.push('- 😴 ' + x.name); });
      lines.push('');
    }
    if (n && n.text && n.text.trim()) {
      lines.push('### 日记', '', n.text.trim(), '');
    }
    if (n && n.photos && n.photos.length) lines.push('（附图 ' + n.photos.length + ' 张）', '');
    if (n && n.videos && n.videos.length) {
      var vd = n.videos.map(function (v) { return v.dur ? Math.round(v.dur) + 's' : ''; }).filter(Boolean).join('、');
      lines.push('（附视频 ' + n.videos.length + ' 段' + (vd ? '：' + vd : '') + '）', '');
    }
    if (n && n.audios && n.audios.length) lines.push('（附语音 ' + n.audios.length + ' 条）', '');
    return lines.join('\n');
  }

  function exportMarkdown(from, to) {
    var list = days(3650, 0).filter(function (d) {
      return (!from || d >= from) && (!to || d <= to);
    }).sort();
    if (!list.length) return { text: '', n: 0 };
    var out = ['# 日拱一卒 · 日记', '', '> ' + list[0] + ' 至 ' + list[list.length - 1] + '，共 ' + list.length + ' 天', ''];
    list.forEach(function (d) { out.push(dayMarkdown(d), '---', ''); });
    return { text: out.join('\n'), n: list.length };
  }

  return {
    MAX_PHOTOS: MAX_PHOTOS, WEATHER: WEATHER,
    MAX_VIDEOS: MAX_VIDEOS, MAX_VIDEO_MB: MAX_VIDEO_MB, MAX_VIDEO_SEC: MAX_VIDEO_SEC,
    wIcon: wIcon, wName: wName, mapWmo: mapWmo,
    fetchWeather: fetchWeather, ensureWeather: ensureWeather, setWeather: setWeather, clearWeather: clearWeather,
    note: function (d) { return note(Store.s, d); },
    raw: raw, setText: setText, setMood: setMood,
    hasContent: hasContent, needsWrite: needsWrite, summary: summary,
    days: days, totalDays: totalDays, monthGrid: monthGrid,
    compressImage: compressImage, addPhoto: addPhoto, removePhoto: removePhoto,
    movePhoto: movePhoto, countPhotos: countPhotos, setCover: setCover, coverOf: coverOf,
    addVideo: addVideo, removeVideo: removeVideo, undoRemoveVideo: undoRemoveVideo, countVideos: countVideos,
    search: search, snippet: snippet,
    monthSummary: monthSummary, prevMonth: prevMonth,
    writeStreak: writeStreak, wroteDay: wroteDay, missedYesterday: missedYesterday, gapDays: gapDays,
    exportMarkdown: exportMarkdown, dayMarkdown: dayMarkdown
  };
})();
