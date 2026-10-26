/* 日拱一卒 · 单进程服务（页面 + 搭子信箱）
 *
 * 为什么要合成一个：发布平台一个沙箱只跑一个服务，页面和信箱分两次部署会互相挤掉。
 * 合起来还顺手解决了两件事 ——
 *   1. 接口同源，前端不用再写死一个会变的域名；
 *   2. 静态资源可以自己压 gzip（平台本身不压缩，486KB 的包压完只剩一百多 KB）。
 *
 * 静态部分：__dirname 下的 index.html / assets / vendor / src/app.bundle.js。
 * 接口部分：只让两个人互看「今天做没做 + 连续几天」，外加每天一次打气。
 * 刻意不存：习惯的数值、日志、备注、照片、心情。一对搭子最多两条记录，90 天没动静自动删。
 *
 * 单文件、零依赖：监听 PORT、绑定 0.0.0.0。
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA = process.env.DATA_PATH || path.join(ROOT, 'data.json');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉 I O 0 1，避免读错
const MAX_PAIRS = 5000;                             // 沙箱很小，给个上限保护自己
const TTL_MS = 90 * 24 * 3600 * 1000;
const MAX_BODY = 4096;
const CHEER_GAP = 20 * 3600 * 1000;                 // 一次打气管 20 小时

/* ---------------- 存储 ---------------- */
const pairs = new Map();
let saveTimer = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    Object.keys(raw || {}).forEach(k => { if (raw[k] && raw[k].code) pairs.set(k, raw[k]); });
  } catch (e) { /* 第一次启动没有文件，正常 */ }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA, JSON.stringify(Object.fromEntries(pairs))); } catch (e) { /* 只读文件系统就只留内存 */ }
  }, 300);
}
load();

/* ---------------- 小工具 ---------------- */
const ok = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const newCode = () => { const b = crypto.randomBytes(6); return Array.from(b, x => ALPHA[x % ALPHA.length]).join(''); };
const newToken = () => crypto.randomBytes(16).toString('hex');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const dayOk = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function side(o) {
  return {
    nick: clean(o.nick, 12) || '搭子',
    habit: clean(o.habit, 40) || '一个习惯',
    done: !!o.done,
    streak: Math.max(0, Math.min(9999, Math.round(Number(o.streak) || 0))),
    day: dayOk(o.day) ? String(o.day) : '',
    cheerAt: 0
  };
}
/* 对外只给这些字段，token 永远不出门 */
function pub(s) {
  if (!s) return null;
  return { nick: s.nick, habit: s.habit, done: !!s.done, streak: s.streak || 0, day: s.day || '', cheerAt: s.cheerAt || 0 };
}
function fail(status, msg) { const e = new Error(msg); e.status = status; return e; }

/* ---------------- 搭子业务 ---------------- */
function create(o) {
  if (pairs.size >= MAX_PAIRS) throw fail(503, 'busy');
  const me = side(o);
  me.token = newToken();
  let c;
  do { c = newCode(); } while (pairs.has(c));
  const pair = { code: c, created: Date.now(), updated: Date.now(), a: me, b: null };
  pairs.set(c, pair);
  save();
  return { ok: true, code: c, token: me.token, me: pub(me), peer: null };
}

function join(o) {
  const p = pairs.get(String(o.code || '').toUpperCase());
  if (!p) throw fail(404, 'no-pair');
  if (p.b) throw fail(409, 'full');
  const me = side(o);
  me.token = newToken();
  p.b = me;
  p.updated = Date.now();
  save();
  return { ok: true, code: p.code, token: me.token, me: pub(me), peer: pub(p.a) };
}

/* 认领：code + token 对得上，才允许读写 */
function auth(o) {
  const p = pairs.get(String(o.code || '').toUpperCase());
  if (!p) throw fail(404, 'no-pair');
  const t = String(o.token || '');
  const isA = p.a && p.a.token === t;
  const isB = p.b && p.b.token === t;
  if (!isA && !isB) throw fail(403, 'bad-token');
  return { p, me: isA ? p.a : p.b, other: isA ? p.b : p.a, isA };
}

