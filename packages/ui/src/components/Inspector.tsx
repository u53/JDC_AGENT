import { useState, useEffect, useCallback, useRef } from 'react'
import { useSessionStore } from '../stores/session-store'
import { useBackgroundTaskStore, type BackgroundTaskItem } from '../stores/background-task-store'
import { useTeamStore } from '../stores/team-store'
import { ipc } from '../lib/ipc-client'
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
  Icon: React.ComponentType<{ size?: number; className?: string }>
  badge: string | number | null
  badgeColor?: string
}

const INSPECTOR_WIDTH_KEY = 'jdcagnet.inspector.width'
const MIN_WIDTH = 280
const MAX_WIDTH = 700
const DEFAULT_WIDTH = 320

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
    { id: 'session', Icon: IconSession, badge: null },
    { id: 'usage', Icon: IconUsage, badge: null },
    { id: 'tasks', Icon: IconTasks, badge: taskBadge, badgeColor: taskBadgeColor },
    { id: 'team', Icon: IconTeam, badge: teamBadge, badgeColor: teamBadgeColor },
    ...(showContextInspector ? [{ id: 'context' as const, Icon: IconJdcGraph, badge: contextBadge, badgeColor: contextBadgeColor }] : []),
    { id: 'queue', Icon: IconQueue, badge: messageQueue.length || null },
    { id: 'files', Icon: IconFiles, badge: fileChanges.length || null },
  ]

  if (!expanded) {
    return (
      <div className="w-[44px] border-l border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] flex flex-col items-center py-3 gap-2 backdrop-blur">
        {railItems.map(({ id, Icon, badge, badgeColor }) => (
          <button
            key={id}
            onClick={() => toggleSection(id)}
            className="relative p-2 rounded-[8px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
            aria-label={id}
          >
            <Icon size={18} />
            {badge != null && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full text-[var(--accent-ink)] text-[9px] flex items-center justify-center leading-none font-medium" style={{ backgroundColor: badgeColor || 'var(--accent)' }}>
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
      className="h-full border-l border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] flex flex-col relative overflow-hidden backdrop-blur"
      style={{ width: `${width}px` }}
    >
      {/* Drag handle on the left edge */}
      <div
        onMouseDown={startDrag}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)]/40 z-10"
        title="Drag to resize"
      />

      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text)]">Inspector</span>
        <button
          onClick={() => { setExpanded(false); setActiveSection(null) }}
          className="p-1 rounded-[6px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
          aria-label="Close inspector"
        >
          <IconX size={14} />
        </button>
      </div>

      {/* Rail row for section switching */}
      <div className="flex-shrink-0 flex items-center gap-1 px-3 py-2 border-b border-[var(--border)]">
        {railItems.map(({ id, Icon, badge, badgeColor }) => (
          <button
            key={id}
            onClick={() => toggleSection(id)}
            className={`relative p-2 rounded-[8px] ${
              activeSection === id
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
            }`}
            aria-label={id}
          >
            <Icon size={16} />
            {badge != null && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full text-[var(--accent-ink)] text-[9px] flex items-center justify-center leading-none font-medium" style={{ backgroundColor: badgeColor || 'var(--accent)' }}>
                {badge}
              </span>
            )}
          </button>
        ))}
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
              <p className="text-[12px] text-[var(--muted)]">No active team. Create one with the Team tool.</p>
            </div>
          )}
        </div>
      ) : activeSection === 'context' && showContextInspector ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <ContextPanel sessionId={activeSessionId} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-[0.1em] text-[var(--muted)] font-medium mb-2">
      {children}
    </h3>
  )
}

