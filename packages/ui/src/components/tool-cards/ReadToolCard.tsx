import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { IconCopy } from '../icons'

export function ReadToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || toolInput.path || '') as string
  const content = event?.result?.content || result?.content || ''
  const lineCount = content ? content.split('\n').length : 0
  const isError = event?.result?.isError || result?.is_error

  const detail = isError ? filePath : filePath + (lineCount > 0 ? ` (${lineCount} lines)` : '')

  return (
    <ToolCardShell
      label="READ"
      detail={detail}
      status={status}
      defaultExpanded={false}
      actions={status === 'done' ? (
        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(filePath) }} className="p-1 rounded-[4px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors" aria-label="Copy path">
          <IconCopy size={12} />
        </button>
      ) : undefined}
    >
      {isError && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--bad)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      )}
      {!isError && content && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {content.split('\n').slice(0, 5).join('\n')}
          {lineCount > 5 && `\n... ${lineCount - 5} more lines`}
        </pre>
      )}
    </ToolCardShell>
  )
}
