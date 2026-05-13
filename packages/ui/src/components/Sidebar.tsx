import { useEffect } from 'react'
import { useSessionStore } from '../stores/session-store'

export function Sidebar() {
  const { projects, activeSessionId, loadProjects, createSession, switchSession, addProject } =
    useSessionStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <aside className="w-64 border-r border-gray-200 bg-gray-50 overflow-y-auto flex flex-col">
      <div className="p-3">
        <button
          onClick={addProject}
          className="w-full rounded-md bg-gray-200 px-3 py-2 text-sm text-gray-900 hover:bg-gray-200 transition-colors"
        >
          + 添加项目
        </button>
      </div>

      <div className="flex-1 px-3 pb-3 space-y-4">
        {projects.map((project) => (
          <div key={project.cwd}>
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              {project.name}
            </h3>
            <div className="space-y-0.5">
              {project.sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => switchSession(session.id)}
                  className={`w-full text-left rounded px-2 py-1.5 text-sm truncate transition-colors ${
                    activeSessionId === session.id
                      ? 'bg-gray-200 text-gray-900'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  {session.projectName || '新会话'}
                </button>
              ))}
              <button
                onClick={() => createSession(project.cwd)}
                className="w-full text-left rounded px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
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