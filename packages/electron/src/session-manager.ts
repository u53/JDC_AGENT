import { v4 as uuid } from 'uuid'
import path from 'node:path'
import {
  Session, type SessionEvents, AnthropicProvider, ConversationHistory,
  loadAppConfig, getConfigDir, type ModelConfig, type SessionConfig, type StreamChunk,
} from '@jdcagnet/core'
import type { ToolExecutionEvent } from '@jdcagnet/core'
import type { BrowserWindow } from 'electron'

export class SessionManager {
  private sessions = new Map<string, Session>()
  private history: ConversationHistory
  private window: BrowserWindow | null = null

  constructor() {
    const dbPath = path.join(getConfigDir(), 'history.db')
    this.history = new ConversationHistory(dbPath)
  }

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  createSession(projectName: string, cwd: string): string {
    const config = loadAppConfig()
    const sessionId = uuid()
    const modelConfig: ModelConfig = {
      model: config.defaultModel,
      maxTokens: 8192,
    }
    const sessionConfig: SessionConfig = { id: sessionId, projectName, cwd, modelConfig }

    this.history.createSession(sessionId, projectName, cwd)

    const provider = new AnthropicProvider(config.anthropicApiKey || '')
    const session = new Session(sessionConfig, provider, this.history)
    this.sessions.set(sessionId, session)

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

  async activateSession(sessionId: string): Promise<void> {
    let session = this.sessions.get(sessionId)
    if (!session) {
      const meta = this.history.listSessions().find(s => s.id === sessionId)
      if (!meta) throw new Error(`Session ${sessionId} not found`)
      const config = loadAppConfig()
      const modelConfig: ModelConfig = { model: config.defaultModel, maxTokens: 8192 }
      const sessionConfig: SessionConfig = {
        id: sessionId, projectName: meta.projectName, cwd: meta.cwd, modelConfig,
      }
      const provider = new AnthropicProvider(config.anthropicApiKey || '')
      session = new Session(sessionConfig, provider, this.history)
      session.loadHistory()
      this.sessions.set(sessionId, session)
    }
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not active`)

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
