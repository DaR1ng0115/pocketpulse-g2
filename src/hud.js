export const hudRows = [
  { name: 'source', x: 36, y: 35, color: 2 },
  { name: 'headline', x: 36, y: 89, color: 4 },
  { name: 'detail', x: 36, y: 132, color: 4 },
  { name: 'action', x: 36, y: 224, color: 3 },
]

const trim = (text, limit) => text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…'
const signed = value => Number(value) > 0 && !String(value).startsWith('+') ? '+' + value : value

export const deliveryLabel = {
  mock: 'Telegram memo saved locally',
  queued: 'Telegram queued',
  sending: 'Telegram sending',
  sent: 'Telegram delivered',
  failed: 'Telegram rejected memo',
  unknown: 'Telegram delivery unverified',
}

export const receiptNumber = id => String(id).padStart(3, '0')

export function frame({ card, stage, size, receipt, notice, index, count, voice }) {
  if (stage === 'receipt') return [
    `POCKETPULSE  /  ${receipt.source} PAPER`,
    `Paper fill #${receiptNumber(receipt.id)}   ·   $${receipt.size}`,
    `${receipt.side} @ ${receipt.price}   ·   ${receipt.messageId ? 'TG #' + receipt.messageId : 'Memo #' + receiptNumber(receipt.id)}`,
    deliveryLabel[receipt.delivery] + '   /   Tap back',
  ]
  if (stage === 'blocked') return [
    'RISK GUARD  /  PAPER',
    'BLOCKED: ' + notice,
    'No paper fill recorded',
    'Tap to return   /   Review fresh quote',
  ]
  if (!card) return ['POCKETPULSE  /  G2', notice || 'Loading market radar', '', '']
  const source = `${card.venue.toUpperCase()}  /  ${card.source}   ·   ${index + 1}/${count}`
  if (stage === 'review' || stage === 'writing') return [
    `${card.source} PAPER  /  REVIEW`,
    `${card.side} $${size}   ·   ${trim(card.title, 29)}`,
    notice || '50 bp max slip   ·   Telegram memo',
    stage === 'writing' ? 'Saving paper fill…' : 'Tap confirm   /   Double tap back',
  ]
  const canReview = card.source !== 'CACHE' && card.ask != null && card.bid != null
  return [
    source,
    trim(card.title, 46),
    notice || `${card.label}  ${signed(card.metric)} ${card.unit}` +
      (card.bid != null && card.ask != null ? `   ·   ${card.bid} / ${card.ask}` : ''),
    canReview ? (voice ? 'Tap review   /   Hold voice   /   Swipe' : 'Tap review   /   Swipe for next') : 'Read only   /   Swipe for next',
  ]
}
