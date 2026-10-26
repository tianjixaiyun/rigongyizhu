const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
async function cloud(t,mode){
 const dom=new JSDOM('<body></body>',{url:'https://test.example/',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
 const w=dom.window;t.after(()=>w.close());w.indexedDB=new IDBFactory();w.structuredClone=structuredClone;
 w.fetch=async()=>({status:401,headers:{get:()=> 'application/json'}});
 for(const f of ['util','sync-model','store'])w.eval(read('src/'+f+'.js'));
 w.Store.initSync();await w.Store.init();w.Store._doSave=()=>{};
 let payload=null,revision=0,legacy=0;const calls=[];
 w.WorkBuddyCloud={createWorkBuddyCloud:()=>({
  auth:{handleWechatWebCallback:async()=>({data:null}),getSession:async()=>({data:{user:{id:'A'}}}),onAuthStateChange(){}},
  database:{
   from(){legacy++;throw new Error('Legacy tables must not be touched');},
   rpc:async(name,args)=>{
    calls.push(name);
    if(name==='rigong_sync_pull'){
     if(mode==='permission')return {error:{code:'42501',message:'permission denied for function rigong_sync_pull'}};
     if(mode==='cache')return {error:{code:'PGRST205',message:'rigong_sync_pull schema cache access failed'}};
     return {error:{code:'PGRST202',message:'Could not find the function public.rigong_sync_pull in the schema cache'}};
    }
    if(name.endsWith('push')){payload=args.p_payload;revision++;}
    return {data:{owner_id:mode==='wrong-owner'?'B':'A',payload,revision,updated_at:new Date().toISOString()}};
   }
  },storage:{}
 })};
 w.eval(read('src/cloud-v18.js'));await w.Cloud.boot();
 return {w,calls,legacy:()=>legacy};
}
test('权限错误和非函数缓存错误不会降级，也不直接读写旧快照',async t=>{
 for(const mode of ['permission','cache']){
  const a=await cloud(t,mode);await assert.rejects(a.w.Cloud.syncNow());
  assert.deepEqual(a.calls,['rigong_sync_pull']);assert.equal(a.legacy(),0);
 }
});
test('仅确认函数缺失时走兼容 RPC；仍检查账号与版本，且不清理快照',async t=>{
 const a=await cloud(t,'missing');await a.w.Cloud.syncNow();
 assert.ok(a.calls.includes('rigong_sync_compat_pull'));assert.ok(a.calls.includes('rigong_sync_compat_push'));assert.equal(a.legacy(),0);
 const b=await cloud(t,'wrong-owner');await assert.rejects(b.w.Cloud.syncNow(),/账号或版本/);
 assert.equal(b.calls.filter(x=>x.endsWith('push')).length,0);assert.equal(b.legacy(),0);
});
test('兼容 RPC 调用真实原子同步函数，继承账号隔离和版本冲突语义',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE ROLE authenticated;CREATE ROLE anon;');
 await db.exec(read('backend/001_cloud_sync.sql'));await db.exec(read('backend/004_sync_compat.sql'));
 const call=(who,name,args=[])=>db.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE authenticated');
  await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:who})]);
  return (await tx.query('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)+(i===1?'::jsonb':'')).join(',')+') data',args)).rows[0].data;
 });
 const payload={version:7,items:[],logs:{},notes:{},settings:{},_sync:{version:1,records:{}}};
 const first=await call('A','rigong_sync_compat_push',[0,JSON.stringify(payload)]);assert.equal(first.owner_id,'A');
 const conflict=await call('A','rigong_sync_compat_push',[0,JSON.stringify(payload)]);assert.equal(conflict.conflict,true);
 const other=await call('B','rigong_sync_compat_pull');assert.equal(other.payload,null);
});
test('版本离线缓存完整安装；离线导航与脚本来自当前版本，云接口不入缓存',async()=>{
 const source=read('sw.js'),events={},files=new Map(),cache=new Map(),url='https://test.example/';
 /* 版本号跟着 util.js 走，不再写死 —— 否则每升一次版本这个测试就红一次 */
 const curV=/VERSION:\s*'([^']+)'/.exec(read('src/util.js'))[1],curCache='rigongyizhu-v'+curV,oldCache='rigongyizhu-v9.9';
 let skipped=false,claimed=false,network=false;
 const toURL=x=>new URL(typeof x==='string'?x:x.url,url).href;
 const storage={addAll:async paths=>{for(const p of paths){const rel=new URL(p,url).pathname.slice(1)||'index.html';assert.ok(fs.existsSync(path.join(root,rel)),p);cache.set(toURL(p),new Response(read(rel)));}},
  /* v34：可选资源走单个 add，失败不牵连整批（见 sw-v34.test.cjs） */
  add:async p=>{const rel=new URL(p,url).pathname.slice(1)||'index.html';assert.ok(fs.existsSync(path.join(root,rel)),p);cache.set(toURL(p),new Response(read(rel)));},
  match:async req=>cache.get(toURL(req))?.clone()};
 const caches={open:async name=>{assert.equal(name,curCache);return storage;},keys:async()=>[oldCache,curCache],delete:async name=>{assert.equal(name,oldCache);return true;}};
 const self={addEventListener:(name,fn)=>events[name]=fn,skipWaiting:()=>{skipped=true;},clients:{claim:()=>{claimed=true;}}};
 vm.runInNewContext(source,{self,caches,URL,location:{origin:url.slice(0,-1),href:url+'sw.js'},fetch:async()=>{network=true;throw new Error('offline');},Promise});
 let wait;events.install({waitUntil:p=>wait=p});await wait;
 /* v53 · 报告 P2-10：装好先停在 waiting，等页面发 SKIP_WAITING 再切 */
 assert.ok(!skipped,'安装完成后不应自动 skipWaiting');
 events.message({data:{type:'SKIP_WAITING'}});assert.ok(skipped,'收到 SKIP_WAITING 才让路');
 events.activate({waitUntil:p=>wait=p});await wait;assert.ok(claimed);
 let response;events.fetch({request:{url,method:'GET',mode:'navigate'},respondWith:p=>response=p});
 assert.match(await(await response).text(),new RegExp('src/friends-v19\\.js\\?v='+curV));
 /* v25 · 评审 5.5：HTML 改成 network-first —— 先问网络，断网才退回缓存 */
 assert.equal(network,true,'导航请求应先去网络');
 network=false;
 events.fetch({request:{url:url+'src/friends-v19.js?v='+curV,method:'GET'},respondWith:p=>response=p});
 assert.match(await(await response).text(),/window.Friends/);assert.equal(network,false);
 let handled=false;events.fetch({request:{url:url+'.cloud/private',method:'GET'},respondWith(){handled=true;}});assert.equal(handled,false);
 assert.ok([...cache.keys()].some(x=>x.includes('vendor/cloud-sdk.js?v='+curV)));
});
