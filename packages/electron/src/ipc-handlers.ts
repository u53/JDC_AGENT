import { ipcMain, dialog, nativeImage, shell, clipboard } from 'electron'
import { readFileSync } from 'node:fs'
import { IPC_CHANNELS } from './ipc-channels.js'
import type { SessionManager } from './session-manager.js'
import { loadAppConfig, saveAppConfig, AnthropicProvider, OpenAIChatProvider, OpenAIResponsesProvider, inspectContext, refreshContextProviders, getContextProviderHealth, createDefaultRefreshProviders, searchMemoryRecords, writeMemoryRecord, ContextInspectPayloadSchema, ContextRefreshPayloadSchema, MemorySearchPayloadSchema, MemoryWritePayloadSchema, openContextStore } from '@jdcagnet/core'
import { GitService } from './git-service.js'
import { AppLauncher } from './app-launcher.js'
import { TerminalService } from './terminal-service.js'
import { FeishuBindingStore } from './feishu/binding-store.js'
import type { FeishuBindingInput } from './feishu/types.js'

interface FeishuBridgeService {
  getStatus?: () => unknown | Promise<unknown>
  restart?: () => unknown | Promise<unknown>
}

interface DevToolServices {
  gitService: GitService
  appLauncher: AppLauncher
  terminalService: TerminalService
  feishuBindingStore?: FeishuBindingStore
  feishuBridge?: FeishuBridgeService
}

function contextPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function resolveContextIpcCwd(sessionManager: SessionManager, payload: unknown): string {
  const input = contextPayload(payload)
  const sessionId = nonEmptyString(input.sessionId)
  if (sessionId) {
    const cwd = sessionManager.getSessionCwd(sessionId)
    if (!cwd) throw new Error(`Unable to resolve project cwd for session ${sessionId}`)
    return cwd
  }

  const cwd = nonEmptyString(input.cwd)
  if (!cwd) throw new Error('A sessionId or cwd is required for JDC Context Engine IPC')
  return cwd
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
    const modelId = sessionManager.getSessionModel(sessionId)
    return { messages, usage, modelId }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, { sessionId }) => {
    sessionManager.deleteSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_RENAME, async (_event, { sessionId, title }) => {
    sessionManager.renameSession(sessionId, title)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_MODEL, async (_event, { sessionId, modelId }) => {
    sessionManager.setSessionModel(sessionId, modelId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_MODEL, async (_event, { sessionId }) => {
    return { modelId: sessionManager.getSessionModel(sessionId) }
  })

  ipcMain.handle(IPC_CHANNELS.QUERY_SEND, async (_event, { sessionId, text, images }) => {
    sessionManager.sendMessage(sessionId, text, images)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.QUERY_RETRY, async (_event, { sessionId }) => {
    sessionManager.retrySession(sessionId)
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
    await sessionManager.compactSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_CLEAR, async (_event, { sessionId }) => {
    sessionManager.clearSession(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_EFFORT, async (_event, { sessionId, effort }) => {
    sessionManager.setEffort(sessionId, effort)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_PLAN_MODE, async (_event, { sessionId, mode }) => {
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
    return sessionManager.rewindFile(sessionId, snapshotId)
  })

  ipcMain.handle(IPC_CHANNELS.FILE_REWIND_TURN, async (_event, { sessionId, turnIndex }) => {
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
  const feishuBindingStore = services.feishuBindingStore ?? new FeishuBindingStore()

  // Feishu
  ipcMain.handle(IPC_CHANNELS.FEISHU_BINDINGS_LIST, async () => {
    return { bindings: feishuBindingStore.listBindings() }
  })

  ipcMain.handle(IPC_CHANNELS.FEISHU_BINDINGS_ADD, async (_event, binding: FeishuBindingInput) => {
    return { success: true, binding: feishuBindingStore.addBinding(binding) }
  })

  ipcMain.handle(IPC_CHANNELS.FEISHU_BINDINGS_UPDATE, async (_event, { id, patch }: { id: string; patch: Partial<FeishuBindingInput> }) => {
    return { success: true, binding: feishuBindingStore.updateBinding(id, patch) }
  })

  ipcMain.handle(IPC_CHANNELS.FEISHU_BINDINGS_DELETE, async (_event, { id }: { id: string }) => {
    feishuBindingStore.deleteBinding(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FEISHU_STATUS, async () => {
    if (services.feishuBridge?.getStatus) {
      return services.feishuBridge.getStatus()
    }
    return {
      running: false,
      bindings: feishuBindingStore.listBindings().map(({ id, enabled }) => ({ id, enabled, connected: false })),
    }
  })

  ipcMain.handle(IPC_CHANNELS.FEISHU_RESTART, async () => {
    if (services.feishuBridge?.restart) {
      return services.feishuBridge.restart()
    }
    return { success: true }
  })

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

  // Per-sender branch watch subscriptions: senderId -> cwd -> dispose fn
  const branchWatches = new Map<number, Map<string, () => void>>()

  const stopWatchesForSender = (senderId: number) => {
    const map = branchWatches.get(senderId)
    if (!map) return
    for (const dispose of map.values()) dispose()
    branchWatches.delete(senderId)
  }

  ipcMain.handle(IPC_CHANNELS.GIT_WATCH_START, async (event, { cwd }: { cwd: string }) => {
    const sender = event.sender
    const senderId = sender.id
    let map = branchWatches.get(senderId)
    if (!map) {
      map = new Map()
      branchWatches.set(senderId, map)
      sender.once('destroyed', () => stopWatchesForSender(senderId))
    }
    if (map.has(cwd)) return { success: true }
    const dispose = gitService.watchBranches(cwd, (state) => {
      if (sender.isDestroyed()) return
      sender.send(IPC_CHANNELS.GIT_BRANCH_CHANGED, { cwd, ...state })
    })
    map.set(cwd, dispose)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_WATCH_STOP, async (event, { cwd }: { cwd: string }) => {
    const map = branchWatches.get(event.sender.id)
    const dispose = map?.get(cwd)
    if (dispose) {
      dispose()
      map!.delete(cwd)
    }
    return { success: true }
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

  ipcMain.handle(IPC_CHANNELS.CONTEXT_INSPECT, async (_event, payload = {}) => {
    const input = contextPayload(payload)
    const cwd = resolveContextIpcCwd(sessionManager, input)
    const store = await openContextStore({ cwd })
    const result = await inspectContext(input, { store, cwd })
    return ContextInspectPayloadSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_REFRESH, async (_event, payload: any = {}) => {
    const config = loadAppConfig().contextEngine
    const input = contextPayload(payload)
    const cwd = resolveContextIpcCwd(sessionManager, input)
    const store = await openContextStore({ cwd })
    const result = await refreshContextProviders({ ...input, cwd }, {
      store,
      providers: createDefaultRefreshProviders(config),
      config,
      cwd,
    })
    return ContextRefreshPayloadSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.CONSTRAINT_INSPECT, async (_event, payload = {}) => {
    const input = contextPayload(payload)
    if (!input.sessionId) throw new Error('sessionId is required for constraint inspect')
    return sessionManager.inspectConstraints(String(input.sessionId))
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_HARVEST_LIST, async (_event, payload = {}) => {
    const input = contextPayload(payload)
    const cwd = resolveContextIpcCwd(sessionManager, input)
    const store = await openContextStore({ cwd })
    const result = await inspectContext(input, { store, cwd })
    return ContextInspectPayloadSchema.parse(result).harvestQueue
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_MEMORY_LIST, async (_event, payload = {}) => {
    const input = contextPayload(payload)
    const cwd = resolveContextIpcCwd(sessionManager, input)
    const store = await openContextStore({ cwd })
    const result = await searchMemoryRecords(input, { store, cwd })
    return MemorySearchPayloadSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_MEMORY_ACCEPT, async (_event, payload = {}) => {
    const input = contextPayload(payload)
    const cwd = resolveContextIpcCwd(sessionManager, input)
    const candidateId = input.candidateId
    if (!candidateId) {
      throw new Error('candidateId is required for memory accept')
    }
    const store = await openContextStore({ cwd })
    const result = await store.approvePendingCandidate(String(candidateId))
    if (!result.ok) {
      throw new Error(result.diagnostics[0]?.message || 'Failed to approve pending candidate')
    }
    const inspectResult = await inspectContext(input, { store, cwd })
    return ContextInspectPayloadSchema.parse(inspectResult).memoryReview
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_MEMORY_REJECT, async (_event, payload = {}) => {
    const input = contextPayload(payload)
    const cwd = resolveContextIpcCwd(sessionManager, input)
    const candidateId = input.candidateId
    if (!candidateId) {
      throw new Error('candidateId is required for memory reject')
    }
    const store = await openContextStore({ cwd })
    await store.rejectPendingCandidate(String(candidateId))
    const result = await inspectContext(input, { store, cwd })
    return ContextInspectPayloadSchema.parse(result).memoryReview
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_PROVIDERS_HEALTH, async (_event, payload = {}) => {
    const config = loadAppConfig().contextEngine
    const input = contextPayload(payload)
    const cwd = resolveContextIpcCwd(sessionManager, input)
    return getContextProviderHealth({ ...input, cwd }, {
      providers: createDefaultRefreshProviders(config),
      config,
      cwd,
    })
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_CONFIG_GET, async () => {
    return loadAppConfig().contextEngine ?? null
  })

  ipcMain.handle(IPC_CHANNELS.CONTEXT_CONFIG_UPDATE, async (_event, payload = {}) => {
    const existing = loadAppConfig()
    saveAppConfig({ contextEngine: { ...(existing.contextEngine ?? {}), ...(payload as Record<string, unknown>) } })
    return { success: true }
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

  ipcMain.handle(IPC_CHANNELS.TEAM_GET_STATUS, async (_event, { sessionId, taskId }) => {
    return sessionManager.getTeamStatus(sessionId, taskId)
  })

  ipcMain.handle(IPC_CHANNELS.TEAM_GET_EVENTS, async (_event, { sessionId, taskId, tail }) => {
    return sessionManager.getTeamEvents(sessionId, taskId, tail)
  })

  ipcMain.handle(IPC_CHANNELS.TEAM_SEND, async (_event, { sessionId, taskId, payload }) => {
    sessionManager.sendTeamMessage(sessionId, taskId, payload)
    return { success: true }
  })

  // Images
  ipcMain.handle('images:copy-to-clipboard', (_e, { filePath }: { filePath: string }) => {
    try {
      const img = nativeImage.createFromPath(filePath)
      if (img.isEmpty()) return { success: false, error: '图片为空或无法读取' }
      clipboard.writeImage(img)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('images:show-in-folder', (_e, { filePath }: { filePath: string }) => {
    shell.showItemInFolder(filePath)
    return { success: true }
  })
  ipcMain.handle('images:read-image', (_e, { filePath }: { filePath: string }) => {
    try {
      const buf = readFileSync(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png'
      return { success: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
