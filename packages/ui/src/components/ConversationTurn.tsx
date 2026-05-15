import { useState, useEffect, useRef } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCardRouter } from './tool-cards/ToolCardRouter'
import type { ContentBlock, Message, ToolResultContent, ToolExecutionEvent } from '@jdcagnet/core'

interface Props {
  userContent: ContentBlock[]
  assistantContent: ContentBlock[]
  nextMessage?: Message
  isActive?: boolean
  streamingText?: string
  thinkingText?: string
  isThinking?: boolean
  toolEvents?: ToolExecutionEvent[]
}

function findToolResult(
  toolUseId: string,
  nextMessage?: Message
): { content: string; is_error?: boolean } | undefined {
  if (!nextMessage || nextMessage.role !== 'user') return undefined
  const block = nextMessage.content.find(
    (b): b is ToolResultContent => b.type === 'tool_result' && b.tool_use_id === toolUseId
  )
  if (!block) return undefined
  return { content: block.content, is_error: block.is_error }
}

export function ConversationTurn({
  userContent,
  assistantContent,
  nextMessage,
  isActive,
  streamingText,
  thinkingText,
  isThinking,
  toolEvents,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const prevIsActive = useRef(isActive)

  useEffect(() => {
    if (prevIsActive.current && !isActive) {
      setExpanded(true)
    }
    prevIsActive.current = isActive
  }, [isActive])

  useEffect(() => {
    if (isActive) setExpanded(false)
  }, [isActive])

  return (
    <div className="py-5 border-b border-[var(--border)]">
      {/* User input section */}
      <div className="border-l-2 border-[var(--accent)] pl-4 mb-4">
        {userContent.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div key={i} className="text-[14px] whitespace-pre-wrap text-[var(--text)]">
                {block.text}
              </div>
            )
          }
          if (block.type === 'image') {
            return (
              <img
                key={i}
                src={`data:${block.source.media_type};base64,${block.source.data}`}
                alt="User attachment"
                className="rounded-[8px] max-w-full max-h-64 mt-2"
              />
            )
          }
          return null
        })}
      </div>

      {/* Assistant section */}
      <div className="pl-4">
        {/* Thinking indicator */}
        {isActive && isThinking && thinkingText && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--muted)] mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--plan)] animate-pulse" />
            <span>Thinking... ({thinkingText.length} chars)</span>
          </div>
        )}

        {/* Completed turns: text first, then tool blocks */}
        {!isActive &&
          assistantContent
            .filter(
              (b): b is Extract<ContentBlock, { type: 'text' }> =>
                b.type === 'text' && !b.text.startsWith('__STATS__')
            )
            .map((block, i) => (
              <div key={i} className="text-[14px] mb-3">
                <MarkdownRenderer content={block.text} />
              </div>
            ))}

        {!isActive && assistantContent
          .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
          .map((block) => (
            <div key={block.id} className="mb-2">
              <ToolCardRouter
                name={block.name}
                input={block.input}
                result={findToolResult(block.id, nextMessage)}
              />
            </div>
          ))}

        {/* Active turn: streaming tool events (tools execute before final text) */}
        {isActive && toolEvents && toolEvents.length > 0 && (
          <div className="mb-3">
            {toolEvents.map((event, i) => (
              <div key={`${event.toolUseId}-${i}`} className="mb-2">
                <ToolCardRouter event={event} />
              </div>
            ))}
          </div>
        )}

        {/* Streaming text — below tools (it's the latest output) */}
        {isActive && streamingText && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-2 w-full border border-[var(--border)] rounded-[8px] px-3 py-2 text-[12px] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
            <span>正在生成... {streamingText.length} 字</span>
            <span className="ml-auto text-[10px]">点击展开</span>
          </button>
        )}

        {isActive && streamingText && expanded && (
          <div className="text-[14px]">
            <button
              onClick={() => setExpanded(false)}
              className="flex items-center gap-2 mb-2 text-[11px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              <span>生成中 {streamingText.length} 字</span>
              <span>· 收起</span>
            </button>
            <MarkdownRenderer content={streamingText} />
            <span className="inline-block w-[2px] h-[14px] bg-[var(--accent)] animate-pulse ml-0.5 align-middle" />
          </div>
        )}
      </div>
    </div>
  )
}
