import { AudioInputSource, OsEventTypeList as Event, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { deliveryLabel, frame, hudRows, receiptNumber } from './hud.js'
import { wav } from './voice.js'
import './style.css'

const root = document.querySelector('#app')
root.innerHTML = `
  <header><span class="brand">PocketPulse<span class="g2"> G2</span></span><span id="connection">Connecting</span></header>
  <section class="panel" aria-labelledby="market">
    <div class="eyebrow" id="market-source">Market radar</div>
    <h1 id="market">Loading market radar</h1>
    <p id="signal"></p>
    <dl class="metrics">
      <div><dt>Best bid</dt><dd id="bid">—</dd></div>
      <div><dt>Best ask</dt><dd id="ask">—</dd></div>
      <div><dt>Spread</dt><dd id="spread">—</dd></div>
    </dl>
  </section>
  <section class="display" aria-label="Glasses preview">
    ${hudRows.map(({name}) => `<div id="${name}" class="row"></div>`).join('')}
  </section>
  <nav aria-label="Touchpad controls">
    <button id="previous" aria-label="Previous market">↑</button>
    <button id="tap">Review</button>
    <button id="next" aria-label="Next market">↓</button>
    <button id="back">Back</button>
  </nav>
  <section id="rejection" class="panel rejected" aria-live="polite" hidden>
    <div class="eyebrow">Risk guard · Rejected</div><h2 id="reason"></h2>
    <p>No paper fill recorded. Return to radar and review a fresh quote.</p>
  </section>
  <section id="receipt-panel" class="panel" aria-live="polite" hidden>
    <div class="eyebrow">Paper ledger · SQLite</div><h2 id="receipt-title"></h2>
    <p id="fill"></p>
    <div class="memo"><div class="eyebrow" id="memo-title"></div><pre id="memo"></pre></div>
  </section>
  <section id="settings" class="panel">
    <div class="eyebrow">Paper execution settings</div>
    <p id="limits"></p>
    <p id="voice-setting"></p>
  </section>
`

const get = id => document.getElementById(id)
const apiBase = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
const state = { stage: 'radar', cards: [], index: 0, size: 25, voice: false }
let bridge
let hudReady = false
let rendering = false
let requestedFrame
let lastFrame = []
let lastTap = -Infinity
let mic
let refreshing = false
let foreground = true

async function api(path, options = {}) {
  const result = await fetch(apiBase + '/api/' + path, { ...options, signal: AbortSignal.timeout(15000) })
  const payload = await result.json()
  if (!result.ok) {
    const error = new Error(payload.error || 'Service unavailable')
    error.code = payload.code
    throw error
  }
  return payload
}

function selected() { return state.frozen ?? state.cards[state.index] }

function show() {
  const card = selected()
  const { receipt, stage, limits } = state
  const lines = frame({ ...state, card, count: state.cards.length })
  hudRows.forEach(({ name }, i) => { get(name).textContent = lines[i] })
  get('market-source').textContent = card ? `${card.venue} · ${card.source}` : 'Market radar'
  get('market').textContent = card?.title || 'Loading market radar'
  get('signal').textContent = card ? `${card.label} · ${card.metric} ${card.unit}` : ''
  get('bid').textContent = card?.bid ?? '—'
  get('ask').textContent = card?.ask ?? '—'
  get('spread').textContent = card?.bid != null && card.ask != null
    ? ((card.ask - card.bid) / ((card.bid + card.ask) / 2) * 10_000).toFixed(1) + ' bp' : '—'
  get('tap').textContent = ({ review: 'Confirm paper fill', receipt: 'Return to radar', blocked: 'Return to radar', writing: 'Checking quote…' })[stage] || 'Review $' + state.size
  get('tap').disabled = stage === 'writing' || (stage === 'radar' && (!card || card.source === 'CACHE' || card.bid == null || card.ask == null))
  get('rejection').hidden = stage !== 'blocked'
  get('reason').textContent = stage === 'blocked' ? state.notice : ''
  get('receipt-panel').hidden = stage !== 'receipt'
  get('settings').hidden = ['receipt', 'blocked'].includes(stage)
  if (receipt) {
    get('receipt-title').textContent = `Receipt #${receiptNumber(receipt.id)} · ${receipt.source} paper fill`
    get('fill').textContent = `${receipt.side} $${receipt.size} @ ${receipt.price} · ${receipt.slippageBps} bp slippage`
    get('memo-title').textContent = receipt.messageId ? `Telegram · Message #${receipt.messageId}` :
      `Memo #${receiptNumber(receipt.id)} · ${receipt.delivery === 'mock' ? 'Telegram preview · Local only' : deliveryLabel[receipt.delivery]}`
    get('memo').textContent = receipt.memo
  }
  get('limits').textContent = limits ? `${limits.slippageBps} bp max slippage · ${limits.maxAgeMs / 1000}s quote lifetime · $${limits.perDay} daily cap` : ''
  get('voice-setting').textContent = state.voice ? 'Voice enabled · Next, review, cancel' : 'Voice optional · Tap required for confirmation'
  requestedFrame = { lines, stage }
  if (hudReady && foreground) void renderGlasses()
}

async function renderGlasses() {
  if (rendering) return
  rendering = true
  try {
    while (requestedFrame && foreground) {
      const { lines, stage } = requestedFrame
      requestedFrame = undefined
      let changed = false
      for (const [index, row] of hudRows.entries()) {
        if (lines[index] === lastFrame[index]) continue
        const ok = await bridge.textContainerUpgrade({ containerID: index + 1, containerName: row.name, content: lines[index] || ' ' })
        if (!ok) throw new Error('Glasses update rejected for ' + row.name)
        lastFrame[index] = lines[index]
        changed = true
      }
      if (changed) console.info('[PocketPulse] HUD ' + stage + ' | ' + lines.join(' | '))
    }
  } catch (error) {
    console.error('[PocketPulse]', error.message)
  } finally {
    rendering = false
  }
}

async function refresh() {
  if (refreshing || !foreground) return
  refreshing = true
  try {
    const { cards, size, limits, voice, telegram } = await api('cards')
    const key = selected()?.key
    state.cards = cards
    state.index = Math.max(0, cards.findIndex(card => card.key === key))
    state.size = size
    state.limits = limits
    state.voice = voice
    get('connection').textContent = (hudReady ? 'Glasses connected' : 'Companion preview') +
      (telegram === 'bot' ? ' · Telegram bot' : ' · Local memo mode')
    if (state.notice === 'API unavailable') state.notice = ''
  } catch {
    if (!state.cards.length) state.notice = 'API unavailable'
  } finally {
    refreshing = false
    show()
  }
}

function radar() {
  state.stage = 'radar'
  state.frozen = undefined
  state.receipt = undefined
  state.notice = ''
  show()
}

function move(step) {
  if (state.stage !== 'radar' || !state.cards.length || (mic && !mic.stopping)) return
  state.index = (state.index + step + state.cards.length) % state.cards.length
  state.notice = ''
  show()
}

function review() {
  const card = selected()
  if (state.stage !== 'radar' || !card || card.source === 'CACHE' || card.ask == null || card.bid == null) return
  state.frozen = card
  state.notice = ''
  state.stage = 'review'
  show()
}

async function tap() {
  const now = performance.now()
  if (now - lastTap < 320 || !foreground || mic) return
  lastTap = now
  if (state.stage === 'radar') return review()
  if (state.stage === 'receipt' || state.stage === 'blocked') return radar()
  if (state.stage !== 'review') return
  state.stage = 'writing'
  show()
  try {
    state.receipt = await api('paper', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PocketPulse': '1' },
      body: JSON.stringify({ quoteId: state.frozen.id }),
    })
    state.stage = 'receipt'
    show()
    void pollDelivery(state.receipt.id)
  } catch (error) {
    state.stage = error.code ? 'blocked' : 'review'
    state.notice = error.message
    show()
    void refresh()
  }
}

