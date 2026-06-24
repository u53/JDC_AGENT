import { loadAppConfig } from '@jdcagnet/core'
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

type FeishuModelEntry = {
  id: string
  modelId: string
  name?: string
}

type FeishuModelGroup = {
  id: string
  name?: string
  models?: FeishuModelEntry[]
}

type FeishuModelConfigPort = {
  getModelGroups(): FeishuModelGroup[]
}

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
  createSession(projectName: string, cwd: string, options?: { permissionMode?: FeishuBinding['permissionMode'] }): string
  sendMessage(
    sessionId: string,
    text: string,
    images?: { data: string; mediaType: string }[],
    options?: { sink?: SessionEventSink; interactionSink?: SessionInteractionSink }
  ): Promise<void>
  setSessionModel?(sessionId: string, modelId: string, options?: { updateGlobal?: boolean }): void
  setPermissionMode?(sessionId: string, mode: FeishuBinding['permissionMode']): void
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
  modelConfig?: FeishuModelConfigPort
}

type RuntimeBinding = {
  binding: FeishuBinding
  client: FeishuRuntimeClient
  connected: boolean
  lastError?: string
}

type PendingInteraction = {
  id: string
  bindingId: string
  chatId: string
  threadKey?: string
  kind: 'reply' | 'approval'
  timeout: ReturnType<typeof setTimeout>
  resolveReply?: (reply: string) => void
  resolveApproval?: (approved: boolean) => void
}

const unauthorizedReplyText = 'This Feishu chat or sender is not authorized for this bot.'
const processingReplyText = '已收到，正在处理…'
const runFailedReplyText = '运行失败，请在 JDC 客户端查看详情。'
const connectionFailedStatusText = 'Connection failed.'
const messageProcessingFailedStatusText = 'Message processing failed.'
const interactionTimeoutMs = 30 * 60 * 1000
const noModelConfigText = '暂无可切换模型。请先在 JDC 客户端设置页配置模型。'

export class FeishuBridge {
  private readonly resolver: FeishuConversationResolver
  private readonly clientFactory: (binding: FeishuBinding) => FeishuRuntimeClient
  private readonly modelConfig: FeishuModelConfigPort
  private readonly runtimes = new Map<string, RuntimeBinding>()
  private readonly pendingInteractions = new Map<string, PendingInteraction[]>()
  private running = false

