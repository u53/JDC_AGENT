import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'
import { PermissionDialog } from './components/PermissionDialog'
import { useSessionStore } from './stores/session-store'

export function App() {
  const { activeSessionId } = useSessionStore()

  return (
    <div className="flex h-screen w-screen bg-[#FFFFFF]">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        {activeSessionId ? (
          <ChatView />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#787774]">
            选择一个项目开始对话
          </div>
        )}
        <StatusBar />
      </div>
      <SettingsPanel />
      <PermissionDialog />
    </div>
  )
}
