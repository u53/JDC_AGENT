import { useEffect, useState, useRef } from 'react'
import { useSessionStore } from '../stores/session-store'

export function Sidebar() {
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const loadProjects = useSessionStore((s) => s.loadProjects)
  const createSession = useSessionStore((s) => s.createSession)
  const switchSession = useSessionStore((s) => s.switchSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const addProject = useSessionStore((s) => s.addProject)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadProjects()
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
    <aside className="w-[240px] border-r border-[var(--border)] bg-[var(--surface)] overflow-y-auto flex flex-col" style={{ fontFamily: 'var(--font-sans)' }}>
      <div className="h-2 flex-shrink-0" />

      <div className="flex-1 px-3 pb-3 space-y-4">
        {projects.map((project) => (
          <div key={project.cwd}>
            <h3 className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] font-medium mb-1.5 px-2">
              {project.name}
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
                        if (e.key === 'Enter') handleRenameSubmit(session.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-full px-2.5 py-1.5 text-[13px] rounded-[6px] bg-[var(--surface-2)] border border-[var(--accent)] text-[var(--text)] outline-none"
                    />
                  )
                }

                if (confirmDeleteId === session.id) {
                  return (
                    <div key={session.id} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[6px] bg-[var(--surface-2)] border border-[var(--bad)]">
                      <span className="text-[12px] text-[var(--bad)] flex-1 truncate">删除?</span>
                      <button onClick={() => handleDelete(session.id)} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bad)] text-white hover:opacity-80">确认</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] px-1.5 py-0.5 rounded text-[var(--muted)] hover:text-[var(--text)]">取消</button>
                    </div>
                  )
                }

                return (
                  <div key={session.id} className="group relative flex items-center">
                    <button
                      onClick={() => {
                        switchSession(session.id)
                        if (isFinished) useSessionStore.getState().dismissFinished(session.id)
                      }}
                      onDoubleClick={() => handleDoubleClick(session.id, displayName)}
                      className={`w-full text-left px-2.5 py-1.5 text-[13px] truncate transition-colors flex items-center gap-1.5 rounded-[6px] ${
                        isActive
                          ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium'
                          : 'text-[var(--text)] hover:bg-[var(--surface-3)]'
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
                      className="absolute right-1 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--muted)] hover:text-[var(--bad)] hover:bg-[var(--surface-3)] transition-all"
                      aria-label="Delete session"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3h8M4.5 3V2h3v1M3 3v7h6V3M5 5v3M7 5v3"/></svg>
                    </button>
                  </div>
                )
              })}
              <button
                onClick={() => createSession(project.cwd)}
                className="w-full text-left px-2.5 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] transition-colors rounded-[6px]"
              >
                + New session
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={addProject}
          className="w-full border border-[var(--border)] text-[var(--text)] text-[12px] py-2.5 rounded-[8px] hover:bg-[var(--surface-2)] transition-colors"
        >
          New project
        </button>
      </div>
    </aside>
  )
}
