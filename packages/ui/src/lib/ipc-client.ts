import type { AppConfig, ConstraintObservabilitySnapshot, Message, StreamChunk, ToolExecutionEvent } from '@jdcagnet/core'

export interface McpServerState {
  name: string
  config: { transport: string; command?: string; args?: string[]; url?: string; disabled?: boolean }
  status: 'connected' | 'connecting' | 'failed' | 'disconnected' | 'disabled'
  error?: string
  tools: { name: string; description?: string }[]
}

declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, data?: unknown) => Promise<unknown>
      on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => () => void
      send: (channel: string, data: unknown) => void
      mcpListServers: () => Promise<McpServerState[]>
      mcpReconnect: (serverName: string) => Promise<void>
      mcpToggle: (serverName: string, enabled: boolean) => Promise<void>
      mcpSaveConfig: (servers: any, scope: string, cwd?: string) => Promise<void>
      onMcpStateChanged: (callback: (states: McpServerState[]) => void) => void
      listSkills: (sessionId: string) => Promise<{ name: string; description: string }[]>
      setPermissionMode: (sessionId: string, mode: string) => Promise<void>
      compactSession: (sessionId: string) => Promise<unknown>
      clearSession: (sessionId: string) => Promise<unknown>
      setEffort: (sessionId: string, effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max') => Promise<void>
      agentAbort: (sessionId: string, agentToolUseId: string) => Promise<void>
      agentBackground: (sessionId: string, agentToolUseId: string) => Promise<void>
      planRespond: (id: string, approved: boolean, feedback?: string) => void
      setPlanMode: (sessionId: string, mode: string) => Promise<unknown>
      getPlanMode: (sessionId: string) => Promise<unknown>
      writeClipboard: (text: string) => void
      // Git
      gitBranchList: (cwd: string) => Promise<{ branches: string[]; current: string }>
      gitBranchSwitch: (cwd: string, branch: string) => Promise<{ success: boolean; error?: string }>
      gitBranchCreate: (cwd: string, branch: string, from?: string) => Promise<{ success: boolean; error?: string }>
      gitBranchDelete: (cwd: string, branch: string) => Promise<{ success: boolean; error?: string }>
      gitStatus: (cwd: string) => Promise<{ dirty: boolean; changes: number }>
      gitStash: (cwd: string) => Promise<{ success: boolean; error?: string }>
      gitStashPop: (cwd: string) => Promise<{ success: boolean; error?: string }>
      gitHasStash: (cwd: string) => Promise<boolean>
      gitWatchStart: (cwd: string) => Promise<void>
      gitWatchStop: (cwd: string) => Promise<void>
      onGitBranchChanged: (callback: (payload: { cwd: string; branches: string[]; current: string }) => void) => () => void
      // Apps
      appsDetect: () => Promise<{ apps: { id: string; name: string; shortName: string; available: boolean }[] }>
      appsOpen: (appId: string, cwd: string) => Promise<unknown>
      // IDE Integration
      ideGetState: () => Promise<unknown>
      ideOpenFile: (filePath: string, line?: number, column?: number) => Promise<unknown>
      ideOpenDiff: (params: unknown) => Promise<unknown>
      ideCloseDiffTabs: () => Promise<unknown>
      ideGetDiagnostics: (filePaths: string[]) => Promise<unknown>
      onIdeStateChanged: (callback: (connections: unknown[]) => void) => () => void
      onIdeSelectionChanged: (callback: (data: unknown) => void) => () => void
      onIdeAtMentioned: (callback: (data: unknown) => void) => () => void
      // Terminal
      terminalCreate: (cwd: string) => Promise<{ id: string }>
      terminalWrite: (id: string, data: string) => void
      terminalResize: (id: string, cols: number, rows: number) => void
      terminalDestroy: (id: string) => Promise<{ success: boolean }>
      onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void
      onTerminalExit: (callback: (payload: { id: string; code: number }) => void) => () => void
      // Background Tasks
      backgroundList: (sessionId: string) => Promise<unknown[]>
      backgroundStop: (sessionId: string, taskId: string) => Promise<unknown>
      backgroundOutput: (sessionId: string, taskId: string, tail?: number) => Promise<unknown>
      constraintInspect: (sessionId: string) => Promise<ConstraintObservabilitySnapshot>
      onBackgroundStateChanged: (callback: (data: { sessionId: string }) => void) => () => void
      onBackgroundNotification: (callback: (data: { sessionId: string }) => void) => () => void
      // Team Mode
      teamGetStatus: (sessionId: string, taskId: string) => Promise<unknown>
      teamGetEvents: (sessionId: string, taskId: string, tail?: number) => Promise<unknown>
      teamSend: (sessionId: string, taskId: string, payload: { message: string; target?: string; intent?: string; priority?: string }) => Promise<unknown>
      onTeamStateChanged: (callback: (data: { sessionId: string; taskId: string }) => void) => () => void
      // Updater
      updaterCheck: () => Promise<{ version?: string | null; error?: string }>
      updaterDownload: () => Promise<{ success: boolean; error?: string }>
      updaterInstall: () => Promise<unknown>
      onUpdaterAvailable: (callback: (data: { version: string }) => void) => () => void
      onUpdaterProgress: (callback: (data: { percent: number }) => void) => () => void
      onUpdaterDownloaded: (callback: () => void) => () => void
      onUpdaterNotAvailable: (callback: () => void) => () => void
      onUpdaterError: (callback: (data: { message: string }) => void) => () => void
      getVersion: () => Promise<string>
      // Model
      modelTest: (params: { protocol: string; baseUrl: string; apiKey: string; modelId: string }) => Promise<{ success: boolean; reply?: string; error?: string }>
    }
  }
}

