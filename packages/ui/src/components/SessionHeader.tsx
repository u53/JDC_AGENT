import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'
import { useTerminalStore } from '../stores/terminal-store'
import { AppLauncher } from './AppLauncher'
import { IconTerminal } from './icons'

interface Props {
  permissionMode: string
  effort: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  planMode: boolean
}

const PERM_LABELS: Record<string, string> = {
  auto: '自动',
  supervised: '监督',
  locked: '锁定',
  standard: '标准',
  relaxed: '全访问',
  strict: '严格',
}

const EFFORT_LABELS: Record<string, string> = {
  off: '推理:关',
  low: '推理:低',
  medium: '推理:中',
  high: '推理:高',
  xhigh: '推理:超高',
  max: '推理:最大',
}

export function SessionHeader({ permissionMode, effort, planMode }: Props) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const projects = useSessionStore((s) => s.projects)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const messageQueue = useSessionStore((s) => s.messageQueue)
  const activeModelId = useModelStore((s) => s.activeModelId)
  const groups = useModelStore((s) => s.groups)

  const state = activeSessionId ? sessionStates[activeSessionId] : undefined
  const usage = state?.usage
  const isStreaming = state?.isStreaming ?? false

  const toggleTerminal = useTerminalStore((s) => s.toggle)

  const activeProject = projects.find((p) =>
    p.sessions.some((s) => s.id === activeSessionId)
  )

  let modelName = ''
  if (activeModelId) {
    for (const g of groups) {
      const m = g.models.find((m) => m.id === activeModelId)
      if (m) { modelName = `${g.name}:${m.name}`; break }
    }
  }

  const permLabel = PERM_LABELS[permissionMode] || permissionMode

  return (
    <div className="h-11 flex min-w-0 items-center justify-between gap-4 px-5 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] backdrop-blur flex-shrink-0">
      {/* Left: project / session ID */}
      <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] font-[var(--font-mono)]">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        <span className="truncate font-semibold text-[var(--text)]">{activeProject?.name || '—'}</span>
        <span className="text-[var(--muted)]">/</span>
        <span className="shrink-0 text-[var(--muted)] font-mono">{activeSessionId?.slice(0, 8) || '—'}</span>
      </div>

      {/* Center: devtools toolbar */}
      {activeProject?.cwd && (
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          {/* Open in + dropdown group */}
          <div className="flex items-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]">
            <AppLauncher cwd={activeProject.cwd} />
          </div>
          {/* Terminal button */}
          <div className="flex items-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]">
            <button
              onClick={toggleTerminal}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors"
              aria-label="Toggle terminal"
            >
              <IconTerminal size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Right: status indicators */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-hidden text-[12px]">
        {modelName && (
          <span className="min-w-0 max-w-[240px] truncate px-2 py-1 rounded-[6px] bg-[var(--surface-2)] border border-[var(--border)] font-mono text-[11px] text-[var(--text)]" title={modelName}>
            {modelName}
          </span>
        )}

        <span className="shrink-0 text-[var(--muted)]">{permLabel}</span>

        {effort !== 'off' && (
          <span className="flex shrink-0 items-center gap-1 text-[var(--good)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--good)]" />
            {EFFORT_LABELS[effort]}
          </span>
        )}

        {planMode && (
          <span className="flex shrink-0 items-center gap-1 text-[var(--plan)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--plan)]" />
            规划
          </span>
        )}

        {/* Branch switcher — next to plan indicator */}

        {isStreaming && (
          <span className="flex shrink-0 items-center gap-1 text-[var(--warn)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--warn)] animate-pulse" />
          </span>
        )}

        {messageQueue.length > 0 && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-[4px] bg-[var(--accent)]/15 text-[var(--accent)] text-[11px] font-medium">
            {messageQueue.length}
          </span>
        )}

        {usage && (
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="w-12 h-1 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(usage.contextUsedPercent, 100)}%`,
                  backgroundColor: usage.contextUsedPercent > 80 ? 'var(--bad)' : 'var(--accent)',
                }}
              />
            </div>
            <span className="text-[var(--muted)] text-[11px]">
              {Math.round(usage.contextUsedPercent)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
