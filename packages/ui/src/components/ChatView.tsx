import { useEffect, useRef, useState, useCallback } from 'react'
import { useSession } from '../hooks/useSession'
import { MessageBubble } from './MessageBubble'
import { ToolCardRouter } from './tool-cards'
import { ErrorCard } from './ErrorCard'
import { FileChangesPanel } from './FileChangesPanel'
import { TaskPanel } from './TaskPanel'
import { QueueIndicator } from './QueueIndicator'
import { PermissionDialog } from './PermissionDialog'
import { PlanReviewDialog } from './PlanReviewDialog'
import { HelpDialog } from './HelpDialog'
import { PromptInput } from './PromptInput'
import { AgentDetailPanel } from './AgentDetailPanel'
import { StatsCard } from './StatsCard'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'
import { useSettingsStore } from '../stores/settings-store'
import { useAgentStore } from '../stores/agent-store'
import { useAgentEvents } from '../hooks/useAgentEvents'
import type { ToolExecutionEvent } from '@jdcagnet/core'

type GroupedToolEvent =
  | { type: 'single'; event: ToolExecutionEvent }
  | { type: 'read-group'; events: ToolExecutionEvent[] }

function groupToolEvents(events: ToolExecutionEvent[]): GroupedToolEvent[] {
  const result: GroupedToolEvent[] = []
  let readBuffer: ToolExecutionEvent[] = []

  const flushReads = () => {
    if (readBuffer.length >= 2 && readBuffer.every(e => e.type === 'complete')) {
      result.push({ type: 'read-group', events: [...readBuffer] })
    } else {
      for (const e of readBuffer) {
        result.push({ type: 'single', event: e })
      }
    }
    readBuffer = []
  }

  for (const event of events) {
    if (event.toolName === 'file_read' && event.type === 'complete') {
      readBuffer.push(event)
    } else {
      flushReads()
      result.push({ type: 'single', event })
    }
  }
  flushReads()

  return result
}

interface ChatViewProps {
  onOpenMcp?: () => void
}

