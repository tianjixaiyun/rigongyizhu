/* 降级通道验证：模拟"平台尚未安装 rigong_sync_* 建表脚本"的现状 ——
 * 所有 RPC 一律回 PGRST202，只提供 v12 时代的 snapshots 表。
 * 期望：客户端自动切到表通道，两台设备依然完成双向同步。 */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { chromium } = require('C:/Users/mengw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), out = 'D:/codex/workspace/outputs/rigong-cloud-sync';
const endpoint = 'https://rigong-yizhu-habits.app.workbuddy.host';
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const relative = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
});
(async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE public.snapshots (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id TEXT NOT NULL,
    payload JSONB,
    bytes INT,
    device TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--disable-gpu'] });
  const checks = [], errors = [], rpcHits = { count: 0 }, tableHits = { get: 0, post: 0, del: 0 };
  const ok = label => { checks.push(label); console.log('PASS ' + label); };
  async function context() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      localStorage.setItem('workbuddy-cloud.session.wbpk_eH6NLcQs8Anku6XJkJhPSH_g1rRF2Kmeh42pEvcYtDIYEMMfrJG8sXi', JSON.stringify({ accessToken: 'test-account-A', refreshToken: 'test-only', expiresAt: Date.now() + 3600000, user: { id: 'account-A', isAnonymous: false } }));
    });
    await ctx.route('**/*', async route => {
      const req = route.request(), url = req.url();
      if (url.startsWith(origin)) return route.continue();
      if (!url.startsWith(endpoint)) return route.abort();
      const headers = { 'access-control-allow-origin': origin, 'content-type': 'application/json' };
      if (url.includes('/auth/v1/user/me')) return route.fulfill({ status: 401, headers, body: '{"message":"Sign in required"}' });
      // 平台尚未安装建表脚本 —— 任何 RPC 都不存在
      if (url.includes('/rpc/')) {
        rpcHits.count++;
        return route.fulfill({ status: 404, headers, body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.rigong_sync_pull(p_revision, p_payload) in the schema cache' }) });
      }
      if (url.includes('/rest/snapshots')) {
        if (req.headers().authorization !== 'Bearer test-account-A') return route.fulfill({ status: 401, headers, body: '{"message":"unauthenticated"}' });
        if (req.method() === 'POST') {
          tableHits.post++;
          const body = req.postDataJSON() || {};
          const r = await db.query('INSERT INTO public.snapshots(owner_id,payload,bytes,device) VALUES($1,$2::jsonb,$3,$4) RETURNING id,created_at',
            ['account-A', JSON.stringify(body.payload), Number(body.bytes) || 0, String(body.device || '')]);
          return route.fulfill({ status: 201, headers, body: JSON.stringify(r.rows) });
        }
        if (req.method() === 'DELETE') {
          tableHits.del++;
          const m = /id=in\.\(([^)]*)\)/.exec(decodeURIComponent(url));
          if (m) {
            const ids = m[1].split(',').map(s => s.trim()).filter(Boolean);
            if (ids.length) await db.query('DELETE FROM public.snapshots WHERE id = ANY($1::bigint[])', [ids]);
          }
          return route.fulfill({ status: 204, headers, body: '' });
        }
        tableHits.get++;
        const r = await db.query('SELECT id,payload,created_at,bytes FROM public.snapshots WHERE owner_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1', ['account-A']);
        return route.fulfill({ status: 200, headers, body: JSON.stringify(r.rows) });
      }
      return route.fulfill({ status: 200, headers, body: '[]' });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/#connect');
    try { await page.waitForFunction(() => Cloud.status.state === 'signed' && Store.s.settings.lastCloudAt > 0, null, { timeout: 30000 }); }
    catch (e) {
      console.log(await page.evaluate(() => ({ status: Cloud.status, uid: Cloud.uid(), text: document.getElementById('view').innerText.slice(0, 400) })));
      console.log('errors:', errors); throw e;
    }
    await page.evaluate(() => { UI.closeSheet(); });
    return { ctx, page };
  }
  try {
    const a = await context(), b = await context();
    ok('RPC 不存在时自动切到 snapshots 表并完成同步');
    assert.ok(tableHits.post >= 1, '应至少写入一条快照');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM public.snapshots')).rows[0].n, 1);
    ok('快照真实落盘到 snapshots 表');
    await a.page.evaluate(() => { Store.commit(s => s.todos.push({ id: 'fallback-a', title: '降级通道写入' })); });
    await a.page.waitForFunction(() => Cloud.status.state === 'signed');
    await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await b.page.waitForFunction(() => Store.s.todos.some(x => x.id === 'fallback-a'));
    ok('设备 B 从 snapshots 表读到设备 A 的改动');
    await a.ctx.setOffline(true);
    await a.page.evaluate(() => Store.commit(s => s.todos.push({ id: 'fallback-off', title: '离线' })));
    await a.page.waitForFunction(() => Store.saveStatus.state === 'saved');
    await a.ctx.setOffline(false);
    await a.page.waitForFunction(() => Cloud.status.state === 'signed');
    await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await b.page.waitForFunction(() => Store.s.todos.some(x => x.id === 'fallback-off'));
    ok('断网补传在降级通道同样生效');
    const total = (await db.query('SELECT COUNT(*)::int AS n FROM public.snapshots')).rows[0].n;
    assert.ok(total <= 3, '清理应把快照收敛到最近 3 份，实际 ' + total);
    ok('旧快照被自动清理（当前 ' + total + ' 份）');
    assert.equal(errors.length, 0, '不应有未捕获错误：' + errors.join(' | '));
    ok('全程无未捕获错误');
    console.log('\n降级通道 QA：' + checks.length + ' 项全通过  RPC 探测 ' + rpcHits.count + ' 次 → 表读 ' + tableHits.get + ' 写 ' + tableHits.post + ' 删 ' + tableHits.del);
    fs.writeFileSync(path.join(out, 'fallback-qa.json'), JSON.stringify({ environment: 'Edge + 官方 SDK + 内存 PostgreSQL（仅 snapshots 表）', checks, errors, rpcHits, tableHits }, null, 2));
  } finally { await browser.close(); server.close(); await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
