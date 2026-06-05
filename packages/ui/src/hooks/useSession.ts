import { useEffect, useCallback } from 'react'
import { useSessionStore, type SessionStreamState } from '../stores/session-store'
import { ipc } from '../lib/ipc-client'
import { createCompactNoticeMessage } from '../lib/compact-notice'

const EMPTY_STATE: SessionStreamState = { isStreaming: false, streamingText: '', thinkingText: '', isThinking: false, toolEvents: [] }

export function useSession() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const messages = useSessionStore((s) => s.messages)
  // Subscribe only to the active session's state — not the entire map.
  // This prevents re-renders when OTHER sessions stream (which broke text selection).
  const currentState = useSessionStore((s) => {
    const id = s.activeSessionId
    return id ? (s.sessionStates[id] || EMPTY_STATE) : EMPTY_STATE
  })

  useEffect(() => {
    const store = useSessionStore.getState()

    const unsubStream = ipc.query.onStream(({ sessionId, chunk }) => {
      if (store.getSessionState(sessionId).error?.retrying) {
        store.setError(sessionId, null)
      }
      if (chunk.type === 'thinking_delta' && chunk.text) {
        store.appendThinkingText(sessionId, chunk.text)
      } else if (chunk.type === 'text_delta' && chunk.text) {
        store.appendStreamText(sessionId, chunk.text)
      } else if (chunk.type === 'compact_start') {
        const current = useSessionStore.getState()
        if (sessionId === current.activeSessionId) {
          store.setCompactState(sessionId, { active: true })
        }
      } else if (chunk.type === 'compact_progress') {
        // Intentionally ignored — summary streaming should not pollute the
        // assistant streamingText area. The terminal compact_complete event
        // is sufficient for the user to see compression occurred.
      } else if (chunk.type === 'compact_complete' && chunk.compactInfo) {
        const { originalCount, summarizedCount, keptCount } = chunk.compactInfo
        store.setCompactState(sessionId, { active: false })
        const recentKept = Math.max(0, keptCount - 1)
        const compactMessage = createCompactNoticeMessage({
          status: 'complete',
          originalCount,
          summarizedCount,
          keptRecent: recentKept,
        })
        const current = useSessionStore.getState()
        if (sessionId === current.activeSessionId) {
          useSessionStore.setState((s) => ({ messages: [...s.messages, compactMessage] }))
        }
      } else if (chunk.type === 'compact_skipped' && chunk.compactSkipped) {
        store.setCompactState(sessionId, { active: false })
        const current = useSessionStore.getState()
        if (sessionId !== current.activeSessionId) return
        const skipMsg = createCompactNoticeMessage({
          status: 'skipped',
          reason: chunk.compactSkipped.reason,
          messageCount: chunk.compactSkipped.messageCount,
        })
        useSessionStore.setState((s) => ({ messages: [...s.messages, skipMsg] }))
      } else if (chunk.type === 'compact_failed' && chunk.compactFailed) {
        store.setCompactState(sessionId, { active: false })
        const current = useSessionStore.getState()
        if (sessionId !== current.activeSessionId) return
        const failMsg = createCompactNoticeMessage({
          status: 'failed',
          reason: chunk.compactFailed.reason,
          message: chunk.compactFailed.message,
        })
        useSessionStore.setState((s) => ({ messages: [...s.messages, failMsg] }))
      }
    })

    const unsubTool = ipc.query.onToolEvent(({ sessionId, event }) => {
      store.addToolEvent(sessionId, event)
      if (event.type === 'complete' && (event.toolName?.startsWith('Task') || event.toolName?.startsWith('task_') || event.toolName === 'TodoWrite')) {
        const current = useSessionStore.getState()
        if (sessionId === current.activeSessionId) {
          current.loadTasks(sessionId)
        }
      }
    })

    const unsubComplete = ipc.query.onComplete(({ sessionId, message }) => {
      store.flushSessionStreamBuffers(sessionId)
      if (store.getSessionState(sessionId).error?.retrying) {
        store.setError(sessionId, null)
      }
      const current = useSessionStore.getState()
      if (sessionId === current.activeSessionId) {
        useSessionStore.setState((s) => ({ messages: [...s.messages, message] }))
      }
      // Clear streaming text and tool events on every message completion.
      // Tool events for the current batch are already rendered in the persisted message,
      // so we reset to avoid stale cards accumulating across agentic loop iterations.
      store.updateSessionState(sessionId, {
        streamingText: '',
        thinkingText: '',
        isThinking: false,
        toolEvents: [],
      })
    })

    const unsubFinished = window.electronAPI?.on('query:finished', (_e: unknown, data: unknown) => {
      const { sessionId } = data as { sessionId: string }
      store.finishSession(sessionId)
      const current = useSessionStore.getState()
      if (sessionId === current.activeSessionId) {
        current.loadTasks(sessionId)
      }
      // Auto-send queued message
      const next = useSessionStore.getState().dequeueMessage()
      if (next && sessionId === useSessionStore.getState().activeSessionId) {
        setTimeout(() => {
          const userMessage = {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: [{ type: 'text' as const, text: next }],
            timestamp: Date.now(),
          }
          useSessionStore.setState((s) => ({ messages: [...s.messages, userMessage] }))
          useSessionStore.getState().markStreaming(sessionId, true)
          ;(window as any).electronAPI?.invoke('query:send', { sessionId, text: next })
        }, 100)
      }
    }) || (() => {})

    const unsubError = ipc.query.onError(({ sessionId, error }) => {
      store.clearSessionStreamState(sessionId)
      store.updateSessionState(sessionId, { aborting: false })
      store.setError(sessionId, { message: error, category: 'unknown', retrying: false })
    })

    const unsubRetrying = ipc.query.onRetrying(({ sessionId, attempt, maxRetries, error, delayMs, category }) => {
      store.setError(sessionId, {
        message: error,
        category,
        retrying: true,
        retryAttempt: attempt,
        retryIn: delayMs,
        retryMaxRetries: maxRetries,
      })
    })

    const unsubMessagesUpdated = window.electronAPI?.on('session:messages-updated', (_e: unknown, data: unknown) => {
      const { sessionId, messages: msgs } = data as { sessionId: string; messages: any[] }
      const current = useSessionStore.getState()
      if (sessionId === current.activeSessionId) {
        useSessionStore.setState({ messages: msgs })
      }
    }) || (() => {})

    const unsubUsage = window.electronAPI?.on('query:usage', (_e: unknown, data: unknown) => {
      const { sessionId, usage } = data as { sessionId: string; usage: any }
      store.updateUsage(sessionId, usage)
    }) || (() => {})

    // The main process will spin up a new runLoop whenever a background task
    // (agent/team/bash) drops a notification while we are idle. Until that
    // runLoop actually starts streaming, isStreaming is false — meaning the
    // Composer hides its Stop button and the user cannot interrupt the
    // resumed turn. Flip isStreaming on as soon as the main process tells us
    // a notification is being drained.
    const unsubBgNotification = ipc.background.onNotification(({ sessionId }) => {
      useSessionStore.getState().markStreaming(sessionId, true)
      useSessionStore.getState().updateSessionState(sessionId, { aborting: false })
    })

    return () => {
      unsubStream()
      unsubTool()
      unsubComplete()
      unsubFinished()
      unsubError()
      unsubRetrying()
      unsubMessagesUpdated()
      unsubUsage()
      unsubBgNotification()
    }
  }, [])

  const sendMessage = useCallback(
    async (text: string, images?: { data: string; mediaType: string }[]) => {
      if (!activeSessionId) return
      const content: any[] = [{ type: 'text' as const, text }]
      if (images && images.length > 0) {
        for (const img of images) {
          content.push({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
          })
        }
      }
      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content,
        timestamp: Date.now(),
      }
      useSessionStore.setState((s) => ({ messages: [...s.messages, userMessage] }))
      useSessionStore.getState().markStreaming(activeSessionId, true)
      await ipc.query.send(activeSessionId, text, images)
    },
    [activeSessionId]
  )

  const abort = useCallback(() => {
    if (!activeSessionId) return
    ipc.query.abort(activeSessionId)
    // Don't clear streaming state here — let query:finished / query:error fire
    // when the main process actually exits the runloop. We just flip an
    // 'aborting' flag so the Stop button can show "Stopping…" feedback.
    useSessionStore.getState().updateSessionState(activeSessionId, { aborting: true })
  }, [activeSessionId])

  return {
    messages,
    streamingText: currentState.streamingText,
    thinkingText: currentState.thinkingText,
    isStreaming: currentState.isStreaming,
    aborting: currentState.aborting === true,
    compacting: currentState.compacting === true,
    isThinking: currentState.isThinking,
    toolEvents: currentState.toolEvents,
    error: currentState.error,
    usage: currentState.usage,
    sendMessage,
    abort,
    cancelRetry: abort,
    retry: useCallback(() => {
      if (!activeSessionId) return
      useSessionStore.getState().setError(activeSessionId, null)
      useSessionStore.getState().markStreaming(activeSessionId, true)
      useSessionStore.getState().updateSessionState(activeSessionId, { aborting: false })
      void ipc.query.retry(activeSessionId)
    }, [activeSessionId]),
    dismissError: useCallback(() => {
      if (!activeSessionId) return
      useSessionStore.getState().setError(activeSessionId, null)
    }, [activeSessionId]),
  }
}