function invoke(channel: string, data?: unknown): Promise<any> {
  if (!window.electronAPI) {
    console.warn('[IPC] electronAPI not available, channel:', channel)
    return Promise.resolve(null)
  }
  return window.electronAPI.invoke(channel, data)
}

function on(channel: string, cb: (event: unknown, ...args: unknown[]) => void): () => void {
  if (!window.electronAPI) return () => {}
  return window.electronAPI.on(channel, cb)
}

function send(channel: string, data: unknown): void {
  if (!window.electronAPI) return
  window.electronAPI.send(channel, data)
}

interface ProjectGroup {
  name: string
  cwd: string
  sessions: { id: string; projectName: string; cwd: string; title?: string | null }[]
}

export const ipc = {
  session: {
    create: (projectName: string, cwd: string) =>
      invoke('session:create', { projectName, cwd }) as Promise<{ sessionId: string }>,
    list: () =>
      invoke('session:list') as Promise<ProjectGroup[]>,
    switch: (sessionId: string) =>
      invoke('session:switch', { sessionId }) as Promise<{ messages: Message[]; usage?: any; modelId?: string }>,
    delete: (sessionId: string) =>
      invoke('session:delete', { sessionId }) as Promise<{ success: boolean }>,
    rename: (sessionId: string, title: string) =>
      invoke('session:rename', { sessionId, title }) as Promise<{ success: boolean }>,
    setModel: (sessionId: string, modelId: string) =>
      invoke('session:set-model', { sessionId, modelId }) as Promise<{ success: boolean }>,
    getModel: (sessionId: string) =>
      invoke('session:get-model', { sessionId }) as Promise<{ modelId: string | null }>,
  },

  query: {
    send: (sessionId: string, text: string, images?: { data: string; mediaType: string }[]) =>
      invoke('query:send', { sessionId, text, images }) as Promise<{ success: boolean }>,
    retry: (sessionId: string) =>
      invoke('query:retry', { sessionId }) as Promise<{ success: boolean }>,
    abort: (sessionId: string) =>
      invoke('query:abort', { sessionId }) as Promise<{ success: boolean }>,
    onStream: (cb: (data: { sessionId: string; chunk: StreamChunk }) => void) =>
      on('query:stream', (_e, data) => cb(data as any)),
    onToolEvent: (cb: (data: { sessionId: string; event: ToolExecutionEvent }) => void) =>
      on('query:tool-event', (_e, data) => cb(data as any)),
    onComplete: (cb: (data: { sessionId: string; message: Message }) => void) =>
      on('query:complete', (_e, data) => cb(data as any)),
    onError: (cb: (data: { sessionId: string; error: string }) => void) =>
      on('query:error', (_e, data) => cb(data as any)),
    onRetrying: (cb: (data: { sessionId: string; attempt: number; maxRetries: number; error: string; delayMs: number; category: string }) => void) =>
      on('query:retrying', (_e, data) => cb(data as any)),
  },

  config: {
    get: () =>
      invoke('config:get') as Promise<AppConfig>,
    set: (config: Partial<AppConfig>) =>
      invoke('config:set', config) as Promise<{ success: boolean }>,
  },

  dialog: {
    openFolder: () =>
      invoke('dialog:open-folder') as Promise<{ path: string | null }>,
  },

  agent: {
    abort: (sessionId: string, agentToolUseId: string) =>
      invoke('agent:abort', { sessionId, agentToolUseId }),
    background: (sessionId: string, agentToolUseId: string) =>
      invoke('agent:background', { sessionId, agentToolUseId }),
    onProgress: (cb: (data: { sessionId: string; agentToolUseId: string; toolName: string; toolStatus: string; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void) =>
      on('agent:progress', (_e, data) => cb(data as any)),
    onText: (cb: (data: { sessionId: string; agentToolUseId: string; text: string }) => void) =>
      on('agent:text', (_e, data) => cb(data as any)),
    onComplete: (cb: (data: { sessionId: string; agentToolUseId: string; content: string; turns: number; toolsUsed: string[] }) => void) =>
      on('agent:complete', (_e, data) => cb(data as any)),
  },

  background: {
    list: (sessionId: string) =>
      invoke('background:list', { sessionId }) as Promise<any[]>,
    stop: (sessionId: string, taskId: string) =>
      invoke('background:stop', { sessionId, taskId }) as Promise<{ success: boolean }>,
    output: (sessionId: string, taskId: string, tail?: number) =>
      invoke('background:output', { sessionId, taskId, tail }) as Promise<string>,
    onStateChanged: (cb: (data: { sessionId: string }) => void) =>
      on('background:state-changed', (_e, data) => cb(data as any)),
    onNotification: (cb: (data: { sessionId: string }) => void) =>
      on('background:notification', (_e, data) => cb(data as any)),
  },

  constraint: {
    inspect: (sessionId: string) =>
      invoke('constraint:inspect', { sessionId }) as Promise<ConstraintObservabilitySnapshot>,
  },
}
