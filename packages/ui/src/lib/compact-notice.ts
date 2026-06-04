import type { Message } from '@jdcagnet/core'

export const COMPACT_NOTICE_PREFIX = '__JDC_COMPACT__'

export type CompactNoticeStatus = 'running' | 'complete' | 'skipped' | 'failed'

export interface CompactNotice {
  status: CompactNoticeStatus
  originalCount?: number
  summarizedCount?: number
  keptRecent?: number
  messageCount?: number
  reason?: string
  message?: string
}

export function createCompactNoticeMessage(notice: CompactNotice): Message {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: [{ type: 'text', text: `${COMPACT_NOTICE_PREFIX}${JSON.stringify(notice)}` }],
    timestamp: Date.now(),
  }
}

export function parseCompactNoticeText(text: string): CompactNotice | null {
  if (!text.startsWith(COMPACT_NOTICE_PREFIX)) return null
  try {
    const parsed = JSON.parse(text.slice(COMPACT_NOTICE_PREFIX.length))
    if (!parsed || typeof parsed !== 'object') return null
    if (!['running', 'complete', 'skipped', 'failed'].includes(parsed.status)) return null
    return parsed as CompactNotice
  } catch {
    return null
  }
}

export function isCompactSummaryText(text: string): boolean {
  return text.startsWith('[Context from prior conversation')
}

export function stripCompactSummaryPreamble(text: string): string {
  if (!isCompactSummaryText(text)) return text
  return text.replace(/^\[Context from prior conversation[^\]]*\]\s*/i, '').trim()
}
