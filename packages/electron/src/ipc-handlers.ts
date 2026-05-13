import { ipcMain, dialog } from 'electron'
import { IPC_CHANNELS } from './ipc-channels.js'
import type { SessionManager } from './session-manager.js'
import { loadAppConfig, saveAppConfig } from '@jdcagnet/core'

export function registerIpcHandlers(sessionManager: SessionManager): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, { projectName, cwd }) => {
    const sessionId = sessionManager.createSession(projectName, cwd)
    return { sessionId }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
    return sessionManager.listAllProjects()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SWITCH, async (_event, { sessionId }) => {
    await sessionManager.activateSession(sessionId)
    const messages = sessionManager.getMessages(sessionId)
    return { messages }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, { sessionId }) => {
    sessionManager.deleteSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.QUERY_SEND, async (_event, { sessionId, text }) => {
    sessionManager.sendMessage(sessionId, text)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.QUERY_ABORT, async (_event, { sessionId }) => {
    sessionManager.abortSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async () => {
    return loadAppConfig()
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, async (_event, config) => {
    saveAppConfig(config)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FOLDER, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled) return { path: null }
    return { path: result.filePaths[0] }
  })
}
