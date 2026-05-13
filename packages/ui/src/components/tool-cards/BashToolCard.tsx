import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { truncateText } from './shared'

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
    >
      {status === 'running' && !output && (
        <div className="text-[10px] text-[#666] uppercase tracking-[0.1em]">Running...</div>
      )}
      {output && (
        <pre className={`max-h-[300px] overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap font-mono ${isError ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
          {output}
        </pre>
      )}
    </ToolCardShell>
  )
}
