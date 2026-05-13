import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCardRouter } from './tool-cards'
import type { ContentBlock, Message } from '@jdcagnet/core'

interface Props {
  role: 'user' | 'assistant'
  content: ContentBlock[]
  nextMessage?: Message
}

export function MessageBubble({ role, content, nextMessage }: Props) {
  const isUser = role === 'user'

  const findToolResult = (toolUseId: string) => {
    if (!nextMessage || nextMessage.role !== 'user') return undefined
    const block = nextMessage.content.find(
      (b: any) => b.type === 'tool_result' && b.tool_use_id === toolUseId
    ) as any
    if (!block) return undefined
    return { content: block.content, is_error: block.is_error }
  }

  const textBlocks = content.filter(b => b.type === 'text' || b.type === 'image')
  const toolUseBlocks = content.filter(b => b.type === 'tool_use')

  return (
    <div className="mb-4">
      {textBlocks.length > 0 && (
        <div className={isUser ? 'border-l-2 border-[#666] pl-4' : 'pl-4'}>
          {isUser && (
            <div className="text-[10px] uppercase tracking-[0.1em] text-[#666] mb-1">&gt; USER</div>
          )}
          {textBlocks.map((block, i) => {
            if (block.type === 'text') {
              if (isUser) {
                return (
                  <p key={i} className="text-sm text-[#EAEAEA] whitespace-pre-wrap">
                    {block.text}
                  </p>
                )
              }
              return (
                <div key={i} className="prose prose-sm prose-invert max-w-none">
                  <MarkdownRenderer content={block.text} />
                </div>
              )
            }
            if (block.type === 'image') {
              return (
                <img
                  key={i}
                  src={`data:${block.source.media_type};base64,${block.source.data}`}
                  className="max-w-sm max-h-64 border border-[#333] my-2"
                  alt="Attached image"
                />
              )
            }
            return null
          })}
        </div>
      )}
      {toolUseBlocks.length > 0 && (
        <div className="mt-2">
          {toolUseBlocks.map((block, i) => {
            if (block.type === 'tool_use') {
              return (
                <ToolCardRouter
                  key={i}
                  name={block.name}
                  input={block.input}
                  result={findToolResult(block.id)}
                />
              )
            }
            return null
          })}
        </div>
      )}
      <div className="border-b border-[#1a1a1a] mt-4" />
    </div>
  )
}
