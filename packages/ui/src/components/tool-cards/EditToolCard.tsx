import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { computeLineDiff } from './shared'

export function EditToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || '') as string
  const oldString = (toolInput.old_string || '') as string
  const newString = (toolInput.new_string || '') as string
  const errorContent = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const diffLines = oldString || newString ? computeLineDiff(oldString, newString) : []
  const addCount = diffLines.filter(l => l.type === 'add').length
  const removeCount = diffLines.filter(l => l.type === 'remove').length
  const summary = `+${addCount} -${removeCount}`

  const detail = filePath ? `${filePath} (${summary})` : ''

  return (
    <ToolCardShell
      label="EDIT"
      detail={detail}
      status={status}
      defaultExpanded={status === 'running'}
    >
      {isError && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--bad)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {errorContent}
        </pre>
      )}
      {!isError && diffLines.length > 0 && (
        <div className="max-h-[300px] overflow-auto p-2 text-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={
                line.type === 'add'
                  ? 'bg-green-900/20 text-green-400'
                  : line.type === 'remove'
                  ? 'bg-red-900/20 text-red-400'
                  : 'text-[var(--muted)]'
              }
            >
              <span className="select-none inline-block w-4">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
              </span>
              {line.content}
            </div>
          ))}
        </div>
      )}
    </ToolCardShell>
  )
}