function update(o) {
  const { p, me, other, isA } = auth(o);
  const n = side(Object.assign({}, me, o));
  n.token = me.token;
  n.cheerAt = me.cheerAt || 0;
  if (o.cheer) {
    if (Date.now() - n.cheerAt < CHEER_GAP) throw fail(429, 'cheer-limit');
    n.cheerAt = Date.now();
  }
  if (isA) p.a = n; else p.b = n;
  p.updated = Date.now();
  save();
  return { ok: true, me: pub(n), peer: pub(other) };
}

function read(q) {
  const { me, other } = auth({ code: q.get('code'), token: q.get('token') });
  return { ok: true, me: pub(me), peer: pub(other) };
}

/* 邀请信息：只有码的人能看到「谁邀请你一起做什么」，不含任何进度 */
function peek(q) {
  const p = pairs.get(String(q.get('code') || '').toUpperCase());
  if (!p) throw fail(404, 'no-pair');
  return { ok: true, inviter: p.a ? { nick: p.a.nick, habit: p.a.habit } : null, full: !!p.b };
}

function leave(o) {
  const { p, isA } = auth(o);
  if (isA) p.a = null; else p.b = null;
  const gone = !p.a && !p.b;
  if (gone) pairs.delete(p.code); else p.updated = Date.now();
  save();
  return { ok: true, gone };
}

/* ---------------- HTTP 小工具 ---------------- */
function json(res, obj, status) {
  const s = JSON.stringify(obj);
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    'Cache-Control': 'no-store'
  });
  res.end(s);
}
function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0, raw = '';
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(fail(413, 'too-large')); req.destroy(); return; }
      raw += c;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(fail(400, 'bad-json')); }
    });
    req.on('error', reject);
  });
}

/* 简单限流：每个 IP 每分钟 90 次，挡一下脚本刷 */
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now - h.at > 60000) { h = { at: now, n: 0 }; hits.set(ip, h); }
  h.n++;
  return h.n > 90;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (now - h.at > 120000) hits.delete(ip);
  for (const [c, p] of pairs) if (now - (p.updated || 0) > TTL_MS) pairs.delete(c);
}, 3600000).unref();

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|javascript)|image\/svg)/;

/* 压过的内容按「路径 + 大小 + 修改时间」缓存在内存里：一个文件只压一次 */
const zcache = new Map();

/* 只发这几类路径：别的（data.json、package.json、临时文件）一律 404。
 * 白名单比黑名单可靠 —— 搭子的数据文件就躺在同一个目录里，漏一个就是隐私事故。 */
const ALLOW_FILE = ['/index.html', '/sw.js', '/manifest.webmanifest'];
function allowed(rel) {
  if (ALLOW_FILE.indexOf(rel) >= 0) return true;
  return /^\/(assets|src|vendor)\/[A-Za-z0-9._@-]+$/.test(rel);
}

function statFile(rel) {
  if (!allowed(rel)) return null;
  const f = path.resolve(ROOT, '.' + rel);
  if (!f.startsWith(ROOT + path.sep)) return null;
  try {
    const st = fs.statSync(f);
    return st.isFile() ? { file: f, st } : null;
  } catch (e) { return null; }
}

/* 外部评审 5.4：托管平台会在 index.html 的 </head> 前注入一段**同步**的第三方统计脚本
 * （beacon.cdn.qq.com）。它有两个问题：一是它不在我们的源码里，改不掉；二是同步脚本会
 * 卡住首屏解析，CDN 慢或不通时用户看到的是白屏。
 *
 * 既然改不了那段 HTML，就从响应头这一层解决：只放行本站脚本 + 内联脚本，
 * 第三方脚本连请求都发不出去。这样既关掉了统计，也顺手去掉了首屏的阻塞点。
 *
 * 只设 script-src，不设 default-src —— 其余资源（data:/blob: 的图片音视频、WebDAV 的
 * 任意 https 目标、worker）全部维持原样，避免误伤。
 * 想恢复平台统计：把下面这行改成 ''（或删掉）即可，不需要动任何前端代码。 */
