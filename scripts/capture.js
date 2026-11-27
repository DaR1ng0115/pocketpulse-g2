import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFile, rename } from 'node:fs/promises'
import { setTimeout as pause } from 'node:timers/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [simulator, app, mode, work] = process.argv.slice(2)
const fps = 24
const shot = '/api/screenshot/glasses'

async function request(base, path, options) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(5000), ...options })
  if (!response.ok) throw new Error(path + ' HTTP ' + response.status)
  return response
}

const get = path => request(simulator, path)
const log = async () => (await (await get('/api/console')).json()).entries
const press = action => request(simulator, '/api/input', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
})

async function waitHud(pattern, after = -1) {
  for (let n = 0; n < 100; n++) {
    const entries = await log()
    const match = entries.findLast(item => item.id > after && item.message.includes('[PocketPulse] HUD') && pattern.test(item.message))
    if (match) return match.id
    const error = entries.find(item => item.message.includes('Glasses update rejected'))
    if (error) throw new Error(error.message)
    await pause(150)
  }
  const recent = (await log()).slice(-8).map(entry => entry.message).join('\n')
  throw new Error('HUD did not show ' + pattern + '\n' + recent)
}

const png = async (path = shot) => Buffer.from(await (await get(path)).arrayBuffer())

function ffmpeg(args) {
  const process = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-threads', '2', ...args], {
    stdio: ['pipe', 'ignore', 'inherit'],
  })
  const done = once(process, 'close').then(([code]) => {
    if (code !== 0) throw new Error('ffmpeg exited with ' + code)
  })
  done.catch(() => {})
  process.stdin.on('error', () => {})
  return { process, done }
}

async function still(name) {
  // The native framebuffer animates after the SDK acknowledges an update.
  await pause(700)
  const input = join(work, name + '.raw.png')
  await writeFile(input, await png())
  const { process, done } = ffmpeg([
    '-f', 'lavfi', '-i', 'color=black:s=576x288', '-i', input, '-filter_complex', 'overlay',
    '-frames:v', '1', '-update', '1', join(work, name + '.png'),
  ])
  process.stdin.end()
  await done
}

async function record() {
  const { process, done } = ffmpeg([
    '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0',
    '-filter_complex', 'color=black:s=576x288:r=24[bg];[bg][0:v]overlay=shortest=1',
    '-c:v', 'libx264', '-threads', '2', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', join(work, 'pocketpulse-demo.mp4'),
  ])
  let running = true
  const loop = (async () => {
    const start = performance.now()
    let sent = 0
    while (running) {
      const image = await png()
      const expected = Math.floor((performance.now() - start) * fps / 1000) + 1
      for (; sent < expected; sent++) {
        if (!process.stdin.write(image)) {
          await Promise.race([once(process.stdin, 'drain'), done])
          if (process.stdin.destroyed) throw new Error('ffmpeg input closed')
        }
      }
      await pause(Math.max(0, start + sent * 1000 / fps - performance.now()))
    }
  })()
  loop.catch(() => {})
  return async () => {
    running = false
    try { await loop } finally { process.stdin.end() }
    await done
  }
}

async function publish(names) {
  for (const name of names) await rename(join(work, name), join('artifacts', name))
  console.log('Captured ' + names.join(', '))
}

