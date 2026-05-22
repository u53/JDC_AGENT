import { useEffect, useCallback } from 'react'
import { useSessionStore } from '../stores/session-store'
import { ipc } from '../lib/ipc-client'

export function useSession() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const messages = useSessionStore((s) => s.messages)
  const sessionStates = useSessionStore((s) => s.sessionStates)

  const currentState = activeSessionId ? (sessionStates[activeSessionId] || { isStreaming: false, streamingText: '', thinkingText: '', isThinking: false, toolEvents: [] }) : { isStreaming: false, streamingText: '', thinkingText: '', isThinking: false, toolEvents: [] }

  useEffect(() => {
    const store = useSessionStore.getState()

    const unsubStream = ipc.query.onStream(({ sessionId, chunk }) => {
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
        const { originalCount, summarizedCount, keptCount, memoriesExtracted } = chunk.compactInfo
        store.setCompactState(sessionId, { active: false })
        const memText = memoriesExtracted > 0 ? ` ${memoriesExtracted} memories saved.` : ''
        const recentKept = Math.max(0, keptCount - 1)
        const compactText = `[Context compressed: ${summarizedCount} of ${originalCount} messages summarized, ${recentKept} recent kept.${memText}]`
        const compactMessage = {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: compactText }],
          timestamp: Date.now(),
        }
        const current = useSessionStore.getState()
        if (sessionId === current.activeSessionId) {
          useSessionStore.setState((s) => ({ messages: [...s.messages, compactMessage] }))
        }
      } else if (chunk.type === 'compact_skipped' && chunk.compactSkipped) {
        store.setCompactState(sessionId, { active: false })
        const current = useSessionStore.getState()
        if (sessionId !== current.activeSessionId) return
        const reason = chunk.compactSkipped.reason
        const text =
          reason === 'too_short'
            ? `[Compact skipped: conversation too short (${chunk.compactSkipped.messageCount} messages) — nothing to compress yet.]`
            : reason === 'in_progress'
            ? '[Compact skipped: another compaction is already in progress.]'
            : '[Compact skipped: no active session.]'
        const skipMsg = {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text }],
          timestamp: Date.now(),
        }
        useSessionStore.setState((s) => ({ messages: [...s.messages, skipMsg] }))
      } else if (chunk.type === 'compact_failed' && chunk.compactFailed) {
        store.setCompactState(sessionId, { active: false })
        const current = useSessionStore.getState()
        if (sessionId !== current.activeSessionId) return
        const r = chunk.compactFailed.reason
        const baseText =
          r === 'aborted'
            ? '[Compact aborted before completion. No messages were modified.]'
            : r === 'empty_response'
            ? '[Compact failed: model returned no summary. No messages were modified.]'
            : `[Compact failed: ${chunk.compactFailed.message || 'stream error'}. No messages were modified.]`
        const failMsg = {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: baseText }],
          timestamp: Date.now(),
        }
        useSessionStore.setState((s) => ({ messages: [...s.messages, failMsg] }))
      }
    })

    const unsubTool = ipc.query.onToolEvent(({ sessionId, event }) => {
      store.addToolEvent(sessionId, event)
      if (event.type === 'complete' && event.toolName?.startsWith('task_')) {
        const current = useSessionStore.getState()
        if (sessionId === current.activeSessionId) {
          current.loadTasks(sessionId)
        }
      }
    })

    const unsubComplete = ipc.query.onComplete(({ sessionId, message }) => {
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
      store.setError(sessionId, { message: error, category: 'unknown', retrying: false })
    })

    const unsubRetrying = ipc.query.onRetrying(({ sessionId, attempt, error, delayMs, category }) => {
      store.setError(sessionId, { message: error, category, retrying: true, retryAttempt: attempt, retryIn: delayMs })
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

    return () => {
      unsubStream()
      unsubTool()
      unsubComplete()
      unsubFinished()
      unsubError()
      unsubRetrying()
      unsubMessagesUpdated()
      unsubUsage()
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
    useSessionStore.getState().clearSessionStreamState(activeSessionId)
  }, [activeSessionId])

  return {
    messages,
    streamingText: currentState.streamingText,
    thinkingText: currentState.thinkingText,
    isStreaming: currentState.isStreaming,
    isThinking: currentState.isThinking,
    toolEvents: currentState.toolEvents,
    error: currentState.error,
    usage: currentState.usage,
    sendMessage,
    abort,
    retry: useCallback(() => {
      if (!activeSessionId) return
      useSessionStore.getState().setError(activeSessionId, null)
      const msgs = useSessionStore.getState().messages
      const lastUser = [...msgs].reverse().find(m => m.role === 'user')
      if (lastUser) {
        const textBlock = lastUser.content.find((b: any) => b.type === 'text') as any
        if (textBlock?.text) {
          sendMessage(textBlock.text)
        }
      }
    }, [activeSessionId, sendMessage]),
    dismissError: useCallback(() => {
      if (!activeSessionId) return
      useSessionStore.getState().setError(activeSessionId, null)
    }, [activeSessionId]),
  }
}