  constructor(private readonly options: FeishuBridgeOptions) {
    this.resolver = new FeishuConversationResolver(options.history, options.sessions)
    this.clientFactory = options.clientFactory ?? createFeishuClient
    this.modelConfig = options.modelConfig ?? { getModelGroups: () => loadAppConfig().modelGroups?.groups ?? [] }
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
    this.clearPendingInteractions()
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
      if (this.resolvePendingInteraction(runtime, message)) {
        this.options.history.completeExternalEvent('feishu', message.eventId, 'processed')
        return
      }

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

      const statusMessage = await this.sendStatusMessage(client, message)
      const sink = new FeishuSink(client, { chatId: message.chatId, threadKey: message.threadKey }, this.createInteractionResolver(runtime, message), { statusMessageId: statusMessage.messageId })
      this.options.sessions.setPermissionMode?.(resolved.sessionId, binding.permissionMode)
      this.runSessionMessage(runtime, resolved.sessionId, resolved.text, sink, message.eventId)
    } catch {
      runtime.lastError = messageProcessingFailedStatusText
      await this.notifyProcessingFailure(client, message)
      this.options.history.completeExternalEvent('feishu', message.eventId, 'failed')
    }
  }

  private async sendStatusMessage(client: FeishuRuntimeClient, message: FeishuInboundMessage): Promise<{ messageId: string }> {
    if (client.sendMarkdown) {
      try {
        return await client.sendMarkdown({ chatId: message.chatId, threadKey: message.threadKey, text: processingReplyText })
      } catch {
        return client.sendText({ chatId: message.chatId, threadKey: message.threadKey, text: processingReplyText })
      }
    }
    return client.sendText({ chatId: message.chatId, threadKey: message.threadKey, text: processingReplyText })
  }

  private runSessionMessage(
    runtime: RuntimeBinding,
    sessionId: string,
    text: string,
    sink: FeishuSink,
    eventId: string
  ): void {
    void this.options.sessions.sendMessage(sessionId, text, undefined, { sink, interactionSink: sink })
      .then(() => {
        this.options.history.completeExternalEvent('feishu', eventId, sink.hasError() ? 'failed' : 'processed')
      })
      .catch(async () => {
        runtime.lastError = messageProcessingFailedStatusText
        try {
          await sink.error?.(sessionId, new Error(messageProcessingFailedStatusText))
          await sink.drainPendingSends()
        } catch {
          runtime.lastError = messageProcessingFailedStatusText
        }
        this.options.history.completeExternalEvent('feishu', eventId, 'failed')
      })
  }

  private createInteractionResolver(runtime: RuntimeBinding, message: FeishuInboundMessage) {
    return {
      waitForReply: (input: { chatId: string; threadKey?: string; promptMessageId: string }) => {
        return new Promise<string>((resolve) => {
          this.addPendingInteraction({
            bindingId: runtime.binding.id,
            chatId: input.chatId,
            threadKey: input.threadKey ?? message.threadKey,
            kind: 'reply',
            resolveReply: resolve,
          })
        })
      },
      waitForApproval: (requestId: string) => {
        return new Promise<boolean>((resolve) => {
          this.addPendingInteraction({
            bindingId: runtime.binding.id,
            chatId: message.chatId,
            threadKey: message.threadKey,
            kind: 'approval',
            resolveApproval: resolve,
          })
        })
      },
    }
  }

  private addPendingInteraction(input: Omit<PendingInteraction, 'id' | 'timeout'>): void {
    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`
    const pending: PendingInteraction = {
      ...input,
      id,
      timeout: setTimeout(() => {
        this.removePendingInteraction(pending)
        pending.resolveReply?.('')
        pending.resolveApproval?.(false)
      }, interactionTimeoutMs),
    }
    const key = this.pendingInteractionKey(input.bindingId, input.chatId)
    const items = this.pendingInteractions.get(key) ?? []
    items.push(pending)
    this.pendingInteractions.set(key, items)
  }

  private resolvePendingInteraction(runtime: RuntimeBinding, message: FeishuInboundMessage): boolean {
    const key = this.pendingInteractionKey(runtime.binding.id, message.chatId)
    const items = this.pendingInteractions.get(key) ?? []
    const pending = items.find((item) => this.matchesPendingInteraction(item, message))
    if (!pending) return false

    this.removePendingInteraction(pending)
    if (pending.kind === 'approval') {
      pending.resolveApproval?.(parseApprovalReply(message.text))
    } else {
      pending.resolveReply?.(message.text.trim())
    }
    return true
  }

  private matchesPendingInteraction(pending: PendingInteraction, message: FeishuInboundMessage): boolean {
    return pending.chatId === message.chatId && (!pending.threadKey || !message.threadKey || pending.threadKey === message.threadKey)
  }

  private removePendingInteraction(pending: PendingInteraction): void {
    clearTimeout(pending.timeout)
    const key = this.pendingInteractionKey(pending.bindingId, pending.chatId)
    const next = (this.pendingInteractions.get(key) ?? []).filter((item) => item !== pending)
    if (next.length) this.pendingInteractions.set(key, next)
    else this.pendingInteractions.delete(key)
  }

  private clearPendingInteractions(): void {
    for (const items of this.pendingInteractions.values()) {
      for (const item of items) {
        clearTimeout(item.timeout)
        item.resolveReply?.('')
        item.resolveApproval?.(false)
      }
    }
    this.pendingInteractions.clear()
  }

  private pendingInteractionKey(bindingId: string, chatId: string): string {
    return `${bindingId}:${chatId}`
  }

  private async notifyProcessingFailure(client: FeishuRuntimeClient, message: FeishuInboundMessage): Promise<void> {
    try {
      await client.sendText({ chatId: message.chatId, threadKey: message.threadKey, text: runFailedReplyText })
    } catch {
      // Preserve the original processing failure status; Feishu send failures are exposed through getStatus().
    }
  }

  private async handleCommand(
    client: FeishuRuntimeClient,
    message: FeishuInboundMessage,
    command: 'new' | 'status' | 'stop' | 'compact' | 'session' | 'model',
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
      case 'model':
        text = this.handleModelCommand(message.text, sessionId)
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

  private handleModelCommand(text: string, sessionId?: string): string {
    const request = parseModelCommandRequest(text)
    const groups = this.modelConfig.getModelGroups()
    if (!request) return formatModelList(groups)

    const resolution = resolveFeishuModel(groups, request)
    if (resolution.status !== 'resolved') {
      return `模型切换失败：${request}\n原因：${resolution.reason}`
    }
    if (!sessionId) {
      return `模型切换失败：${request}\n原因：当前飞书会话不存在，请先发送一条普通消息或使用 /new 创建会话。`
    }
    if (!this.options.sessions.setSessionModel) {
      return `模型切换失败：${request}\n原因：当前运行环境不支持模型切换。`
    }

    this.options.sessions.setSessionModel(sessionId, resolution.model.id, { updateGlobal: false })
    return `模型切换成功：${resolution.groupLabel}:${resolution.modelLabel}`
  }
}

function parseModelCommandRequest(text: string): string {
  return text.trim().replace(/^\/model(?:\s+)?/i, '').trim()
}

function formatModelList(groups: FeishuModelGroup[]): string {
  const lines = groups.flatMap((group) => {
    const groupLabel = modelGroupLabel(group)
    return (group.models ?? []).map((model) => `${groupLabel}:${modelLabel(model)}`)
  })
  if (lines.length === 0) return noModelConfigText
  return `可切换模型：\n${lines.join('\n')}`
}

function resolveFeishuModel(groups: FeishuModelGroup[], request: string):
  | { status: 'resolved'; group: FeishuModelGroup; model: FeishuModelEntry; groupLabel: string; modelLabel: string }
  | { status: 'failed'; reason: string } {
  const colon = request.indexOf(':')
  if (colon <= 0 || colon === request.length - 1) return { status: 'failed', reason: '请使用 /model 分组名称:模型名称' }

  const requestedGroup = request.slice(0, colon).trim()
  const requestedModel = request.slice(colon + 1).trim()
  const group = groups.find((item) => sameModelText(item.name, requestedGroup) || sameModelText(item.id, requestedGroup))
  if (!group) return { status: 'failed', reason: '分组不存在' }

  const model = (group.models ?? []).find((item) => sameModelText(item.name, requestedModel) || sameModelText(item.modelId, requestedModel) || sameModelText(item.id, requestedModel))
  if (!model) return { status: 'failed', reason: '模型不存在' }

  return { status: 'resolved', group, model, groupLabel: modelGroupLabel(group), modelLabel: modelLabel(model) }
}

function modelGroupLabel(group: FeishuModelGroup): string {
  return group.name?.trim() || group.id
}

function modelLabel(model: FeishuModelEntry): string {
  return model.name?.trim() || model.modelId
}

function sameModelText(actual: string | undefined, requested: string): boolean {
  if (!actual) return false
  return actual === requested || actual.toLocaleLowerCase() === requested.toLocaleLowerCase()
}

function parseApprovalReply(text: string): boolean {
  const trimmed = text.trim()
  if (/^(?:同意|允许|通过|yes|y|approve|approved|allow)$/i.test(trimmed)) return true
  if (/^(?:拒绝|不允许|否|no|n|deny|denied|reject)$/i.test(trimmed)) return false
  return false
}
