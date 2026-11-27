import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export const LIMITS = { perOrder: 100, perDay: 500, slippageBps: 50, maxAgeMs: 60_000 }
export const SIZE = 25

export class PaperError extends Error {
  constructor(message, code = 'PAPER_REJECTED') {
    super(message)
    this.code = code
  }
}

export function paperFill(quote, current, size, now) {
  if (!Number.isFinite(size) || size <= 0 || size > LIMITS.perOrder) throw new PaperError('Order limit exceeded')
  const fresh = card => card && now >= card.observedAt && now - card.observedAt <= LIMITS.maxAgeMs
  if (!fresh(quote) || !fresh(current) || quote.source === 'CACHE' || current.source !== quote.source ||
      current.key !== quote.key || current.side !== quote.side) throw new PaperError('Quote expired', 'QUOTE_EXPIRED')
  const price = current.side === 'SELL' ? current.bid : current.ask
  if (![price, quote.mid, current.bid, current.ask].every(item => Number.isFinite(item) && item > 0) ||
      current.ask < current.bid) throw new PaperError('Market quote unavailable')
  const move = (price - quote.mid) / quote.mid * (current.side === 'SELL' ? -1 : 1)
  const slip = Math.max(0, move) * 10_000
  if (slip > LIMITS.slippageBps + 1e-8) {
    // Round a rejection up so the HUD never displays a value at or below the cap.
    const displayed = Math.ceil((slip - 1e-8) * 100) / 100
    throw new PaperError(`Slippage ${displayed}bp > ${LIMITS.slippageBps}bp cap`, 'SLIPPAGE_LIMIT')
  }
  return { price, units: size / price, slippageBps: Math.round(slip * 100) / 100 }
}

export function createLedger(path) {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS fills (
      id INTEGER PRIMARY KEY,
      quote_id TEXT UNIQUE NOT NULL,
      day TEXT NOT NULL,
      size REAL NOT NULL,
      receipt TEXT NOT NULL,
      delivery TEXT NOT NULL,
      message_id TEXT,
      destination TEXT
    );
  `)
  if (!db.prepare('PRAGMA table_info(fills)').all().some(column => column.name === 'destination')) {
    db.exec('ALTER TABLE fills ADD COLUMN destination TEXT')
  }
  const byId = db.prepare('SELECT * FROM fills WHERE id = ?')
  const byQuote = db.prepare('SELECT * FROM fills WHERE quote_id = ?')
  const sum = db.prepare('SELECT coalesce(sum(size), 0) AS total FROM fills WHERE day = ?')
  const insert = db.prepare('INSERT INTO fills(quote_id, day, size, receipt, delivery, destination) VALUES (?, ?, ?, ?, ?, ?)')
  const pending = db.prepare("SELECT * FROM fills WHERE delivery = 'queued' AND destination = ? ORDER BY id LIMIT 1")
  const claim = db.prepare("UPDATE fills SET delivery = 'sending' WHERE id = ? AND delivery = 'queued'")
  const finish = db.prepare("UPDATE fills SET delivery = ?, message_id = ? WHERE id = ? AND delivery = 'sending'")
  const get = row => row && { ...JSON.parse(row.receipt), id: row.id, delivery: row.delivery, messageId: row.message_id }

  return {
    get(id) { return get(byId.get(id)) },
    find(quoteId) { return get(byQuote.get(quoteId)) },
    commit(quote, current, size, now, destination = null) {
      db.exec('BEGIN IMMEDIATE')
      try {
        let receipt = get(byQuote.get(quote.id))
        if (!receipt) {
          const fill = paperFill(quote, current, size, now)
          const createdAt = new Date(now).toISOString()
          const day = createdAt.slice(0, 10)
          if (sum.get(day).total + size > LIMITS.perDay) throw new PaperError('Daily paper limit reached')
          const data = {
            ...fill, createdAt, size, quoteId: quote.id, source: quote.source,
            venue: quote.venue, title: quote.title, side: quote.side,
            signal: [quote.label, quote.metric, quote.unit].join(' '),
          }
          const result = insert.run(quote.id, day, size, JSON.stringify(data), destination ? 'queued' : 'mock', destination || null)
          receipt = get(byId.get(result.lastInsertRowid))
        }
        db.exec('COMMIT')
        return receipt
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    claim(destination) {
      const row = pending.get(destination)
      return row && claim.run(row.id).changes ? get(byId.get(row.id)) : undefined
    },
    finish(id, status, messageId = null) { finish.run(status, messageId, id) },
    recover() { db.exec("UPDATE fills SET delivery = 'unknown' WHERE delivery = 'sending' OR (delivery = 'queued' AND destination IS NULL)") },
    close() { db.close() },
  }
}

export function memo(receipt) {
  return [
    `PocketPulse G2 • PAPER #${String(receipt.id).padStart(3, '0')} • ${receipt.source}`,
    `${receipt.venue} · ${receipt.title}`,
    receipt.signal,
    `${receipt.side} $${receipt.size} @ ${receipt.price} · Slip ${receipt.slippageBps} bp`,
    receipt.createdAt,
  ].join('\n')
}

export function createTelegram(ledger, { token, chat, send = fetch }) {
  const destination = token && chat ? createHash('sha256').update(chat).digest('hex') : null
  let busy = false
  return {
    enabled: Boolean(destination),
    destination,
    async drain() {
      if (!destination || busy) return
      busy = true
      try {
        for (let receipt; (receipt = ledger.claim(destination));) {
          try {
            const response = await send('https://api.telegram.org/bot' + token + '/sendMessage', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chat, text: memo(receipt) }), signal: AbortSignal.timeout(5000),
            })
            const result = await response.json()
            if (response.ok && result.ok && Number.isInteger(result.result?.message_id)) {
              ledger.finish(receipt.id, 'sent', String(result.result.message_id))
            } else {
              ledger.finish(receipt.id, result.ok === false && response.status < 500 ? 'failed' : 'unknown')
            }
          } catch {
            ledger.finish(receipt.id, 'unknown')
          }
        }
      } finally {
        busy = false
      }
    },
  }
}
