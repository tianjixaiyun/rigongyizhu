/* 升版：把版本号从 N 改到 N+1，并把该改的地方一次改全。
 *
 * 要改的地方（漏一个就版本不一致，SW 会拿旧缓存跑新页面）：
 *   1. src/util.js 的 VERSION / VERSION_NAME
 *   2. sw.js 的 CACHE = 'rigongyizhu-vNN'
 *   3. sw.js FILES 里每个 ?v=NN
 *   4. index.html 里每个 ?v=NN
 * 另外：新加的模块要同时进 index.html 的 <script> 和 sw.js 的 FILES，否则离线就少一个文件。
 *
 * 用法：node tools/bump.cjs <新名字> [新增模块]
 *   例：node tools/bump.cjs "健康数据导入" health
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NAME = process.argv[2] || '';
const ADD = process.argv[3] || '';

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function write(rel, s) { fs.writeFileSync(path.join(ROOT, rel), s); }

const util = read('src/util.js');
const cur = (util.match(/VERSION:\s*'(\d+)'/) || [])[1];
if (!cur) { console.error('读不到当前版本号'); process.exit(1); }
const next = String(Number(cur) + 1);

/* 1. 版本号与版本名 */
let u = util.replace(/VERSION:\s*'\d+'/, "VERSION: '" + next + "'");
if (NAME) u = u.replace(/VERSION_NAME:\s*'[^']*'/, "VERSION_NAME: '" + NAME.replace(/'/g, '') + "'");
write('src/util.js', u);

/* 2+3. sw.js：缓存名 + 清单里的 ?v= + 新模块 */
let sw = read('sw.js').replace(/rigongyizhu-v\d+/g, 'rigongyizhu-v' + next)
  .replace(new RegExp('\\?v=' + cur + '\\b', 'g'), '?v=' + next);
String(ADD || '').split(',').filter(Boolean).forEach(function (mod) {
  if (sw.indexOf('./src/' + mod + '.js') >= 0) return;
  /* 挂到 rooms.js 后面（模块顺序不影响缓存，只影响可读性）；找不到锚点就挂 engine.js */
  var anchor = "'./src/rooms.js?v=" + next + "',";
  if (sw.indexOf(anchor) < 0) anchor = "'./src/engine.js?v=" + next + "',";
  sw = sw.replace(anchor, anchor + " './src/" + mod + ".js?v=" + next + "',");
});
write('sw.js', sw);

/* 4. index.html：脚本引用 + 新模块 */
let html = read('index.html').replace(new RegExp('\\?v=' + cur + '\\b', 'g'), '?v=' + next);
if (ADD && html.indexOf('src/' + ADD + '.js') < 0) {
  html = html.replace(
    '<script defer src="src/buddy.js?v=' + next + '"></script>',
    '<script defer src="src/buddy.js?v=' + next + '"></script>\n<script defer src="src/' + ADD + '.js?v=' + next + '"></script>'
  );
}
write('index.html', html);

const n1 = (html.match(/\?v=\d+/g) || []).length;
const n2 = (sw.match(/\?v=\d+/g) || []).length;
console.log('v' + cur + ' → v' + next + (NAME ? '「' + NAME + '」' : '') +
  '；index.html 引用 ' + n1 + ' 处、sw.js 清单 ' + n2 + ' 处' + (ADD ? '；已加入 ' + ADD + '.js' : ''));
