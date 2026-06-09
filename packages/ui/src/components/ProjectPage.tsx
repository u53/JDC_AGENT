import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'
import type { McpServerState } from '../lib/ipc-client'
import { IconPlus, IconSession, IconTerminal, IconUsage, IconTasks, IconJdcGraph } from './icons'

function formatTokens(n: number): string {
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(2) + 'M'
}

function statusColor(status: McpServerState['status']): string {
  if (status === 'connected') return 'var(--good)'
  if (status === 'connecting') return 'var(--warn)'
  return 'var(--bad)'
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function StatusDot({ color = 'var(--muted)', pulse = false }: { color?: string; pulse?: boolean }) {
  return (
    <span
      className={cx('inline-block h-[7px] w-[7px] shrink-0 rounded-full', pulse && 'animate-pulse')}
      style={{
        backgroundColor: color,
        boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 18%, transparent)`,
      }}
    />
  )
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
      {children}
    </div>
  )
}

function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cx(
        'rounded-[8px] border border-[color-mix(in_srgb,var(--border)_88%,transparent)] bg-[color-mix(in_srgb,var(--surface)_86%,transparent)] shadow-[var(--shadow)]',
        'backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </section>
  )
}

function IconFrame({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[color-mix(in_srgb,var(--accent)_18%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface-2))] text-[color-mix(in_srgb,var(--accent)_84%,var(--text)_16%)]">
      {children}
    </span>
  )
}

function MetricPanel({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
}) {
  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>{label}</Label>
          <div className="mt-2 font-mono text-[24px] leading-none tracking-[-0.02em] text-[var(--text)]">
            {value}
          </div>
          <div className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">{detail}</div>
        </div>
        <IconFrame>{icon}</IconFrame>
      </div>
    </Panel>
  )
}

function CommandButton({
  children,
  onClick,
  variant = 'secondary',
}: {
  children: ReactNode
  onClick: () => void
  variant?: 'primary' | 'secondary'
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold transition-all active:translate-y-[1px]',
        variant === 'primary'
          ? 'project-primary-action border border-[color-mix(in_srgb,var(--accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--accent)_82%,var(--text)_18%)] text-[var(--accent-ink)] shadow-[0_12px_32px_-22px_var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_90%,var(--text)_10%)]'
          : 'border border-[color-mix(in_srgb,var(--border)_88%,transparent)] bg-[color-mix(in_srgb,var(--surface-2)_52%,transparent)] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[color-mix(in_srgb,var(--surface-3)_62%,transparent)]',
      )}
    >
      {children}
    </button>
  )
}

function SectionHeader({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
      <Label>{title}</Label>
      {action}
    </div>
  )
}

export function ProjectPage() {
  const projects = useSessionStore((s) => s.projects)
  const activeProjectCwd = useSessionStore((s) => s.activeProjectCwd)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const tasks = useSessionStore((s) => s.tasks)
  const addProject = useSessionStore((s) => s.addProject)
  const createSession = useSessionStore((s) => s.createSession)
  const switchSession = useSessionStore((s) => s.switchSession)
  const activeModelId = useModelStore((s) => s.activeModelId)
  const modelGroups = useModelStore((s) => s.groups)
  const [mcpServers, setMcpServers] = useState<McpServerState[]>([])

  useEffect(() => {
    window.electronAPI?.mcpListServers().then((servers) => setMcpServers(servers || []))
    window.electronAPI?.onMcpStateChanged((states) => setMcpServers(states || []))
    return () => { /* onMcpStateChanged does not expose unsubscribe yet */ }
  }, [])

  const activeModel = useMemo(() => {
    if (!activeModelId) return null
    for (const group of modelGroups) {
      const model = group.models.find((item) => item.id === activeModelId)
      if (model) return { model, group }
    }
    return null
  }, [activeModelId, modelGroups])

  if (projects.length === 0) {
    return (
      <div
        className="project-page-shell flex-1 overflow-hidden bg-[var(--bg)] px-8 py-8"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.052) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.052) 1px, transparent 1px), radial-gradient(circle at 24% 38%, rgba(52,214,122,0.12), transparent 28%), linear-gradient(135deg, rgba(52,214,122,0.07), transparent 42%)',
          backgroundSize: '40px 40px, 40px 40px, 100% 100%',
        }}
      >
        <div className="flex min-h-full items-center">
          <div className="project-empty-state max-w-[760px]">
            <div className="mb-5 inline-flex items-center gap-2 rounded-[8px] border border-[color-mix(in_srgb,var(--border)_88%,transparent)] bg-[color-mix(in_srgb,var(--surface)_46%,transparent)] px-3 py-2 text-[12px] text-[var(--muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
              <StatusDot color="var(--accent)" pulse />
              JDC CODE
            </div>
            <h2 className="project-empty-headline max-w-[700px] text-[42px] font-semibold leading-[0.98] text-[var(--text)] md:text-[48px]">
              Local agent workspace,
              <br />
              <span className="text-[color-mix(in_srgb,var(--accent)_74%,var(--text)_26%)]">ready for a project.</span>
            </h2>
            <p className="mt-5 max-w-[520px] text-[14px] leading-6 text-[var(--muted)]">
              Connect a working directory and JDC CODE will bring sessions, tools, context, and runs into one command surface.
            </p>
            <div className="mt-7">
              <CommandButton onClick={addProject} variant="primary">
                <IconPlus size={15} />
                New project
              </CommandButton>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const project = projects.find((p) => p.cwd === activeProjectCwd) ?? projects[0]
  const projectSessions = project.sessions
  const recentSessions = projectSessions.slice(0, 6)
  const usageEntry = Object.values(sessionStates).find((state) => state.usage)
  const usage = usageEntry?.usage
  const connectedCount = mcpServers.filter((server) => server.status === 'connected').length
  const activeTasks = tasks.filter((task) => task.status !== 'done')
  const modelLabel = activeModel ? `${activeModel.group.name}:${activeModel.model.name}` : 'No model selected'
  const protocolLabel = activeModel?.group.protocol || 'not configured'
  const contextPercent = usage ? Math.min(Math.round(usage.contextUsedPercent), 100) : 0
  const grandTotal = usage?.grandTotalTokens ?? usage?.totalTokens ?? 0

  const consoleRows = [
    ['project', project.name],
    ['model', modelLabel],
    ['protocol', protocolLabel],
    ['mcp', `${connectedCount}/${mcpServers.length} connected`],
    ['tasks', activeTasks.length === 0 ? 'clear' : `${activeTasks.length} active`],
  ]

  return (
    <div
      className="flex-1 overflow-y-auto bg-[var(--bg)] p-5 lg:p-7"
      style={{
        backgroundImage:
          'linear-gradient(rgba(148,163,184,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.045) 1px, transparent 1px), linear-gradient(135deg, rgba(34,197,94,0.085), transparent 34%)',
        backgroundSize: '42px 42px, 42px 42px, 100% 100%',
      }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
        <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
          <Panel className="relative overflow-hidden p-6 lg:p-7">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-70" />
            <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
              <div className="max-w-[680px]">
                <div className="mb-5 inline-flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                  <StatusDot color="var(--accent)" pulse />
                  Project online
                </div>
                <h2 className="text-[38px] font-semibold leading-[0.98] tracking-[-0.045em] text-[var(--text)] lg:text-[52px]">
                  {project.name}
                </h2>
                <p className="mt-4 max-w-[680px] break-all font-mono text-[12px] leading-5 text-[var(--muted)]">
                  {project.cwd}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <CommandButton onClick={() => createSession(project.cwd)} variant="primary">
                  <IconPlus size={15} />
                  New session
                </CommandButton>
                <CommandButton onClick={addProject}>
                  <IconJdcGraph size={15} />
                  New project
                </CommandButton>
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="border-t border-[var(--border)] pt-3">
                <Label>Sessions</Label>
                <div className="mt-2 font-mono text-[22px] text-[var(--text)]">{projectSessions.length}</div>
              </div>
              <div className="border-t border-[var(--border)] pt-3">
                <Label>Context</Label>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
                    style={{ width: `${contextPercent}%` }}
                  />
                </div>
                <div className="mt-2 font-mono text-[12px] text-[var(--muted)]">{contextPercent}% window</div>
              </div>
              <div className="border-t border-[var(--border)] pt-3">
                <Label>Model</Label>
                <div className="mt-2 truncate font-mono text-[13px] text-[var(--text)]" title={modelLabel}>
                  {modelLabel}
                </div>
              </div>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <SectionHeader
              title="Run console"
              action={<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--accent)]">live</span>}
            />
            <div className="px-4 py-4 font-mono text-[12px]">
              <div className="mb-4 flex items-center gap-2 text-[var(--muted)]">
                <IconTerminal size={16} />
                <span>jdc://workspace/status</span>
              </div>
              <div className="space-y-3">
                {consoleRows.map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[88px_1fr] gap-3 border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0">
                    <span className="text-[var(--muted)]">{key}</span>
                    <span className="truncate text-[var(--text)]" title={value}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricPanel
            icon={<IconSession size={17} />}
            label="Recent"
            value={String(recentSessions.length)}
            detail={recentSessions.length === 1 ? 'session in rotation' : 'sessions in rotation'}
          />
          <MetricPanel
            icon={<IconJdcGraph size={17} />}
            label="MCP"
            value={`${connectedCount}/${mcpServers.length}`}
            detail={mcpServers.length === 0 ? 'no servers configured' : 'servers connected'}
          />
          <MetricPanel
            icon={<IconUsage size={17} />}
            label="Tokens"
            value={formatTokens(grandTotal)}
            detail={usage ? `${Math.round(usage.cacheHitRate)}% cache hit` : 'usage pending'}
          />
          <MetricPanel
            icon={<IconTasks size={17} />}
            label="Tasks"
            value={String(activeTasks.length)}
            detail={activeTasks.length === 0 ? 'queue is clear' : 'active work items'}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Panel className="overflow-hidden">
            <SectionHeader title="Recent sessions" />
            {recentSessions.length === 0 ? (
              <div className="px-4 py-8 text-[13px] text-[var(--muted)]">No sessions yet.</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {recentSessions.map((session) => {
                  const state = sessionStates[session.id]
                  const dotColor = state?.isStreaming
                    ? 'var(--accent)'
                    : state?.error
                      ? 'var(--bad)'
                      : 'var(--good)'
                  const status = state?.isStreaming
                    ? 'running'
                    : state?.error
                      ? 'error'
                      : state?.finished
                        ? 'complete'
                        : 'ready'
                  return (
                    <button
                      key={session.id}
                      onClick={() => switchSession(session.id)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_90px] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <StatusDot color={dotColor} pulse={state?.isStreaming} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-[var(--text)]">
                            {session.title || session.projectName}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-[var(--muted)]">
                            {session.cwd}
                          </span>
                        </span>
                      </span>
                      <span className="justify-self-end rounded-[999px] border border-[var(--border)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                        {status}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </Panel>

          <div className="grid gap-5">
            <Panel className="overflow-hidden">
              <SectionHeader title="MCP health" />
              {mcpServers.length === 0 ? (
                <div className="px-4 py-7 text-[13px] text-[var(--muted)]">No MCP servers.</div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {mcpServers.slice(0, 6).map((server) => (
                    <div key={server.name} className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3 px-4 py-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <StatusDot color={statusColor(server.status)} pulse={server.status === 'connecting'} />
                        <span className="truncate text-[13px] text-[var(--text)]">{server.name}</span>
                      </span>
                      <span className="justify-self-end font-mono text-[11px] text-[var(--muted)]">
                        {server.tools.length} tools
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel className="overflow-hidden">
              <SectionHeader title="Task queue" />
              {activeTasks.length === 0 ? (
                <div className="px-4 py-7 text-[13px] text-[var(--muted)]">No active tasks.</div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {activeTasks.slice(0, 5).map((task) => {
                    const color = task.status === 'running'
                      ? 'var(--accent)'
                      : task.status === 'blocked'
                        ? 'var(--warn)'
                        : 'var(--muted)'
                    return (
                      <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                        <StatusDot color={color} pulse={task.status === 'running'} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{task.subject}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                          {task.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}
