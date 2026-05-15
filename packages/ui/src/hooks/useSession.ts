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
      } else if (chunk.type === 'compact_complete' && chunk.compactInfo) {
        const { originalCount, keptCount, memoriesExtracted } = chunk.compactInfo
        const memText = memoriesExtracted > 0 ? ` ${memoriesExtracted} memories saved.` : ''
        const compactMsg = `\n\n[Context compressed: ${originalCount} messages → summary + ${keptCount} recent.${memText}]\n`
        store.appendStreamText(sessionId, compactMsg)
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
      // Clear accumulated streaming state for this turn — content is now persisted in messages.
      // Tool execution events will arrive fresh via onToolEvent after this point.
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
          (window as any).electronAPI?.invoke('query:send', { sessionId, text: next })
          useSessionStore.getState().markStreaming(sessionId, true)
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
