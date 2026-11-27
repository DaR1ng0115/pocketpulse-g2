import { PaperError } from './paper.js'

export function parseCommand(text) {
  const words = String(text ?? '').trim().toLowerCase().replace(/[.!?]+$/, '')
  const commands = new Map([['next', 'next'], ['next card', 'next'], ['review', 'review'], ['review paper', 'review'], ['cancel', 'cancel']])
  return commands.get(words) ?? null
}

export async function transcribe(url, audio) {
  if (audio.length <= 44 || audio.toString('ascii', 0, 4) !== 'RIFF' ||
      audio.toString('ascii', 8, 12) !== 'WAVE') throw new PaperError('No voice captured')
  const form = new FormData()
  form.set('file', new Blob([audio], { type: 'audio/wav' }), 'command.wav')
  form.set('model', process.env.STT_MODEL || 'whisper-1')
  form.set('language', 'en')
  const headers = process.env.STT_KEY ? { Authorization: 'Bearer ' + process.env.STT_KEY } : {}
  const response = await fetch(url, { method: 'POST', body: form, headers, signal: AbortSignal.timeout(9000) })
  if (!response.ok) throw new PaperError('Voice service unavailable')
  return parseCommand((await response.json()).text)
}
