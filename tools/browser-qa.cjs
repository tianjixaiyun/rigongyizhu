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
  await db.exec('CREATE ROLE authenticated; CREATE ROLE anon;');
  await db.exec(fs.readFileSync(path.join(root, 'backend/001_cloud_sync.sql'), 'utf8'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--disable-gpu'], downloadsPath: out });
  const checks = [], errors = [];
  const ok = label => { checks.push(label); console.log('PASS ' + label); };
  async function context() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      localStorage.setItem('workbuddy-cloud.session.wbpk_eH6NLcQs8Anku6XJkJhPSH_g1rRF2Kmeh42pEvcYtDIYEMMfrJG8sXi', JSON.stringify({ accessToken: 'test-account-A', refreshToken: 'test-only', expiresAt: Date.now() + 3600000, user: { id: 'account-A', isAnonymous: false } }));
    });
    await ctx.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (!url.startsWith(endpoint)) return route.abort();
      const headers = { 'access-control-allow-origin': origin, 'content-type': 'application/json' };
      if (url.includes('/auth/v1/user/me')) return route.fulfill({ status: 401, headers, body: '{"message":"Sign in required"}' });
      const match = /\/rpc\/(rigong_sync_pull|rigong_sync_push)/.exec(url);
      if (!match) return route.fulfill({ status: 200, headers, body: '[]' });
      if (route.request().headers().authorization !== 'Bearer test-account-A') return route.fulfill({ status: 401, headers, body: '{"message":"unauthenticated"}' });
      try {
        const args = route.request().postDataJSON() || {};
        const row = await db.transaction(async tx => {
          await tx.exec('SET LOCAL ROLE authenticated');
          await tx.query("SELECT set_config('request.jwt.claims',$1,true)", ['{"sub":"account-A"}']);
          const r = match[1] === 'rigong_sync_pull' ? await tx.query('SELECT public.rigong_sync_pull() AS result')
            : await tx.query('SELECT public.rigong_sync_push($1::bigint,$2::jsonb) AS result', [args.p_revision, JSON.stringify(args.p_payload)]);
          return r.rows[0].result;
        });
        await route.fulfill({ status: 200, headers, body: JSON.stringify(row) });
      } catch (e) { await route.fulfill({ status: 400, headers, body: JSON.stringify({ message: e.message }) }); }
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/#connect');
    try { await page.waitForFunction(() => Cloud.status.state === 'signed' && Store.s.settings.lastCloudAt > 0); }
    catch (e) {
      console.log(await page.evaluate(() => ({ status: Cloud.status, ready: Cloud.isReady(), uid: Cloud.uid(), storageKeys: Object.keys(localStorage), text: document.getElementById('view').innerText.slice(0, 500) })));
      console.log(errors); throw e;
    }
    await page.evaluate(() => { UI.closeSheet(); });
    return { ctx, page };
  }
  try {
    const a = await context(), b = await context();
    ok('真实 Edge 与原官方 SDK 可调用实际 PostgreSQL RPC');
    await a.page.evaluate(() => { Store.commit(s => s.todos.push({ id: 'browser-auto', title: '浏览器自动同步' })); });
    await a.page.waitForFunction(() => Cloud.status.state === 'signed');
    await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await b.page.waitForFunction(() => Store.s.todos.some(x => x.id === 'browser-auto'));
    ok('修改后自动上传，另一设备回到前台自动接收');
    const revBefore = (await db.query("SELECT revision FROM public.rigong_sync_heads WHERE owner_id='account-A'")).rows[0].revision;
    await a.page.waitForTimeout(3500);
    assert.equal((await db.query("SELECT revision FROM public.rigong_sync_heads WHERE owner_id='account-A'")).rows[0].revision, revBefore);
    ok('同步成功不触发持续重复上传');
    await a.ctx.setOffline(true);
    await a.page.evaluate(() => Store.commit(s => s.todos.push({ id: 'browser-offline', title: '离线记录' })));
    await a.page.waitForFunction(() => Store.saveStatus.state === 'saved');
    await a.ctx.setOffline(false);
    await a.page.waitForFunction(() => Cloud.status.state === 'signed');
    await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await b.page.waitForFunction(() => Store.s.todos.some(x => x.id === 'browser-offline'));
    ok('断网记录先落盘，联网自动补传');
    await a.page.evaluate(() => UI.go('diary'));
    const field = a.page.locator('[data-act="dytext"]');
    await field.fill('保持输入焦点与草稿');
    await a.page.waitForTimeout(3300);
    assert.equal(await field.inputValue(), '保持输入焦点与草稿');
    assert.equal(await field.evaluate(el => document.activeElement === el), true);
    ok('后台同步状态变化不打断日记输入');
    await a.page.evaluate(() => UI.go('connect'));
    await a.page.locator('#cloudCard').waitFor({ state: 'visible' });
    await a.page.waitForTimeout(600);
    await a.page.screenshot({ path: path.join(out, 'cloud-mobile.png'), fullPage: true });
    await a.page.setViewportSize({ width: 1440, height: 1000 });
    await a.page.waitForTimeout(300);
    await a.page.screenshot({ path: path.join(out, 'cloud-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []); ok('手机与桌面页面渲染，无未捕获错误');
    fs.writeFileSync(path.join(out, 'browser-qa.json'), JSON.stringify({ environment: 'Edge + original WorkBuddy SDK + in-memory PostgreSQL; no production data', checks, errors }, null, 2));
  } finally { await browser.close(); server.close(); await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
