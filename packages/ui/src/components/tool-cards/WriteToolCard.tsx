import { useState } from 'react'
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function WriteToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'Write'

  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || '') as string
  const content = (toolInput.content || '') as string
  const lines = content.split('\n')
  const isError = event?.result?.isError || result?.is_error
  const errorContent = event?.result?.content || result?.content || ''

  const [showAll, setShowAll] = useState(false)
  const displayLines = showAll ? lines : lines.slice(0, 5)
  const hasMore = lines.length > 10

  return (
    <ToolCardShell
      label="WRITE"
      detail={`${filePath} (${lines.length} lines)`}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={content ? (
        <ToolCopyButton text={content} label="Content" title="Copy content" iconOnly />
      ) : undefined}
    >
      {isError && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--bad)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {errorContent}
        </pre>
      )}
      {!isError && lines.length > 0 && (
        <div className="tool-code-frame max-h-[260px] overflow-auto text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
          <table className="w-full border-collapse">
            <tbody>
              {displayLines.map((line, i) => (
                <tr key={i}>
                  <td className="select-none text-right pr-1 w-[30px] align-top" style={{ color: 'var(--muted)', opacity: 0.5 }}>
                    {i + 1}
                  </td>
                  <td className="select-none w-[14px] text-center" style={{ color: 'var(--good)' }}>+</td>
                  <td className="whitespace-pre-wrap break-all pl-1" style={{ color: 'var(--good)' }}>{line}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && !showAll && (
            <div
              className="text-[var(--muted)] cursor-pointer hover:text-[var(--text)] mt-1 pl-[74px]"
              onClick={(e) => { e.stopPropagation(); setShowAll(true) }}
            >
              ... {lines.length - 5} more lines
            </div>
          )}
        </div>
      )}
    </ToolCardShell>
  )
}
