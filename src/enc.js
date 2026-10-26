/* ============ 密码加密备份 ============
 * 外部评审 P1-4 的最后一条：「公开 bundle 的备份导出为 JSON，未见加密导出接口；
 * 可评估密码加密备份，并同时设计密码遗失说明与恢复校验。」
 *
 * 设计要点：
 *   1. 只用浏览器自带的 WebCrypto，不引入任何第三方库（引入库反而会多一条信任链）。
 *   2. PBKDF2-SHA256 迭代 21 万次 + AES-GCM-256。GCM 自带完整性校验 —— 密码错、
 *      文件被改过，解密都会失败，不会解出一半乱码还当成正常数据导进去。
 *   3. 密码**不存任何地方**，也不参与任何网络请求。忘了就是打不开，所以导出后
 *      立刻用同一个密码解一次做「恢复校验」（见 main.js 的 exportenc），
 *      确保交到用户手里的文件真的能开。
 *   4. 文件本身是一段普通 JSON（带 format 标记），所以仍可用同一个「导入备份」入口，
 *      也能用文本编辑器打开看信封信息（只有盐和 iv，没有明文）。
 */
window.Enc = (function () {
  var FORMAT = 'rigongyizhu-enc-v1';
  var ITER = 210000;                 // OWASP 2023 对 PBKDF2-SHA256 的建议下限量级
  /* TextEncoder 懒创建：模块加载阶段不碰它。
   * 这样在没有编码器的环境（测试用的 jsdom 就没有）里也能安全加载，
   * 只有真的要加密/解密时才需要 —— 而那时候一定跑在真浏览器里。 */
  var _enc = null, _dec = null;
  function te() { return _enc || (_enc = new TextEncoder()); }
  function td() { return _dec || (_dec = new TextDecoder()); }

  /* WebCrypto 只在安全上下文里有：https 或 localhost。
   * 局域网用 http://192.168.x.x 打开时 crypto.subtle 是 undefined，
   * 这时要明确告诉用户"这个地址打不开加密"，而不是抛一个看不懂的错。 */
  function available() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.subtle.importKey
      && window.crypto.getRandomValues);
  }

  /* Uint8Array <-> base64：不能一口气 String.fromCharCode.apply，
   * 几十 MB 的备份会直接爆栈（大文件走这里）。 */
  function b64(buf) {
    var bytes = new Uint8Array(buf), out = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(out);
  }
  function unb64(s) {
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function keyFrom(pw, salt, iter) {
    return crypto.subtle.importKey('raw', te().encode(pw), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iter || ITER, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  /* 明文文本 -> 信封对象（可直接 JSON.stringify 落盘） */
  function encrypt(text, pw) {
    if (!available()) return Promise.reject(new Error('这个地址不支持加密，请用 https 打开'));
    if (!pw || String(pw).length < 8) return Promise.reject(new Error('密码至少 8 位'));
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return keyFrom(pw, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, te().encode(text));
    }).then(function (ct) {
      return {
        app: '日拱一卒', format: FORMAT, cipher: 'AES-GCM-256', kdf: 'PBKDF2-SHA256',
        iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct),
        createdAt: Date.now(),
        note: '密码不保存在文件里，也不保存在任何服务器上。忘记密码将无法恢复这份备份。'
      };
    });
  }

  /* 信封对象 -> 明文文本。密码错 / 文件被改动都会 reject，文案要能让人看懂该干什么。 */
  function decrypt(env, pw) {
    if (!available()) return Promise.reject(new Error('这个地址不支持解密，请用 https 打开'));
    if (!env || env.format !== FORMAT) return Promise.reject(new Error('不是加密备份文件'));
    if (!env.data || !env.salt || !env.iv) return Promise.reject(new Error('加密备份文件不完整'));
    var salt, iv, ct;
    try { salt = unb64(env.salt); iv = unb64(env.iv); ct = unb64(env.data); }
    catch (e) { return Promise.reject(new Error('加密备份文件已损坏')); }
    var iter = Number(env.iter) > 0 ? Number(env.iter) : ITER;
    return keyFrom(pw, salt, iter).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    }).then(function (buf) {
      return td().decode(buf);
    }, function () {
      throw new Error('密码不对，或者文件被改动过');
    });
  }

  /* 判断一个已经 JSON.parse 过的对象是不是加密信封 */
  function isEnvelope(o) {
    return !!(o && typeof o === 'object' && o.format === FORMAT && typeof o.data === 'string');
  }

  return {
    available: available, encrypt: encrypt, decrypt: decrypt, isEnvelope: isEnvelope,
    FORMAT: FORMAT, ITER: ITER
  };
})();
