/* Safety 模块：本地快照 / 回滚 / 离线判断
 * 运行：node tests/safety.test.js
 * Node 没有 localStorage，先塞一个最小实现。 */
const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
globalThis.window = globalThis;
globalThis.navigator = { onLine: true };

require('../src/util.js');
require('../src/safety.js');
const S = globalThis.Safety;

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

console.log('\n数据安全网模块：');

/* ---- 1. 快照 ---- */
function mkState(n) {
  return {
    version: 7, settings: { theme: 'light' },
    items: new Array(n).fill(0).map((_, i) => ({ id: 'i' + i, name: '习惯' + i })),
    logs: { '2026-10-01': { i0: { v: 1, d: true } } },
    notes: {}, media: { big: 'x'.repeat(1000) }, sessions: [{ tmp: 1 }]
  };
}
globalThis.Store = { s: mkState(3) };

ck('初始无快照', S.list().length === 0);
ck('存一份成功', S.snapshot('2026-10-03') === true);
ck('同一天不覆盖', S.snapshot('2026-10-03') === false);
ck('列表出现这一天', S.list().length === 1 && S.list()[0].date === '2026-10-03');
ck('元信息正确', S.list()[0].items === 3 && S.list()[0].logs === 1);

/* media / sessions 不该进备份 */
const raw = store['rigongyizhu.snaps'] || '';
ck('剔除了 media', raw.indexOf('"media"') < 0);
ck('剔除了 sessions', raw.indexOf('"sessions"') < 0);
ck('保留了 logs', raw.indexOf('2026-10-01') > 0);

/* ---- 2. 每天一份，只留 7 天 ---- */
['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']
  .forEach(d => S.snapshot(d));
ck('最多保留 7 天', S.list().length === 7);
ck('最早那份被挤掉', !S.list().some(x => x.date === '2026-10-03'));
ck('最新的还在', S.list()[0].date === '2026-10-11');

/* ---- 3. daily() 幂等（先清空，避免和上面的日期撞车） ---- */
S.clear();
globalThis.Store.s = mkState(2);
ck('daily 首次写入', S.daily() === true);
ck('daily 再次不写', S.daily() === false);
ck('写的是今天', S.list()[0].date === U.today());

/* ---- 4. 回滚 ---- */
S.clear();
S.snapshot('2026-09-01', mkState(5));          // 5 个习惯的那天
let committed = false;
globalThis.Store = {
  s: { version: 7, settings: {}, items: [{ id: 'z', name: '坏的' }], logs: {} },
  commit(fn) { fn(globalThis.Store.s); committed = true; }
};
const r = S.restore('2026-09-01');
ck('回滚成功', r.ok === true);
ck('执行了 commit', committed === true);
ck('数据被替换成快照内容', globalThis.Store.s.items.length === 5);
ck('回滚前留了退路', S.list().some(x => x.date.indexOf('pre-restore-') === 0));
ck('回滚不存在的日期会报错', S.restore('1999-01-01').ok === false);

/* ---- 5. 离线 ---- */
ck('默认在线', S.online() === true);
globalThis.navigator.onLine = false;
ck('能识别离线', S.online() === false);
globalThis.navigator.onLine = true;

/* ---- 6. 损坏数据不崩 ---- */
store['rigongyizhu.snaps'] = '{坏掉的 json';
ck('坏 JSON 不会抛异常', (function () { try { return S.list().length === 0; } catch (e) { return false; } })());
ck('坏数据下 daily 也能跑', (function () { try { S.daily(); return true; } catch (e) { return false; } })());

/* ---- 7. 超限不写 ---- */
store['rigongyizhu.snaps'] = '{}';
globalThis.Store.s = { items: [{ id: 'a', name: 'x'.repeat(1000000) }] };
ck('超大状态直接放弃备份', S.snapshot('2026-12-01') === false);
ck('放弃后列表仍为空', S.list().length === 0);

/* ---- 8. 自救卡 ---- */
const html = S.rescueHTML(new Error('测试崩溃'));
ck('自救卡含重新加载', html.indexOf('rescueretry') > 0);
ck('自救卡含导出', html.indexOf('rescueexport') > 0);
ck('自救卡显示错误信息', html.indexOf('测试崩溃') > 0);

console.log('\n' + (fail ? '✗ ' : '✓ ') + 'Safety：' + pass + '/' + (pass + fail) + ' 通过');
process.exit(fail ? 1 : 0);
