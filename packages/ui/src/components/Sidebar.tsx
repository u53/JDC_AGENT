import { useEffect } from 'react'
import { useSessionStore } from '../stores/session-store'

export function Sidebar() {
  const { projects, activeSessionId, sessionStates, loadProjects, createSession, switchSession, addProject } =
    useSessionStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <aside className="w-[240px] border-r border-[var(--border)] bg-[var(--surface)] overflow-y-auto flex flex-col" style={{ fontFamily: 'var(--font-sans)' }}>
      <div className="h-[38px] flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as any} />

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
                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      switchSession(session.id)
                      if (isFinished) useSessionStore.getState().dismissFinished(session.id)
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-[13px] truncate transition-colors flex items-center gap-1.5 rounded-[6px] ${
                      isActive
                        ? 'border-l-2 border-[var(--accent)] pl-2 bg-[var(--surface-2)] text-[var(--text)]'
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
                      {session.projectName || '新会话'}
                    </span>
                  </button>
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
