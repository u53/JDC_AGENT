import { v4 as uuid } from 'uuid'
import path from 'node:path'
import {
  Session, type SessionEvents, AnthropicProvider, OpenAIChatProvider, OpenAIResponsesProvider,
  ConversationHistory, loadAppConfig, saveAppConfig, getConfigDir, type ModelConfig, type SessionConfig, type StreamChunk,
  type PermissionCallback, createAskUserTool, type AskUserCallback, createNotifyTool, type NotifyCallback,
  McpManager, loadMcpConfig, saveMcpConfig, type McpServerConfig, type McpServerState,
  IdeManager, type IdeConnection, type OpenDiffParams, type OpenDiffResult, type DiagnosticFile,
  compressImageForAPI, getContextEngine, ensureCodeIndexJob, resolveConfiguredModel, type ConfiguredModelResolution,
  inspectContext, type ConstraintObservabilitySnapshot,
} from '@jdcagnet/core'
import type { ToolExecutionEvent } from '@jdcagnet/core'
import { Notification, type BrowserWindow } from 'electron'

type RuntimeModelResolutionWithProtocol =
  | { status: 'resolved'; provider: any; modelConfig: ModelConfig; protocol: string; warning?: string }
  | { status: 'failed'; warning: string }

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
  private ideManager: IdeManager
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
    this.ideManager = new IdeManager({
      onConnectionChanged: (connections) => {
        this.window?.webContents.send('ide:state-changed', connections)
      },
      onSelectionChanged: (data) => {
        // Preserve last selected text if new event only has filePath (cursor moved, no selection)
        if (!data.text && this.lastIdeSelection?.text && data.filePath === this.lastIdeSelection.filePath) {
          data = { ...data, text: this.lastIdeSelection.text, selection: this.lastIdeSelection.selection }
        }
        this.lastIdeSelection = data
        // Only set ideContext on the active session, not all sessions
        if (this.activeSessionId) {
          const activeSession = this.sessions.get(this.activeSessionId)
          if (activeSession) {
            activeSession.ideContext = data
          }
        }
        this.window?.webContents.send('ide:selection-changed', data)
      },
      onAtMentioned: (data) => {
        this.window?.webContents.send('ide:at-mentioned', data)
      },
    })
  }

  private lastIdeSelection: any = null
  private activeSessionId: string | null = null
  private contextWarmTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly contextWarmDelayMs = 1_500

  async ensureReady(): Promise<void> {
    await this.readyPromise
  }

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  startIdeDiscovery(cwd: string): void {
    this.ideManager.startDiscovery(cwd)
  }

  /** Pre-warm the JDC Context Engine index in the background on project open. */
  private warmContextEngine(cwd: string): void {
    try {
      const engine = getContextEngine(cwd)
      if (!engine.isIndexed()) {
        const job = ensureCodeIndexJob(cwd, engine, Date.now())
        job.promise
          .then(() => {
            // Begin live incremental updates once the initial index is built.
            engine.startWatching()
          })
          .catch((err) => {
            console.error('[context-engine] background index failed:', err)
          })
      } else {
        engine.startWatching()
      }
    } catch (err) {
      console.error('[context-engine] warm failed:', err)
    }
  }

  private scheduleProjectBackgroundWarm(cwd: string): void {
    this.cancelPendingContextWarmsExcept(cwd)
    if (this.contextWarmTimers.has(cwd)) return
    const timer = setTimeout(() => {
      this.contextWarmTimers.delete(cwd)
      this.ideManager.startDiscovery(cwd)
      this.warmContextEngine(cwd)
    }, this.contextWarmDelayMs)
    this.contextWarmTimers.set(cwd, timer)
  }

  private cancelPendingContextWarmsExcept(activeCwd: string): void {
    for (const [cwd, timer] of this.contextWarmTimers) {
      if (cwd === activeCwd) continue
      clearTimeout(timer)
      this.contextWarmTimers.delete(cwd)
    }
  }

  getIdeConnections(): IdeConnection[] {
    return this.ideManager.getConnections()
  }

  async ideOpenFile(filePath: string, line?: number, column?: number): Promise<void> {
    await this.ideManager.openFile(filePath, line, column)
  }

  async ideOpenDiff(params: OpenDiffParams): Promise<OpenDiffResult> {
    return this.ideManager.openDiff(params)
  }

  async ideCloseAllDiffTabs(): Promise<void> {
    await this.ideManager.closeAllDiffTabs()
  }

  async ideGetDiagnostics(filePaths: string[]): Promise<DiagnosticFile[]> {
    return this.ideManager.getDiagnostics(filePaths)
  }

  createSession(projectName: string, cwd: string): string {
    const sessionId = uuid()
    this.history.createSession(sessionId, projectName, cwd)
    return sessionId
  }

  getSessionCwd(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId)
    if (session?.config?.cwd) return session.config.cwd
    return this.history.listSessions().find((item) => item.id === sessionId)?.cwd
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

  private resolveModelById(modelId: string): { provider: any; modelConfig: ModelConfig; protocol: string } | null {
    const config = loadAppConfig()
    const resolution = resolveConfiguredModel(config.modelGroups?.groups, modelId)
    const runtime = this.modelResolutionToRuntime(resolution)
    if (runtime.status !== 'resolved') return null
    return {
      provider: runtime.provider,
      modelConfig: runtime.modelConfig,
      protocol: runtime.protocol,
    }
  }

  private modelResolutionToRuntime(resolution: ConfiguredModelResolution): RuntimeModelResolutionWithProtocol {
    if (resolution.status !== 'resolved') {
      return { status: 'failed', warning: resolution.message }
    }
    const m = resolution.model
    return {
      status: 'resolved',
      provider: this.createProvider(m.group as any),
      modelConfig: { model: m.modelId, maxTokens: m.maxTokens, contextWindow: m.contextWindow, compressAt: m.compressAt },
      protocol: m.protocol || 'anthropic',
      warning: resolution.message,
    }
  }

  setSessionModel(sessionId: string, modelId: string): void {
    this.history.setSessionModel(sessionId, modelId)
    // Also update global config as "last used" for new sessions
    const config = loadAppConfig()
    if (config.modelGroups) {
      config.modelGroups.activeModelId = modelId
      saveAppConfig(config)
    }
    // If session is already active, hot-swap the provider
    const session = this.sessions.get(sessionId)
    if (session) {
      const resolved = this.resolveModelById(modelId)
      if (resolved) {
        session.updateProvider(resolved.provider, resolved.modelConfig)
        ;(session as any)._protocol = resolved.protocol
      }
    }
  }

  getSessionModel(sessionId: string): string | null {
    return this.history.getSessionModel(sessionId)
  }

  async activateSession(sessionId: string): Promise<void> {
    const meta = this.history.listSessions().find(s => s.id === sessionId)
    if (!meta) throw new Error(`Session ${sessionId} not found`)
    this.activeSessionId = sessionId
    this.scheduleProjectBackgroundWarm(meta.cwd)
    if (this.sessions.has(sessionId)) return

    const sessionModelId = this.history.getSessionModel(sessionId)
    let modelConfig: ModelConfig
    let provider: any
    let protocol: string

    if (sessionModelId) {
      const resolved = this.resolveModelById(sessionModelId)
      if (resolved) {
        modelConfig = resolved.modelConfig
        provider = resolved.provider
        protocol = resolved.protocol
      } else {
        // Stored model no longer exists, fall back to global
        const active = getActiveModelConfig()
        if (!active) throw new Error('No active model selected. Please configure a model in settings.')
        provider = this.createProvider(active.group)
        modelConfig = { model: active.model.modelId, maxTokens: active.model.maxTokens || 32000, contextWindow: active.model.contextWindow || 200000, compressAt: active.model.compressAt || 0.9 }
        protocol = active.group.protocol || 'anthropic'
        this.history.setSessionModel(sessionId, active.model.id)
      }
    } else {
      // New session, no model stored yet — use global default
      const active = getActiveModelConfig()
      if (!active) throw new Error('No active model selected. Please configure a model in settings.')
      provider = this.createProvider(active.group)
      modelConfig = { model: active.model.modelId, maxTokens: active.model.maxTokens || 32000, contextWindow: active.model.contextWindow || 200000, compressAt: active.model.compressAt || 0.9 }
      protocol = active.group.protocol || 'anthropic'
      this.history.setSessionModel(sessionId, active.model.id)
    }

    const sessionConfig: SessionConfig = {
      id: sessionId, projectName: meta.projectName, cwd: meta.cwd, modelConfig,
    }
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
      const resolution = resolveConfiguredModel(config.modelGroups?.groups, modelId)
      const runtime = this.modelResolutionToRuntime(resolution)
      if (runtime.status !== 'resolved') return runtime
      return { status: 'resolved', provider: runtime.provider, modelConfig: runtime.modelConfig, warning: runtime.warning }
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
    session.onImageGenerated = (taskId: string, images: any[], error?: string) => {
      this.window?.webContents.send('image:generated', { sessionId, taskId, images, error })
    }
    session.loadHistory()
    ;(session as any)._protocol = protocol
    session.onNotificationReady = () => {
      this.window?.webContents.send('background:state-changed', { sessionId })
      if ((session as any).abortController) return
      const notificationEvents: SessionEvents = {
        onStreamChunk: (chunk: StreamChunk) => {
          this.window?.webContents.send('query:stream', { sessionId, chunk })
        },
        onToolEvent: (event: ToolExecutionEvent) => {
          this.window?.webContents.send('query:tool-event', { sessionId, event })
        },
        onMessageComplete: (message) => {
          this.window?.webContents.send('query:complete', { sessionId, message })
        },
        onMessagesReplaced: (messages) => {
          this.window?.webContents.send('session:messages-updated', { sessionId, messages })
        },
        onError: (error) => {
          this.window?.webContents.send('query:error', { sessionId, error: error.message })
        },
        onRetrying: (attempt: number, error: Error, delayMs: number, category: string, maxRetries: number) => {
          this.window?.webContents.send('query:retrying', { sessionId, attempt, maxRetries, error: error.message, delayMs, category })
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
      this.window?.webContents.send('background:notification', { sessionId })
      session.processNotifications(notificationEvents).then(() => {
        this.window?.webContents.send('query:finished', { sessionId })
      }).catch((err: any) => {
        this.window?.webContents.send('query:error', { sessionId, error: err.message })
      })
    }
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

    // Refresh model config in case user edited model params (contextWindow, maxTokens, etc.)
    const sessionModelId = this.history.getSessionModel(sessionId)
    if (sessionModelId) {
      const resolved = this.resolveModelById(sessionModelId)
      if (resolved) {
        const mc = session.config.modelConfig
        if (mc.model !== resolved.modelConfig.model || (session as any)._protocol !== resolved.protocol) {
          session.updateProvider(resolved.provider, resolved.modelConfig)
          ;(session as any)._protocol = resolved.protocol
        } else if (mc.contextWindow !== resolved.modelConfig.contextWindow ||
                   mc.compressAt !== resolved.modelConfig.compressAt ||
                   mc.maxTokens !== resolved.modelConfig.maxTokens) {
          session.updateProvider(session.getProvider(), resolved.modelConfig)
        }
      }
    }

    const events: SessionEvents = {
      onStreamChunk: (chunk: StreamChunk) => {
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      },
      onToolEvent: (event: ToolExecutionEvent) => {
        this.window?.webContents.send('query:tool-event', { sessionId, event })
        if (event.type === 'complete' && event.toolName === 'EnterPlanMode') {
          this.window?.webContents.send('plan:mode-changed', { sessionId, mode: 'planning' })
        } else if (event.type === 'complete' && event.toolName === 'ExitPlanMode') {
          this.window?.webContents.send('plan:mode-changed', { sessionId, mode: 'normal' })
        }
      },
      onMessageComplete: (message) => {
        this.window?.webContents.send('query:complete', { sessionId, message })
      },
      onMessagesReplaced: (messages) => {
        this.window?.webContents.send('session:messages-updated', { sessionId, messages })
      },
      onError: (error) => {
        this.window?.webContents.send('query:error', { sessionId, error: error.message })
      },
      onRetrying: (attempt: number, error: Error, delayMs: number, category: string, maxRetries: number) => {
        this.window?.webContents.send('query:retrying', {
          sessionId,
          attempt,
          maxRetries,
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

    // Compress and convert images to ImageContent blocks
    let extraContent: Array<{ type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } }> | undefined
    if (images?.length) {
      extraContent = await Promise.all(
        images.map(async (img) => {
          try {
            const compressed = await compressImageForAPI(img.data, img.mediaType)
            const originalSize = Buffer.from(img.data, 'base64').length
            const compressedSize = Buffer.from(compressed.data, 'base64').length
            console.log(`[IMAGE] Compressed: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (${compressed.mediaType})`)
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: compressed.mediaType,
                data: compressed.data,
              },
            }
          } catch (err) {
            console.warn('[IMAGE] Compression failed, sending original:', (err as Error).message)
            const rawSize = Buffer.from(img.data, 'base64').length
            const base64Size = Math.ceil((rawSize * 4) / 3)
            if (base64Size > 5 * 1024 * 1024) {
              throw new Error(`Image too large (${(base64Size / 1024 / 1024).toFixed(1)}MB) and compression failed`)
            }
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                data: img.data,
              },
            }
          }
        })
      )
    }

    // Persist user-attached reference images to .jdc-image-input/ so the model
    // can reference them by PATH in EditImage (decision A1: everything is a path).
    let inputImageNote = ''
    if (extraContent?.length) {
      try {
        const cwd = this.getSessionCwd(sessionId) || process.cwd()
        const inputDir = path.join(cwd, '.jdc-image-input')
        const { mkdirSync, writeFileSync } = await import('node:fs')
        mkdirSync(inputDir, { recursive: true })
        const paths: string[] = []
        extraContent.forEach((img: any, i: number) => {
          const ext = img.source.media_type === 'image/jpeg' ? 'jpg'
            : img.source.media_type === 'image/webp' ? 'webp'
            : img.source.media_type === 'image/gif' ? 'gif' : 'png'
          const file = path.join(inputDir, `input_${Date.now()}_${i + 1}.${ext}`)
          writeFileSync(file, Buffer.from(img.source.data, 'base64'))
          paths.push(file)
        })
        if (paths.length) {
          inputImageNote = `\n\n<image-input-paths>\n${paths.join('\n')}\n</image-input-paths>`
        }
      } catch (err) {
        console.warn('[IMAGE] persist input image failed:', (err as Error).message)
      }
    }

    try {
      await session.sendMessage(text + inputImageNote, events, extraContent)
      this.window?.webContents.send('query:finished', { sessionId })
    } catch (err: any) {
      console.error('[SEND] Error:', err.message, err.stack)
      this.window?.webContents.send('query:error', { sessionId, error: err.message })
    }
  }

  async retrySession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      await this.activateSession(sessionId)
    }
    const session = this.sessions.get(sessionId)!

    const events: SessionEvents = {
      onStreamChunk: (chunk: StreamChunk) => {
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      },
      onToolEvent: (event: ToolExecutionEvent) => {
        this.window?.webContents.send('query:tool-event', { sessionId, event })
        if (event.type === 'complete' && event.toolName === 'EnterPlanMode') {
          this.window?.webContents.send('plan:mode-changed', { sessionId, mode: 'planning' })
        } else if (event.type === 'complete' && event.toolName === 'ExitPlanMode') {
          this.window?.webContents.send('plan:mode-changed', { sessionId, mode: 'normal' })
        }
      },
      onMessageComplete: (message) => {
        this.window?.webContents.send('query:complete', { sessionId, message })
      },
      onMessagesReplaced: (messages) => {
        this.window?.webContents.send('session:messages-updated', { sessionId, messages })
      },
      onError: (error) => {
        this.window?.webContents.send('query:error', { sessionId, error: error.message })
      },
      onRetrying: (attempt: number, error: Error, delayMs: number, category: string, maxRetries: number) => {
        this.window?.webContents.send('query:retrying', {
          sessionId,
          attempt,
          maxRetries,
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

    try {
      await session.retryLastTurn(events)
      this.window?.webContents.send('query:finished', { sessionId })
    } catch (err: any) {
      console.error('[RETRY] Error:', err.message, err.stack)
      this.window?.webContents.send('query:error', { sessionId, error: err.message })
    }
  }

  abortSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort()
  }

  abortAgent(sessionId: string, agentToolUseId: string): void {
    this.sessions.get(sessionId)?.abortAgent(agentToolUseId)
  }

  backgroundAgent(sessionId: string, agentToolUseId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.backgroundAgent(agentToolUseId)
    }
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

  async inspectConstraints(sessionId: string): Promise<ConstraintObservabilitySnapshot> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const context = await inspectContext({ sessionId }, { cwd: session.getCwd() })
    return session.inspectConstraints(context)
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

  getBackgroundTasks(sessionId: string): any[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return (session as any).backgroundTasks.listAll()
  }

  stopBackgroundTask(sessionId: string, taskId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    ;(session as any).backgroundTasks.stop(taskId)
    this.window?.webContents.send('background:state-changed', { sessionId })
  }

  getBackgroundTaskOutput(sessionId: string, taskId: string, tail?: number): string {
    const session = this.sessions.get(sessionId)
    if (!session) return ''
    return (session as any).backgroundTasks.getOutput(taskId, tail)
  }

  getTeamStatus(sessionId: string, taskId: string): any {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    return session.getTeamStatus(taskId)
  }

  getTeamEvents(sessionId: string, taskId: string, tail?: number): any[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return session.getTeamEvents(taskId, tail)
  }

  sendTeamMessage(sessionId: string, taskId: string, payload: { message: string; target?: string; intent?: string; priority?: string }): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.sendTeamMessage(taskId, payload)
    this.window?.webContents.send('team:state-changed', { sessionId, taskId })
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

  async getSkills(sessionId: string): Promise<{ name: string; description: string; argumentHint?: string }[]> {
    if (!this.sessions.has(sessionId)) {
      try { await this.activateSession(sessionId) } catch { return [] }
    }
    const session = this.sessions.get(sessionId)
    if (!session) return []
    await session.ensureSkillsReady()
    await session.reloadSkills()
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
    if (!session) {
      this.window?.webContents.send('query:error', { sessionId, error: 'Session not active' })
      this.window?.webContents.send('query:finished', { sessionId })
      return
    }

    // Defer terminal compact_* events until AFTER session:messages-updated so
    // any UI-side reaction (e.g. inserting a "[Context compressed]" marker)
    // is not clobbered by the subsequent full-messages replacement.
    const deferredChunks: StreamChunk[] = []
    const isTerminalCompactChunk = (chunk: StreamChunk) =>
      chunk.type === 'compact_complete' ||
      chunk.type === 'compact_skipped' ||
      chunk.type === 'compact_failed'

    const events: SessionEvents = {
      onStreamChunk: (chunk: StreamChunk) => {
        if (isTerminalCompactChunk(chunk)) {
          deferredChunks.push(chunk)
          return
        }
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      },
      onToolEvent: () => {},
      onMessageComplete: () => {},
      onMessagesReplaced: (messages) => {
        this.window?.webContents.send('session:messages-updated', { sessionId, messages })
      },
      onError: (error) => {
        this.window?.webContents.send('query:error', { sessionId, error: error.message })
      },
      onUsage: (usage) => {
        this.window?.webContents.send('query:usage', { sessionId, usage })
      },
    }
    try {
      await session.compactNow(events)
      for (const chunk of deferredChunks) {
        this.window?.webContents.send('query:stream', { sessionId, chunk })
      }
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

  setEffort(sessionId: string, effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.setEffort(effort)
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
