import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { truncateText } from './shared'
import { deriveToolStatus, formatToolLabel, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function BashToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'Bash'

  const command = (event?.input?.command || input?.command || '') as string
  const description = (event?.input?.description || input?.description || '') as string
  const output = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const displayCommand = truncateText(command, 60)
  const detail = toolName === 'Monitor' && description
    ? `${description} · ${displayCommand}`
    : `$ ${displayCommand}`

  return (
    <ToolCardShell
      label={formatToolLabel(toolName)}
      detail={detail}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={status === 'done' ? (
        <div className="flex items-center gap-1">
          <ToolCopyButton text={command} label="Cmd" copiedLabel="Copied" title="Copy command" toastLabel="Command" />
          {output && <ToolCopyButton text={output} label="Output" copiedLabel="Copied" title="Copy output" toastLabel="Output" />}
        </div>
      ) : undefined}
    >
      {status === 'running' && !output && (
        <div className="text-[10px] text-[var(--muted)] uppercase tracking-[0.1em]">Running...</div>
      )}
      {output && (
        <pre className={`max-h-[300px] overflow-auto p-2 text-[12px] whitespace-pre-wrap ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {output}
        </pre>
      )}
    </ToolCardShell>
  )
}
