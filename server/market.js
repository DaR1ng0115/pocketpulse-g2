import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MINUTE = 60_000
const COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
const GAMMA = 'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=125&order=volume24hr&ascending=false'
const INFO = 'https://api.hyperliquid.xyz/info'
const CRYPTO = /\b(bitcoin|btc|ethereum|eth|solana|sol|hyperliquid|hype|crypto|dogecoin|doge|xrp)\b/i

function number(value) {
  return value != null && value !== '' ? Number(value) : NaN
}

function priced(bid, ask, upper = Infinity) {
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid && ask <= upper
}

export function polymarket(markets) {
  if (!Array.isArray(markets)) throw new Error('Invalid Gamma response')
  return markets.flatMap(market => {
    const bid = number(market.bestBid)
    const ask = number(market.bestAsk)
    const change = number(market.oneDayPriceChange)
    try {
      const outcomes = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : market.outcomes
      if (outcomes?.[0]?.toLowerCase() !== 'yes' || outcomes.length !== 2) return []
    } catch {
      return []
    }
    if (!priced(bid, ask, 1) || bid <= 0.01 || ask >= 0.99 || market.acceptingOrders === false ||
        !Number.isFinite(change) || !market.id || !CRYPTO.test(market.question ?? '')) return []
    return [{
      key: 'poly-' + market.id, venue: 'Polymarket', title: market.question,
      label: Math.abs(change) >= 0.10 ? 'Odds swing' : 'Odds move', metric: (change * 100).toFixed(1), unit: 'pp / 24h', mid: (bid + ask) / 2,
      bid, ask, side: 'BUY YES', score: Math.abs(change) * 10, flagged: Math.abs(change) >= 0.10,
    }]
  }).sort((a, b) => b.score - a.score).slice(0, 3)
}

export function hyperliquid(response, books) {
  const [meta, contexts] = response
  return COINS.flatMap(coin => {
    const index = meta.universe.findIndex(asset => asset.name === coin)
    const context = contexts[index]
    const rate = number(context?.funding)
    const mid = number(context?.midPx)
    const book = books[coin]
    const bid = number(book?.levels?.[0]?.[0]?.px)
    const ask = number(book?.levels?.[1]?.[0]?.px)
    if (!Number.isFinite(rate) || !Number.isFinite(mid) || mid <= 0) return []
    const hasBook = priced(bid, ask)
    return [{
      key: 'hl-' + coin, venue: 'Hyperliquid', title: coin + ' · Perp',
      label: Math.abs(rate) >= 0.00015 ? 'Funding spike' : 'Funding watch', metric: (rate * 10_000).toFixed(2), unit: 'bp / h', mid,
      bid: hasBook ? bid : null, ask: hasBook ? ask : null, side: rate >= 0 ? 'SELL' : 'BUY',
      score: Math.abs(rate) * 10_000, flagged: Math.abs(rate) >= 0.00015,
    }]
  }).sort((a, b) => b.score - a.score)
}

const demo = {
  hyper: [{
    key: 'hl-ETH', venue: 'Hyperliquid', title: 'ETH · Perp', label: 'Funding spike',
    metric: '+4.20', unit: 'bp / h', mid: 3200, bid: 3199.2, ask: 3200.8, side: 'SELL', flagged: true,
  }],
  poly: [{
    key: 'poly-demo', venue: 'Polymarket', title: 'Will BTC close above $100k?', label: 'Odds swing',
    metric: '+14.0', unit: 'pp / 24h', mid: 0.640, bid: 0.639, ask: 0.641, side: 'BUY YES', flagged: true,
  }],
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5500) })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.json()
}

const info = (type, fields = {}) => json(INFO, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, ...fields }),
})

async function readHyperliquid() {
  const [context, ...books] = await Promise.allSettled([
    info('metaAndAssetCtxs'), ...COINS.map(coin => info('l2Book', { coin })),
  ])
  if (context.status === 'rejected') throw context.reason
  return hyperliquid(context.value, Object.fromEntries(COINS.map((coin, i) => [coin, books[i].value])))
}

const publicProviders = {
  hyper: readHyperliquid,
  poly: async () => polymarket(await json(GAMMA + '&end_date_min=' + encodeURIComponent(new Date().toISOString()))),
}

export function createMarket({ directory, demoMode = false, now = Date.now, providers = publicProviders }) {
  const quotes = new Map()
  let latest
  let loadedAt = -Infinity
  let pending

  async function readProvider(key, loader) {
    const file = join(directory, key + '.json')
    try {
      const signals = await loader()
      if (!signals.length) throw new Error('No eligible markets')
      const snapshot = { source: 'LIVE', observedAt: now(), signals }
      try {
        await mkdir(directory, { recursive: true })
        await writeFile(file + '.tmp', JSON.stringify(snapshot))
        await rename(file + '.tmp', file)
      } catch (error) {
        console.error(key + ' cache write: ' + error.message)
      }
      return snapshot
    } catch (error) {
      console.error(key + ' upstream: ' + error.message)
      try {
        const cached = JSON.parse(await readFile(file, 'utf8'))
        if (Array.isArray(cached.signals) && Number.isFinite(cached.observedAt)) {
          return { ...cached, source: 'CACHE' }
        }
      } catch {}
      return { source: 'DEMO', observedAt: now(), signals: demo[key] }
    }
  }

  async function refresh() {
    const snapshots = await Promise.all(Object.entries(providers).map(([key, loader]) =>
      demoMode ? { source: 'DEMO', observedAt: now(), signals: demo[key] } : readProvider(key, loader)))
    const stamp = now()
    for (const [id, quote] of quotes) {
      if (quote.observedAt + 2 * MINUTE <= stamp) quotes.delete(id)
    }
    latest = snapshots.flatMap(({ source, observedAt, signals }) => signals.map(signal => {
      const id = createHash('sha256')
        .update([signal.key, source, observedAt, signal.bid, signal.ask].join('|')).digest('hex').slice(0, 24)
      const quote = { ...signal, id, source, observedAt }
      if (source !== 'CACHE') quotes.set(id, quote)
      return quote
    }))
    loadedAt = stamp
    return latest
  }

  return {
    async cards({ fresh = false } = {}) {
      if (!fresh && latest && now() - loadedAt < 25_000) return latest
      pending ??= refresh().finally(() => { pending = undefined })
      return pending
    },
    quote(id) { return quotes.get(id) },
  }
}
