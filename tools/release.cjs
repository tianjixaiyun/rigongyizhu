/* 发布：把开发镜像拷到发布目录，打包成单文件，再清掉被内联的源码。
 *
 * 开发镜像保持分文件（可读、可单测、可逐文件调试）；
 * 发布目录留 index.html + assets + vendor + src/app.bundle.js + server.js。
 *
 * v32 起发布目录里带一个 server.js：发布平台一个沙箱只跑一个服务，
 * 页面和搭子接口必须同源同居，否则部署其中一个会把另一个挤掉。
 *
 * 用法：node tools/release.cjs [--to <发布目录>]
 * 默认发布目录：D:/Workbody/生成物/rigongyizhu
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const ti = args.indexOf('--to');
const SRC = path.resolve(__dirname, '..');
const DST = path.resolve(ti >= 0 ? args[ti + 1] : 'D:/Workbody/生成物/rigongyizhu');

function copyFile(rel) {
  const to = path.join(DST, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(SRC, rel), to);
}
function copyDir(rel) {
  for (const name of fs.readdirSync(path.join(SRC, rel))) {
    if (name.endsWith('.map')) continue;
    copyFile(path.join(rel, name));
  }
}

['index.html', 'sw.js', 'manifest.webmanifest', 'server.js'].forEach(copyFile);
['assets', 'src', 'vendor'].forEach(copyDir);

/* 发布用的 package.json 必须是最小的一份：
 * 镜像里那份带 devDependencies（jsdom/terser…），拷过去平台会照着装一遍，白等还占地方。 */
const ver = (fs.readFileSync(path.join(SRC, 'src', 'util.js'), 'utf8').match(/VERSION\s*=\s*'(\d+)'/) || [])[1] || '0';
fs.writeFileSync(path.join(DST, 'package.json'), JSON.stringify({
  name: 'rigongyizhu',
  version: ver + '.0.0',
  private: true,
  main: 'server.js',
  scripts: { start: 'node server.js' }
}, null, 2) + '\n');
console.log('已同步到 ' + DST);

/* 打包（会重写 index.html 与 sw.js 的清单） */
execFileSync(process.execPath, [path.join(SRC, 'tools', 'bundle.cjs'), '--root', DST], { stdio: 'inherit' });

/* 清掉被内联进 bundle 的源码，发布目录只留 bundle + 按需 chunk。
 * v54 · P2-8：chunk-*.js 是 bundle.cjs 刚生成的，必须留下 —— 早先这里是
 * 「只留 app.bundle.js」，一改拆包就会把 chunk 全删掉，页面直接少一半功能。 */
const srcDir = path.join(DST, 'src');
for (const name of fs.readdirSync(srcDir)) {
  if (name === 'app.bundle.js') continue;
  if (/^chunk-[a-z]+\.js$/.test(name)) continue;
  if (name.endsWith('.js')) fs.unlinkSync(path.join(srcDir, name));
}
console.log('发布目录 src/ 现在有：' + fs.readdirSync(srcDir).join(', '));
