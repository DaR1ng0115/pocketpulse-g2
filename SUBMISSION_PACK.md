# PocketPulse G2 · DoraHacks submission pack

## 双语摘要 · Bilingual overview

**中文**

PocketPulse G2 是给盯盘交易员用的眼镜端行情雷达。滑动浏览 Hyperliquid 永续资金费率、买卖首档，以及 Polymarket 的 24 小时 YES 赔率变化。第一次点按复核 $25 纸单，第二次点按由服务端刷新报价并校验风险。宽盘口拒单的原因直接显示在眼镜上。合规成交原子写入 SQLite，眼镜与手机端显示同一个回执编号，复盘卡片可通过配置好的 Telegram Bot 投递。

**English**

PocketPulse G2 is a glanceable market radar for traders. Swipe through Hyperliquid funding and Polymarket odds changes, review a $25 paper order, and confirm with a second tap. The server rechecks the market, shows clear rejection reasons on the glasses, and saves an accepted paper fill and its numbered Telegram recap.

## Official submission fields

| Field | Paste-ready value |
| --- | --- |
| Project Name | PocketPulse G2 |
| One-line Pitch | Glance at live funding and odds on Even G2, confirm a risk-checked paper order, and take the same numbered recap into Telegram. |
| Primary Track | Track 02: Crypto & DeFi |
| Secondary Track | Track 01: Messaging & News |
| Bounty | Best Telegram Integration |

### Problem

Traders scanning funding and prediction odds switch between charts, order books, and chat. A short funding spike or odds move can call for a quick decision, yet the context and rationale often get lost between the signal, the order review, and the post-trade note.

### Solution

PocketPulse puts one market signal and its action on the Even G2 HUD. Swipe to compare Hyperliquid perpetual funding and top-of-book prices with Polymarket's 24-hour YES odds changes. A tap opens a fixed $25 paper order. The second tap rechecks the quote on the server. The HUD shows a precise reason when the check fails. For an accepted paper fill, the HUD and the companion WebView display the execution price and numbered recap.

### Read + Write Closed Loop Architecture

1. The Node.js backend reads Hyperliquid Info and Polymarket Gamma, normalizes market signals, and labels snapshots LIVE, CACHE, or DEMO. The Even Hub SDK maps them to native G2 text containers and touch events.
2. The app freezes the reviewed quote ID. A second tap submits that ID to a paper-only endpoint. The server fetches current quotes and compares the executable side with the reviewed midpoint.
3. An accepted fill and its memo data are committed to SQLite in one transaction. A unique quote ID makes confirmation retries idempotent. The server formats the stored fill as a Telegram recap.
4. With a bot and destination configured, the outbox calls Telegram's Bot API and records the returned message ID. In the submitted capture, the local preview shows the exact Bot message text and the matching ledger number. The HUD reports the delivery state.

### Even G2 576×288 Display UX Design Principles

- Use one signal per screen and four stable text rows for provenance, the main decision, price or reason, and the next action.
- Keep extended market questions, settings, and memo details in the companion view. The HUD uses short labels and distinct review, blocked, and receipt screens.
- Map swipes to navigation, one tap to review, and a second tap to confirmation. Double tap cancels the review.
- Optional English voice supports “next,” “review,” and “cancel.” Confirmation requires a touch. The included WAV-to-command self-test verifies the constrained grammar.

### Safety Guardrails

- The server compares the newest available best ask for buys or best bid for sells with the reviewed midpoint. It rejects adverse slippage above 50 basis points, stale quotes beyond 60 seconds, and unavailable quotes.
- Cached cards are read-only. Orders are fixed at $25 in the app, with a $100 per-order ceiling and a $500 UTC daily ceiling enforced by the ledger.
- A rejection writes zero fills. An accepted confirmation creates one receipt across retries. The service handles paper fills using public top-of-book data and holds no exchange credentials.
- The backend holds Telegram credentials. An ambiguous Bot API result is marked unverified to prevent duplicate delivery.

### Commercial Potential

Small trading desks and active market watchers can use the same wearable workflow to capture time-sensitive signals and standardize their review notes. The numbered Telegram recap gives the operator a searchable trail tied to the original decision.

### How to Reproduce in 3 Commands

Prerequisites on Linux or WSL2 are Node.js 22.13+, npm, WebKitGTK 4.1, Xvfb, xauth, curl, Python 3 with Pillow and DejaVu fonts, and FFmpeg with libx264 and libflite. The live capture needs network access and a wide Polymarket book alongside a liquid BTC or ETH perpetual book.

```sh
npm ci
npm test
npm run capture -- showcase
```

The third command starts the API and the official Even Hub simulator, performs the touch sequence, verifies zero rows after rejection and one row after the accepted fill, then renders the 1080p showcase. Telegram defaults to local preview. Bot configuration and EHPK packing are documented in the README. [README](README.md)

### Demo and source assets

| Submission item | File |
| --- | --- |
| Primary demo video | [59-second 1080p showcase](artifacts/pocketpulse-showcase-1080p.mp4) |
| Native glasses recording | [576×288 HUD video](artifacts/pocketpulse-demo.mp4) |
| Evidence | [Live rejection and paper receipt](artifacts/showcase-evidence.json) |
| Installation package | [Even Hub EHPK](artifacts/pocketpulse.ehpk) |
| Source repository | Paste the public repository URL after publishing the local Git repository. |
