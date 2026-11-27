import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wav } from '../src/voice.js'

test('voice HTTP self-test accepts browse, review and cancel and cannot write a paper receipt', { timeout: 8000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pocketpulse-voice-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const utterances = ['Next card.', 'Review paper.', 'Cancel.', 'Confirm trade.']
  const audio = wav([new Uint8Array(3200).fill(1)])
  const received = []
  const stub = createServer(async (request, response) => {
    try {
      const form = await new Request('http://127.0.0.1', {
        method: 'POST', headers: request.headers, body: request, duplex: 'half',
      }).formData()
      received.push({ language: form.get('language'), audio: Buffer.from(await form.get('file').arrayBuffer()) })
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ text: utterances.shift() }))
    } catch {
      response.writeHead(500).end()
    }
  })
  stub.listen(0, '127.0.0.1')
  t.after(() => new Promise(resolve => stub.close(resolve)))
  await once(stub, 'listening')

  const server = spawn(process.execPath, ['server/http.js'], {
    env: {
      ...process.env, HOST: '127.0.0.1', PORT: '0', DEMO_MODE: '1', POCKETPULSE_DATA: directory,
      TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', STT_KEY: '',
      STT_URL: 'http://127.0.0.1:' + stub.address().port,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const closed = once(server, 'close')
  t.after(async () => { server.kill(); await closed })
  let stdout = ''
  let api
  for await (const chunk of server.stdout) {
    stdout += chunk
    const port = stdout.match(/Listening.*port: (\d+)/i)?.[1]
    if (port) {
      api = 'http://127.0.0.1:' + port + '/api/'
      break
    }
  }
  assert.ok(api, stdout)
  for (const command of ['next', 'review', 'cancel', null]) {
    const reply = await fetch(api + 'voice', {
      method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-PocketPulse': '1' }, body: audio,
      signal: AbortSignal.timeout(1500),
    })
    assert.equal(reply.status, 200)
    assert.deepEqual(await reply.json(), { command })
  }
  assert.deepEqual(received, Array.from({ length: 4 }, () => ({ language: 'en', audio: Buffer.from(audio) })))
  assert.equal((await fetch(api + 'receipts/1')).status, 404)
})
