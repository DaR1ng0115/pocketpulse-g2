export function wav(chunks) {
  const length = chunks.reduce((size, chunk) => size + chunk.length, 0)
  const result = new Uint8Array(44 + length)
  const view = new DataView(result.buffer)
  const text = (offset, value) => result.set(new TextEncoder().encode(value), offset)
  text(0, 'RIFF')
  view.setUint32(4, 36 + length, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, length, true)
  let offset = 44
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
