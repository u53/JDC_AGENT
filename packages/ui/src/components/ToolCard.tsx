import type { ToolExecutionEvent } from '@jdcagnet/core'

interface Props {
  event: ToolExecutionEvent
}

const statusColors: Record<string, string> = {
  start: 'bg-[#E1F3FE] text-[#1A6FA3]',
  progress: 'bg-[#E1F3FE] text-[#1A6FA3]',
  complete: 'bg-[#EDF3EC] text-[#2D6A2D]',
  error: 'bg-[#FDEBEC] text-[#9F2F2D]',
}

const statusLabels: Record<string, string> = {
  start: 'running',
  progress: 'running',
  complete: 'done',
  error: 'error',
}

export function ToolCard({ event }: Props) {
  const colorClass = statusColors[event.type] || statusColors.progress
  const label = statusLabels[event.type] || event.type

  return (
    <div className="mb-3 rounded-[8px] border border-[#EAEAEA] bg-[#F9F9F8] p-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono text-sm text-[#2F3437]">{event.toolName}</span>
        <span className={`rounded-[4px] px-1.5 py-0.5 text-xs font-medium ${colorClass}`}>
          {label}
        </span>
      </div>
      {event.message && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-[6px] bg-[#F7F6F3] p-3 text-xs font-mono text-[#787774] whitespace-pre-wrap">
          {event.message}
        </pre>
      )}
      {event.result && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-[6px] bg-[#F7F6F3] p-3 text-xs font-mono whitespace-pre-wrap text-[#787774]">
          {event.result.content}
        </pre>
      )}
    </div>
  )
}
