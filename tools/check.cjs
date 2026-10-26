const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let count = 0;
for (const dir of ['src', 'vendor']) {
  for (const file of fs.readdirSync(path.join(root, dir)).filter(x => x.endsWith('.js'))) {
    new vm.Script(fs.readFileSync(path.join(root, dir, file), 'utf8'), { filename: dir + '/' + file }); count++;
  }
}
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
new vm.Script(worker, { filename: 'sw.js' }); count++;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(x => x[1]);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
references.push(...manifest.icons.map(x => x.src));
const cacheList = worker.match(/const FILES = (\[[\s\S]*?\]);/)[1];
references.push(...vm.runInNewContext(cacheList));
for (const relative of references) {
  if (/^(https?:|#|data:)/.test(relative)) continue;
  const asset = relative.split(/[?#]/)[0];
  if (!fs.existsSync(path.resolve(root, asset))) throw new Error('Missing asset: ' + relative);
  if (asset.endsWith('.svg') && relative.includes('#')) {
    const id = relative.split('#')[1];
    const svg = fs.readFileSync(path.resolve(root, asset), 'utf8');
    if (!svg.includes('id="' + id + '"')) throw new Error('Missing SVG symbol: ' + relative);
  }
}
const version = fs.readFileSync(path.join(root, 'src/util.js'), 'utf8').match(/VERSION: '([^']+)'/)[1];
if (!worker.includes('rigongyizhu-v' + version + "'")) throw new Error('App and cache versions differ');
/* 离线清单必须覆盖页面实际加载的每个脚本：v32 加 buddy.js 时只改了 index.html，
 * 断网打开就少一个模块 —— 这种错人眼查不出来，只能机器查。 */
const listed = new Set(vm.runInNewContext(cacheList).map(x => x.split(/[?#]/)[0].replace(/^\.\//, '')));
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  const asset = m[1].split(/[?#]/)[0];
  if (/^(https?:|\/\/)/.test(asset)) continue;
  if (!listed.has(asset)) throw new Error('离线清单缺少脚本: ' + asset);
}
console.log(`${count} 个 JavaScript 文件语法通过；HTML、PWA 图标、离线缓存资源完整；版本一致；页面脚本全在离线清单里。`);
