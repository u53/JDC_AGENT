import { useEffect } from 'react'
import { useSessionStore } from '../stores/session-store'

export function Sidebar() {
  const { projects, activeSessionId, loadProjects, createSession, switchSession, addProject } =
    useSessionStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <aside className="w-[260px] border-r border-[#333] bg-[#0A0A0A] overflow-y-auto flex flex-col">
      <div className="h-[38px] flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as any} />
      <div className="px-4 pb-4">
        <button
          onClick={addProject}
          className="w-full border border-[#EAEAEA] text-[#EAEAEA] uppercase text-[10px] tracking-[0.1em] py-2 hover:bg-[#EAEAEA] hover:text-[#0A0A0A] transition-colors"
        >
          添加项目
        </button>
      </div>

      <div className="flex-1 px-4 pb-4 space-y-5">
        {projects.map((project) => (
          <div key={project.cwd}>
            <h3 className="text-[10px] uppercase tracking-[0.1em] text-[#666] mb-1.5">
              [ {project.name} ]
            </h3>
            <div className="space-y-0.5">
              {project.sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => switchSession(session.id)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs truncate transition-colors ${
                    activeSessionId === session.id
                      ? 'border-l-2 border-[#E61919] pl-2 text-[#EAEAEA]'
                      : 'text-[#EAEAEA] hover:bg-[#111]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {activeSessionId === session.id && (
                      <span className="inline-block w-1.5 h-1.5 bg-[#4AF626]" />
                    )}
                    {session.projectName || '新会话'}
                  </span>
                </button>
              ))}
              <button
                onClick={() => createSession(project.cwd)}
                className="w-full text-left px-2.5 py-1.5 text-[10px] text-[#666] uppercase tracking-[0.1em] hover:text-[#EAEAEA] transition-colors"
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
