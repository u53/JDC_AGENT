import { useEffect } from 'react'
import { useSessionStore } from '../stores/session-store'

export function Sidebar() {
  const { projects, activeSessionId, loadProjects, createSession, switchSession, addProject } =
    useSessionStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <aside className="w-64 border-r border-zinc-700 bg-zinc-900 overflow-y-auto flex flex-col">
      <div className="p-3">
        <button
          onClick={addProject}
          className="w-full rounded-md bg-zinc-700 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-600 transition-colors"
        >
          + 添加项目
        </button>
      </div>

      <div className="flex-1 px-3 pb-3 space-y-4">
        {projects.map((project) => (
          <div key={project.cwd}>
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">
              {project.name}
            </h3>
            <div className="space-y-0.5">
              {project.sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => switchSession(session.id)}
                  className={`w-full text-left rounded px-2 py-1.5 text-sm truncate transition-colors ${
                    activeSessionId === session.id
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {session.projectName || '新会话'}
                </button>
              ))}
              <button
                onClick={() => createSession(project.cwd)}
                className="w-full text-left rounded px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                + 新会话
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}