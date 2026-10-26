/* v19 房间：服务端事务 + 账号绑定；仅主动授权的习惯传出白名单进度。 */
window.Rooms = (function () {
  'use strict';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', listeners = [], inflight = new Map();
  let status = { state: 'idle', msg: '房间尚未更新' }, syncing = null, autoTimer = null, observed = '';
  const uid = () => window.Cloud && Cloud.uid() || '';
  const ref = () => uid() ? 'u:' + uid() : '';
  const isAnon = () => !uid();
  function emit(state, msg) { status = { state, msg }; listeners.forEach(fn => { try { fn(status); } catch (_) {} }); }
  function context() {
    const owner = uid();
    if (!owner) throw new Error('请先登录，再使用好友房间');
    if (Store.s.settings.cloudAccountId && Store.s.settings.cloudAccountId !== owner) throw new Error('本机记录属于另一个账号，请登录原账号');
    if (!Store.s.settings.cloudAccountId) Store.commit(st=>{st.settings.cloudAccountId=owner;});
    return owner;
  }
  function error(e) {
    const m = String(e && e.message || e || '');
    if (/PGRST202|42883|could not find.*function|does not exist/i.test(m)) return '房间 v19 服务尚未安装，请在原 WorkBuddy 应用安装更新包';
    if (/room code conflict/.test(m)) return '房间码冲突，请重试';
    if (/42501|permission denied|403/i.test(m)) return '房间权限校验未通过，请在原 WorkBuddy 检查配置';
    if (/owner must archive/.test(m)) return '房主请使用「归档房间」，成员与记录会保留';
    if (/owner only/.test(m)) return '只有房主可以操作';
    if (/forbidden/.test(m)) return '你已不是这个房间的成员，请重新加入';
    if (/room archived/.test(m)) return '房间已归档，等待房主恢复';
    if (/room not found/.test(m)) return '找不到这个房间，请检查房间码';
    if (/unauthenticated|401/.test(m)) return '登录已过期，请重新登录';
    if (/network|fetch|timeout|abort/i.test(m)) return '暂时连不上房间服务，请重试；本机记录保留';
    return m || '房间请求失败，请重试';
  }
  async function rpc(action, code, data) {
    const owner = context();
    if (navigator.onLine === false) throw new Error('当前离线，请联网后重试');
    const database = await Cloud.db();
    if (!database || !database.rpc) throw new Error('房间服务未加载，请刷新重试');
    const response = await database.rpc('rigong_rooms_v19', { p_action: action, p_code: code || null, p_data: data || {} });
    if (owner !== uid() || context() !== owner) throw new Error('账号已变化，本次房间操作已停止');
    if (response.error) throw response.error;
    const envelope = Array.isArray(response.data) ? response.data[0] : response.data;
    if (!envelope || envelope.account_id !== owner || !('data' in envelope)) throw new Error('房间账号响应异常');
    return envelope.data;
  }
  function once(key, work) {
    key = uid() + ':' + key;
    if (inflight.has(key)) return inflight.get(key);
    const promise = work().finally(() => inflight.delete(key));
    inflight.set(key, promise); return promise;
  }
  function profile() { return { nickname: String(Store.s.settings.nickname || '').trim(), emoji: Store.s.settings.roomEmoji || '🙂' }; }
  function setProfile(name, emoji) { Store.commit(s => { s.settings.nickname = String(name || '').trim().slice(0, 12); if (emoji) s.settings.roomEmoji = emoji; }); }
  function myRooms() {
    const owner = uid();
    if (!owner || Store.s.settings.cloudAccountId && Store.s.settings.cloudAccountId !== owner) return [];
    return (Store.s.rooms || []).filter(r => r && r.code && !r.archived_at && (!r.accountId || r.accountId === owner));
  }
  function archivedRooms() { return (Store.s.rooms || []).filter(r => r.accountId === uid() && r.owner && r.archived_at); }
  function findRoom(code) { return myRooms().find(r => r.code === String(code || '').toUpperCase()); }
  function addLocal(room) {
    Store.commit(s => {
      const list = s.rooms || (s.rooms = []), i = list.findIndex(r => r.code === room.code);
      const data = Object.assign({}, room, { accountId: uid(), id: i >= 0 ? list[i].id : U.uid('room') });
      if (i >= 0) list[i] = Object.assign({}, list[i], data); else list.push(data);
    });
  }
  function dropLocal(code) { Store.commit(s => { s.rooms = (s.rooms || []).filter(r => r.code !== code); if (!myRooms().some(r => r.id === s.activeRoomId)) s.activeRoomId = null; }); }
  function activeCode() { const list = myRooms(); const active = list.find(r => r.id === Store.s.activeRoomId); return (active || list[0] || {}).code || ''; }
  function setActive(code) { const room = findRoom(code); if (room) Store.commit(s => { s.activeRoomId = room.id; }); }
  function newCode() { const bytes = new Uint8Array(6); crypto.getRandomValues(bytes); return Array.from(bytes, x => chars[x % chars.length]).join(''); }
  function todayStats() {
    const day = U.today(), r = Engine.todayRate(day);
    return { day, rate: Math.round(r.pct || 0), done: r.done || 0, total: r.total || 0, streak: Engine.globalStreak() || 0, points: Engine.points() || 0 };
  }
  function membershipData(opt) {
    const p = profile(); if (!p.nickname) throw new Error('请先设置昵称');
    return Object.assign({}, opt, { nickname: p.nickname, profile_emoji: p.emoji });
  }
  async function mutate(action, code, data, update) {
    return once(action + ':' + code + (action === 'share' ? ':' + data.habit_id : ''), async () => {
      try { emit('saving', '正在更新房间…'); const result = await rpc(action, code, data); if (update) update(result); emit('saved', '房间已更新'); return { ok: true, code, name: result && result.name }; }
      catch (e) { const msg = error(e); emit('error', msg); return { ok: false, msg }; }
    });
  }
  function create(opt) {
    return once('create', async () => {
      try {
        const data = membershipData(Object.assign({ name: '我的房间', visibility: 'private' }, opt));
        const owner=context(), signature=JSON.stringify(data);
        for (let i = 0; i < 5; i++) {
          const draft=Store.s.roomCreateDraft;
          const code=draft && draft.owner===owner && draft.signature===signature ? draft.code : newCode();
          Store.commit(st=>{st.roomCreateDraft={owner,signature,code};});
          await Store.saveNow();
          const result = await mutate('create', code, data, row => { addLocal(row); setActive(code); });
          if(result.ok) Store.commit(st=>{delete st.roomCreateDraft;});
          if (result.ok || !/房间码冲突/.test(result.msg)) return result;
          Store.commit(st=>{delete st.roomCreateDraft;});
        }
        return { ok: false, msg: '房间码暂时冲突，请重试' };
      } catch (e) { return { ok: false, msg: error(e) }; }
    });
  }
  function join(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return Promise.resolve({ ok: false, msg: '请输入 6 位字母数字房间码' });
    try { return mutate('join', code, membershipData(), row => { addLocal(row); setActive(code); }); }
    catch (e) { return Promise.resolve({ ok: false, msg: error(e) }); }
  }
  const leave = code => mutate('leave', code, {}, () => dropLocal(code));
  const dissolve = code => mutate('archive', code, {}, () => addLocal({ code, archived_at: new Date().toISOString() }));
  const restore = code => mutate('restore', code, {}, () => addLocal({ code, archived_at: null }));
  const setVisibility = (code, visibility) => mutate('visibility', code, { visibility }, () => addLocal({ code, visibility }));
  async function getRoom(code) { try { return await rpc('get', code); } catch (_) { return null; } }
  async function refreshInfo() {
    try {
      const rows = await rpc('list');
      const owner = uid();
      Store.commit(s => {
        const old = s.rooms || [];
        s.rooms = rows.map(row => Object.assign({}, old.find(x => x.code === row.code), row, { accountId: owner,
          id: (old.find(x => x.code === row.code) || {}).id || U.uid('room') }));
      });
      return rows.length;
    } catch (e) { emit('error', error(e)); return 0; }
  }
  const migrate = refreshInfo; // 匿名房间归属只能由受信管理端审核迁移，客户端不能认领。
  function outbox() { return Store.s.roomShareOutbox || []; }
  function pendingRevoke(code, id) { return outbox().some(x => x.owner === uid() && x.code === code && x.id === id); }
  function clearRevoke(code, id) { Store.commit(s => { s.roomShareOutbox = outbox().filter(x => !(x.owner === uid() && x.code === code && x.id === id)); }); }
  async function shares(code) {
    const owner=context(), key=owner+':'+code;
    if(navigator.onLine===false) {
      const rows=Store.s.roomShareHints && Store.s.roomShareHints[key];
      if(!rows) throw new Error('离线且没有已确认的共享设置，请联网后读取');
      const cached=JSON.parse(JSON.stringify(rows)); cached.offline=true; return cached;
    }
    const rows=await rpc('shares',code);
    Store.commit(s=>{ (s.roomShareHints || (s.roomShareHints={}))[key]=rows; });
    return rows;
  }
  function details(it) { return { name: String(it.name).slice(0,160), type: it.type, target: Number(it.target) || 1, unit: String(it.unit || '').slice(0,30) }; }
  function progress(it) {
    const day = U.today(), log = Engine.getLog(day,it.id) || {};
    return Object.assign(details(it), { habit_id: it.id, value: it.type === 'check' || it.type === 'avoid' ? (Engine.isDone(it,day) ? 1 : 0) : Number(log.v) || 0,
      status: !Engine.isDue(it,day) ? 'rest' : Engine.isSkipped(day,it.id) ? 'skipped' : Engine.isDone(it,day) ? 'done' : 'pending' });
  }
  async function setHabitSharing(code, id, enabled) {
    try {
      const owner = context(), it = (Store.s.items || []).find(x => x.id === id && !x.deleted && !x.archived);
      if (enabled && !it) throw new Error('习惯不存在或已归档');
      if (enabled && pendingRevoke(code,id)) throw new Error('先联网完成待撤回，再重新开启共享');
      if (!enabled) {
        Store.commit(s => { s.roomShareOutbox = outbox().filter(x => !(x.owner === owner && x.code === code && x.id === id)).concat([{ owner,code,id }]); });
        try { await Store.saveNow(); } catch (_) { return { ok:false,msg:'撤回尚未保存，请保持页面打开并重试' }; }
        if (navigator.onLine === false) { emit('pending', '共享撤回待联网确认'); return { ok:false,pending:true,msg:status.msg }; }
      }
      const result = await mutate('share', code, { habit_id:id,enabled,day:U.today(),details:it ? details(it) : {} });
      if (result.ok) { clearRevoke(code,id); if (enabled) await sync(); }
      else if (!enabled) { result.pending = true; result.msg = '共享撤回待联网确认：' + result.msg; emit('pending',result.msg); }
      return result;
    } catch (e) { return { ok:false,msg:error(e) }; }
  }
  async function flushRevokes() {
    for (const x of outbox().filter(x => x.owner === uid()).slice()) {
      try { await rpc('share',x.code,{ habit_id:x.id,enabled:false,day:U.today() }); }
      catch(e) { if(!/^(forbidden|room archived|room not found)$/.test(String(e.message))) throw e; }
      clearRevoke(x.code,x.id);
    }
  }
  function sync() {
    if (syncing) return syncing;
    const started=fingerprint(); let complete=false;
    syncing = (async () => {
      try {
        context(); emit('saving','房间正在更新…'); await flushRevokes();
        const rooms = myRooms(), p=profile(); let count=0;
        for (const room of rooms) {
          const list=await shares(room.code), habits=[];
          for (const share of list.filter(x => x.enabled)) {
            const it=(Store.s.items || []).find(x => x.id === share.habit_id && !x.deleted && !x.archived);
            if (!it) { await rpc('share',room.code,{habit_id:share.habit_id,enabled:false,day:U.today()}); continue; }
            habits.push(progress(it));
          }
          await rpc('sync',room.code,Object.assign(todayStats(),{nickname:p.nickname,profile_emoji:p.emoji,habits}));
          addLocal({code:room.code,lastSync:Date.now()}); count++;
        }
        complete=true;
        emit('saved',count ? count+' 个房间已更新' : '还没有加入房间');
        return {ok:true,msg:status.msg};
      } catch(e) { emit(outbox().some(x => x.owner===uid()) ? 'pending' : 'error',error(e)); return {ok:false,msg:status.msg}; }
    })().finally(() => { syncing=null; if(complete && fingerprint()!==started) { observed=''; observe(); } });
    return syncing;
  }
  async function ranking(code) {
    try { const list=(await rpc('ranking',code)).map(m => Object.assign(m,{rate:Number(m.rate)||0,streak:Number(m.streak)||0,points:Number(m.points)||0,stale:m.day!==U.today()}));
      list.sort((a,b)=>Number(a.stale)-Number(b.stale)||b.rate-a.rate||b.points-a.points||a.name.localeCompare(b.name));
      return {ok:true,list};
    } catch(e) {return {ok:false,list:[],msg:error(e)};}
  }
  async function sharedProgress(code) { try {return {ok:true,list:await rpc('progress',code,{day:U.today()})};} catch(e){return {ok:false,list:[],msg:error(e)};} }
  async function plaza() { try {return {ok:true,list:(await rpc('plaza')).map(x=>Object.assign(x,{count:x.member_count,joined:!!findRoom(x.code)}))};} catch(e){return {ok:false,list:[],msg:error(e)};} }
  /* v41 · 报告五-2：邀请链接带上来源参数，方便看「朋友邀请」带来的打开量。
   * 参数放在 # 之前（hash 里是房间码，不能被污染）。 */
  function inviteLink(code) {
    return location.origin + location.pathname +
      '?utm_source=invite&utm_medium=room#room=' + encodeURIComponent(code);
  }
  function fingerprint() {
    if(!Store.s || !uid()) return '';
    return JSON.stringify([uid(),todayStats(),profile(),myRooms().map(x=>x.code),
      (Store.s.items||[]).map(x=>[x.id,x.name,x.type,x.unit,x.target,x.deleted,x.archived,progress(x)]),
      outbox().filter(x=>x.owner===uid())]);
  }
  function observe() {
    if(!uid() || !myRooms().length || Store.s.settings.autoSync===false) return;
    const next=fingerprint(); if(next===observed) return;
    observed=next; clearTimeout(autoTimer);
    autoTimer=setTimeout(()=>{autoTimer=null;sync();},1800);
  }
  Store.onChange(observe);
  window.addEventListener('online',()=>{
    if(!uid()) return;
    if(Store.s.settings.autoSync===false) flushRevokes().catch(e=>emit('pending',error(e)));
    else sync();
  });
  window.addEventListener('focus',()=>{ if(Store.s && uid() && myRooms().length && Store.s.settings.autoSync!==false) sync(); });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && Store.s && uid() && myRooms().length && Store.s.settings.autoSync!==false) sync(); });
  setInterval(()=>{ if(!document.hidden && window.UI && UI.tab==='rooms' && uid() && myRooms().length && Store.s.settings.autoSync!==false) sync(); },180000);

  return {ref,isAnon,profile,setProfile,migrate,create,join,leave,dissolve,restore,getRoom,setVisibility,sync,ranking,plaza,refreshInfo,
    myRooms,archivedRooms,findRoom,activeCode,setActive,todayStats,inviteLink,newCode,shares,setHabitSharing,sharedProgress,pendingRevoke,
    onChange:fn=>listeners.push(fn),get status(){return Object.assign({},status);} };
})();
