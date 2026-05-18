import type { StreamChunk } from '../types.js'

const THINK_TAGS = [
  { open: '<thinking>', close: '</thinking>' },
  { open: '<think>', close: '</think>' },
]

export function parseThinkTags(text: string, insideThink: boolean): { chunks: StreamChunk[]; remaining: string; insideThink: boolean } {
  const chunks: StreamChunk[] = []
  const maxTagLen = 11 // length of '</thinking>' (longest tag)

  while (true) {
    if (insideThink) {
      let earliestClose = -1
      let closeTag = ''
      for (const t of THINK_TAGS) {
        const idx = text.indexOf(t.close)
        if (idx !== -1 && (earliestClose === -1 || idx < earliestClose)) {
          earliestClose = idx
          closeTag = t.close
        }
      }
      if (earliestClose !== -1) {
        if (earliestClose > 0) chunks.push({ type: 'thinking_delta', text: text.slice(0, earliestClose) })
        insideThink = false
        text = text.slice(earliestClose + closeTag.length)
      } else {
        const safeLen = Math.max(0, text.length - (maxTagLen - 1))
        if (safeLen > 0) {
          chunks.push({ type: 'thinking_delta', text: text.slice(0, safeLen) })
          text = text.slice(safeLen)
        }
        break
      }
    } else {
      let earliestOpen = -1
      let openTag = ''
      for (const t of THINK_TAGS) {
        const idx = text.indexOf(t.open)
        if (idx !== -1 && (earliestOpen === -1 || idx < earliestOpen)) {
          earliestOpen = idx
          openTag = t.open
        }
      }
      if (earliestOpen !== -1) {
        if (earliestOpen > 0) chunks.push({ type: 'text_delta', text: text.slice(0, earliestOpen) })
        insideThink = true
        text = text.slice(earliestOpen + openTag.length)
      } else {
        const safeLen = Math.max(0, text.length - (maxTagLen - 1))
        if (safeLen > 0) {
          chunks.push({ type: 'text_delta', text: text.slice(0, safeLen) })
          text = text.slice(safeLen)
        }
        break
      }
    }
  }
  return { chunks, remaining: text, insideThink }
}
