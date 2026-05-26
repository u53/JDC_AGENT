import type { StreamChunk } from '../types.js'

const THINK_TAGS = [
  { open: '<thinking>', close: '</thinking>' },
  { open: '<think>', close: '</think>' },
]

export function parseThinkTags(
  text: string,
  insideThink: boolean
): { chunks: StreamChunk[]; remaining: string; insideThink: boolean; sawOpen: boolean; sawClose: boolean } {
  const chunks: StreamChunk[] = []
  const maxTagLen = 11 // length of '</thinking>' (longest tag)
  let sawOpen = false
  let sawClose = false

  while (true) {
    if (insideThink) {
      let earliestTag = -1
      let tag = ''
      let tagKind: 'open' | 'close' = 'close'
      for (const t of THINK_TAGS) {
        for (const candidate of [
          { value: t.close, kind: 'close' as const },
          { value: t.open, kind: 'open' as const },
        ]) {
          const idx = text.indexOf(candidate.value)
          if (idx !== -1 && (earliestTag === -1 || idx < earliestTag)) {
            earliestTag = idx
            tag = candidate.value
            tagKind = candidate.kind
          }
        }
      }
      if (earliestTag !== -1) {
        if (earliestTag > 0) chunks.push({ type: 'thinking_delta', text: text.slice(0, earliestTag) })
        if (tagKind === 'close') {
          insideThink = false
          sawClose = true
        } else {
          sawOpen = true
        }
        text = text.slice(earliestTag + tag.length)
      } else {
        const safeLen = Math.max(0, text.length - (maxTagLen - 1))
        if (safeLen > 0) {
          chunks.push({ type: 'thinking_delta', text: text.slice(0, safeLen) })
          text = text.slice(safeLen)
        }
        break
      }
    } else {
      let earliestTag = -1
      let tag = ''
      let tagKind: 'open' | 'close' = 'open'
      for (const t of THINK_TAGS) {
        for (const candidate of [
          { value: t.open, kind: 'open' as const },
          { value: t.close, kind: 'close' as const },
        ]) {
          const idx = text.indexOf(candidate.value)
          if (idx !== -1 && (earliestTag === -1 || idx < earliestTag)) {
            earliestTag = idx
            tag = candidate.value
            tagKind = candidate.kind
          }
        }
      }
      if (earliestTag !== -1) {
        if (earliestTag > 0) chunks.push({ type: 'text_delta', text: text.slice(0, earliestTag) })
        insideThink = tagKind === 'open'
        if (tagKind === 'open') sawOpen = true
        if (tagKind === 'close') sawClose = true
        text = text.slice(earliestTag + tag.length)
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
  return { chunks, remaining: text, insideThink, sawOpen, sawClose }
}

export class ThinkTagStreamParser {
  private pendingText = ''
  private pendingKind: 'text' | 'thinking' = 'text'
  private insideThink = false

  writeText(text: string): StreamChunk[] {
    return [...this.prepareFor('text', text), ...this.write(text, 'text')]
  }

  writeThinking(text: string): StreamChunk[] {
    return [...this.prepareFor('thinking', text), ...this.write(text, 'thinking')]
  }

  startThinking(): StreamChunk[] {
    return this.prepareFor('thinking', '')
  }

  endThinking(): StreamChunk[] {
    const chunks = this.flush()
    this.insideThink = false
    this.pendingKind = 'text'
    return chunks
  }

  flush(): StreamChunk[] {
    if (!this.pendingText) return []
    const type = this.pendingKind === 'thinking' ? 'thinking_delta' : 'text_delta'
    const chunk: StreamChunk = { type, text: this.pendingText }
    this.pendingText = ''
    this.pendingKind = this.insideThink ? 'thinking' : 'text'
    return [chunk]
  }

  private prepareFor(kind: 'text' | 'thinking', incoming: string): StreamChunk[] {
    if (!this.pendingText || this.pendingKind === kind || this.insideThink) return []
    if (canCompleteSplitTag(this.pendingText, incoming)) return []
    return this.flush()
  }

  private write(text: string, kind: 'text' | 'thinking'): StreamChunk[] {
    if (!text) return []
    this.pendingText += text
    const explicitInside = this.insideThink
    const semanticInside = kind === 'thinking' || this.pendingKind === 'thinking'
    const result = parseThinkTags(this.pendingText, explicitInside || semanticInside)
    this.pendingText = result.remaining
    this.insideThink = explicitInside || result.sawOpen
      ? result.insideThink
      : false
    this.pendingKind = result.insideThink || (kind === 'thinking' && !result.sawClose)
      ? 'thinking'
      : 'text'
    return result.chunks
  }
}

function canCompleteSplitTag(pending: string, incoming: string): boolean {
  const tags = THINK_TAGS.flatMap((tag) => [tag.open, tag.close])
  return tags.some((tag) => {
    for (let prefixLen = 1; prefixLen < tag.length; prefixLen++) {
      if (!pending.endsWith(tag.slice(0, prefixLen))) continue
      const rest = tag.slice(prefixLen)
      if (incoming.startsWith(rest) || rest.startsWith(incoming)) return true
    }
    return false
  })
}
