# PocketPulse G2

PocketPulse helps someone monitoring crypto markets during an active session see one funding or odds change on their Even G2. Swipe between cards. Tap to review a $25 paper order and tap again to record it. The glasses show the receipt and Telegram delivery status, and the companion view shows the complete memo.

**Heads Up Hackathon** · Main track 02 Crypto & DeFi · Second track 01 Messaging & News · Best Telegram Integration. The project originated during the November 2026 hackathon. The Even Hub SDK, official tooling and upstream APIs predate the project. [DoraHacks rules](https://dorahacks.io/hackathon/even-realities/detail#submission-and-rules)

[1080p showcase](artifacts/pocketpulse-showcase-1080p.mp4) · [Native HUD recording](artifacts/pocketpulse-demo.mp4) · [Submission pack](SUBMISSION_PACK.md)

## Run locally

Use Node.js 22.13+ and npm. On Ubuntu or WSL2, install the simulator and capture libraries.

```sh
sudo apt-get install libwebkit2gtk-4.1-0 xvfb xauth ffmpeg curl
npm ci
npm test
npm run build
npm run api
```

The API process serves the companion app at `http://127.0.0.1:8787`. In another terminal, launch the official simulator.

```sh
mkdir -p .local
npx evenhub-simulator http://127.0.0.1:8787 --config .local/sim.toml --automation-port 9898
```

For active frontend development, run `npm run dev` while the API runs. `npm run sim` opens the Vite URL. A regular browser can use the companion controls.

| Input | Action |
| --- | --- |
| Swipe up/down | Previous or next signal |
| Tap | Review, confirm, or return from a receipt or rejection |
| Double tap | Cancel review or return from a receipt |
| Hold and release | Speak “next”, “review”, or “cancel” when speech is configured |

## Market data and paper execution

- Hyperliquid public Info API supplies perpetual funding and top-of-book prices for BTC, ETH, SOL and HYPE. The HUD calls absolute funding of at least 1.5 bp/h a spike.
- Polymarket Gamma supplies 24-hour swings in YES odds for active binary crypto markets. The HUD calls changes of at least 10 percentage points a swing. The top three are ranked by absolute move within the sampled markets.
- Each provider refreshes independently into a disk cache. The server coalesces reads within 25 seconds. A failed provider falls back to its last good snapshot with a read-only `CACHE` label. When no cache exists, the HUD shows a labeled synthetic `DEMO` card. Set `DEMO_MODE=1` before startup for the reproducible two-card exercise.
- On confirmation the server fetches new quotes and compares the best ask for buys or best bid for sells against the reviewed midpoint. It enforces a $100 per-order cap, a $500 daily UTC cap, a 60-second quote lifetime and a 50 bp adverse slippage cap. The glasses and companion show the rejection reason and the fill count stays at zero for a rejected quote. One quote produces one receipt across retries. Fills estimate execution from top-of-book snapshots.
- SQLite stores receipts and memo delivery state under `.local/`. Set `POCKETPULSE_DATA` to give each user or scenario a separate store. Run one API process per store.

Sources [Hyperliquid Info](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) · [Polymarket Gamma](https://docs.polymarket.com/api-reference/markets/list-markets)

## Telegram and voice

The default mode keeps the memo beside the paper receipt in SQLite. For a real Telegram delivery, create a bot, start it in the intended chat or add it with posting permissions, and supply `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as backend environment variables. A subsequent manual confirmation queues a Bot API `sendMessage` to that chat. The HUD updates when the Bot API returns a message ID. An ambiguous network interruption is recorded as unverified to prevent duplicate posts. Use this setup with a dedicated private test chat. [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage)

For voice, configure a trusted OpenAI-compatible transcription endpoint in `STT_URL`, and supply `STT_MODEL` or `STT_KEY` as required by that service. Holding the touchpad opens the glasses microphone for up to five seconds. On release the backend forwards a 16 kHz WAV to the configured endpoint. A short command can browse, open a review, or cancel it. A paper fill still needs a tap on the review card. Run `node --test test/voice.test.js` to check the WAV upload and command grammar against a local transcription stub. Physical microphone input is pending device verification. [Even Hub SDK](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)

## Capture and package

```sh
npm run capture
npm run capture -- live
npm run capture -- showcase
npm run pack
```

The capture modes use Xvfb and the official simulator's input and screenshot APIs. The default run records the deterministic 24 fps native demo and saves four HUD stills plus a paper receipt. The live run checks both providers and captures the live-to-paper flow. The showcase run finds a live Polymarket book above the slippage cap and a liquid BTC or ETH perpetual book. It confirms both on the simulated touchpad, checks the live SQLite journal for zero and then one fill, and composes paired glasses and WebView screenshots with English captions and narration. Each run uses a fresh SQLite store and generates local memo previews. [Official simulator automation API](https://www.npmjs.com/package/@evenrealities/evenhub-simulator)

The showcase renderer also needs Pillow, DejaVu fonts, and FFmpeg with libflite and libx264. On Ubuntu use `sudo apt-get install python3-pil fonts-dejavu-core`. For a virtual environment set `SHOWCASE_PYTHON` to its Python executable. The video and JSON evidence go to `artifacts/`. The paired raw captures and the review grid stay under `.local/`. The showcase command preserves the native demo video.

The local `.ehpk` verifies packaging with the official CLI. For a phone-hosted install, provide a reachable backend and build with `VITE_API_BASE` set to its HTTPS origin, update the manifest network whitelist to match, and set `POCKETPULSE_ORIGIN` to the app's actual WebView origin if it is cross-origin. Keep this single-operator backend loopback-only for local use. Add operator authentication at the hosting layer if it will be reachable by other users. [Even Hub CLI](https://hub.evenrealities.com/docs/cli/)
