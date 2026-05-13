import { v4 as uuid } from 'uuid'
import path from 'node:path'
import {
  Session, type SessionEvents, AnthropicProvider, OpenAIChatProvider, OpenAIResponsesProvider,
  ConversationHistory, loadAppConfig, getConfigDir, type ModelConfig, type SessionConfig, type StreamChunk,
  type PermissionCallback,
} from '@jdcagnet/core'
import type { ToolExecutionEvent } from '@jdcagnet/core'
import type { BrowserWindow } from 'electron'

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
  private window: BrowserWindow | null = null
  private readyPromise: Promise<void>
  private pendingPermissions = new Map<string, { resolve: (allowed: boolean) => void }>()

  constructor() {
    const dbPath = path.join(getConfigDir(), 'history.db')
    this.history = new ConversationHistory(dbPath)
    this.readyPromise = this.history.ensureReady()
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
      maxTokens: active.model.contextWindow || 8192,
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
    const session = new Session(sessionConfig, provider, this.history, permissionCallback)
    session.loadHistory()
    this.sessions.set(sessionId, session)
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    // Ensure session is activated with latest model config
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
      },
      onMessageComplete: (message) => {
        this.window?.webContents.send('query:complete', { sessionId, message })
      },
      onError: (error) => {
        this.window?.webContents.send('query:error', { sessionId, error: error.message })
      },
    }

    try {
      await session.sendMessage(text, events)
    } catch (err: any) {
      this.window?.webContents.send('query:error', { sessionId, error: err.message })
    }
  }

  abortSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort()
  }

  respondToPermission(id: string, allowed: boolean): void {
    const pending = this.pendingPermissions.get(id)
    if (pending) {
      pending.resolve(allowed)
      this.pendingPermissions.delete(id)
    }
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.history.deleteSession(sessionId)
  }

  getMessages(sessionId: string) {
    return this.history.getMessages(sessionId)
  }

  close(): void {
    this.history.close()
  }
}
