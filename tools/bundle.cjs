/* 发布打包：把 index.html 里按顺序引用的 src/*.js 合成一个文件，并压缩。
 *
 * 为什么需要它：部署环境是 HTTP/1.1、不带 gzip，31 个 <script> 就是 31 次往返，
 * 700 KB 源码里又有大量中文注释。合成一个文件 + 去注释 + 真压缩，是零依赖条件下
 * 最直接的三个减负手段。开发镜像仍然用分文件（可读、可单测），只在发布时打包。
 *
 * 压缩用 terser（devDependency，不进产物）。若环境里没有 terser，退回到
 * 「去注释 + 去缩进」，功能不变、只是字节更多，不会让发布失败。
 *
 * 用法：node tools/bundle.cjs --root <项目目录>
 */
const fs = require('node:fs');
const path = require('node:path');

/* v54 · P2-8 首屏拆包（外部走查 P2-8）
 *
 * 走查说「按路由拆包，目标今日页路径 JS 减半」。实测（terser 压缩后）：
 *   ui.js + main.js 占产物的 80%，其余 19 个功能模块合计只有 20%。
 * 所以「减半」在当前架构下做不到 —— 那需要把 ui.js 拆成模块，属于重写。
 * 能拿到的是「首屏只等 core」：把功能模块拆成 5 个 chunk，用 async 并行下载，
 * 不阻塞 DOMContentLoaded、也不占首屏解析时间。总下载量不变（首屏后几秒内到齐）。
 *
 * 哪些留 core、哪些进 chunk，判据不是体积，而是「首屏那一刻会不会被读到」：
 *   lock.js  隐私锁 —— 启动时 maybeGateLock 要用，放进 chunk 就等于锁失效（安全问题）
 *   timer.js 番茄钟 —— 今日页的时长习惯要显示「计时中」，缺了会显示成「开始」
 *   todo.js  待办   —— 独立 tab，但顶栏有未完成角标，启动就 paint
 *   enc.js   加密导出 —— 导出是用户主动点的，但它和 diary 同属「数据」，留 core 更省事
 */
const CHUNKS = {
  /* 日记编辑器 + 媒体 + 打印打卡纸（用户点「日记」时才会用到） */
  diary: ['src/diary.js', 'src/paper.js'],
  /* 回顾页的图表与智能洞察 */
  grow: ['src/insights.js', 'src/chart.js'],
  /* 房间 / 好友 / 搭子 / 房间装饰 */
  social: ['src/rooms.js', 'src/friends-v19.js', 'src/buddy.js', 'src/decor.js'],
  /* 积分商店 / 等级 / 挑战 / 推送插件 / 健康数据导入 */
  plus: ['src/plus.js', 'src/level.js', 'src/challenge.js', 'src/plugins.js', 'src/health.js'],
};
const CHUNK_NAMES = Object.keys(CHUNKS);
const chunkOf = {};
for (const k of CHUNK_NAMES) for (const f of CHUNKS[k]) chunkOf[f] = k;

/* 逐字符扫描，正确跳过字符串、模板串、正则，再删注释 —— 不能直接正则替换，
 * 否则 "http://..." 这种字符串会被当成行注释切掉。 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prev = '';            // 上一个有意义的字符，用来判断 / 是除号还是正则
  const tplStack = [];      // 模板串 ${ } 嵌套深度
  while (i < n) {
    const c = src[i], d = src[i + 1];
    /* 行注释 */
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    /* 块注释 */
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    /* 字符串 */
    if (c === '"' || c === "'") {
      const q = c;
      out += c; i++;
      while (i < n) {
        const ch = src[i];
        out += ch;
        if (ch === '\\') { out += src[i + 1] || ''; i += 2; continue; }
        i++;
        if (ch === q) break;
      }
      prev = q;
      continue;
    }
    /* 模板串 */
    if (c === '`') {
      out += c; i++;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { out += ch + (src[i + 1] || ''); i += 2; continue; }
        out += ch; i++;
        if (ch === '`') break;
      }
      prev = '`';
      continue;
    }
    /* 正则：/ 前面不是标识符、数字、右括号时按正则处理 */
    if (c === '/' && !/[\w$)\]]/.test(prev)) {
      out += c; i++;
      let inClass = false;
      while (i < n) {
        const ch = src[i];
        out += ch;
        if (ch === '\\') { out += src[i + 1] || ''; i += 2; continue; }
        i++;
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        else if (ch === '\n') break;
      }
      while (i < n && /[a-z]/i.test(src[i])) { out += src[i]; i++; }
      prev = '/';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    out += c;
    i++;
  }
  return out;
}

