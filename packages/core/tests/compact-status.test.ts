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

  it('trims large tool results that are kept as recent messages', async () => {
    const largeOutput = `start\n${'x'.repeat(10_000)}\nend`
    const msgs = Array.from({ length: MIN_COMPACT_LENGTH + 4 }, (_, i) =>
      i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`)
    )
    msgs.splice(
      msgs.length - 2,
      0,
      { id: 'recent_tool_use', role: 'assistant', content: [{ type: 'tool_use', id: 't-large', name: 'bash', input: { cmd: 'big output' } }], timestamp: 0 },
      { id: 'recent_tool_result', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-large', content: largeOutput, is_error: false }], timestamp: 0 },
    )

    const result = await compactMessages(msgs, fakeProvider('summary content'), baseConfig)

    expect(result.status).toBe('compacted')
    const toolResult = result.messages
      .flatMap(msg => msg.content)
      .find(block => block.type === 'tool_result' && block.tool_use_id === 't-large')
    expect(toolResult?.type).toBe('tool_result')
    expect(toolResult?.content).toContain('Tool result truncated')
    expect(toolResult?.content).toContain(`${largeOutput.length} chars`)
    expect(toolResult?.content.length).toBeLessThan(9_000)
    expect(toolResult?.content).toContain('start')
    expect(toolResult?.content).toContain('end')
  })

  it('uses configured kept tool result budgets during compaction', async () => {
    const largeOutput = `alpha\n${'x'.repeat(4_000)}\nomega`
    const msgs = Array.from({ length: MIN_COMPACT_LENGTH + 4 }, (_, i) =>
      i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`)
    )
    msgs.splice(
      msgs.length - 2,
      0,
      { id: 'recent_tool_use', role: 'assistant', content: [{ type: 'tool_use', id: 't-budget', name: 'Bash', input: { command: 'big output' } }], timestamp: 0 },
      { id: 'recent_tool_result', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-budget', content: largeOutput, is_error: false }], timestamp: 0 },
    )

    const result = await compactMessages(msgs, fakeProvider('summary content'), {
      ...baseConfig,
      toolResultRetention: { keptToolResultChars: 600 },
    })

    expect(result.status).toBe('compacted')
    const toolResult = result.messages
      .flatMap(msg => msg.content)
      .find(block => block.type === 'tool_result' && block.tool_use_id === 't-budget')
    expect(toolResult?.type).toBe('tool_result')
    expect(toolResult?.content).toContain('alpha')
    expect(toolResult?.content).toContain('omega')
    expect(toolResult?.content.length).toBeLessThan(1_000)
  })

  it('caps aggregate old tool result evidence sent to the summarizer', async () => {
    let compactPromptMessages: Message[] = []
    const provider = {
      stream: async function* (messages: Message[]) {
        compactPromptMessages = messages
        yield { type: 'text_delta', text: '<analysis>scratch</analysis><summary>summary content</summary>' } as StreamChunk
      },
    } as unknown as ModelProvider
    const msgs: Message[] = []
    for (let i = 0; i < 6; i += 1) {
      msgs.push(
        { id: `tool_use_${i}`, role: 'assistant', content: [{ type: 'tool_use', id: `t-${i}`, name: 'Bash', input: { command: `cmd ${i}` } }], timestamp: 0 },
        { id: `tool_result_${i}`, role: 'user', content: [{ type: 'tool_result', tool_use_id: `t-${i}`, content: `start-${i}\n${'z'.repeat(2_000)}\nend-${i}`, is_error: false }], timestamp: 0 },
      )
    }
    for (let i = 0; i < KEEP_RECENT; i += 1) {
      msgs.push(i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`))
    }

    const result = await compactMessages(msgs, provider, {
      ...baseConfig,
      toolResultRetention: {
        summaryToolResultChars: 1_000,
        summaryTotalToolResultChars: 1_500,
      } as any,
    })

    expect(result.status).toBe('compacted')
    const promptText = compactPromptMessages
      .flatMap(msg => msg.content)
      .map(block => block.type === 'text' ? block.text : '')
      .join('\n')
    expect((promptText.match(/z/g) ?? []).length).toBeLessThanOrEqual(1_500)
    expect(promptText).toContain('Tool result summarized with head and tail')
    expect(promptText).toContain('Tool result summary evidence budget exhausted')
  })

  it('allocates summary evidence budget to errors first and newer tool results before older ones', async () => {
    let compactPromptMessages: Message[] = []
    const provider = {
      stream: async function* (messages: Message[]) {
        compactPromptMessages = messages
        yield { type: 'text_delta', text: '<summary>summary content</summary>' } as StreamChunk
      },
    } as unknown as ModelProvider
    const msgs: Message[] = [
      { id: 'tool_use_old_success', role: 'assistant', content: [{ type: 'tool_use', id: 't-old-success', name: 'Bash', input: { command: 'old success' } }], timestamp: 0 },
      { id: 'tool_result_old_success', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-old-success', content: `OLD_SUCCESS_HEAD\n${'s'.repeat(1_000)}\nOLD_SUCCESS_TAIL`, is_error: false }], timestamp: 0 },
      { id: 'tool_use_mid_error', role: 'assistant', content: [{ type: 'tool_use', id: 't-mid-error', name: 'Bash', input: { command: 'mid error' } }], timestamp: 0 },
      { id: 'tool_result_mid_error', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-mid-error', content: `MID_ERROR_HEAD\n${'e'.repeat(1_000)}\nMID_ERROR_TAIL`, is_error: true }], timestamp: 0 },
      { id: 'tool_use_new_success', role: 'assistant', content: [{ type: 'tool_use', id: 't-new-success', name: 'Bash', input: { command: 'new success' } }], timestamp: 0 },
      { id: 'tool_result_new_success', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-new-success', content: `NEW_SUCCESS_HEAD\n${'n'.repeat(1_000)}\nNEW_SUCCESS_TAIL`, is_error: false }], timestamp: 0 },
    ]
    for (let i = 0; i < KEEP_RECENT; i += 1) {
      msgs.push(i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`))
    }

    const result = await compactMessages(msgs, provider, {
      ...baseConfig,
      toolResultRetention: {
        summaryToolResultChars: 500,
        summaryErrorToolResultChars: 500,
        summaryTotalToolResultChars: 1_000,
      },
    })

    expect(result.status).toBe('compacted')
    const promptText = compactPromptMessages
      .flatMap(msg => msg.content)
      .map(block => block.type === 'text' ? block.text : '')
      .join('\n')
    expect(promptText).toContain('old success')
    expect(promptText).toContain('mid error')
    expect(promptText).toContain('new success')
    expect(promptText.indexOf('old success')).toBeLessThan(promptText.indexOf('mid error'))
    expect(promptText.indexOf('mid error')).toBeLessThan(promptText.indexOf('new success'))
    expect(promptText).not.toContain('OLD_SUCCESS_HEAD')
    expect(promptText).not.toContain('OLD_SUCCESS_TAIL')
    expect(promptText).toContain('MID_ERROR_HEAD')
    expect(promptText).toContain('MID_ERROR_TAIL')
    expect(promptText).toContain('NEW_SUCCESS_HEAD')
    expect(promptText).toContain('NEW_SUCCESS_TAIL')
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
