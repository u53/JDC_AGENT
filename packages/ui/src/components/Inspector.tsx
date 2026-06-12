import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSessionStore } from '../stores/session-store'
import { useBackgroundTaskStore, type BackgroundTaskItem } from '../stores/background-task-store'
import { useTeamStore } from '../stores/team-store'
import { ipc } from '../lib/ipc-client'
import { copyImageFile, copyToClipboard } from '../lib/clipboard'
import { IconTasks, IconQueue, IconUsage, IconFiles, IconSession, IconX, IconTeam, IconJdcGraph } from './icons'
import { TeamDetailPanel } from './TeamDetailPanel'
import { ContextPanel } from './context/ContextPanel'
import { useContextStore } from '../stores/context-store'
import { shouldShowContextInspector } from '../lib/context-inspector-visibility'

interface FileChange {
  filePath: string
  changeType: 'created' | 'modified'
  snapshotCount: number
}

type SectionId = 'session' | 'usage' | 'tasks' | 'team' | 'context' | 'queue' | 'files'

interface RailItem {
  id: SectionId
  label: string
  Icon: React.ComponentType<{ size?: number; className?: string }>
  badge: string | number | null
  badgeColor?: string
}

const INSPECTOR_WIDTH_KEY = 'jdcagnet.inspector.width'
const MIN_WIDTH = 280
const MAX_WIDTH = 700
const DEFAULT_WIDTH = 320

const sectionLabels: Record<SectionId, string> = {
  session: 'Session',
  usage: 'Usage',
  tasks: 'Tasks',
  team: 'Team',
  context: 'Context',
  queue: 'Queue',
  files: 'Files',
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function loadInspectorWidth(): number {
  try {
    const v = localStorage.getItem(INSPECTOR_WIDTH_KEY)
    const n = v ? parseInt(v, 10) : NaN
    if (!Number.isFinite(n)) return DEFAULT_WIDTH
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n))
  } catch {
    return DEFAULT_WIDTH
  }
}

