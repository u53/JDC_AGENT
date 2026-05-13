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
  const colorClass = statusColors[event.type] || statusColors.progress
  const label = statusLabels[event.type] || event.type

  return (
    <div className="mb-3 border border-[#333] p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
        <span className="text-[#EAEAEA]">&gt;&gt;&gt; {event.toolName}</span>
        <span className={colorClass}>
          [{label}]
        </span>
      </div>
      {event.message && (
        <pre className="mt-2 max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#EAEAEA]">
          {event.message}
        </pre>
      )}
      {event.result && (
        <pre className="mt-2 max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#EAEAEA]">
          {event.result.content}
        </pre>
      )}
    </div>
  )
}
