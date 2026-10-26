/* 日拱一卒云同步：按记录合并、逻辑时钟、删除标记。无新增运行时依赖。 */
window.SyncModel = (function () {
  'use strict';
  const arrays = ['items', 'bundles', 'rewards', 'redemptions', 'sessions', 'members', 'rooms', 'routines', 'capsules', 'todos', 'challenges'];
  const maps = ['moods', 'media', 'checkRewards', 'freezes', 'achievements', 'decor'];
  const sharedSettings = ['nickname', 'seedPts'];
  let baseline = null;
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function canonical(x) {
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
    return JSON.stringify(x);
  }
  function validate(x, depth = 0) {
    if (depth > 50) throw new Error('云端数据层级过深');
    if (!x || typeof x !== 'object') return;
    for (const k of Object.keys(x)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('云端数据含不支持的字段');
      validate(x[k], depth + 1);
    }
  }
  function flatten(st) {
    const out = Object.create(null);
    const put = (path, value) => { if (value !== undefined) out[JSON.stringify(path)] = clone(value); };
    arrays.forEach(k => (st[k] || []).forEach(x => { if (x && typeof x.id === 'string') put([k, x.id], x); }));
    Object.entries(st.logs || {}).forEach(([d, day]) => Object.entries(day || {}).forEach(([id, x]) => put(['logs', d, id], x)));
    Object.entries(st.notes || {}).forEach(([d, note]) => {
      // 照片/视频/语音按附件 ID 独立合并，删除附件不会被另一台设备重新加回。
      const body = Object.assign({}, note); delete body.photos; delete body.audios; delete body.videos;
      put(['notes', d, 'body'], body);
      ['photos', 'audios', 'videos'].forEach(k => (note[k] || []).forEach(x => put(['notes', d, k, x.id], x)));
    });
    maps.forEach(k => Object.entries(st[k] || {}).forEach(([id, x]) => put([k, id], x)));
    sharedSettings.forEach(k => put(['settings', k], (st.settings || {})[k]));
    return out;
  }
  function legacy(value) {
    return [Number(value && (value.updatedAt || value.t || value.createdAt || value.ts || value.at)) || 0, 'legacy'];
  }
  function metadata(st) {
    if (!st._sync || st._sync.version !== 1) st._sync = { version: 1, records: {}, pristine: false };
    if (!st._sync.records) st._sync.records = {};
    return st._sync;
  }
  function prepare(st, fresh) {
    validate(st);
    const meta = metadata(st), values = flatten(st);
    if (fresh) meta.pristine = true;
    Object.keys(values).forEach(k => { if (!meta.records[k]) meta.records[k] = { clock: legacy(values[k]), deleted: false }; });
    baseline = values;
  }
  function observe(st) {
    if (!baseline) { prepare(st, false); return; }
    const meta = metadata(st), next = flatten(st);
    let tick = Date.now();
    Object.values(meta.records).forEach(x => { tick = Math.max(tick, Number(x.clock && x.clock[0]) + 1 || 0); });
    const device = st.deviceId || 'local';
    for (const key of new Set([...Object.keys(baseline), ...Object.keys(next)])) {
      if (canonical(baseline[key]) === canonical(next[key])) continue;
      meta.records[key] = { clock: [tick++, device], deleted: !(key in next) };
      meta.pristine = false;
    }
    baseline = next;
  }
  function payload(st) {
    observe(st);
    const out = { version: 7, items: [], logs: {}, notes: {}, settings: {} };
    arrays.forEach(k => { out[k] = clone(st[k] || []).sort((a, b) => a.id === b.id ? 0 : a.id > b.id ? 1 : -1); });
    ['logs', 'notes', ...maps].forEach(k => { out[k] = clone(st[k] || {}); });
    // 本机缓存尺寸/缩略图标志不传播；本机尚未上传的媒体不冒充云端文件。
    Object.keys(out.media).forEach(id => {
      if (!out.media[id].cloud) delete out.media[id];
      else { delete out.media[id].local; delete out.media[id].thumb; }
    });
    /* 未上云的附件不会进 payload。什么都不说的话，另一台设备看到的是「这天没东西」，
     * 会以为数据丢了。这里只带一个计数，让对方显示一行说明 —— 不伪造可播放的条目。 */
    Object.values(out.notes).forEach(note => {
      let pending = 0;
      ['photos', 'audios', 'videos'].forEach(k => {
        const all = note[k] || [];
        const kept = all.filter(x => out.media[x.id]).sort((a, b) => a.id === b.id ? 0 : a.id > b.id ? 1 : -1);
        pending += all.length - kept.length;
        note[k] = kept;
      });
      if (pending) note.pending = pending; else delete note.pending;
    });
    /* 封面没上云时留一个空串，别让另一台设备拿着不存在的 poster id 去取图 */
    Object.values(out.notes).forEach(note => (note.videos || []).forEach(v => {
      if (v.poster && !out.media[v.poster]) v.poster = '';
    }));
    sharedSettings.forEach(k => { if (st.settings[k] !== undefined) out.settings[k] = clone(st.settings[k]); });
    out._sync = clone(metadata(st)); delete out._sync.pristine;
    const values = flatten(out);
    Object.keys(out._sync.records).forEach(k => {
      if (!out._sync.records[k].deleted && !(k in values)) delete out._sync.records[k];
    });
    return out;
  }
  function compare(a, b) { return a[0] - b[0] || (a[1] === b[1] ? 0 : a[1] > b[1] ? 1 : -1); }
  function set(st, path, value, deleted) {
    const [key, id, sub, mid] = path;
    if (arrays.includes(key)) {
      st[key] = st[key] || [];
      const i = st[key].findIndex(x => x.id === id);
      if (deleted) { if (i >= 0) st[key].splice(i, 1); }
      else if (i >= 0) st[key][i] = clone(value); else st[key].push(clone(value));
    } else if (key === 'notes') {
      st.notes = st.notes || {};
      const note = st.notes[id] = st.notes[id] || { text: '', photos: [], audios: [], videos: [] };
      if (sub === 'body') {
        Object.keys(note).filter(k => !['photos', 'audios', 'videos'].includes(k)).forEach(k => delete note[k]);
        if (!deleted) Object.assign(note, clone(value));
      } else if (['photos', 'audios', 'videos'].includes(sub)) {
        const list = note[sub] = note[sub] || [], i = list.findIndex(x => x.id === mid);
        if (deleted) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = clone(value); else list.push(clone(value));
      }
    } else if (key === 'logs') {
      const day = (st.logs || (st.logs = {}))[id] = st.logs[id] || {};
      if (deleted) delete day[sub]; else day[sub] = clone(value);
    } else if (maps.includes(key) || key === 'settings' && sharedSettings.includes(id)) {
      st[key] = st[key] || {};
      if (deleted) delete st[key][id]; else st[key][id] = clone(value);
    }
  }
  function merge(st, incoming) {
    validate(incoming);
    if (!incoming || !Array.isArray(incoming.items) || typeof incoming.logs !== 'object') throw new Error('云端数据格式不正确');
    observe(st);
    const current = flatten(st), remote = flatten(incoming), meta = metadata(st);
    const remoteMeta = incoming._sync && incoming._sync.records || {};
    let changed = 0;
    for (const k of new Set([...Object.keys(remote), ...Object.keys(remoteMeta)])) {
      const path = JSON.parse(k);
      if (!Array.isArray(path) || typeof path[0] !== 'string') throw new Error('云端记录路径不正确');
      const a = meta.records[k] || { clock: legacy(current[k]), deleted: false };
      const b = remoteMeta[k] || { clock: legacy(remote[k]), deleted: false };
      if (!Array.isArray(b.clock) || !Number.isFinite(b.clock[0]) || typeof b.clock[1] !== 'string') throw new Error('云端版本标记不正确');
      const order = compare(b.clock, a.clock);
      const accept = !(k in current) && !meta.records[k] || order > 0 || order === 0 && canonical(remote[k]) > canonical(current[k]);
      if (!accept) continue;
      if (!b.deleted && !(k in remote)) throw new Error('云端记录内容缺失');
      // 本机媒体缓存标志留在当前设备。
      let value = remote[k];
      if (path[0] === 'media' && value) value = Object.assign({}, value, { local: current[k] && current[k].local || 0, thumb: current[k] && current[k].thumb || 0 });
      set(st, path, value, b.deleted);
      meta.records[k] = clone(b); changed++;
    }
    baseline = flatten(st);
    return changed;
  }
  return { prepare, observe, payload, merge, canonical, validate };
})();
