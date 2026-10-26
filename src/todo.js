/* ============ 待办清单（一次性任务） ============
 * 参考 Habitica 的 To-Dos 与 DropDrop 的「习惯 + 任务」模型：
 * 习惯是「要重复做的事」，待办是「做完就没了的事」。
 * 两者分开放，互不污染 —— 待办不进完成率分母，也不影响连击。
 */
window.Todo = (function () {

  const PRIO = ['低', '中', '高'];
  const PRIO_COLOR = ['var(--txt-3)', 'var(--warn)', 'var(--danger)'];

  function all() {
    return (Store.s.todos || []).filter(t => !t.deleted);
  }
  function find(id) {
    return (Store.s.todos || []).find(t => t.id === id && !t.deleted) || null;
  }

  function add(patch) {
    const t = Object.assign({
      id: U.uid('todo'), roomId: Store.s.activeRoomId,
      title: '', note: '', due: null, priority: 1,
      done: false, doneAt: null, subtasks: [],
      createdAt: Date.now(), updatedAt: Date.now(), deleted: false
    }, patch || {});
    Store.commit(st => { (st.todos = st.todos || []).push(t); });
    return t;
  }

  function update(id, patch) {
    Store.commit(st => {
      const t = (st.todos || []).find(x => x.id === id);
      if (t) { Object.assign(t, patch, { updatedAt: Date.now() }); }
    });
  }

  /* 软删除：和习惯一样打时间戳，云端合并时别的设备才知道"这条是删了的" */
  function remove(id) {
    Store.commit(st => {
      const t = (st.todos || []).find(x => x.id === id);
      if (t) { t.deleted = true; t.updatedAt = Date.now(); }
    });
  }

  function toggle(id) {
    const t = find(id);
    if (!t) return null;
    const done = !t.done;
    update(id, { done: done, doneAt: done ? Date.now() : null });
    return done;
  }

  /* 勾掉最后一个子任务 = 整条待办完成；反勾则取消完成 */
  function toggleSub(todoId, subId) {
    const t = find(todoId);
    if (!t) return;
    const s = (t.subtasks || []).find(x => x.id === subId);
    if (!s) return;
    const subs = t.subtasks.map(x => x.id === subId ? Object.assign({}, x, { done: !x.done }) : x);
    const allDone = subs.length > 0 && subs.every(x => x.done);
    update(todoId, { subtasks: subs, done: allDone, doneAt: allDone ? Date.now() : null });
  }
  function addSub(todoId, text) {
    text = String(text || '').trim();
    if (!text) return;
    const t = find(todoId);
    if (!t) return;
    update(todoId, { subtasks: (t.subtasks || []).concat([{ id: U.uid('sub'), text: text, done: false }]) });
  }
  function delSub(todoId, subId) {
    const t = find(todoId);
    if (!t) return;
    update(todoId, { subtasks: (t.subtasks || []).filter(x => x.id !== subId) });
  }

  function subProgress(t) {
    const subs = t.subtasks || [];
    const done = subs.filter(x => x.done).length;
    return { done: done, total: subs.length, pct: subs.length ? Math.round(done / subs.length * 100) : 0 };
  }

  function isOverdue(t, today) {
    return !!(t.due && !t.done && t.due < (today || U.today()));
  }
  function isDueToday(t, today) {
    return !!(t.due && t.due === (today || U.today()));
  }

  /* 排序：未完成在前 → 有截止日的在前（按日期近的优先）→ 同日期按优先级 → 最后按创建时间 */
  function sorted(list, today) {
    today = today || U.today();
    return (list || all()).slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
      if (ad !== bd) return ad < bd ? -1 : 1;
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  /* 今日焦点：今天到期 + 已逾期 + 无日期但未完成的高优先级 */
  function focus(today) {
    today = today || U.today();
    return sorted(all().filter(t => !t.done && (
      t.due ? t.due <= today : (t.priority || 0) >= 2
    )), today);
  }

  function stats(today) {
    today = today || U.today();
    const list = all();
    const open = list.filter(t => !t.done);
    return {
      total: list.length,
      open: open.length,
      done: list.filter(t => t.done).length,
      overdue: open.filter(t => isOverdue(t, today)).length,
      dueToday: open.filter(t => isDueToday(t, today)).length
    };
  }

  /* 相对截止日期文案：今天 / 明天 / 逾期 N 天 */
  function dueText(t, today) {
    if (!t.due) return '';
    today = today || U.today();
    if (t.due === today) return '今天';
    const d = U.daysBetween(today, t.due);
    if (d === 1) return '明天';
    if (d === -1) return '昨天';
    if (d < 0) return '逾期 ' + Math.abs(d) + ' 天';
    if (d <= 7) return d + ' 天后';
    return t.due.slice(5).replace('-', ' 月 ') + ' 日';
  }

  return {
    PRIO, PRIO_COLOR,
    all, find, add, update, remove, toggle, toggleSub, addSub, delSub,
    subProgress, isOverdue, isDueToday, sorted, focus, stats, dueText
  };
})();
