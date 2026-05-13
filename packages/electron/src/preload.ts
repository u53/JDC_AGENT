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
}

contextBridge.exposeInMainWorld('electronAPI', api)
console.log('[PRELOAD] electronAPI exposed successfully')
