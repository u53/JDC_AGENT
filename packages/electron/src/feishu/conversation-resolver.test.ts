import { describe, expect, it, vi } from 'vitest'
import { FeishuConversationResolver } from './conversation-resolver'
import type { FeishuBinding, FeishuInboundMessage } from './types'

const binding: FeishuBinding = {
  id: 'binding_1',
  name: 'HR bot',
  enabled: true,
  appId: 'cli_hr',
  appSecret: 'secret',
  projectName: 'hr_demo',
  cwd: '/repo/hr_demo',
  permissionMode: 'standard',
  allowedChatIds: ['chat_allowed'],
  allowedOpenIds: ['user_allowed'],
  sessionStrategy: 'thread',
  createdAt: 1,
  updatedAt: 1,
}

function inbound(text: string, patch: Partial<FeishuInboundMessage> = {}): FeishuInboundMessage {
  return {
    eventId: 'event_1',
    messageId: 'message_1',
    chatId: 'chat_allowed',
    chatType: 'group',
    senderOpenId: 'user_allowed',
    text,
    threadKey: 'thread_1',
    raw: {},
    ...patch,
  }
}

describe('FeishuConversationResolver', () => {
  it('reuses an existing mapping for the same group thread', async () => {
    const history = {
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_existing' }),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn(),
    }
    const resolver = new FeishuConversationResolver(history as any, sessions as any)

    const result = await resolver.resolve(binding, inbound('hello'))

    expect(result.kind).toBe('message')
    expect(result.sessionId).toBe('session_existing')
    expect(sessions.createSession).not.toHaveBeenCalled()
  })

  it('creates a new session when no mapping exists', async () => {
    const history = {
      findExternalConversation: vi.fn().mockReturnValue(null),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn().mockReturnValue('session_new'),
    }
    const resolver = new FeishuConversationResolver(history as any, sessions as any)

    const result = await resolver.resolve(binding, inbound('hello'))

    expect(result.sessionId).toBe('session_new')
    expect(sessions.createSession).toHaveBeenCalledWith('hr_demo', '/repo/hr_demo', { permissionMode: 'standard' })
    expect(history.upsertExternalConversation).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'feishu',
      bindingId: 'binding_1',
      chatId: 'chat_allowed',
      threadKey: 'thread_1',
      cwd: '/repo/hr_demo',
      sessionId: 'session_new',
    }))
  })

  it('rejects unauthorized chats before session creation', async () => {
    const resolver = new FeishuConversationResolver({} as any, { createSession: vi.fn() } as any)
    const result = await resolver.resolve(binding, inbound('hello', { chatId: 'chat_denied' }))

    expect(result.kind).toBe('unauthorized')
  })

  it('turns slash commands into command results', async () => {
    const resolver = new FeishuConversationResolver({ findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }) } as any, {} as any)
    const result = await resolver.resolve(binding, inbound('/status'))

    expect(result.kind).toBe('command')
    expect(result.command).toBe('status')
    expect(result.sessionId).toBe('session_1')
  })

  it('creates and persists a new mapping for /new commands', async () => {
    const history = {
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_old' }),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn().mockReturnValue('session_new'),
    }
    const resolver = new FeishuConversationResolver(history as any, sessions as any)

    const result = await resolver.resolve(binding, inbound('  /NEW please  '))

    expect(result).toEqual({ kind: 'command', command: 'new', sessionId: 'session_new', text: '/NEW please' })
    expect(history.findExternalConversation).not.toHaveBeenCalled()
    expect(history.upsertExternalConversation).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session_new',
      cwd: '/repo/hr_demo',
    }))
    expect(history.upsertExternalConversation.mock.calls[0][0]).not.toHaveProperty('projectName')
  })

  it('uses chat strategy chat id and p2p sender key for lookup', async () => {
    const history = {
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }),
      upsertExternalConversation: vi.fn(),
    }
    const resolver = new FeishuConversationResolver(history as any, { createSession: vi.fn() } as any)

    await resolver.resolve(
      { ...binding, tenantKey: 'tenant_1', allowedChatIds: [], allowedOpenIds: [], sessionStrategy: 'chat' },
      inbound('hello', { chatType: 'p2p', senderOpenId: 'user_p2p', chatId: 'chat_p2p', threadKey: 'ignored_thread' })
    )

    expect(history.findExternalConversation).toHaveBeenCalledWith({
      channel: 'feishu',
      bindingId: 'binding_1',
      tenantKey: 'tenant_1',
      chatId: 'chat_p2p',
      threadKey: 'chat_p2p',
      userKey: 'user_p2p',
    })
  })
})
