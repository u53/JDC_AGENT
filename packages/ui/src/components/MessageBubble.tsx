import ReactMarkdown from 'react-markdown'
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
            return (
              <div key={i} className="prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{block.text}</ReactMarkdown>
              </div>
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
