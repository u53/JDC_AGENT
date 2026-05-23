import { useEffect, useState } from 'react'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'
import type { McpServerState } from '../lib/ipc-client'

// --- helpers ---

function formatTokens(n: number): string {
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(2) + 'M'
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-[7px] h-[7px] rounded-full shrink-0"
      style={{ backgroundColor: color }}
    />
  )
}

function mcpStatusColor(status: McpServerState['status']): string {
  if (status === 'connected') return 'var(--good)'
  if (status === 'connecting') return 'var(--warn)'
  return 'var(--bad)'
}

// --- card wrapper ---

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`border border-[var(--border)] rounded-[12px] bg-[var(--surface)] p-5 ${className}`}
      style={{ boxShadow: 'var(--shadow)' }}
    >
      {children}
    </div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[12px] uppercase tracking-[0.12em] text-[var(--muted)] font-medium mb-3">
      {children}
    </h3>
  )
}

// --- main component ---

export function ProjectPage() {
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const tasks = useSessionStore((s) => s.tasks)
  const addProject = useSessionStore((s) => s.addProject)
  const switchSession = useSessionStore((s) => s.switchSession)
  const activeModelId = useModelStore((s) => s.activeModelId)
  const modelGroups = useModelStore((s) => s.groups)
  const activeModel = (() => {
    if (!activeModelId) return null
    for (const g of modelGroups) {
      const m = g.models.find((m) => m.id === activeModelId)
      if (m) return { model: m, group: g }
    }
    return null
  })()

  const [mcpServers, setMcpServers] = useState<McpServerState[]>([])

  useEffect(() => {
    window.electronAPI?.mcpListServers().then(setMcpServers)
    const unsub = window.electronAPI?.onMcpStateChanged((states) => setMcpServers(states))
    return () => { /* onMcpStateChanged doesn't return unsub in current API */ }
  }, [])

  // Empty state — no projects at all
  if (projects.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <p className="text-[14px] text-[var(--muted)]">添加项目开始使用</p>
        <button
          onClick={addProject}
          className="px-4 py-2 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] text-[13px] font-medium hover:opacity-90 transition-opacity"
        >
          New project
        </button>
      </div>
    )
  }

  // Pick the first project as the "current" context (no active session)
  const project = projects[0]
  const allSessions = projects.flatMap((p) => p.sessions)
  const recentSessions = allSessions.slice(0, 5)

  // Usage from the most recent session that has usage data
  const usageEntry = Object.values(sessionStates).find((s) => s.usage)
  const usage = usageEntry?.usage

  // MCP stats
  const connectedCount = mcpServers.filter((s) => s.status === 'connected').length

  // Active tasks
  const activeTasks = tasks.filter((t) => t.status !== 'done')

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-[900px] flex flex-col gap-5">
        {/* Project Info Card */}
        <Card>
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-[18px] font-normal leading-tight" style={{ fontFamily: 'var(--font-serif)' }}>
                {project.name}
              </h2>
              <p className="text-[12px] text-[var(--muted)] mt-1" style={{ fontFamily: 'var(--font-mono)' }}>
                {project.cwd}
              </p>
            </div>
            <div className="flex items-center gap-4 text-[12px] text-[var(--muted)]">
              {activeModel && <span>{activeModel.model.name}</span>}
              <span>{allSessions.length} session{allSessions.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </Card>

        {/* 2-column grid */}
        <div className="grid grid-cols-2 gap-5">
          {/* Recent Sessions */}
          <Card>
            <CardTitle>Recent Sessions</CardTitle>
            {recentSessions.length === 0 ? (
              <p className="text-[12px] text-[var(--muted)]">No sessions yet</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recentSessions.map((session) => {
                  const state = sessionStates[session.id]
                  const dotColor = state?.isStreaming
                    ? 'var(--accent)'
                    : state?.error
                      ? 'var(--bad)'
                      : 'var(--good)'
                  return (
                    <li key={session.id}>
                      <button
                        onClick={() => switchSession(session.id)}
                        className="w-full flex items-center gap-2 text-left text-[13px] hover:text-[var(--accent)] transition-colors"
                      >
                        <StatusDot color={dotColor} />
                        <span className="truncate">{session.projectName}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* MCP Health */}
          <Card>
            <CardTitle>MCP Health</CardTitle>
            <p className="text-[13px] mb-3">
              <span className="text-[var(--good)] font-medium">{connectedCount}</span>
              <span className="text-[var(--muted)]"> / {mcpServers.length} connected</span>
            </p>
            {mcpServers.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {mcpServers.map((server) => (
                  <li key={server.name} className="flex items-center gap-2 text-[12px]">
                    <StatusDot color={mcpStatusColor(server.status)} />
                    <span className="truncate">{server.name}</span>
                    <span className="ml-auto text-[var(--muted)]">{server.tools.length} tools</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Usage Summary */}
          <Card>
            <CardTitle>Usage Summary</CardTitle>
            {!usage ? (
              <p className="text-[12px] text-[var(--muted)]">No usage data</p>
            ) : (
              <div className="flex flex-col gap-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Main session</span>
                  <span>{formatTokens(usage.totalTokens)}</span>
                </div>
                {(usage.subAgentTotalTokens ?? 0) > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted)]" title="Sub-agents and team workers/PM. Counted toward billing, not toward context.">Sub-agents / team</span>
                      <span>{formatTokens(usage.subAgentTotalTokens ?? 0)}</span>
                    </div>
                    <div className="flex justify-between border-t border-[var(--border)] pt-2">
                      <span>Grand total</span>
                      <span className="font-semibold">{formatTokens(usage.grandTotalTokens ?? usage.totalTokens)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Cache hit</span>
                  <span>{Math.round(usage.cacheHitRate)}%</span>
                </div>
                <div className="flex justify-between items-center gap-3">
                  <span className="text-[var(--muted)]">Context</span>
                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <div className="w-[80px] h-[4px] rounded-full bg-[var(--surface-2)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${Math.min(usage.contextUsedPercent, 100)}%` }}
                      />
                    </div>
                    <span className="text-[12px]">{Math.round(usage.contextUsedPercent)}%</span>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Tasks Summary */}
          <Card>
            <CardTitle>Tasks Summary</CardTitle>
            {activeTasks.length === 0 ? (
              <p className="text-[12px] text-[var(--muted)]">No active tasks</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {activeTasks.map((task) => {
                  const dotColor = task.status === 'running'
                    ? 'var(--accent)'
                    : task.status === 'blocked'
                      ? 'var(--warn)'
                      : 'var(--muted)'
                  return (
                    <li key={task.id} className="flex items-center gap-2 text-[13px]">
                      <StatusDot color={dotColor} />
                      <span className="truncate">{task.subject}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
