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
    <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 p-2">
      <div className="flex items-center gap-2 text-sm">
        <span>{icon}</span>
        <span className="font-mono text-gray-600">{event.toolName}</span>
      </div>
      {event.message && (
        <pre className="mt-1 max-h-48 overflow-auto text-xs text-gray-500 whitespace-pre-wrap">
          {event.message}
        </pre>
      )}
      {event.result && (
        <pre
          className={`mt-1 max-h-48 overflow-auto text-xs whitespace-pre-wrap ${
            isError ? 'text-red-400' : 'text-gray-500'
          }`}
        >
          {event.result.content}
        </pre>
      )}
    </div>
  )
}
