/* 解析引擎回归测试：node tests/parse.test.js */
global.window = global;
require('../src/util.js');
require('../src/parse.js');
const P = window.Parse;

let pass = 0, total = 0;
function ck(name, cond) {
  total++;
  if (cond) pass++;
  else console.log('  ✗ FAIL', name);
}

/* ---- 一句话建习惯 ---- */
const T = [
  ['每天早上跑步 30 分钟', { name: '跑步', target: 30, unit: '分钟', slot: 'morning', sched: 'daily' }],
  ['每周一三五游泳45分钟', { name: '游泳', target: 45, sched: 'weekdays', days: [1, 3, 5] }],
  ['晚上11点前睡觉', { name: '睡觉', remind: '23:00', sched: 'daily' }],
  ['每周三次力量训练', { name: '力量训练', sched: 'timesPerWeek', n: 3 }],
  ['每天喝水1.5升', { name: '喝水', target: 1.5, unit: '升' }],
  ['工作日背单词20个', { name: '背单词', sched: 'weekdays', days: [1, 2, 3, 4, 5] }],
  ['每3天写一次周复盘', { sched: 'interval', n: 3 }],
  ['每周读书三次', { name: '读书', sched: 'timesPerWeek', n: 3 }],
  ['早上七点冥想10分钟', { name: '冥想', type: 'duration', target: 10, slot: 'morning' }],
  ['睡前拉伸15分钟', { name: '拉伸', slot: 'evening' }]
];
T.forEach(([text, exp], i) => {
  const h = P.habit(text);
  ck(i + ' name(' + exp.name + ')', !exp.name || h.name === exp.name);
  ck(i + ' target', exp.target == null || h.target === exp.target);
  ck(i + ' unit', !exp.unit || h.unit === exp.unit);
  ck(i + ' slot', !exp.slot || h.slot === exp.slot);
  ck(i + ' type', !exp.type || h.type === exp.type);
  ck(i + ' remind', !exp.remind || h.reminderAt === exp.remind);
  ck(i + ' sched', !exp.sched || h.schedule.type === exp.sched);
  if (exp.days) ck(i + ' days', JSON.stringify(h.schedule.days) === JSON.stringify(exp.days));
  if (exp.n) ck(i + ' n', h.schedule.n === exp.n);
});

/* ---- 语音指令 ---- */
const items = [
  { id: '1', name: '跑步', type: 'number', target: 30, unit: '分钟' },
  { id: '2', name: '喝水', type: 'check' }
];
global.Engine = { items: () => items };
const c1 = P.command('跑步20分钟', items);
ck('cmd value', c1.kind === 'value' && c1.value === 20 && c1.item.id === '1');
const c2 = P.command('喝水打卡', items);
ck('cmd toggle', c2.kind === 'toggle' && c2.item.id === '2');
const c3 = P.command('记一下今天心情不错', items);
ck('cmd note', c3.kind === 'note' && c3.text === '今天心情不错');
const c4 = P.command('取消喝水', items);
ck('cmd undo', c4.kind === 'undo' && c4.item.id === '2');
const c5 = P.command('今天心情4', items);
ck('cmd mood', c5.kind === 'mood' && c5.value === 4);

/* ---- 工具 ---- */
ck('cnNum 三', U.cnNum('三') === 3);
ck('cnNum 1.5', U.cnNum('1.5') === 1.5);
ck('cnNum 二十', U.cnNum('二十') === 20);
ck('shiftYmd', U.shiftYmd('2026-03-01', -1) === '2026-02-28');
ck('daysBetween', U.daysBetween('2026-01-01', '2026-01-31') === 30);
ck('num', U.num(1.50) === 1.5);

console.log(pass + '/' + total + ' assertions passed');
process.exit(pass === total ? 0 : 1);
