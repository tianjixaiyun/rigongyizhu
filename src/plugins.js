/* ============ 插件中心：和其他应用联动 ============
 * 日历订阅 / 消息推送 / 快捷指令 URL / 健康数据导入 / 导出到笔记
 */
window.Plugins = (function () {

  /* ---------- 插件配置（随云端一起同步） ---------- */
  function cfg() {
    var st = Store.s;
    if (!st.settings.plugins) st.settings.plugins = {};
    var p = st.settings.plugins;
    if (!Array.isArray(p.hooks)) p.hooks = [];
    if (!p.ics) p.ics = { weeks: 8, alarms: true };
    if (!p.daily) p.daily = { enabled: false, at: '21:30', last: '' };
    if (!p.health) p.health = { lastMap: {} };
    return p;
  }

  /* ---------- 习惯在某天是否该做 ---------- */
  function dueOn(it, d) {
    var sc = it.schedule || { type: 'daily' };
    var wd = U.weekdayOf(d);
    if (sc.type === 'weekdays') return (sc.days || [1, 2, 3, 4, 5]).indexOf(wd) >= 0;
    if (sc.type === 'timesPerWeek') {
      var order = [1, 2, 3, 4, 5, 6, 0], n = sc.n || 3;
      return order.indexOf(wd) < n;
    }
    if (sc.type === 'interval') {
      var k = sc.n || 2;
      var base = U.ymd(new Date(it.createdAt || Date.now()));
      var diff = U.daysBetween(base, d);
      return diff >= 0 && diff % k === 0;
    }
    return true;
  }

  var SLOT_TIME = { morning: '07:00', noon: '12:30', afternoon: '15:00', evening: '20:30', any: '21:00' };

  /* ================= 1. 系统日历（.ics） ================= */
  function esc(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function icsStamp(d, t) {
    var hhmm = (t || '09:00').split(':');
    return d.replace(/-/g, '') + 'T' + U.pad(+hhmm[0]) + U.pad(+hhmm[1] || 0) + '00';
  }
  function addMin(t, m) {
    var p = (t || '09:00').split(':').map(Number);
    var v = p[0] * 60 + (p[1] || 0) + m;
    return U.pad(Math.floor(v / 60) % 24) + U.pad(v % 60);
  }
  function icsText(weeks) {
    var st = Store.s;
    var days = (weeks || 8) * 7;
    var start = U.today();
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//rigongyizhu//habit//CN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:日拱一卒 · 习惯打卡',
      'X-WR-TIMEZONE:Asia/Shanghai'];
    var n = 0;
    (st.items || []).forEach(function (it) {
      if (it.deleted || it.archived) return;
      var t = it.reminderAt || SLOT_TIME[it.slot || 'any'] || '21:00';
      for (var i = 0; i < days; i++) {
        var d = U.shiftYmd(start, i);
        if (!dueOn(it, d)) continue;
        var desc = (it.type === 'check') ? '完成后点一下打卡' : ('目标 ' + (it.target || '') + (it.unit || ''));
        L.push('BEGIN:VEVENT');
        L.push('UID:' + it.id + '-' + d + '@rigongyizhu');
        L.push('DTSTAMP:' + icsStamp(U.today(), '00:00') + 'Z');
        L.push('DTSTART:' + icsStamp(d, t));
        L.push('DTEND:' + icsStamp(d, addMin(t, 15)));
        L.push('SUMMARY:' + esc('打卡 · ' + it.name));
        L.push('DESCRIPTION:' + esc(desc + ' —— 来自「日拱一卒」'));
        L.push('URL:' + location.origin + '/#today');
        if (cfg().ics.alarms !== false) {
          L.push('BEGIN:VALARM');
          L.push('TRIGGER:-PT0M');
          L.push('ACTION:DISPLAY');
          L.push('DESCRIPTION:' + esc('该打卡了：' + it.name));
          L.push('END:VALARM');
        }
        L.push('END:VEVENT');
        n++;
      }
    });
    L.push('END:VCALENDAR');
    return { text: L.join('\r\n'), count: n };
  }
  function downloadIcs() {
    var r = icsText(cfg().ics.weeks || 8);
    if (!r.count) { U.toast('没有可导出的习惯'); return; }
    U.download('日拱一卒-打卡日历-' + U.today() + '.ics', r.text, 'text/calendar;charset=utf-8');
    U.toast('已导出 ' + r.count + ' 个日历事件，去日历 App 导入它');
  }

  /* ================= 2. 消息推送（Webhook） ================= */
  var HOOKS = [
    { id: 'feishu', name: '飞书群机器人', tpl: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx', shape: t => ({ msg_type: 'text', content: { text: t } }) },
    { id: 'dingtalk', name: '钉钉机器人', tpl: 'https://oapi.dingtalk.com/robot/send?access_token=xxxx', shape: t => ({ msgtype: 'text', text: { content: t } }) },
    { id: 'wecom', name: '企业微信群机器人', tpl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx', shape: t => ({ msgtype: 'text', text: { content: t } }) },
    { id: 'telegram', name: 'Telegram 机器人', tpl: 'https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>', shape: t => ({ text: t }) },
    { id: 'discord', name: 'Discord 频道', tpl: 'https://discord.com/api/webhooks/xxxx', shape: t => ({ content: t }) },
    { id: 'slack', name: 'Slack', tpl: 'https://hooks.slack.com/services/xxxx', shape: t => ({ text: t }) },
    /* —— 个人推送：这几类是「手机真会响」的通道，专门用来补救网页通知息屏不响的问题 —— */
    {
      id: 'bark', name: 'Bark（iPhone 真·推送）', tpl: 'https://api.day.app/这里换成你的key',
      hint: 'App Store 装 Bark，首页就能复制这个地址。息屏、锁屏、断网重连都能收到。',
      send: async (hook, title, text) => {
        var url = hook.url.replace(/\/+$/, '');
        var r = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title, body: text, group: '日拱一卒', icon: (location.origin || '') + '/assets/icon-192.png' })
        });
        return { ok: r.ok, status: r.status };
      }
    },
    {
      id: 'serverchan', name: 'Server酱（微信里收到）', tpl: 'https://sctapi.ftqq.com/这里换成你的key.send',
      hint: '到 sct.ftqq.com 用微信扫码登录，复制 SendKey。推送会以服务号消息发到你的微信。',
      send: async (hook, title, text) => {
        var r = await fetch(hook.url, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'title=' + encodeURIComponent(title) + '&desp=' + encodeURIComponent(text.replace(/\n/g, '\n\n'))
        });
        return { ok: r.ok, status: r.status };
      }
    },
    {
      id: 'ntfy', name: 'ntfy（安卓 / 电脑，开源免费）', tpl: 'https://ntfy.sh/这里换成你的频道名',
      hint: '安卓装 ntfy App，订阅同一个频道名即可；不用注册账号。',
      send: async (hook, title, text) => {
        var r = await fetch(hook.url, {
          method: 'POST', headers: { 'Title': title, 'Tags': 'seedling', 'Priority': 'default' },
          body: text
        });
        return { ok: r.ok, status: r.status };
      }
    },
    {
      id: 'pushdeer', name: 'PushDeer（微信 / iOS 都行）', tpl: 'https://api2.pushdeer.com/message/push?pushkey=这里换成你的key',
      hint: 'PushDeer 官网获取 pushkey，可推到 iOS 与微信。',
      send: async (hook, title, text) => {
        var r = await fetch(hook.url + '&text=' + encodeURIComponent(title) + '&desp=' + encodeURIComponent(text), { method: 'GET' });
        return { ok: r.ok, status: r.status };
      }
    },
    { id: 'custom', name: '自定义（n8n / IFTTT / Home Assistant）', tpl: 'https://…', shape: t => ({ text: t, event: null }) }
  ];
  function hookDef(id) { return HOOKS.find(h => h.id === id) || HOOKS[HOOKS.length - 1]; }

  function todayText(event, extra) {
    var d = U.today(), r = Engine.todayRate(d);
    var lines = ['📅 ' + U.prettyDate(d) + ' · 日拱一卒'];
    lines.push('进度 ' + r.done + '/' + r.total + '（' + r.pct + '%）');
    Engine.items().forEach(function (it) {
      var lg = Engine.getLog(d, it.id);
      if (Engine.isDone(it, d)) {
        lines.push('✅ ' + it.name + (it.type !== 'check' && lg && lg.v ? ' ' + U.numShort(lg.v) + (it.unit || '') : ''));
      } else {
        lines.push('⬜ ' + it.name + (it.target ? '（目标 ' + U.num(it.target) + (it.unit || '') + '）' : ''));
      }
    });
    if (extra) lines.push(extra);
    var gs = Engine.globalStreak();
    lines.push('连续 ' + gs + ' 天 · 积分 ' + Engine.points());
    return lines.join('\n');
  }

  async function post(hook, text, title) {
    var def = hookDef(hook.type);
    title = title || '日拱一卒';
    /* 新渠道（Bark / Server酱 / ntfy / PushDeer）有自己的协议 */
    if (def.send) {
      try { return await def.send(hook, title, text); }
      catch (e) { return { ok: false, err: e.message || '网络错误' }; }
    }
    var body = def.shape ? def.shape(text) : { text: text };
    body.event = hook.eventHint || 'habit';
    try {
      var r = await fetch(hook.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      // 跨域被拦时用 no-cors 尽力送出（结果不可读）
      try {
        await fetch(hook.url, {
          method: 'POST', mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(body)
        });
        return { ok: true, unsure: true };
      } catch (e2) { return { ok: false, err: e.message || '网络错误' }; }
    }
  }

  async function fire(event, extra, opt) {
    opt = opt || {};
    var list = (cfg().hooks || []).filter(h => h.on && (!h.events || !h.events.length || h.events.indexOf(event) >= 0));
    if (!list.length) return 0;
    var text = opt.text || todayText(event, extra);
    var n = 0;
    for (const h of list) {
      var r = await post(h, text, opt.title);
      if (r.ok) n++;
    }
    return n;
  }

  /* 提醒专用：只发一句话，别把整份清单推到手机上 */
  function pushRemind(title, body) {
    try { return fire('remind', null, { title: title, text: body }); } catch (e) { return Promise.resolve(0); }
  }

  /* 每日定时汇报：由提醒循环调用 */
  function dailyTick(hh) {
    var p = cfg().daily;
    if (!p.enabled) return;
    if (hh !== (p.at || '21:30')) return;
    if (p.last === U.today()) return;
    p.last = U.today();
    Store.save();
    fire('daily', '这是今天的自动汇报');
  }

  /* ================= 3. 快捷指令 / URL 命令 ================= */
  function cmdUrl(parts) {
    var base = location.origin + location.pathname;
    var q = Object.keys(parts).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(parts[k])).join('&');
    return base + '?cmd=1&' + q;
  }

  /* 解析并执行一条外部命令，返回结果对象 */
  /* 异步命令：要走网盘（WebDAV）的只能返回 Promise，调用方统一 await */
  async function runCommand(q) {
    var do_ = (q.get('do') || q.get('act') || '').toLowerCase();
    var name = q.get('name') || q.get('habit') || '';
    var items = Engine.items();
    var it = name ? items.find(x => x.name === name || x.id === name) : null;
    /* WebDAV 备份（4.6）：一条链接就能把网盘上的备份拉回来。
     * 换设备时在新设备打开这条链接就行，不用手动找文件、选导入模式。
     * 默认「合并」—— 那条链接是用户主动点的，不该有毁掉本机数据的歧义；
     * 要覆盖必须显式带 mode=replace。 */
    if (do_ === 'webdavpull' || do_ === 'davpull') {
      if (!window.WebDAV || !WebDAV.has()) return { ok: false, msg: '这台设备还没配置网盘备份（去「连接」页填一次）' };
      const p = await WebDAV.pull();
      if (!p.ok) return { ok: false, msg: p.msg || '网盘上读不到备份' };
      const mode = (q.get('mode') === 'replace') ? 'replace' : 'merge';
      try {
        await Store.importJSON(p.text, mode);
        if (window.Engine && Engine.bustCache) Engine.bustCache();
        Store.commit(s => { try { s.settings.lastOrigin = location.origin; } catch (e) { } });
        WebDAV.markSeen();
        return { ok: true, msg: mode === 'replace' ? '已用网盘备份覆盖本机数据' : '已把网盘备份合并进本机' };
      } catch (e) { return { ok: false, msg: '导入失败：' + e.message }; }
    }
    /* 把本机这份推到网盘；有冲突时不自作主张，明确告诉用户去哪里处理 */
    if (do_ === 'webdavup' || do_ === 'davup') {
      if (!window.WebDAV || !WebDAV.has()) return { ok: false, msg: '这台设备还没配置网盘备份（去「连接」页填一次）' };
      const r = await WebDAV.upload({});
      if (r.ok) return { ok: true, msg: '已备份到网盘' };
      if (r.conflict) return { ok: false, msg: '网盘上有另一台设备的新备份，去「连接」页选保留哪一份' };
      return { ok: false, msg: r.msg || '备份失败' };
    }
    if (do_ === 'tick' || do_ === 'check') {
      if (!it) return { ok: false, msg: '没有叫「' + name + '」的习惯' };
      var on = Engine.toggle(it, U.today());
      Store.commit();
      fire('checkin', (on ? '✅ 打卡：' : '↩️ 取消：') + it.name);
      return { ok: true, msg: (on ? '已打卡：' : '已取消：') + it.name };
    }
    if (do_ === 'val' || do_ === 'value') {
      if (!it) return { ok: false, msg: '没有叫「' + name + '」的习惯' };
      var v = parseFloat(q.get('v') || q.get('value') || '0');
      Engine.setValue(it, U.today(), v);
      Store.commit();
      fire('checkin', '📝 ' + it.name + ' ' + v + (it.unit || ''));
      return { ok: true, msg: it.name + ' 记为 ' + v + (it.unit || '') };
    }
    if (do_ === 'bundle') {
      var b = (Store.s.bundles || []).find(x => x.name === name || x.id === name);
      if (!b) return { ok: false, msg: '没有叫「' + name + '」的套餐' };
      Engine.runBundle(b);
      Store.commit();
      return { ok: true, msg: '已执行套餐：' + b.name };
    }
    if (do_ === 'note') {
      var t = q.get('text') || q.get('t') || '';
      if (!t) return { ok: false, msg: '缺少 text 参数' };
      Store.commit(s => {
        var d = U.today();
        s.notes[d] = s.notes[d] || { text: '', photos: [], audios: [] };
        s.notes[d].text = (s.notes[d].text ? s.notes[d].text + '\n' : '') + t;
      });
      return { ok: true, msg: '笔记已记录' };
    }
    if (do_ === 'status') return { ok: true, status: true, msg: '今日状态已生成' };
    if (do_ === 'sync') {
      if (!Cloud.signedIn()) return { ok: false, msg: '未登录云端' };
      Cloud.syncNow().then(() => U.toast('已同步'));
      return { ok: true, msg: '正在同步…' };
    }
    return { ok: false, msg: '未知命令：' + do_ };
  }

  function statusJSON() {
    var d = U.today(), r = Engine.todayRate(d);
    return {
      app: '日拱一卒', date: d, done: r.done, total: r.total, pct: r.pct,
      streak: Engine.globalStreak(), points: Engine.points(),
      habits: Engine.items().map(function (it) {
        var lg = Engine.getLog(d, it.id);
        return { name: it.name, done: Engine.isDone(it, d), value: (lg && lg.v) || 0, target: it.target, unit: it.unit };
      })
    };
  }

  /* ================= 4. 健康 / 运动数据导入 ================= */
  function parseHealth(text) {
    var out = [];
    try {
      var s = String(text || '').trim();
      if (s[0] === '{' || s[0] === '[') {
        var j = JSON.parse(s);
        var metrics = (j && j.data && j.data.metrics) || (Array.isArray(j) ? j : null) || (j && j.metrics) || [];
        metrics.forEach(function (m) {
          var nm = m.name || m.type || 'metric';
          (m.data || (Array.isArray(m) ? m : []) || []).forEach(function (row) {
            var dt = String(row.date || row.startDate || row.day || '').slice(0, 10);
            var v = row.qty != null ? row.qty : (row.value != null ? row.value : row.sum);
            if (dt && v != null) out.push({ date: dt, name: nm, value: parseFloat(v), unit: row.units || row.unit || '' });
          });
        });
      } else {
        var lines = s.split(/\r?\n/).filter(Boolean);
        var head = lines[0].split(/[,\t]/).map(x => x.trim().toLowerCase());
        var iDate = head.findIndex(h => /date|日期|time|时间/.test(h));
        var iName = head.findIndex(h => /name|metric|项目|指标|类型/.test(h));
        var iVal = head.findIndex(h => /qty|value|val|数值|数量|值/.test(h));
        if (iDate < 0) iDate = 0;
        if (iVal < 0) iVal = lines[0].split(/[,\t]/).length - 1;
        lines.slice(1).forEach(function (ln) {
          var c = ln.split(/[,\t]/).map(x => x.trim());
          if (c.length < 2) return;
          out.push({
            date: String(c[iDate] || '').slice(0, 10),
            name: iName >= 0 ? (c[iName] || 'metric') : 'metric',
            value: parseFloat(String(c[iVal] || '').replace(/[^\d.\-]/g, '')) || 0,
            unit: ''
          });
        });
      }
    } catch (e) { return { error: e.message }; }
    out = out.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isFinite(r.value));
    return { rows: out };
  }

  function applyHealth(rows, targetId, divide, mode) {
    var it = (Store.s.items || []).find(x => x.id === targetId);
    if (!it) return { ok: false, msg: '目标习惯不存在' };
    var n = 0;
    rows.forEach(function (r) {
      var v = r.value / (divide || 1);
      v = Math.round(v * 100) / 100;
      if (mode === 'add') {
        var cur = Engine.getLog(r.date, it.id);
        Engine.setValue(it, r.date, ((cur && cur.v) || 0) + v);
      } else Engine.setValue(it, r.date, v);
      n++;
    });
    Store.commit();
    return { ok: true, msg: '已写入 ' + n + ' 天数据到「' + it.name + '」' };
  }

  /* ================= 5. 导出到笔记 / 表格 ================= */
  async function exportMarkdown(style) {
    var st = Store.s;
    var days = Object.keys(st.notes || {}).concat(Object.keys(st.logs || {}))
      .filter((v, i, a) => a.indexOf(v) === i).sort().reverse();
    if (!days.length) days = [U.today()];
    var out = [];
    if (style === 'obsidian') out.push('---');
    for (const d of days.slice(0, 400)) {
      var note = st.notes[d] || {};
      var mood = st.moods[d];
      var r = Engine.todayRate(d);
      if (style === 'obsidian') {
        out.push('---');
        out.push('date: ' + d);
        out.push('mood: ' + (mood || ''));
        out.push('tags: [日拱一卒, 日记]');
        out.push('---');
        out.push('');
        out.push('# ' + U.prettyDate(d));
      } else {
        out.push('## ' + U.prettyDate(d) + '（' + d + '）');
      }
      out.push('');
      out.push('- 完成 ' + r.done + '/' + r.total + '（' + r.pct + '%）' + (mood ? ' · 心情 ' + mood + '/5' : ''));
      Engine.items().forEach(function (it) {
        var lg = Engine.getLog(d, it.id);
        var mark = Engine.isDone(it, d) ? '[x]' : '[ ]';
        out.push('- ' + mark + ' ' + it.name + (it.type !== 'check' && lg && lg.v ? ' — ' + U.numShort(lg.v) + (it.unit || '') : ''));
      });
      if (note.text) { out.push(''); out.push(note.text); }
      var ph = (note.photos || []).length ? (note.photos || []).length : 0;
      if (ph) {
        out.push('');
        out.push('照片：' + ph + ' 张');
        for (const p of (note.photos || [])) {
          var url = Cloud.signedIn() ? await Cloud.signedUrl(p.id, 3600) : null;
          if (url) out.push('![](' + url + ')');
        }
      }
      out.push('');
    }
    return out.join('\n');
  }

  function exportCSV() {
    var st = Store.s;
    var rows = ['日期,习惯,类型,数值,单位,目标,是否完成'];
    var days = Object.keys(st.logs || {}).sort();
    (st.items || []).forEach(function (it) {
      days.forEach(function (d) {
        var lg = (st.logs[d] || {})[it.id];
        if (!lg) return;
        rows.push([d, it.name, it.type, (lg.v != null ? lg.v : (lg.d ? 1 : 0)), it.unit || '', it.target || '',
          Engine.isDone(it, d) ? '是' : '否'].join(','));
      });
    });
    return rows.join('\n');
  }

  /* 某个事件是否有「至少一个已启用的推送通道」。
   * 用来判断提醒双保险是否就位 —— 一条 hook 都没配时，息屏 / 关页面就收不到提醒。 */
  function hasChannel(event) {
    var list = (cfg().hooks || []).filter(function (h) {
      return h.on && (!h.events || !h.events.length || h.events.indexOf(event) >= 0);
    });
    return list.length > 0;
  }

  return {
    cfg: cfg, HOOKS: HOOKS, hookDef: hookDef,
    dueOn: dueOn, icsText: icsText, downloadIcs: downloadIcs,
    fire: fire, post: post, pushRemind: pushRemind, dailyTick: dailyTick, todayText: todayText,
    cmdUrl: cmdUrl, runCommand: runCommand, statusJSON: statusJSON,
    parseHealth: parseHealth, applyHealth: applyHealth,
    exportMarkdown: exportMarkdown, exportCSV: exportCSV,
    hasChannel: hasChannel,
    SLOT_TIME: SLOT_TIME
  };
})();
