import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function ReadToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'Read'

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
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={status === 'done' && filePath ? (
        <ToolCopyButton text={filePath} label="Path" title="Copy path" iconOnly />
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
