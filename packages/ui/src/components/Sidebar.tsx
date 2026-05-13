import { useEffect } from 'react'
import { useSessionStore } from '../stores/session-store'

export function Sidebar() {
  const { projects, activeSessionId, sessionStates, loadProjects, createSession, switchSession, addProject } =
    useSessionStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <aside className="w-[240px] border-r border-[#333] bg-[#0A0A0A] overflow-y-auto flex flex-col">
      <div className="h-[38px] flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as any} />
      <div className="px-3 pb-3">
        <button
          onClick={addProject}
          className="w-full border border-[#EAEAEA] text-[#EAEAEA] uppercase text-[10px] tracking-[0.1em] py-2 hover:bg-[#EAEAEA] hover:text-[#0A0A0A] transition-colors"
        >
          + ADD PROJECT
        </button>
      </div>

      <div className="flex-1 px-3 pb-3 space-y-4">
        {projects.map((project) => (
          <div key={project.cwd}>
            <h3 className="text-[10px] uppercase tracking-[0.1em] text-[#666] mb-1.5 px-2">
              [ {project.name} ]
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
                    className={`w-full text-left px-2.5 py-1.5 text-xs truncate transition-colors flex items-center gap-1.5 ${
                      isActive
                        ? 'border-l-2 border-[#4AF626] pl-2 text-[#EAEAEA] bg-[#111]'
                        : 'text-[#EAEAEA] hover:bg-[#111]'
                    }`}
                  >
                    {showLight && isBusy && (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
                    )}
                    {showLight && !isBusy && hasError && (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#E61919] flex-shrink-0" />
                    )}
                    {showLight && !isBusy && !hasError && isFinished && (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#4AF626] flex-shrink-0" />
                    )}
                    <span className="block truncate">
                      {session.projectName || '新会话'}
                    </span>
                  </button>
                )
              })}
              <button
                onClick={() => createSession(project.cwd)}
                className="w-full text-left px-2.5 py-1.5 text-[10px] text-[#666] uppercase tracking-[0.1em] hover:text-[#EAEAEA] transition-colors"
              >
                + NEW SESSION
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
