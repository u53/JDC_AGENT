import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCardRouter } from './tool-cards/ToolCardRouter'
import type { ContentBlock, Message, ToolResultContent } from '@jdcagnet/core'

interface Props {
  userContent: ContentBlock[]
  assistantContent: ContentBlock[]
  nextMessage?: Message
  isActive?: boolean
  streamingText?: string
  thinkingText?: string
  isThinking?: boolean
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
}: Props) {
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

        {/* Tool use blocks */}
        {assistantContent
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

        {/* Streaming text */}
        {isActive && streamingText && (
          <div className="text-[14px]">
            <MarkdownRenderer content={streamingText} />
            <span className="inline-block w-[2px] h-[14px] bg-[var(--accent)] animate-pulse ml-0.5 align-middle" />
          </div>
        )}

        {/* Completed text blocks */}
        {!isActive &&
          assistantContent
            .filter(
              (b): b is Extract<ContentBlock, { type: 'text' }> =>
                b.type === 'text' && !b.text.startsWith('__STATS__')
            )
            .map((block, i) => (
              <div key={i} className="text-[14px]">
                <MarkdownRenderer content={block.text} />
              </div>
            ))}
      </div>
    </div>
  )
}
