const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = 'D:/codex/workspace/backups/rigong-before-cloud-20261012';
const out = 'D:/codex/workspace/outputs/rigong-cloud-sync';
const stage = 'D:/codex/workspace/temp/rigong-cloud-sync-package';
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(stage, { recursive: true });
const dirs = ['src', 'assets', 'vendor', 'backend', 'tests', 'tools'];
const files = ['index.html', 'manifest.webmanifest', 'sw.js', 'package.json', 'package-lock.json', 'README.md', 'NOTICE.md', '发给WorkBuddy.txt'];
function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (['integrate.cjs', 'cloud.js'].includes(entry.name)) continue;
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to); else fs.copyFileSync(from, to);
  }
}
for (const dir of dirs) copyTree(path.join(root, dir), path.join(stage, dir));
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(stage, file));
const hashes = {};
function walk(dir, relative = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(relative, entry.name), full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, rel);
    else hashes[rel] = require('node:crypto').createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  }
}
walk(baseline);
fs.writeFileSync(path.join(stage, 'original-files.sha256.json'), JSON.stringify(hashes, null, 2));
const changes = ['index.html', 'sw.js', 'src/util.js', 'src/store.js', 'src/main.js', 'src/ui.js'];
let patch = '';
for (const file of changes) {
  const r = cp.spawnSync('git', ['diff', '--no-index', '--', path.join(baseline, file), path.join(root, file)], { encoding: 'utf8' });
  if (![0, 1].includes(r.status)) throw new Error(r.stderr || 'git diff unavailable');
  patch += r.stdout.split('\n').map(line => line.startsWith('diff --git ') ? 'diff --git a/' + file + ' b/' + file
    : line.startsWith('--- ') ? '--- a/' + file : line.startsWith('+++ ') ? '+++ b/' + file : line).join('\n');
}
fs.writeFileSync(path.join(stage, 'changes-v18.patch'), patch);
fs.copyFileSync(path.join(stage, 'changes-v18.patch'), path.join(out, 'changes-v18.patch'));
for (const file of ['README.md', '发给WorkBuddy.txt']) fs.copyFileSync(path.join(root, file), path.join(out, file));
console.log('Package source prepared: ' + stage);
