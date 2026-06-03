import { memo, useState, useEffect, useRef } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCardRouter } from './tool-cards/ToolCardRouter'
import type { ContentBlock, Message, ToolResultContent, ToolExecutionEvent } from '@jdcagnet/core'

function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="aux-card mb-3" data-tone="plan">
      <button
        onClick={() => setExpanded(!expanded)}
        className="aux-card-header"
      >
        <span className={`aux-card-dot ${streaming ? 'is-live' : ''}`} />
        <span className="aux-card-caret">{expanded ? '▼' : '▶'}</span>
        <span className="aux-card-label">{streaming ? '思考中...' : '思考过程'}</span>
        <span className="aux-card-chip">{content.length} 字</span>
      </button>
      {expanded && (
        <div className="aux-card-body whitespace-pre-wrap max-h-[300px] overflow-y-auto">
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

function ConversationTurnView({
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
        {/* Completed assistant messages: render all pairs in order */}
        {assistantMessages.map((pair, pairIdx) => {
          const isLastPair = pairIdx === assistantMessages.length - 1
          const skipToolUse = isActive && isLastPair && toolEvents && toolEvents.length > 0

          return (
          <div key={pair.message.id}>
            {pair.message.content.map((block, i) => {
              if (block.type === 'text' && !block.text.startsWith('__STATS__') && !block.text.startsWith('<ide-context>')) {
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

        {/* Live thinking — appears at the BOTTOM (after prior turns + their tools),
            because the current thinking belongs to the in-flight turn. */}
        {isActive && isThinking && thinkingText && (
          <ThinkingBlock content={thinkingText} streaming />
        )}

        {/* Streaming text — below tools (it's the latest output) */}
        {isActive && streamingText && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="aux-card aux-card-header w-full"
            data-tone="accent"
          >
            <span className="aux-card-dot is-live" />
            <span className="aux-card-label">正在生成... {streamingText.length} 字</span>
            <span className="aux-card-chip">点击展开</span>
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
            <pre className="whitespace-pre-wrap break-words font-[var(--font-sans)] text-[var(--text)]">{streamingText}</pre>
            <span className="inline-block w-[2px] h-[14px] bg-[var(--accent)] animate-pulse ml-0.5 align-middle" />
          </div>
        )}
      </div>
    </div>
  )
}

export const ConversationTurn = memo(ConversationTurnView)
