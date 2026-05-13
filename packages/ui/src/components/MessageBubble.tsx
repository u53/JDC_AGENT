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
          isUser ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
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
                className="inline-block rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600 mr-1 mb-1"
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
