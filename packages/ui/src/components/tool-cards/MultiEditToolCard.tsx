import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { computeLineDiff } from './shared'
import { DiffView } from './DiffView'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

interface MultiEditOp {
  old_string?: unknown
  new_string?: unknown
}

function asEditOps(value: unknown): MultiEditOp[] {
  return Array.isArray(value) ? value.filter((item): item is MultiEditOp => typeof item === 'object' && item !== null) : []
}

export function MultiEditToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'MultiEdit'
  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || '') as string
  const edits = asEditOps(toolInput.edits)
  const isError = event?.result?.isError || result?.is_error
  const errorContent = event?.result?.content || result?.content || ''

  const diffSets = edits.map((edit) => {
    const oldString = typeof edit.old_string === 'string' ? edit.old_string : ''
    const newString = typeof edit.new_string === 'string' ? edit.new_string : ''
    const diffLines = computeLineDiff(oldString, newString)
    return {
      diffLines,
      addCount: diffLines.filter((line) => line.type === 'add').length,
      removeCount: diffLines.filter((line) => line.type === 'remove').length,
    }
  })

  const addCount = diffSets.reduce((sum, diff) => sum + diff.addCount, 0)
  const removeCount = diffSets.reduce((sum, diff) => sum + diff.removeCount, 0)
  const detail = filePath
    ? `${filePath} · ${edits.length} edits (+${addCount} -${removeCount})`
    : `${edits.length} edits (+${addCount} -${removeCount})`

  return (
    <ToolCardShell
      label="MULTI EDIT"
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
      {!isError && edits.length > 0 && (
        <div className="tool-edit-stack">
          {diffSets.map((diff, index) => (
            <section key={index} className="tool-edit-block">
              <div className="tool-edit-block-head">
                <span>EDIT {index + 1}</span>
                <span>+{diff.addCount} -{diff.removeCount}</span>
              </div>
              <DiffView diffLines={diff.diffLines} />
            </section>
          ))}
        </div>
      )}
      {!isError && edits.length === 0 && (
        <div className="tool-empty-state">No edit operations in input.</div>
      )}
    </ToolCardShell>
  )
}
