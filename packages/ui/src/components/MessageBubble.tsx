import { MarkdownRenderer } from './MarkdownRenderer'
import type { ContentBlock } from '@jdcagnet/core'

interface Props {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

export function MessageBubble({ role, content }: Props) {
  const isUser = role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] px-4 py-3 text-sm ${
          isUser
            ? 'border border-[#EAEAEA] text-[#EAEAEA]'
            : 'border border-[#333] bg-[#111] text-[#EAEAEA]'
        }`}
      >
        {content.map((block, i) => {
          if (block.type === 'text') {
            if (isUser) {
              return (
                <p key={i} className="whitespace-pre-wrap">
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
          if (block.type === 'tool_use') {
            return (
              <span
                key={i}
                className="inline-block border border-[#333] px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] text-[#666] mr-1 mb-1"
              >
                {block.name}
              </span>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
