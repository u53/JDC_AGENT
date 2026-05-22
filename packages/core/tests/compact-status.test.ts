import { describe, it, expect, vi } from 'vitest'
import { compactMessages, MIN_COMPACT_LENGTH, KEEP_RECENT } from '../src/compact.js'
import type { Message, ModelConfig, StreamChunk } from '../src/types.js'
import type { ModelProvider } from '../src/model-provider.js'

function userMsg(text: string, id = 'u'): Message {
  return { id, role: 'user', content: [{ type: 'text', text }], timestamp: 0 }
}
function assistantMsg(text: string, id = 'a'): Message {
  return { id, role: 'assistant', content: [{ type: 'text', text }], timestamp: 0 }
}

const baseConfig: ModelConfig = { model: 'test', maxTokens: 4096 } as ModelConfig

function fakeProvider(summary: string): ModelProvider {
  return {
    stream: async function* () {
      yield { type: 'text_delta', text: `<analysis>scratch</analysis><summary>${summary}</summary><memories>[]</memories>` } as StreamChunk
    },
  } as unknown as ModelProvider
}

describe('compactMessages status', () => {
  it('returns status=skipped when below threshold', async () => {
    const msgs = Array.from({ length: MIN_COMPACT_LENGTH - 1 }, (_, i) =>
      i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`)
    )
    const result = await compactMessages(msgs, fakeProvider('S'), baseConfig)
    expect(result.status).toBe('skipped')
    expect(result.skipReason).toBe('too_short')
    expect(result.originalCount).toBe(msgs.length)
    expect(result.summarizedCount).toBe(0)
    expect(result.messages).toBe(msgs)
  })

  it('returns status=compacted when threshold met', async () => {
    const msgs = Array.from({ length: MIN_COMPACT_LENGTH + 4 }, (_, i) =>
      i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`)
    )
    const result = await compactMessages(msgs, fakeProvider('summary content'), baseConfig)
    expect(result.status).toBe('compacted')
    expect(result.summarizedCount).toBeGreaterThan(0)
    expect(result.keptCount).toBe(KEEP_RECENT + 1)
    expect(result.messages.length).toBe(KEEP_RECENT + 1)
    const head = result.messages[0]
    expect(head.role).toBe('user')
    expect((head.content[0] as any).text).toContain('summary content')
  })

  it('returns status=failed on empty model output', async () => {
    const msgs = Array.from({ length: MIN_COMPACT_LENGTH + 2 }, (_, i) =>
      i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`)
    )
    const result = await compactMessages(msgs, fakeProvider(''), baseConfig)
    expect(result.status).toBe('failed')
    expect(result.failReason).toBe('empty_response')
    expect(result.messages).toBe(msgs)
  })

  it('returns status=failed when stream throws', async () => {
    const provider = {
      stream: async function* () {
        throw new Error('network down')
        yield { type: 'text_delta', text: 'x' } as StreamChunk
      },
    } as unknown as ModelProvider
    const msgs = Array.from({ length: MIN_COMPACT_LENGTH + 2 }, (_, i) =>
      i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`)
    )
    const result = await compactMessages(msgs, provider, baseConfig)
    expect(result.status).toBe('failed')
    expect(result.failReason).toBe('stream_error')
    expect(result.errorMessage).toContain('network down')
    expect(result.messages).toBe(msgs)
  })

  it('does not split tool_use from its tool_result across the cut boundary', async () => {
    // Build messages so the natural cut would land between tool_use and tool_result
    const total = MIN_COMPACT_LENGTH + 4
    const msgs: Message[] = []
    for (let i = 0; i < total; i++) {
      if (i === total - KEEP_RECENT - 1) {
        // assistant tool_use immediately before the cut
        msgs.push({ id: `a${i}`, role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'grep', input: {} }], timestamp: 0 })
      } else if (i === total - KEEP_RECENT) {
        // user tool_result that would be the first kept message — danger zone
        msgs.push({ id: `u${i}`, role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }], timestamp: 0 })
      } else {
        msgs.push(i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`))
      }
    }
    const result = await compactMessages(msgs, fakeProvider('s'), baseConfig)
    expect(result.status).toBe('compacted')
    // After fix, the cut should slide back so the kept block doesn't start with
    // an orphaned tool_result. The first kept message after the summary header
    // should NOT be a tool_result.
    const firstKept = result.messages[1]
    const startsWithToolResult = firstKept.content.some(b => b.type === 'tool_result')
    expect(startsWithToolResult).toBe(false)
  })

  it('does not invoke onChunk with text_delta during summary streaming', async () => {
    const msgs = Array.from({ length: MIN_COMPACT_LENGTH + 2 }, (_, i) =>
      i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`)
    )
    const onChunk = vi.fn()
    await compactMessages(msgs, fakeProvider('summary content'), baseConfig, onChunk)
    // The summarizer's stream output must NOT be forwarded as text_delta — it
    // would render as a fake assistant reply in the UI. compact_progress is OK.
    const textDeltaCalls = onChunk.mock.calls.filter(([c]) => c.type === 'text_delta')
    expect(textDeltaCalls.length).toBe(0)
    const progressCalls = onChunk.mock.calls.filter(([c]) => c.type === 'compact_progress')
    expect(progressCalls.length).toBeGreaterThan(0)
  })
})
