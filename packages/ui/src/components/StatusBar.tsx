import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import { useModelStore } from '../stores/model-store'
import type { McpServerState } from '../lib/ipc-client'

interface StatusBarProps {
  onOpenMcp?: () => void
}

export function StatusBar({ onOpenMcp }: StatusBarProps) {
  const { open } = useSettingsStore()
  const { getActiveModel } = useModelStore()
  const active = getActiveModel()
  const [mcpServers, setMcpServers] = useState<McpServerState[]>([])

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

  return (
    <div className="flex items-center justify-between border-t border-[#333] px-4 py-1.5 text-[10px] uppercase tracking-[0.1em] text-[#666]">
      <div className="flex items-center gap-3">
        <button onClick={open} className="text-[#EAEAEA] hover:text-[#E61919] transition-colors tracking-[0.1em]">[SETTINGS]</button>
        {totalCount > 0 && (
          <button
            onClick={onOpenMcp}
            className={`transition-colors tracking-[0.1em] ${hasError ? 'text-red-500 hover:text-red-400' : 'text-[#EAEAEA] hover:text-[#4AF626]'}`}
          >
            MCP: {connectedCount}/{totalCount} {connectedCount === totalCount ? <span className="text-[#4AF626]">●</span> : hasError ? <span className="text-red-500">●</span> : <span className="text-yellow-400">●</span>}
          </button>
        )}
        {totalCount === 0 && (
          <button
            onClick={onOpenMcp}
            className="text-[#666] hover:text-[#EAEAEA] transition-colors tracking-[0.1em]"
          >
            MCP: --
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span>{active ? active.model.name : 'NO MODEL'}</span>
        <span className="text-[#333]">//</span>
        <span>TOKENS: --</span>
        <span className="text-[#333]">//</span>
        <span>COST: --</span>
      </div>
    </div>
  )
}
