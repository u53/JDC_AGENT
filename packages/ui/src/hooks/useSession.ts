import { useState, useEffect, useCallback } from 'react'
import { useSessionStore } from '../stores/session-store'
import { ipc } from '../lib/ipc-client'
import type { ToolExecutionEvent } from '@jdcagnet/core'

export function useSession() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const messages = useSessionStore((s) => s.messages)
  const [streamingText, setStreamingText] = useState('')
  const [thinkingText, setThinkingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [toolEvents, setToolEvents] = useState<ToolExecutionEvent[]>([])

  useEffect(() => {
    const unsubStream = ipc.query.onStream(({ sessionId, chunk }) => {
      if (sessionId !== activeSessionId) return
      if (chunk.type === 'thinking_delta' && chunk.text) {
        setIsThinking(true)
        setThinkingText((prev) => prev + chunk.text)
      } else if (chunk.type === 'text_delta' && chunk.text) {
        setIsThinking(false)
        setStreamingText((prev) => prev + chunk.text)
      }
    })

    const unsubTool = ipc.query.onToolEvent(({ sessionId, event }) => {
      if (sessionId !== activeSessionId) return
      setToolEvents((prev) => [...prev, event])
    })

    const unsubComplete = ipc.query.onComplete(({ sessionId, message }) => {
      if (sessionId !== activeSessionId) return
      setStreamingText('')
      setThinkingText('')
      setIsStreaming(false)
      setIsThinking(false)
      setToolEvents([])
      useSessionStore.setState((s) => ({ messages: [...s.messages, message] }))
    })

    const unsubError = ipc.query.onError(({ sessionId }) => {
      if (sessionId !== activeSessionId) return
      setStreamingText('')
      setThinkingText('')
      setIsStreaming(false)
      setIsThinking(false)
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
      setIsStreaming(true)
      await ipc.query.send(activeSessionId, text, images)
    },
    [activeSessionId]
  )

  const abort = useCallback(() => {
    if (!activeSessionId) return
    ipc.query.abort(activeSessionId)
  }, [activeSessionId])

  return { messages, streamingText, thinkingText, isStreaming, isThinking, toolEvents, sendMessage, abort }
}
