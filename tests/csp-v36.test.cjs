/* v36 服务端响应头：内容安全策略（挡住平台注入的第三方统计脚本）
 *
 * 为什么要在服务端测：那段脚本不在我们的源码里，是托管平台在 serve 时插进 </head> 的，
 * 前端改不掉。唯一的着力点就是响应头 —— 所以必须真起一个 server.js 来看它到底发没发。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function waitUp(port, tries) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      n++;
      const req = http.get({ host: '127.0.0.1', port: port, path: '/api/health' }, res => {
        res.resume(); resolve();
      });
      req.on('error', () => {
        if (n >= (tries || 60)) return reject(new Error('server 没起来'));
        setTimeout(tick, 100);
      });
    };
    tick();
  });
}

test('index.html 带 CSP，且只放行本站与内联脚本', async t => {
  const port = 31000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore'
  });
  t.after(() => { try { child.kill(); } catch (e) { } });
  await waitUp(port);

  const head = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: port, path: '/index.html', method: 'HEAD' }, res => {
      res.resume(); resolve(res.headers);
    });
    req.on('error', reject); req.end();
  });

  const csp = head['content-security-policy'];
  assert.ok(csp, 'index.html 必须带 Content-Security-Policy');
  assert.match(csp, /script-src\s+'self'/, 'CSP 要放行本站脚本');
  assert.match(csp, /'unsafe-inline'/, '页面里有内联脚本，必须放行内联，否则整个应用起不来');
  assert.ok(csp.indexOf('beacon.cdn.qq.com') < 0, 'CSP 里绝不能把统计脚本的域名列进白名单');
  assert.ok(!/default-src/.test(csp), '不设 default-src，避免误伤 data:/blob: 的图片音视频与 WebDAV 请求');

  /* 静态资源不需要 CSP，别给每个 js 都挂一遍 */
  const js = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: port, path: '/src/app.bundle.js', method: 'HEAD' }, res => {
      res.resume(); resolve(res.headers);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(js['content-security-policy'], undefined, 'JS 响应不该带 CSP');
});

/* v38 · 外部评审 P2-10：基础安全响应头。同样必须真起服务看，别只 grep 源码。 */
test('静态响应带 nosniff 与 Referrer-Policy', async t => {
  const port = 31000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore'
  });
  t.after(() => { try { child.kill(); } catch (e) { } });
  await waitUp(port);

  const head = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: port, path: '/index.html', method: 'HEAD' }, res => {
      res.resume(); resolve(res.headers);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(head['x-content-type-options'], 'nosniff', '必须禁止 MIME 嗅探');
  assert.equal(head['referrer-policy'], 'same-origin',
    '跳到用户自己的 WebDAV 网盘时不能把带房间码的页面地址带过去');
});
