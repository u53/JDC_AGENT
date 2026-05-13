import { useEffect, useRef } from 'react'
import { useSession } from '../hooks/useSession'
import { MessageBubble } from './MessageBubble'
import { ToolCard } from './ToolCard'
import { PromptInput } from './PromptInput'

export function ChatView() {
  const { messages, streamingText, isStreaming, toolEvents, sendMessage, abort } = useSession()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamingText, toolEvents])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {toolEvents.map((event, i) => (
          <ToolCard key={`${event.toolUseId}-${i}`} event={event} />
        ))}

        {streamingText && (
          <div className="mb-3 flex justify-start">
            <div className="max-w-[80%] rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-100">
              {streamingText}
              <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-zinc-400" />
            </div>
          </div>
        )}
      </div>

      <PromptInput onSend={sendMessage} onAbort={abort} isStreaming={isStreaming} />
    </div>
  )
}
