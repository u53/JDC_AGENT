import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'
import { useSessionStore } from './stores/session-store'

export function App() {
  const { activeSessionId } = useSessionStore()

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        {activeSessionId ? (
          <ChatView />
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            选择一个项目开始对话
          </div>
        )}
        <StatusBar />
      </div>
      <SettingsPanel />
    </div>
  )
}
