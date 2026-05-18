import { contextBridge, ipcRenderer, clipboard } from 'electron'

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
  writeClipboard: (text: string) => clipboard.writeText(text),

  // Git
  gitBranchList: (cwd: string) => ipcRenderer.invoke('git:branch-list', { cwd }),
  gitBranchSwitch: (cwd: string, branch: string) => ipcRenderer.invoke('git:branch-switch', { cwd, branch }),
  gitBranchCreate: (cwd: string, branch: string, from?: string) => ipcRenderer.invoke('git:branch-create', { cwd, branch, from }),
  gitBranchDelete: (cwd: string, branch: string) => ipcRenderer.invoke('git:branch-delete', { cwd, branch }),
  gitStatus: (cwd: string) => ipcRenderer.invoke('git:status', { cwd }),

  // Apps
  appsDetect: () => ipcRenderer.invoke('apps:detect'),
  appsOpen: (appId: string, cwd: string) => ipcRenderer.invoke('apps:open', { appId, cwd }),

  // Terminal
  terminalCreate: (cwd: string) => ipcRenderer.invoke('terminal:create', { cwd }),
  terminalWrite: (id: string, data: string) => ipcRenderer.send('terminal:write', { id, data }),
  terminalResize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  terminalDestroy: (id: string) => ipcRenderer.invoke('terminal:destroy', { id }),
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => {
    const listener = (_event: unknown, payload: { id: string; data: string }) => callback(payload)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (callback: (data: { id: string; code: number }) => void) => {
    const listener = (_event: unknown, payload: { id: string; code: number }) => callback(payload)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
console.log('[PRELOAD] electronAPI exposed successfully')
