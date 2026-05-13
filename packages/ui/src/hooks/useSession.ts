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
      }
    })

    const unsubTool = ipc.query.onToolEvent(({ sessionId, event }) => {
      store.addToolEvent(sessionId, event)
    })

    const unsubComplete = ipc.query.onComplete(({ sessionId, message }) => {
      store.clearSessionStreamState(sessionId)
      const current = useSessionStore.getState()
      if (sessionId === current.activeSessionId) {
        useSessionStore.setState((s) => ({ messages: [...s.messages, message] }))
      }
    })

    const unsubError = ipc.query.onError(({ sessionId }) => {
      store.clearSessionStreamState(sessionId)
    })

    const unsubMessagesUpdated = window.electronAPI?.on('session:messages-updated', (_e: unknown, data: unknown) => {
      const { sessionId, messages: msgs } = data as { sessionId: string; messages: any[] }
      const current = useSessionStore.getState()
      if (sessionId === current.activeSessionId) {
        useSessionStore.setState({ messages: msgs })
      }
    }) || (() => {})

    return () => {
      unsubStream()
      unsubTool()
      unsubComplete()
      unsubError()
      unsubMessagesUpdated()
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
    sendMessage,
    abort,
  }
}
