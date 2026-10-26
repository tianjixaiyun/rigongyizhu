/* ============ 附加功能：习惯库 / 套餐 / 语音 / 提醒 / 番茄钟 / 海报 ============ */
window.Feat = (function () {

  /* ---------- 习惯库 ---------- */
  const LIB = [
    { name: '早起', type: 'check', target: null, unit: '', slot: 'morning', reminderAt: '07:00', tags: ['健康'], color: '#BA7517' },
    { name: '喝水', type: 'number', target: 1.5, unit: '升', slot: 'afternoon', reminderAt: '15:00', tags: ['健康'], color: '#378ADD' },
    { name: '跑步', type: 'number', target: 3, unit: '公里', slot: 'evening', reminderAt: '19:30', tags: ['运动'], color: '#1D9E75' },
    { name: '读书', type: 'duration', target: 30, unit: '分钟', slot: 'evening', reminderAt: '21:00', tags: ['学习'], color: '#7F77DD' },
    { name: '背单词', type: 'number', target: 20, unit: '个', slot: 'morning', reminderAt: '08:00', tags: ['学习'], color: '#4f6bed' },
    { name: '冥想', type: 'duration', target: 10, unit: '分钟', slot: 'evening', reminderAt: '22:00', tags: ['健康'], color: '#0f9b8e' },
    { name: '早睡', type: 'check', target: null, unit: '', slot: 'evening', reminderAt: '22:30', tags: ['健康'], color: '#7F77DD' },
    { name: '写日记', type: 'check', target: null, unit: '', slot: 'evening', reminderAt: '22:00', tags: ['整理'], color: '#D4537E' },
    { name: '拉伸', type: 'duration', target: 10, unit: '分钟', slot: 'morning', reminderAt: '07:30', tags: ['运动'], color: '#E05252' },
    { name: '复盘', type: 'check', target: null, unit: '', slot: 'evening', reminderAt: '21:30', tags: ['整理'], color: '#BA7517' }
  ];

  /* ---------- 套餐 ---------- */
  const BUNDLE_PRESET = [
    { icon: 'sun', emoji: '🌅', name: '晨间仪式', items: ['早起', '喝水', '拉伸'] },
    { icon: 'moon', emoji: '🌙', name: '睡前仪式', items: ['写日记', '冥想', '早睡'] },
    { icon: 'dumbbell', emoji: '💪', name: '健康三件套', items: ['喝水', '跑步', '早睡'] }
  ];

  /* ---------- 习惯模板包 ----------
   * 一个包 = 一组互相配合的习惯 + 说明。一键导入：建习惯（已存在同名就复用）+ 自动打成一个套餐。
   * 字段和 LIB 一致，另外可以带 schedule（每周 N 次等）和 why（这条习惯为什么重要，建完能在详情里看到）。 */
  const PACKS = [
    {
      icon: 'sun', emoji: '🌅', name: '早起三件套', desc: '一天的状态，从早上第一件事开始',
      items: [
        { name: '早起', type: 'check', slot: 'morning', reminderAt: '07:00', tags: ['健康'], color: '#BA7517', why: '醒来后的第一件事决定了一天的基调' },
        { name: '喝一杯温水', type: 'check', slot: 'morning', reminderAt: '07:30', tags: ['健康'], color: '#378ADD' },
        { name: '拉伸 5 分钟', type: 'duration', target: 5, unit: '分钟', slot: 'morning', reminderAt: '07:35', tags: ['运动'], color: '#E05252' }
      ]
    },
    {
      icon: 'sneaker-move', emoji: '🏃', name: '减脂 4 周', desc: '少糖 + 动起来 + 睡够，三件事一起做',
      items: [
        { name: '喝水 2 升', type: 'number', target: 2, unit: '升', slot: 'afternoon', reminderAt: '15:00', tags: ['健康'], color: '#378ADD', why: '充足的饮水能让"饿"和"渴"不再搞混' },
        { name: '跑步 3 公里', type: 'number', target: 3, unit: '公里', slot: 'evening', reminderAt: '19:30', tags: ['运动'], color: '#1D9E75', schedule: { type: 'timesPerWeek', n: 3 } },
        { name: '不喝含糖饮料', type: 'avoid', slot: 'afternoon', tags: ['戒断'], color: '#D4537E', why: '忍不住的时候先喝水等 10 分钟' },
        { name: '早睡', type: 'check', slot: 'evening', reminderAt: '22:30', tags: ['健康'], color: '#7F77DD', why: '睡不够的时候，食欲激素会替你做决定' }
      ]
    },
    {
      icon: 'book-open', emoji: '📚', name: '备考冲刺', desc: '输入、专注、复盘三件事循环起来',
      items: [
        { name: '背单词 30 个', type: 'number', target: 30, unit: '个', slot: 'morning', reminderAt: '08:00', tags: ['学习'], color: '#4f6bed' },
        { name: '专注学习', type: 'duration', target: 90, unit: '分钟', slot: 'afternoon', reminderAt: '14:00', tags: ['学习'], color: '#7F77DD' },
        { name: '错题整理', type: 'check', slot: 'evening', reminderAt: '21:00', tags: ['学习'], color: '#0f9b8e' },
        { name: '每晚复盘', type: 'check', slot: 'evening', reminderAt: '21:30', tags: ['整理'], color: '#BA7517', why: '每天 5 分钟回顾，比多学一小时更管用' }
      ]
    },
    {
      icon: 'lotus', emoji: '🧘', name: '减压放松', desc: '先照顾情绪，效率是顺带的',
      items: [
        { name: '冥想 10 分钟', type: 'duration', target: 10, unit: '分钟', slot: 'evening', reminderAt: '22:00', tags: ['健康'], color: '#0f9b8e', why: '不需要清空大脑，只是练习把注意力带回来' },
        { name: '写日记', type: 'check', slot: 'evening', reminderAt: '22:00', tags: ['整理'], color: '#D4537E' },
        { name: '拉伸 10 分钟', type: 'duration', target: 10, unit: '分钟', slot: 'morning', reminderAt: '07:30', tags: ['运动'], color: '#E05252' },
        { name: '睡前不刷手机', type: 'avoid', slot: 'evening', tags: ['戒断'], color: '#7F77DD', why: '把手机放在客厅充电，比靠意志力管用' }
      ]
    },
    {
      icon: 'briefcase', emoji: '💼', name: '高效工作日', desc: '把待办、专注、清理变成每天的固定动作',
      items: [
        { name: '列今日待办', type: 'check', slot: 'morning', reminderAt: '09:00', tags: ['效率'], color: '#BA7517' },
        { name: '番茄专注', type: 'number', target: 4, unit: '个', slot: 'afternoon', reminderAt: '14:00', tags: ['效率'], color: '#1D9E75' },
        { name: '消息清零', type: 'check', slot: 'evening', reminderAt: '18:00', tags: ['整理'], color: '#378ADD' },
        { name: '下班前复盘', type: 'check', slot: 'evening', reminderAt: '18:10', tags: ['整理'], color: '#4f6bed' }
      ]
    },
    {
      icon: 'book-open', emoji: '📖', name: '阅读充电', desc: '每天留一小时给书，短视频自然就少了',
      items: [
        { name: '读书 30 分钟', type: 'duration', target: 30, unit: '分钟', slot: 'evening', reminderAt: '21:00', tags: ['学习'], color: '#7F77DD', why: '比读多久更重要的是每天翻开' },
        { name: '听书 20 分钟', type: 'duration', target: 20, unit: '分钟', slot: 'any', tags: ['学习'], color: '#0f9b8e' },
        { name: '记一条读书笔记', type: 'check', slot: 'evening', reminderAt: '21:30', tags: ['学习'], color: '#BA7517' },
        { name: '不刷短视频', type: 'avoid', slot: 'any', tags: ['戒断'], color: '#D4537E', why: '把 App 从首屏挪走，打开就多一步成本' }
      ]
    },
    {
      icon: 'dumbbell', emoji: '💪', name: '每周三次健身', desc: '频率优先于强度，先把习惯立住',
      items: [
        { name: '力量训练', type: 'duration', target: 45, unit: '分钟', slot: 'evening', reminderAt: '19:00', tags: ['运动'], color: '#E05252', schedule: { type: 'timesPerWeek', n: 3 } },
        { name: '有氧 30 分钟', type: 'duration', target: 30, unit: '分钟', slot: 'evening', reminderAt: '19:00', tags: ['运动'], color: '#1D9E75', schedule: { type: 'timesPerWeek', n: 3 } },
        { name: '练后拉伸', type: 'duration', target: 10, unit: '分钟', slot: 'evening', reminderAt: '20:00', tags: ['运动'], color: '#7F77DD' },
        { name: '记录训练重量', type: 'check', slot: 'evening', reminderAt: '20:10', tags: ['运动'], color: '#BA7517', why: '看得见的进步，才推得动下一次' }
      ]
    },
    {
      icon: 'moon', emoji: '🌙', name: '早睡实验', desc: '连睡两周，白天像换了个人',
      items: [
        { name: '23 点前关灯', type: 'check', slot: 'evening', reminderAt: '22:45', tags: ['健康'], color: '#7F77DD', why: '固定起床时间是节律的锚点' },
        { name: '下午后不喝咖啡', type: 'avoid', slot: 'afternoon', tags: ['戒断'], color: '#378ADD' },
        { name: '手机不进卧室', type: 'avoid', slot: 'evening', tags: ['戒断'], color: '#0f9b8e' },
        { name: '睡前正念', type: 'duration', target: 10, unit: '分钟', slot: 'evening', reminderAt: '22:30', tags: ['健康'], color: '#4f6bed' }
      ]
    },
    {
      icon: 'drop', emoji: '💧', name: '科学喝水', desc: '把水杯放在看得见的地方就行',
      items: [
        { name: '喝水 2 升', type: 'number', target: 2, unit: '升', slot: 'afternoon', reminderAt: '15:00', tags: ['健康'], color: '#378ADD' },
        { name: '饭前一杯水', type: 'check', slot: 'any', tags: ['健康'], color: '#4f6bed' },
        { name: '不喝含糖饮料', type: 'avoid', slot: 'afternoon', tags: ['戒断'], color: '#D4537E' },
        { name: '记录体重', type: 'number', target: 1, unit: '次', slot: 'morning', reminderAt: '08:30', tags: ['健康'], color: '#1D9E75', schedule: { type: 'timesPerWeek', n: 3 }, why: '关注周趋势，别被单日波动骗到' }
      ]
    },
    {
      icon: 'pencil', emoji: '✍️', name: '写作练习', desc: '先写够量，好是量的事',
      items: [
        { name: '每日 500 字', type: 'number', target: 500, unit: '字', slot: 'any', reminderAt: '20:00', tags: ['学习'], color: '#D4537E', why: '先完成，再完美' },
        { name: '阅读输入 30 分钟', type: 'duration', target: 30, unit: '分钟', slot: 'evening', reminderAt: '21:00', tags: ['学习'], color: '#7F77DD' },
        { name: '收集一个灵感', type: 'check', slot: 'any', tags: ['整理'], color: '#BA7517' },
        { name: '周末整理素材', type: 'check', slot: 'weekend', reminderAt: '10:00', tags: ['整理'], color: '#0f9b8e', schedule: { type: 'weekdays', days: [0, 6] } }
      ]
    },
    {
      icon: 'broom', emoji: '🧹', name: '整洁生活', desc: '东西少了、位置固定了，家自己就整齐了',
      items: [
        { name: '每日归位 10 分钟', type: 'duration', target: 10, unit: '分钟', slot: 'evening', reminderAt: '20:30', tags: ['整理'], color: '#378ADD' },
        { name: '扫地拖地', type: 'check', slot: 'weekend', tags: ['整理'], color: '#1D9E75', schedule: { type: 'timesPerWeek', n: 2 } },
        { name: '洗衣服', type: 'check', slot: 'weekend', tags: ['整理'], color: '#7F77DD', schedule: { type: 'timesPerWeek', n: 2 } },
        { name: '睡前备好衣物', type: 'check', slot: 'evening', reminderAt: '22:00', tags: ['整理'], color: '#4f6bed' }
      ]
    },
    {
      icon: 'target', emoji: '🎯', name: '专注戒断', desc: '先看清时间去哪了，再把它要回来',
      items: [
        { name: '不刷短视频', type: 'avoid', slot: 'any', tags: ['戒断'], color: '#D4537E', why: '记录"忍住了"的日子，一周就能看到变化' },
        { name: '娱乐限时', type: 'duration', target: 45, unit: '分钟', slot: 'evening', tags: ['戒断'], color: '#E05252', why: '限时不等于禁止，是给快乐上个闹钟' },
        { name: '深度专注 90 分钟', type: 'duration', target: 90, unit: '分钟', slot: 'afternoon', reminderAt: '14:00', tags: ['效率'], color: '#0f9b8e' },
        { name: '记录屏幕时间', type: 'check', slot: 'evening', reminderAt: '22:00', tags: ['整理'], color: '#BA7517' }
      ]
    }
  ];

  function addBundle(b) {
    Store.commit(st => {
      st.bundles.push(Object.assign({
        id: U.uid('bdl'), emoji: '🧩', name: '新套餐', itemIds: [], createdAt: Date.now()
      }, b));
    });
  }
  function updateBundle(id, patch) {
    Store.commit(st => {
      const b = st.bundles.find(x => x.id === id);
      if (b) Object.assign(b, patch);
    });
  }
  function removeBundle(id) {
    Store.commit(st => { st.bundles = st.bundles.filter(x => x.id !== id); });
  }
  /* 按名字把套餐预设落到当前习惯上 */
  function applyPreset(preset) {
    const st = Store.s;
    const ids = [];
    preset.items.forEach(nm => {
      let it = st.items.find(x => x.name === nm && !x.deleted && !x.archived);
      if (!it) {
        const tpl = LIB.find(l => l.name === nm) || { type: 'check' };
        it = addItem(Object.assign({}, tpl, { name: nm }));
      }
      ids.push(it.id);
    });
    addBundle({ emoji: preset.emoji, name: preset.name, itemIds: ids });
    return ids.length;
  }
  /* 模板包导入：同名的习惯复用已有的（不重复建），其余新建；最后打成一个套餐方便一起打卡
   * 返回 { added, reused }，让调用方能给用户一句准确的话 */
  function applyPack(pack) {
    const st = Store.s;
    let added = 0, reused = 0;
    const ids = [];
    pack.items.forEach(def => {
      let it = st.items.find(x => x.name === def.name && !x.deleted && !x.archived);
      if (it) { reused++; }
      else { it = addItem(Object.assign({}, def)); added++; }
      ids.push(it.id);
    });
    if (ids.length) addBundle({ emoji: pack.emoji, name: pack.name, itemIds: ids });
    return { added: added, reused: reused };
  }

  /* ---------- 习惯增删改 ---------- */
  function addItem(patch) {
    const st = Store.s;
    const pal = Store.palette();
    const it = Object.assign({
      id: U.uid('item'), roomId: st.activeRoomId, sort: st.items.length,
      name: '新习惯', type: 'check', target: null, unit: '', slot: 'any', reminderAt: null,
      tags: [], color: pal[st.items.length % pal.length], steps: [], dependsOn: null,
      /* v49：每周休息额度，0 = 每天都要做（默认）。休息日不算断签也不算没完成 */
      restPerWeek: 0,
      schedule: { type: 'daily' }, goal: null, pausedUntil: null, archived: false, deleted: false,
      createdAt: Date.now(), updatedAt: Date.now()
    }, patch);
    st.items.push(it);
    Store.save();
    Store.emit();
    return it;
  }
  function updateItem(id, patch) {
    Store.commit(st => {
      const it = st.items.find(x => x.id === id);
      if (it) { Object.assign(it, patch); it.updatedAt = Date.now(); }
    });
  }
  /* 软删除 + 打时间戳：这样"删掉"这个动作才会被云端合并带到别的设备上，
     否则其它设备同步时会把已删除的习惯又加回来 */
  function removeItem(id) {
    Store.commit(st => {
      const it = st.items.find(x => x.id === id);
      if (it) { it.deleted = true; it.updatedAt = Date.now(); }
      st.bundles.forEach(b => { b.itemIds = (b.itemIds || []).filter(x => x !== id); });
    });
  }

  /* ---------- 语音 ---------- */
  const Voice = {
    rec: null, on: false,
    supported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    start(cb) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { U.toast('当前浏览器不支持语音识别（建议用 Chrome / Edge / 安卓浏览器）'); return false; }
      const r = new SR();
      r.lang = 'zh-CN'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      Voice.rec = r; Voice.on = true;
      const ov = document.getElementById('voiceOverlay');
      const tx = document.getElementById('voiceText');
      ov.classList.add('on'); tx.textContent = '正在聆听…';
      r.onresult = e => {
        let txt = '';
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        tx.textContent = txt || '正在聆听…';
        if (e.results[e.results.length - 1].isFinal) {
          Voice.stop();
          cb && cb(txt.trim());
        }
      };
      r.onerror = e => {
        Voice.stop();
        const msg = { 'not-allowed': '麦克风被拒绝，请在浏览器地址栏允许麦克风权限', 'no-speech': '没听到声音，再说一次', 'network': '语音服务需要联网，请检查网络' };
        U.toast(msg[e.error] || ('语音识别失败：' + e.error));
        cb && cb(null, e.error);
      };
      r.onend = () => { Voice.on = false; ov.classList.remove('on'); };
      try { r.start(); } catch (err) { Voice.on = false; ov.classList.remove('on'); return false; }
      return true;
    },
    stop() {
      try { Voice.rec && Voice.rec.stop(); } catch (e) { }
      Voice.on = false;
      document.getElementById('voiceOverlay').classList.remove('on');
    },
    /* 执行一条语音指令 */
    run(text) {
      if (!text) return null;
      const cmd = Parse.command(text);
      const st = Store.s;
      if (cmd.kind === 'toggle') {
        const on = Engine.toggle(cmd.item, U.today());
        Store.commit();
        return { ok: true, msg: (on ? '已打卡：' : '已取消：') + cmd.item.name };
      }
      if (cmd.kind === 'value') {
        Engine.setValue(cmd.item, U.today(), cmd.value);
        Store.commit();
        return { ok: true, msg: cmd.item.name + ' 记为 ' + cmd.value + (cmd.item.unit || '') };
      }
      if (cmd.kind === 'undo') {
        Engine.toggle(cmd.item, U.today());
        Store.commit();
        return { ok: true, msg: '已撤销：' + cmd.item.name };
      }
      if (cmd.kind === 'note') {
        const d = U.today();
        Store.commit(s => {
          s.notes[d] = s.notes[d] || { text: '', photos: [], audios: [] };
          s.notes[d].text = (s.notes[d].text ? s.notes[d].text + '\n' : '') + cmd.text;
        });
        return { ok: true, msg: '笔记已记下' };
      }
      if (cmd.kind === 'mood') {
        Store.commit(s => { s.moods[U.today()] = U.clamp(cmd.value, 1, 5); });
        return { ok: true, msg: '心情已记为 ' + cmd.value + ' 分' };
      }
      return { ok: false, msg: '没听懂「' + text + '」，换个说法试试' };
    }
  };

  /* ---------- 提醒 / 通知 / 角标 ---------- */
  const Notify = {
    async request() {
      if (!('Notification' in window)) return 'unsupported';
      if (Notification.permission === 'granted') return 'granted';
      try { return await Notification.requestPermission(); } catch (e) { return 'denied'; }
    },
    fire(title, body, actions) {
      try {
        if (!('Notification' in window) || Notification.permission !== 'granted') return false;
        const n = new Notification(title, Object.assign({ body, icon: 'assets/icon.svg', badge: 'assets/icon.svg' }, actions || {}));
        n.onclick = () => { try { window.focus(); } catch (e) { } n.close(); };
        return true;
      } catch (e) { return false; }
    },
    /* 角标：未打卡数量 */
    badge() {
      const r = Engine.todayRate(U.today());
      const left = r.total - r.done;
      try {
        if (navigator.setAppBadge) {
          if (left > 0) navigator.setAppBadge(left); else navigator.clearAppBadge();
        }
      } catch (e) { }
      try {
        document.title = left > 0 ? ('(' + left + ') 日拱一卒') : '日拱一卒 · 习惯打卡';
      } catch (e) { }
    },
    /* 每分钟检查一次到点提醒 */
    startLoop() {
      const tick = () => {
        const st = Store.s;
        Notify.badge();
        if (st.settings.remindEnabled && Notification.permission === 'granted') {
          const now = new Date();
        const hh = U.pad(now.getHours()) + ':' + U.pad(now.getMinutes());
        if (window.Plugins) { try { Plugins.dailyTick(hh); } catch (e) { } }
        Engine.items().forEach(it => {
          if (it.reminderAt !== hh) return;
            if (Engine.isDone(it, U.today())) return;
            const key = U.today() + hh + it.id;
            if (Notify._last === key) return;
            Notify._last = key;
            Notify.fire('该打卡了：' + it.name, it.target ? ('目标 ' + it.target + (it.unit || '')) : '完成后点一下即可记录', {});
          });
        }
      };
      tick();
      clearInterval(Notify._t);
      Notify._t = setInterval(tick, 30000);
    }
  };

  /* ---------- 番茄钟 ---------- */
  const Pomo = {
    mode: 'idle', left: 0, timer: null, endAt: 0,
    /* v38 · 报告 P1-1：番茄钟之前是孤立的 —— 专注 25 分钟和「读书」这个习惯毫无关系。
     * 绑上之后，结束时会问一句「为『读书』打卡 25 分钟？」，一键把时长记进去。 */
    habitId: '',
    start(minutes, label, habitId) {
      Pomo.stop();
      Pomo.mode = 'run';
      Pomo.endAt = Date.now() + minutes * 60000;
      Pomo.left = minutes * 60;
      Pomo.label = label || '';
      Pomo.habitId = label === '休息' ? '' : (habitId || '');
      Pomo.timer = setInterval(Pomo.tick, 250);
      Pomo.paint();
    },
    breakMin() { Pomo.start((Store.s.settings.breakLen || 5), '休息'); },
    stop() { clearInterval(Pomo.timer); Pomo.timer = null; Pomo.mode = 'idle'; Pomo.paint(); },
    toggle() {
      if (Pomo.mode === 'idle') Pomo.start(Store.s.settings.pomoLen || 25, '专注', Pomo.habitId);
      else Pomo.stop();
    },
    tick() {
      const s = Math.max(0, Math.round((Pomo.endAt - Date.now()) / 1000));
      Pomo.left = s;
      Pomo.paint();
      if (s <= 0) {
        const isBreak = Pomo.label === '休息';
        const mins = isBreak ? (Store.s.settings.breakLen || 5) : (Store.s.settings.pomoLen || 25);
        const hid = Pomo.habitId;
        Pomo.stop();
        U.toast(isBreak ? '休息结束，回来继续' : '专注完成，休息一下');
        U.vibrate([80, 60, 80]);
        Notify.fire(isBreak ? '休息结束' : '番茄钟完成', mins + ' 分钟' + (isBreak ? '休息' : '专注') + '结束' + (isBreak ? '' : '，去休息 5 分钟'));
        Store.commit(st => {
          st.sessions.push({
            id: U.uid('ses'), kind: isBreak ? 'break' : 'focus',
            minutes: mins, at: Date.now(), habitId: isBreak ? '' : (hid || '')
          });
        });
        if (!isBreak && hid) Pomo.askLog(hid, mins);
      }
    },
    /* 专注结束后的那一问。不做成自动写入：番茄钟和习惯不一定是一回事，
     * 替用户做主等于污染他的数据。 */
    askLog(habitId, minutes) {
      const it = (Store.s.items || []).find(x => x.id === habitId && !x.deleted);
      if (!it || !window.Engine) return;
      const today = U.today();
      if (Engine.isDone(it, today)) { U.toast('「' + it.name + '」今天已经打卡了'); return; }
      UX.confirm({
        icon: '⏱',
        title: '为「' + it.name + '」打卡 ' + minutes + ' 分钟？',
        msg: '这段专注可以直接记进这个习惯，不用再手动填一次。',
        ok: '记进去', cancel: '只记专注'
      }).then(yes => {
        if (!yes) return;
        Engine.addValue(it, today, minutes);
        Store.commit();
        if (window.UI) { UI.closeSheet(); UI.render(); }
        U.toast('已记入「' + it.name + '」' + minutes + ' 分钟');
      });
    },
    paint() {
      /* 桌面端番茄钟在顶栏，手机端是右下角浮动球 —— 两处一起刷 */
      const topTxt = document.getElementById('pomoTopTxt');
      const fab = document.getElementById('fabPomodoro');
      const idle = (Store.s.settings.pomoLen || 25) + ':00';
      const running = Pomo.mode === 'idle' ? '' : U.pad(Math.floor(Pomo.left / 60)) + ':' + U.pad(Pomo.left % 60);
      if (topTxt) topTxt.textContent = running || idle;
      const btnTop = document.getElementById('btnPomoTop');
      if (btnTop) btnTop.classList.toggle('run', Pomo.mode !== 'idle');
      if (!fab) return;
      if (Pomo.mode === 'idle') {
        fab.textContent = idle;
        fab.classList.remove('run');
      } else {
        const m = Math.floor(Pomo.left / 60), s = Pomo.left % 60;
        fab.textContent = U.pad(m) + ':' + U.pad(s);
        fab.classList.add('run');
      }
      /* 计时开始 / 结束时，悬浮球的显示规则也跟着变（非今日页只在计时中显示） */
      if (window.UI && UI.syncFab) { try { UI.syncFab(); } catch (e) { } }
    }
  };

  /* ---------- 日签海报 ---------- */
  function drawPoster(canvas, note) {
    const st = Store.s;
    const d = U.today();
    const r = Engine.todayRate(d);
    const W = 640, H = 900;
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';

    const bg = g.createLinearGradient(0, 0, W, H);
    if (dark) { bg.addColorStop(0, '#1b2030'); bg.addColorStop(1, '#12141c'); }
    else { bg.addColorStop(0, '#eef1ff'); bg.addColorStop(1, '#fdf6ef'); }
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    g.fillStyle = dark ? '#e9ebf3' : '#1b1d26';
    g.font = '600 26px "PingFang SC",sans-serif';
    g.fillText('日 拱 一 卒', 48, 92);
    g.fillStyle = dark ? '#8d92a5' : '#8d92a5';
    g.font = '400 17px "PingFang SC",sans-serif';
    g.fillText(U.prettyDate(d), 48, 126);

    // 完成率环
    const cx = W / 2, cy = 300, R = 108;
    g.lineWidth = 16; g.lineCap = 'round';
    g.strokeStyle = dark ? '#2a2f3d' : '#e4e7f2';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    const grd = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    grd.addColorStop(0, '#4f6bed'); grd.addColorStop(1, '#8b7bff');
    g.strokeStyle = grd;
    g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (r.pct / 100)); g.stroke();
    g.fillStyle = dark ? '#e9ebf3' : '#1b1d26';
    g.textAlign = 'center';
    g.font = '700 62px "PingFang SC",sans-serif';
    g.fillText(r.pct + '%', cx, cy + 12);
    g.font = '400 16px "PingFang SC",sans-serif';
    g.fillStyle = dark ? '#a4aac0' : '#5b6072';
    g.fillText(r.done + ' / ' + r.total + ' 项完成', cx, cy + 44);
    g.textAlign = 'left';

    // 习惯列表
    let y = 470;
    g.font = '500 19px "PingFang SC",sans-serif';
    Engine.items().slice(0, 8).forEach(it => {
      const done = Engine.isDone(it, d);
      g.fillStyle = done ? (it.color || '#4f6bed') : (dark ? '#3a4050' : '#ccd0de');
      g.beginPath(); g.arc(62, y - 6, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = dark ? (done ? '#e9ebf3' : '#757c92') : (done ? '#1b1d26' : '#9aa0b4');
      let txt = it.name;
      if (it.type !== 'check') {
        const lg = Engine.getLog(d, it.id);
        txt += '  ' + ((lg && lg.v) || 0) + '/' + (it.target || 0) + (it.unit || '');
      }
      g.fillText(txt, 84, y);
      if (done) {
        g.strokeStyle = dark ? '#3ecf7a' : '#16a34a'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(56, y - 6); g.lineTo(61, y - 1); g.lineTo(70, y - 13); g.stroke();
      }
      y += 40;
    });

    // 底部数据
    const gs = Engine.globalStreak();
    const foot = [
      { k: '连续', v: gs + ' 天' },
      { k: '累计打卡', v: Engine.totalCheckins() + ' 次' },
      { k: '积分', v: Engine.points() + '' }
    ];
    let x = 48;
    y = H - 130;
    foot.forEach(f => {
      g.fillStyle = dark ? '#a4aac0' : '#8d92a5';
      g.font = '400 15px "PingFang SC",sans-serif';
      g.fillText(f.k, x, y);
      g.fillStyle = dark ? '#e9ebf3' : '#1b1d26';
      g.font = '700 30px "PingFang SC",sans-serif';
      g.fillText(f.v, x, y + 38);
      x += 200;
    });
    g.fillStyle = dark ? '#5b6178' : '#a8adbf';
    g.font = '400 14px "PingFang SC",sans-serif';
    g.fillText('功不唐捐 · ' + new Date().getFullYear(), 48, H - 40);

    /* 纪念语（走查第 6 条：里程碑庆祝时可一键生成纪念版日签）。
     * 放在标题与完成率环之间（环顶在 y=184，这里 146–182 不压它），
     * 用 accent 色小药丸托住 —— 不抢下面四个数字的位置。 */
    if (note) {
      const text = String(note).slice(0, 40);
      g.font = '600 19px "PingFang SC",sans-serif';
      const w = Math.min(W - 120, g.measureText(text).width + 40);
      const bx = (W - w) / 2, by = 146;
      g.fillStyle = dark ? 'rgba(79,107,237,.24)' : 'rgba(79,107,237,.12)';
      g.beginPath();
      if (g.roundRect) g.roundRect(bx, by, w, 36, 18); else g.rect(bx, by, w, 36);
      g.fill();
      g.fillStyle = dark ? '#c9d2ff' : '#3b53d6';
      g.textAlign = 'center';
      g.fillText(text, W / 2, by + 24);
      g.textAlign = 'left';
    }
  }

  /* ---------- 年度海报（v41 · 报告 P1-7） ----------
   * 每年一次的自传播物料：复用日签海报的画布管线，换成「一年」的口径。
   * 只放真实的四个数 + 12 个月柱状 + 最稳的三个习惯，不做假大空的总结。 */
  function drawYearPoster(canvas) {
    const year = new Date().getFullYear();
    const y = Engine.yearly(year);
    const W = 640, H = 900;
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg = g.createLinearGradient(0, 0, W, H);
    if (dark) { bg.addColorStop(0, '#1b2030'); bg.addColorStop(1, '#12141c'); }
    else { bg.addColorStop(0, '#eef1ff'); bg.addColorStop(1, '#fdf6ef'); }
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    g.fillStyle = dark ? '#e9ebf3' : '#1b1d26';
    g.font = '600 26px "PingFang SC",sans-serif';
    g.fillText('日 拱 一 卒', 48, 92);
    g.fillStyle = dark ? '#8d92a5' : '#8d92a5';
    g.font = '400 17px "PingFang SC",sans-serif';
    g.fillText(year + ' 年度回顾', 48, 126);

    /* 四个真实数字 */
    let best = 0;
    Engine.items().forEach(it => { best = Math.max(best, Engine.bestStreak(it.id) || 0); });
    const nums = [
      { k: '完成率', v: y.rate + '%' },
      { k: '有效天数', v: y.daysActive + '' },
      { k: '完成次数', v: y.totalDone + '' },
      { k: '最长连续', v: best + ' 天' }
    ];
    let nx = 48, ny = 210;
    nums.forEach(n => {
      g.fillStyle = dark ? '#a4aac0' : '#8d92a5';
      g.font = '400 15px "PingFang SC",sans-serif';
      g.fillText(n.k, nx, ny);
      g.fillStyle = dark ? '#e9ebf3' : '#1b1d26';
      g.font = '700 34px "PingFang SC",sans-serif';
      g.fillText(n.v, nx, ny + 40);
      nx += 148;
    });

    /* 12 个月柱状：一眼看出哪几个月在坚持 */
    const baseY = 460, maxH = 150;
    const months = [];
    for (let m = 1; m <= 12; m++) {
      let due = 0, ok = 0;
      const last = new Date(year, m, 0).getDate();
      for (let dd = 1; dd <= last; dd++) {
        const date = year + '-' + U.pad(m) + '-' + U.pad(dd);
        if (date > U.today()) break;
        Engine.items().forEach(it => {
          if (!Engine.isDue(it, date)) return;
          due++; if (Engine.isDone(it, date)) ok++;
        });
      }
      months.push({ m: m, rate: due ? ok / due : 0, due: due });
    }
    const bw = 38, gap = 6, x0 = 48;
    months.forEach((mo, i) => {
      const h = Math.max(3, Math.round(maxH * mo.rate));
      const x = x0 + i * (bw + gap);
      g.fillStyle = dark ? '#242938' : '#e4e7f2';
      g.fillRect(x, baseY - maxH, bw, maxH);
      const grd = g.createLinearGradient(x, baseY - h, x, baseY);
      grd.addColorStop(0, '#8b7bff'); grd.addColorStop(1, '#4f6bed');
      g.fillStyle = mo.due ? grd : (dark ? '#2a2f3d' : '#eceef6');
      g.fillRect(x, baseY - h, bw, h);
      g.fillStyle = dark ? '#6c7288' : '#a8adbf';
      g.font = '400 11px "PingFang SC",sans-serif';
      g.textAlign = 'center';
      g.fillText(String(mo.m), x + bw / 2, baseY + 16);
      g.textAlign = 'left';
    });

    /* 最稳的三个习惯：按今年完成次数排 */
    const cnt = {};
    Engine.items().forEach(it => {
      let n = 0;
      Object.keys(Store.s.logs || {}).forEach(d => {
        if (d.slice(0, 4) !== String(year)) return;
        if (Engine.isDone(it, d)) n++;
      });
      cnt[it.id] = n;
    });
    const top = Engine.items().slice().sort((a, b) => (cnt[b.id] || 0) - (cnt[a.id] || 0)).slice(0, 3);
    let ty = 545;
    g.fillStyle = dark ? '#8d92a5' : '#8d92a5';
    g.font = '400 15px "PingFang SC",sans-serif';
    g.fillText('坚持最久的三个习惯', 48, ty);
    ty += 34;
    top.forEach(it => {
      g.fillStyle = it.color || '#4f6bed';
      g.beginPath(); g.arc(56, ty - 6, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = dark ? '#e9ebf3' : '#1b1d26';
      g.font = '500 19px "PingFang SC",sans-serif';
      g.fillText(it.name, 76, ty);
      g.fillStyle = dark ? '#8d92a5' : '#8d92a5';
      g.font = '400 15px "PingFang SC",sans-serif';
      g.textAlign = 'right';
      g.fillText((cnt[it.id] || 0) + ' 次', W - 48, ty);
      g.textAlign = 'left';
      ty += 38;
    });

    g.fillStyle = dark ? '#5b6178' : '#a8adbf';
    g.font = '400 14px "PingFang SC",sans-serif';
    g.fillText('功不唐捐 · ' + year, 48, H - 40);
  }

  return {
    LIB, BUNDLE_PRESET, PACKS, applyPack,
    addItem, updateItem, removeItem,
    addBundle, updateBundle, removeBundle, applyPreset,
    Voice, Notify, Pomo, drawPoster, drawYearPoster
  };
})();
