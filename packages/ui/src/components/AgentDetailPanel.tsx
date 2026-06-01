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
    <div className="agent-detail-panel">
      {/* Header */}
      <div className="agent-detail-header">
        <div className="agent-detail-title">
          <span className="agent-detail-mark" />
          <span>AGENT</span>
          <strong>
            {agent.prompt.slice(0, 40)}
          </strong>
        </div>
        <div className="agent-detail-actions">
          {agent.status === 'running' && (
            <>
              <button
                onClick={handleBackground}
                className="agent-detail-action"
              >
                [BG]
              </button>
              <button
                onClick={handleAbort}
                className="agent-detail-action is-danger"
              >
                [ABORT]
              </button>
            </>
          )}
          <button
            onClick={handleClose}
            className="agent-detail-action"
          >
            [X]
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="agent-detail-status">
        {agent.status === 'running' && (
          <span className="agent-detail-live" />
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
      <div className="agent-detail-tools">
        {agent.toolEvents.map((te, i) => (
          <ToolCardRouter
            key={i}
            name={te.toolName}
            input={te.input}
            result={te.result ? { content: te.result.content, is_error: te.result.isError } : undefined}
          />
        ))}
        {agent.status === 'running' && agent.toolEvents.length === 0 && (
          <div className="tool-empty-state">
            Initializing...
          </div>
        )}
      </div>

      {/* Text output */}
      {agent.textOutput && (
        <div className="agent-detail-output">
          <div>Output</div>
          <pre>{agent.textOutput}</pre>
        </div>
      )}
    </div>
  )
}
