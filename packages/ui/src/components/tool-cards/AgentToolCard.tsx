import { useEffect } from 'react'
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { truncateText } from './shared'
import { useAgentStore } from '../../stores/agent-store'
import { useSessionStore } from '../../stores/session-store'
import { ipc } from '../../lib/ipc-client'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function AgentToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'Agent'

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
    <div onClick={handleClick} className="agent-launch-control cursor-pointer">
      <ToolCardShell
        label="AGENT"
        detail={modelId ? `${taskDescription} · ${modelId}` : taskDescription}
        status={status}
        defaultExpanded={status === 'running'}
        collapsible={status !== 'running'}
        rail={shouldShowToolRail(toolName, status)}
        variant={getToolVariant(toolName)}
        className="agent-launch-card"
        actions={
          status === 'running' ? (
            <button
              className="agent-launch-action ml-2 rounded-[6px] border border-[color-mix(in_srgb,var(--bad)_24%,var(--border))] px-2 py-1 font-mono text-[10px] text-[var(--bad)] transition-colors hover:bg-[color-mix(in_srgb,var(--bad)_10%,transparent)]"
              onClick={handleAbort}
            >
              Abort
            </button>
          ) : resultContent ? (
            <ToolCopyButton text={resultContent} label="Result" title="Copy result" iconOnly />
          ) : undefined
        }
      >
        {status === 'running' && (
          <div className="agent-launch-metrics mb-2 grid grid-cols-2 gap-1.5">
            <AgentLaunchMetric label="Model" value={modelId || 'default'} />
            <AgentLaunchMetric label="Tools" value={`${toolCount} tools`} />
          </div>
        )}
        {status === 'running' && recentTools.length > 0 && (
          <div className="agent-mini-timeline mb-2 grid gap-1 text-[12px] text-[var(--muted)]" style={{ fontFamily: 'var(--font-mono)' }}>
            {recentTools.map((te, i) => (
              <div key={i} className="flex min-w-0 items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_32%,transparent)] px-2 py-1.5">
                <span className="jdc-agent-timeline-dot" data-status={te.status} />
                <span className={`min-w-0 flex-1 truncate ${te.status === 'error' ? 'text-[var(--bad)]' : te.status === 'complete' ? 'text-[var(--good)]' : 'text-[var(--text)]'}`}>
                  {te.toolName}
                </span>
                {te.status === 'start' && <span className="text-[var(--muted)] animate-pulse">...</span>}
              </div>
            ))}
          </div>
        )}
        {status === 'running' && recentTools.length === 0 && (
          <div className="text-[10.5px] text-[var(--accent)]">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse mr-2" />
            Initializing...
          </div>
        )}
        {status === 'running' && toolCount > 0 && (
          <div className="text-[10px] text-[var(--muted)] mt-1">{toolCount} tools executed</div>
        )}
        {status !== 'running' && prompt && (
          <div className="mb-2">
            <div className="text-[10.5px] text-[var(--muted)] mb-1">Input</div>
            <pre className="max-h-32 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--text)] rounded-[4px]" style={{ fontFamily: 'var(--font-mono)' }}>
              {truncateText(prompt, 500)}
            </pre>
          </div>
        )}
        {status !== 'running' && resultContent && (
          <div>
            <div className="text-[10.5px] text-[var(--muted)] mb-1">Output</div>
            <pre className={`max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
              {truncateText(resultContent, 500)}
            </pre>
          </div>
        )}
      </ToolCardShell>
    </div>
  )
}

function AgentLaunchMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 min-w-0 truncate font-mono text-[10px] text-[var(--text)]">{value}</div>
    </div>
  )
}
