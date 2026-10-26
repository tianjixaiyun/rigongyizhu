/* v36 加密备份单元测试
 * 外部评审要求「密码加密备份 + 密码遗失说明 + 恢复校验」，这三件事都得有测试兜着：
 *   · 加密后的文件里不能出现明文（否则等于没加密）
 *   · 同一个密码必须能解回原文（恢复校验的前提）
 *   · 密码错必须解不开（GCM 完整性校验，不能解出半份数据）
 *   · 文件被改动一个字符必须解不开
 *   · 信封必须能被识别，普通 JSON 备份不能被误判成加密备份
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function sandbox() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://local-test.example/', runScripts: 'outside-only',
    pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
  /* jsdom 不带 TextEncoder/TextDecoder，浏览器里是内置的 */
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.eval(read('src/enc.js'));
  return w;
}

const PLAIN = JSON.stringify({
  app: '日拱一卒', schema: 7,
  state: { items: [{ id: 'a', name: '早起' }], logs: { '2026-10-22': { a: { d: true } } } }
});

test('加密后文件里没有明文，且格式标记正确', async () => {
  const w = sandbox();
  const env = await w.Enc.encrypt(PLAIN, 'correct horse battery');
  assert.equal(env.format, 'rigongyizhu-enc-v1');
  assert.equal(env.cipher, 'AES-GCM-256');
  assert.equal(env.kdf, 'PBKDF2-SHA256');
  assert.ok(env.iter >= 200000, '迭代次数不该低于 20 万，实际 ' + env.iter);
  const text = JSON.stringify(env);
  assert.ok(text.indexOf('早起') < 0, '文件里不能出现习惯名明文');
  assert.ok(env.data.indexOf('早起') < 0 && env.data.indexOf('items') < 0, '密文里不能有明文片段');
  /* 每次加密的盐和 iv 必须不同，否则同样的密码+内容会产生同样的密文 */
  const env2 = await w.Enc.encrypt(PLAIN, 'correct horse battery');
  assert.notEqual(env.salt, env2.salt);
  assert.notEqual(env.iv, env2.iv);
  assert.notEqual(env.data, env2.data);
});

test('同一个密码能解回原文（恢复校验）', async () => {
  const w = sandbox();
  const env = await w.Enc.encrypt(PLAIN, 'correct horse battery');
  const back = await w.Enc.decrypt(env, 'correct horse battery');
  assert.equal(back, PLAIN);
  assert.equal(JSON.parse(back).state.items[0].name, '早起');
});

test('密码错必须解不开，且提示能看懂', async () => {
  const w = sandbox();
  const env = await w.Enc.encrypt(PLAIN, 'correct horse battery');
  await assert.rejects(() => w.Enc.decrypt(env, 'wrong password!'), /密码不对|文件被改动/);
});

test('文件被改一个字符就解不开（GCM 完整性）', async () => {
  const w = sandbox();
  const env = await w.Enc.encrypt(PLAIN, 'correct horse battery');
  /* 改密文最后一个字符（base64 里换一个合法字符） */
  const last = env.data.slice(-1);
  env.data = env.data.slice(0, -1) + (last === 'A' ? 'B' : 'A');
  await assert.rejects(() => w.Enc.decrypt(env, 'correct horse battery'));
});

test('信封识别：只认带 format 标记的，普通备份不误判', async () => {
  const w = sandbox();
  const env = await w.Enc.encrypt(PLAIN, 'correct horse battery');
  assert.equal(w.Enc.isEnvelope(env), true);
  assert.equal(w.Enc.isEnvelope(JSON.parse(PLAIN)), false);
  assert.equal(w.Enc.isEnvelope(null), false);
  assert.equal(w.Enc.isEnvelope({ format: 'something-else', data: 'x' }), false);
});

test('密码太短直接拒绝（不留「123」这种）', async () => {
  const w = sandbox();
  await assert.rejects(() => w.Enc.encrypt(PLAIN, '1234567'), /至少 8 位/);
});

test('非安全上下文（没有 crypto.subtle）给出可执行提示，而不是崩掉', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://192.168.1.9:8080/', runScripts: 'outside-only', virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { value: {}, configurable: true });   // 没有 subtle
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.eval(read('src/enc.js'));
  assert.equal(w.Enc.available(), false);
  await assert.rejects(() => w.Enc.encrypt(PLAIN, 'correct horse battery'), /https/);
});
