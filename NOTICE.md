# 来源、许可与复用说明

原业务前端来自用户指定的原站：
https://72e0ed71f79541ef8f9c1980e8169a62.sg.agentos-app.run/
下载于 2026-10-16，版本 v18.5。仅用于用户授权的原项目维护；不将原应用重新标为开源，不对原代码另授许可证。

vendor/cloud-sdk.js 与下载基线字节一致。没有添加管理员密钥或个人记录；沿用的 publishableKey 是原站公开配置，不能当作管理密钥。
预览平台注入的 Beacon 不作为新版业务源码复制；平台自身仍可能注入统计。

assets/icons.svg 沿用官方 @phosphor-icons/core@2.1.1，MIT License；完整版权与许可 assets/PHOSPHOR-LICENSE.txt 随包保留。
官方来源：https://github.com/phosphor-icons/core
参考 Loop Habit Tracker 的轻量交互、排程和统计表达；未复制其 GPL 代码、品牌或图像。
官方来源：https://github.com/iSoron/uhabits

没有新增运行时依赖。测试沿用锁定版本 jsdom（MIT）、fake-indexeddb（Apache-2.0）、PGlite（Apache-2.0；内部 PostgreSQL 依其许可）。
依赖只用于本地测试，不进入网页运行包；完整依赖许可在各官方包内。复用本机已安装的相同版本依赖，没有执行第三方安装脚本；不声称做了实时完整漏洞库审计。

旧 v18 项目与个人数据未修改。只读下载公开前端，数据库验证采用隔离内存 PostgreSQL 与虚构账号。
