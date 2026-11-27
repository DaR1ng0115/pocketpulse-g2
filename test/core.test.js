import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMarket, hyperliquid, polymarket } from '../server/market.js'
import { createLedger, createTelegram, memo, paperFill } from '../server/paper.js'
import { parseCommand } from '../server/voice.js'
import { wav } from '../src/voice.js'
import { frame } from '../src/hud.js'

const now = Date.parse('2026-11-25T00:00:00Z')
const quote = {
  id: 'test-quote', key: 'hl-ETH', source: 'LIVE', observedAt: now,
  mid: 100, bid: 99.99, ask: 100.01, side: 'SELL', venue: 'Hyperliquid',
  title: 'ETH · Perp', label: 'Funding spike', metric: '+4.20', unit: 'bp / h',
}

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pocketpulse-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('Gamma normalizes binary crypto odds and excludes irrelevant, malformed and reversed outcomes', () => {
  const row = { id: 4, question: 'Will BTC hit $100k?', outcomes: '["Yes","No"]', bestBid: 0.642, bestAsk: 0.648, oneDayPriceChange: 0.14 }
  const output = polymarket([row, { ...row, question: 'Will it rain?' }, { ...row, outcomes: 'broken' },
    { ...row, outcomes: ['No', 'Yes'] }, { ...row, bestAsk: 0.50 }])
  assert.equal(output.length, 1)
  assert.equal(output[0].side, 'BUY YES')
  assert.equal(output[0].metric, '14.0')
  assert.equal(output[0].flagged, true)
})

test('Hyperliquid joins contexts by universe index and keeps missing books read-only', () => {
  const context = [{ universe: [{ name: 'ETH' }, { name: 'BTC' }] }, [
    { midPx: '2000', funding: '-0.0003' }, { midPx: '60000', funding: '0.00001' },
  ]]
  const [eth, btc] = hyperliquid(context, { ETH: { levels: [[{ px: '1999' }], [{ px: '2001' }]] } })
  assert.equal(eth.key, 'hl-ETH')
  assert.equal(eth.side, 'BUY')
  assert.equal(eth.metric, '-3.00')
  assert.equal(eth.bid, 1999)
  assert.equal(btc.ask, null)
  assert.equal(btc.flagged, false)
})

test('per-provider cache persists and fallback distinguishes CACHE from synthetic DEMO', async t => {
  const directory = await workspace(t)
  const good = async () => [quote]
  const broken = async () => { throw new Error('simulated offline feed') }
  const first = createMarket({ directory, now: () => now, providers: { hyper: good, poly: broken } })
  const [live, demo] = await first.cards()
  assert.equal(live.source, 'LIVE')
  assert.equal(demo.source, 'DEMO')
  assert.equal(first.quote(live.id).key, quote.key)
  const second = createMarket({ directory, now: () => now + 100_000, providers: { hyper: broken, poly: broken } })
  const [cached, fallback] = await second.cards()
  assert.equal(cached.source, 'CACHE')
  assert.equal(cached.observedAt, now)
  assert.equal(second.quote(cached.id), undefined)
  assert.equal(fallback.source, 'DEMO')
})

test('paper fill uses adverse-side quote and rejects stale, changed, missing, oversized or slipping quotes', () => {
  const fill = paperFill(quote, quote, 25, now)
  assert.equal(fill.price, 99.99)
  assert.equal(fill.slippageBps, 1)
  for (const changed of [
    { bid: 99.49 }, { bid: null }, { source: 'CACHE' }, { side: 'BUY' }, { key: 'other' }, { observedAt: now - 60001 },
  ]) assert.throws(() => paperFill(quote, { ...quote, ...changed }, 25, now))
  assert.throws(() => paperFill(quote, quote, 101, now), /limit/)
  const buy = { ...quote, side: 'BUY' }
  assert.equal(paperFill(buy, buy, 25, now).price, 100.01)
})

test('ledger deduplicates by quote, persists its cap and gives the next UTC day a fresh limit', async t => {
  const file = join(await workspace(t), 'paper.sqlite')
  const ledger = createLedger(file)
  for (let i = 0; i < 5; i++) {
    const card = { ...quote, id: 'q' + i }
    assert.equal(ledger.commit(card, card, 100, now, false).delivery, 'mock')
  }
  assert.equal(ledger.commit({ ...quote, id: 'q0' }, null, 25, now, false).size, 100)
  ledger.close()
  const reopened = createLedger(file)
  t.after(() => reopened.close())
  assert.throws(() => reopened.commit(quote, quote, 25, now, false), /Daily/)
  const tomorrow = now + 86400000
  const nextQuote = { ...quote, observedAt: tomorrow }
  assert.equal(reopened.commit(nextQuote, nextQuote, 25, tomorrow, false).id, 6)
})

