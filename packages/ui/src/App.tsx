import { Sidebar } from './components/Sidebar'
import { useSessionStore } from './stores/session-store'

export function App() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100">
      <Sidebar />
      <main className="flex-1 flex flex-col">
        {activeSessionId ? (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            会话已激活: {activeSessionId.slice(0, 8)}...
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            选择一个项目开始对话
          </div>
        )}
      </main>
    </div>
  )
}
