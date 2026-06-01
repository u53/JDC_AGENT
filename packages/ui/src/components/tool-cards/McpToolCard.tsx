import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { parseMcpToolName } from './shared'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function McpToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)

  const toolName = event?.toolName || name || ''
  const parsed = parseMcpToolName(toolName)
  const displayName = parsed ? `${parsed.server}::${parsed.tool}` : toolName

  const toolInput = event?.input || input || {}
  const content = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const inputEntries = Object.entries(toolInput).slice(0, 5)

  return (
    <ToolCardShell
      label="MCP"
      detail={displayName}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={content ? (
        <ToolCopyButton text={content} label="Result" title="Copy result" iconOnly />
      ) : undefined}
    >
      {inputEntries.length > 0 && (
        <div className="tool-kv-grid">
          {inputEntries.map(([key, val]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{typeof val === 'string' ? val : JSON.stringify(val)}</strong>
            </div>
          ))}
        </div>
      )}
      {content && (
        <pre className={`tool-result-pre ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      )}
    </ToolCardShell>
  )
}
