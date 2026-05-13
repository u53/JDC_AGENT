import { useState } from 'react'
import type { ToolExecutionEvent } from '@jdcagnet/core'

interface Props {
  event: ToolExecutionEvent
}

const statusColors: Record<string, string> = {
  start: 'text-[#EAEAEA]',
  progress: 'text-[#EAEAEA]',
  complete: 'text-[#4AF626]',
  error: 'text-[#E61919]',
}

const statusLabels: Record<string, string> = {
  start: 'RUNNING',
  progress: 'RUNNING',
  complete: 'DONE',
  error: 'ERROR',
}

export function ToolCard({ event }: Props) {
  const isComplete = event.type === 'complete' || event.type === 'error'
  const [expanded, setExpanded] = useState(!isComplete)
  const colorClass = statusColors[event.type] || statusColors.progress
  const label = statusLabels[event.type] || event.type
  const hasContent = !!(event.message || event.result)

  return (
    <div className="mb-3 border border-[#333]">
      <div
        className={`flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em] ${hasContent && isComplete ? 'cursor-pointer hover:bg-[#111]' : ''}`}
        onClick={() => { if (hasContent && isComplete) setExpanded(!expanded) }}
      >
        {hasContent && isComplete && (
          <span className="text-[#666]">{expanded ? '▼' : '▶'}</span>
        )}
        <span className="text-[#EAEAEA]">&gt;&gt;&gt; {event.toolName}</span>
        <span className={colorClass}>[{label}]</span>
      </div>
      {(expanded || !isComplete) && hasContent && (
        <div className="border-t border-[#333] px-3 py-2">
          {event.message && (
            <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#EAEAEA]">
              {event.message}
            </pre>
          )}
          {event.result && (
            <pre className={`max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap ${event.result.isError ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
              {event.result.content}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
