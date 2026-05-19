import { useAgentStore } from '../stores/agent-store'
import { useSessionStore } from '../stores/session-store'
import { ipc } from '../lib/ipc-client'
import { ToolCardRouter } from './tool-cards'

export function AgentDetailPanel() {
  const activeAgentId = useAgentStore((s) => s.activeAgentId)
  const agent = useAgentStore((s) => activeAgentId ? s.agents[activeAgentId] : null)
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  if (!agent) return null

  const elapsed = Math.round((Date.now() - agent.startTime) / 1000)

  const handleAbort = () => {
    if (activeSessionId && activeAgentId) {
      ipc.agent.abort(activeSessionId, activeAgentId)
    }
  }

  const handleBackground = () => {
    if (activeSessionId && activeAgentId) {
      ipc.agent.background(activeSessionId, activeAgentId)
    }
  }

  const handleClose = () => {
    setActiveAgent(null)
  }

  return (
    <div className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--surface)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="text-[var(--accent)]">&#9670;</span>
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--accent)]">AGENT</span>
          <span className="text-[11px] text-[var(--text)] truncate max-w-[200px]">
            {agent.prompt.slice(0, 40)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {agent.status === 'running' && (
            <>
              <button
                onClick={handleBackground}
                className="text-[10px] uppercase tracking-[0.05em] text-[var(--accent)] hover:opacity-80 transition-opacity"
              >
                [BG]
              </button>
              <button
                onClick={handleAbort}
                className="text-[10px] uppercase tracking-[0.05em] text-[var(--bad)] hover:opacity-80 transition-opacity"
              >
                [ABORT]
              </button>
            </>
          )}
          <button
            onClick={handleClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-xs transition-colors"
          >
            [X]
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] text-[10px] text-[var(--muted)]">
        {agent.status === 'running' && (
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
        )}
        <span>{agent.status === 'running' ? `Running ${elapsed}s` : agent.status.toUpperCase()}</span>
        <span>|</span>
        <span>{agent.toolCount} tools</span>
        {agent.modelId && (
          <>
            <span>|</span>
            <span>{agent.modelId}</span>
          </>
        )}
      </div>

      {/* Tool events list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {agent.toolEvents.map((te, i) => (
          <ToolCardRouter
            key={i}
            name={te.toolName}
            input={te.input}
            result={te.result ? { content: te.result.content, is_error: te.result.isError } : undefined}
          />
        ))}
        {agent.status === 'running' && agent.toolEvents.length === 0 && (
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-[0.1em]">
            Initializing...
          </div>
        )}
      </div>

      {/* Text output */}
      {agent.textOutput && (
        <div className="border-t border-[var(--border)] px-4 py-3 max-h-[200px] overflow-y-auto">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--muted)] mb-1">Output</div>
          <pre className="text-xs text-[var(--text)] whitespace-pre-wrap">{agent.textOutput}</pre>
        </div>
      )}
    </div>
  )
}
