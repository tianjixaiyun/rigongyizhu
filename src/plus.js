/* ============ Plus：四个来自 GitHub 同类项目的新能力 ============
 *  1) 例程链 Routines   —— 把习惯串起来，做完一个自动指向下一个（habit stacking）
 *  2) 时间胶囊 Capsules —— 给未来的自己写一句话，到期才解锁
 *  3) 分享卡片 ShareCard —— 把坚持画成一张图，方便发朋友圈 / 群里
 *  4) CSV 导入           —— 从 Loop Habit Tracker 等 App 迁移过来
 */
/* 注：本文件的算法与绘制代码在 Web 版和微信小程序版之间是同一份，
 * 所以不要引用 document / window 之外的浏览器专有 API —— 画布由调用方提供（Plus.paintCard）。 */
var _proot = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
_proot.Plus = (function () {

  /* ============ 1. 例程链 ============ */
  function routines() {
    var st = Store.s;
    if (!st) return [];            /* Store 还没初始化好时不炸 */
    if (!st.routines) st.routines = [];
    return st.routines;
  }
  function addRoutine(name, slot, itemIds) {
    var st = Store.s;
    st.routines = st.routines || [];
    var r = { id: U.uid('rt'), name: name || '我的例程', slot: slot || 'any', itemIds: itemIds || [], on: true, createdAt: Date.now() };
    st.routines.push(r);
    Store.commit();
    return r;
  }
  function delRoutine(id) {
    Store.commit(function (s) { s.routines = (s.routines || []).filter(x => x.id !== id); });
  }
  function saveRoutine(id, patch) {
    Store.commit(function (s) {
      var r = (s.routines || []).find(x => x.id === id);
      /* 打时间戳：多设备合并时才知道哪份更新 */
      if (r) Object.assign(r, patch, { updatedAt: Date.now() });
    });
  }
  /* 例程当前状态：按顺序谁做完了、下一个是谁 */
  function routineState(r, date) {
    date = date || U.today();
    var all = (Store.s.items || []).filter(x => !x.deleted && !x.archived);
    var ordered = (r.itemIds || []).map(id => all.find(x => x.id === id)).filter(Boolean);
    var done = 0, next = null;
    ordered.forEach(function (it) {
      var ok = Engine.isDone(it, date);
      var skip = (typeof Extra !== 'undefined' && Extra) ? Extra.isSkipped(date, it.id) : false;
      if (ok || skip) done++;
      else if (!next) next = it;
    });
    return { items: ordered, done: done, total: ordered.length, next: next, pct: ordered.length ? Math.round(done / ordered.length * 100) : 0 };
  }
  /* 某个习惯做完之后，它所在的例程里下一个该做什么 */
  function nextAfter(itemId, date) {
    date = date || U.today();
    var rs = routines().filter(r => r.on !== false && (r.itemIds || []).indexOf(itemId) >= 0);
    for (var i = 0; i < rs.length; i++) {
      var st = routineState(rs[i], date);
      if (st.next && st.next.id !== itemId) return { routine: rs[i], item: st.next, left: st.total - st.done };
    }
    return null;
  }

  /* ============ 2. 时间胶囊 ============ */
  function capsules() {
    var st = Store.s;
    if (!st) return [];
    if (!st.capsules) st.capsules = [];
    return st.capsules;
  }
  function addCapsule(text, openAt) {
    var st = Store.s;
    st.capsules = st.capsules || [];
    var c = { id: U.uid('cap'), text: String(text || '').slice(0, 500), openAt: openAt, createdAt: Date.now(), seenAt: 0 };
    st.capsules.push(c);
    Store.commit();
    return c;
  }
  function dueCapsules() {
    var t = U.today();
    return capsules().filter(c => !c.seenAt && c.openAt <= t);
  }
  function openCapsule(id) {
    Store.commit(function (s) {
      var c = (s.capsules || []).find(x => x.id === id);
      if (c) c.seenAt = Date.now();
    });
  }

  /* ============ 3. 分享卡片 ============ */
  var CARD_W = 750, CARD_H = 1060;
  /* 真正的绘制：只依赖 2d context，Web / 小程序共用同一份代码 */
  function paintCard(g, opt, W, H) {
    opt = opt || {};
    W = W || CARD_W; H = H || CARD_H;

    /* 背景 */
    var bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#101425'); bg.addColorStop(1, '#1b2140');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    /* 光斑 */
    var glow = g.createRadialGradient(W * 0.8, 120, 20, W * 0.8, 120, 460);
    glow.addColorStop(0, 'rgba(99,126,255,.35)'); glow.addColorStop(1, 'rgba(99,126,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);

    var accent = '#7c93ff';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.font = '600 24px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('日拱一卒 · 习惯打卡', 56, 78);

    g.fillStyle = '#fff';
    g.font = '700 30px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText(U.prettyDate(U.today()), 56, 128);

    /* 大数字：全站连续 */
    var gs = Engine.globalStreak();
    var rate = Engine.todayRate(U.today());
    g.font = '800 150px -apple-system,"PingFang SC",sans-serif';
    g.fillStyle = accent;
    g.fillText(String(gs), 56, 300);
    var wNum = g.measureText(String(gs)).width;
    g.font = '600 30px -apple-system,"PingFang SC",sans-serif';
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillText('天连续', 56 + wNum + 14, 300);

    /* 今日完成率圆环 */
    var cx = W - 150, cy = 260, R = 78;
    g.lineWidth = 18; g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,.14)';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = accent;
    g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (rate.pct / 100)); g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#fff'; g.font = '800 44px -apple-system,sans-serif';
    g.fillText(rate.pct + '%', cx, cy + 16);
    g.font = '500 20px -apple-system,"PingFang SC",sans-serif';
    g.fillStyle = 'rgba(255,255,255,.6)';
    g.fillText(rate.done + '/' + rate.total + ' 今日', cx, cy + 48);
    g.textAlign = 'left';

    /* 热力图：最近 12 周 */
    var weeks = 12, cell = 22, gap = 6, x0 = 56, y0 = 380;
    var days = Insights.lastDays(weeks * 7).slice().reverse();   // 从早到晚
    /* 让第一列对齐到一周第一天 */
    var firstWd = U.weekdayIdx(days[0]);
    var grid = [];
    for (var i = 0; i < firstWd; i++) grid.push(null);
    grid = grid.concat(days);
    var items = Engine.items();
    grid.forEach(function (d, idx) {
      if (!d) return;
      var col = Math.floor(idx / 7), row = idx % 7;
      var x = x0 + col * (cell + gap), y = y0 + row * (cell + gap);
      var ok = 0, due = 0;
      items.forEach(function (it) {
        if (!Engine.isDue(it, d)) return;
        due++; if (Insights.doneOn(it, d)) ok++;
      });
      var r = due ? ok / due : 0;
      var col2 = r <= 0 ? 'rgba(255,255,255,.09)' : r < 0.34 ? '#2e3a63' : r < 0.67 ? '#4a5da8' : r < 1 ? '#7c93ff' : '#a5b6ff';
      g.fillStyle = col2;
      var rr = 6;
      g.beginPath();
      g.moveTo(x + rr, y); g.arcTo(x + cell, y, x + cell, y + cell, rr);
      g.arcTo(x + cell, y + cell, x, y + cell, rr); g.arcTo(x, y + cell, x, y, rr);
      g.arcTo(x, y, x + cell, y, rr); g.closePath(); g.fill();
    });

    g.fillStyle = 'rgba(255,255,255,.45)';
    g.font = '500 20px -apple-system,"PingFang SC",sans-serif';
    g.fillText('最近 12 周', 56, y0 + 7 * (cell + gap) + 34);

    /* 最强的那个习惯 */
    var best = null;
    items.forEach(function (it) {
      var s = Engine.streakOf(it.id, U.today());
      if (!best || s > best.s) best = { it: it, s: s };
    });
    if (best && best.s > 1) {
      g.fillStyle = '#fff'; g.font = '700 34px -apple-system,"PingFang SC",sans-serif';
      g.fillText('🔥 ' + best.it.name + ' 已连续 ' + best.s + ' 天', 56, y0 + 7 * (cell + gap) + 100);
    }

    /* 一句话 */
    var quote = opt.quote || ((typeof Insights !== 'undefined' && Insights) ? Insights.headline() : '今天也要加油 🌱');
    g.fillStyle = 'rgba(255,255,255,.86)';
    g.font = '500 26px -apple-system,"PingFang SC",sans-serif';
    var words = quote, line = '', y = H - 130;
    var maxW = W - 112;
    for (var ci = 0; ci < words.length; ci++) {
      var test = line + words[ci];
      if (g.measureText(test).width > maxW && line) { g.fillText(line, 56, y); y += 40; line = words[ci]; }
      else line = test;
    }
    if (line) g.fillText(line, 56, y);

    g.fillStyle = 'rgba(255,255,255,.35)';
    g.font = '500 20px -apple-system,sans-serif';
    g.fillText('日拱一卒 · ' + (location.host || ''), 56, H - 46);
  }

  /* Web 版：自己建 canvas 再画 */
  function drawCard(opt) {
    var W = CARD_W, H = CARD_H, dpr = 2;
    var cv = document.createElement('canvas');
    cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    paintCard(g, opt, W, H);
    return cv;
  }

  function shareCard(opt) {
    var cv = drawCard(opt);
    return new Promise(function (res) {
      if (cv.toBlob) cv.toBlob(function (b) { res({ canvas: cv, blob: b, url: cv.toDataURL('image/png') }); }, 'image/png');
      else res({ canvas: cv, blob: null, url: cv.toDataURL('image/png') });
    });
  }

  /* ============ 4. CSV 导入 ============ */
  /* 两种格式都认：
   * - 宽表（Loop Habit Tracker 导出）：第一列日期，其余列是习惯名，单元格 1/✓/x 表示完成
   * - 长表（本产品自己导出的）：date,habit,type,value,unit,status,note,schema
   * 按表头自动分流，所以「导出 → 导回」数据一致，也能直接吃 Loop 的文件。 */
  function parseCSV(text) {
    /* 先按行切，但必须认得引号里的换行 —— 备注写「多行」是常见操作，
     * 用 \r?\n 一刀切会把一条记录劈成两段，导入进来就少了半句。 */
    var lines = csvRows(text);
    if (lines.length < 2) return { habits: [], rows: 0, kind: 'wide' };
    var split = function (line) {
      var out = [], cur = '', q = false;
      for (var i = 0; i < line.length; i++) {
        var c = line[i];
        if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if ((c === ',' || c === '\t') && !q) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map(s => s.trim());
    };
    var head = split(lines[0]);
    if (isLongHeader(head)) return parseLongCSV(head, lines, split);
    var names = head.slice(1).filter(Boolean);
    var habits = names.map(n => ({ name: n, dates: [] }));
    var rows = 0;
    for (var i = 1; i < lines.length; i++) {
      var cells = split(lines[i]);
      var d = normDate(cells[0]);
      if (!d) continue;
      rows++;
      for (var j = 0; j < habits.length; j++) {
        var v = String(cells[j + 1] || '').trim();
        if (isDoneMark(v)) habits[j].dates.push(d);
      }
    }
    return { habits: habits.filter(h => h.dates.length), rows: rows, kind: 'wide' };
  }
  /* 按「不在引号内」的换行切行：CRLF / LF / 引号内的裸换行都正确处理。
   * 引号本身要留着 —— 交给下面的 split() 判断范围，这里不能提前剥掉。 */
  function csvRows(text) {
    var s = String(text || '').replace(/^\uFEFF/, '');
    var rows = [], cur = '', q = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '"') {
        cur += c;
        if (q && s[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (!q && c === '\r') {
        if (s[i + 1] === '\n') i++;
        rows.push(cur); cur = '';
      } else if (!q && c === '\n') {
        rows.push(cur); cur = '';
      } else cur += c;
    }
    if (cur !== '') rows.push(cur);
    return rows.filter(function (r) { return r.trim(); });
  }

  /* 长表解析：按列名取值，不依赖列顺序（用户在 Excel 里插一列也不会崩） */
  function parseLongCSV(head, lines, split) {
    var low = head.map(function (x) { return String(x || '').toLowerCase().trim(); });
    var pick = function () {
      for (var i = 0; i < arguments.length; i++) {
        var k = low.indexOf(arguments[i]);
        if (k > -1) return k;
      }
      return -1;
    };
    var cDate = pick('date', '日期'), cHabit = pick('habit', '习惯', 'name', '名称');
    var cType = pick('type', '类型'), cVal = pick('value', '值', '数值');
    var cUnit = pick('unit', '单位'), cStatus = pick('status', '状态'), cNote = pick('note', '备注');
    var map = {}, order = [], rows = 0;
    for (var i = 1; i < lines.length; i++) {
      var cells = split(lines[i]);
      var d = normDate(cells[cDate]);
      var name = String(cells[cHabit] || '').trim();
      if (!d || !name) continue;
      rows++;
      if (!map[name]) {
        map[name] = { name: name, type: '', unit: '', dates: [], recs: [] };
        order.push(name);
      }
      var h = map[name];
      var ty = cType > -1 ? String(cells[cType] || '').trim() : '';
      if (ty && !h.type) h.type = ty;
      var un = cUnit > -1 ? String(cells[cUnit] || '').trim() : '';
      if (un && !h.unit) h.unit = un;
      var st = String(cells[cStatus] || '').trim().toLowerCase();
      var vv = cVal > -1 ? String(cells[cVal] || '').trim() : '';
      var nt = cNote > -1 ? String(cells[cNote] || '').trim() : '';
      h.recs.push({ date: d, status: st, v: vv, note: nt });
      if (st === 'done' || (!st && isDoneMark(vv))) h.dates.push(d);
    }
    var out = order.map(function (n) { return map[n]; }).filter(function (h) { return h.recs.length; });
    return { habits: out, rows: rows, kind: 'long' };
  }
  function normDate(s) {
    s = String(s || '').trim();
    var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/.exec(s);
    if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    return '';
  }
  function isDoneMark(v) {
    if (!v) return false;
    if (/^(1|true|yes|y|✓|✔|√|x|X|是|完成|done)$/i.test(v)) return true;
    var n = parseFloat(v);
    return !isNaN(n) && n > 0;
  }

  /* ---------- CSV 导出（v27 · 4.4，对标 Loop 的「Take control of your data」）----------
   * 用长表（一行 = 某天某个习惯的一次记录），不用 Loop 那种宽表：
   * 长表能同时带上数值和备注，Excel 里排序、透视、丢进任何工具都能直接用。
   * 表头带 schema 版本号，导入时按表头自动识别，导出的文件能原样导回来。
   * 开头加 BOM —— 不加的话 Excel 打开中文会乱码，这是最常见的「导出坏了」投诉。 */
  var CSV_SCHEMA = 'rigongyizu-csv/1';
  var CSV_COLS = ['date', 'habit', 'type', 'value', 'unit', 'status', 'note', 'schema'];
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    var st = Store.s;
    var byId = {};
    (st.items || []).forEach(function (it) { if (!it.deleted) byId[it.id] = it; });
    var out = [CSV_COLS.join(',')];
    Object.keys(st.logs || {}).sort().forEach(function (d) {
      var day = st.logs[d] || {};
      Object.keys(day).forEach(function (id) {
        var it = byId[id];
        if (!it) return;
        var lg = day[id] || {};
        var status = lg.d ? 'done' : lg.slip ? 'slip' : lg.s ? 'skip' : '';
        /* 空记录（既没状态、也没数值和备注）不导出，否则全是噪音行 */
        if (!status && !lg.v && !lg.note) return;
        out.push([d, it.name, it.type || 'check', lg.v == null ? '' : lg.v,
          it.unit || '', status, lg.note || '', CSV_SCHEMA].map(csvCell).join(','));
      });
    });
    return '\uFEFF' + out.join('\r\n');
  }
  /* 认出自己导出的长表：表头里同时有 date/日期 和 habit/习惯 */
  function isLongHeader(head) {
    var low = head.map(function (x) { return String(x || '').toLowerCase().trim(); });
    var hasDate = low.indexOf('date') > -1 || low.indexOf('日期') > -1;
    var hasHabit = low.indexOf('habit') > -1 || low.indexOf('习惯') > -1;
    return hasDate && hasHabit;
  }

  /* ---------- Markdown 迁出（v35 · 外部评审 P1-4）----------
   * CSV 是给机器读的，Markdown 是给人读的：换 App、给教练看、打出来贴墙上。
   * 和日记的 Markdown 导出分工：那份导「写下的文字」，这份导「做到的事」。
   * 上限 180 天 —— 迁出的意义在「最近这一段时间我做了什么」，把三年记录
   * 全塞进一个文件只会让人打不开。要全量就用 JSON 备份。 */
  var MD_DAYS = 180;
  function exportMarkdown() {
    var st = Store.s;
    var items = (st.items || []).filter(function (i) { return !i.deleted; });
    var days = Object.keys(st.logs || {}).sort();
    var recent = days.slice(-MD_DAYS);
    var L = [];
    L.push('# 日拱一卒 · 数据迁出');
    L.push('');
    L.push('导出时间：' + U.today() + ' · ' + items.length + ' 个习惯 · ' + days.length + ' 天有记录' +
      (days.length > recent.length ? '（下方明细为最近 ' + MD_DAYS + ' 天，更早的记录请看 JSON 备份）' : ''));
    L.push('');
    L.push('## 习惯');
    L.push('');
    L.push('| 习惯 | 类型 | 目标 | 完成次数 | 连续 |');
    L.push('| --- | --- | --- | --- | --- |');
    items.forEach(function (it) {
      var cnt = 0;
      Object.keys(st.logs || {}).forEach(function (d) {
        var lg = (st.logs[d] || {})[it.id];
        if (lg && (lg.d || lg.v)) cnt++;
      });
      var goal = it.target ? (it.target + (it.unit || '')) : '—';
      var sk = window.Engine && Engine.streakOf ? Engine.streakOf(it.id, U.today()) : 0;
      L.push('| ' + mdCell(it.name) + ' | ' + typeName(it.type) + ' | ' + goal + ' | ' + cnt + ' | ' + sk + ' |');
    });
    L.push('');
    L.push('## 每日记录');
    var byId = {};
    items.forEach(function (it) { byId[it.id] = it; });
    recent.forEach(function (d) {
      var day = st.logs[d] || {};
      var rows = [];
      Object.keys(day).forEach(function (id) {
        var it = byId[id];
        if (!it) return;
        var lg = day[id] || {};
        var mark = lg.d ? '✓' : lg.slip ? '✗ 破戒' : lg.s ? '— 请假' : (lg.v != null ? '' : '');
        var val = lg.v != null ? (it.unit ? lg.v + ' ' + it.unit : String(lg.v)) : '';
        var line = (mark ? mark + ' ' : '') + it.name + (val ? '（' + val + '）' : '');
        if (lg.note) line += ' —— 「' + lg.note + '」';
        rows.push('- ' + line);
      });
      if (!rows.length) return;
      L.push('');
      L.push('### ' + d + (d === U.today() ? '（今天）' : ''));
      rows.forEach(function (r) { L.push(r); });
    });
    L.push('');
    return L.join('\n');
  }
  function mdCell(s) {
    return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  }
  function typeName(t) {
    return { check: '打卡', number: '数值', duration: '时长', avoid: '戒断' }[t] || '打卡';
  }

  /* 把解析结果写进数据：同名习惯复用，按记录类型分别落成 done / slip / skip + 数值 + 备注 */
  function importCSV(text) {
    var r = parseCSV(text);
    if (!r.habits.length) return { ok: false, msg: '没认出可导入的数据（需要第一列是日期，其余列是习惯名）', habits: 0, logs: 0 };
    var st = Store.s;
    var created = 0, logs = 0, kept = 0;
    var pal = Store.palette();
    var VALID_TYPE = { check: 1, avoid: 1, number: 1, duration: 1 };
    Store.commit(function (s) {
      r.habits.forEach(function (h, i) {
        var it = (s.items || []).find(x => !x.deleted && x.name === h.name);
        if (!it) {
          var ty = VALID_TYPE[h.type] ? h.type : 'check';
          it = {
            id: U.uid('item'), roomId: s.activeRoomId, sort: (s.items || []).length + i,
            name: h.name, type: ty, target: null, unit: h.unit || '', slot: 'any', reminderAt: null,
            tags: ['导入'], color: pal[i % pal.length], steps: [], schedule: { type: 'daily' },
            dependsOn: null, goal: null, pausedUntil: null, archived: false, deleted: false,
            createdAt: Date.now(), updatedAt: Date.now()
          };
          (s.items = s.items || []).push(it);
          created++;
        }
        if (h.recs) {
          /* 长表：逐条按 status 落库，已有的真实记录不覆盖（导入只补空缺） */
          h.recs.forEach(function (rc) {
            s.logs[rc.date] = s.logs[rc.date] || {};
            var cur = s.logs[rc.date][it.id];
            if (cur && cur.by !== 'import') { kept++; return; }
            var lg = { by: 'import' };
            var vnum = rc.v === '' ? NaN : parseFloat(rc.v);
            if (rc.status === 'done' || (!rc.status && isDoneMark(rc.v))) {
              lg.d = true;
              lg.v = isNaN(vnum) ? 1 : vnum;
            } else if (rc.status === 'slip') {
              lg.slip = true;
            } else if (rc.status === 'skip') {
              lg.s = true;
            } else if (!isNaN(vnum)) {
              lg.v = vnum;
            }
            if (rc.note) lg.note = rc.note;
            if (!lg.d && !lg.slip && !lg.s && !lg.note && isNaN(vnum)) return;
            s.logs[rc.date][it.id] = lg;
            logs++;
          });
        } else {
          h.dates.forEach(function (d) {
            s.logs[d] = s.logs[d] || {};
            if (!s.logs[d][it.id]) { s.logs[d][it.id] = { d: true, v: 1, by: 'import' }; logs++; }
          });
        }
        /* 创建时间取最早一条记录，这样连续天数能算出来 */
        var all = h.recs ? h.recs.map(function (x) { return x.date; }) : h.dates;
        var first = all.slice().sort()[0];
        if (first) {
          var ts = new Date(first + 'T00:00:00').getTime();
          if (ts && (!it.createdAt || ts < it.createdAt)) it.createdAt = ts;
        }
      });
    });
    if (typeof Engine !== 'undefined' && Engine.bustCache) Engine.bustCache();
    return { ok: true, habits: created, logs: logs, kept: kept, total: r.habits.length, kind: r.kind };
  }

  return {
    routines: routines, addRoutine: addRoutine, delRoutine: delRoutine, saveRoutine: saveRoutine,
    routineState: routineState, nextAfter: nextAfter,
    capsules: capsules, addCapsule: addCapsule, dueCapsules: dueCapsules, openCapsule: openCapsule,
    shareCard: shareCard, drawCard: drawCard, paintCard: paintCard, CARD_W: CARD_W, CARD_H: CARD_H,
    parseCSV: parseCSV, importCSV: importCSV, exportMarkdown: exportMarkdown,
    exportCSV: exportCSV, isLongHeader: isLongHeader, CSV_SCHEMA: CSV_SCHEMA, CSV_COLS: CSV_COLS
  };
})();
