/* ============ 健康数据导入（v33）：把手机/手环记的东西补进习惯 ============
 *
 * 为什么单独一个模块：现有「粘贴 JSON/CSV」那条路有两个硬伤 ——
 *   1. 不认 iPhone「健康 → 导出所有健康数据」得到的 export.xml（最常见的一条路）；
 *   2. 同一天多条记录会逐条覆盖。Apple 的步数是分片的（一天几百条），
 *      逐条写只会剩下最后一条 —— 数据看着进来了，其实是错的。
 * 所以这里统一做三件事：认得三种来源、**先按天聚合再落库**、用阈值决定「算不算完成」。
 *
 * 三种来源：
 *   - Apple 健康 export.xml（分块流式扫，300MB 也不炸内存）
 *   - Health Auto Export 的 JSON（iPhone 上最省事的那个 App）
 *   - Google Fit Takeout / 小米·华为运动健康导出的 CSV / TSV
 *
 * 落库原则：
 *   - 只写「历史」，默认不覆盖已有记录（用户手打的比机器记的可信）
 *   - 不发积分：补历史不是今天做到了，不该刷等级（走 Engine.setLog 直写，不触发结算）
 */
window.Health = (function () {
  'use strict';

  /* 指标表：key 是我们内部的名字，apple 是 Apple 健康里的 type，
   * agg=sum 按天求和（步数、睡眠、锻炼），agg=avg 按天平均（心率、体重）。
   * thr 是「默认算完成的门槛」，用户可在导入面板里改。 */
  const TYPES = [
    { key: 'steps', label: '步数', unit: '步', thr: 8000, agg: 'sum', apple: ['HKQuantityTypeIdentifierStepCount'] },
    { key: 'sleep', label: '睡眠', unit: '小时', thr: 7, agg: 'sum', apple: ['HKCategoryTypeIdentifierSleepAnalysis'], hours: true },
    { key: 'exercise', label: '锻炼', unit: '分钟', thr: 30, agg: 'sum', apple: ['HKWorkout'], minutes: true },
    { key: 'distance', label: '步行距离', unit: '公里', thr: 5, agg: 'sum', apple: ['HKQuantityTypeIdentifierDistanceWalkingRunning'] },
    { key: 'energy', label: '活动能量', unit: '千卡', thr: 400, agg: 'sum', apple: ['HKQuantityTypeIdentifierActiveEnergyBurned'] },
    { key: 'mindful', label: '正念', unit: '分钟', thr: 10, agg: 'sum', apple: ['HKCategoryTypeIdentifierMindfulSession'], minutes: true },
    { key: 'water', label: '饮水', unit: '毫升', thr: 2000, agg: 'sum', apple: ['HKQuantityTypeIdentifierDietaryWater'] },
    { key: 'heart', label: '静息心率', unit: '次/分', thr: 0, agg: 'avg', apple: ['HKQuantityTypeIdentifierRestingHeartRate'] },
    { key: 'weight', label: '体重', unit: '公斤', thr: 0, agg: 'avg', apple: ['HKQuantityTypeIdentifierBodyMass'] }
  ];

  /* 名字 → 指标：CSV 的列名五花八门（英文、中文、带单位），这里只做关键词匹配 */
  const ALIAS = [
    [/step|步数|步/i, 'steps'],
    [/sleep|睡眠|卧床/i, 'sleep'],
    [/workout|exercise|锻炼|运动时长|训练|活动时长/i, 'exercise'],
    [/distance|距离/i, 'distance'],
    [/energy|calorie|卡路里|能量|千卡|大卡/i, 'energy'],
    [/heart|心率/i, 'heart'],
    [/weight|体重|公斤|kg/i, 'weight'],
    [/water|饮水|喝水|水量/i, 'water'],
    [/mindful|正念|冥想/i, 'mindful']
  ];

  const MAX_DAYS = 400;   // 只导最近一年多，再早的既没人看也拖内存

  function defOf(key) {
    const d = TYPES.filter(t => t.key === key)[0];
    if (d) return d;
    return { key: key, label: String(key || '数据').replace(/^custom:/, ''), unit: '', thr: 1, agg: 'sum' };
  }
  function keyOf(name) {
    const s = String(name || '');
    for (let i = 0; i < ALIAS.length; i++) if (ALIAS[i][0].test(s)) return ALIAS[i][1];
    return 'custom:' + s.slice(0, 24);
  }
  function ymd(s) {
    const m = String(s || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!m) return '';
    return m[1] + '-' + (m[2].length < 2 ? '0' + m[2] : m[2]) + '-' + (m[3].length < 2 ? '0' + m[3] : m[3]);
  }
  function cutoff(days) {
    const t = new Date();
    t.setDate(t.getDate() - (days || MAX_DAYS));
    return t.toISOString().slice(0, 10);
  }
  function num(s) {
    const v = parseFloat(String(s == null ? '' : s).replace(/[^\d.\-+eE]/g, ''));
    return Number.isFinite(v) ? v : null;
  }

  /* ---------- 聚合容器 ---------- */
  /* { 指标: { sum: {日期: 合计}, n: {日期: 条数} } } —— n 只给 avg 型用 */
  function bump(acc, key, day, val, opt) {
    if (!day || !Number.isFinite(val)) return;
    if (val < 0) return;
    const since = (opt && opt.since) || '';
    if (since && day < since) return;
    const t = acc[key] || (acc[key] = { sum: {}, n: {} });
    t.sum[day] = (t.sum[day] || 0) + val;
    t.n[day] = (t.n[day] || 0) + 1;
  }

  /* ---------- Apple 健康 export.xml ----------
   * 用正则扫标签而不是 DOMParser：export.xml 动辄两三百 MB，
   * DOMParser 会建一整棵树，手机上直接白屏。这里只认两种标签，边扫边丢。 */
  const RE_TAG = /<(Record|Workout)\b([^>]*)>/g;
  const APPLE_MAP = (function () {
    const m = {};
    TYPES.forEach(t => t.apple.forEach(a => { m[a] = t.key; }));
    return m;
  })();

  function attr(s, name) {
    const m = String(s || '').match(new RegExp('\\b' + name + '="([^"]*)"'));
    return m ? m[1] : '';
  }

  /* 睡眠：Apple 给的是「区间 + 一个状态」，只把真正睡着的段落加起来。
   * 时间串是 "2026-10-20 23:00:00 +0800"，Date.parse 对这个格式各引擎支持不一，
   * 先规整成 ISO 的 +08:00 再算，免得 iOS/桌面算出来的时长不一样。 */
  function ts(s) {
    const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-]\d{2}):?(\d{2})?/);
    if (!m) return NaN;
    return Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] +
      (m[7] ? m[7] + ':' + (m[8] || '00') : 'Z'));
  }
  function sleepSeconds(tag) {
    const v = attr(tag, 'value');
    if (!/Asleep/i.test(v)) return 0;
    const a = ts(attr(tag, 'startDate'));
    const b = ts(attr(tag, 'endDate'));
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
    return (b - a) / 1000;
  }

  function feedApple(chunk, acc, opt) {
    RE_TAG.lastIndex = 0;
    let m, hits = 0;
    while ((m = RE_TAG.exec(chunk))) {
      const tag = m[0], body = m[2] || '';
      const type = attr(body, 'type');
      const day = ymd(attr(body, 'startDate'));
      if (!day) continue;

      if (m[1] === 'Workout') {
        const key = APPLE_MAP.HKWorkout;
        const unit = attr(body, 'durationUnit') || 'min';
        let v = num(attr(body, 'duration'));
        if (v == null) continue;
        if (/sec/i.test(unit)) v = v / 60;
        else if (/^h/i.test(unit)) v = v * 60;
        bump(acc, key, day, v, opt);
        hits++;
        continue;
      }

      const key = APPLE_MAP[type];
      if (!key) continue;
      if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
        const sec = sleepSeconds(tag);
        if (sec > 0) { bump(acc, key, day, sec / 3600, opt); hits++; }
        continue;
      }
      let v = num(attr(body, 'value'));
      if (v == null) continue;
      /* 单位换算：Apple 的 distance 可能是 m 也可能是 km，看 unit 属性 */
      const unit = attr(body, 'unit') || '';
      if (key === 'distance' && /^m$/i.test(unit)) v = v / 1000;
      if (key === 'energy' && /kj/i.test(unit)) v = v / 4.184;
      if (key === 'water' && /^l$/i.test(unit)) v = v * 1000;
      bump(acc, key, day, v, opt);
      hits++;
    }
    return hits;
  }

  /* ---------- Health Auto Export 的 JSON ---------- */
  function feedJSON(text, acc, opt) {
    let j;
    try { j = JSON.parse(text); } catch (e) { return 0; }
    const metrics = (j && j.data && j.data.metrics) || (j && j.metrics) || (Array.isArray(j) ? j : []);
    let hits = 0;
    (metrics || []).forEach(m => {
      const name = m && (m.name || m.type || m.identifier) || '';
      const key = keyOf(name);
      (m && m.data || []).forEach(row => {
        const day = ymd(row.date || row.startDate || row.day || row.start || '');
        let v = num(row.qty != null ? row.qty : (row.value != null ? row.value : row.sum));
        if (v == null) return;
        const unit = String(row.units || row.unit || '').toLowerCase();
        if (key === 'distance' && /^m$/.test(unit)) v = v / 1000;
        if (key === 'sleep' && /^(sec|s)$/.test(unit)) v = v / 3600;
        if (key === 'sleep' && /^min/.test(unit)) v = v / 60;
        bump(acc, key, day, v, opt);
        hits++;
      });
    });
    return hits;
  }

  /* ---------- CSV / TSV ---------- */
  function splitLine(line, sep) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim().replace(/^"|"$/g, ''));
  }

  function feedTable(text, acc, opt) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return 0;
    const sep = (lines[0].split('\t').length > lines[0].split(',').length) ? '\t' : ',';
    const head = splitLine(lines[0], sep).map(h => h.toLowerCase());

    const iDate = head.findIndex(h => /date|日期|时间|day|start|开始/.test(h));
    const iName = head.findIndex(h => /^(name|metric|type|指标|类型|项目|运动类型)$/.test(h));
    const iVal = head.findIndex(h => /count|steps|value|qty|amount|数值|数量|值|时长|分钟|小时|次数|步数/.test(h));

    /* 单指标表：数值列找不到时，取最后一个看起来像数字的列 */
    let vi = iVal;
    if (vi < 0) {
      const probe = splitLine(lines[1] || '', sep);
      for (let i = probe.length - 1; i > 0; i--) if (num(probe[i]) != null) { vi = i; break; }
    }
    if (vi < 0) return 0;

    /* 指标名：多指标表按行取；单指标表按列名猜，猜不到就整表当一个「自定义」 */
    const singleKey = iName >= 0 ? '' : keyOf(head[vi] || head[head.length - 1] || '导入数据');
    const di = iDate >= 0 ? iDate : 0;
    let hits = 0;
    for (let i = 1; i < lines.length; i++) {
      const c = splitLine(lines[i], sep);
      if (!c.length) continue;
      const day = ymd(c[di]);
      const v = num(c[vi]);
      if (!day || v == null) continue;
      const key = iName >= 0 ? keyOf(c[iName]) : singleKey;
      bump(acc, key, day, v, opt);
      hits++;
    }
    return hits;
  }

  /* ---------- 入口 ---------- */
  function parseText(text, opt) {
    const s = String(text || '');
    const o = Object.assign({ since: cutoff() }, opt || {});
    const acc = {};
    let hits = 0;
    if (/<HealthData|<Record\b|HKQuantityType|HKCategoryType/.test(s.slice(0, 4000))) hits = feedApple(s, acc, o);
    if (!hits && /^\s*[{[]/.test(s)) hits = feedJSON(s, acc, o);
    if (!hits) hits = feedTable(s, acc, o);
    return { acc: acc, hits: hits };
  }

  /* 读一块内容：优先 Blob.text()，没有就退回 FileReader。
   * Safari 14 之前的 WebView 没有 Blob.text()，不兜底的话导入会直接报错。 */
  function readBlob(blob) {
    if (blob && typeof blob.text === 'function') return blob.text();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('读取失败'));
      fr.readAsText(blob);
    });
  }

  /* 分块读文件：export.xml 可能几百 MB，一次性 readAsText 会直接把页面搞崩。
   * 每块按最后一个 '>' 切开，保证标签不被劈成两半。 */
  async function scanFile(file, opt) {
    const o = Object.assign({ since: cutoff() }, opt || {});
    const acc = {};
    const CHUNK = 4 * 1024 * 1024;
    const isXML = /\.xml$/i.test(file.name || '') || /xml/i.test(file.type || '');
    if (!isXML) {
      const txt = await readBlob(file);
      const r = parseText(txt, o);
      return { acc: r.acc, hits: r.hits };
    }
    let rest = '', hits = 0;
    for (let i = 0; i < file.size; i += CHUNK) {
      const part = await readBlob(file.slice(i, Math.min(i + CHUNK, file.size)));
      const buf = rest + part;
      const cut = buf.lastIndexOf('>');
      if (cut < 0) { rest = buf; continue; }
      hits += feedApple(buf.slice(0, cut + 1), acc, o);
      rest = buf.slice(cut + 1);
      if (o.onProgress) o.onProgress(Math.min(1, (i + CHUNK) / file.size));
    }
    if (rest) hits += feedApple(rest, acc, o);
    return { acc: acc, hits: hits };
  }

  /* ---------- 汇总成「指标卡」 ---------- */
  function metrics(acc) {
    const out = [];
    Object.keys(acc || {}).forEach(key => {
      const t = acc[key], def = defOf(key);
      const days = Object.keys(t.sum).sort().map(d => ({
        d: d,
        v: Math.round((def.agg === 'avg' ? t.sum[d] / (t.n[d] || 1) : t.sum[d]) * 100) / 100
      }));
      if (!days.length) return;
      const total = days.reduce((a, x) => a + x.v, 0);
      out.push({
        key: key, label: def.label, unit: def.unit, thr: def.thr, agg: def.agg,
        days: days, count: days.length, from: days[0].d, to: days[days.length - 1].d,
        avg: Math.round((total / days.length) * 10) / 10,
        total: Math.round(total * 10) / 10
      });
    });
    /* 天数多的排前面：用户最想导的通常就是步数/睡眠 */
    out.sort((a, b) => b.count - a.count);
    return out;
  }

  /* ---------- 落库 ----------
   * mode='empty'（默认）只补空缺的日子，用户手打过的绝不覆盖；
   * mode='all' 才整段覆盖。
   * thr>0 时「数值 ≥ thr」才算完成；thr=0 表示有记录就算完成（心率、体重这种没门槛的）。
   * 走 Engine.setLog 直写，不发积分 —— 补历史不是今天做到了。 */
  function apply(m, targetId, opt) {
    const o = opt || {};
    const it = (Store.s.items || []).filter(x => x.id === targetId && !x.deleted)[0];
    if (!it) return { ok: false, msg: '目标习惯不在了' };
    const thr = Number(o.thr) > 0 ? Number(o.thr) : 0;
    const mode = o.mode === 'all' ? 'all' : 'empty';
    let days = 0, skipped = 0, done = 0;
    Store.commit(s => {
      (m.days || []).forEach(row => {
        const cur = s.logs[row.d] && s.logs[row.d][it.id];
        const has = cur && (cur.d || cur.v != null || cur.slip);
        if (mode === 'empty' && has) { skipped++; return; }
        const v = Math.round(row.v * 100) / 100;
        const ok = thr > 0 ? v >= thr : true;
        Engine.setLog(row.d, it.id, { v: v, d: ok, mini: 0, by: '导入' });
        days++;
        if (ok) done++;
      });
    });
    return { ok: true, days: days, skipped: skipped, done: done, name: it.name };
  }

  /* 导入时顺手建一个对应的习惯：数值型（步数/睡眠）用 duration，方便卡片上直接看进度。
   * 同名习惯已经存在就复用 —— 否则第二次导入会再建一个「步数」，
   * 旧记录挂在前一个上，「只补空缺」就永远不生效了。 */
  function makeHabit(m) {
    const exist = (Store.s.items || []).filter(x => !x.deleted && x.name === m.label)[0];
    if (exist) return exist.id;
    const pal = Store.palette();
    const id = U.uid('item');
    Store.commit(s => {
      s.items = s.items || [];
      s.items.push({
        id: id, roomId: s.activeRoomId, sort: s.items.length,
        name: m.label, type: 'duration', target: m.thr || null, unit: m.unit || '',
        slot: 'any', reminderAt: null, tags: ['导入'], color: pal[s.items.length % pal.length],
        steps: [], schedule: { type: 'daily' }, dependsOn: null, goal: null,
        pausedUntil: null, archived: false, deleted: false,
        createdAt: Date.now(), updatedAt: Date.now()
      });
    });
    return id;
  }

  /* ================= 自动勾选（v47 · 对标 Habitify 的「Apple Health 步数达标 → 自动完成」）=================
   *
   * 和上面「导入」的区别，一句话说清：
   *   导入 = 一次性把历史补进去；
   *   自动勾选 = 每次打开都拿最新数值判一次「今天算不算做到了」，用户不用再点。
   *
   * 一个必须承认的现实：网页拿不到 HealthKit / Health Connect —— 那是原生 App 才有的权限。
   * 所以数据来源仍然是「用户导入的那份文件」，我们能做的是：
   * 记住每次导入的按天数值（下面 remember），之后每条规则自己去比对，
   * 达标就把当天的习惯勾上。配上 iPhone 的「健康自动导出」，效果已经和 Habitify 很接近。
   *
   * 三条硬规矩：
   *   1. 不覆盖用户手动改过的记录（手打的比机器算的可信）；
   *   2. 用户当天手动取消过，就不再自动勾回来（autoVeto）；
   *   3. 只勾「本来就该做」的日子（isDue），也不碰戒断型 —— 步数达标不代表今天忍住了。
   */
  const AUTO_KEEP = 120;      // 每指标只留最近 120 天，够覆盖一年的补导，也不撑存储

  /* 把这次解析出来的指标数值按天存起来，供自动勾选反复比对。
   * 只存「日期 → 数值」这一层，不存原始记录（原始记录可能几百 MB）。 */
  function remember(ms) {
    const list = ms || [];
    if (!list.length) return 0;
    let n = 0;
    Store.commit(s => {
      const h = s.health = s.health || { at: 0, days: {} };
      h.days = h.days || {};
      h.at = Date.now();
      list.forEach(m => {
        if (!m || !m.key) return;
        const t = h.days[m.key] = h.days[m.key] || {};
        (m.days || []).forEach(row => {
          if (!row || !row.d || !Number.isFinite(row.v)) return;
          t[row.d] = Math.round(row.v * 100) / 100;
          n++;
        });
        /* 裁剪：按日期排序后丢掉最老的那一段 */
        const keys = Object.keys(t).sort();
        if (keys.length > AUTO_KEEP) keys.slice(0, keys.length - AUTO_KEEP).forEach(k => { delete t[k]; });
      });
    });
    return n;
  }

  /* 某个指标某天的数值；没有就是 null（区别于 0） */
  function dayValue(key, day) {
    const h = Store.s.health;
    const t = h && h.days && h.days[key];
    if (!t) return null;
    const v = t[day];
    return Number.isFinite(v) ? v : null;
  }

  /* 这个指标最近一次有数据的日期（面板上告诉用户「数据新不新」） */
  function latestOf(key) {
    const h = Store.s.health;
    const t = h && h.days && h.days[key];
    if (!t) return null;
    const keys = Object.keys(t).sort();
    if (!keys.length) return null;
    const d = keys[keys.length - 1];
    return { d: d, v: t[d] };
  }

  function lastImportAt() { return (Store.s.health && Store.s.health.at) || 0; }

  /* 设了自动勾选规则的习惯 */
  function autoList() {
    return (Store.s.items || []).filter(x =>
      !x.deleted && !x.archived && x.autoHealth && x.autoHealth.key && x.type !== 'avoid');
  }

  /* 跑一遍规则。opt.days = 往回看几天（默认 2：今天 + 昨天 ——
   * 手机上的数据常常是第二天才导得出来，只看今天等于白设）。 */
  function autoTick(opt) {
    const o = opt || {};
    const span = Math.max(1, Math.min(31, Number.isFinite(o.days) ? o.days : 2));
    const st = Store.s;
    const out = { ok: true, ticks: [], checked: 0, noData: 0 };
    if (!st.health || !st.health.days) return out;
    const list = autoList();
    if (!list.length) return out;

    const today = U.today();
    const born = {};
    list.forEach(it => { try { born[it.id] = Engine.bornOn(it); } catch (e) { born[it.id] = ''; } });

    /* 先干跑一遍算出「该勾哪些」，一条都不勾就不写库 ——
     * 每次打开都 commit 一次会把 rev 顶上去，白白触发一次重渲染和云同步。 */
    const plan = [];
    for (let i = 0; i < span; i++) {
      const day = U.shiftYmd(today, -i);
      list.forEach(it => {
        const rule = it.autoHealth || {};
        const thr = Number(rule.thr) > 0 ? Number(rule.thr) : 0;
        const v = dayValue(rule.key, day);
        out.checked++;
        if (v == null) { out.noData++; return; }
        if (thr > 0 && v < thr) return;
        if (born[it.id] && day < born[it.id]) return;
        /* 用户亲手取消过 —— 别再勾回来，那是在跟他较劲 */
        if (st.autoVeto && st.autoVeto[day + '|' + it.id]) return;
        try { if (!Engine.isDue(it, day)) return; } catch (e) { }

        const cur = Engine.getLog(day, it.id);
        if (cur && Engine.isDone(it, day)) return;                 // 已经完成了
        /* 手动记录（有数值 / 轻量完成 / 破戒）一律不动 */
        if (cur && !cur.auto && (cur.v != null || cur.mini || cur.slip)) return;
        plan.push({ it: it, day: day, v: v, thr: thr });
      });
    }
    if (!plan.length) return out;

    Store.commit(function () {
      plan.forEach(function (p) {
        const it = p.it, day = p.day, rule = it.autoHealth || {};
        const def = defOf(rule.key);
        /* 数值写「目标值」而不是健康数值：习惯目标是 30 分钟，睡眠数据是 7 小时，
         * 直接把 7 塞进去会显示成「7 / 30 分钟」。真实数值存在 hv 上，详情里看得到。 */
        const fill = (it.type === 'number' || it.type === 'duration') ? (it.target || 1) : 1;
        Engine.setLog(day, it.id, {
          v: fill, d: true, mini: 0, slip: 0, auto: 1,
          hv: p.v, hkey: rule.key, hlabel: def.label, hunit: def.unit,
          by: '健康数据'
        });
        try { Engine.afterCheck(it, day, false); } catch (e) { }
        out.ticks.push({
          id: it.id, name: it.name, day: day, v: p.v,
          label: def.label, unit: def.unit, thr: p.thr
        });
      });
    });
    return out;
  }

  /* 用户手动取消时记一笔，避免下一次打开又被自动勾上 */
  function veto(day, itemId) {
    Store.commit(s => {
      s.autoVeto = s.autoVeto || {};
      s.autoVeto[day + '|' + itemId] = 1;
    });
  }
  function unveto(day, itemId) {
    if (!Store.s.autoVeto || !Store.s.autoVeto[day + '|' + itemId]) return;
    Store.commit(s => { delete s.autoVeto[day + '|' + itemId]; });
  }
  /* 规则文案：「步数 ≥ 8000 步」/「静息心率 有记录就算」 */
  function ruleText(rule) {
    if (!rule || !rule.key) return '';
    const d = defOf(rule.key);
    const thr = Number(rule.thr) > 0 ? Number(rule.thr) : 0;
    return thr > 0 ? (d.label + ' ≥ ' + thr + (d.unit || '')) : (d.label + ' 有记录就算');
  }

  return {
    TYPES: TYPES, MAX_DAYS: MAX_DAYS,
    keyOf: keyOf, defOf: defOf, parseText: parseText, scanFile: scanFile,
    metrics: metrics, apply: apply, makeHabit: makeHabit,
    remember: remember, dayValue: dayValue, latestOf: latestOf, lastImportAt: lastImportAt,
    autoList: autoList, autoTick: autoTick, veto: veto, unveto: unveto, ruleText: ruleText
  };
})();
