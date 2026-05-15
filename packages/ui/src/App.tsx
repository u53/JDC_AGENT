import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { UsageHUD } from './components/UsageHUD'
import { ModelManager } from './components/ModelManager'
import { McpSettings } from './components/McpSettings'
import { AskUserDialog } from './components/AskUserDialog'
import { useSessionStore } from './stores/session-store'
import { useModelStore } from './stores/model-store'
import { useSettingsStore } from './stores/settings-store'
import { useHotkeys } from './hooks/useHotkeys'

export function App() {
  const { activeSessionId, projects } = useSessionStore()
  const createSession = useSessionStore((s) => s.createSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const switchSession = useSessionStore((s) => s.switchSession)
  const loadModels = useModelStore((s) => s.loadFromConfig)
  const [mcpOpen, setMcpOpen] = useState(false)
  const settingsIsOpen = useSettingsStore((s) => s.isOpen)
  const openSettings = useSettingsStore((s) => s.open)
  const closeSettings = useSettingsStore((s) => s.close)

  useEffect(() => { loadModels() }, [loadModels])

  // Flatten all sessions across project groups for index-based switching
  const allSessions = useMemo(
    () => projects.flatMap((p) => p.sessions),
    [projects]
  )

  const hotkeyMap = useMemo(() => {
    const map: Record<string, () => void> = {
      // Escape — abort current generation
      'escape': () => {
        if (activeSessionId) {
          window.electronAPI?.invoke('query:abort', { sessionId: activeSessionId })
        }
      },
      // Cmd/Ctrl+N — new session via folder dialog
      'mod+n': async () => {
        const path = await window.electronAPI?.invoke('dialog:open-folder')
        if (path && typeof path === 'string') {
          createSession(path)
        }
      },
      // Cmd/Ctrl+W — delete current session
      'mod+w': () => {
        if (activeSessionId) {
          deleteSession(activeSessionId)
        }
      },
      // Cmd/Ctrl+K — clear current session
      'mod+k': () => {
        if (activeSessionId) {
          window.electronAPI?.invoke('session:clear', { sessionId: activeSessionId })
        }
      },
      // Cmd/Ctrl+, — toggle settings panel
      'mod+,': () => {
        if (settingsIsOpen) {
          closeSettings()
        } else {
          openSettings()
        }
      },
    }

    // Cmd/Ctrl+1~9 — switch to Nth session
    for (let i = 1; i <= 9; i++) {
      map[`mod+${i}`] = () => {
        const session = allSessions[i - 1]
        if (session) {
          switchSession(session.id)
        }
      }
    }

    return map
  }, [activeSessionId, allSessions, createSession, deleteSession, switchSession, settingsIsOpen, openSettings, closeSettings])

  useHotkeys(hotkeyMap)

  return (
    <div className="flex h-screen w-screen bg-[var(--bg)] text-[var(--text)]">
      <Sidebar />
      <div className="flex-1 flex flex-col border-l border-[#333]">
        {activeSessionId ? (
          <ChatView onOpenMcp={() => setMcpOpen(true)} />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-[0.1em] text-[#666] mb-2">[ NO ACTIVE SESSION ]</div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-[#666]">选择一个项目开始对话</div>
            </div>
          </div>
        )}
        <UsageHUD onOpenMcp={() => setMcpOpen(true)} onOpenSettings={openSettings} />
      </div>
      <ModelManager />
      <McpSettings isOpen={mcpOpen} onClose={() => setMcpOpen(false)} />
      <AskUserDialog />
    </div>
  )
}
