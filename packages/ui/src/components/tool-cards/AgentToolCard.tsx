import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { truncateText } from './shared'

export function AgentToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const prompt = (toolInput.prompt || '') as string
  const taskDescription = truncateText(prompt, 50)
  const resultContent = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  return (
    <ToolCardShell
      label="AGENT"
      labelColor="text-purple-300"
      detail={taskDescription}
      status={status}
      borderColor="border-purple-800/50"
      defaultExpanded={status === 'running'}
      actions={
        status === 'running' ? (
          <button
            className="text-[10px] uppercase tracking-[0.05em] text-red-500 hover:text-red-400 transition-colors ml-2"
            onClick={(e) => { e.stopPropagation() }}
          >
            [ABORT]
          </button>
        ) : undefined
      }
    >
      {status === 'running' && (
        <div className="text-[10px] text-purple-400 uppercase tracking-[0.1em]">
          <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse mr-2" />
          Processing...
        </div>
      )}
      {status !== 'running' && resultContent && (
        <pre className={`max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap ${isError ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
          {truncateText(resultContent, 500)}
        </pre>
      )}
    </ToolCardShell>
  )
}
