import { readFileSync } from 'node:fs'
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
      messageQueues: {},
      drafts: {},
    })
    vi.stubGlobal('window', {
      electronAPI: {
        invoke: vi.fn().mockImplementation((channel: string) => {
          if (channel === 'session:list') return Promise.resolve([])
          return Promise.resolve({ success: true })
        }),
      },
    })
  })

  afterEach(() => {
    const state = useSessionStore.getState() as any
    state.flushSessionStreamBuffers?.('session_1')
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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

  it('stores automatic retry progress with the retry limit', () => {
    const store = useSessionStore.getState()

    store.setError('session_1', {
      message: 'upstream overloaded',
      category: 'overloaded',
      retrying: true,
      retryAttempt: 1,
      retryIn: 5000,
      retryMaxRetries: 10,
    })

    expect(useSessionStore.getState().sessionStates.session_1?.error).toMatchObject({
      retrying: true,
      retryAttempt: 1,
      retryIn: 5000,
      retryMaxRetries: 10,
    })
  })

  it('clears retrying errors when the session finishes but keeps final errors', () => {
    const store = useSessionStore.getState()

    store.setError('session_1', {
      message: 'temporary outage',
      category: 'network',
      retrying: true,
      retryAttempt: 1,
      retryMaxRetries: 10,
    })
    store.finishSession('session_1')
    expect(useSessionStore.getState().sessionStates.session_1?.error).toBeUndefined()

    store.setError('session_1', {
      message: 'final outage',
      category: 'network',
      retrying: false,
    })
    store.finishSession('session_1')
    expect(useSessionStore.getState().sessionStates.session_1?.error).toMatchObject({
      message: 'final outage',
      retrying: false,
    })
  })

  it('keeps queued messages isolated per session and supports editing', () => {
    const store = useSessionStore.getState()

    store.enqueueMessage('session_1', 'from A')
    store.enqueueMessage('session_2', 'from B')
    store.updateQueuedMessage('session_1', 0, 'edited A')
    store.updateQueuedMessage('session_2', 0, '')

    expect(useSessionStore.getState().messageQueues).toEqual({
      session_1: ['edited A'],
      session_2: [''],
    })
    expect(useSessionStore.getState().dequeueMessage('session_1')).toBe('edited A')
    expect(useSessionStore.getState().messageQueues.session_1).toBeUndefined()
    expect(useSessionStore.getState().messageQueues.session_2).toEqual([''])
  })

  it('clears a deleted session queue without touching other sessions', async () => {
    const store = useSessionStore.getState()
    store.enqueueMessage('session_1', 'delete me')
    store.enqueueMessage('session_2', 'keep me')

    await store.deleteSession('session_1')

    expect(useSessionStore.getState().messageQueues.session_1).toBeUndefined()
    expect(useSessionStore.getState().messageQueues.session_2).toEqual(['keep me'])
  })

  it('auto-dequeues from the completed session instead of a global queue', () => {
    const hookSource = readFileSync(new URL('../hooks/useSession.ts', import.meta.url), 'utf8')

    expect(hookSource).toContain('dequeueMessage(sessionId)')
    expect(hookSource).not.toContain('dequeueMessage()')
  })

  it('refreshes project sessions when the main process reports session changes', () => {
    const hookSource = readFileSync(new URL('../hooks/useSession.ts', import.meta.url), 'utf8')
    const ipcSource = readFileSync(new URL('../lib/ipc-client.ts', import.meta.url), 'utf8')
    const managerSource = readFileSync(new URL('../../../electron/src/session-manager.ts', import.meta.url), 'utf8')

    expect(ipcSource).toContain('onSessionChanged')
    expect(hookSource).toContain('ipc.session.onSessionChanged')
    expect(hookSource).toContain('useSessionStore.getState().loadProjects()')
    expect(managerSource).toContain("webContents.send('session:changed'")
  })

  it('opens a project console without losing the selected project', () => {
    useSessionStore.setState({
      projects: [
        { name: 'alpha', cwd: '/repo/alpha', sessions: [{ id: 'alpha-1', projectName: 'alpha', cwd: '/repo/alpha' }] },
        { name: 'olympus', cwd: '/repo/olympus', sessions: [{ id: 'olympus-1', projectName: 'olympus', cwd: '/repo/olympus' }] },
      ],
      activeSessionId: 'olympus-1',
      messages: [{ role: 'user', content: 'hello' }],
    })

    ;(useSessionStore.getState() as any).openProjectConsole('/repo/olympus')

    expect(useSessionStore.getState().activeSessionId).toBeNull()
    expect((useSessionStore.getState() as any).activeProjectCwd).toBe('/repo/olympus')
    expect(useSessionStore.getState().messages).toEqual([])
  })
})
