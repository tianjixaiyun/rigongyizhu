/* v15「稳定版」回归测试：node tests/v15.test.js
 * 覆盖两处本轮改动：
 *  ① Engine.sorted() —— 展示顺序的唯一入口，今日页 / 习惯页 / 移动排序必须同一套规则
 *  ② ErrLog —— 异常记录环形缓冲：上限、截断、清除、不崩
 */
global.window = global;

/* localStorage 桩（ErrLog 依赖） */
const mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};

require('../src/util.js');
require('../src/errlog.js');

const state = {
  version: 7, settings: { seedPts: 0, nickname: '我' },
  items: [], bundles: [], logs: {}, notes: {}, moods: {}, rewards: [],
  redemptions: [], sessions: [], members: [], rooms: [], media: {},
  freezes: {}, achievements: {}
};
let rev = 0;
global.Store = {
  s: state,
  get rev() { return rev; },
  bump() { rev++; },
  commit(fn) { if (fn) fn(state); rev++; },
  save() { }
};
require('../src/engine.js');

const U = window.U, E = window.Engine, ErrLog = window.ErrLog;
let pass = 0, fail = 0;
function ck(n, c, x) { if (c) pass++; else { fail++; console.log('FAIL: ' + n + (x !== undefined ? ' :: ' + x : '')); } }

/* ================= 1. Engine.sorted ================= */
ck('sorted 已导出且是函数', typeof E.sorted === 'function');

const mk = (id, sort, extra) => Object.assign({
  id, sort, name: id, type: 'check', target: null, unit: '', slot: 'any',
  tags: [], color: '#000', steps: [], schedule: { type: 'daily' },
  archived: false, deleted: false, createdAt: Date.now(), updatedAt: Date.now()
}, extra || {});

state.items = [
  mk('c', 2), mk('a', 0), mk('d', 3), mk('b', 1)
];
Store.bump();
ck('sorted() 按 sort 升序', E.sorted().map(x => x.id).join(',') === 'a,b,c,d', E.sorted().map(x => x.id).join(','));

/* items() 保持原序（不受 sorted 影响） */
ck('items() 不排序，保持原始顺序', E.items().map(x => x.id).join(',') === 'c,a,d,b', E.items().map(x => x.id).join(','));

/* sorted() 不能污染 items() 的返回数组 —— 否则一次排序会永久改掉数据顺序 */
const before = E.items().map(x => x.id).join(',');
E.sorted();
ck('sorted() 不就地修改 items()', E.items().map(x => x.id).join(',') === before);

/* 过滤已删除 / 已归档 */
state.items = [mk('keep', 0), mk('del', 1, { deleted: true }), mk('arch', 2, { archived: true })];
Store.bump();
ck('sorted() 排除已删除', E.sorted().every(x => x.id !== 'del'));
ck('sorted() 排除已归档', E.sorted().every(x => x.id !== 'arch'));
ck('sorted() 只留活跃习惯', E.sorted().length === 1, E.sorted().length);

/* sort 缺失 / 重复时不炸，且有稳定顺序 */
state.items = [mk('x', undefined), mk('y', null), mk('z', 0)];
Store.bump();
ck('sort 缺失时不抛异常', Array.isArray(E.sorted()) && E.sorted().length === 3);

/* 数据变更后缓存失效：sort 改了要立刻反映 */
state.items = [mk('p', 0), mk('q', 1)];
Store.bump();
ck('初始顺序 p,q', E.sorted().map(x => x.id).join(',') === 'p,q');
state.items[0].sort = 5;
Store.bump();
ck('改 sort 并 bump 后顺序更新', E.sorted().map(x => x.id).join(',') === 'q,p', E.sorted().map(x => x.id).join(','));

/* ================= 2. ErrLog ================= */
ck('ErrLog 已导出', !!ErrLog);
ck('初始没有记录', ErrLog.count() === 0);

ErrLog.push('error', new Error('boom'));
ck('push 一条后 count=1', ErrLog.count() === 1, ErrLog.count());
ck('记录了 kind', ErrLog.all()[0].kind === 'error');
ck('记录了消息', /boom/.test(ErrLog.all()[0].msg), ErrLog.all()[0].msg);
ck('记录了时间戳', typeof ErrLog.all()[0].at === 'number');
ck('记录了版本号', ErrLog.all()[0].v === U.VERSION, ErrLog.all()[0].v);

/* 字符串型异常也要能记 */
ErrLog.push('rejection', 'something failed');
ck('能记录字符串异常', ErrLog.count() === 2 && /something failed/.test(ErrLog.all()[1].msg));

/* null / undefined 不能抛 */
let threw = false;
try { ErrLog.push('error', null); ErrLog.push('error', undefined); } catch (e) { threw = true; }
ck('传 null/undefined 不抛异常', !threw);

/* 长消息截断到 400 字符 */
ErrLog.clear();
ErrLog.push('error', 'x'.repeat(2000));
ck('超长消息截断到 400', ErrLog.all()[0].msg.length === 400, ErrLog.all()[0].msg.length);

/* 环形上限 20：超出后保留最新的 */
ErrLog.clear();
for (let i = 0; i < 35; i++) ErrLog.push('error', 'e' + i);
const all = ErrLog.all();
ck('最多保留 20 条', all.length === 20, all.length);
ck('保留的是最新的 20 条', /e34$/.test(all[all.length - 1].msg), all[all.length - 1].msg);
ck('最旧的已被挤掉', all[0].msg === 'e15', all[0].msg);

/* recent(n) */
ck('recent(3) 返回 3 条', ErrLog.recent(3).length === 3);
ck('recent(0) 返回全部（默认 3）', ErrLog.recent().length === 3);
ck('recent 取的是最后几条', /e34$/.test(ErrLog.recent(1)[0].msg));

/* clear */
ErrLog.clear();
ck('clear 后归零', ErrLog.count() === 0);

/* 存储层坏掉时不能把主流程带崩 */
mem['rigongyizhu.errlog'] = '{坏掉的 JSON';
let threw2 = false;
try { ck('坏数据时 all() 返回数组', Array.isArray(ErrLog.all())); } catch (e) { threw2 = true; }
ck('坏数据不抛异常', !threw2);

console.log('\nWeb v15 稳定版：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exitCode = 1;
