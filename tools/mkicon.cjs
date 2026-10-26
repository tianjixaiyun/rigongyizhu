/* 生成 iOS「添加到主屏幕」用的 apple-touch-icon（180×180 PNG）。
 *
 * 为什么用浏览器栅格化：仓库里只有 SVG 图标，iOS Safari 不认 SVG 的 apple-touch-icon，
 * 而构建环境没有 PIL / sharp。用无头浏览器把 assets/icon.svg 画到 canvas 上再导出，
 * 得到的 PNG 和用户看到的图标完全一致，且可重复生成（改了 icon.svg 再跑一次即可）。
 *
 * 用法：node tools/mkicon.cjs [尺寸]   默认 180
 * 依赖：仅开发期需要 Playwright（复用验收脚本用的那个运行时），发布包里没有任何新依赖。
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const size = Number(process.argv[2] || 180);
const out = path.join(root, 'assets', 'apple-touch-icon.png');

/* 浏览器导出的 PNG 一律是 RGBA（colortype 6），iOS 又会给自己的圆角遮罩，
 * 所以这里先铺一层不透明底色（让圆角处也有颜色），再把 alpha 通道去掉、重编码成
 * RGB（colortype 2）—— 和仓库里 icon-192/512 同一种格式，体积从 40KB 降到 3KB 左右。
 * 纯 zlib 重编码，不引入任何依赖。 */
function toRGB(png) {
  let pos = 8;                        // 跳过 PNG 签名
  let ihdr = null, idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], ctype: data[9] };
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = ihdr.w * bpp;
  const rows = [];
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y ? rows[y - 1] : Buffer.alloc(stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
    rows.push(cur);
  }
  const rgbStride = ihdr.w * 3;
  const body = Buffer.alloc(ihdr.h * (rgbStride + 1));
  rows.forEach((r, y) => {
    body[y * (rgbStride + 1)] = 0;                       // filter: None
    for (let x = 0; x < ihdr.w; x++) {
      body[y * (rgbStride + 1) + 1 + x * 3] = r[x * 4];
      body[y * (rgbStride + 1) + 2 + x * 3] = r[x * 4 + 1];
      body[y * (rgbStride + 1) + 3 + x * 3] = r[x * 4 + 2];
    }
  });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) : crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(ihdr.w, 0); ih.writeUInt32BE(ihdr.h, 4);
  ih[8] = 8; ih[9] = 2; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(body, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}
/* Node 24 有 zlib.crc32；没有就自己算（表驱动，一次 256 项） */
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

(async () => {
  let chromium;
  try {
    chromium = require('C:/Users/mengw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright').chromium;
  } catch (e) {
    console.error('找不到 Playwright（开发期工具，只在生成图标时需要）：' + e.message);
    process.exit(1);
  }
  const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, args: ['--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0">');
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
    const png = await page.evaluate(async ({ dataUrl, size }) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg 加载失败')); img.src = dataUrl; });
      const cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      const g = cv.getContext('2d');
      /* 先铺不透明底色：SVG 的圆角处是透明的，iOS 会再套自己的圆角遮罩，
       * 铺底之后整张图不透明，圆角处也是图标自己的颜色。 */
      g.fillStyle = '#4f6bed'; g.fillRect(0, 0, size, size);
      g.drawImage(img, 0, 0, size, size);
      return cv.toDataURL('image/png').split(',')[1];
    }, { dataUrl, size });
    const finalPng = toRGB(Buffer.from(png, 'base64'));
    fs.writeFileSync(out, finalPng);
    const kb = (finalPng.length / 1024).toFixed(1);
    console.log('已生成 assets/apple-touch-icon.png（' + size + '×' + size + ' RGB，' + kb + 'KB）');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
