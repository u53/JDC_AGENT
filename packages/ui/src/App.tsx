import { useEffect, useMemo } from 'react'
import { Topbar } from './components/Topbar'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { SettingsOverlay } from './components/SettingsOverlay'
import { ProjectPage } from './components/ProjectPage'
import { AskUserDialog } from './components/AskUserDialog'
import { Inspector } from './components/Inspector'
import { TerminalPanel } from './components/TerminalPanel'
import { useSessionStore } from './stores/session-store'
import { useModelStore } from './stores/model-store'
import { useSettingsStore } from './stores/settings-store'
import { useTerminalStore } from './stores/terminal-store'
import { useHotkeys } from './hooks/useHotkeys'

export function App() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const projects = useSessionStore((s) => s.projects)
  const createSession = useSessionStore((s) => s.createSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const switchSession = useSessionStore((s) => s.switchSession)
  const loadModels = useModelStore((s) => s.loadFromConfig)
  const settingsIsOpen = useSettingsStore((s) => s.isOpen)
  const openSettings = useSettingsStore((s) => s.open)
  const closeSettings = useSettingsStore((s) => s.close)

  useEffect(() => { loadModels() }, [loadModels])

  const activeProject = projects.find((p) =>
    p.sessions.some((s) => s.id === activeSessionId)
  )

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
      // Cmd/Ctrl+` — toggle terminal panel
      'mod+`': () => {
        const { toggle } = useTerminalStore.getState()
        toggle()
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
    <div className="h-screen w-screen grid grid-rows-[48px_1fr] bg-[var(--bg)] text-[var(--text)]">
      <Topbar />
      <div className="grid grid-cols-[240px_1fr_auto] overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden border-l border-[var(--border)]">
          {activeSessionId ? (
            <>
              <div className="flex-1 flex flex-col overflow-hidden">
                <ChatView onOpenMcp={() => openSettings('mcp')} />
              </div>
              <TerminalPanel cwd={activeProject?.cwd || ''} />
            </>
          ) : (
            <ProjectPage />
          )}
        </div>
        <Inspector />
      </div>
      <SettingsOverlay />
      <AskUserDialog />
    </div>
  )
}
