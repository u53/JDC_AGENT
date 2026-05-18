import { v4 as uuid } from 'uuid'
import path from 'node:path'
import {
  Session, type SessionEvents, AnthropicProvider, OpenAIChatProvider, OpenAIResponsesProvider,
  ConversationHistory, loadAppConfig, getConfigDir, type ModelConfig, type SessionConfig, type StreamChunk,
  type PermissionCallback, createAskUserTool, type AskUserCallback, createNotifyTool, type NotifyCallback,
  McpManager, loadMcpConfig, saveMcpConfig, type McpServerConfig, type McpServerState,
} from '@jdcagnet/core'
import type { ToolExecutionEvent } from '@jdcagnet/core'
import { Notification, type BrowserWindow } from 'electron'

function getActiveModelConfig() {
  const config = loadAppConfig()
  const data = config.modelGroups
  if (!data?.activeModelId || !data?.groups) return null
  for (const group of data.groups) {
    const model = group.models?.find((m: any) => m.id === data.activeModelId)
    if (model) return { model, group }
  }
  return null
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  private history: ConversationHistory
  private mcpManager: McpManager
  private window: BrowserWindow | null = null
  private readyPromise: Promise<void>
  private pendingPermissions = new Map<string, { resolve: (allowed: boolean) => void }>()
  private pendingAskUser = new Map<string, { resolve: (answer: string) => void }>()
  private pendingPlanReviews = new Map<string, { resolve: (result: { approved: boolean; feedback?: string }) => void }>()
  private permissionModes = new Map<string, string>()
  constructor() {
    const dbPath = path.join(getConfigDir(), 'history.db')
    this.history = new ConversationHistory(dbPath)
    this.readyPromise = this.history.ensureReady()
    this.mcpManager = new McpManager(() => {
      this.window?.webContents.send('mcp:state-changed', this.mcpManager.getServerStates())
    })
  }

  async ensureReady(): Promise<void> {
    await this.readyPromise
  }

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  createSession(projectName: string, cwd: string): string {
    const sessionId = uuid()
    this.history.createSession(sessionId, projectName, cwd)
    return sessionId
  }

  listAllProjects() {
    const sessions = this.history.listSessions()
    const projects = new Map<string, { name: string; cwd: string; sessions: typeof sessions }>()
    for (const s of sessions) {
      if (!projects.has(s.cwd)) {
        projects.set(s.cwd, { name: s.projectName, cwd: s.cwd, sessions: [] })
      }
      projects.get(s.cwd)!.sessions.push(s)
    }
    return Array.from(projects.values())
  }

  private createProvider(group: { protocol?: string; apiKey: string; baseUrl?: string }) {
    switch (group.protocol) {
      case 'openai':
        return new OpenAIChatProvider(group.apiKey, group.baseUrl)
      case 'openai-responses':
        return new OpenAIResponsesProvider(group.apiKey, group.baseUrl)
      case 'anthropic':
      default:
        return new AnthropicProvider(group.apiKey, group.baseUrl || undefined)
    }
  }

  async activateSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) return
    const meta = this.history.listSessions().find(s => s.id === sessionId)
    if (!meta) throw new Error(`Session ${sessionId} not found`)

    const active = getActiveModelConfig()
    if (!active) throw new Error('No active model selected. Please configure a model in settings.')

    const modelConfig: ModelConfig = {
      model: active.model.modelId,
      maxTokens: active.model.maxTokens || 32000,
      contextWindow: active.model.contextWindow || 200000,
      compressAt: active.model.compressAt || 0.9,
    }
    const sessionConfig: SessionConfig = {
      id: sessionId, projectName: meta.projectName, cwd: meta.cwd, modelConfig,
    }
    const provider = this.createProvider(active.group)
    const permissionCallback: PermissionCallback = (request) => {
      return new Promise<boolean>((resolve) => {
        const id = uuid()
        this.pendingPermissions.set(id, { resolve })
        this.window?.webContents.send('permission:request', { id, sessionId, toolName: request.toolName, input: request.input })
      })
    }
    const onPlanReview = async (planFile: string, content: string) => {
      return new Promise<{ approved: boolean; feedback?: string }>((resolve) => {
        const id = uuid()
        this.pendingPlanReviews.set(id, { resolve })
        this.window?.webContents.send('plan:review', { id, sessionId, planFile, content })
      })
    }
    const session = new Session(sessionConfig, provider, this.history, permissionCallback, this.mcpManager, onPlanReview)
    session.resolveModel = (modelId: string) => {
      const config = loadAppConfig()
      const data = config.modelGroups
      if (!data?.groups) return null
      for (const group of data.groups) {
        const model = group.models?.find((m: any) => m.id === modelId || m.modelId === modelId)
        if (model) {
          const resolvedProvider = this.createProvider(group)
          const resolvedConfig = {
            model: model.modelId,
            maxTokens: model.maxTokens || 32000,
            contextWindow: model.contextWindow || 200000,
            compressAt: model.compressAt || 0.9,
          }
          return { provider: resolvedProvider, modelConfig: resolvedConfig }
        }
      }
      return null
    }
    const onAskUser: AskUserCallback = async (question, options, multiSelect) => {
      return new Promise<string>((resolve) => {
        const id = uuid()
        this.pendingAskUser.set(id, { resolve })
        this.window?.webContents.send('ask_user:request', { id, sessionId, question, options, multiSelect })
      })
    }
    session.registerTool(createAskUserTool(onAskUser))
    const onNotify: NotifyCallback = (message: string) => {
      const notification = new Notification({ title: 'JDC Code', body: message })
      notification.on('click', () => { this.window?.focus() })
      notification.show()
    }
    session.registerTool(createNotifyTool(onNotify))
    session.loadHistory()
    ;(session as any)._protocol = active.group.protocol
    this.sessions.set(sessionId, session)
  }

  async sendMessage(sessionId: string, text: string, images?: { data: string; mediaType: string }[]): Promise<void> {
    // Ensure session is activated with latest model config
    if (!this.sessions.has(sessionId)) {
      await this.activateSession(sessionId)
    }
    const session = this.sessions.get(sessionId)!

    // Apply stored permission mode (in case it was set before session was activated)
    const storedMode = this.permissionModes.get(sessionId)
    if (storedMode) {
      session.setPermissionMode(storedMode as any)
    }

    // Dynamic model switching: check if active model changed since session was created
    const currentActive = getActiveModelConfig()
    console.log('[MODEL CHECK] session model:', session.config.modelConfig.model, '| config active:', currentActive?.model.modelId)
    if (currentActive && (session.config.modelConfig.model !== currentActive.model.modelId || (session as any)._protocol !== currentActive.group.protocol)) {
      console.log('[MODEL SWITCH] Switching to:', currentActive.model.modelId, 'protocol:', currentActive.group.protocol)
      const provider = this.createProvider(currentActive.group)
      session.updateProvider(provider, {
        model: currentActive.model.modelId,
        maxTokens: currentActive.model.maxTokens || 32000,
        contextWindow: currentActive.model.contextWindow || 200000,
        compressAt: currentActive.model.compressAt || 0.9,
      })
      ;(session as any)._protocol = currentActive.group.protocol
    }

    const events: SessionEvents = {
      onStreamChunk: (chunk: StreamChunk) => {
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      },
      onToolEvent: (event: ToolExecutionEvent) => {
        this.window?.webContents.send('query:tool-event', { sessionId, event })
      },
      onMessageComplete: (message) => {
        this.window?.webContents.send('query:complete', { sessionId, message })
      },
      onError: (error) => {
        this.window?.webContents.send('query:error', { sessionId, error: error.message })
      },
      onRetrying: (attempt: number, error: Error, delayMs: number, category: string) => {
        this.window?.webContents.send('query:retrying', {
          sessionId,
          attempt,
          error: error.message || String(error),
          delayMs,
          category,
        })
      },
      onAgentProgress: (agentToolUseId: string, event: any) => {
        this.window?.webContents.send('agent:progress', { sessionId, agentToolUseId, ...event })
      },
      onAgentText: (agentToolUseId: string, text: string) => {
        this.window?.webContents.send('agent:text', { sessionId, agentToolUseId, text })
      },
      onAgentComplete: (agentToolUseId: string, result: any) => {
        this.window?.webContents.send('agent:complete', { sessionId, agentToolUseId, ...result })
      },
      onUsage: (usage) => {
        this.window?.webContents.send('query:usage', { sessionId, usage })
      },
    }

    // Convert images to ImageContent blocks
    const extraContent = images?.map(img => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: img.data,
      },
    }))

    try {
      console.log('[SEND] Calling session.sendMessage, text:', text.slice(0, 50))
      await session.sendMessage(text, events, extraContent)
      console.log('[SEND] session.sendMessage completed')
      this.window?.webContents.send('query:finished', { sessionId })
    } catch (err: any) {
      console.error('[SEND] Error:', err.message, err.stack)
      this.window?.webContents.send('query:error', { sessionId, error: err.message })
    }
  }

  abortSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort()
  }

  abortAgent(sessionId: string, agentToolUseId: string): void {
    this.sessions.get(sessionId)?.abortAgent(agentToolUseId)
  }

  respondToPermission(id: string, allowed: boolean): void {
    const pending = this.pendingPermissions.get(id)
    if (pending) {
      pending.resolve(allowed)
      this.pendingPermissions.delete(id)
    }
  }

  respondToAskUser(id: string, answer: string): void {
    const pending = this.pendingAskUser.get(id)
    if (pending) {
      pending.resolve(answer)
      this.pendingAskUser.delete(id)
    }
  }

  respondToPlanReview(id: string, approved: boolean, feedback?: string): void {
    const pending = this.pendingPlanReviews.get(id)
    if (pending) {
      pending.resolve({ approved, feedback })
      this.pendingPlanReviews.delete(id)
    }
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.history.deleteSession(sessionId)
  }

  renameSession(sessionId: string, title: string): void {
    this.history.updateSessionTitle(sessionId, title)
  }

  getMessages(sessionId: string) {
    return this.history.getMessages(sessionId)
  }

  getUsage(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    return session.getUsageSnapshot()
  }

  getFileChanges(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return session.getFileTracker().getChangedFiles()
  }

  getFileHistory(sessionId: string, filePath: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return session.getFileTracker().getFileHistory(filePath)
  }

  async rewindFile(sessionId: string, snapshotId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    return session.getFileTracker().rewindFile(snapshotId)
  }

  async rewindToTurn(sessionId: string, turnIndex: number) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    return session.getFileTracker().rewindToTurn(turnIndex)
  }

  acceptFile(sessionId: string, filePath: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.getFileTracker().acceptFile(filePath)
  }

  acceptAllFiles(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.getFileTracker().acceptAllFiles()
  }

  close(): void {
    this.mcpManager.close()
    this.history.close()
  }

  async initMcp(cwd: string): Promise<void> {
    const configs = loadMcpConfig(cwd)
    await this.mcpManager.loadConfig(configs)
  }

  getMcpServerStates(): McpServerState[] {
    return this.mcpManager.getServerStates()
  }

  async reconnectMcpServer(name: string): Promise<void> {
    await this.mcpManager.reconnectServer(name)
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.mcpManager.reconnectServer(name)
    } else {
      await this.mcpManager.disconnectServer(name)
    }
  }

  getSkills(sessionId: string): { name: string; description: string; argumentHint?: string }[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    const loader = session.getSkillLoader()
    if (!loader) return []
    return loader.getInvocable().map(s => ({
      name: s.name,
      description: s.description,
      argumentHint: s.argumentHint,
    }))
  }

  setPermissionMode(sessionId: string, mode: string): void {
    this.permissionModes.set(sessionId, mode)
    const session = this.sessions.get(sessionId)
    if (session) {
      session.setPermissionMode(mode as any)
    }
  }

  async compactSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const events: SessionEvents = {
      onStreamChunk: (chunk: StreamChunk) => {
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      },
      onToolEvent: () => {},
      onMessageComplete: () => {},
      onError: (error) => {
        this.window?.webContents.send('query:error', { sessionId, error: error.message })
      },
    }
    try {
      await session.compactNow(events)
      const messages = session.getMessages()
      this.window?.webContents.send('session:messages-updated', { sessionId, messages })
    } catch (err: any) {
      this.window?.webContents.send('query:error', { sessionId, error: err.message })
    }
    this.window?.webContents.send('query:finished', { sessionId })
  }

  clearSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.clearMessages()
      this.window?.webContents.send('session:messages-updated', { sessionId, messages: [] })
    }
  }

  setThinking(sessionId: string, enabled: boolean, budget?: number): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.setThinking(enabled, budget)
    }
  }

  setPlanMode(sessionId: string, mode: 'normal' | 'planning'): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.setPlanMode(mode)
    }
  }

  getPlanMode(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    return session?.getPlanMode() || 'normal'
  }

  getTasks(sessionId: string) {
    return this.history.getTasks(sessionId)
  }

  saveMcpServers(servers: Record<string, McpServerConfig>, scope: 'global' | 'project', cwd?: string): void {
    saveMcpConfig(servers, scope, cwd)
  }
}
