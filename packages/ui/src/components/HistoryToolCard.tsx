import { useState } from 'react'

interface Props {
  name: string
  input: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}

export function HistoryToolCard({ name, input, result }: Props) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = !!(Object.keys(input).length || result)

  return (
    <div className="my-2 border border-[#333]">
      <div
        className={`flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em] ${hasContent ? 'cursor-pointer hover:bg-[#111]' : ''}`}
        onClick={() => { if (hasContent) setExpanded(!expanded) }}
      >
        {hasContent && (
          <span className="text-[#666]">{expanded ? '▼' : '▶'}</span>
        )}
        <span className="text-[#EAEAEA]">&gt;&gt;&gt; {name}</span>
        <span className={result ? (result.is_error ? 'text-[#E61919]' : 'text-[#4AF626]') : 'text-[#666]'}>
          [{result ? (result.is_error ? 'ERROR' : 'DONE') : 'DONE'}]
        </span>
      </div>
      {expanded && hasContent && (
        <div className="border-t border-[#333] px-3 py-2 space-y-2">
          {Object.keys(input).length > 0 && (
            <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#EAEAEA]">
              {JSON.stringify(input, null, 2)}
            </pre>
          )}
          {result && (
            <pre className={`max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap ${result.is_error ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
              {result.content}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
