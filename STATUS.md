# PocketPulse G2 · Wave 4A 交付状态

2026-11-25（北京时间）。本轮交付覆盖官方模拟器上的实时行情、风控拒单、纸单成交与 Telegram 备忘，以及可复现的演示制作和独立源码仓库。

## 模拟器验收

| 场景 | 实测结果 |
| --- | --- |
| A · Track 02 实时行情 | 读取 Hyperliquid 永续资金费率与买卖首档、Polymarket 24 小时 YES 赔率变化与盘口。在 G2 触控板上滑动切换，两端均显示 LIVE 来源。 |
| B · 风控拒单 | 对真实 Polymarket BTC 市场执行两次触控。服务端重新取价，HUD 回显 `BLOCKED: Slippage 84.04bp > 50bp cap`。脚本直接查询 SQLite，成交数为 0。 |
| C · Track 01 / Best Telegram Integration | 返回 Hyperliquid BTC 永续行情，两次触控确认 $25 纸单。成交价 59,720，滑点 2.09 bp。SQLite 写入 1 笔，HUD、WebView 与 Telegram 本地备忘均显示 `#001`。 |
| 语音指令自测 | 16 kHz WAV 经真实 HTTP 路由转发到本地 STT 替身，验证 `next`、`review`、`cancel` 和拒绝 `confirm trade`。账本成交数为 0。 |

自动化测试还覆盖过期报价、确认时绕过浏览缓存、SQLite 防重和日限额，以及替身 Bot API 的结构化消息、返回 message ID 与未知投递状态。当前成片采用本地 Telegram 预览模式。真实 Bot 投递和实体 G2 麦克风待验证。

## 提交材料

| 交付物 | 检查结果 |
| --- | --- |
| [1080p 分屏成片](artifacts/pocketpulse-showcase-1080p.mp4) | 59 秒，1920×1080，24 fps，H.264，AAC 英文合成旁白。左侧为官方原生 HUD 最近邻放大，右侧为同步 WebView，底部为英文字幕。 |
| [原始 HUD 视频](artifacts/pocketpulse-demo.mp4) | 保留原文件，576×288，24 fps，18.08 秒。 |
| [实测证据](artifacts/showcase-evidence.json) | 记录拒单原因、拒单后 SQLite 成交数和放行后的 API 回执。逐章抽帧拼图位于 `.local/showcase-grid.png`。 |
| [DoraHacks 申报全案](SUBMISSION_PACK.md) | 双语摘要、英文申报字段、实现与风控说明、三条复现命令。 |
| [Even Hub 安装包](artifacts/pocketpulse.ehpk) | 从最新源码构建，官方 CLI 0.2.0，SDK 0.0.16。手机端安装需要配置可达后端。 |
| 独立 Git 仓库 | 本地 `main` 初始提交使用 `PocketPulse Team <dev@pocketpulse.local>`。源码采用 MIT 许可，环境文件、依赖、运行数据和临时数据库已排除。 |

`npm test` 12/12 通过。使用 `ffprobe` 验证编解码参数与时长，完整解码 1,416 帧并检查黑屏检测结果，逐章查看抽帧拼图中的字幕和 HUD / WebView 排版。运行结束后检查 API、模拟器及 Xvfb 进程均已退出。源码发布、DoraHacks 提交与 Even Hub 上传仍为待办。
