/* 日记本模块测试：node tests/diary.test.js */
global.window = global;
require('../src/util.js');
require('../src/engine.js');
require('../src/diary.js');

const U = window.U, E = window.Engine, D = window.Diary;

let pass = 0, total = 0;
function ck(name, cond, extra) {
  total++;
  if (cond) pass++;
  else console.log('  ✗ FAIL', name, extra === undefined ? '' : extra);
}

const today = U.today();
const yest = U.shiftYmd(today, -1);
const d2 = U.shiftYmd(today, -2);

const state = {
  items: [
    { id: 'a', name: '跑步', type: 'check', color: '#ff5a5f', createdAt: U.shiftYmd(today, -30), schedule: { type: 'daily' } },
    { id: 'b', name: '喝水', type: 'number', target: 8, unit: '杯', createdAt: U.shiftYmd(today, -30), schedule: { type: 'daily' } }
  ],
  logs: {}, notes: {}, moods: {}, settings: {}, media: {}
};
global.Store = {
  s: state,
  rev: 0,
  commit(fn) { if (fn) fn(state); if (E.bustCache) E.bustCache(); },
  putMedia(id) { state.media[id] = { id: id }; return Promise.resolve(id); },
  dropThumb() { }
};

/* ---- 1. 基础读写 ---- */
D.setText(today, '今天状态不错');
ck('写入正文', D.raw(today).text === '今天状态不错');
ck('note() 会创建', !!D.note(d2));
ck('hasContent 认得正文', D.hasContent(today) === true);
ck('空日子 hasContent=false', D.hasContent(d2) === false);

D.setMood(today, 5);
ck('心情写入', state.moods[today] === 5);
D.setMood(today, 99);
ck('心情被夹在 1~5', state.moods[today] === 5);

/* ---- 2. 自动收录 ---- */
state.logs[today] = { a: { d: true, t: Date.now() } };
state.logs[yest] = { a: { d: true, t: Date.now() }, b: { v: 8 } };
const s = D.summary(today);
ck('完成清单有 1 项', s.done.length === 1, s.done.length);
ck('完成项带名字', s.done[0] && s.done[0].name === '跑步');
ck('完成率分子=1', s.rate.done === 1, JSON.stringify(s.rate));
ck('完成率分母=2', s.rate.total === 2, JSON.stringify(s.rate));
const s2 = D.summary(yest);
ck('昨天完成 2 项', s2.done.length === 2, s2.done.length);

/* ---- 3. 时间轴 ---- */
const ds = D.days(30, 0);
ck('时间轴含今天', ds.indexOf(today) >= 0, JSON.stringify(ds));
ck('时间轴倒序', ds.length < 2 || ds[0] > ds[1], JSON.stringify(ds));
ck('天数统计', D.totalDays() >= 2, D.totalDays());

/* ---- 4. 日历 ---- */
const g = D.monthGrid(today.slice(0, 7));
ck('日历 42 格', g.cells.length === 42, g.cells.length);
ck('日历标签含年', /\d{4}年\d{1,2}月/.test(g.label), g.label);
const firstCell = g.cells[0];
ck('日历周一起头', U.weekdayOf(firstCell.date) === 1, firstCell.date);
const tcell = g.cells.find(c => c.date === today);
ck('今天在日历里且被标记', !!tcell && tcell.isToday === true);
ck('写了日记的日子有标记', !!tcell && tcell.hasNote === true);

