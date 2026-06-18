import { describe, expect, it, vi } from 'vitest'
import type { StreamChunk, ToolExecutionEvent } from '@jdcagnet/core'
import { createSessionEvents, createSinkMultiplexer, createUiSink } from './session-event-sink'

describe('session event sinks', () => {
  it('adapts core SessionEvents to a sink with session id', () => {
    const sink = {
      stream: vi.fn(),
      toolEvent: vi.fn(),
      messageComplete: vi.fn(),
      messagesReplaced: vi.fn(),
      usage: vi.fn(),
      error: vi.fn(),
      finished: vi.fn(),
    }
    const events = createSessionEvents('session_1', sink)
    const chunk: StreamChunk = { type: 'text_delta', text: 'hello' }

    events.onStreamChunk(chunk)
    events.onUsage?.({ turnCount: 1, inputTokens: 2, outputTokens: 3, contextUsedPercent: 1 } as any)

    expect(sink.stream).toHaveBeenCalledWith('session_1', chunk)
    expect(sink.usage).toHaveBeenCalledWith('session_1', expect.objectContaining({ turnCount: 1 }))
  })

  it('fans out events and isolates sink failures', () => {
    const first = { stream: vi.fn(() => { throw new Error('sink failed') }) }
    const second = { stream: vi.fn() }
    const mux = createSinkMultiplexer([first as any, second as any])

    mux.stream?.('session_1', { type: 'text_delta', text: 'ok' })

    expect(first.stream).toHaveBeenCalled()
    expect(second.stream).toHaveBeenCalledWith('session_1', { type: 'text_delta', text: 'ok' })
  })

  it('continues after a rejecting async sink and logs the rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = { stream: vi.fn(() => Promise.reject(new Error('async sink failed'))) }
    const second = { stream: vi.fn() }
    const mux = createSinkMultiplexer([first as any, second as any])

    mux.stream?.('session_1', { type: 'text_delta', text: 'ok' })
    await Promise.resolve()

    expect(first.stream).toHaveBeenCalled()
    expect(second.stream).toHaveBeenCalledWith('session_1', { type: 'text_delta', text: 'ok' })
    expect(errorSpy).toHaveBeenCalledWith('[session-sink] sink failed:', expect.any(Error))
    errorSpy.mockRestore()
  })

  it('emits a plan-mode change for EnterPlanMode completion', () => {
    const send = vi.fn()
    const sink = createUiSink(() => ({ webContents: { send } } as any))
    const event = { type: 'complete', toolName: 'EnterPlanMode' } as ToolExecutionEvent

    sink.toolEvent?.('session_2', event)

    expect(send).toHaveBeenNthCalledWith(1, 'query:tool-event', { sessionId: 'session_2', event })
    expect(send).toHaveBeenNthCalledWith(2, 'plan:mode-changed', { sessionId: 'session_2', mode: 'planning' })
  })

  it('emits query:finished from the UI sink', () => {
    const send = vi.fn()
    const sink = createUiSink(() => ({ webContents: { send } } as any))

    sink.finished?.('session_3')

    expect(send).toHaveBeenCalledWith('query:finished', { sessionId: 'session_3' })
  })
})
