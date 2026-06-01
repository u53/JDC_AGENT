import { useState } from 'react'
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function NotebookEditToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'NotebookEdit'
  const toolInput = event?.input || input || {}
  const notebookPath = (toolInput.notebook_path || '') as string
  const cellNumber = typeof toolInput.cell_number === 'number' ? toolInput.cell_number : undefined
  const editMode = ((toolInput.edit_mode as string | undefined) || 'replace').toUpperCase()
  const cellType = ((toolInput.cell_type as string | undefined) || 'code').toUpperCase()
  const newSource = (toolInput.new_source || '') as string
  const sourceLines = newSource.split('\n')
  const isError = event?.result?.isError || result?.is_error
  const resultContent = event?.result?.content || result?.content || ''
  const [showAll, setShowAll] = useState(false)
  const displayLines = showAll ? sourceLines : sourceLines.slice(0, 8)
  const hasMore = sourceLines.length > displayLines.length

  const detailBits = [
    notebookPath,
    cellNumber !== undefined ? `cell ${cellNumber}` : '',
    editMode.toLowerCase(),
  ].filter(Boolean)

  return (
    <ToolCardShell
      label="NOTEBOOK EDIT"
      detail={detailBits.join(' · ')}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={newSource ? (
        <ToolCopyButton text={newSource} label="Source" title="Copy source" iconOnly />
      ) : undefined}
    >
      <div className="tool-chip-row">
        <span>{editMode}</span>
        <span>{cellType}</span>
        {cellNumber !== undefined && <span>CELL {cellNumber}</span>}
        {sourceLines.length > 0 && editMode !== 'DELETE' && <span>{sourceLines.length} LINES</span>}
      </div>

      {isError && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--bad)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {resultContent}
        </pre>
      )}

      {!isError && editMode === 'DELETE' && (
        <div className="tool-empty-state">Cell will be deleted. No replacement source was provided.</div>
      )}

      {!isError && editMode !== 'DELETE' && newSource && (
        <div className="tool-code-frame max-h-[240px] overflow-auto text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
          <table className="w-full border-collapse">
            <tbody>
              {displayLines.map((line, index) => (
                <tr key={index}>
                  <td className="select-none text-right pr-1 w-[34px] align-top" style={{ color: 'var(--muted)', opacity: 0.5 }}>
                    {index + 1}
                  </td>
                  <td className="select-none w-[16px] text-center" style={{ color: 'var(--good)' }}>+</td>
                  <td className="whitespace-pre-wrap break-all pl-1" style={{ color: 'var(--good)' }}>{line}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <button
              className="tool-show-more"
              onClick={(event) => { event.stopPropagation(); setShowAll(true) }}
            >
              Show {sourceLines.length - displayLines.length} more lines
            </button>
          )}
        </div>
      )}

      {!isError && resultContent && (
        <pre className="mt-2 max-h-32 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {resultContent}
        </pre>
      )}
    </ToolCardShell>
  )
}
