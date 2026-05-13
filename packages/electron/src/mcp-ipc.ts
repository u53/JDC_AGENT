import { ipcMain } from 'electron'
import { IPC_CHANNELS } from './ipc-channels.js'
import type { SessionManager } from './session-manager.js'

export function registerMcpIpcHandlers(sessionManager: SessionManager): void {
  ipcMain.handle(IPC_CHANNELS.MCP_LIST_SERVERS, async () => {
    return sessionManager.getMcpServerStates()
  })

  ipcMain.handle(IPC_CHANNELS.MCP_RECONNECT, async (_event, { serverName }) => {
    await sessionManager.reconnectMcpServer(serverName)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_TOGGLE, async (_event, { serverName, enabled }) => {
    await sessionManager.toggleMcpServer(serverName, enabled)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_SAVE_CONFIG, async (_event, { servers, scope, cwd }) => {
    sessionManager.saveMcpServers(servers, scope, cwd)
    return { success: true }
  })
}
