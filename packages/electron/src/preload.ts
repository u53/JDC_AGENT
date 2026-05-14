import { contextBridge, ipcRenderer } from 'electron'

console.log('[PRELOAD] Script executing...')

const api = {
  send: (channel: string, data: unknown) => {
    ipcRenderer.send(channel, data)
  },
  invoke: (channel: string, data?: unknown) => {
    return ipcRenderer.invoke(channel, data)
  },
  on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => {
    const listener = (_event: unknown, ...args: unknown[]) => callback(_event, ...args)
    ipcRenderer.on(channel, listener)
    return () => { ipcRenderer.removeListener(channel, listener) }
  },
  mcpListServers: () => ipcRenderer.invoke('mcp:list-servers'),
  mcpReconnect: (serverName: string) => ipcRenderer.invoke('mcp:reconnect', { serverName }),
  mcpToggle: (serverName: string, enabled: boolean) => ipcRenderer.invoke('mcp:toggle', { serverName, enabled }),
  mcpSaveConfig: (servers: any, scope: string, cwd?: string) => ipcRenderer.invoke('mcp:save-config', { servers, scope, cwd }),
  onMcpStateChanged: (callback: (states: any[]) => void) => {
    ipcRenderer.on('mcp:state-changed', (_event, states) => callback(states))
  },
  listSkills: (sessionId: string) => ipcRenderer.invoke('skills:list', { sessionId }),
  setPermissionMode: (sessionId: string, mode: string) => ipcRenderer.invoke('session:set-permission-mode', { sessionId, mode }),
  compactSession: (sessionId: string) => ipcRenderer.invoke('session:compact', { sessionId }),
  clearSession: (sessionId: string) => ipcRenderer.invoke('session:clear', { sessionId }),
  setThinking: (sessionId: string, enabled: boolean, budget?: number) => ipcRenderer.invoke('session:set-thinking', { sessionId, enabled, budget }),
  agentAbort: (sessionId: string, agentToolUseId: string) =>
    ipcRenderer.invoke('agent:abort', { sessionId, agentToolUseId }),
  planRespond: (id: string, approved: boolean, feedback?: string) =>
    ipcRenderer.send('plan:respond', { id, approved, feedback }),
  setPlanMode: (sessionId: string, mode: string) =>
    ipcRenderer.invoke('session:set-plan-mode', { sessionId, mode }),
  getPlanMode: (sessionId: string) =>
    ipcRenderer.invoke('session:get-plan-mode', { sessionId }),
}

contextBridge.exposeInMainWorld('electronAPI', api)
console.log('[PRELOAD] electronAPI exposed successfully')
