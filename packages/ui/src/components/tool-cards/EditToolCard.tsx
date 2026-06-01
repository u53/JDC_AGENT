import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { computeLineDiff } from './shared'
import { DiffView } from './DiffView'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function EditToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'Edit'

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
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
    >
      {isError && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--bad)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {errorContent}
        </pre>
      )}
      {!isError && diffLines.length > 0 && (
        <DiffView diffLines={diffLines} />
      )}
    </ToolCardShell>
  )
}