test('Telegram outbox sends one structured memo and records a verified message ID', async t => {
  const ledger = createLedger(join(await workspace(t), 'paper.sqlite'))
  t.after(() => ledger.close())
  let receipt
  let calls = 0
  const telegram = createTelegram(ledger, { token: 'fake-token', chat: '-1001', send: async (url, options) => {
    calls++
    assert.match(url, /\/sendMessage$/)
    assert.deepEqual(JSON.parse(options.body), { chat_id: '-1001', text: memo(receipt) })
    return new Response(JSON.stringify({ ok: true, result: { message_id: 48 } }))
  } })
  receipt = ledger.commit(quote, quote, 25, now, telegram.destination)
  const other = createTelegram(ledger, { token: 'fake-token', chat: '-1002', send: () => assert.fail('Wrong chat') })
  await other.drain()
  assert.equal(ledger.get(receipt.id).delivery, 'queued')
  await Promise.all([telegram.drain(), telegram.drain()])
  assert.equal(calls, 1)
  assert.equal(ledger.get(receipt.id).delivery, 'sent')
  assert.equal(ledger.get(receipt.id).messageId, '48')
})

test('interrupted Telegram delivery stays unverified and does not send twice', async t => {
  const ledger = createLedger(join(await workspace(t), 'paper.sqlite'))
  t.after(() => ledger.close())
  const destination = 'test-destination'
  const first = ledger.commit(quote, quote, 25, now, destination)
  assert.equal(ledger.claim(destination).id, first.id)
  ledger.recover()
  assert.equal(ledger.get(first.id).delivery, 'unknown')
  assert.equal(ledger.claim(destination), undefined)
})

test('HUD preserves provenance and receiving status without suggesting cached execution', () => {
  const card = { ...quote, source: 'CACHE' }
  const radar = frame({ card, stage: 'radar', index: 0, count: 1 })
  assert.match(radar[0], /CACHE/)
  assert.match(radar[3], /Read only/)
  assert.match(frame({ stage: 'receipt', receipt: { ...quote, source: 'DEMO', id: 1, size: 25, delivery: 'mock' } })[3], /locally/)
})

test('voice accepts a small command grammar and PCM produces a 16 kHz WAV', () => {
  assert.equal(parseCommand('Review paper.'), 'review')
  assert.equal(parseCommand('confirm trade'), null)
  assert.equal(parseCommand('constructor'), null)
  const data = Buffer.from(wav([Uint8Array.of(1, 2), Uint8Array.of(3, 4)]))
  assert.equal(data.toString('ascii', 0, 4), 'RIFF')
  assert.equal(data.readUInt32LE(24), 16000)
  assert.equal(data.readUInt32LE(40), 4)
  assert.deepEqual([...data.subarray(44)], [1, 2, 3, 4])
})

test('wide and expired quotes produce precise HUD reasons and leave the ledger empty', async t => {
  const ledger = createLedger(join(await workspace(t), 'paper.sqlite'))
  t.after(() => ledger.close())
  const cases = [
    [{ ...quote, bid: 99.16 }, 'SLIPPAGE_LIMIT', 'Slippage 84bp > 50bp cap'],
    [{ ...quote, observedAt: now - 60_001 }, 'QUOTE_EXPIRED', 'Quote expired'],
  ]
  for (const [current, code, notice] of cases) {
    assert.throws(() => ledger.commit(quote, current, 25, now), { code, message: notice })
    assert.deepEqual(frame({ stage: 'blocked', notice }).slice(1, 3),
      ['BLOCKED: ' + notice, 'No paper fill recorded'])
    assert.equal(ledger.get(1), undefined)
  }
  assert.equal(ledger.commit(quote, quote, 25, now).id, 1)
})

test('confirmation can refresh through a cached browse snapshot', async t => {
  let reads = 0
  const read = async () => [{ ...quote, bid: 100 - (++reads / 100) }]
  const market = createMarket({ directory: await workspace(t), now: () => now, providers: { hyper: read } })
  const [initial] = await market.cards()
  assert.equal((await market.cards())[0].id, initial.id)
  const [current] = await market.cards({ fresh: true })
  assert.notEqual(current.id, initial.id)
  assert.equal(market.quote(initial.id).bid, 99.99)
  assert.equal(current.bid, 99.98)
})
