import { useEffect, useRef } from 'react'
import { useSession } from '../hooks/useSession'
import { MessageBubble } from './MessageBubble'
import { ToolCard } from './ToolCard'
import { PromptInput } from './PromptInput'
import { ModelSwitcher } from './ModelSwitcher'
import { useSessionStore } from '../stores/session-store'

export function ChatView() {
  const { messages, streamingText, isStreaming, toolEvents, sendMessage, abort } = useSession()
  const { activeSessionId } = useSessionStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamingText, toolEvents])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#333] px-4 py-2">
        <span className="text-[10px] uppercase tracking-[0.1em] text-[#EAEAEA]">
          &lt; SESSION {activeSessionId ? activeSessionId.slice(0, 8).toUpperCase() : ''} &gt;
        </span>
        <ModelSwitcher />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[720px]">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
          ))}

          {toolEvents.map((event, i) => (
            <ToolCard key={`${event.toolUseId}-${i}`} event={event} />
          ))}

          {streamingText && (
            <div className="mb-4 flex justify-start">
              <div className="max-w-[80%] border border-[#333] bg-[#111] px-4 py-3 text-sm">
                {streamingText}
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[#EAEAEA]" />
              </div>
            </div>
          )}
        </div>
      </div>

      <PromptInput onSend={sendMessage} onAbort={abort} isStreaming={isStreaming} />
    </div>
  )
}
