const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'backend/001_cloud_sync.sql'), 'utf8');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
async function database(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('CREATE ROLE authenticated; CREATE ROLE anon;');
  await db.exec(sql);
  return db;
}
async function as(db, uid, work, role = 'authenticated', extra = {}) {
  return db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE ' + role);
    await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, ...extra })]);
    return work(tx);
  });
}
async function call(db, uid, name, args = {}) {
  return as(db, uid, async tx => {
    const q = name === 'rigong_sync_pull'
      ? await tx.query('SELECT public.rigong_sync_pull() AS result')
      : await tx.query('SELECT public.rigong_sync_push($1::bigint,$2::jsonb) AS result', [args.p_revision, JSON.stringify(args.p_payload)]);
    return q.rows[0].result;
  });
}
async function app(t, db, owner = 'account-A') {
  const dom = new JSDOM(read('index.html'), { url: 'https://test.example/', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window; t.after(() => w.close());
  Object.defineProperty(w, 'indexedDB', { value: new IDBFactory() });
  w.structuredClone = structuredClone;
  w.fetch = async () => ({ status: 401, headers: { get: () => 'application/json' } });
  const evaluate = f => w.eval(read('src/' + f + '.js'));
  evaluate('util'); evaluate('sync-model'); evaluate('store');
  w.Store.initSync(); await w.Store.init(); w.Store._doSave = () => {};
  let who = owner, callback, beforeRpc = null;
  let count = 0, failUpload = false; const files = new Map();
  const transport = {
    auth: {
      handleWechatWebCallback: async () => ({ data: null }),
      getSession: async () => ({ data: who ? { user: { id: who } } : null }),
      onAuthStateChange: fn => { callback = fn; },
      signOut: async () => { who = null; callback('SIGNED_OUT', null); return {}; }
    },
    database: { rpc: async (name, args) => {
      count++; if (beforeRpc) await beforeRpc(name, args);
      try { return { data: await call(db, who, name, args) }; }
      catch (error) { return { error }; }
    } },
    storage: {
      userPath: (id, suffix) => 'users/' + id + '/' + suffix,
      upload: async (key, blob) => {
        if (failUpload) return { error: new Error('network upload failed') };
        if (!key.startsWith('users/' + who + '/')) throw new Error('forbidden');
        files.set(key, blob); return { data: { path: key } };
      },
      download: async key => ({ data: files.get(key) })
    }
  };
  w.WorkBuddyCloud = { createWorkBuddyCloud: () => transport };
  evaluate('cloud-v18'); await w.Cloud.boot();
  return { w, dom, files, count: () => count,
    switchOwner: id => { who = id; callback('SIGNED_IN', { user: { id } }); },
    before: fn => { beforeRpc = fn; }, failUpload: value => { failUpload = value; } };
}
function minimal() { return { version: 7, items: [], logs: {}, notes: {}, settings: {}, _sync: { version: 1, records: {} } }; }

test('数据库安装可重跑；账号隔离、匿名拒绝、直接写表拒绝', async t => {
  const db = await database(t); await db.exec(sql);
  await call(db, 'A', 'rigong_sync_push', { p_revision: 0, p_payload: minimal() });
  assert.equal((await call(db, 'B', 'rigong_sync_pull')).payload, null);
  assert.equal((await as(db, 'B', tx => tx.query('SELECT * FROM public.rigong_sync_heads'))).rows.length, 0);
  await assert.rejects(as(db, 'A', tx => tx.exec("UPDATE public.rigong_sync_heads SET revision=999")), /permission denied/);
  await assert.rejects(as(db, '', tx => tx.query('SELECT public.rigong_sync_pull()')), /unauthenticated/);
  await assert.rejects(as(db, 'A', tx => tx.query('SELECT public.rigong_sync_pull()'), 'anon'), /permission denied/);
  await assert.rejects(as(db, 'A', tx => tx.query('SELECT public.rigong_sync_pull()'), 'authenticated', { is_anonymous: true }), /unauthenticated/);
});
test('服务端拒绝损坏载荷，过期版本返回冲突，历史保留且重复内容不增版本', async t => {
  const db = await database(t);
  await assert.rejects(call(db, 'A', 'rigong_sync_push', { p_revision: 0, p_payload: {} }), /invalid sync/);
  const one = await call(db, 'A', 'rigong_sync_push', { p_revision: 0, p_payload: minimal() });
  const stale = await call(db, 'A', 'rigong_sync_push', { p_revision: 0, p_payload: minimal() });
  assert.equal(stale.conflict, true); assert.equal(stale.revision, 1);
  const same = await call(db, 'A', 'rigong_sync_push', { p_revision: 1, p_payload: minimal() });
  assert.equal(same.revision, one.revision);
  const history = await as(db, 'A', tx => tx.query('SELECT * FROM public.rigong_sync_history'));
  assert.equal(history.rows.length, 1);
});
test('两台设备并发编辑最终合并；无变化同步不重复写入', async t => {
  const db = await database(t), a = await app(t, db), b = await app(t, db);
  await a.w.Cloud.syncNow(); await b.w.Cloud.syncNow();
  const deviceB = b.w.Store.s.deviceId;
  a.w.Store.commit(s => { s.todos.push({ id: 'from-A', title: 'A 的待办' }); });
  b.w.Store.commit(s => {
    s.notes['2026-10-12'] = { text: 'B 的日记', photos: [], audios: [] };
    s.todos.push({ id: 'from-B', title: 'B 的待办' });
  });
  await Promise.all([a.w.Cloud.syncNow(), b.w.Cloud.syncNow()]);
  await a.w.Cloud.syncNow(); await b.w.Cloud.syncNow();
  assert.ok(a.w.Store.s.todos.some(x => x.id === 'from-A'));
  assert.equal(a.w.Store.s.notes['2026-10-12'].text, 'B 的日记');
  assert.ok(b.w.Store.s.todos.some(x => x.id === 'from-A'));
  assert.equal(b.w.Store.s.deviceId, deviceB);
  const rev = (await call(db, 'account-A', 'rigong_sync_pull')).revision;
  await a.w.Cloud.syncNow(); await b.w.Cloud.syncNow(); await a.w.Cloud.syncNow();
  assert.equal((await call(db, 'account-A', 'rigong_sync_pull')).revision, rev);
});
test('待办和附件的硬删除会传播，旧快照不能复活记录；清空日记可同步', async t => {
  const db = await database(t), a = await app(t, db), b = await app(t, db);
  a.w.Store.commit(s => {
    s.todos.push({ id: 'remove-me', title: '删除目标' });
    s.notes['2026-10-12'] = { text: '旧文字', photos: [{ id: 'photo1' }], audios: [] };
  });
  await a.w.Cloud.syncNow(); await b.w.Cloud.syncNow();
  const old = a.w.SyncModel.payload(a.w.Store.s);
  a.w.Store.commit(s => { s.todos = []; s.notes['2026-10-12'].text = ''; s.notes['2026-10-12'].photos = []; });
  await a.w.Cloud.syncNow(); await b.w.Cloud.syncNow();
  assert.equal(b.w.Store.s.todos.length, 0);
  assert.equal(b.w.Store.s.notes['2026-10-12'].text, '');
  assert.equal(b.w.Store.s.notes['2026-10-12'].photos.length, 0);
  b.w.SyncModel.merge(b.w.Store.s, old);
  assert.equal(b.w.Store.s.todos.length, 0);
});
test('上传期间的修改保留并在下一轮传送；切换账号不会上传旧账号记录', async t => {
  const db = await database(t), a = await app(t, db);
  let release, entered;
  const gate = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
  a.before(async name => { if (name === 'rigong_sync_push') { entered(); await gate; } });
  const first = a.w.Cloud.syncNow(); await started;
  a.w.Store.commit(s => s.todos.push({ id: 'during-upload', title: '上传期间新建' }));
  release(); await first; a.before(null); await a.w.Cloud.syncNow();
  assert.ok((await call(db, 'account-A', 'rigong_sync_pull')).payload.todos.some(x => x.id === 'during-upload'));
  const before = a.count(); a.switchOwner('account-B');
  await assert.rejects(a.w.Cloud.syncNow(), /另一个账号/);
  assert.equal(a.count(), before);
  assert.equal((await call(db, 'account-B', 'rigong_sync_pull')).payload, null);
});
test('离线不写云；上传失败原件保留，重试成功；释放空间跳过未上传文件', async t => {
  const db = await database(t), a = await app(t, db);
  Object.defineProperty(a.w.navigator, 'onLine', { value: false, configurable: true });
  await assert.rejects(a.w.Cloud.syncNow(), /离线/);
  assert.equal(a.count(), 0);
  Object.defineProperty(a.w.navigator, 'onLine', { value: true, configurable: true });
  a.failUpload(true);
  await a.w.Store.putMedia('offline-photo', new a.w.Blob(['original'], { type: 'image/jpeg' }), { kind: 'photo' });
  assert.equal(a.w.Store.s.media['offline-photo'].cloud, 0);
  assert.equal((await a.w.Store.slimLocal()).files, 0);
  assert.ok(await a.w.Store.getMedia('offline-photo', true));
  await assert.rejects(a.w.Cloud.syncNow(), /upload|连不上/);
  a.failUpload(false); await a.w.Cloud.syncNow();
  assert.equal(a.w.Store.s.media['offline-photo'].cloud, 1);
  assert.equal(a.files.size, 1);
});
test('新设备整体恢复不带示例习惯，保留设备身份、主题和提醒', async t => {
  const db = await database(t), a = await app(t, db), b = await app(t, db);
  a.w.Store.commit(s => { s.items = [{ id: 'real', name: '真实习惯', createdAt: 1 }]; });
  await a.w.Cloud.syncNow();
  b.w.Store.s.settings.theme = 'dark'; b.w.Store.s.settings.remindEnabled = true;
  const device = b.w.Store.s.deviceId; const r = await b.w.Cloud.syncNow();
  assert.equal(r.restored, true); assert.equal(b.w.Store.s.items.length, 1);
  assert.equal(b.w.Store.s.deviceId, device); assert.equal(b.w.Store.s.settings.theme, 'dark');
  assert.equal(b.w.Store.s.settings.remindEnabled, true);
});
test('原型污染载荷不会修改本机数据', async t => {
  const db = await database(t), a = await app(t, db);
  const before = a.w.SyncModel.canonical(a.w.Store.s);
  assert.throws(() => a.w.SyncModel.merge(a.w.Store.s, JSON.parse('{"items":[],"logs":{},"__proto__":{"polluted":true}}')), /不支持/);
  assert.equal(a.w.SyncModel.canonical(a.w.Store.s), before);
});
test('关闭云媒体时本机附件不泄露索引，开启后上传并同步', async t => {
  const db = await database(t), a = await app(t, db);
  a.w.Store.s.settings.cloudMedia = false;
  await a.w.Store.putMedia('private-photo', new a.w.Blob(['private'], { type: 'image/jpeg' }), { kind: 'photo' });
  a.w.Store.commit(s => { s.notes['2026-10-12'] = { text: '只有文字同步', photos: [{ id: 'private-photo' }], audios: [] }; });
  await a.w.Cloud.syncNow();
  const remote = (await call(db, 'account-A', 'rigong_sync_pull')).payload;
  assert.equal(remote.notes['2026-10-12'].photos.length, 0);
  assert.equal(remote.media['private-photo'], undefined);
  const b = await app(t, db); await b.w.Cloud.syncNow();
  assert.equal(b.w.Store.s.notes['2026-10-12'].text, '只有文字同步');
  a.w.Store.s.settings.cloudMedia = true;
  await a.w.Cloud.syncNow(); await b.w.Cloud.syncNow();
  assert.equal(b.w.Store.s.notes['2026-10-12'].photos.length, 1);
});
test('本机落盘失败不显示已同步，不写云端载荷', async t => {
  const db = await database(t), a = await app(t, db);
  a.w.Store.saveNow = async () => { throw new Error('disk failed'); };
  await assert.rejects(a.w.Cloud.syncNow(), /disk failed/);
  assert.equal(a.w.Cloud.status.state, 'error');
  assert.equal((await call(db, 'account-A', 'rigong_sync_pull')).payload, null);
});