const CSP = "script-src 'self' 'unsafe-inline'";

function sendFile(req, res, rel) {
  const hit = statFile(rel);
  if (!hit) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
  const ext = path.extname(hit.file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = 'W/"' + hit.st.size.toString(16) + '-' + Math.round(hit.st.mtimeMs).toString(16) + '"';
  const head = {
    'Content-Type': type,
    ETag: etag,
    /* 页面每次都回来问一句（304 很便宜），避免装好了新版本却看到旧页面 */
    'Cache-Control': 'no-cache',
    /* v38 · 外部评审 P2-10：基础安全响应头。
     * nosniff 防 MIME 嗅探把 .json/.txt 当脚本跑；Referrer-Policy 让我们跳到
     * 用户自己的 WebDAV 网盘时不把页面地址带过去（地址里有房间码）。 */
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  };
  if (CSP && /^text\/html/.test(type)) head['Content-Security-Policy'] = CSP;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }

  const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && COMPRESSIBLE.test(type) && hit.st.size > 1024;
  if (gz) {
    const key = hit.file + ':' + hit.st.size + ':' + Math.round(hit.st.mtimeMs);
    let buf = zcache.get(key);
    if (!buf) {
      buf = zlib.gzipSync(fs.readFileSync(hit.file), { level: 9 });
      if (zcache.size > 60) zcache.clear();
      zcache.set(key, buf);
    }
    head['Content-Encoding'] = 'gzip';
    head['Vary'] = 'Accept-Encoding';
    head['Content-Length'] = buf.length;
    res.writeHead(200, head);
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
  head['Content-Length'] = hit.st.size;
  res.writeHead(200, head);
  if (req.method === 'HEAD') return res.end();
  res.end(fs.readFileSync(hit.file));
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://local');
  const p = u.pathname;

  /* 接口 */
  if (p.startsWith('/api/')) {
    /* 页面与接口同源，本来不需要 CORS；留着是为了本地调试/测试能跨端口打这一份服务。
     * 鉴权靠 body 里的 token，不走 cookie，所以放开来源也不会串号。 */
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
    if (limited(ip)) return json(res, { ok: false, error: 'slow-down' }, 429);
    try {
      if (p === '/api/health') return json(res, { ok: true, pairs: pairs.size, uptime: Math.round(process.uptime()) });
      if (req.method === 'POST' && p === '/api/create') return json(res, create(await body(req)));
      if (req.method === 'POST' && p === '/api/join') return json(res, join(await body(req)));
      if (req.method === 'POST' && p === '/api/state') return json(res, update(await body(req)));
      if (req.method === 'GET' && p === '/api/state') return json(res, read(u.searchParams));
      if (req.method === 'GET' && p === '/api/peek') return json(res, peek(u.searchParams));
      if (req.method === 'POST' && p === '/api/leave') return json(res, leave(await body(req)));
      return json(res, { ok: false, error: 'not-found' }, 404);
    } catch (e) {
      return json(res, { ok: false, error: e.message || 'error' }, e.status || 500);
    }
  }

  /* 页面 */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET,HEAD' });
    return res.end();
  }
  let rel = decodeURIComponent(p);
  if (rel === '/' || rel === '') rel = '/index.html';
  /* 只认已知后缀，其余当 404 —— 避免把目录/临时文件暴露出去 */
  if (!MIME[path.extname(rel).toLowerCase()]) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  sendFile(req, res, rel);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[rigongyizhu] listening on ' + PORT + ' · pairs=' + pairs.size + ' · root=' + ROOT);
});