/* 去注释后再压掉行首缩进与多余空行 —— 只动空白，不动任何语句 */
function tidy(src) {
  return src.split('\n').map(l => l.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/* 真压缩。每个源文件都是完整 IIFE、没有 fn.name / toString 之类的反射依赖，
 * 所以 mangle 只作用于 IIFE 内部作用域，顶层 window.X 赋值不受影响。
 * terser 不存在时返回 null，调用方退回「去注释 + 去缩进」。 */
async function minifyBundle(code) {
  let terser;
  try { terser = require('terser'); } catch { return null; }
  const out = await terser.minify(code, {
    compress: { passes: 2, drop_debugger: true },
    mangle: true,
    format: { comments: false, ascii_only: false }
  });
  if (!out || !out.code) return null;
  return out.code;
}

/* CSS 压缩。托管平台同样不压缩 CSS，76+36 KB 是实打实的下载量。
 * css-tree 是完整解析器（node_modules 里已有，jsdom 的依赖），比正则去空白安全。
 * 压缩前先数一遍规则数与声明数，压缩后必须一致才采用 —— 数量对不上说明解析
 * 有偏差，宁可退回原文也不要发出一个可能少规则的样式表。 */
function minifyCss(file) {
  let csstree;
  try { csstree = require('css-tree'); } catch { return null; }
  const src = fs.readFileSync(file, 'utf8');
  let ast;
  try { ast = csstree.parse(src, { positions: false }); } catch { return null; }
  const count = (tree) => {
    let rules = 0, decls = 0;
    csstree.walk(tree, n => { if (n.type === 'Rule') rules++; if (n.type === 'Declaration') decls++; });
    return rules + ':' + decls;
  };
  const before = count(ast);
  let out;
  try { out = csstree.generate(ast); } catch { return null; }
  let after;
  try { after = count(csstree.parse(out, { positions: false })); } catch { return null; }
  if (before !== after) {
    console.warn('  跳过 ' + path.basename(file) + '：规则/声明数不一致（' + before + ' → ' + after + '）');
    return null;
  }
  if (out.length >= src.length) return null;
  fs.writeFileSync(file, out, 'utf8');
  return [src.length, out.length];
}

async function main() {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--root');
  const root = path.resolve(ri >= 0 ? args[ri + 1] : path.join(__dirname, '..'));
  const htmlPath = path.join(root, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  const srcRe = /<script defer src="(src\/[^"?]+)(\?v=[^"]*)?"><\/script>\s*/g;
  const files = [];
  let m;
  while ((m = srcRe.exec(html))) files.push(m[1]);
  if (!files.length) { console.error('没在 index.html 里找到 defer 脚本'); process.exit(1); }

  /* core 只装「首屏那一刻会被读到」的文件；其余进 chunk（见顶部 CHUNKS 注释） */
  const coreFiles = files.filter(f => !chunkOf[f]);
  const parts = coreFiles.map(rel => {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    return '/* ==== ' + rel + ' ==== */\n' + tidy(stripComments(code));
  });
  /* 末尾派发 rgz:core —— 先到的 chunk 靠它知道「可以开始执行了」；
   * 并打上 __RGZ_SPLIT__ 标志，页面据此决定要不要在空闲时注入 chunk。 */
  const joined = parts.join('\n') +
    '\n;window.__RGZ_SPLIT__=1;try{window.dispatchEvent(new Event("rgz:core"))}catch(e){}';
  const min = await minifyBundle(joined);
  const bundle = min || joined;
  const outRel = 'src/app.bundle.js';
  fs.writeFileSync(path.join(root, outRel), bundle, 'utf8');

  /* v54 · P2-8：把功能模块单独打成 chunk。
   *
   * 两个必须处理的顺序问题：
   *   ① chunk 只有 13–38KB，core 有 490KB —— async 下载完就执行，chunk 很可能
   *      比 core 先跑。而这些模块的 IIFE 顶层会直接读 `Store` / `U`（不是延迟求值），
   *      那时 core 还没执行，就是 `ReferenceError: Store is not defined`。
   *      所以每个 chunk 包一层：core 已就绪就直接跑，否则等 rgz:core。
   *   ② 启动补跑（Buddy / Health / Level）靠 rgz:chunk 事件，必须在模块真正
   *      执行完之后派发，不能放在等待之前。
   */
  const chunkSizes = {};
  for (const k of CHUNK_NAMES) {
    const list = files.filter(f => chunkOf[f] === k);
    if (!list.length) continue;
    const cp = list.map(rel => '/* ==== ' + rel + ' ==== */\n' + tidy(stripComments(fs.readFileSync(path.join(root, rel), 'utf8'))));
    const body = cp.join('\n');
    const wrapped = ';(function(){var run=function(){\n' + body +
      '\n;window.__rgzChunk=window.__rgzChunk||{};window.__rgzChunk["' + k + '"]=1;' +
      '\n;try{window.dispatchEvent(new Event("rgz:chunk"))}catch(e){}\n};' +
      'if(window.Store){run();}else{window.addEventListener("rgz:core",run,{once:true});}})();';
    const minC = await minifyBundle(wrapped);
    const out = minC || wrapped;
    fs.writeFileSync(path.join(root, 'src/chunk-' + k + '.js'), out, 'utf8');
    chunkSizes[k] = Buffer.byteLength(out);
  }
  const chunkTotal = Object.values(chunkSizes).reduce((a, b) => a + b, 0);
  const rawAll = files.reduce((a, f) => a + fs.statSync(path.join(root, f)).size, 0);
  console.log('合并 ' + coreFiles.length + ' 个文件 → ' + outRel + (min ? '（terser 压缩）' : '（无 terser，仅去注释）'));
  console.log('  原始 ' + Math.round(rawAll / 1024) + ' KB → 首屏 ' + Math.round(Buffer.byteLength(bundle) / 1024) + ' KB + 按需 ' + Math.round(chunkTotal / 1024) + ' KB');
  console.log('  ' + CHUNK_NAMES.map(k => k + ' ' + Math.round((chunkSizes[k] || 0) / 1024) + 'KB').join(' · '));

  /* 样式表同步压缩（发布目录里的副本，开发镜像不动） */
  for (const css of ['app.css', 'product.css']) {
    const f = path.join(root, 'assets', css);
    if (!fs.existsSync(f)) continue;
    const r = minifyCss(f);
    console.log('  ' + css + (r ? ' ' + Math.round(r[0] / 1024) + ' KB → ' + Math.round(r[1] / 1024) + ' KB' : ' 保持原样'));
  }

  /* index.html 换成单个脚本标签（版本号沿用第一个文件的 ?v=） */
  const ver = (/src\/util\.js(\?v=[^"]*)/.exec(html) || [, ''])[1];
  const first = files[0];
  html = html.replace(srcRe, '');
  /* cloud-sdk.js 已改成按需加载，不再是常驻脚本；bundle 标签插在第一个 defer 脚本
   * 原来的位置（若那行还在就接在它后面，否则插到 </head> 前）。 */
  const sdkTagRe = /<script defer src="vendor\/cloud-sdk\.js[^"]*"><\/script>/;
  const bundleTag = '<script defer src="' + outRel + ver + '"></script>';
  if (sdkTagRe.test(html)) html = html.replace(sdkTagRe, m => m + '\n' + bundleTag);
  else html = html.replace('</head>', bundleTag + '\n</head>');
  /* v54 · P2-8：chunk 不用 <script async> 放进 index.html！
   * 实测（v54_speed.cjs，1.6Mbps / 150ms 限速，各 3 次取中位）：
   *   async 标签方案 FCP 1960ms vs 未拆包 1472ms —— 反而慢 488ms。
   * 原因：4 个小脚本和 490KB 的 core 并行下载，抢的都是同一条瓶颈带宽，
   * core 被拖慢，首屏跟着遭殃。总下载量没变，只是把最要紧的那份切碎了。
   * 所以改成「core 先独占带宽跑起来，空闲时再注入 chunk」：
   *   - 首访关键路径只剩 490KB，FCP/DCL 都提前
   *   - chunk 在首屏渲染完之后 1–2 秒内到齐（注入时页面已经在等它了也很少见）
   *   - 二访全部走 SW 缓存，无差别
   * __RGZ_SPLIT__ 是发布版标志：开发镜像没有 chunk 文件，不能注入（会 404）。 */
  html = html.replace(/\s*<script async src="src\/chunk-[a-z]+\.js[^"]*"><\/script>/g, '');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('index.html 已改为单脚本引用' + (ver ? '（' + ver + '）' : ''));

  /* sw.js 的离线清单同步：去掉分文件，加上 bundle */
  const swPath = path.join(root, 'sw.js');
  let sw = fs.readFileSync(swPath, 'utf8');
  const fileListRe = /const FILES = \[[\s\S]*?\];/;
  const head = /const CACHE = '([^']+)'/.exec(sw)[1];
  /* cloud-sdk.js 不在这个清单里 —— 它是可选资源，只放进 OPTIONAL。
   * v34 之前它一直在 FILES 里，一个 404 就能让整个离线安装失败。 */
  const list = ['./', './index.html', './manifest.webmanifest',
    './assets/app.css' + ver, './assets/product.css' + ver, './assets/icons.svg', './assets/icon.svg',
    './' + outRel + ver]
    /* v54 · P2-8：chunk 也必须预缓存 —— 否则断网时点「日记 / 回顾 / 房间」是空白页。
     * 首访时 SW 还没接管，靠网络并行下；装好之后就从缓存读。 */
    .concat(CHUNK_NAMES.map(k => './src/chunk-' + k + '.js' + ver));
  const opt = "./vendor/cloud-sdk.js" + ver;
  const filesBlock = (sw.match(fileListRe) || [''])[0];
  if (/const OPTIONAL = \[[^\]]*\];/.test(sw)) {
    sw = sw.replace(/const OPTIONAL = \[[^\]]*\];/, 'const OPTIONAL = [\'' + opt + '\'];');
  } else {
    sw = sw.replace(fileListRe, 'const OPTIONAL = [\'' + opt + '\'];\n' + filesBlock);
  }
  sw = sw.replace(fileListRe, 'const FILES = [\n  ' + list.map(x => "'" + x + "'").join(', ') + '\n];');
  /* 可选资源也要进 fetch 的白名单（ALL），否则缓存命中后仍会去网络拿 */
  sw = sw.replace(/const ALL = [^;]*;/, 'const ALL = FILES.concat(OPTIONAL);');
  fs.writeFileSync(swPath, sw, 'utf8');
  console.log('sw.js 离线清单已同步（' + head + '，云 SDK 在 OPTIONAL）');
}

main().catch(e => { console.error(e); process.exit(1); });
