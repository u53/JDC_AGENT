import { useState } from 'react'
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'

export function WriteToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || '') as string
  const content = (toolInput.content || '') as string
  const lines = content.split('\n')
  const isError = event?.result?.isError || result?.is_error
  const errorContent = event?.result?.content || result?.content || ''

  const [showAll, setShowAll] = useState(false)
  const displayLines = showAll ? lines : lines.slice(0, 5)
  const hasMore = lines.length > 10

  return (
    <ToolCardShell
      label="WRITE"
      detail={`${filePath} (${lines.length} lines)`}
      status={status}
      defaultExpanded={status === 'running'}
    >
      {isError && (
        <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#E61919]">
          {errorContent}
        </pre>
      )}
      {!isError && lines.length > 0 && (
        <div className="max-h-[300px] overflow-auto bg-[#050505] p-2 text-xs font-mono">
          {displayLines.map((line, i) => (
            <div key={i} className="bg-green-900/20 text-green-400">
              <span className="select-none inline-block w-4">+</span>
              {line}
            </div>
          ))}
          {hasMore && !showAll && (
            <div
              className="text-[#666] cursor-pointer hover:text-[#EAEAEA] mt-1"
              onClick={(e) => { e.stopPropagation(); setShowAll(true) }}
            >
              ... {lines.length - 5} more lines
            </div>
          )}
        </div>
      )}
    </ToolCardShell>
  )
}
