import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { truncateText } from './shared'
import { copyToClipboard } from '../../lib/clipboard'

export function BashToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const command = (event?.input?.command || input?.command || '') as string
  const output = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const displayCommand = truncateText(command, 60)

  return (
    <ToolCardShell
      label="BASH"
      detail={`$ ${displayCommand}`}
      status={status}
      defaultExpanded={status === 'running'}
      actions={status === 'done' ? (
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); copyToClipboard(command) }} className="px-1.5 py-0.5 rounded-[4px] text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors">Copy cmd</button>
          {output && <button onClick={(e) => { e.stopPropagation(); copyToClipboard(output) }} className="px-1.5 py-0.5 rounded-[4px] text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors">Copy output</button>}
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
