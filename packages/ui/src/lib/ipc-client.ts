import type { AppConfig, Message, StreamChunk, ToolExecutionEvent } from '@jdcagnet/core'

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, data?: unknown) => Promise<unknown>
      on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => () => void
      send: (channel: string, data: unknown) => void
    }
  }
}

interface ProjectGroup {
  name: string
  cwd: string
  sessions: { id: string; projectName: string; cwd: string }[]
}

export const ipc = {
  session: {
    create: (projectName: string, cwd: string) =>
      window.electronAPI.invoke('session:create', { projectName, cwd }) as Promise<{ sessionId: string }>,
    list: () =>
      window.electronAPI.invoke('session:list') as Promise<ProjectGroup[]>,
    switch: (sessionId: string) =>
      window.electronAPI.invoke('session:switch', { sessionId }) as Promise<{ messages: Message[] }>,
    delete: (sessionId: string) =>
      window.electronAPI.invoke('session:delete', { sessionId }) as Promise<{ success: boolean }>,
  },

  query: {
    send: (sessionId: string, text: string) =>
      window.electronAPI.invoke('query:send', { sessionId, text }) as Promise<{ success: boolean }>,
    abort: (sessionId: string) =>
      window.electronAPI.invoke('query:abort', { sessionId }) as Promise<{ success: boolean }>,
    onStream: (cb: (data: { sessionId: string; chunk: StreamChunk }) => void) =>
      window.electronAPI.on('query:stream', (_e, data) => cb(data as any)),
    onToolEvent: (cb: (data: { sessionId: string; event: ToolExecutionEvent }) => void) =>
      window.electronAPI.on('query:tool-event', (_e, data) => cb(data as any)),
    onComplete: (cb: (data: { sessionId: string; message: Message }) => void) =>
      window.electronAPI.on('query:complete', (_e, data) => cb(data as any)),
    onError: (cb: (data: { sessionId: string; error: string }) => void) =>
      window.electronAPI.on('query:error', (_e, data) => cb(data as any)),
  },

  config: {
    get: () =>
      window.electronAPI.invoke('config:get') as Promise<AppConfig>,
    set: (config: Partial<AppConfig>) =>
      window.electronAPI.invoke('config:set', config) as Promise<{ success: boolean }>,
  },

  dialog: {
    openFolder: () =>
      window.electronAPI.invoke('dialog:open-folder') as Promise<{ path: string | null }>,
  },
}
