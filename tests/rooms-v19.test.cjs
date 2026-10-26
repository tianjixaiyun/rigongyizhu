const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const day=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
async function database(t) {
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE ROLE authenticated; CREATE ROLE anon;');
 await db.exec(read('backend/002_rooms_v19.sql'));
 return db;
}
async function as(db,who,fn,role='authenticated') {
 return db.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE '+role);
  await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify(who?{sub:who}:{})]);
  return fn(tx);
 });
}
async function call(db,who,action,code=null,data={}) {
 return as(db,who,async tx=>(await tx.query('SELECT public.rigong_rooms_v19($1,$2,$3::jsonb) result',[action,code,JSON.stringify(data)])).rows[0].result);
}
async function create(db,who='A',code='ABC123') {return call(db,who,'create',code,{name:'一起坚持',nickname:who});}
async function join(db,who='B',code='ABC123') {return call(db,who,'join',code,{nickname:who});}
async function share(db,enabled=true,id='habit1',extra={}) {return call(db,'A','share','ABC123',{habit_id:id,enabled,day:day(),details:{name:'阅读',type:'count',target:20,unit:'页',notes:'私密备注',photos:['secret']},...extra});}
async function app(t,db,who='A',all=false) {
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(read('index.html'),{url:'https://local-test.example/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window;t.after(()=>w.close());
 w.indexedDB=new IDBFactory();w.structuredClone=structuredClone;w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){}});
 let owner=who,fail=false,before=null,requests=[];
 const channel={rpc:async(name,args)=>{
   requests.push({name,args,owner});
   if(before) await before(name,args);
   if(fail) return {error:{message:'network failed'}};
   try{return {data:await call(db,owner,args.p_action,args.p_code,args.p_data)};}catch(e){return {error:{message:e.message,code:e.code}};}
 }};
 w.Cloud={uid:()=>owner,signedIn:()=>!!owner,db:async()=>channel,status:{state:'signed',msg:'尚未同步'},onChange(){}};
 const load=f=>w.eval(read('src/'+f+'.js'));
 if(all) {
   const scripts=[...w.document.querySelectorAll('script[defer][src]')].map(s=>new URL(s.getAttribute('src'),w.location.href).pathname.slice(1))
    .filter(x=>x.startsWith('src/')&&!x.endsWith('/main.js')&&!x.endsWith('/cloud-v18.js'));
   for(const file of scripts) w.eval(read(file));
 } else {load('util');load('store');load('engine');load('rooms');}
 w.Store.initSync();await w.Store.init();w.Store._doSave=()=>{};
 w.Store.commit(s=>{s.items=[{id:'habit1',name:'阅读',type:'count',target:20,unit:'页',createdAt:Date.now(),schedule:{type:'daily'},why:'私密动机',notes:'secret'}];s.logs={};s.rooms=[];s.settings.nickname=who;s.settings.cloudAccountId=who;s.settings.onboarded=1;s.settings.sound=false;});
 if(all){w.Diary.ensureWeather=async()=>null;w.fetch=async()=>{throw new Error('unexpected real network');};}
 return {w,errors,requests,fail:v=>{fail=v;},before:fn=>{before=fn;},switchOwner:v=>{owner=v;}};
}
test('房间迁移可重跑；建房与成员写入原子化；非成员、匿名与直接读表被拒绝',async t=>{
 const db=await database(t);await db.exec(read('backend/002_rooms_v19.sql'));
 await assert.rejects(call(db,'A','create','BAD123',{name:'坏房间',nickname:''}),/invalid profile/);
 assert.equal((await db.query("SELECT count(*) n FROM rigong_rooms_v19 WHERE code='BAD123'")).rows[0].n,0);
 const a=await create(db);assert.equal(a.account_id,'A');assert.equal(a.data.visibility,'private');
 await join(db);await join(db);assert.equal((await call(db,'A','list')).data[0].member_count,2);
 await assert.rejects(call(db,'C','ranking','ABC123'),/forbidden/);
 await assert.rejects(call(db,'C','progress','ABC123',{day:day()}),/forbidden/);
 await assert.rejects(call(db,null,'list'),/unauthenticated/);
 await assert.rejects(as(db,'A',tx=>tx.exec('SELECT * FROM rigong_rooms_v19')),/permission denied/);
 await assert.rejects(as(db,'A',tx=>tx.exec('SELECT * FROM rigong_room_progress_v19')),/permission denied/);
 await assert.rejects(call(db,'B','visibility','ABC123',{visibility:'public'}),/owner only/);
 assert.deepEqual((await call(db,'C','plaza')).data,[]);
});
test('共享默认关闭；服务端只存白名单、仅展示当天，未选择的习惯与附件不可见',async t=>{
 const db=await database(t);await create(db);await join(db);
 assert.deepEqual((await call(db,'B','progress','ABC123',{day:day()})).data,[]);
 await share(db);
 await call(db,'A','sync','ABC123',{day:day(),rate:50,done:1,total:2,notes:'secret diary',habits:[
  {habit_id:'habit1',value:7,status:'pending',text:'secret',photos:['secret']},
  {habit_id:'private',value:1,status:'done',enabled:true}
 ]});
 const progress=(await call(db,'B','progress','ABC123',{day:day()})).data;
 assert.equal(progress.length,1);assert.equal(progress[0].name,'阅读');assert.equal(progress[0].value,7);
 assert.doesNotMatch(JSON.stringify(progress),/secret|photos|notes|private|owner_id/);
 const raw=(await db.query('SELECT details FROM rigong_room_shares_v19')).rows[0].details;
 assert.deepEqual(Object.keys(raw).sort(),['name','target','type','unit']);
 const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
 const before=[yesterday.getFullYear(),String(yesterday.getMonth()+1).padStart(2,'0'),String(yesterday.getDate()).padStart(2,'0')].join('-');
 assert.deepEqual((await call(db,'B','progress','ABC123',{day:before})).data,[]);
 await assert.rejects(call(db,'A','sync','ABC123',{day:'2000-01-01',habits:[]}),/today only/);
});
test('撤回后旧上传不能复活共享；退出与归档隐藏进度，恢复保留成员但不恢复共享',async t=>{
 const db=await database(t);await create(db);await join(db);await share(db);
 await call(db,'A','sync','ABC123',{day:day(),habits:[{habit_id:'habit1',value:20,status:'done'}]});
 await share(db,false);
 await call(db,'A','sync','ABC123',{day:day(),habits:[{habit_id:'habit1',value:22,status:'done',enabled:true}]});
 assert.deepEqual((await call(db,'B','progress','ABC123',{day:day()})).data,[]);
 await share(db,true);await call(db,'A','archive','ABC123');
 await assert.rejects(join(db,'C'),/room archived/);
 await assert.rejects(call(db,'B','ranking','ABC123'),/room archived/);
 assert.ok((await call(db,'A','list')).data[0].archived_at);
 await call(db,'A','restore','ABC123');
 assert.equal((await call(db,'A','list')).data[0].member_count,2);
 assert.deepEqual((await call(db,'B','progress','ABC123',{day:day()})).data,[]);
 await assert.rejects(call(db,'A','leave','ABC123'),/owner must archive/);
 await call(db,'B','leave','ABC123');await assert.rejects(call(db,'B','ranking','ABC123'),/forbidden/);
});
test('旧房间审核迁移保持原邀请码、账号和成员；匿名身份不自动认领',async t=>{
 const db=await database(t);
 await db.exec("CREATE TABLE rooms(code text,owner_ref text,name text);CREATE TABLE room_members(code text,ref text,nickname text);INSERT INTO rooms VALUES('OLD123','u:A','原房间'),('ANO123','a:guess','匿名房间');INSERT INTO room_members VALUES('OLD123','u:B','朋友'),('OLD123','a:guess','匿名');");
 await db.exec(read('backend/003_import_legacy_rooms.sql'));await db.exec(read('backend/003_import_legacy_rooms.sql'));
 assert.equal((await call(db,'A','list')).data[0].code,'OLD123');assert.equal((await call(db,'B','list')).data.length,1);
 assert.equal((await db.query('SELECT count(*) n FROM rooms')).rows[0].n,2);
 assert.equal((await db.query('SELECT count(*) n FROM rigong_room_members_v19')).rows[0].n,2);
 assert.deepEqual((await call(db,'guess','list')).data,[]);
});
test('真实前端建房防重复；退出失败保留本地列表；切换账号中止回写',async t=>{
 const db=await database(t),a=await app(t,db),w=a.w;
 delete w.Store.s.settings.cloudAccountId;
 const results=await Promise.all([w.Rooms.create({name:'阅读小队'}),w.Rooms.create({name:'阅读小队'})]);
 assert.ok(results.every(x=>x.ok));assert.equal(w.Rooms.myRooms().length,1);assert.equal(w.Store.s.settings.cloudAccountId,'A');
 assert.equal(a.requests.filter(x=>x.args.p_action==='create').length,1);
 a.fail(true);const before=w.Rooms.myRooms()[0].code;
 assert.equal((await w.Rooms.leave(before)).ok,false);assert.equal(w.Rooms.myRooms()[0].code,before);
 a.fail(false);let finish;const gate=new Promise(r=>finish=r);
 a.before(async()=>{await gate;});const pending=w.Rooms.create({name:'切换时创建'});
 a.switchOwner('B');finish();assert.equal((await pending).ok,false);assert.equal(w.Rooms.myRooms().length,0);
});
test('共享前端联通真实 SQL；离线撤回持久保存，重连优先撤回；跨账号不发送旧队列',async t=>{
 const db=await database(t),a=await app(t,db),w=a.w;
 const room=await w.Rooms.create({name:'一起读书'});assert.ok(room.ok);await join(db,'B',room.code);
 const shareResult=await w.Rooms.setHabitSharing(room.code,'habit1',true);assert.ok(shareResult.ok);
 const visible=(await call(db,'B','progress',room.code,{day:day()})).data;
 assert.equal(visible.length,1);assert.doesNotMatch(JSON.stringify(a.requests),/私密动机|secret/);
 await w.Rooms.shares(room.code);
 Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});
 const result=await w.Rooms.setHabitSharing(room.code,'habit1',false);assert.equal(result.pending,true);
 assert.ok(w.Rooms.pendingRevoke(room.code,'habit1'));
 const idb=await new Promise(resolve=>{const req=w.indexedDB.open('rigongyizhu',1);req.onsuccess=()=>resolve(req.result);});
 const saved=await new Promise(resolve=>{const req=idb.transaction('kv').objectStore('kv').get('state');req.onsuccess=()=>resolve(req.result);});
 assert.equal(saved.roomShareOutbox.length,1);idb.close();
 assert.equal((await w.Rooms.shares(room.code)).offline,true);
 const count=a.requests.length;a.switchOwner('B');Object.defineProperty(w.navigator,'onLine',{value:true,configurable:true});
 assert.equal((await w.Rooms.sync()).ok,false);assert.equal(a.requests.length,count);
 a.switchOwner('A');assert.ok((await w.Rooms.sync()).ok);assert.equal(w.Rooms.pendingRevoke(room.code,'habit1'),false);
 assert.deepEqual((await call(db,'B','progress',room.code,{day:day()})).data,[]);
});
test('真实房间页面、共享开关与归档恢复可用，恶意习惯名按文本显示',async t=>{
 const db=await database(t),a=await app(t,db,'A',true),w=a.w;
 assert.ok((await w.Rooms.create({name:'好友房间'})).ok);
 w.UI.go('rooms');assert.ok(w.document.querySelector('[data-friend="manage"]'));
 await w.Friends.manage(w.Rooms.activeCode());
 const toggle=w.document.querySelector('[data-friend="toggle"]');assert.equal(toggle.getAttribute('aria-checked'),'false');
 w.Store.s.items[0].name='<img src=x onerror=alert(1)>';w.Store.bump();
 await w.Rooms.setHabitSharing(w.Rooms.activeCode(),'habit1',true);
 w.UI.go('rooms');await w.Friends.paint(w.Rooms.activeCode(),w.Cloud.uid());
 assert.ok(w.document.getElementById('friendProgress').textContent.includes('<img'));assert.equal(w.document.querySelector('#friendProgress img'),null);
 w.Store.s.items[0].archived=true;w.Store.bump();await w.Friends.manage(w.Rooms.activeCode());
 assert.ok(w.document.querySelector('[data-friend="toggle"]'),'归档习惯仍可主动撤回共享');
 assert.deepEqual(a.errors,[]);
});
test('按天、按周最佳分别展示，原网格与快速记录入口仍存在',async t=>{
 const db=await database(t),a=await app(t,db,'A',true),w=a.w;
 w.Store.s.items.push({id:'weekly',name:'每周锻炼',type:'check',schedule:{type:'timesPerWeek',n:1}});
 w.Store.bump();const original=w.Engine.bestStreak;w.Engine.bestStreak=id=>id==='weekly'?8:3;
 w.UI.go('today');assert.equal(w.document.getElementById('bestNum').textContent,'3');assert.equal(w.document.getElementById('bestWeeks').textContent,'8');
 w.Store.s.settings.gridView=true;w.UI.render();assert.ok(w.document.querySelector('.p-grid'));assert.ok(w.document.querySelector('[data-act="quickadd"]'));
 w.Engine.bestStreak=original;
});
module.exports={};