/* ---- 5. 图片 ---- */
function addN(n) {
  let last;
  const chain = [];
  for (let i = 0; i < n; i++) chain.push({ id: 'p' + i });
  return chain.reduce((p, x) => p.then(() => D.addPhoto(today, { size: 1024, type: 'image/jpeg' })), Promise.resolve())
    .then(() => D.addPhoto(today, { size: 1024, type: 'image/jpeg' }));
}
(async () => {
  await addN(D.MAX_PHOTOS);
  ck('能加满上限', D.countPhotos(today) === D.MAX_PHOTOS, D.countPhotos(today));
  const over = await D.addPhoto(today, { size: 1024, type: 'image/jpeg' });
  ck('超过上限被拒绝', over.ok === false, JSON.stringify(over));
  ck('拒绝时有说明文案', /最多/.test(over.msg || ''), over.msg);

  const firstId = D.raw(today).photos[0].id;
  const secondId = D.raw(today).photos[1].id;
  D.movePhoto(today, secondId, -1);
  ck('前移生效', D.raw(today).photos[0].id === secondId);
  D.removePhoto(today, secondId);
  ck('删除生效', D.countPhotos(today) === D.MAX_PHOTOS - 1, D.countPhotos(today));

  /* ---- 6. 压缩：无 DOM 环境应安全退回原图 ---- */
  const c = await D.compressImage({ size: 500, type: 'image/jpeg' });
  ck('无 canvas 时压缩安全退回', c && c.skipped === true, JSON.stringify(c));

  /* ---- 7. 天气码映射 ---- */
  ck('晴天码', D.mapWmo('113') === 'sunny');
  ck('雷雨码', D.mapWmo('395') === 'storm');
  ck('雪码', D.mapWmo('326') === 'snow');
  ck('小雨码', D.mapWmo('293') === 'rain');
  ck('乱码兜底', D.mapWmo('abc') === 'cloudy');
  ck('图标能取到', D.wIcon('sunny') === '☀️', D.wIcon('sunny'));
  ck('名字能取到', D.wName('rain') === '雨');

  /* ---- 8. 提醒判定 ---- */
  state.notes[yest] = { text: '', photos: [], audios: [] };
  ck('打了卡没写字 -> 需要提醒', D.needsWrite(yest) === true);
  D.setText(yest, '补一篇');
  ck('写了字 -> 不提醒', D.needsWrite(yest) === false);

  /* ---- 9. Markdown 导出 ---- */
  D.setWeather(today, { k: 'sunny', t: '26', city: '西安', auto: 1 });
  const md = D.exportMarkdown();
  ck('导出有内容', md.n >= 2, md.n);
  ck('导出含日期标题', md.text.indexOf(U.prettyDate(today)) >= 0);
  ck('导出含完成的习惯', md.text.indexOf('跑步') >= 0);
  ck('导出含日记正文', md.text.indexOf('今天状态不错') >= 0);
  ck('导出含天气', md.text.indexOf('☀️') >= 0 && md.text.indexOf('西安') >= 0);
  ck('导出按时间升序', md.text.indexOf(U.prettyDate(yest)) < md.text.indexOf(U.prettyDate(today)));

  const one = D.dayMarkdown(today);
  ck('单天 Markdown 有标题', one.indexOf('## ') === 0);

  /* ---- 10. 天气写入与清除 ---- */
  ck('天气已写入', D.raw(today).weather.k === 'sunny');
  D.clearWeather(today);
  ck('天气可清除', !D.raw(today).weather);

  /* ---- 11. 搜索 ---- */
  D.setText(today, '今天去跑步了，天气很好');
  D.setText(yest, '面试不太顺利');
  const r1 = D.search('跑步');
  ck('能搜到正文关键词', r1.length >= 1 && r1[0].date === today, JSON.stringify(r1.map(x => x.date)));
  ck('片段含关键词', r1[0].snippet.indexOf('跑步') >= 0, r1[0].snippet);
  const r2 = D.search('面试');
  ck('能搜到另一天', r2.length === 1 && r2[0].date === yest);
  ck('结果按日期倒序', r1.length < 2 || r1[0].date >= r1[1].date);
  ck('搜不到返回空', D.search('不存在的词xyz').length === 0);
  ck('多关键词需全部命中', D.search('跑步 天气').length === 1 && D.search('跑步 面试').length === 0);
  ck('空关键词返回空', D.search('').length === 0 && D.search('   ').length === 0);

  /* ---- 12. 封面 ---- */
  const stt = global.Store.s;
  stt.notes[today].photos = [{ id: 'p1', ts: 1 }, { id: 'p2', ts: 2 }, { id: 'p3', ts: 3 }];
  ck('默认封面是第一张', D.coverOf(today) === 'p1', D.coverOf(today));
  D.setCover(today, 'p3');
  ck('可指定任意一张作封面', D.coverOf(today) === 'p3');
  D.setCover(today, '');
  ck('取消封面后回落到第一张', D.coverOf(today) === 'p1');
  D.setCover(today, 'notexist');
  ck('无效封面 id 被忽略', D.coverOf(today) === 'p1');
  ck('没图时封面为空', D.coverOf(U.shiftYmd(today, -300)) === '');

  /* ---- 13. 月度小结 ---- */
  const pm = D.prevMonth(today.slice(0, 7));
  ck('prevMonth 是上个月', pm < today.slice(0, 7) && /^\d{4}-\d{2}$/.test(pm), pm);
  D.setText(pm + '-01', '上月一号');
  D.setText(pm + '-02', '上月二号');
  stt.notes[pm + '-01'].photos = [{ id: 'q1', ts: 1 }];
  const ms = D.monthSummary(pm);
  ck('月度小结：写了 2 天', ms.wrote === 2, ms.wrote);
  ck('月度小结：照片 1 张', ms.photos === 1, ms.photos);
  ck('月度小结：有标签名', ms.label.indexOf('月') > 0, ms.label);
  ck('月度小结：完成率 0~100', ms.rate >= 0 && ms.rate <= 100, ms.rate);

  /* ---- 14. 连续写日记 ---- */
  D.setText(today, 'a'); D.setText(yest, 'b'); D.setText(d2, 'c');
  ck('连续 3 天', D.writeStreak(today) === 3, D.writeStreak(today));
  stt.notes[yest].text = ''; stt.notes[yest].photos = [];
  ck('中间断掉只剩今天', D.writeStreak(today) === 1, D.writeStreak(today));
  ck('判定昨天漏写', D.missedYesterday(today) === true);
  stt.notes[today].text = ''; stt.notes[today].photos = [];
  ck('今天昨天都没写则连续归零', D.writeStreak(today) === 0, D.writeStreak(today));
  ck('gapDays 算出断了 1 天', D.gapDays(today) === 1, D.gapDays(today));
  ck('wroteDay 认图不认空文本', (function () {
    stt.notes[today].text = '   '; stt.notes[today].photos = [{ id: 'z', ts: 1 }];
    const v = D.wroteDay(today); stt.notes[today].photos = []; return v;
  })());

  /* ---- 15. 图片排序 ---- */
  stt.notes[today].photos = [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }];
  D.movePhoto(today, 'x3', -1);
  ck('图片可前移', stt.notes[today].photos[1].id === 'x3', JSON.stringify(stt.notes[today].photos.map(p => p.id)));
  D.movePhoto(today, 'x1', 1);
  ck('图片可后移', stt.notes[today].photos[1].id === 'x1');
  D.movePhoto(today, 'x1', -1);
  ck('首张前移不越界', stt.notes[today].photos[0].id === 'x1');

  console.log('\n日记模块：' + pass + '/' + total + ' 通过');
  if (pass !== total) process.exit(1);
})();