function SessionSection({ sessionId }: { sessionId: string | null }) {
  return (
    <div>
      <SectionHeader>Session</SectionHeader>
      <p className="text-[12px] font-[var(--font-mono)] font-mono text-[var(--text)]">
        {sessionId ? sessionId.slice(0, 8) : 'None'}
      </p>
    </div>
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
      <div>
        <SectionHeader>Usage</SectionHeader>
        <p className="text-[12px] text-[var(--muted)]">No usage data</p>
      </div>
    )
  }

  const contextColor = usage.contextUsedPercent > 80 ? 'var(--bad)' : 'var(--accent)'
  const subTotal = usage.subAgentTotalTokens ?? 0
  const grandTotal = usage.grandTotalTokens ?? usage.totalTokens
  const hasSub = subTotal > 0

  return (
    <div className="space-y-3">
      <SectionHeader>Usage</SectionHeader>
      <div className="space-y-2 text-[12px]">
        <div className="flex justify-between">
          <span className="text-[var(--muted)]">Main session</span>
          <span className="text-[var(--text)] font-mono">{formatTokens(usage.totalTokens)}</span>
        </div>
        {hasSub && (
          <div className="flex justify-between">
            <span className="text-[var(--muted)]" title="Sub-agents (Agent tool) and team workers/PM/skill router. Counted toward total billing but isolated from main context window.">Sub-agents / team</span>
            <span className="text-[var(--text)] font-mono">
              {formatTokens(subTotal)}
              {usage.subAgentTurnCount ? <span className="text-[var(--muted)] ml-1">({usage.subAgentTurnCount} turns)</span> : null}
            </span>
          </div>
        )}
        {hasSub && (
          <div className="flex justify-between border-t border-[var(--border)] pt-1.5">
            <span className="text-[var(--text)]">Grand total</span>
            <span className="text-[var(--text)] font-mono font-semibold">{formatTokens(grandTotal)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-[var(--muted)]">Cache hit</span>
          <span className="text-[var(--text)] font-mono">{Math.round(usage.cacheHitRate)}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--muted)]">Context</span>
          <div className="flex items-center gap-2">
            <div className="w-16 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(usage.contextUsedPercent, 100)}%`, backgroundColor: contextColor }}
              />
            </div>
            <span className="text-[var(--text)] font-mono text-[11px]">{Math.round(usage.contextUsedPercent)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TasksSection({ tasks, backgroundTasks, onOpenTeam }: {
  tasks: Array<{ id: string; subject: string; status: string }>
  backgroundTasks: BackgroundTaskItem[]
  onOpenTeam: (id: string) => void
}) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const runningBg = backgroundTasks.filter(t => t.status === 'running')

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
      {backgroundTasks.length > 0 && (
        <div>
          <SectionHeader>Background ({runningBg.length} running)</SectionHeader>
          <div className="space-y-1.5">
            {backgroundTasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-center gap-2 text-[12px] group ${task.type === 'team' ? 'cursor-pointer hover:opacity-80' : ''}`}
                onClick={() => handleOpen(task)}
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${task.status === 'running' ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: task.status === 'running' ? 'var(--accent)' : task.status === 'completed' ? 'var(--good)' : 'var(--bad)' }}
                />
                <span className="text-[10px] text-[var(--muted)] uppercase w-[32px] flex-shrink-0">
                  {task.type === 'shell' ? 'SH' : task.type === 'team' ? 'TM' : 'AI'}
                </span>
                <span className="truncate text-[var(--text)] flex-1">
                  {task.type === 'shell' ? (task.command || '').slice(0, 40) : (task.prompt || '').slice(0, 40)}
                </span>
                {task.status === 'running' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleStop(task.id) }}
                    className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--bad)] hover:opacity-80"
                  >
                    [STOP]
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tasks.length > 0 && (
        <div>
          <SectionHeader>Tasks ({tasks.filter(t => t.status === 'completed').length}/{tasks.length})</SectionHeader>
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 text-[12px]">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: task.status === 'completed' ? 'var(--good)' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--muted)' }}
                />
                <span className={`truncate ${task.status === 'completed' ? 'text-[var(--good)]' : 'text-[var(--text)]'}`}>
                  {task.subject}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {backgroundTasks.length === 0 && tasks.length === 0 && (
        <div>
          <SectionHeader>Tasks</SectionHeader>
          <p className="text-[12px] text-[var(--muted)]">No tasks</p>
        </div>
      )}
    </div>
  )
}

function QueueSection({ queue, removeFromQueue }: { queue: string[]; removeFromQueue: (i: number) => void }) {
  if (queue.length === 0) {
    return (
      <div>
        <SectionHeader>Queue</SectionHeader>
        <p className="text-[12px] text-[var(--muted)]">Queue is empty</p>
      </div>
    )
  }

  const clearAll = () => {
    for (let i = queue.length - 1; i >= 0; i--) {
      removeFromQueue(i)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <SectionHeader>Queue</SectionHeader>
        <button
          onClick={clearAll}
          className="text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
        >
          Clear all
        </button>
      </div>
      <div className="space-y-1.5">
        {queue.map((msg, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px] group">
            <span className="text-[var(--text)] truncate flex-1">{msg.slice(0, 60)}</span>
            <button
              onClick={() => removeFromQueue(i)}
              className="text-[var(--muted)] hover:text-[var(--bad)] opacity-0 group-hover:opacity-100 flex-shrink-0"
            >
              <IconX size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function FilesSection({ files }: { files: FileChange[] }) {
  if (files.length === 0) {
    return (
      <div>
        <SectionHeader>Files Changed</SectionHeader>
        <p className="text-[12px] text-[var(--muted)]">No file changes</p>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader>Files Changed</SectionHeader>
      <div className="space-y-1">
        {files.map((file) => (
          <div key={file.filePath} className="flex items-center gap-2 text-[12px]">
            <span
              className="flex-shrink-0 w-4 text-center font-mono"
              style={{ color: file.changeType === 'created' ? 'var(--good)' : 'var(--warn)' }}
            >
              {file.changeType === 'created' ? '+' : '~'}
            </span>
            <span className="text-[var(--text)] truncate font-mono">
              {file.filePath.split('/').pop()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
