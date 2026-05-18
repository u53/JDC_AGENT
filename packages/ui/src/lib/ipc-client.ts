import type { AppConfig, Message, StreamChunk, ToolExecutionEvent } from '@jdcagnet/core'

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
      agentAbort?: (sessionId: string, agentToolUseId: string) => Promise<void>
      // Git
      gitBranchList: (cwd: string) => Promise<{ branches: string[]; current: string }>
      gitBranchSwitch: (cwd: string, branch: string) => Promise<{ success: boolean; error?: string }>
      gitBranchCreate: (cwd: string, branch: string, from?: string) => Promise<{ success: boolean; error?: string }>
      gitBranchDelete: (cwd: string, branch: string) => Promise<{ success: boolean; error?: string }>
      gitStatus: (cwd: string) => Promise<{ dirty: boolean; changes: number }>
      // Terminal
      terminalCreate: (cwd: string) => Promise<{ id: string }>
      terminalWrite: (id: string, data: string) => void
      terminalResize: (id: string, cols: number, rows: number) => void
      terminalDestroy: (id: string) => Promise<{ success: boolean }>
      onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void
      onTerminalExit: (callback: (payload: { id: string; code: number }) => void) => () => void
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
      invoke('session:switch', { sessionId }) as Promise<{ messages: Message[] }>,
    delete: (sessionId: string) =>
      invoke('session:delete', { sessionId }) as Promise<{ success: boolean }>,
    rename: (sessionId: string, title: string) =>
      invoke('session:rename', { sessionId, title }) as Promise<{ success: boolean }>,
  },

  query: {
    send: (sessionId: string, text: string, images?: { data: string; mediaType: string }[]) =>
      invoke('query:send', { sessionId, text, images }) as Promise<{ success: boolean }>,
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
    onRetrying: (cb: (data: { sessionId: string; attempt: number; error: string; delayMs: number; category: string }) => void) =>
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
    onProgress: (cb: (data: { sessionId: string; agentToolUseId: string; toolName: string; toolStatus: string; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void) =>
      on('agent:progress', (_e, data) => cb(data as any)),
    onText: (cb: (data: { sessionId: string; agentToolUseId: string; text: string }) => void) =>
      on('agent:text', (_e, data) => cb(data as any)),
    onComplete: (cb: (data: { sessionId: string; agentToolUseId: string; content: string; turns: number; toolsUsed: string[] }) => void) =>
      on('agent:complete', (_e, data) => cb(data as any)),
  },
}
