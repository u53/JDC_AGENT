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

describe('Feishu session integration', () => {
  it('forwards inbound Feishu text to the resolved session without leaking Feishu metadata into the prompt', async () => {
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
      bindings: bindings as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    const handler = client.onMessage.mock.calls[0][0]
    await handler({
      eventId: 'event_1',
      messageId: 'message_1',
      chatId: 'chat_1',
      chatType: 'group',
      senderOpenId: 'user_1',
      text: '用户问题',
      threadKey: 'thread_1',
      raw: { chatTitle: 'chat_title_1' },
    })

    expect(sessions.sendMessage).toHaveBeenCalledTimes(1)
    expect(sessions.sendMessage).toHaveBeenCalledWith(
      'session_1',
      '用户问题',
      undefined,
      expect.objectContaining({
        sink: expect.any(Object),
        interactionSink: expect.any(Object),
      })
    )
    expect(JSON.stringify(sessions.sendMessage.mock.calls[0])).not.toContain('event_1')
    expect(JSON.stringify(sessions.sendMessage.mock.calls[0])).not.toContain('message_1')

    const forwardedText = sessions.sendMessage.mock.calls[0][1]
    expect(forwardedText).not.toContain('event_1')
    expect(forwardedText).not.toContain('message_1')
    expect(forwardedText).not.toContain('chat_title_1')

    const options = sessions.sendMessage.mock.calls[0][3]
    expect(options.sink.finished).toEqual(expect.any(Function))
    options.sink.stream('session_1', { type: 'text_delta', text: '回复' } as any)
    await options.sink.finished('session_1')

    expect(client.sendText).toHaveBeenCalledWith({ chatId: 'chat_1', threadKey: 'thread_1', text: '回复' })
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_1', 'processed')
  })

  it('does not send duplicate Feishu events to the session twice', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
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
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    const handler = client.onMessage.mock.calls[0][0]
    const message = {
      eventId: 'event_1',
      messageId: 'message_1',
      chatId: 'chat_1',
      chatType: 'group',
      senderOpenId: 'user_1',
      text: '用户问题',
      threadKey: 'thread_1',
      raw: {},
    }
    await handler(message)
    await handler(message)

    expect(sessions.sendMessage).toHaveBeenCalledTimes(1)
    expect(history.completeExternalEvent).toHaveBeenCalledTimes(1)
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_1', 'processed')
  })
})
