import { useEffect, useRef, useState, useCallback } from 'react'
import { useSession } from '../hooks/useSession'
import { SessionHeader } from './SessionHeader'
import { ConversationTurn } from './ConversationTurn'
import { Composer } from './Composer'
import { ErrorCard } from './ErrorCard'
import { PermissionDialog } from './PermissionDialog'
import { PlanReviewDialog } from './PlanReviewDialog'
import { HelpDialog } from './HelpDialog'
import { AgentDetailPanel } from './AgentDetailPanel'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'
import { useSettingsStore } from '../stores/settings-store'
import { useAgentStore } from '../stores/agent-store'
import { useAgentEvents } from '../hooks/useAgentEvents'
import { copyToClipboard } from '../lib/clipboard'
import type { Message } from '@jdcagnet/core'

interface Turn {
  userMessage: Message
  assistantMessage?: Message
  nextAfterAssistant?: Message
}

function groupIntoTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'user') {
      // Skip tool_result-only user messages (they're internal, not user-initiated)
      if (Array.isArray(msg.content) && msg.content.every((b: any) => b.type === 'tool_result')) {
        continue
      }
      const next = messages[i + 1]
      if (next?.role === 'assistant') {
        // Find the tool_result message after the assistant (could be i+2 or further)
        let toolResultMsg: Message | undefined
        for (let j = i + 2; j < messages.length; j++) {
          const candidate = messages[j]
          if (candidate.role === 'user' && Array.isArray(candidate.content) && candidate.content.every((b: any) => b.type === 'tool_result')) {
            toolResultMsg = candidate
            break
          }
          break
        }
        turns.push({ userMessage: msg, assistantMessage: next, nextAfterAssistant: toolResultMsg })
        i++ // skip the assistant message
      } else {
        turns.push({ userMessage: msg })
      }
    }
  }
  return turns
}

interface ChatViewProps {
  onOpenMcp?: () => void
}

export function ChatView({ onOpenMcp }: ChatViewProps) {
  const { messages, streamingText, thinkingText, isStreaming, isThinking, toolEvents, sendMessage, abort, error, retry, dismissError } = useSession()
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const getActiveModel = useModelStore((s) => s.getActiveModel)
  const groups = useModelStore((s) => s.groups)
  const activeModelId = useModelStore((s) => s.activeModelId)
  const setActiveModel = useModelStore((s) => s.setActiveModel)
  const openSettings = useSettingsStore((s) => s.open)
  useAgentEvents()
  const activeAgentId = useAgentStore((s) => s.activeAgentId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [permissionMode, setPermissionMode] = useState(() => {
    return localStorage.getItem('jdcagnet-permission-mode') || 'standard'
  })
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
              copyToClipboard(msg)
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

  const turns = groupIntoTurns(messages)
  const lastTurn = turns[turns.length - 1]
  const isLastTurnActive = isStreaming && lastTurn && !lastTurn.assistantMessage

  return (
    <div className="flex flex-1 overflow-hidden relative">
      {/* Left: main chat */}
      <div className={`flex flex-col overflow-hidden ${activeAgentId ? 'w-[60%]' : 'w-full'} transition-all`}>
        <SessionHeader permissionMode={permissionMode} thinkingEnabled={thinkingEnabled} planMode={planMode} />

        {/* Conversation Timeline */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-[760px]">
            {turns.map((turn, idx) => {
              const isActive = idx === turns.length - 1 && isStreaming
              return (
                <ConversationTurn
                  key={turn.userMessage.id}
                  userContent={turn.userMessage.content}
                  assistantContent={turn.assistantMessage?.content || []}
                  nextMessage={turn.nextAfterAssistant}
                  isActive={isActive}
                  streamingText={isActive ? streamingText : undefined}
                  thinkingText={isActive ? thinkingText : undefined}
                  isThinking={isActive ? isThinking : undefined}
                  toolEvents={isActive ? toolEvents : undefined}
                />
              )
            })}

            {/* Processing indicator when no content yet */}
            {isStreaming && !streamingText && !isThinking && toolEvents.length === 0 && !isLastTurnActive && (
              <div className="mb-3 border border-[var(--border)] rounded-[8px]">
                <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em]">
                  <span className="inline-block h-2 w-2 rounded-full bg-[var(--text)] animate-pulse" />
                  <span className="text-[var(--text)]">PROCESSING...</span>
                </div>
              </div>
            )}

            {/* Error / Permission / Plan Review */}
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

        {/* Toast */}
        {toast && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-[var(--surface)] border border-[var(--border)] rounded-[8px] px-4 py-2 text-[11px] text-[var(--text)] z-50 shadow-[var(--shadow-soft)]">
            {toast}
          </div>
        )}

        {/* Plan mode bar */}
        {planMode && (
          <div className="border-t border-[var(--plan)] px-4 py-1.5 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--plan)]" />
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--plan)]">PLAN MODE</span>
            <span className="text-[10px] text-[var(--muted)]">只读 + 规划 | Shift+Tab 退出</span>
          </div>
        )}

        {/* Composer */}
        <Composer
          onSend={sendMessage}
          onAbort={abort}
          isStreaming={isStreaming}
          onSlashCommand={handleSlashCommand}
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