async function pollDelivery(id) {
  for (let attempt = 0; attempt < 10 && state.receipt?.id === id; attempt++) {
    if (!['queued', 'sending'].includes(state.receipt.delivery)) return
    await new Promise(resolve => setTimeout(resolve, 1200))
    try {
      const receipt = await api('receipts/' + id)
      if (state.receipt?.id !== id) return
      state.receipt = receipt
      show()
    } catch {}
  }
}

function back() {
  if (['review', 'receipt', 'blocked'].includes(state.stage)) radar()
}

async function beginVoice() {
  if (!state.voice || !['radar', 'review'].includes(state.stage) || mic || !bridge || !foreground) return
  const recording = { chunks: [], length: 0 }
  mic = recording
  state.notice = 'Listening…'
  show()
  recording.start = bridge.audioControl(true, AudioInputSource.Glasses).catch(() => false)
  recording.timer = setTimeout(() => void endVoice(), 5000)
  if (!await recording.start && mic === recording) {
    clearTimeout(recording.timer)
    mic = undefined
    state.notice = 'Glasses mic unavailable'
    show()
  }
}

async function endVoice(discard = false) {
  const recording = mic
  if (!recording || recording.stopping) return
  recording.stopping = true
  clearTimeout(recording.timer)
  try {
    if (await recording.start) await bridge.audioControl(false)
    if (discard || !foreground) return
    if (!recording.length) throw new Error('No voice captured')
    state.notice = 'Recognizing…'
    show()
    const { command } = await api('voice', {
      method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-PocketPulse': '1' }, body: wav(recording.chunks),
    })
    if (!foreground) return
    state.notice = ''
    if (command === 'next') move(1)
    if (command === 'review') review()
    if (command === 'cancel') back()
    if (!command) state.notice = 'Say next, review or cancel'
  } catch (error) {
    state.notice = error.message
  } finally {
    mic = undefined
    show()
  }
}

