/* ============ 一句话建习惯 + 语音指令解析（纯规则，不联网） ============ */
window.Parse = (function () {

  const SLOT_WORDS = [
    [/早上|早晨|起床后|清晨|早间/, 'morning'],
    [/上午/, 'morning'],
    [/中午|午间|午休/, 'noon'],
    [/下午|午后/, 'afternoon'],
    [/晚上|傍晚|睡前|夜里|夜间|晚间/, 'evening']
  ];
  const UNIT_MAP = [
    [/分钟|分/, '分钟'], [/小时|个?钟头/, '小时'], [/公里|千米|km/i, '公里'],
    [/步/, '步'], [/升|L/i, '升'], [/毫升|ml/i, '毫升'], [/杯/, '杯'],
    [/页/, '页'], [/个/, '个'], [/次|遍|组/, '次'], [/字/, '字'], [/元|块/, '元']
  ];
  const TAG_MAP = [
    [/跑|走|健身|运动|游泳|骑行|瑜伽|拉伸|深蹲/, '运动'],
    [/读|看书|阅读|背单词|学习|练|课|写|复盘|英语/, '学习'],
    [/喝水|早睡|早起|睡|吃|饭|蔬果|维生素|药|冥想|呼吸/, '健康'],
    [/日记|笔记|复盘|计划|总结|整理/, '整理'],
    [/陪|家人|朋友|电话/, '关系']
  ];
  const DURATION_HINT = /读|阅读|背|学|练习|练琴|冥想|专注|写作|复盘|听力/;
  const NAME_STOP = /^(每天|每周|每个?周|一周|早晨|早上|上午|中午|下午|晚上|睡前|起床后|记得|要|坚持|打卡|做|进行)$/;

  function slotOf(t) {
    for (const [re, s] of SLOT_WORDS) if (re.test(t)) return s;
    return 'any';
  }
  function timeOf(t) {
    let m = t.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (m) return U.pad(+m[1]) + ':' + m[2];
    m = t.match(/(\d{1,2})\s*点(半|\s*(\d{1,2})\s*分)?/);
    if (m) {
      const h = +m[1];
      const mm = m[2] === '半' ? 30 : (m[3] ? +m[3] : 0);
      return U.pad(h) + ':' + U.pad(mm);
    }
    // 中文数字：早上七点 / 九点半 / 八点二十分
    m = t.match(/([零一二两三四五六七八九十]+)\s*点(半|\s*([零一二三四五六七八九]+)\s*分?)?/);
    if (m) {
      const h = U.cnNum(m[1]);
      const mm = m[2] === '半' ? 30 : (m[3] ? U.cnNum(m[3]) : 0);
      if (h != null && h <= 23) return U.pad(h) + ':' + U.pad(mm || 0);
    }
    return null;
  }
  function tagsOf(t) {
    const out = [];
    TAG_MAP.forEach(([re, tag]) => { if (re.test(t) && !out.includes(tag)) out.push(tag); });
    return out;
  }
  function scheduleOf(t) {
    if (/工作日|周一到周五|周一至周五|周一至五/.test(t)) return { type: 'weekdays', days: [1, 2, 3, 4, 5] };
    // 每周 N 次（优先于"周几"，避免"周三次"被误判成周三）
    const m = t.match(/(?:每周|一周|每个?周)[^次]{0,6}?([一二三四五六七八九十两\d]+)\s*次/);
    if (m) return { type: 'timesPerWeek', n: U.cnNum(m[1]) || 3 };
    // 周几（支持连写：周一三五 / 周一、周三）
    if (/周[一二三四五六日天]/.test(t)) {
      const MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
      const days = [];
      t.replace(/周([一二三四五六日天]+)/g, (_, run) => {
        for (const ch of run) if (!days.includes(MAP[ch])) days.push(MAP[ch]);
        return _;
      });
      if (days.length) return { type: 'weekdays', days: days.sort() };
    }
    const i = t.match(/每\s*([二三四五六七两]|\d+)\s*天/);
    if (i) return { type: 'interval', n: U.cnNum(i[1]) || 2 };
    return { type: 'daily' };
  }
  function nameOf(t) {
    let s = t.trim()
      .replace(/^(我想|我要|打算|计划|希望|提醒我|帮我)\s*/, '')
      .replace(/^(每天|每日)\s*/, '')
      .replace(/^(每周|每个?周|一周)\s*[一二三四五六日天\d一二三四五六七八九十两]*\s*次?/, '')
      .replace(/^工作日\s*/, '')
      .replace(/^每\s*[\d一二三四五六七八九十两]+\s*天\s*/, '')
      .replace(/(早上|早晨|上午|中午|下午|晚上|傍晚|睡前|夜里|夜间|晚间|清晨|起床后)\s*/g, '')
      .replace(/\d{1,2}\s*[:：]\s*\d{2}\s*(之)?前?/g, '')
      .replace(/\d{1,2}\s*点(半|\s*\d{1,2}\s*分)?\s*(之)?前?/g, '')
      .replace(/[零一二两三四五六七八九十]+\s*点(半|\s*[零一二三四五六七八九]+\s*分?)?\s*(之)?前?/g, '')
      .replace(/[，,。！!~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // 去掉尾部的数量短语，留作名称主体
    s = s.replace(/\s*(\d+(?:\.\d+)?|[一二三四五六七八九十两百]+)\s*(分钟|分|小时|个?钟头|公里|千米|km|步|升|毫升|杯|页|个|次|遍|组|字|元|块)\s*$/i, '')
      .replace(/\s*(坚持|打卡|哟|哦|吧|呢)$/, '').trim();
    if (!s) s = t.trim().slice(0, 12);
    if (s.length > 18) s = s.slice(0, 18);
    return s || '新习惯';
  }

  /* 一句话 -> 习惯草稿 */
  function habit(text) {
    const t = String(text || '').trim();
    const slot = slotOf(t);
    let reminderAt = timeOf(t);
    if (reminderAt && slot === 'evening') {
      // 「晚上11点」实为 23:00；「晚上12点」按 0:00 处理
      let hh = parseInt(reminderAt.slice(0, 2), 10);
      if (hh >= 1 && hh < 12) hh += 12;
      else if (hh === 12) hh = 0;
      if (reminderAt.slice(0, 2) !== U.pad(hh)) reminderAt = U.pad(hh) + reminderAt.slice(2);
    }
    reminderAt = reminderAt || ({ morning: '07:30', noon: '12:30', afternoon: '15:00', evening: '20:30', any: null })[slot];
    const schedule = scheduleOf(t);
    const tags = tagsOf(t);
    const name = nameOf(t);

    let type = 'check', target = null, unit = '';
    const nm = t.match(/(\d+(?:\.\d+)?|[一二三四五六七八九十两百]+)\s*(分钟|分|小时|个?钟头|公里|千米|km|步|升|毫升|杯|页|个|次|遍|组|字|元|块)/i);
    if (nm) {
      target = U.cnNum(nm[1]);
      unit = UNIT_MAP.find(([re]) => re.test(nm[2]))?.[1] || nm[2];
      type = (unit === '分钟' || unit === '小时') && DURATION_HINT.test(name + t) ? 'duration' : 'number';
      if (unit === '次' || unit === '遍' || unit === '组') type = 'number';
    }
    return { name, type, target, unit, slot, reminderAt, schedule, tags, color: null };
  }

  /* 语音指令 -> 动作 */
  function command(text, items) {
    const t = String(text || '').trim().replace(/[。，,.！!？?]/g, ' ');
    const list = items || Engine.items();
    const low = t.toLowerCase();

    // 1) 记录笔记
    let m = t.match(/(?:记一下|记笔记|写下|备注|日记)\s*(.+)/);
    if (m) return { kind: 'note', text: m[1].trim() };

    // 2) 心情
    m = t.match(/(?:今天)?心情\s*([一二三四五1-5])/);
    if (m) return { kind: 'mood', value: U.cnNum(m[1]) };

    // 3) 数值：先找习惯名，再看有没有数字
    const numM = t.match(/(\d+(?:\.\d+)?|[一二三四五六七八九十两百]+)\s*(分钟|分|公里|千米|步|升|毫升|杯|页|个|次|遍|组|字)/);
    let item = matchItem(t, list);
    if (item && numM) {
      const v = U.cnNum(numM[1]);
      return { kind: 'value', item, value: v };
    }
    if (item) {
      if (/取消|撤销|不(?:算|做了)/.test(t)) return { kind: 'undo', item };
      return { kind: 'toggle', item };
    }
    if (numM && !item) return { kind: 'unmatched', text: t };
    return { kind: 'unmatched', text: t };
  }

  function matchItem(t, list) {
    let best = null, bestLen = 0;
    list.forEach(it => {
      const n = it.name;
      if (!n) return;
      if (t.includes(n) && n.length > bestLen) { best = it; bestLen = n.length; }
    });
    if (best) return best;
    // 部分匹配：习惯名前两个字
    list.forEach(it => {
      const n = it.name || '';
      if (n.length >= 2 && t.includes(n.slice(0, 2)) && 2 > bestLen) { best = it; bestLen = 2; }
    });
    return best;
  }

  return { habit, command, matchItem, slotOf, timeOf };
})();
