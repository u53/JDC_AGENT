import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import {
  deriveToolStatus,
  formatToolLabel,
  getToolVariant,
  shouldShowToolRail,
  stringValue,
} from './tool-card-meta'

function resultCount(content: string): string {
  if (!content || /^No (matches|files|results)/i.test(content.trim())) return '0 results'
  const lines = content.split('\n').filter((line) => line.trim() && !line.startsWith('(truncated'))
  return `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`
}

function searchDetail(toolName: string, input: Record<string, unknown>, content: string): string {
  if (toolName === 'Grep') {
    const path = stringValue(input.path) || '.'
    const glob = stringValue(input.glob)
    const suffix = glob ? ` · ${glob}` : ''
    return `${stringValue(input.pattern) || '(pattern)'} in ${path}${suffix} · ${resultCount(content)}`
  }
  if (toolName === 'Glob') {
    return `${stringValue(input.pattern) || '(pattern)'} · ${resultCount(content)}`
  }
  if (toolName === 'LS') {
    return `${stringValue(input.path) || '.'} · ${resultCount(content)}`
  }
  if (toolName === 'Tree') {
    const depth = input.depth ? ` · depth ${String(input.depth)}` : ''
    return `${stringValue(input.path) || '.'}${depth}`
  }
  if (toolName === 'LSP') {
    const operation = stringValue(input.operation) || 'operation'
    const file = stringValue(input.filePath)
    const line = input.line ? `:${String(input.line)}` : ''
    const query = stringValue(input.query)
    return query ? `${operation} · ${query}` : `${operation} · ${file}${line}`
  }
  return toolName
}

export function SearchToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'Search'
  const toolInput = (event?.input || input || {}) as Record<string, unknown>
  const content = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error
  const entries = Object.entries(toolInput).filter(([, value]) => value !== undefined && value !== '')

  return (
    <ToolCardShell
      label={formatToolLabel(toolName)}
      detail={searchDetail(toolName, toolInput, content)}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={content ? (
        <ToolCopyButton text={content} label="Result" title="Copy result" iconOnly />
      ) : undefined}
    >
      {entries.length > 0 && (
        <div className="tool-kv-grid">
          {entries.slice(0, 6).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{typeof value === 'string' ? value : JSON.stringify(value)}</strong>
            </div>
          ))}
        </div>
      )}
      {content ? (
        <pre className={`tool-result-pre ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      ) : status === 'running' ? (
        <div className="tool-empty-state">Searching...</div>
      ) : (
        <div className="tool-empty-state">No result content.</div>
      )}
    </ToolCardShell>
  )
}