function formatTokens(n: number): string {
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function Inspector() {
  const [expanded, setExpanded] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId | null>(null)
  const [fileChanges, setFileChanges] = useState<FileChange[]>([])
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const [width, setWidth] = useState<number>(loadInspectorWidth)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const tasks = useSessionStore((s) => s.tasks)
  const messageQueue = useSessionStore((s) => s.messageQueue)
  const removeFromQueue = useSessionStore((s) => s.removeFromQueue)
  const backgroundTasks = useBackgroundTaskStore((s) => s.tasks)
  const teams = useTeamStore((s) => s.teams)
  const activeTeamId = useTeamStore((s) => s.activeTeamId)
  const setActiveTeam = useTeamStore((s) => s.setActiveTeam)
  const contextInspect = useContextStore((s) => s.inspect.data)
  const contextInspectLoading = useContextStore((s) => s.inspect.loading)
  const contextInspectError = useContextStore((s) => s.inspect.error)
  const showContextInspector = shouldShowContextInspector()

  const currentState = activeSessionId ? sessionStates[activeSessionId] : undefined
  const usage = currentState?.usage
  const isStreaming = currentState?.isStreaming ?? false

  const loadFileChanges = useCallback(async () => {
    if (!activeSessionId) return
    try {
      const changes = await window.electronAPI?.invoke('file:get-changes', { sessionId: activeSessionId })
      if (Array.isArray(changes)) setFileChanges(changes as FileChange[])
    } catch {
      setFileChanges([])
    }
  }, [activeSessionId])

  useEffect(() => {
    loadFileChanges()
  }, [loadFileChanges])

  // Reload file changes when streaming stops
  useEffect(() => {
    if (!isStreaming) {
      loadFileChanges()
    }
  }, [isStreaming, loadFileChanges])

  // Periodically refresh background tasks
  useEffect(() => {
    if (!activeSessionId) return
    const refresh = () => {
      ipc.background.list(activeSessionId).then(tasks => {
        useBackgroundTaskStore.getState().setTasks(tasks)
      })
    }
    refresh()
    const interval = setInterval(refresh, 2000)
    return () => clearInterval(interval)
  }, [activeSessionId])

  // Auto-follow: when a NEW running team appears, switch the active team to it,
  // unless the user is currently viewing another running team (respect user's pick).
  const knownRunningTeamIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const currentRunning = new Set(
      backgroundTasks.filter(t => t.type === 'team' && t.status === 'running').map(t => t.id),
    )
    const known = knownRunningTeamIdsRef.current
    const newlyRunning: string[] = []
    for (const id of currentRunning) {
      if (!known.has(id)) newlyRunning.push(id)
    }
    knownRunningTeamIdsRef.current = currentRunning

    if (newlyRunning.length === 0) return
    const activeId = useTeamStore.getState().activeTeamId
    // If user is currently watching another *running* team, don't yank them away.
    const userPinned = activeId != null && currentRunning.has(activeId) && !newlyRunning.includes(activeId)
    if (userPinned) return
    // Otherwise: jump to the newest running team
    setActiveTeam(newlyRunning[newlyRunning.length - 1])
  }, [backgroundTasks, setActiveTeam])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      // Inspector is on the right; dragging left = wider
      const delta = dragRef.current.startX - ev.clientX
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta))
      setWidth(next)
    }
    const onUp = () => {
      if (dragRef.current) {
        try { localStorage.setItem(INSPECTOR_WIDTH_KEY, String(width)) } catch {}
      }
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Persist final width on every change while not dragging (debounced via effect would be ideal,
  // but onUp handles drag completion; this catches programmatic changes if any)
  useEffect(() => {
    if (!dragRef.current) {
      try { localStorage.setItem(INSPECTOR_WIDTH_KEY, String(width)) } catch {}
    }
  }, [width])

  // Hide entirely on very narrow windows
  if (windowWidth < 700) return null

  const toggleSection = (section: SectionId) => {
    if (section === 'context' && !showContextInspector) return
    if (!expanded) {
      // Disable expand on narrow windows
      if (windowWidth < 900) return
      setExpanded(true)
      setActiveSection(section)
    } else if (activeSection === section) {
      setExpanded(false)
      setActiveSection(null)
    } else {
      setActiveSection(section)
    }
  }

  const completedCount = tasks.filter((t) => t.status === 'completed').length
  const pendingCount = tasks.length - completedCount
  const bgRunning = backgroundTasks.filter(t => t.status === 'running').length
  const bgTeams = backgroundTasks.filter(t => t.type === 'team')
  const teamRunning = bgTeams.filter(t => t.status === 'running').length
  const taskBadge = (tasks.length > 0 || bgRunning > 0)
    ? (pendingCount + bgRunning > 0 ? pendingCount + bgRunning : null)
    : null
  const taskBadgeColor = tasks.length > 0 && pendingCount === 0 && bgRunning === 0 ? 'var(--good)' : undefined
  const teamBadge = bgTeams.length > 0 ? bgTeams.length : null
  const teamBadgeColor = teamRunning > 0 ? 'var(--accent)' : 'var(--good)'
  const contextBadge = contextInspect?.bundle?.sections.length ?? null
  const contextBadgeColor = contextInspectError ? 'var(--bad)' : contextInspectLoading ? 'var(--warn)' : contextInspect?.status === 'available' ? 'var(--jdc-engine-accent)' : undefined

  const railItems: RailItem[] = [
    { id: 'session', label: sectionLabels.session, Icon: IconSession, badge: null },
    { id: 'usage', label: sectionLabels.usage, Icon: IconUsage, badge: null },
    { id: 'tasks', label: sectionLabels.tasks, Icon: IconTasks, badge: taskBadge, badgeColor: taskBadgeColor },
    { id: 'team', label: sectionLabels.team, Icon: IconTeam, badge: teamBadge, badgeColor: teamBadgeColor },
    ...(showContextInspector ? [{ id: 'context' as const, label: sectionLabels.context, Icon: IconJdcGraph, badge: contextBadge, badgeColor: contextBadgeColor }] : []),
    { id: 'queue', label: sectionLabels.queue, Icon: IconQueue, badge: messageQueue.length || null },
    { id: 'files', label: sectionLabels.files, Icon: IconFiles, badge: fileChanges.length || null },
  ]

  if (!expanded) {
    return (
      <div className="inspector-rail w-[48px] border-l border-[color-mix(in_srgb,var(--border)_86%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_96%,transparent),color-mix(in_srgb,var(--bg)_90%,transparent))] flex flex-col items-center py-3 gap-2 shadow-[inset_1px_0_0_rgba(255,255,255,0.025)] backdrop-blur">
        <div className="inspector-rail-brand mb-1 grid h-7 w-7 place-items-center rounded-[8px] border border-[color-mix(in_srgb,var(--accent)_18%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface-2))] font-mono text-[10px] font-semibold text-[color-mix(in_srgb,var(--accent)_84%,var(--text)_16%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
          JD
        </div>
        {railItems.map(({ id, label, Icon, badge, badgeColor }) => (
          <button
            key={id}
            onClick={() => toggleSection(id)}
            className="inspector-rail-item relative grid h-8 w-8 place-items-center rounded-[8px] border border-transparent text-[color-mix(in_srgb,var(--muted)_92%,var(--text)_8%)] transition-colors duration-150 hover:border-[color-mix(in_srgb,var(--accent)_18%,var(--border))] hover:bg-[color-mix(in_srgb,var(--surface-2)_62%,transparent)] hover:text-[var(--text)] active:translate-y-px"
            aria-label={label}
            title={label}
          >
            <Icon size={18} />
            {badge != null && (
              <span className="absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none text-[var(--accent-ink)] ring-2 ring-[var(--surface)]" style={{ backgroundColor: badgeColor || 'var(--accent)' }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>
    )
  }

  // Pick effective team to display.
  // Policy:
  //   1. If user explicitly picked a team AND it still exists in bgTeams → respect that pick.
  //   2. Else: prefer the currently-running team (newest first) — this auto-switches when a new
  //      team launches after an old one finished.
  //   3. Else: fall back to most recent team (running or not).
  // Note: bgTeams ordering follows backend insertion order; running new teams appear later.
  const runningTeams = bgTeams.filter(t => t.status === 'running')
  const userPickIsValid = activeTeamId != null && bgTeams.some(t => t.id === activeTeamId)
  const effectiveTeamId =
    (userPickIsValid ? activeTeamId : null)
    ?? runningTeams[runningTeams.length - 1]?.id  // newest running team
    ?? bgTeams[bgTeams.length - 1]?.id            // newest team overall (fallback)
    ?? null

  return (
    <div
      className="inspector-panel-shell h-full border-l border-[color-mix(in_srgb,var(--border)_86%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_96%,transparent),color-mix(in_srgb,var(--bg)_90%,transparent))] flex flex-col relative overflow-hidden shadow-[inset_1px_0_0_rgba(255,255,255,0.025)] backdrop-blur"
      style={{ width: `${width}px` }}
    >
      {/* Drag handle on the left edge */}
      <div
        onMouseDown={startDrag}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)]/40 z-10"
        title="Drag to resize"
      />

      {/* Header */}
      <div className="inspector-panel-header flex-shrink-0 border-b border-[color-mix(in_srgb,var(--border)_86%,transparent)] bg-[color-mix(in_srgb,var(--surface)_34%,transparent)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_0_4px_var(--accent-soft)]" />
              <span className="font-mono text-[11px] font-semibold uppercase text-[var(--text)]">Inspector</span>
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-[var(--muted)]">
              {activeSection ? sectionLabels[activeSection] : 'Control plane'}
            </p>
          </div>
          <button
            onClick={() => { setExpanded(false); setActiveSection(null) }}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-[7px] border border-[color-mix(in_srgb,var(--border)_88%,transparent)] text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--surface-2)_62%,transparent)] hover:text-[var(--text)] active:translate-y-px"
            aria-label="Close inspector"
          >
            <IconX size={14} />
          </button>
        </div>
      </div>

      {/* Rail row for section switching */}
      <div className="inspector-tabs context-panel-scroll flex-shrink-0 overflow-x-auto border-b border-[color-mix(in_srgb,var(--border)_86%,transparent)] bg-[color-mix(in_srgb,var(--surface)_24%,transparent)] px-3 py-2">
        <div className="flex items-center gap-1">
          {railItems.map(({ id, label, Icon, badge, badgeColor }) => (
            <button
              key={id}
              onClick={() => toggleSection(id)}
              className={cx(
                'relative grid h-8 w-8 flex-shrink-0 place-items-center rounded-[8px] border text-[var(--muted)] transition-colors duration-150 active:translate-y-px',
                activeSection === id
                  ? 'inspector-tab-active border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface-2))] text-[color-mix(in_srgb,var(--accent)_86%,var(--text)_14%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                  : 'border-transparent hover:border-[color-mix(in_srgb,var(--accent)_16%,var(--border))] hover:bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)] hover:text-[var(--text)]',
              )}
              aria-label={label}
              title={label}
            >
              <Icon size={16} />
              {badge != null && (
                <span className="absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none text-[var(--accent-ink)] ring-2 ring-[var(--surface)]" style={{ backgroundColor: badgeColor || 'var(--accent)' }}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Section content — Team/Context sections use full panel without inner padding */}
      {activeSection === 'team' ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {effectiveTeamId && activeSessionId ? (
            <TeamDetailPanel
              sessionId={activeSessionId}
              taskId={effectiveTeamId}
              onClose={() => setActiveTeam(null)}
            />
          ) : (
            <div className="p-3">
              <InspectorEmptyState title="No active team" detail="Create one with the Team tool." />
            </div>
          )}
        </div>
      ) : activeSection === 'context' && showContextInspector ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <ContextPanel sessionId={activeSessionId} />
        </div>
      ) : (
        <div className="context-panel-scroll flex-1 min-h-0 overflow-y-auto p-3">
          {activeSection === 'session' && <SessionSection sessionId={activeSessionId} />}
          {activeSection === 'usage' && <UsageSection usage={usage} />}
          {activeSection === 'tasks' && (
            <TasksSection
              tasks={tasks}
              backgroundTasks={backgroundTasks}
              onOpenTeam={(id) => { setActiveTeam(id); setActiveSection('team') }}
            />
          )}
          {activeSection === 'queue' && <QueueSection queue={messageQueue} removeFromQueue={removeFromQueue} />}
          {activeSection === 'files' && <FilesSection files={fileChanges} />}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h3 className="truncate font-mono text-[11px] font-semibold uppercase text-[var(--muted)]">
        {children}
      </h3>
      {meta ? <div className="flex-shrink-0 font-mono text-[10px] text-[var(--muted)]">{meta}</div> : null}
    </div>
  )
}

function InspectorSectionFrame({ title, meta, action, children }: {
  title: React.ReactNode
  meta?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <SectionHeader meta={meta}>{title}</SectionHeader>
        </div>
        {action ? <div className="flex-shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

function InspectorEmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-[7px] border border-dashed border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_46%,transparent)] px-3 py-3">
      <p className="text-[12px] font-medium text-[var(--text)]">{title}</p>
      {detail ? <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{detail}</p> : null}
    </div>
  )
}

function InspectorMetricRow({ label, value, title, strong }: {
  label: React.ReactNode
  value: React.ReactNode
  title?: string
  strong?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-[6px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_42%,transparent)] px-2.5 py-2 text-[12px]">
      <span className="min-w-0 truncate text-[var(--muted)]" title={title}>{label}</span>
      <span className={cx('min-w-0 flex-shrink-0 truncate font-mono text-[var(--text)]', strong && 'font-semibold')}>{value}</span>
    </div>
  )
}

function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={cx('h-2 w-2 flex-shrink-0 rounded-full', pulse && 'animate-pulse')}
      style={{ backgroundColor: color }}
    />
  )
}