async function showcase() {
  let last = await waitHud(/HYPERLIQUID  \/  LIVE/)
  const { cards, limits } = await (await request(app, '/api/cards')).json()
  const slippage = card => {
    const sign = card.side === 'SELL' ? -1 : 1
    const price = card.side === 'SELL' ? card.bid : card.ask
    return price == null ? Infinity : (price - card.mid) / card.mid * sign * 10_000
  }
  const wide = cards.findIndex(card => card.venue === 'Polymarket' && card.source === 'LIVE' &&
    Number.isFinite(slippage(card)) && slippage(card) > limits.slippageBps + 10)
  const liquid = cards.findIndex(card => ['hl-BTC', 'hl-ETH'].includes(card.key) && card.source === 'LIVE' && Math.abs(slippage(card)) < 10)
  if (wide < 0 || liquid < 0) throw new Error('Need a live wide Polymarket book and a liquid BTC or ETH book. Retry when both are available.')

  const stages = []
  let index = 0
  async function save(name) {
    // Wait for the official framebuffer to settle after its SDK transition.
    await pause(700)
    await writeFile(join(work, name + '.glasses.png'), await png())
    await writeFile(join(work, name + '.webview.png'), await png('/api/screenshot/webview'))
    stages.push(name)
  }
  async function navigate(target) {
    const count = cards.length
    const forward = (target - index + count) % count
    const step = forward <= count / 2 ? 1 : -1
    while (index !== target) {
      await press(step === 1 ? 'down' : 'up')
      index = (index + step + count) % count
      last = await waitHud(new RegExp(`HUD radar.* ·\\s+${index + 1}/${count} \\|`), last)
    }
  }
  const db = new DatabaseSync(join(work, 'paper.sqlite'), { readOnly: true })
  try {
    await save('hyperliquid')
    await navigate(wide)
    await save('polymarket')
    await press('click')
    last = await waitHud(/HUD review/, last)
    await save('wide-review')
    await press('click')
    last = await waitHud(/HUD blocked.*BLOCKED: Slippage \d+(?:\.\d+)?bp > 50bp cap/, last)
    const rejection = (await log()).find(entry => entry.id === last).message.match(/BLOCKED: ([^|]+) \|/)[1]
    await save('blocked')
    const rejectedCount = db.prepare('SELECT count(*) AS count FROM fills').get().count
    if (rejectedCount !== 0) throw new Error('A rejected confirmation wrote a fill')

    await press('click')
    last = await waitHud(/HUD radar.*POLYMARKET  \/  LIVE/, last)
    await navigate(liquid)
    await save('liquid')
    await press('click')
    last = await waitHud(/HUD review/, last)
    await save('paper-review')
    await press('click')
    await waitHud(/Paper fill #001.*Memo #001.*memo saved locally/, last)
    await save('receipt')

    const receipt = await (await request(app, '/api/receipts/1')).json()
    const rows = db.prepare('SELECT id, quote_id, size, receipt, delivery FROM fills').all()
    if (rows.length !== 1 || rows[0].id !== receipt.id || rows[0].quote_id !== receipt.quoteId ||
        rows[0].size !== 25 || JSON.parse(rows[0].receipt).price !== receipt.price || rows[0].delivery !== 'mock' ||
        receipt.source !== 'LIVE' || !receipt.memo.includes('PAPER #001')) throw new Error('SQLite, API and memo receipts differ')
    await writeFile(join(work, 'showcase.json'), JSON.stringify({
      stages, rejection, rejectedCount, receipt,
    }, null, 2) + '\n')
  } finally {
    db.close()
  }
}

if (mode === 'showcase') {
  await showcase()
} else if (mode === 'live') {
  const feed = await (await request(app, '/api/cards')).json()
  for (const venue of ['Hyperliquid', 'Polymarket']) {
    if (!feed.cards.some(card => card.venue === venue && card.source === 'LIVE')) throw new Error(venue + ' unavailable live')
  }
  let last = await waitHud(/HYPERLIQUID  \/  LIVE/)
  await still('live-hyperliquid')
  for (const card of feed.cards.filter(card => card.venue === 'Hyperliquid')) {
    await press('down')
    last = await waitHud(/HUD radar/, last)
  }
  await waitHud(/POLYMARKET  \/  LIVE/)
  await still('live-polymarket')
  await press('up')
  last = await waitHud(/HYPERLIQUID  \/  LIVE/, last)
  await press('click')
  last = await waitHud(/LIVE PAPER  \/  REVIEW/, last)
  await pause(850)
  await press('click')
  await waitHud(/Paper fill #001.*memo saved locally/, last)
  await still('live-paper-receipt')
  const receipt = await (await request(app, '/api/receipts/1')).json()
  if (receipt.delivery !== 'mock' || receipt.source !== 'LIVE') throw new Error('Unexpected live paper receipt')
  await writeFile(join(work, 'live-paper-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
  await publish(['live-hyperliquid.png', 'live-polymarket.png', 'live-paper-receipt.png', 'live-paper-receipt.json'])
} else {
  let last = await waitHud(/HYPERLIQUID  \/  DEMO/)
  await pause(700)
  const stop = await record()
  try {
    await still('hud-01-radar')
    await pause(2800)
    await press('down')
    last = await waitHud(/POLYMARKET  \/  DEMO/, last)
    await still('hud-02-polymarket')
    await pause(2800)
    await press('up')
    last = await waitHud(/HYPERLIQUID  \/  DEMO/, last)
    await pause(1300)
    await press('click')
    last = await waitHud(/DEMO PAPER  \/  REVIEW/, last)
    await still('hud-03-review')
    await pause(3000)
    await press('click')
    await waitHud(/Paper fill #001.*memo saved locally/, last)
    await still('hud-04-receipt')
    const receipt = await (await request(app, '/api/receipts/1')).json()
    if (receipt.delivery !== 'mock' || receipt.source !== 'DEMO' || !receipt.memo.includes('PAPER #001')) {
      throw new Error('Paper receipt did not match simulator')
    }
    await writeFile(join(work, 'paper-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
    await pause(4200)
  } finally {
    await stop()
  }
  await publish(['hud-01-radar.png', 'hud-02-polymarket.png', 'hud-03-review.png', 'hud-04-receipt.png',
    'paper-receipt.json', 'pocketpulse-demo.mp4'])
}
await writeFile(join(work, 'webview.png'), Buffer.from(await (await get('/api/screenshot/webview')).arrayBuffer()))
