import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from './session-store'

describe('session stream store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSessionStore.setState({
      activeSessionId: 'session_1',
      messages: [],
      isLoading: false,
      sessionStates: {},
      tasks: [],
      messageQueue: [],
      drafts: {},
    })
  })

  afterEach(() => {
    const state = useSessionStore.getState() as any
    state.flushSessionStreamBuffers?.('session_1')
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('batches stream deltas so one model response chunk burst does not re-render every token', async () => {
    const updates: string[] = []
    const unsubscribe = useSessionStore.subscribe((state) => {
      updates.push(state.sessionStates.session_1?.streamingText ?? '')
    })

    const store = useSessionStore.getState()
    store.appendStreamText('session_1', 'A')
    store.appendStreamText('session_1', 'B')
    store.appendStreamText('session_1', 'C')

    expect(useSessionStore.getState().sessionStates.session_1?.streamingText).toBeUndefined()
    expect(updates).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(32)

    expect(useSessionStore.getState().sessionStates.session_1?.streamingText).toBe('ABC')
    expect(updates).toHaveLength(1)
    unsubscribe()
  })

  it('can flush pending deltas before the completed assistant message clears streaming state', () => {
    const store = useSessionStore.getState()
    store.appendThinkingText('session_1', 'thinking')
    store.appendStreamText('session_1', 'answer')

    expect(typeof (useSessionStore.getState() as any).flushSessionStreamBuffers).toBe('function')
    ;(useSessionStore.getState() as any).flushSessionStreamBuffers('session_1')

    const streamed = useSessionStore.getState().sessionStates.session_1
    expect(streamed?.thinkingText).toBe('thinking')
    expect(streamed?.streamingText).toBe('answer')
    expect(streamed?.isThinking).toBe(false)
  })
})
