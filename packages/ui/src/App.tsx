import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { StatusBar } from './components/StatusBar'
import { ModelManager } from './components/ModelManager'
import { PermissionDialog } from './components/PermissionDialog'
import { useSessionStore } from './stores/session-store'

export function App() {
  const { activeSessionId } = useSessionStore()

  return (
    <div className="flex h-screen w-screen bg-[#0A0A0A] text-[#EAEAEA]">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        {activeSessionId ? (
          <ChatView />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#666] text-xs uppercase tracking-[0.1em]">
            选择一个项目开始对话
          </div>
        )}
        <StatusBar />
      </div>
      <ModelManager />
      <PermissionDialog />
    </div>
  )
}
