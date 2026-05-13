import { useEffect, useRef, useState, useCallback } from 'react'
import { useSession } from '../hooks/useSession'
import { MessageBubble } from './MessageBubble'
import { ToolCardRouter } from './tool-cards'
import { PromptInput } from './PromptInput'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'
import { useSettingsStore } from '../stores/settings-store'

interface ChatViewProps {
  onOpenMcp?: () => void
}

export function ChatView({ onOpenMcp }: ChatViewProps) {
  const { messages, streamingText, thinkingText, isStreaming, isThinking, toolEvents, sendMessage, abort } = useSession()
  const { activeSessionId } = useSessionStore()
  const { getActiveModel, groups, activeModelId, setActiveModel } = useModelStore()
  const openSettings = useSettingsStore((s) => s.open)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [permissionMode, setPermissionMode] = useState(() => {
    return localStorage.getItem('jdcagnet-permission-mode') || 'standard'
  })
  const [responseExpanded, setResponseExpanded] = useState(false)
  const [thinkingEnabled, setThinkingEnabled] = useState(() => {
    return localStorage.getItem('jdcagnet-thinking') !== 'false'
  })
  const [toast, setToast] = useState<string | null>(null)
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])

  const activeModel = getActiveModel()

  const allModels = groups.flatMap(g => g.models.map(m => ({ id: m.id, name: m.name, groupName: g.name })))

  const handlePermissionChange = useCallback((mode: string) => {
    setPermissionMode(mode)
    localStorage.setItem('jdcagnet-permission-mode', mode)
    if (activeSessionId && (window as any).electronAPI?.setPermissionMode) {
      (window as any).electronAPI.setPermissionMode(activeSessionId, mode)
    }
  }, [activeSessionId])

  useEffect(() => {
    if (activeSessionId && (window as any).electronAPI?.listSkills) {
      (window as any).electronAPI.listSkills(activeSessionId).then(setSkills).catch(() => {})
    }
    // Sync permission mode to backend on session activation
    if (activeSessionId && (window as any).electronAPI?.setPermissionMode) {
      (window as any).electronAPI.setPermissionMode(activeSessionId, permissionMode)
    }
  }, [activeSessionId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, toolEvents, isThinking, isStreaming])

  useEffect(() => {
    if (!isStreaming) setResponseExpanded(false)
  }, [isStreaming])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])

  const visibleMessages = messages.filter(msg => {
    if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.every((b: any) => b.type === 'tool_result')) return false
    return true
  })

  const handleSlashCommand = (command: string) => {
    const api = (window as any).electronAPI
    switch (command) {
      case '/compact':
        if (activeSessionId && api?.compactSession) {
          showToast('正在压缩上下文...')
          api.compactSession(activeSessionId)
        }
        break
      case '/clear':
        if (activeSessionId && api?.clearSession) {
          api.clearSession(activeSessionId)
          useSessionStore.setState({ messages: [] })
          showToast('对话已清空')
        }
        break
      case '/thinking':
        setThinkingEnabled(prev => {
          const next = !prev
          localStorage.setItem('jdcagnet-thinking', String(next))
          if (activeSessionId && api?.setThinking) {
            api.setThinking(activeSessionId, next)
          }
          showToast(next ? '推理模式: 开启' : '推理模式: 关闭')
          return next
        })
        break
      case '/model':
        openSettings()
        break
      case '/mcp':
        onOpenMcp?.()
        break
      case '/permission': {
        const modes = ['standard', 'relaxed', 'strict'] as const
        const idx = modes.indexOf(permissionMode as typeof modes[number])
        const next = modes[(idx + 1) % modes.length]
        handlePermissionChange(next)
        const labels: Record<string, string> = { standard: '标准模式', relaxed: '完全访问', strict: '严格模式' }
        showToast(`权限: ${labels[next]}`)
        break
      }
      case '/status':
        showToast(`Session: ${activeSessionId?.slice(0, 8)} | Msgs: ${messages.length} | Model: ${activeModel?.model.name || '-'} | Thinking: ${thinkingEnabled ? 'ON' : 'OFF'}`)
        break
      case '/help':
        showToast('/compact /clear /thinking /model /mcp /permission /status')
        break
      default:
        sendMessage(command)
    }
  }

  const streamingCharCount = streamingText.length

  return (
    <div className="flex flex-1 flex-col overflow-hidden relative">
      <div className="flex items-center justify-center border-b border-[#333] px-4 py-2" style={{ WebkitAppRegion: 'drag' } as any}>
        <span className="text-[10px] uppercase tracking-[0.1em] text-[#666]">
          SESSION // {activeSessionId ? activeSessionId.slice(0, 8).toUpperCase() : '---'}
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[760px]">
          {visibleMessages.map((msg) => (
            <MessageBubble key={msg.id} role={msg.role} content={msg.content} nextMessage={messages[messages.indexOf(msg) + 1]} />
          ))}
          {toolEvents.map((event, i) => (
            <ToolCardRouter key={`${event.toolUseId}-${i}`} event={event} />
          ))}
          {isThinking && (
            <div className="mb-3 border border-[#333]">
              <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em]">
                <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
                <span className="text-purple-400">THINKING...</span>
                <span className="text-[#666]">{thinkingText.length} chars</span>
              </div>
            </div>
          )}
          {isStreaming && streamingText && (
            <div className="mb-3 border border-[#333]">
              <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#111] transition-colors" onClick={() => setResponseExpanded(!responseExpanded)}>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#4AF626] animate-pulse" />
                  <span className="text-[#4AF626]">RESPONDING...</span>
                  <span className="text-[#666]">{streamingCharCount} chars</span>
                </div>
                <span className="text-[10px] text-[#666]">{responseExpanded ? '▼' : '▶'}</span>
              </div>
              {responseExpanded && (
                <div className="border-t border-[#333] px-4 py-3 max-h-[400px] overflow-y-auto">
                  <div className="text-sm text-[#EAEAEA] whitespace-pre-wrap">{streamingText}<span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[#EAEAEA]" /></div>
                </div>
              )}
            </div>
          )}
          {isStreaming && !streamingText && !isThinking && toolEvents.length === 0 && (
            <div className="mb-3 border border-[#333]">
              <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#EAEAEA] animate-pulse" />
                <span className="text-[#EAEAEA]">PROCESSING...</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {toast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 border border-[#333] bg-[#111] px-4 py-2 text-[11px] text-[#EAEAEA] z-50">
          {toast}
        </div>
      )}
      <PromptInput
        onSend={sendMessage}
        onAbort={abort}
        isStreaming={isStreaming}
        onSlashCommand={handleSlashCommand}
        permissionMode={permissionMode}
        onPermissionChange={handlePermissionChange}
        modelName={activeModel?.model.name}
        modelId={activeModelId ?? undefined}
        models={allModels}
        onModelChange={setActiveModel}
        onModelClick={openSettings}
        skills={skills}
      />
    </div>
  )
}