function SessionSection({ sessionId }: { sessionId: string | null }) {
  return (
    <InspectorSectionFrame title="Session" meta={sessionId ? 'active' : 'idle'}>
      <InspectorMetricRow
        label="Session ID"
        value={sessionId ? sessionId.slice(0, 8) : 'None'}
        title={sessionId ?? undefined}
        strong={Boolean(sessionId)}
      />
    </InspectorSectionFrame>
  )
}

function UsageSection({ usage }: {
  usage?: {
    totalTokens: number
    cacheHitRate: number
    contextUsedPercent: number
    subAgentTotalTokens?: number
    subAgentTurnCount?: number
    grandTotalTokens?: number
  }
}) {
  if (!usage) {
    return (
      <InspectorSectionFrame title="Usage" meta="waiting">
        <InspectorEmptyState title="No usage data" detail="Token and cache stats appear after a model response." />
      </InspectorSectionFrame>
    )
  }

  const contextColor = usage.contextUsedPercent > 80 ? 'var(--bad)' : 'var(--accent)'
  const subTotal = usage.subAgentTotalTokens ?? 0
  const grandTotal = usage.grandTotalTokens ?? usage.totalTokens
  const hasSub = subTotal > 0

  return (
    <InspectorSectionFrame title="Usage" meta="tokens">
      <div className="space-y-2">
        <InspectorMetricRow label="Main session" value={formatTokens(usage.totalTokens)} />
        {hasSub && (
          <InspectorMetricRow
            label="Sub-agents / team"
            title="Sub-agents (Agent tool) and team workers/PM/skill router. Counted toward total billing but isolated from main context window."
            value={(
              <>
                {formatTokens(subTotal)}
                {usage.subAgentTurnCount ? <span className="ml-1 text-[var(--muted)]">({usage.subAgentTurnCount} turns)</span> : null}
              </>
            )}
          />
        )}
        {hasSub && (
          <InspectorMetricRow label="Grand total" value={formatTokens(grandTotal)} strong />
        )}
        <InspectorMetricRow label="Cache hit" value={`${Math.round(usage.cacheHitRate)}%`} />
        <div className="rounded-[6px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_42%,transparent)] px-2.5 py-2">
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="text-[var(--muted)]">Context</span>
            <span className="text-[var(--text)] font-mono text-[11px]">{Math.round(usage.contextUsedPercent)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.min(usage.contextUsedPercent, 100)}%`, backgroundColor: contextColor }}
            />
          </div>
        </div>
      </div>
    </InspectorSectionFrame>
  )
}

function TasksSection({ tasks, backgroundTasks, onOpenTeam }: {
  tasks: Array<{ id: string; subject: string; status: string }>
  backgroundTasks: BackgroundTaskItem[]
  onOpenTeam: (id: string) => void
}) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const runningBg = backgroundTasks.filter(t => t.status === 'running')
  const imageTasks = backgroundTasks.filter(t => t.type === 'image')
  const otherBgTasks = backgroundTasks.filter(t => t.type !== 'image')

  const handleStop = (taskId: string) => {
    if (activeSessionId) {
      ipc.background.stop(activeSessionId, taskId)
    }
  }

  const handleOpen = (task: BackgroundTaskItem) => {
    if (task.type === 'team') {
      onOpenTeam(task.id)
    }
  }

  return (
    <div className="space-y-4">
      {imageTasks.length > 0 ? (
        <InspectorSectionFrame title="Image" meta={`${imageTasks.filter(t => t.status === 'running').length} running / ${imageTasks.filter(t => t.status === 'completed').length} done`}>
          <div className="space-y-1.5">
            {imageTasks.map((task) => (
              <div key={task.id} className="min-w-0 rounded-[6px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-2.5 py-2">
                <div className="flex items-center gap-2 text-[12px]">
                  <StatusDot
                    color={task.status === 'running' ? 'var(--accent)' : task.status === 'completed' ? 'var(--good)' : 'var(--bad)'}
                    pulse={task.status === 'running'}
                  />
                  <span className="w-[32px] flex-shrink-0 font-mono text-[10px] uppercase text-[var(--accent)]">IMG</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text)]">
                    {task.prompt ? task.prompt.slice(0, 50) : '生成中…'}
                  </span>
                </div>
                {task.status === 'completed' && task.images && task.images.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {task.images.filter((img: any) => img.path).map((img: any, i: number) => (
                      <ImageRow key={i} img={img} />
                    ))}
                  </div>
                )}
                {task.status === 'failed' && task.result && (
                  <div className="mt-1 text-[10px] text-[var(--bad)] truncate">{task.result.slice(0, 100)}</div>
                )}
              </div>
            ))}
          </div>
        </InspectorSectionFrame>
      ) : (
        <InspectorSectionFrame title="Image" meta="idle">
          <InspectorEmptyState title="No image tasks" detail="Image generation jobs will appear here when triggered." />
        </InspectorSectionFrame>
      )}

      {otherBgTasks.length > 0 && (
        <InspectorSectionFrame title="Background" meta={`${runningBg.filter(t => t.type !== 'image').length} running`}>
          <div className="space-y-1.5">
            {otherBgTasks.map((task) => (
              <div
                key={task.id}
                className={cx(
                  'group flex min-w-0 items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-2.5 py-2 text-[12px] transition-colors',
                  task.type === 'team' && 'cursor-pointer hover:border-[color-mix(in_srgb,var(--accent)_28%,var(--border))] hover:bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface-2))]',
                )}
                onClick={() => handleOpen(task)}
              >
                <StatusDot
                  color={task.status === 'running' ? 'var(--accent)' : task.status === 'completed' ? 'var(--good)' : 'var(--bad)'}
                  pulse={task.status === 'running'}
                />
                <span className="w-[32px] flex-shrink-0 font-mono text-[10px] uppercase text-[var(--muted)]">
                  {task.type === 'shell' ? 'SH' : task.type === 'team' ? 'TM' : 'AI'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--text)]">
                  {task.type === 'shell' ? (task.command || '').slice(0, 40) : (task.prompt || '').slice(0, 40)}
                </span>
                {task.status === 'running' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleStop(task.id) }}
                    className="rounded-[5px] border border-transparent px-1.5 py-0.5 font-mono text-[10px] text-[var(--bad)] opacity-0 transition-opacity hover:border-[color-mix(in_srgb,var(--bad)_30%,var(--border))] hover:bg-[color-mix(in_srgb,var(--bad)_10%,transparent)] group-hover:opacity-100"
                  >
                    STOP
                  </button>
                )}
              </div>
            ))}
          </div>
        </InspectorSectionFrame>
      )}

      {tasks.length > 0 && (
        <InspectorSectionFrame title="Tasks" meta={`${tasks.filter(t => t.status === 'completed').length}/${tasks.length}`}>
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <div key={task.id} className="flex min-w-0 items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-2.5 py-2 text-[12px]">
                <StatusDot color={task.status === 'completed' ? 'var(--good)' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--muted)'} />
                <span className={cx('min-w-0 truncate', task.status === 'completed' ? 'text-[var(--good)]' : 'text-[var(--text)]')}>
                  {task.subject}
                </span>
              </div>
            ))}
          </div>
        </InspectorSectionFrame>
      )}

      {backgroundTasks.length === 0 && tasks.length === 0 && (
        <InspectorSectionFrame title="Tasks" meta="idle">
          <InspectorEmptyState title="No tasks" detail="Running work and checklist items will appear here." />
        </InspectorSectionFrame>
      )}
    </div>
  )
}

function QueueSection({ queue, removeFromQueue }: { queue: string[]; removeFromQueue: (i: number) => void }) {
  if (queue.length === 0) {
    return (
      <InspectorSectionFrame title="Queue" meta="empty">
        <InspectorEmptyState title="Queue is empty" detail="Queued follow-up messages will stack here." />
      </InspectorSectionFrame>
    )
  }

  const clearAll = () => {
    for (let i = queue.length - 1; i >= 0; i--) {
      removeFromQueue(i)
    }
  }

  return (
    <InspectorSectionFrame
      title="Queue"
      meta={`${queue.length} pending`}
      action={(
        <button
          onClick={clearAll}
          className="rounded-[5px] border border-[var(--border)] px-2 py-1 font-mono text-[10px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] active:translate-y-px"
        >
          Clear all
        </button>
      )}
    >
      <div className="space-y-1.5">
        {queue.map((msg, i) => (
          <div key={i} className="group flex min-w-0 items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-2.5 py-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate text-[var(--text)]">{msg.slice(0, 60)}</span>
            <button
              onClick={() => removeFromQueue(i)}
              className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-[5px] text-[var(--muted)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--bad)_10%,transparent)] hover:text-[var(--bad)] group-hover:opacity-100"
              aria-label="Remove queued message"
            >
              <IconX size={12} />
            </button>
          </div>
        ))}
      </div>
    </InspectorSectionFrame>
  )
}

function FilesSection({ files }: { files: FileChange[] }) {
  if (files.length === 0) {
    return (
      <InspectorSectionFrame title="Files changed" meta="clean">
        <InspectorEmptyState title="No file changes" detail="File snapshots appear after tool mutations." />
      </InspectorSectionFrame>
    )
  }

  return (
    <InspectorSectionFrame title="Files changed" meta={`${files.length} tracked`}>
      <div className="space-y-1">
        {files.map((file) => (
          <div key={file.filePath} className="flex min-w-0 items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-2.5 py-2 text-[12px]">
            <span
              className="w-4 flex-shrink-0 text-center font-mono"
              style={{ color: file.changeType === 'created' ? 'var(--good)' : 'var(--warn)' }}
            >
              {file.changeType === 'created' ? '+' : '~'}
            </span>
            <span className="min-w-0 truncate font-mono text-[var(--text)]" title={file.filePath}>
              {file.filePath.split('/').pop()}
            </span>
          </div>
        ))}
      </div>
    </InspectorSectionFrame>
  )
}

function ImageRow({ img }: { img: { path: string; format: string; bytes: number } }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const filename = img.path.split('/').pop() || img.path
  const size = img.bytes > 0 ? `${(img.bytes / 1024).toFixed(0)}KB` : ''

  const loadPreview = async () => {
    if (preview) { setZoomed(true); return }
    const api = (window as any).electronAPI
    if (api?.readImageFile) {
      const res = await api.readImageFile(img.path)
      if (res?.success && res.dataUrl) {
        setPreview(res.dataUrl)
        setZoomed(true)
      }
    }
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try { await copyImageFile(img.path) } catch { /* ignore */ }
  }
  const handleCopyPath = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await copyToClipboard(img.path)
  }
  const handleShow = (e: React.MouseEvent) => {
    e.stopPropagation()
    ipc.images.showInFolder(img.path)
  }

  return (
    <>
      <div className="flex items-center gap-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] rounded-[4px] px-1 -mx-1" onClick={loadPreview}>
        <span className="flex-1 text-[10px] text-[var(--muted)] truncate">{filename} · {img.format} · {size}</span>
        <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={handleCopy} className="rounded-[4px] border border-[var(--border)] px-1.5 py-0.5 text-[9px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]">复制</button>
          <button onClick={handleCopyPath} className="rounded-[4px] border border-[var(--border)] px-1.5 py-0.5 text-[9px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]">路径</button>
          <button onClick={handleShow} className="rounded-[4px] border border-[var(--border)] px-1.5 py-0.5 text-[9px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]">文件夹</button>
        </div>
      </div>
      {zoomed && preview && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={() => setZoomed(false)}>
          <img src={preview} alt="" className="max-h-[90vh] max-w-[90vw] rounded-[8px] object-contain shadow-2xl" />
        </div>,
        document.body
      )}
    </>
  )
}
