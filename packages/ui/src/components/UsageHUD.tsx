import { useState, useEffect } from 'react'
import type { McpServerState } from '../lib/ipc-client'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'

interface UsageHUDProps {
  onOpenMcp?: () => void
  onOpenSettings?: () => void
}

function formatTokens(tokens: number): string {
  if (tokens === 0) return '0'
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1000000).toFixed(2)}M`
}

export function UsageHUD({ onOpenMcp, onOpenSettings }: UsageHUDProps) {
  const [mcpServers, setMcpServers] = useState<McpServerState[]>([])
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const usage = activeSessionId ? sessionStates[activeSessionId]?.usage : undefined
  const activeModelId = useModelStore((s) => s.activeModelId)
  const groups = useModelStore((s) => s.groups)
  const modelName = (() => {
    if (!activeModelId) return undefined
    for (const g of groups) {
      const m = g.models.find(m => m.id === activeModelId)
      if (m) return m.name
    }
    return undefined
  })()

  useEffect(() => {
    window.electronAPI?.mcpListServers().then((states) => {
      if (states) setMcpServers(states)
    })
    window.electronAPI?.onMcpStateChanged((states) => {
      setMcpServers(states)
    })
  }, [])

  const connectedCount = mcpServers.filter(s => s.status === 'connected').length
  const totalCount = mcpServers.length
  const hasError = mcpServers.some(s => s.status === 'failed')

  const ctxColor = usage && usage.contextUsedPercent > 80 ? 'text-[#E61919]' : 'text-[#EAEAEA]'

  return (
    <div className="flex items-center justify-between border-t border-[#333] px-4 py-1.5 text-[10px] uppercase tracking-[0.1em] text-[#666]">
      <div className="flex items-center gap-3">
        <button onClick={onOpenSettings} className="text-[#EAEAEA] hover:text-[#4AF626] transition-colors tracking-[0.1em]">[SETTINGS]</button>
        {totalCount > 0 && (
          <button
            onClick={onOpenMcp}
            className={`transition-colors tracking-[0.1em] ${hasError ? 'text-red-500 hover:text-red-400' : 'text-[#EAEAEA] hover:text-[#4AF626]'}`}
          >
            MCP: {connectedCount}/{totalCount} {connectedCount === totalCount ? <span className="text-[#4AF626]">●</span> : hasError ? <span className="text-red-500">●</span> : <span className="text-yellow-400">●</span>}
          </button>
        )}
        {totalCount === 0 && (
          <button onClick={onOpenMcp} className="text-[#666] hover:text-[#EAEAEA] transition-colors tracking-[0.1em]">MCP: --</button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {usage ? (
          <>
            {modelName && <span className="text-[#EAEAEA]">{modelName}</span>}
            {modelName && <span className="text-[#333]">|</span>}
            <span className="text-[#EAEAEA]">{formatTokens(usage.totalTokens)}</span>
            <span className="text-[#333]">|</span>
            <span className="text-[#666]">Cache:</span>
            <span className="text-[#EAEAEA]">{usage.cacheHitRate}%</span>
            <span className="text-[#333]">|</span>
            <span className="text-[#666]">ctx:</span>
            <span className={ctxColor}>{usage.contextUsedPercent}%</span>
          </>
        ) : (
          <>
            <span>TOKENS: --</span>
            <span className="text-[#333]">//</span>
            <span>CTX: --</span>
          </>
        )}
      </div>
    </div>
  )
}
