import type { AppConfig, Message, StreamChunk, ToolExecutionEvent } from '@jdcagnet/core'

declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, data?: unknown) => Promise<unknown>
      on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => () => void
      send: (channel: string, data: unknown) => void
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
  sessions: { id: string; projectName: string; cwd: string }[]
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
}
