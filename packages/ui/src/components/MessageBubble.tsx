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
        className={`max-w-[80%] rounded-[8px] px-4 py-3 ${
          isUser
            ? 'bg-[#111111] text-white'
            : 'bg-[#F7F6F3] text-[#2F3437] border border-[#EAEAEA]'
        }`}
      >
        {content.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div key={i} className="prose prose-sm max-w-none">
                <ReactMarkdown>{block.text}</ReactMarkdown>
              </div>
            )
          }
          if (block.type === 'tool_use') {
            return (
              <span
                key={i}
                className="inline-block rounded-[4px] bg-[#F7F6F3] border border-[#EAEAEA] px-2 py-0.5 text-xs font-mono text-[#787774] mr-1 mb-1"
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
