import ReactMarkdown from 'react-markdown'
import type { ContentBlock } from '@jdcagnet/core'

interface Props {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

export function MessageBubble({ role, content }: Props) {
  const isUser = role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-100'
        }`}
      >
        {content.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div key={i} className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>{block.text}</ReactMarkdown>
              </div>
            )
          }
          if (block.type === 'tool_use') {
            return (
              <span
                key={i}
                className="inline-block rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300 mr-1 mb-1"
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