test('计数、计时或撤销引起的记录变化会自动更新房间，纯日记编辑不发送房间数据',async t=>{
 const db=await database(t),a=await app(t,db),w=a.w;
 const r=await w.Rooms.create({name:'自动更新'});await join(db,'B',r.code);await w.Rooms.setHabitSharing(r.code,'habit1',true);
 w.Engine.addValue(w.Store.s.items[0],w.U.today(),9);w.Store.commit();
 await new Promise(resolve=>w.setTimeout(resolve,2100));
 let result=(await call(db,'B','progress',r.code,{day:day()})).data;assert.equal(result[0].value,9);
 const count=a.requests.length;w.Store.commit(s=>{s.notes[w.U.today()]={text:'只写给自己',photos:[],audios:[]};});
 await new Promise(resolve=>w.setTimeout(resolve,2000));assert.equal(a.requests.length,count);
});

test('建房响应丢失后重试复用同一房间码，不重复创建',async t=>{
 const db=await database(t),a=await app(t,db),w=a.w;
 let once=true;
 a.before(async(name,args)=>{
  if(once&&args.p_action==='create'){once=false;await call(db,'A','create',args.p_code,args.p_data);throw new Error('network failed after commit');}
 });
 const first=await w.Rooms.create({name:'重复请求'});assert.equal(first.ok,false);
 const second=await w.Rooms.create({name:'重复请求'});assert.ok(second.ok);
 assert.equal((await call(db,'A','list')).data.length,1);
 assert.equal(a.requests.filter(x=>x.args.p_action==='create')[0].args.p_code,second.code);
});
