import type { ToolExecutionEvent } from '@jdcagnet/core'

interface Props {
  event: ToolExecutionEvent
}

const statusIcons: Record<string, string> = {
  start: '⏳',
  progress: '⚙️',
  complete: '✅',
  error: '❌',
}

export function ToolCard({ event }: Props) {
  const icon = statusIcons[event.type] || '⚙️'
  const isError = event.type === 'error'

  return (
    <div className="mb-2 rounded-md border border-zinc-700 bg-zinc-850 p-2">
      <div className="flex items-center gap-2 text-sm">
        <span>{icon}</span>
        <span className="font-mono text-zinc-300">{event.toolName}</span>
      </div>
      {event.message && (
        <pre className="mt-1 max-h-48 overflow-auto text-xs text-zinc-400 whitespace-pre-wrap">
          {event.message}
        </pre>
      )}
      {event.result && (
        <pre
          className={`mt-1 max-h-48 overflow-auto text-xs whitespace-pre-wrap ${
            isError ? 'text-red-400' : 'text-zinc-400'
          }`}
        >
          {event.result.content}
        </pre>
      )}
    </div>
  )
}
