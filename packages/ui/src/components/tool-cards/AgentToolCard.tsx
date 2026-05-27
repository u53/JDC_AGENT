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

  const modelId = (toolInput.modelId || '') as string

  useEffect(() => {
    if (toolUseId && status === 'running' && !agentState) {
      addAgent(toolUseId, prompt, modelId || undefined)
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
        detail={modelId ? `${taskDescription} · ${modelId}` : taskDescription}
        status={status}
        defaultExpanded={status === 'running'}
        collapsible={status !== 'running'}
        actions={
          status === 'running' ? (
            <button
              className="text-[10px] uppercase tracking-[0.05em] text-[var(--bad)] hover:opacity-80 transition-opacity ml-2"
              onClick={handleAbort}
            >
              Abort
            </button>
          ) : undefined
        }
      >
        {status === 'running' && recentTools.length > 0 && (
          <div className="jdc-agent-timeline text-[12px] text-[var(--muted)] mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
            {recentTools.map((te, i) => (
              <div key={i} className="jdc-agent-timeline-row">
                <span className="jdc-agent-timeline-dot" data-status={te.status} />
                <span className={te.status === 'error' ? 'text-[var(--bad)]' : te.status === 'complete' ? 'text-[var(--good)]' : 'text-[var(--text)]'}>
                  {te.toolName}
                </span>
                {te.status === 'start' && <span className="text-[var(--muted)] animate-pulse">...</span>}
              </div>
            ))}
          </div>
        )}
        {status === 'running' && recentTools.length === 0 && (
          <div className="text-[10px] text-[var(--accent)] uppercase tracking-[0.1em]">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse mr-2" />
            Initializing...
          </div>
        )}
        {status === 'running' && toolCount > 0 && (
          <div className="text-[10px] text-[var(--muted)] mt-1">{toolCount} tools executed</div>
        )}
        {status !== 'running' && prompt && (
          <div className="mb-2">
            <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--muted)] mb-1">Input</div>
            <pre className="max-h-32 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--text)] rounded-[4px]" style={{ fontFamily: 'var(--font-mono)' }}>
              {truncateText(prompt, 500)}
            </pre>
          </div>
        )}
        {status !== 'running' && resultContent && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--muted)] mb-1">Output</div>
            <pre className={`max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
              {truncateText(resultContent, 500)}
            </pre>
          </div>
        )}
      </ToolCardShell>
    </div>
  )
}
