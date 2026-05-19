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
  agentBackground: (sessionId: string, agentToolUseId: string) =>
    ipcRenderer.invoke('agent:background', { sessionId, agentToolUseId }),
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
  gitStash: (cwd: string) => ipcRenderer.invoke('git:stash', { cwd }),
  gitStashPop: (cwd: string) => ipcRenderer.invoke('git:stash-pop', { cwd }),
  gitHasStash: (cwd: string) => ipcRenderer.invoke('git:has-stash', { cwd }),

  // Apps
  appsDetect: () => ipcRenderer.invoke('apps:detect'),
  appsOpen: (appId: string, cwd: string) => ipcRenderer.invoke('apps:open', { appId, cwd }),

  // IDE Integration
  ideGetState: () => ipcRenderer.invoke('ide:get-state'),
  ideOpenFile: (filePath: string, line?: number, column?: number) =>
    ipcRenderer.invoke('ide:open-file', { filePath, line, column }),
  ideOpenDiff: (params: any) => ipcRenderer.invoke('ide:open-diff', params),
  ideCloseDiffTabs: () => ipcRenderer.invoke('ide:close-diff-tabs'),
  ideGetDiagnostics: (filePaths: string[]) =>
    ipcRenderer.invoke('ide:get-diagnostics', { filePaths }),
  onIdeStateChanged: (callback: (connections: any[]) => void) => {
    const listener = (_event: unknown, connections: any[]) => callback(connections)
    ipcRenderer.on('ide:state-changed', listener)
    return () => { ipcRenderer.removeListener('ide:state-changed', listener) }
  },
  onIdeSelectionChanged: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data)
    ipcRenderer.on('ide:selection-changed', listener)
    return () => { ipcRenderer.removeListener('ide:selection-changed', listener) }
  },
  onIdeAtMentioned: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data)
    ipcRenderer.on('ide:at-mentioned', listener)
    return () => { ipcRenderer.removeListener('ide:at-mentioned', listener) }
  },

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

  // Updater
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),

  // Model
  modelTest: (params: { protocol: string; baseUrl: string; apiKey: string; modelId: string }) =>
    ipcRenderer.invoke('model:test', params),

  onUpdaterAvailable: (callback: (data: { version: string }) => void) => {
    const listener = (_event: unknown, payload: { version: string }) => callback(payload)
    ipcRenderer.on('updater:available', listener)
    return () => ipcRenderer.removeListener('updater:available', listener)
  },
  onUpdaterProgress: (callback: (data: { percent: number }) => void) => {
    const listener = (_event: unknown, payload: { percent: number }) => callback(payload)
    ipcRenderer.on('updater:progress', listener)
    return () => ipcRenderer.removeListener('updater:progress', listener)
  },
  onUpdaterDownloaded: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('updater:downloaded', listener)
    return () => ipcRenderer.removeListener('updater:downloaded', listener)
  },
  onUpdaterNotAvailable: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('updater:not-available', listener)
    return () => ipcRenderer.removeListener('updater:not-available', listener)
  },
  onUpdaterError: (callback: (data: { message: string }) => void) => {
    const listener = (_event: unknown, payload: { message: string }) => callback(payload)
    ipcRenderer.on('updater:error', listener)
    return () => ipcRenderer.removeListener('updater:error', listener)
  },

  getVersion: () => ipcRenderer.invoke('app:version'),
}

contextBridge.exposeInMainWorld('electronAPI', api)
console.log('[PRELOAD] electronAPI exposed successfully')
