import type { FeishuBinding, FeishuCommand, FeishuInboundMessage, FeishuResolvedConversation } from './types.js'

type FeishuConversationLookup = {
  channel: 'feishu'
  bindingId: string
  tenantKey?: string
  chatId: string
  threadKey: string
  userKey?: string
}

type FeishuConversationInput = FeishuConversationLookup & {
  cwd: string
  sessionId: string
}

type FeishuConversationMapping = {
  sessionId: string
}

export interface FeishuConversationHistoryPort {
  findExternalConversation(input: FeishuConversationLookup): FeishuConversationMapping | null
  upsertExternalConversation(input: FeishuConversationInput): FeishuConversationMapping
}

export interface FeishuSessionManagerPort {
  createSession(projectName: string, cwd: string): string
}

const slashCommands = new Set<FeishuCommand>(['new', 'status', 'stop', 'compact', 'session'])

export class FeishuConversationResolver {
  constructor(
    private readonly history: FeishuConversationHistoryPort,
    private readonly sessions: FeishuSessionManagerPort
  ) {}

  async resolve(binding: FeishuBinding, message: FeishuInboundMessage): Promise<FeishuResolvedConversation> {
    const unauthorizedReason = this.getUnauthorizedReason(binding, message)
    if (unauthorizedReason) {
      return { kind: 'unauthorized', reason: unauthorizedReason }
    }

    const lookup = this.createLookup(binding, message)
    const command = parseCommand(message.text)
    if (command === 'new') {
      const sessionId = this.createAndPersistSession(binding, lookup)
      return { kind: 'command', command, sessionId, text: message.text.trim() }
    }

    const mapping = this.history.findExternalConversation(lookup)
    if (command) {
      return { kind: 'command', command, sessionId: mapping?.sessionId, text: message.text.trim() }
    }

    if (mapping) {
      return { kind: 'message', sessionId: mapping.sessionId, text: message.text }
    }

    const sessionId = this.createAndPersistSession(binding, lookup)
    return { kind: 'message', sessionId, text: message.text }
  }

  private getUnauthorizedReason(binding: FeishuBinding, message: FeishuInboundMessage): string | null {
    if (binding.allowedChatIds.length > 0 && !binding.allowedChatIds.includes(message.chatId)) {
      return `Feishu chat is not authorized: ${message.chatId}`
    }
    if (binding.allowedOpenIds.length > 0 && !binding.allowedOpenIds.includes(message.senderOpenId)) {
      return `Feishu sender is not authorized: ${message.senderOpenId}`
    }
    return null
  }

  private createLookup(binding: FeishuBinding, message: FeishuInboundMessage): FeishuConversationLookup {
    const threadKey = binding.sessionStrategy === 'thread'
      ? message.threadKey || message.chatId
      : message.chatId
    return {
      channel: 'feishu',
      bindingId: binding.id,
      tenantKey: binding.tenantKey,
      chatId: message.chatId,
      threadKey,
      userKey: message.chatType === 'p2p' ? message.senderOpenId : undefined,
    }
  }

  private createAndPersistSession(binding: FeishuBinding, lookup: FeishuConversationLookup): string {
    const sessionId = this.sessions.createSession(binding.projectName, binding.cwd)
    this.history.upsertExternalConversation({
      ...lookup,
      cwd: binding.cwd,
      sessionId,
    })
    return sessionId
  }
}

function parseCommand(text: string): FeishuCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const command = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase()
  return slashCommands.has(command as FeishuCommand) ? command as FeishuCommand : null
}
