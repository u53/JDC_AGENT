import { describe, expect, it, vi } from 'vitest'
import { FeishuBridge } from './bridge'

function binding() {
  return {
    id: 'binding_1',
    name: 'Project bot',
    enabled: true,
    appId: 'cli',
    appSecret: 'secret',
    projectName: 'Project',
    cwd: '/repo/project',
    permissionMode: 'standard',
    allowedChatIds: [],
    allowedOpenIds: [],
    sessionStrategy: 'thread',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('FeishuBridge', () => {
  it('dedupes an inbound message before sending it to a JDC session', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
    }
    const bindings = {
      getEnabledBindings: vi.fn().mockReturnValue([binding()]),
    }
    const history = {
      beginExternalEvent: vi.fn()
        .mockReturnValueOnce({ status: 'accepted' })
        .mockReturnValueOnce({ status: 'duplicate' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
    const bridge = new FeishuBridge({ clientFactory: () => client as any, bindings: bindings as any, history: history as any, sessions: sessions as any })

    await bridge.start()
    const handler = client.onMessage.mock.calls[0][0]
    await handler({ eventId: 'event_1', messageId: 'msg_1', chatId: 'chat_1', chatType: 'group', senderOpenId: 'user_1', text: 'hello', threadKey: 'thread_1', raw: {} })
    await handler({ eventId: 'event_1', messageId: 'msg_1', chatId: 'chat_1', chatType: 'group', senderOpenId: 'user_1', text: 'hello', threadKey: 'thread_1', raw: {} })

    expect(sessions.sendMessage).toHaveBeenCalledTimes(1)
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_1', 'processed')
  })

  it('handles commands locally without forwarding them to the model', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
    }
    const history = {
      beginExternalEvent: vi.fn().mockReturnValue({ status: 'accepted' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0]({ eventId: 'event_1', messageId: 'msg_1', chatId: 'chat_1', chatType: 'group', senderOpenId: 'user_1', text: '/status', threadKey: 'thread_1', raw: {} })

    expect(sessions.sendMessage).not.toHaveBeenCalled()
    expect(client.sendText).toHaveBeenCalledWith({ chatId: 'chat_1', threadKey: 'thread_1', text: 'Current session: session_1' })
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_1', 'processed')
  })

  it('sends a generic unauthorized reply without raw Feishu identifiers', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
    }
    const history = {
      beginExternalEvent: vi.fn().mockReturnValue({ status: 'accepted' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn(),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: {
        getEnabledBindings: vi.fn().mockReturnValue([{ ...binding(), allowedChatIds: ['allowed_chat'], allowedOpenIds: ['allowed_user'] }]),
      } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0]({
      eventId: 'event_1',
      messageId: 'msg_1',
      chatId: 'raw_chat_id_123',
      chatType: 'group',
      senderOpenId: 'raw_sender_open_id_456',
      text: 'hello',
      threadKey: 'thread_1',
      raw: {},
    })

    expect(sessions.sendMessage).not.toHaveBeenCalled()
    expect(client.sendText).toHaveBeenCalledWith({
      chatId: 'raw_chat_id_123',
      threadKey: 'thread_1',
      text: 'This Feishu chat or sender is not authorized for this bot.',
    })
    const replyText = client.sendText.mock.calls[0][0].text
    expect(replyText).not.toContain('raw_chat_id_123')
    expect(replyText).not.toContain('raw_sender_open_id_456')
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_1', 'processed')
  })

  it('exposes sanitized status text after client start failure', async () => {
    const client = {
      start: vi.fn().mockRejectedValue(new Error('SDK failed with appSecret=secret raw_request_id=req_123')),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: {
        beginExternalEvent: vi.fn(),
        completeExternalEvent: vi.fn(),
        findExternalConversation: vi.fn(),
        upsertExternalConversation: vi.fn(),
      } as any,
      sessions: {
        createSession: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      } as any,
    })

    await bridge.start()

    const status = bridge.getStatus()
    expect(status.bindings[0].lastError).toBe('Connection failed.')
    expect(status.bindings[0].lastError).not.toContain('appSecret=secret')
    expect(status.bindings[0].lastError).not.toContain('raw_request_id=req_123')
  })
})
