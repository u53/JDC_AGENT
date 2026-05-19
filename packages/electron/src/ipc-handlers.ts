import { ipcMain, dialog } from 'electron'
import { IPC_CHANNELS } from './ipc-channels.js'
import type { SessionManager } from './session-manager.js'
import { loadAppConfig, saveAppConfig, AnthropicProvider, OpenAIChatProvider, OpenAIResponsesProvider } from '@jdcagnet/core'
import { GitService } from './git-service.js'
import { AppLauncher } from './app-launcher.js'
import { TerminalService } from './terminal-service.js'

interface DevToolServices {
  gitService: GitService
  appLauncher: AppLauncher
  terminalService: TerminalService
}

export function registerIpcHandlers(sessionManager: SessionManager, services: DevToolServices): void {
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

  ipcMain.handle(IPC_CHANNELS.SESSION_RENAME, async (_event, { sessionId, title }) => {
    sessionManager.renameSession(sessionId, title)
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

  ipcMain.handle(IPC_CHANNELS.AGENT_BACKGROUND, async (_event, { sessionId, agentToolUseId }) => {
    sessionManager.backgroundAgent(sessionId, agentToolUseId)
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

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_PLAN_MODE, async (_event, { sessionId, mode }) => {
    console.log('[IPC] session:set-plan-mode called', sessionId, mode)
    sessionManager.setPlanMode(sessionId, mode)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_PLAN_MODE, async (_event, { sessionId }) => {
    return { mode: sessionManager.getPlanMode(sessionId) }
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

  ipcMain.handle(IPC_CHANNELS.FILE_ACCEPT, async (_event, { sessionId, filePath }) => {
    sessionManager.acceptFile(sessionId, filePath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_ACCEPT_ALL, async (_event, { sessionId }) => {
    sessionManager.acceptAllFiles(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_TASKS, async (_event, { sessionId }) => {
    return sessionManager.getTasks(sessionId)
  })

  const { gitService, appLauncher, terminalService } = services

  // Git
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_LIST, async (_event, { cwd }) => {
    return gitService.listBranches(cwd)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_SWITCH, async (_event, { cwd, branch }) => {
    return gitService.switchBranch(cwd, branch)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_CREATE, async (_event, { cwd, branch, from }) => {
    return gitService.createBranch(cwd, branch, from)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_DELETE, async (_event, { cwd, branch }) => {
    return gitService.deleteBranch(cwd, branch)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_event, { cwd }) => {
    return gitService.getStatus(cwd)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_STASH, async (_event, { cwd }) => {
    return gitService.stash(cwd)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_STASH_POP, async (_event, { cwd }) => {
    return gitService.stashPop(cwd)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_HAS_STASH, async (_event, { cwd }) => {
    return gitService.hasStash(cwd)
  })

  // Apps
  ipcMain.handle(IPC_CHANNELS.APPS_DETECT, async () => {
    return { apps: appLauncher.detect() }
  })
  ipcMain.handle(IPC_CHANNELS.APPS_OPEN, async (_event, { appId, cwd }) => {
    return appLauncher.open(appId, cwd)
  })

  // Terminal
  ipcMain.handle(IPC_CHANNELS.TERMINAL_CREATE, async (_event, { cwd }) => {
    return terminalService.create(cwd)
  })
  ipcMain.on(IPC_CHANNELS.TERMINAL_WRITE, (_event, { id, data }) => {
    terminalService.write(id, data)
  })
  ipcMain.on(IPC_CHANNELS.TERMINAL_RESIZE, (_event, { id, cols, rows }) => {
    terminalService.resize(id, cols, rows)
  })
  ipcMain.handle(IPC_CHANNELS.TERMINAL_DESTROY, async (_event, { id }) => {
    return terminalService.destroy(id)
  })

  // IDE Integration
  ipcMain.handle(IPC_CHANNELS.IDE_GET_STATE, async () => {
    return sessionManager.getIdeConnections()
  })

  ipcMain.handle(IPC_CHANNELS.IDE_OPEN_FILE, async (_event, { filePath, line, column }) => {
    try {
      await sessionManager.ideOpenFile(filePath, line, column)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.IDE_OPEN_DIFF, async (_event, params) => {
    try {
      return await sessionManager.ideOpenDiff(params)
    } catch (err: any) {
      return { action: 'rejected', error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.IDE_CLOSE_DIFF_TABS, async () => {
    try {
      await sessionManager.ideCloseAllDiffTabs()
      return { success: true }
    } catch {
      return { success: true }
    }
  })

  ipcMain.handle(IPC_CHANNELS.IDE_GET_DIAGNOSTICS, async (_event, { filePaths }) => {
    try {
      return await sessionManager.ideGetDiagnostics(filePaths)
    } catch (err: any) {
      return { files: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_TEST, async (_event, { protocol, baseUrl, apiKey, modelId }) => {
    try {
      const provider = (() => {
        switch (protocol) {
          case 'openai':
            return new OpenAIChatProvider(apiKey, baseUrl)
          case 'openai-responses':
            return new OpenAIResponsesProvider(apiKey, baseUrl)
          case 'anthropic':
          default:
            return new AnthropicProvider(apiKey, baseUrl || undefined)
        }
      })()
      const messages = [{ id: '1', role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }], timestamp: Date.now() }]
      const config = { model: modelId, maxTokens: 100 }
      let reply = ''
      for await (const chunk of provider.stream(messages, [], config)) {
        if (chunk.type === 'text_delta' && chunk.text) reply += chunk.text
      }
      return { success: true, reply: reply.slice(0, 100) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Background Tasks
  ipcMain.handle(IPC_CHANNELS.BACKGROUND_LIST, async (_event, { sessionId }) => {
    return sessionManager.getBackgroundTasks(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.BACKGROUND_STOP, async (_event, { sessionId, taskId }) => {
    sessionManager.stopBackgroundTask(sessionId, taskId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BACKGROUND_OUTPUT, async (_event, { sessionId, taskId, tail }) => {
    return sessionManager.getBackgroundTaskOutput(sessionId, taskId, tail)
  })
}
