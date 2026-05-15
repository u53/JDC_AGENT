import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'

interface Props {
  permissionMode: string
  thinkingEnabled: boolean
  planMode: boolean
}

const PERM_LABELS: Record<string, string> = {
  auto: '自动',
  supervised: '监督',
  locked: '锁定',
}

export function SessionHeader({ permissionMode, thinkingEnabled, planMode }: Props) {
  const { activeSessionId, projects, sessionStates, messageQueue } = useSessionStore()
  const { activeModelId, groups } = useModelStore()

  const state = activeSessionId ? sessionStates[activeSessionId] : undefined
  const usage = state?.usage
  const isStreaming = state?.isStreaming ?? false

  const activeProject = projects.find((p) =>
    p.sessions.some((s) => s.id === activeSessionId)
  )

  let modelName = ''
  if (activeModelId) {
    for (const g of groups) {
      const m = g.models.find((m) => m.id === activeModelId)
      if (m) { modelName = m.name; break }
    }
  }

  const permLabel = PERM_LABELS[permissionMode] || permissionMode

  return (
    <div className="h-10 flex items-center justify-between px-5 border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0">
      {/* Left: project / session ID */}
      <div className="flex items-center gap-1 text-[12px] font-[var(--font-mono)] min-w-0">
        <span className="truncate text-[var(--text)]">{activeProject?.name || '—'}</span>
        <span className="text-[var(--muted)]">/</span>
        <span className="text-[var(--muted)] font-mono">{activeSessionId?.slice(0, 8) || '—'}</span>
      </div>

      {/* Right: status indicators */}
      <div className="flex items-center gap-3 text-[12px]">
        {modelName && (
          <span className="px-2 py-0.5 rounded-[5px] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]">
            {modelName}
          </span>
        )}

        <span className="text-[var(--muted)]">{permLabel}</span>

        {thinkingEnabled && (
          <span className="flex items-center gap-1 text-[var(--good)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--good)]" />
            推理
          </span>
        )}

        {planMode && (
          <span className="flex items-center gap-1 text-[var(--plan)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--plan)]" />
            规划
          </span>
        )}

        {isStreaming && (
          <span className="flex items-center gap-1 text-[var(--warn)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--warn)] animate-pulse" />
          </span>
        )}

        {messageQueue.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-[4px] bg-[var(--accent)]/15 text-[var(--accent)] text-[11px] font-medium">
            {messageQueue.length}
          </span>
        )}

        {usage && (
          <div className="flex items-center gap-1.5">
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