function onEvent(event) {
  const audio = event.audioEvent?.audioPcm
  if (audio) {
    if (mic && !mic.stopping && mic.length + audio.length <= 160000) {
      mic.chunks.push(audio.slice())
      mic.length += audio.length
    }
    return
  }
  const type = event.textEvent?.eventType ?? event.sysEvent?.eventType
  if (type === Event.FOREGROUND_EXIT_EVENT || type === Event.SYSTEM_EXIT_EVENT) {
    foreground = false
    void endVoice(true)
    return
  }
  if (type === Event.FOREGROUND_ENTER_EVENT) {
    foreground = true
    show()
    void refresh()
    return
  }
  if (!foreground) return
  if (type === Event.CLICK_EVENT || (type === undefined && event.sysEvent?.eventSource != null)) void tap()
  if (type === Event.SCROLL_TOP_EVENT) move(-1)
  if (type === Event.SCROLL_BOTTOM_EVENT) move(1)
  if (type === Event.DOUBLE_CLICK_EVENT) back()
  if (type === Event.LONG_PRESS_EVENT) void beginVoice()
  if (type === Event.LONG_PRESS_RELEASE_EVENT) void endVoice()
}

async function connect() {
  bridge = await waitForEvenAppBridge()
  bridge.onEvenHubEvent(onEvent)
  const result = await bridge.createStartUpPageContainer({
    containerTotalNum: hudRows.length,
    textObject: hudRows.map((row, index) => ({
      xPosition: row.x, yPosition: row.y, width: 576 - 2 * row.x, height: 38,
      containerID: index + 1, containerName: row.name, isEventCapture: index === 1 ? 1 : 0,
      textColor: row.color, content: ' ',
    })),
  })
  // Linux simulator can reload its WebView while leaving the startup page mounted.
  if (result !== 0 && result !== 1) throw new Error('Glasses page creation failed: ' + result)
  hudReady = true
  root.classList.add('glasses-connected')
  show()
}
get('previous').onclick = () => move(-1)
get('next').onclick = () => move(1)
get('tap').onclick = () => void tap()
get('back').onclick = back
show()
void connect().catch(error => console.error('[PocketPulse]', error.message))
void refresh()
setInterval(() => void refresh(), 26000)
