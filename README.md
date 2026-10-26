# 日拱一卒 · 习惯打卡

一个**默认只存在本机**的习惯打卡 PWA。每天勾一下，看得见连续天数、周报与趋势；不注册也能用，不开同步就不上传。

线上地址：https://487dae8d492d47819d3ff3fe06b9648d.sg.agentos-app.run

## 为什么是它

- **数据归你**：IndexedDB 本地主存储，JSON / 加密 JSON（AES-GCM + PBKDF2）/ CSV / Markdown 全量可携带，支持 WebDAV 自建网盘备份。
- **诚实的产品观**：数据不够时回顾页什么都不显示，比摆一堆 0% 更诚实；补卡只给 3 天，是救急用的，不是刷连击用的。
- **行为科学落地**：习惯强度（漏一天不归零）、最小版本、实现意图（「什么时候做」写进提醒）、66 天锚点。
- **零第三方依赖**：运行时没有框架、没有 CDN、没有统计脚本（服务端 CSP 把平台注入的那段也拦掉了）。

## 技术栈

原生 JS（IIFE 模块）+ 手写 CSS + Service Worker。没有构建框架，`tools/bundle.cjs` 负责合并压缩（terser + css-tree，二者缺失时自动降级为去注释）。

```
src/            各模块（util / store / engine / ui / main / remind / diary / insights …）
assets/         app.css、product.css、icons.svg、图标 PNG
server.js       唯一服务：静态白名单 + /api/* + gzip + ETag + CSP
sw.js           离线缓存：FILES（核心，失败即安装失败）/ OPTIONAL（逐个装，失败只丢自己）
tests/          单测（node:test + jsdom）
tools/          check（静态检查）/ bump（升版）/ bundle（打包）/ release（发布打包）
```

## 本地开发

```bash
npm install          # 只装 devDependencies（jsdom / terser / css-tree）
node server.js       # http://localhost:3000
node tools/check.cjs # 语法 + 版本一致性 + 离线清单覆盖
node --test tests/*.test.cjs
```

改代码请在源码目录改，**不要直接改发布产物**。发布：

```bash
node tools/bump.cjs "版本名"   # 一处改完五处版本号
node tools/release.cjs         # 同步 → 打包 → 清源码 → 写最小 package.json
```

## 数据与隐私

| 数据 | 存哪 | 什么时候出网 |
|---|---|---|
| 习惯 / 打卡 / 日记正文 | 这台设备的浏览器数据库 | 默认不出网 |
| 照片 / 视频 / 语音 | 默认本机；登录云空间且开关打开时才上传 | 上传到你自己的账号 |
| 网盘备份（WebDAV） | 你填的网盘，浏览器直连 | 点「立即备份」时 |
| 搭子 / 房间 | 本站搭子服务，仅昵称、习惯名、今日完成、连续天数 | 加入后每天一次 |
| 加密导出文件 | 你选择的位置，我们不接收 | 由你拷走 |

不使用 Cookie；平台注入的访问统计脚本已被服务端 CSP 拦下。

## 许可

未指定许可证。未经作者同意，请勿用于商业分发。
