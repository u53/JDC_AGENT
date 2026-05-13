import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'

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
    >
      {isError && (
        <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#E61919]">
          {content}
        </pre>
      )}
      {!isError && content && (
        <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#EAEAEA]">
          {content.split('\n').slice(0, 5).join('\n')}
          {lineCount > 5 && `\n... ${lineCount - 5} more lines`}
        </pre>
      )}
    </ToolCardShell>
  )
}
