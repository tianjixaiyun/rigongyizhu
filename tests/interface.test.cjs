const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.resolve(__dirname, '..');
test('所有八个页面沿用真实前端模块均能渲染，导航状态正确', async t => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://local-test.example/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.indexedDB = new IDBFactory(); w.structuredClone = structuredClone;
  w.matchMedia = () => ({ matches: false, addEventListener() {} }); w.scrollTo = () => {};
  let networkCalls = 0;
  w.fetch = async () => { networkCalls++; throw new Error('Test network disabled'); };
  const scripts = [...html.matchAll(/<script defer src="(src\/[^"?]+)(?:\?[^"]*)?"/g)].map(x => x[1]);
  for (const script of scripts.filter(x => !x.endsWith('/main.js'))) w.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  w.Store.initSync(); await w.Store.init();
  w.Store._doSave = () => {};
  // Weather retrieval is an external service and is not part of a DOM render test.
  w.Diary.ensureWeather = async () => null;
  for (const tab of ['today', 'todos', 'diary', 'habits', 'rooms', 'grow', 'connect', 'me']) {
    assert.doesNotThrow(() => w.UI.go(tab), tab);
    assert.ok(w.document.getElementById('view').textContent.trim().length > 0, tab);
    assert.equal(w.document.querySelector('.tab[aria-current="page"]').dataset.tab, tab);
  }
  assert.equal(networkCalls, 0);
});
