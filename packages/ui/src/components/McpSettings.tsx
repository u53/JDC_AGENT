import { useState, useEffect } from 'react'
import type { McpServerState } from '../lib/ipc-client'

interface McpSettingsProps {
  isOpen: boolean
  onClose: () => void
}

export function McpSettings({ isOpen, onClose }: McpSettingsProps) {
  const [servers, setServers] = useState<McpServerState[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    window.electronAPI?.mcpListServers().then((states) => {
      setServers(states ?? [])
      setLoading(false)
    })
    window.electronAPI?.onMcpStateChanged((states) => {
      setServers(states)
    })
  }, [isOpen])

  if (!isOpen) return null

  const statusIndicator = (status: string) => {
    switch (status) {
      case 'connected': return <span className="text-[#4AF626]">●</span>
      case 'connecting': return <span className="text-yellow-400 animate-pulse">●</span>
      case 'failed': return <span className="text-red-500">●</span>
      case 'disabled': return <span className="text-[#666]">○</span>
      default: return <span className="text-[#666]">●</span>
    }
  }

  const handleReconnect = async (name: string) => {
    await window.electronAPI?.mcpReconnect(name)
  }

  const handleToggle = async (name: string, currentlyDisabled: boolean) => {
    await window.electronAPI?.mcpToggle(name, currentlyDisabled)
  }

  const handleDelete = async (name: string) => {
    // Load current config, remove the server, save back
    const allServers: Record<string, any> = {}
    for (const s of servers) {
      if (s.name !== name) {
        allServers[s.name] = s.config
      }
    }
    await window.electronAPI?.mcpSaveConfig(allServers, 'global')
    // Remove from local state immediately
    setServers(prev => prev.filter(s => s.name !== name))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[560px] max-h-[80vh] border border-[#333] bg-[#0A0A0A] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#333]">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[#666]">[ MCP SERVERS ]</span>
          <button
            onClick={onClose}
            className="text-[#666] hover:text-[#EAEAEA] text-xs transition-colors"
          >
            [X]
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="text-[10px] uppercase tracking-[0.1em] text-[#666] animate-pulse">
              LOADING...
            </div>
          )}

          {!loading && servers.length === 0 && (
            <div className="text-center py-8">
              <div className="text-[10px] uppercase tracking-[0.1em] text-[#666] mb-2">
                NO MCP SERVERS CONFIGURED
              </div>
              <div className="text-[10px] text-[#666]">
                Add servers to ~/.jdcagnet/mcp-servers.json
              </div>
            </div>
          )}

          {!loading && servers.map(server => (
            <div key={server.name} className="border border-[#333] mb-2">
              {/* Server header row */}
              <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#111] transition-colors"
                onClick={() => setExpanded(expanded === server.name ? null : server.name)}
              >
                <div className="flex items-center gap-2">
                  {statusIndicator(server.status)}
                  <span className="text-[11px] uppercase tracking-[0.05em] text-[#EAEAEA]">
                    {server.name}
                  </span>
                  <span className="text-[10px] text-[#666]">
                    [{server.config.transport}]
                  </span>
                  {server.status === 'connected' && (
                    <span className="text-[10px] text-[#4AF626]">
                      {server.tools.length} tools
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {server.status === 'failed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReconnect(server.name) }}
                      className="text-[10px] uppercase tracking-[0.05em] text-yellow-400 hover:text-yellow-300 transition-colors"
                    >
                      [RETRY]
                    </button>
                  )}
                  {server.status !== 'disabled' && server.status !== 'connecting' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggle(server.name, false) }}
                      className="text-[10px] uppercase tracking-[0.05em] text-[#666] hover:text-red-500 transition-colors"
                    >
                      [OFF]
                    </button>
                  )}
                  {server.status === 'disabled' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggle(server.name, true) }}
                      className="text-[10px] uppercase tracking-[0.05em] text-[#666] hover:text-[#4AF626] transition-colors"
                    >
                      [ON]
                    </button>
                  )}
                  <span className="text-[10px] text-[#666]">
                    {expanded === server.name ? '[-]' : '[+]'}
                  </span>
                </div>
              </div>

              {/* Expanded details */}
              {expanded === server.name && (
                <div className="border-t border-[#333] px-3 py-2">
                  {/* Connection info */}
                  <div className="text-[10px] text-[#666] mb-2">
                    {server.config.transport === 'stdio' && (
                      <span>CMD: {server.config.command} {server.config.args?.join(' ')}</span>
                    )}
                    {server.config.transport === 'sse' && (
                      <span>URL: {server.config.url}</span>
                    )}
                  </div>

                  {/* Error */}
                  {server.error && (
                    <div className="text-[10px] text-red-500 mb-2 break-all">
                      ERR: {server.error}
                    </div>
                  )}

                  {/* Tools list */}
                  {server.tools.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.1em] text-[#666] mb-1">TOOLS:</div>
                      <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                        {server.tools.map(tool => (
                          <div key={tool.name} className="text-[10px] text-[#EAEAEA] pl-2">
                            <span className="text-[#4AF626]">*</span> {tool.name}
                            {tool.description && (
                              <span className="text-[#666] ml-1">-- {tool.description}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Delete button */}
                  <div className="mt-3 pt-2 border-t border-[#333]">
                    <button
                      onClick={() => handleDelete(server.name)}
                      className="text-[10px] uppercase tracking-[0.05em] text-red-500 hover:text-red-400 transition-colors"
                    >
                      [DELETE SERVER]
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-[#333] px-4 py-2">
          <div className="text-[10px] text-[#666]">
            CONFIG: ~/.jdcagnet/mcp-servers.json
          </div>
        </div>
      </div>
    </div>
  )
}