export function ChatView({ onOpenMcp }: ChatViewProps) {
  const { messages, streamingText, thinkingText, isStreaming, isThinking, toolEvents, sendMessage, abort, error, retry, dismissError } = useSession()
  const { activeSessionId } = useSessionStore()
  const enqueueMessage = useSessionStore((s) => s.enqueueMessage)
  const { getActiveModel, groups, activeModelId, setActiveModel } = useModelStore()
  const openSettings = useSettingsStore((s) => s.open)
  useAgentEvents()
  const activeAgentId = useAgentStore((s) => s.activeAgentId)
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
  const [planMode, setPlanModeState] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const activeModel = getActiveModel()

  const allModels = groups.flatMap(g => g.models.map(m => ({ id: m.id, name: m.name, groupName: g.name })))

  const handlePermissionChange = useCallback((mode: string) => {
    setPermissionMode(mode)
    localStorage.setItem('jdcagnet-permission-mode', mode)
    if (activeSessionId && (window as any).electronAPI?.setPermissionMode) {
      (window as any).electronAPI.setPermissionMode(activeSessionId, mode)
    }
  }, [activeSessionId])

  const setActiveAgent = useAgentStore((s) => s.setActiveAgent)

  useEffect(() => {
    setActiveAgent(null)
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
    if (activeSessionId) {
      useSessionStore.getState().loadTasks(activeSessionId)
    }
  }, [activeSessionId])

  // Shift+Tab toggles plan mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault()
        const api = (window as any).electronAPI
        if (activeSessionId && api?.setPlanMode) {
          const next = !planMode
          api.setPlanMode(activeSessionId, next ? 'planning' : 'normal')
          setPlanModeState(next)
          showToast(next ? '规划模式: 开启' : '规划模式: 关闭')
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [activeSessionId, planMode])

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

  const handleThinkingToggle = useCallback(() => {
    const api = (window as any).electronAPI
    setThinkingEnabled(prev => {
      const next = !prev
      localStorage.setItem('jdcagnet-thinking', String(next))
      if (activeSessionId && api?.setThinking) {
        api.setThinking(activeSessionId, next)
      }
      showToast(next ? '推理模式: 开启' : '推理模式: 关闭')
      return next
    })
  }, [activeSessionId, showToast])

  const handlePlanToggle = useCallback(() => {
    const api = (window as any).electronAPI
    if (activeSessionId && api?.setPlanMode) {
      const next = !planMode
      api.setPlanMode(activeSessionId, next ? 'planning' : 'normal')
      setPlanModeState(next)
      showToast(next ? '规划模式: 开启' : '规划模式: 关闭')
    }
  }, [activeSessionId, planMode, showToast])

  const visibleMessages = messages.filter(msg => {
    if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.every((b: any) => b.type === 'tool_result')) return false
    return true
  })

  const handleSlashCommand = (command: string) => {
    const api = (window as any).electronAPI
    switch (command) {
      case '/compact':
        if (activeSessionId && api?.compactSession) {
          useSessionStore.getState().markStreaming(activeSessionId, true)
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
        handleThinkingToggle()
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
      case '/commit':
        if (activeSessionId && api?.invoke) {
          api.invoke('file:get-changes', { sessionId: activeSessionId }).then((files: any[]) => {
            if (!files || files.length === 0) {
              showToast('No files changed in this session')
            } else {
              const paths = files.map((f: any) => f.filePath)
              const msg = `git add ${paths.join(' ')}`
              navigator.clipboard?.writeText(msg)
              showToast(`${files.length} files copied to clipboard`)
            }
          })
        }
        break
      case '/stats': {
        if (!activeSessionId) break
        Promise.all([
          api?.invoke('session:switch', { sessionId: activeSessionId }),
          api?.invoke('file:get-changes', { sessionId: activeSessionId }),
        ]).then(([switchData, filesData]: [any, any]) => {
          const usage = switchData?.usage
          if (usage) {
            const statsMsg = {
              id: 'stats-' + Date.now(),
              role: 'assistant' as const,
              content: [{ type: 'text', text: `__STATS__${JSON.stringify({ ...usage, filesChanged: filesData?.length || 0 })}` }],
              timestamp: Date.now(),
            }
            useSessionStore.setState((s: any) => ({ messages: [...s.messages, statsMsg] }))
          } else {
            showToast('暂无统计数据')
          }
        })
        break
      }
      case '/plan':
        handlePlanToggle()
        break
      case '/help':
        setShowHelp(true)
        break
      default:
        sendMessage(command)
    }
  }

  const streamingCharCount = streamingText.length

  return (
    <div className="flex flex-1 overflow-hidden relative">
      {/* Left: main chat */}
      <div className={`flex flex-col overflow-hidden ${activeAgentId ? 'w-[60%]' : 'w-full'} transition-all`}>
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
          {groupToolEvents(toolEvents).map((group, i) => {
            if (group.type === 'read-group') {
              const files = group.events.map(e => {
                const fp = (e.input?.file_path || e.input?.path || '') as string
                return fp.split('/').pop() || fp
              }).join(', ')
              return (
                <div key={`read-group-${i}`} className="mb-3 border border-[#333]">
                  <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em]">
                    <span className="inline-block h-2 w-2 rounded-full bg-[#4AF626]" />
                    <span className="text-[#EAEAEA]">READ</span>
                    <span className="text-[#666] truncate">{group.events.length} files: {files}</span>
                    <span className="text-[#4AF626]">[DONE]</span>
                  </div>
                </div>
              )
            }
            return <ToolCardRouter key={`${group.event.toolUseId}-${i}`} event={group.event} />
          })}
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
          {error && (
            <ErrorCard
              message={error.message}
              category={error.category}
              retrying={error.retrying}
              retryAttempt={error.retryAttempt}
              retryIn={error.retryIn}
              onRetry={retry}
              onDismiss={dismissError}
            />
          )}
          <PermissionDialog sessionId={activeSessionId} />
          <PlanReviewDialog sessionId={activeSessionId} />
        </div>
      </div>
      {toast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 border border-[#333] bg-[#111] px-4 py-2 text-[11px] text-[#EAEAEA] z-50">
          {toast}
        </div>
      )}
      <FileChangesPanel />
      <QueueIndicator />
      <TaskPanel />
      {planMode && (
        <div className="border-t border-purple-600/30 px-4 py-1.5 flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-purple-400" />
          <span className="text-[10px] uppercase tracking-[0.1em] text-purple-400">PLAN MODE</span>
          <span className="text-[10px] text-[#666]">只读 + 规划 | Shift+Tab 退出</span>
        </div>
      )}
      <PromptInput
        onSend={sendMessage}
        onAbort={abort}
        isStreaming={isStreaming}
        onSlashCommand={handleSlashCommand}
        onEnqueue={enqueueMessage}
        permissionMode={permissionMode}
        onPermissionChange={handlePermissionChange}
        thinkingEnabled={thinkingEnabled}
        onThinkingToggle={handleThinkingToggle}
        planMode={planMode}
        onPlanToggle={handlePlanToggle}
        modelName={activeModel?.model.name}
        modelId={activeModelId ?? undefined}
        models={allModels}
        onModelChange={setActiveModel}
        onModelClick={openSettings}
        skills={skills}
      />
      <HelpDialog visible={showHelp} onClose={() => setShowHelp(false)} />
      </div>

      {/* Right: agent detail panel */}
      {activeAgentId && (
        <div className="w-[40%]">
          <AgentDetailPanel />
        </div>
      )}
    </div>
  )
}
