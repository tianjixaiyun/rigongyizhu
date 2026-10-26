/* ============ 通用工具 ============ */
window.U = (function () {
  const pad = n => String(n).padStart(2, '0');
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const api = {
    pad,
    WEEK,
    /* 应用版本：交付 / 排障时唯一口径。改版本号时记得同步 sw.js 的 CACHE 常量。 */
    VERSION: '54',
    VERSION_NAME: '少即是多',
    BUILD_DATE: '2026-10-22',
    // 本地日期 -> 'YYYY-MM-DD'
    ymd(d = new Date()) {
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },
    // 'YYYY-MM-DD' -> Date（本地零点）
    parseYmd(s) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    },
    today() { return api.ymd(); },
    shiftYmd(s, n) {
      const d = api.parseYmd(s);
      d.setDate(d.getDate() + n);
      return api.ymd(d);
    },
    daysBetween(a, b) {
      return Math.round((api.parseYmd(b) - api.parseYmd(a)) / 86400000);
    },
    rangeYmd(from, to) {
      const out = [];
      let cur = from;
      let guard = 0;
      while (cur <= to && guard++ < 5000) { out.push(cur); cur = api.shiftYmd(cur, 1); }
      return out;
    },
    weekdayOf(s) { return api.parseYmd(s).getDay(); },
    /* ---------- 一周从周几开始（走查第 12 条） ----------
     * 以前所有"周"都写死周一起算：近 12 周趋势、上周周报、月历网格、习惯详情的
     * 本周圆点全是同一套。周日开工的人看到的"上周"和自己的周报永远差一天。
     * 返回 0=周日 / 1=周一，默认周一；只改"周的切分"，不改"周几"本身 ——
     * 按周几统计（周几最容易断）、按周几设提醒，都还是自然星期。 */
    weekStart() {
      const v = window.Store && Store.s && Store.s.settings ? Store.s.settings.weekStart : undefined;
      return v === 0 ? 0 : 1;
    },
    /* 这一天排在"一周"里的第几位（0 = 一周第一天） */
    weekdayIdx(s) { return (api.parseYmd(s).getDay() - api.weekStart() + 7) % 7; },
    /* 这一天所在自然周的第一天 */
    weekStartOf(s) { return api.shiftYmd(s, -api.weekdayIdx(s)); },
    /* 一周的标签，按起始日排好序（月历 / 周历表头用） */
    weekLabels() {
      const out = [];
      for (let i = 0; i < 7; i++) out.push(WEEK[(i + api.weekStart()) % 7]);
      return out;
    },
    prettyDate(s) {
      const d = api.parseYmd(s);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
    },
    hhmm(ts) {
      const d = new Date(ts);
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    /* 秒数 -> 0:12 / 1:05，给视频时长角标用 */
    dur(sec) {
      const s = Math.max(0, Math.round(+sec || 0));
      return Math.floor(s / 60) + ':' + pad(s % 60);
    },
    uid(prefix) {
      return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },
    // 数值美化：1.0 -> 1，1.50 -> 1.5
    num(n) {
      if (n == null) return '';
      return Math.round(n * 100) / 100;
    },
    /* 展示用数值：数值型习惯的累计值（步进 + 手动输入 + 导入）容易带出一串小数，
     * 「41.39 分钟」这种精度对用户毫无意义，还显得界面糙。
     * 规则：≥100 取整，≥10 保留 1 位小数，更小的保留 2 位。 */
    numShort(n) {
      if (n == null || isNaN(n)) return '';
      const a = Math.abs(n);
      if (a >= 100) return Math.round(n);
      if (a >= 10) return Math.round(n * 10) / 10;
      return Math.round(n * 100) / 100;
    },
    bytes(n) {
      if (!n && n !== 0) return '—';
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return (i === 0 ? n : n.toFixed(n < 10 ? 2 : 1)) + ' ' + u[i];
    },
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    },
    // 简单中文数字 -> 阿拉伯数字
    cnNum(s) {
      if (s == null) return null;
      s = String(s).trim();
      if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
      const MAP = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      if (/^[零一二两三四五六七八九十百]+$/.test(s)) {
        if (s === '十') return 10;
        if (s.length === 1) return MAP[s] ?? null;
        if (s.includes('十')) {
          const [a, b] = s.split('十');
          return (a ? MAP[a] : 1) * 10 + (b ? MAP[b] : 0);
        }
        if (s.includes('百')) {
          const [a, b] = s.split('百');
          return (a ? MAP[a] : 1) * 100 + (b ? api.cnNum(b) || 0 : 0);
        }
      }
      const m = s.match(/\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    },
    clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
    debounce(fn, ms) {
      let t;
      return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    },
    vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms || 12); } catch (e) { } },
    download(name, text, mime) {
      const blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
    },
    /* 保存一段文本到用户手上，三档降级。
     * 手机浏览器（尤其微信内置 / 国产浏览器）经常把 <a download> 静默拦掉，
     * 用户以为存好了其实没有 —— 备份这类东西不能有"以为"。
     *   ① 系统分享面板：手机上最顺，能直接存文件 / 发给自己
     *   ② 下载：桌面浏览器正常走这条
     *   ③ 复制到剪贴板：最后的兜底，至少让内容到得了别处
     * @returns {Promise<'share'|'download'|'clipboard'|'fail'>} */
    async saveTextFile(name, text, mime) {
      const isJson = /json/.test(mime || name);
      /* ① 分享面板：只在移动端用，桌面弹这个很打扰 */
      const mobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent || '');
      if (mobile && navigator.canShare) {
        try {
          const file = new File([text], name, { type: mime || 'application/json' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: name });
            return 'share';
          }
        } catch (e) {
          /* 用户主动取消不算失败，直接回退到下一档 */
          if (e && e.name === 'AbortError') return 'fail';
        }
      }
      /* ② 常规下载 */
      try {
        this.download(name, text, mime);
        return 'download';
      } catch (e) { }
      /* ③ 复制兜底 */
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return 'clipboard';
        }
      } catch (e) { }
      return 'fail';
    },
    /* 把一份文本读进用户剪贴板，带旧浏览器兜底 */
    async copyText(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
      } catch (e) { }
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e) { return false; }
    },
    // 颜色亮度 -> 取可读前景色
    readable(hex) {
      try {
        const h = hex.replace('#', '');
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1b1d26' : '#ffffff';
      } catch (e) { return '#fff'; }
    },
    toast(msg, ms) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('on');
      clearTimeout(el._t);
      /* 默认 2.1 秒；长一点的提示（比如劝你别一次建太多习惯）可以传更久，
       * 否则一行字还没读完就灭了。 */
      el._t = setTimeout(() => el.classList.remove('on'), Math.max(1200, ms || 2100));
    }
  };
  return api;
})();
