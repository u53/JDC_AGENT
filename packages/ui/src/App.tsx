import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { StatusBar } from './components/StatusBar'
import { ModelManager } from './components/ModelManager'
import { PermissionDialog } from './components/PermissionDialog'
import { McpSettings } from './components/McpSettings'
import { useSessionStore } from './stores/session-store'
import { useModelStore } from './stores/model-store'

export function App() {
  const { activeSessionId } = useSessionStore()
  const loadModels = useModelStore((s) => s.loadFromConfig)
  const [mcpOpen, setMcpOpen] = useState(false)

  useEffect(() => { loadModels() }, [loadModels])

  return (
    <div className="flex h-screen w-screen bg-[#0A0A0A] text-[#EAEAEA]">
      <Sidebar />
      <div className="flex-1 flex flex-col border-l border-[#333]">
        {activeSessionId ? (
          <ChatView />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-[0.1em] text-[#666] mb-2">[ NO ACTIVE SESSION ]</div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-[#666]">选择一个项目开始对话</div>
            </div>
          </div>
        )}
        <StatusBar onOpenMcp={() => setMcpOpen(true)} />
      </div>
      <ModelManager />
      <PermissionDialog />
      <McpSettings isOpen={mcpOpen} onClose={() => setMcpOpen(false)} />
    </div>
  )
}
