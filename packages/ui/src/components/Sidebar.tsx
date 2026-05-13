import { useEffect } from 'react'
import { useSessionStore } from '../stores/session-store'

export function Sidebar() {
  const { projects, activeSessionId, loadProjects, createSession, switchSession, addProject } =
    useSessionStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <aside className="w-[260px] border-r border-[#EAEAEA] bg-[#F7F6F3] overflow-y-auto flex flex-col">
      <div className="pt-10 px-4 pb-4">
        <button
          onClick={addProject}
          className="w-full rounded-[6px] bg-[#111111] px-3 py-2 text-sm text-white hover:opacity-90 transition-opacity"
        >
          添加项目
        </button>
      </div>

      <div className="flex-1 px-4 pb-4 space-y-5">
        {projects.map((project) => (
          <div key={project.cwd}>
            <h3 className="text-xs font-medium text-[#787774] uppercase tracking-wide mb-1.5">
              {project.name}
            </h3>
            <div className="space-y-0.5">
              {project.sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => switchSession(session.id)}
                  className={`w-full text-left rounded-[6px] px-2.5 py-1.5 text-sm truncate transition-colors ${
                    activeSessionId === session.id
                      ? 'bg-white border border-[#EAEAEA] text-[#2F3437]'
                      : 'text-[#2F3437] hover:bg-white/60'
                  }`}
                >
                  {session.projectName || '新会话'}
                </button>
              ))}
              <button
                onClick={() => createSession(project.cwd)}
                className="w-full text-left rounded px-2.5 py-1.5 text-xs text-[#787774] hover:text-[#2F3437] transition-colors"
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
