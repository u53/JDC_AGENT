import { useEffect } from 'react'
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { truncateText } from './shared'
import { useAgentStore } from '../../stores/agent-store'
import { useSessionStore } from '../../stores/session-store'
import { ipc } from '../../lib/ipc-client'

export function AgentToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const prompt = (toolInput.prompt || '') as string
  const taskDescription = truncateText(prompt, 50)
  const resultContent = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error
  const toolUseId = event?.toolUseId || ''

  const agentState = useAgentStore((s) => toolUseId ? s.agents[toolUseId] : null)
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent)
  const addAgent = useAgentStore((s) => s.addAgent)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  useEffect(() => {
    if (toolUseId && status === 'running' && !agentState) {
      addAgent(toolUseId, prompt)
    }
  }, [toolUseId, status])

  const recentTools = agentState?.toolEvents.slice(-3) || []
  const toolCount = agentState?.toolCount || 0

  const handleClick = () => {
    if (toolUseId) {
      setActiveAgent(toolUseId)
    }
  }

  const handleAbort = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (activeSessionId && toolUseId) {
      ipc.agent.abort(activeSessionId, toolUseId)
    }
  }

  return (
    <div onClick={handleClick} className="cursor-pointer">
      <ToolCardShell
        label="AGENT"
        labelColor="text-purple-300"
        detail={taskDescription}
        status={status}
        borderColor="border-purple-800/50"
        defaultExpanded={status === 'running'}
        collapsible={status !== 'running'}
        actions={
          status === 'running' ? (
            <button
              className="text-[10px] uppercase tracking-[0.05em] text-red-500 hover:text-red-400 transition-colors ml-2"
              onClick={handleAbort}
            >
              [ABORT]
            </button>
          ) : undefined
        }
      >
        {status === 'running' && recentTools.length > 0 && (
          <div className="text-xs font-mono text-[#666] mb-2">
            {recentTools.map((te, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-[#666]">{i === recentTools.length - 1 ? '└─' : '├─'}</span>
                <span className={te.status === 'error' ? 'text-[#E61919]' : te.status === 'complete' ? 'text-[#4AF626]' : 'text-[#EAEAEA]'}>
                  {te.toolName}
                </span>
                {te.status === 'start' && <span className="text-[#666] animate-pulse">...</span>}
              </div>
            ))}
          </div>
        )}
        {status === 'running' && recentTools.length === 0 && (
          <div className="text-[10px] text-purple-400 uppercase tracking-[0.1em]">
            <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse mr-2" />
            Initializing...
          </div>
        )}
        {status === 'running' && toolCount > 0 && (
          <div className="text-[10px] text-[#666] mt-1">{toolCount} tools executed</div>
        )}
        {status !== 'running' && resultContent && (
          <pre className={`max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap ${isError ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
            {truncateText(resultContent, 500)}
          </pre>
        )}
      </ToolCardShell>
    </div>
  )
}
