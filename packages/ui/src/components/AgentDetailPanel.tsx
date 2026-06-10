import { useAgentStore } from '../stores/agent-store'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'
import { ipc } from '../lib/ipc-client'
import { ToolCardRouter } from './tool-cards'
import { MarkdownRenderer } from './MarkdownRenderer'
import { formatModelReference } from '../lib/model-display'

export function AgentDetailPanel() {
  const activeAgentId = useAgentStore((s) => s.activeAgentId)
  const agent = useAgentStore((s) => activeAgentId ? s.agents[activeAgentId] : null)
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const modelGroups = useModelStore((s) => s.groups)

  if (!agent) return null

  const elapsed = Math.round((Date.now() - agent.startTime) / 1000)
  const modelLabel = formatModelReference(agent.modelId, modelGroups, 'default')

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
    <aside className="agent-detail-shell flex h-full min-h-0 flex-col border-l border-[var(--border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_95%,transparent),color-mix(in_srgb,var(--bg)_88%,transparent))]">
      <div className="flex-shrink-0 border-b border-[var(--border)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: agentStatusColor(agent.status) }}
              />
              <span className="font-mono text-[11px] font-semibold uppercase text-[var(--text)]">Subagent</span>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {agent.status === 'running' && (
              <>
                <AgentActionButton onClick={handleBackground}>Background</AgentActionButton>
                <AgentActionButton tone="danger" onClick={handleAbort}>Abort</AgentActionButton>
              </>
            )}
            <AgentActionButton onClick={handleClose}>Close</AgentActionButton>
          </div>
        </div>
        <pre className="agent-prompt-panel context-panel-scroll mt-3 max-h-[220px] overflow-y-auto overflow-x-auto whitespace-pre-wrap rounded-[8px] border border-[color-mix(in_srgb,var(--border)_88%,transparent)] bg-[color-mix(in_srgb,var(--surface-2)_42%,transparent)] p-3 font-mono text-[11px] leading-5 text-[var(--muted)]">
          {agent.prompt}
        </pre>
      </div>

      <div className="agent-detail-metrics grid flex-shrink-0 grid-cols-3 gap-2 border-b border-[var(--border)] px-3 py-2">
        <AgentMetric label="Status" value={agent.status === 'running' ? `Running ${elapsed}s` : agent.status} tone={agentStatusColor(agent.status)} />
        <AgentMetric label="Tools" value={String(agent.toolCount)} />
        <AgentMetric label="Model" value={modelLabel} />
      </div>

      <div className="context-panel-scroll flex-1 min-h-0 overflow-y-auto p-3">
        <section className="agent-tool-timeline min-w-0 space-y-2">
          <div className="font-mono text-[10px] font-semibold uppercase text-[var(--muted)]">
            Tool timeline
          </div>
          {agent.toolEvents.length > 0 ? (
            agent.toolEvents.map((te, i) => (
              <div key={i} className="min-w-0">
                <div className="mb-1 flex min-w-0 items-center gap-2 px-1">
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: toolEventColor(te.status) }}
                  />
                  <span className="min-w-0 whitespace-normal break-words font-mono text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
                    {te.status} · {te.toolName}
                  </span>
                </div>
                <ToolCardRouter
                  name={te.toolName}
                  input={te.input}
                  result={te.result ? { content: te.result.content, is_error: te.result.isError } : undefined}
                />
              </div>
            ))
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-3 py-3 text-[11px] italic text-[var(--muted)]">
              {agent.status === 'running' ? 'Initializing...' : 'No tool events recorded.'}
            </div>
          )}
        </section>
      </div>

      {agent.textOutput && (
        <section className="agent-output-panel max-h-[240px] flex-shrink-0 overflow-y-auto border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] px-3 py-3">
          <div className="mb-2 font-mono text-[10px] font-semibold uppercase text-[var(--muted)]">Output</div>
          <div className="context-markdown min-w-0 text-[11px] leading-relaxed text-[var(--text)] [overflow-wrap:anywhere]">
            <MarkdownRenderer content={agent.textOutput} compact />
          </div>
        </section>
      )}
    </aside>
  )
}

function AgentActionButton({
  children,
  tone = 'default',
  onClick,
}: {
  children: string
  tone?: 'default' | 'danger'
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[7px] border px-2 py-1 font-mono text-[10px] transition-colors active:translate-y-px ${
        tone === 'danger'
          ? 'border-[color-mix(in_srgb,var(--bad)_28%,var(--border))] text-[var(--bad)] hover:bg-[color-mix(in_srgb,var(--bad)_10%,transparent)]'
          : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  )
}

function AgentMetric({ label, value, tone = 'var(--text)' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_42%,transparent)] px-2 py-1.5">
      <div className="font-mono text-[10px] uppercase text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 min-w-0 truncate font-mono text-[11px]" style={{ color: tone }}>{value}</div>
    </div>
  )
}

function agentStatusColor(status: string): string {
  if (status === 'done') return 'var(--good)'
  if (status === 'error') return 'var(--bad)'
  return 'var(--accent)'
}

function toolEventColor(status: string): string {
  if (status === 'complete') return 'var(--good)'
  if (status === 'error') return 'var(--bad)'
  return 'var(--accent)'
}
