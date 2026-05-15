import { useState, useEffect, useCallback } from 'react'
import { useSessionStore } from '../stores/session-store'
import { IconTasks, IconQueue, IconUsage, IconFiles, IconSession, IconX } from './icons'

interface FileChange {
  filePath: string
  changeType: 'created' | 'modified'
  snapshotCount: number
}

type SectionId = 'session' | 'usage' | 'tasks' | 'queue' | 'files'

interface RailItem {
  id: SectionId
  Icon: React.ComponentType<{ size?: number; className?: string }>
  badge: number | null
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

  const currentState = activeSessionId ? sessionStates[activeSessionId] : undefined
  const usage = currentState?.usage
  const isStreaming = currentState?.isStreaming ?? false

  const loadFileChanges = useCallback(async () => {
    if (!activeSessionId) return
    try {
      const changes = await window.electronAPI?.invoke('file:get-changes', { sessionId: activeSessionId })
      if (changes) setFileChanges(changes)
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

  // Hide entirely on very narrow windows
  if (windowWidth < 700) return null

  const toggleSection = (section: SectionId) => {
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

  const activeTasks = tasks.filter((t) => t.status !== 'done')

  const railItems: RailItem[] = [
    { id: 'session', Icon: IconSession, badge: null },
    { id: 'usage', Icon: IconUsage, badge: null },
    { id: 'tasks', Icon: IconTasks, badge: activeTasks.length || null },
    { id: 'queue', Icon: IconQueue, badge: messageQueue.length || null },
    { id: 'files', Icon: IconFiles, badge: fileChanges.length || null },
  ]

  if (!expanded) {
    return (
      <div className="w-[44px] border-l border-[var(--border)] bg-[var(--surface)] flex flex-col items-center py-3 gap-2">
        {railItems.map(({ id, Icon, badge }) => (
          <button
            key={id}
            onClick={() => toggleSection(id)}
            className="relative p-2 rounded-[6px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
            aria-label={id}
          >
            <Icon size={18} />
            {badge != null && badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-[var(--accent)] text-[var(--accent-ink)] text-[9px] flex items-center justify-center leading-none font-medium">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="w-[300px] border-l border-[var(--border)] bg-[var(--surface)] overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-[12px] font-medium text-[var(--text)]">Inspector</span>
        <button
          onClick={() => { setExpanded(false); setActiveSection(null) }}
          className="p-1 rounded-[6px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
          aria-label="Close inspector"
        >
          <IconX size={14} />
        </button>
      </div>

      {/* Rail row for section switching */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)]">
        {railItems.map(({ id, Icon, badge }) => (
          <button
            key={id}
            onClick={() => toggleSection(id)}
            className={`relative p-2 rounded-[6px] ${
              activeSection === id
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
            }`}
            aria-label={id}
          >
            <Icon size={16} />
            {badge != null && badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-[var(--accent)] text-[var(--accent-ink)] text-[9px] flex items-center justify-center leading-none font-medium">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeSection === 'session' && <SessionSection sessionId={activeSessionId} />}
        {activeSection === 'usage' && <UsageSection usage={usage} />}
        {activeSection === 'tasks' && <TasksSection tasks={activeTasks} />}
        {activeSection === 'queue' && <QueueSection queue={messageQueue} removeFromQueue={removeFromQueue} />}
        {activeSection === 'files' && <FilesSection files={fileChanges} />}
      </div>
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

function UsageSection({ usage }: { usage?: { totalTokens: number; cacheHitRate: number; contextUsedPercent: number } }) {
  if (!usage) {
    return (
      <div>
        <SectionHeader>Usage</SectionHeader>
        <p className="text-[12px] text-[var(--muted)]">No usage data</p>
      </div>
    )
  }

  const contextColor = usage.contextUsedPercent > 80 ? 'var(--bad)' : 'var(--accent)'

  return (
    <div className="space-y-3">
      <SectionHeader>Usage</SectionHeader>
      <div className="space-y-2 text-[12px]">
        <div className="flex justify-between">
          <span className="text-[var(--muted)]">Tokens</span>
          <span className="text-[var(--text)] font-mono">{formatTokens(usage.totalTokens)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--muted)]">Cache hit</span>
          <span className="text-[var(--text)] font-mono">{Math.round(usage.cacheHitRate * 100)}%</span>
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

function TasksSection({ tasks }: { tasks: Array<{ id: string; subject: string; status: string }> }) {
  if (tasks.length === 0) {
    return (
      <div>
        <SectionHeader>Tasks</SectionHeader>
        <p className="text-[12px] text-[var(--muted)]">No active tasks</p>
      </div>
    )
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'running': return 'var(--accent)'
      case 'error': return 'var(--bad)'
      case 'pending': return 'var(--warn)'
      default: return 'var(--muted)'
    }
  }

  return (
    <div>
      <SectionHeader>Tasks</SectionHeader>
      <div className="space-y-1.5">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-2 text-[12px]">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: statusColor(task.status) }}
            />
            <span className="text-[var(--text)] truncate">{task.subject}</span>
          </div>
        ))}
      </div>
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
