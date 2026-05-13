import { useState, useEffect, useCallback } from 'react'
import { useSessionStore } from '../stores/session-store'
import { ipc } from '../lib/ipc-client'
import type { ToolExecutionEvent } from '@jdcagnet/core'

export function useSession() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const messages = useSessionStore((s) => s.messages)
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [toolEvents, setToolEvents] = useState<ToolExecutionEvent[]>([])

  useEffect(() => {
    const unsubStream = ipc.query.onStream(({ sessionId, chunk }) => {
      if (sessionId !== activeSessionId) return
      if (chunk.text) setStreamingText((prev) => prev + chunk.text)
    })

    const unsubTool = ipc.query.onToolEvent(({ sessionId, event }) => {
      if (sessionId !== activeSessionId) return
      setToolEvents((prev) => [...prev, event])
    })

    const unsubComplete = ipc.query.onComplete(({ sessionId, message }) => {
      if (sessionId !== activeSessionId) return
      setStreamingText('')
      setIsStreaming(false)
      setToolEvents([])
      useSessionStore.setState((s) => ({ messages: [...s.messages, message] }))
    })

    const unsubError = ipc.query.onError(({ sessionId }) => {
      if (sessionId !== activeSessionId) return
      setStreamingText('')
      setIsStreaming(false)
      setToolEvents([])
    })

    return () => {
      unsubStream()
      unsubTool()
      unsubComplete()
      unsubError()
    }
  }, [activeSessionId])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!activeSessionId) return
      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content: [{ type: 'text' as const, text }],
        timestamp: Date.now(),
      }
      useSessionStore.setState((s) => ({ messages: [...s.messages, userMessage] }))
      setIsStreaming(true)
      await ipc.query.send(activeSessionId, text)
    },
    [activeSessionId]
  )

  const abort = useCallback(() => {
    if (!activeSessionId) return
    ipc.query.abort(activeSessionId)
  }, [activeSessionId])

  return { messages, streamingText, isStreaming, toolEvents, sendMessage, abort }
}
