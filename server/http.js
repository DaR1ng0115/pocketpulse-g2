import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { createMarket } from './market.js'
import { createLedger, createTelegram, LIMITS, memo, PaperError, SIZE } from './paper.js'
import { transcribe } from './voice.js'

const root = resolve(process.env.POCKETPULSE_DATA || '.local')
const demoMode = process.env.DEMO_MODE === '1'
const market = createMarket({ directory: join(root, 'market'), demoMode })
await mkdir(root, { recursive: true })
const ledger = createLedger(join(root, 'paper.sqlite'))
const telegram = createTelegram(ledger, {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chat: process.env.TELEGRAM_CHAT_ID,
})
const voice = process.env.STT_URL
const allowedOrigin = process.env.POCKETPULSE_ORIGIN
const dist = resolve('dist')

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function body(request, max = 1024) {
  let length = 0
  const chunks = []
  for await (const chunk of request) {
    length += chunk.length
    if (length > max) throw new PaperError('Request too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function receiptPayload(receipt) {
  return { ...receipt, memo: memo(receipt) }
}

const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    const method = request.method
    const origin = request.headers.origin
    if (origin && origin === allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PocketPulse')
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.setHeader('Vary', 'Origin')
      if (method === 'OPTIONS') return response.writeHead(204).end()
    }
    if (method === 'GET' && path === '/api/health') {
      return send(response, 200, { mode: demoMode ? 'demo' : 'live', telegram: telegram.enabled ? 'bot' : 'mock' })
    }
    if (method === 'GET' && path === '/api/cards') {
      const cards = await market.cards()
      return send(response, 200, { cards, size: SIZE, limits: LIMITS, voice: Boolean(voice), telegram: telegram.enabled ? 'bot' : 'mock' })
    }
    if (method === 'GET' && /^\/api\/receipts\/[1-9]\d{0,12}$/.test(path)) {
      const receipt = ledger.get(Number(path.split('/').at(-1)))
      return receipt ? send(response, 200, receiptPayload(receipt)) : send(response, 404, { error: 'Receipt unavailable' })
    }
    if (method === 'POST' && (path === '/api/paper' || path === '/api/voice')) {
      if (request.headers['x-pocketpulse'] !== '1') return send(response, 403, { error: 'App header required' })
      if (path === '/api/voice') {
        if (!voice || request.headers['content-type'] !== 'audio/wav') return send(response, 415, { error: 'Voice unavailable' })
        const audio = await body(request, 320_044)
        return send(response, 200, { command: await transcribe(voice, audio) })
      }
      let input
      try { input = JSON.parse(await body(request)) } catch { throw new PaperError('Invalid confirmation') }
      const id = input?.quoteId
      if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) throw new PaperError('Invalid quote')
      const previous = ledger.find(id)
      if (previous) return send(response, 200, receiptPayload(previous))
      const quote = market.quote(id)
      if (!quote || Date.now() - quote.observedAt > LIMITS.maxAgeMs) {
        throw new PaperError('Quote expired', 'QUOTE_EXPIRED')
      }
      const current = (await market.cards({ fresh: true })).find(card => card.key === quote.key)
      const receipt = ledger.commit(quote, current, SIZE, Date.now(), telegram.destination)
      void telegram.drain()
      return send(response, 201, receiptPayload(receipt))
    }
    if (method === 'GET' && (path === '/' || /^\/assets\/[\w.-]+$/.test(path))) {
      const file = path === '/' ? 'index.html' : path.slice(1)
      const data = await readFile(join(dist, file)).catch(() => null)
      if (data) {
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
        response.writeHead(200, { 'Content-Type': (types[extname(file)] || 'application/octet-stream') + '; charset=utf-8' })
        return response.end(data)
      }
    }
    send(response, 404, { error: 'Not found' })
  } catch (error) {
    if (error instanceof PaperError) return send(response, 409, { error: error.message, code: error.code })
    console.error('Request failed', error.message)
    send(response, 500, { error: 'Service unavailable' })
  }
})

server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
  ledger.recover()
  void telegram.drain()
  console.log('PocketPulse listening', server.address(), demoMode ? 'DEMO' : 'LIVE')
})
