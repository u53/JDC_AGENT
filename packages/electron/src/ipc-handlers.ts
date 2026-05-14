import { ipcMain, dialog } from 'electron'
import { IPC_CHANNELS } from './ipc-channels.js'
import type { SessionManager } from './session-manager.js'
import { loadAppConfig, saveAppConfig } from '@jdcagnet/core'

export function registerIpcHandlers(sessionManager: SessionManager): void {
  ipcMain.on('permission:response', (_event, { id, allowed }) => {
    sessionManager.respondToPermission(id, allowed)
  })

  ipcMain.on('ask_user:response', (_event, { id, answer }) => {
    sessionManager.respondToAskUser(id, answer)
  })

  ipcMain.on('plan:respond', (_event, { id, approved, feedback }) => {
    sessionManager.respondToPlanReview(id, approved, feedback)
  })

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
    const usage = sessionManager.getUsage(sessionId)
    return { messages, usage }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, { sessionId }) => {
    sessionManager.deleteSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.QUERY_SEND, async (_event, { sessionId, text, images }) => {
    sessionManager.sendMessage(sessionId, text, images)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.QUERY_ABORT, async (_event, { sessionId }) => {
    sessionManager.abortSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_ABORT, async (_event, { sessionId, agentToolUseId }) => {
    sessionManager.abortAgent(sessionId, agentToolUseId)
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

  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, async (_event, { sessionId }) => {
    return sessionManager.getSkills(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_PERMISSION, async (_event, { sessionId, mode }) => {
    sessionManager.setPermissionMode(sessionId, mode)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_COMPACT, async (_event, { sessionId }) => {
    console.log('[IPC] session:compact called for', sessionId)
    await sessionManager.compactSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_CLEAR, async (_event, { sessionId }) => {
    console.log('[IPC] session:clear called for', sessionId)
    sessionManager.clearSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_THINKING, async (_event, { sessionId, enabled, budget }) => {
    console.log('[IPC] session:set-thinking called', sessionId, enabled)
    sessionManager.setThinking(sessionId, enabled, budget)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_GET_CHANGES, async (_event, { sessionId }) => {
    return sessionManager.getFileChanges(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.FILE_GET_HISTORY, async (_event, { sessionId, filePath }) => {
    return sessionManager.getFileHistory(sessionId, filePath)
  })

  ipcMain.handle(IPC_CHANNELS.FILE_REWIND, async (_event, { sessionId, snapshotId }) => {
    console.log('[IPC] file:rewind called', sessionId, snapshotId)
    return sessionManager.rewindFile(sessionId, snapshotId)
  })

  ipcMain.handle(IPC_CHANNELS.FILE_REWIND_TURN, async (_event, { sessionId, turnIndex }) => {
    console.log('[IPC] file:rewind-turn called', sessionId, turnIndex)
    return sessionManager.rewindToTurn(sessionId, turnIndex)
  })
}
