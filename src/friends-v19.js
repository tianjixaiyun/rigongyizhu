/* v19 好友共享界面。只使用 Rooms 返回的白名单字段，不渲染日记或媒体。 */
window.Friends = (function () {
  let paintSequence=0, sheetSequence=0;
  const E = x => U.esc(String(x == null ? '' : x));
  function archiveHTML() {
    const rows=Rooms.archivedRooms();
    if(!rows.length) return '';
    return '<details class="v19-archives"><summary>已归档的房间 · '+rows.length+'</summary>'+rows.map(r=>
      '<div class="v19-share-row"><span>'+E(r.name || r.code)+'</span><button class="btn sm ghost" data-friend="restore" data-code="'+E(r.code)+'">恢复房间</button></div>').join('')+'</details>';
  }
  function section(room) {
    if(!room) return '';
    const code=room.code, owner=Cloud.uid();
    setTimeout(()=>paint(code,owner),0);
    return '<section class="v19-friends" aria-labelledby="friendHeading"><div class="v19-section-heading"><div><h2 id="friendHeading">一起做的小事</h2><p>只有你选中的习惯会在这里展示</p></div>' +
      '<button class="btn sm ghost" data-friend="manage" data-code="'+E(code)+'">选择共享习惯</button></div>' +
      '<p id="roomSyncStatus" class="v19-sync" role="status" aria-live="polite">'+E(Rooms.status.msg)+'</p>' +
      '<div id="friendProgress" data-room="'+E(code)+'"><p class="muted">正在获取今天的共享进度…</p></div>' +
      '<button class="v19-text-button" data-friend="refresh" data-code="'+E(code)+'">刷新好友进度</button></section>';
  }
  async function paint(code,owner) {
    const box=document.getElementById('friendProgress');
    if(!box || box.dataset.room!==code) return;
    const ticket=++paintSequence;
    const result=await Rooms.sharedProgress(code);
    if(ticket!==paintSequence || !box.isConnected || box.dataset.room!==Rooms.activeCode() || Cloud.uid()!==owner) return;
    if(!result.ok) { box.innerHTML='<p class="muted">'+E(result.msg)+'</p>';return; }
    if(!result.list.length) {box.innerHTML='<div class="v19-empty"><b>从一件小事开始</b><p>选一个愿意分享的习惯，朋友就能看到你的当天进度。</p></div>';return;}
    const labels={done:'已完成',pending:'进行中',skipped:'今日请假',rest:'今日休息'};
    box.innerHTML=result.list.map(x=>
      '<article class="v19-progress-row"><div><span class="v19-person">'+E(x.nickname)+(x.me?' · 我':'')+'</span><h3>'+E(x.name)+'</h3><p>'+E(x.value == null ? '等待本人更新' : x.type==='check'||x.type==='avoid' ? labels[x.status]||'等待更新' : x.value+' / '+x.target+' '+x.unit)+'</p></div>' +
      '<span class="v19-status '+(x.status==='done'?'done':'')+'">'+E(labels[x.status]||'未更新')+'</span></article>').join('');
  }
  async function manage(code,onlyId) {
    const owner=Cloud.uid(), ticket=++sheetSequence;
    UI.sheet('选择共享习惯','<p class="muted" data-friend-loading="'+ticket+'">正在读取共享设置…</p>');
    const body=document.getElementById('sheetBody');
    try {
      const grants=await Rooms.shares(code);
      if(ticket!==sheetSequence || !body.querySelector('[data-friend-loading="'+ticket+'"]') || document.getElementById('sheet').getAttribute('aria-hidden')==='true' || Cloud.uid()!==owner || !Rooms.findRoom(code)) return;
      const active=Engine.items(), visible=active.slice();
      for(const grant of grants.filter(x=>x.enabled)) {
        if(!visible.some(x=>x.id===grant.habit_id)) {
          const local=(Store.s.items||[]).find(x=>x.id===grant.habit_id);
          visible.push(Object.assign({},local||{name:'已不在本机的共享习惯'},{id:grant.habit_id,unavailable:true}));
        }
      }
      const items=visible.filter(x=>!onlyId||x.id===onlyId);
      body.innerHTML='<p class="v19-privacy">仅向「'+E((Rooms.findRoom(code)||{}).name||code)+'」成员展示名称、目标、单位和当天进度。日记、备注、照片和语音不共享，开启前的记录不补传。</p>' +
        (grants.offline ? '<p class="v19-sync">当前离线，以下为上次确认的状态；可提交撤回，联网后确认。</p>':'') +
        '<div class="v19-share-list">'+items.map(it=>{
          const grant=grants.find(x=>x.habit_id===it.id), pending=Rooms.pendingRevoke(code,it.id), enabled=!!(grant&&grant.enabled)&&!pending;
          return '<div class="v19-share-row"><div><b>'+E(it.name)+'</b><p>'+E(pending?'撤回待联网确认':enabled?(it.unavailable?'已归档或移除，仍在共享，可撤回':'已向这个房间共享'):'仅自己可见')+'</p></div>'+
            '<button class="v19-toggle" role="switch" aria-checked="'+enabled+'" aria-label="向房间共享 '+E(it.name)+'" data-friend="toggle" data-code="'+E(code)+'" data-id="'+E(it.id)+'" data-enabled="'+enabled+'"'+(pending?' disabled':'')+'><span></span></button></div>';
        }).join('')+'</div>'+(items.length?'':'<p class="muted">还没有可共享的习惯，先添加一个吧。</p>');
    } catch(e) {
      if(ticket===sheetSequence && Cloud.uid()===owner && body.querySelector('[data-friend-loading="'+ticket+'"]')) body.innerHTML='<p class="muted">'+E(e.message||'读取失败，请重试')+'</p>';
    }
  }
  function habit(id) {
    const rooms=Rooms.myRooms();
    UI.sheet('共享到好友房间','<p class="v19-privacy">选择一个房间，单独设置这个习惯的可见范围。默认仅自己可见。</p>'+
      rooms.map(r=>'<button class="v19-room-choice" data-friend="manage" data-code="'+E(r.code)+'" data-id="'+E(id)+'">'+E(r.name||r.code)+'<span>设置共享 ›</span></button>').join('')+
      (rooms.length?'':'<p class="muted">先登录并加入一个好友房间。</p>'));
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-friend]');
    if(!button || button.disabled) return;
    const {friend,code,id}=button.dataset;
    button.disabled=true;
    try {
      if(friend==='manage') await manage(code,id);
      if(friend==='habit') habit(id);
      if(friend==='toggle') {
        const result=await Rooms.setHabitSharing(code,id,button.dataset.enabled!=='true');
        U.toast(result.pending ? '撤回已记录，待联网确认' : result.ok ? (button.dataset.enabled==='true'?'共享已撤回':'共享已开启') : result.msg);
        if(button.isConnected && document.getElementById('sheet').getAttribute('aria-hidden')!=='true') await manage(code);
        const next=Array.from(document.querySelectorAll('[data-friend="toggle"]')).find(x=>x.dataset.id===id);
        if(next) next.focus();
        if(UI.tab==='rooms') paint(code,Cloud.uid());
      }
      if(friend==='refresh') { await Rooms.sync(); await paint(code,Cloud.uid()); if(window.UI) UI.paintRoomRank('#roomRank'); }
      if(friend==='restore') { const r=await Rooms.restore(code); U.toast(r.ok?'房间已恢复，习惯共享仍保持关闭':r.msg); if(r.ok) UI.render(); }
    } catch(e) {U.toast(e.message||'操作未完成，请重试');}
    finally {if(button.isConnected) button.disabled=false;}
  });
  Rooms.onChange(state=>{
    const el=document.getElementById('roomSyncStatus'); if(el) {el.textContent=state.msg;el.dataset.state=state.state;}
    if(state.state==='saved' && window.UI && UI.tab==='rooms') { const code=Rooms.activeCode(); if(code) {paint(code,Cloud.uid()); UI.paintRoomRank('#roomRank');} }
    if(window.Product && Store.s) Product.refresh();
  });
  return {section,archiveHTML,manage,habit,paint};
})();
