import { useEffect, useState, useRef } from 'react'
import { useSessionStore } from '../stores/session-store'
import { useSettingsStore } from '../stores/settings-store'

export function Sidebar() {
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const loadProjects = useSessionStore((s) => s.loadProjects)
  const createSession = useSessionStore((s) => s.createSession)
  const switchSession = useSessionStore((s) => s.switchSession)
  const openProjectConsole = useSessionStore((s) => s.openProjectConsole)
  const renameSession = useSessionStore((s) => s.renameSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const addProject = useSessionStore((s) => s.addProject)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadProjects()
    window.electronAPI?.getVersion?.().then((v: string) => setVersion(v))
    const unsub = window.electronAPI?.on('updater:available', (_e: unknown, data: unknown) => {
      setUpdateAvailable((data as { version: string }).version)
    })
    return unsub
  }, [loadProjects])

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const handleDoubleClick = (sessionId: string, currentTitle: string) => {
    setEditingId(sessionId)
    setEditValue(currentTitle)
  }

  const handleRenameSubmit = (sessionId: string) => {
    const trimmed = editValue.trim()
    if (trimmed) {
      renameSession(sessionId, trimmed)
    }
    setEditingId(null)
  }

  const handleDelete = (sessionId: string) => {
    deleteSession(sessionId)
    setConfirmDeleteId(null)
  }

  return (
    <aside className="sidebar-shell w-[240px] border-r border-[color-mix(in_srgb,var(--border)_86%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_96%,transparent),color-mix(in_srgb,var(--bg)_90%,transparent))] flex flex-col overflow-hidden shadow-[inset_-1px_0_0_rgba(255,255,255,0.025)] backdrop-blur" style={{ fontFamily: 'var(--font-sans)' }}>
      <div className="h-2 flex-shrink-0" />

      <div className="flex-1 px-3 pb-3 space-y-4 overflow-y-auto">
        {projects.map((project) => (
          <div key={project.cwd} className="sidebar-project-group rounded-[8px] border border-transparent bg-[color-mix(in_srgb,var(--surface-2)_26%,transparent)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
            <h3 className="mb-1.5 px-2">
              <button
                type="button"
                onClick={() => openProjectConsole(project.cwd)}
                className="sidebar-project-heading sidebar-project-console-trigger block w-full truncate text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[color-mix(in_srgb,var(--muted)_86%,var(--text)_14%)] transition-colors hover:text-[var(--accent)]"
                aria-label={`Open ${project.name} project console`}
                title={project.cwd}
              >
                {project.name}
              </button>
            </h3>
            <div className="space-y-0.5">
              {project.sessions.map((session) => {
                const state = sessionStates[session.id]
                const isBusy = state?.isStreaming
                const hasError = state?.error && !state.error.retrying
                const isFinished = state?.finished
                const isActive = activeSessionId === session.id
                const showLight = !isActive && (isBusy || hasError || isFinished)
                const displayName = session.title || session.id.slice(0, 8)

                if (editingId === session.id) {
                  return (
                    <input
                      key={session.id}
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(session.id)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return
                        if (e.key === 'Enter') handleRenameSubmit(session.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-full px-2.5 py-1.5 text-[13px] rounded-[6px] bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] border border-[color-mix(in_srgb,var(--accent)_36%,var(--border))] text-[var(--text)] outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
                    />
                  )
                }

                if (confirmDeleteId === session.id) {
                  return (
                    <div key={session.id} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[6px] bg-[color-mix(in_srgb,var(--bad)_8%,var(--surface-2))] border border-[color-mix(in_srgb,var(--bad)_36%,var(--border))]">
                      <span className="text-[12px] text-[var(--bad)] flex-1 truncate">删除?</span>
                      <button onClick={() => handleDelete(session.id)} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bad)] text-white hover:opacity-80">确认</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] px-1.5 py-0.5 rounded text-[var(--muted)] hover:text-[var(--text)]">取消</button>
                    </div>
                  )
                }

                return (
                  <div key={session.id} className="sidebar-session-row group relative flex items-center">
                    <button
                      onClick={() => {
                        switchSession(session.id)
                        if (isFinished) useSessionStore.getState().dismissFinished(session.id)
                      }}
                      onDoubleClick={() => handleDoubleClick(session.id, displayName)}
                      className={`w-full relative overflow-hidden text-left px-2.5 py-1.5 text-[13px] truncate transition-colors duration-150 flex items-center gap-1.5 rounded-[6px] ${
                        isActive
                          ? 'sidebar-session-active bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface-2))] text-[var(--text)] font-medium ring-1 ring-[color-mix(in_srgb,var(--accent)_24%,var(--border))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-[var(--accent)]'
                          : 'sidebar-session-idle text-[color-mix(in_srgb,var(--text)_88%,var(--muted)_12%)] hover:bg-[color-mix(in_srgb,var(--surface-3)_56%,transparent)]'
                      }`}
                    >
                      {showLight && isBusy && (
                        <span className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--warn)] animate-pulse flex-shrink-0" />
                      )}
                      {showLight && !isBusy && hasError && (
                        <span className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--bad)] flex-shrink-0" />
                      )}
                      {showLight && !isBusy && !hasError && isFinished && (
                        <span className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--good)] flex-shrink-0" />
                      )}
                      <span className="block truncate">
                        {displayName}
                      </span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(session.id) }}
                      className="absolute right-1 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--muted)] hover:text-[var(--bad)] hover:bg-[color-mix(in_srgb,var(--surface-3)_68%,transparent)] transition-all"
                      aria-label="Delete session"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3h8M4.5 3V2h3v1M3 3v7h6V3M5 5v3M7 5v3"/></svg>
                    </button>
                  </div>
                )
              })}
              <button
                onClick={() => createSession(project.cwd)}
                className="w-full text-left px-2.5 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--surface-3)_44%,transparent)] transition-colors rounded-[6px]"
              >
                + New session
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-footer px-3 py-3 space-y-2 border-t border-[color-mix(in_srgb,var(--border)_86%,transparent)] bg-[color-mix(in_srgb,var(--surface)_34%,transparent)] flex-shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
        <button
          onClick={addProject}
          className="w-full border border-[color-mix(in_srgb,var(--border)_88%,transparent)] bg-[color-mix(in_srgb,var(--surface-2)_48%,transparent)] text-[var(--text)] text-[12px] py-2.5 rounded-[8px] hover:border-[var(--border-strong)] hover:bg-[color-mix(in_srgb,var(--surface-3)_58%,transparent)] transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
        >
          New project
        </button>
        <div className="text-center text-[10px] text-[var(--muted)]">
          JDC Code {version ? `v${version}` : ''}
          {updateAvailable && (
            <button
              onClick={() => useSettingsStore.getState().open('advanced')}
              className="ml-1.5 text-[var(--accent)] hover:underline"
            >
              v{updateAvailable} 可用
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
