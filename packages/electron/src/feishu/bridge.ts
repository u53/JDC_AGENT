import { FeishuConversationResolver } from './conversation-resolver.js'
import { createFeishuClient } from './client.js'
import { FeishuSink } from './feishu-sink.js'
import type { SessionEventSink, SessionInteractionSink } from '../session-event-sink.js'
import type { FeishuBinding, FeishuClientPort, FeishuInboundMessage } from './types.js'

type FeishuRuntimeBridgePort = {
  start(): Promise<void>
  stop(): Promise<void>
}

export function createFeishuRuntime({ bridge }: { bridge: FeishuRuntimeBridgePort }): FeishuRuntimeBridgePort {
  return {
    start: () => bridge.start(),
    stop: () => bridge.stop(),
  }
}

type ExternalEventStatus = { status: 'accepted' | 'duplicate' }

type FeishuBindingPort = {
  getEnabledBindings(): FeishuBinding[]
}

type FeishuHistoryPort = {
  beginExternalEvent(input: { channel: 'feishu'; eventId: string; messageId?: string; bindingId: string }): ExternalEventStatus
  completeExternalEvent(channel: 'feishu', eventId: string, status: 'processed' | 'failed'): void
  findExternalConversation(input: {
    channel: 'feishu'
    bindingId: string
    tenantKey?: string
    chatId: string
    threadKey: string
    userKey?: string
  }): { sessionId: string } | null
  upsertExternalConversation(input: {
    channel: 'feishu'
    bindingId: string
    tenantKey?: string
    chatId: string
    threadKey: string
    userKey?: string
    cwd: string
    sessionId: string
  }): { sessionId: string }
}

type FeishuSessionPort = {
  createSession(projectName: string, cwd: string): string
  sendMessage(
    sessionId: string,
    text: string,
    images?: { data: string; mediaType: string }[],
    options?: { sink?: SessionEventSink; interactionSink?: SessionInteractionSink }
  ): Promise<void>
  abortSession?(sessionId: string): void
  compactSession?(sessionId: string): Promise<void> | void
}

export type FeishuRuntimeClient = FeishuClientPort & {
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (message: FeishuInboundMessage) => Promise<void>): void
}

export type FeishuBridgeStatus = {
  running: boolean
  bindings: Array<{ id: string; enabled: boolean; connected: boolean; lastError?: string }>
}

type FeishuBridgeOptions = {
  bindings: FeishuBindingPort
  history: FeishuHistoryPort
  sessions: FeishuSessionPort
  clientFactory?: (binding: FeishuBinding) => FeishuRuntimeClient
}

type RuntimeBinding = {
  binding: FeishuBinding
  client: FeishuRuntimeClient
  connected: boolean
  lastError?: string
}

const unauthorizedReplyText = 'This Feishu chat or sender is not authorized for this bot.'
const connectionFailedStatusText = 'Connection failed.'
const messageProcessingFailedStatusText = 'Message processing failed.'

export class FeishuBridge {
  private readonly resolver: FeishuConversationResolver
  private readonly clientFactory: (binding: FeishuBinding) => FeishuRuntimeClient
  private readonly runtimes = new Map<string, RuntimeBinding>()
  private running = false

  constructor(private readonly options: FeishuBridgeOptions) {
    this.resolver = new FeishuConversationResolver(options.history, options.sessions)
    this.clientFactory = options.clientFactory ?? createFeishuClient
  }

  async start(): Promise<void> {
    if (this.running) return

    const bindings = this.options.bindings.getEnabledBindings()
    for (const binding of bindings) {
      const client = this.clientFactory(binding)
      const runtime: RuntimeBinding = { binding, client, connected: false }
      this.runtimes.set(binding.id, runtime)
      client.onMessage((message) => this.handleInbound(runtime, message))
      try {
        await client.start()
        runtime.connected = true
      } catch {
        runtime.lastError = connectionFailedStatusText
      }
    }
    this.running = true
  }

  async stop(): Promise<void> {
    const runtimes = [...this.runtimes.values()]
    this.runtimes.clear()
    this.running = false
    await Promise.all(runtimes.map(async (runtime) => {
      try {
        await runtime.client.stop()
      } catch {
        runtime.lastError = connectionFailedStatusText
      }
    }))
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  getStatus(): FeishuBridgeStatus {
    return {
      running: this.running,
      bindings: [...this.runtimes.values()].map((runtime) => ({
        id: runtime.binding.id,
        enabled: runtime.binding.enabled,
        connected: runtime.connected,
        ...(runtime.lastError ? { lastError: runtime.lastError } : {}),
      })),
    }
  }

  private async handleInbound(runtime: RuntimeBinding, message: FeishuInboundMessage): Promise<void> {
    const { binding, client } = runtime
    const accepted = this.options.history.beginExternalEvent({
      channel: 'feishu',
      eventId: message.eventId,
      messageId: message.messageId,
      bindingId: binding.id,
    })
    if (accepted.status === 'duplicate') return

    try {
      const resolved = await this.resolver.resolve(binding, message)
      if (resolved.kind === 'unauthorized') {
        await client.sendText({ chatId: message.chatId, threadKey: message.threadKey, text: unauthorizedReplyText })
        this.options.history.completeExternalEvent('feishu', message.eventId, 'processed')
        return
      }

      if (resolved.kind === 'command') {
        await this.handleCommand(client, message, resolved.command, resolved.sessionId)
        this.options.history.completeExternalEvent('feishu', message.eventId, 'processed')
        return
      }

      const sink = new FeishuSink(client, { chatId: message.chatId, threadKey: message.threadKey })
      await this.options.sessions.sendMessage(resolved.sessionId, resolved.text, undefined, { sink, interactionSink: sink })
      this.options.history.completeExternalEvent('feishu', message.eventId, 'processed')
    } catch {
      runtime.lastError = messageProcessingFailedStatusText
      this.options.history.completeExternalEvent('feishu', message.eventId, 'failed')
    }
  }

  private async handleCommand(
    client: FeishuRuntimeClient,
    message: FeishuInboundMessage,
    command: 'new' | 'status' | 'stop' | 'compact' | 'session',
    sessionId?: string
  ): Promise<void> {
    let text: string
    switch (command) {
      case 'new':
        text = sessionId ? `New session: ${sessionId}` : 'New session could not be created.'
        break
      case 'status':
        text = sessionId ? `Current session: ${sessionId}` : 'No active session.'
        break
      case 'session':
        text = sessionId ? `Current session: ${sessionId}` : 'No active session.'
        break
      case 'stop':
        if (sessionId && this.options.sessions.abortSession) this.options.sessions.abortSession(sessionId)
        text = sessionId ? `Stopped session: ${sessionId}` : 'No active session to stop.'
        break
      case 'compact':
        if (sessionId && this.options.sessions.compactSession) await this.options.sessions.compactSession(sessionId)
        text = sessionId ? `Compacting session: ${sessionId}` : 'No active session to compact.'
        break
    }

    await client.sendText({ chatId: message.chatId, threadKey: message.threadKey, text })
  }
}
