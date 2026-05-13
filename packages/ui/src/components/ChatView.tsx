import { useEffect, useRef, useState } from 'react'
import { useSession } from '../hooks/useSession'
import { MessageBubble } from './MessageBubble'
import { ToolCard } from './ToolCard'
import { PromptInput } from './PromptInput'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'

export function ChatView() {
  const { messages, streamingText, isStreaming, toolEvents, sendMessage, abort } = useSession()
  const { activeSessionId } = useSessionStore()
  const { getActiveModel } = useModelStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [permissionMode, setPermissionMode] = useState('standard')

  const activeModel = getActiveModel()

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamingText, toolEvents])

  const visibleMessages = messages.filter(msg => {
    if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.every((b: any) => b.type === 'tool_result')) return false
    return true
  })

  const handleSlashCommand = (command: string) => {
    if (command === '/compact') {
      sendMessage('/compact')
    } else if (command === '/clear') {
      // TODO: implement clear
    } else if (command === '/help') {
      sendMessage('Show me available commands and how to use this tool.')
    } else if (command === '/status') {
      sendMessage('Show current session status, token usage, and context info.')
    } else {
      sendMessage(command)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-center border-b border-[#333] px-4 py-2" style={{ WebkitAppRegion: 'drag' } as any}>
        <span className="text-[10px] uppercase tracking-[0.1em] text-[#666]">
          SESSION // {activeSessionId ? activeSessionId.slice(0, 8).toUpperCase() : '---'}
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[760px]">
          {visibleMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              nextMessage={messages[messages.indexOf(msg) + 1]}
            />
          ))}

          {toolEvents.map((event, i) => (
            <ToolCard key={`${event.toolUseId}-${i}`} event={event} />
          ))}

          {streamingText && (
            <div className="mb-4 border-l border-[#333] pl-4">
              <div className="text-sm text-[#EAEAEA] whitespace-pre-wrap">
                {streamingText}
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[#EAEAEA]" />
              </div>
            </div>
          )}
        </div>
      </div>

      <PromptInput
        onSend={sendMessage}
        onAbort={abort}
        isStreaming={isStreaming}
        onSlashCommand={handleSlashCommand}
        permissionMode={permissionMode}
        onPermissionChange={setPermissionMode}
        modelName={activeModel?.model.name}
      />
    </div>
  )
}
