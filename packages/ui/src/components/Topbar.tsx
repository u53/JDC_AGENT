import { useSessionStore } from '../stores/session-store'
import { useSettingsStore } from '../stores/settings-store'
import { useIdeStore } from '../stores/ide-store'
import { ThemeSegmented } from './ThemeSegmented'
import { IconPlus, IconSettings } from './icons'

export function Topbar() {
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const addProject = useSessionStore((s) => s.addProject)
  const openSettings = useSettingsStore((s) => s.open)
  const ideConnections = useIdeStore((s) => s.connections)
  const connectedIde = ideConnections.find((c) => c.status === 'connected')

  const activeProject = projects.find((p) =>
    p.sessions.some((s) => s.id === activeSessionId)
  )
  const projectName = activeProject?.name || projects[0]?.name || 'JDC Code'

  return (
    <header
      className="h-12 flex items-center justify-between pl-[78px] pr-5 border-b border-[var(--border)] bg-[var(--surface)]"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <h1 className="text-[18px] font-medium tracking-[-0.03em]" style={{ fontFamily: 'var(--font-serif)' }}>
          {projectName}
        </h1>
      </div>

      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
        {connectedIde && (
          <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-[var(--muted)]">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span>{connectedIde.ideName}</span>
          </div>
        )}
        <ThemeSegmented />
        <button
          onClick={addProject}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-[var(--border)] rounded-[8px] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          aria-label="New session"
        >
          <IconPlus size={14} />
          <span>New session</span>
        </button>
        <button
          onClick={() => openSettings()}
          className="p-2 rounded-[8px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          aria-label="Settings"
        >
          <IconSettings size={18} />
        </button>
      </div>
    </header>
  )
}
