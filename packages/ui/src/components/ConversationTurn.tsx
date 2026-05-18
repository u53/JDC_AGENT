import { useState, useEffect, useRef } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCardRouter } from './tool-cards/ToolCardRouter'
import type { ContentBlock, Message, ToolResultContent, ToolExecutionEvent } from '@jdcagnet/core'

function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="mb-3 border border-[var(--border)] rounded-[8px] bg-[var(--surface-2)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--muted)] hover:bg-[var(--surface-3)] transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full bg-[var(--plan)] ${streaming ? 'animate-pulse' : ''}`} />
        <span>{expanded ? '▼' : '▶'}</span>
        <span>{streaming ? '思考中...' : '思考过程'}</span>
        <span className="ml-auto">{content.length} 字</span>
      </button>
      {expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2 text-[12px] text-[var(--muted)] whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  )
}

interface AssistantPair {
  message: Message
  toolResultMessage?: Message
}

interface Props {
  userContent: ContentBlock[]
  assistantMessages: AssistantPair[]
  isActive?: boolean
  streamingText?: string
  thinkingText?: string
  isThinking?: boolean
  toolEvents?: ToolExecutionEvent[]
}

function findToolResult(
  toolUseId: string,
  toolResultMessage?: Message
): { content: string; is_error?: boolean } | undefined {
  if (!toolResultMessage || toolResultMessage.role !== 'user') return undefined
  const block = toolResultMessage.content.find(
    (b): b is ToolResultContent => b.type === 'tool_result' && b.tool_use_id === toolUseId
  )
  if (!block) return undefined
  return { content: block.content, is_error: block.is_error }
}

export function ConversationTurn({
  userContent,
  assistantMessages,
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
        {/* Thinking indicator — live, expandable */}
        {isActive && isThinking && thinkingText && (
          <ThinkingBlock content={thinkingText} streaming />
        )}

        {/* Completed assistant messages: render all pairs in order */}
        {assistantMessages.map((pair, pairIdx) => {
          const isLastPair = pairIdx === assistantMessages.length - 1
          const skipToolUse = isActive && isLastPair && toolEvents && toolEvents.length > 0

          return (
          <div key={pair.message.id}>
            {pair.message.content.map((block, i) => {
              if (block.type === 'text' && !block.text.startsWith('__STATS__')) {
                return (
                  <div key={i} className="text-[14px] mb-3">
                    <MarkdownRenderer content={block.text} />
                  </div>
                )
              }
              if (block.type === 'tool_use') {
                if (skipToolUse && !findToolResult(block.id, pair.toolResultMessage)) return null
                return (
                  <div key={block.id} className="mb-2">
                    <ToolCardRouter
                      name={block.name}
                      input={block.input}
                      result={findToolResult(block.id, pair.toolResultMessage)}
                    />
                  </div>
                )
              }
              if (block.type === 'thinking') {
                return <ThinkingBlock key={`thinking-${i}`} content={block.thinking} />
              }
              return null
            })}
          </div>
          )
        })}

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
