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

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve())
}

function inboundMessage(eventId = 'event_1') {
  return {
    eventId,
    messageId: 'msg_1',
    chatId: 'chat_1',
    chatType: 'group',
    senderOpenId: 'user_1',
    text: 'hello',
    threadKey: 'thread_1',
    raw: {},
  }
}

const modelGroups = [{
  id: 'company-ds',
  name: '公司DS',
  protocol: 'openai-responses',
  baseUrl: 'https://models.example.com/v1',
  apiKey: 'sk-test',
  models: [
    { id: 'model_flash', name: 'deepseek-v4-flash', modelId: 'deepseek-v4-flash', contextWindow: 200000, maxTokens: 32000, compressAt: 0.9 },
    { id: 'model_pro', name: 'deepseek-v4-pro', modelId: 'deepseek-v4-pro', contextWindow: 200000, maxTokens: 32000, compressAt: 0.9 },
  ],
}, {
  id: 'jdc-open-ai',
  name: 'JDC OPEN AI',
  protocol: 'openai-responses',
  baseUrl: 'https://models.example.com/v1',
  apiKey: 'sk-test',
  models: [
    { id: 'model_gpt', name: 'GPT 5.5', modelId: 'gpt-5.5', contextWindow: 200000, maxTokens: 32000, compressAt: 0.9 },
  ],
}]

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
    await handler(inboundMessage('event_1'))
    await handler(inboundMessage('event_1'))

    expect(sessions.sendMessage).toHaveBeenCalledTimes(1)
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_1', 'processed')
  })

  it('keeps normal messages in one chat mapped to the same Feishu session when they are not replies', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
    }
    const mappings = new Map<string, { sessionId: string }>()
    const history = {
      beginExternalEvent: vi.fn().mockReturnValue({ status: 'accepted' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn((input: any) => mappings.get(`${input.chatId}:${input.threadKey}`) ?? null),
      upsertExternalConversation: vi.fn((input: any) => {
        const mapping = { sessionId: input.sessionId }
        mappings.set(`${input.chatId}:${input.threadKey}`, mapping)
        return mapping
      }),
    }
    const sessions = {
      createSession: vi.fn().mockReturnValueOnce('session_1').mockReturnValueOnce('session_2'),
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
    await handler({ ...inboundMessage('event_chat_1'), messageId: 'msg_1', text: 'first', threadKey: 'chat_1' })
    await handler({ ...inboundMessage('event_chat_2'), messageId: 'msg_2', text: 'second', threadKey: 'chat_1' })
    await flushMicrotasks()

    expect(sessions.createSession).toHaveBeenCalledWith('Project', '/repo/project', { permissionMode: 'standard' })
    expect(sessions.sendMessage).toHaveBeenNthCalledWith(1, 'session_1', 'first', undefined, expect.any(Object))
    expect(sessions.sendMessage).toHaveBeenNthCalledWith(2, 'session_1', 'second', undefined, expect.any(Object))
  })

  it('acknowledges inbound messages without waiting for the JDC run to finish', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
    }
    let finishRun!: () => void
    const runPromise = new Promise<void>((resolve) => { finishRun = resolve })
    const history = {
      beginExternalEvent: vi.fn().mockReturnValue({ status: 'accepted' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn(),
      sendMessage: vi.fn().mockReturnValue(runPromise),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    const handlerPromise = client.onMessage.mock.calls[0][0](inboundMessage('event_async'))
    let handlerResolved = false
    handlerPromise.then(() => { handlerResolved = true })
    await flushMicrotasks()

    try {
      expect(client.sendText).toHaveBeenCalledWith({ chatId: 'chat_1', threadKey: 'thread_1', text: '已收到，正在处理…' })
      expect(sessions.sendMessage).toHaveBeenCalledTimes(1)
      expect(handlerResolved).toBe(true)
      expect(history.completeExternalEvent).not.toHaveBeenCalled()
    } finally {
      finishRun()
      await handlerPromise
      await flushMicrotasks()
    }

    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_async', 'processed')
  })

  it('notifies Feishu and marks the event failed when the background run rejects', async () => {
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
      sendMessage: vi.fn().mockRejectedValue(new Error('provider failed with SECRET_TOKEN')),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0](inboundMessage('event_failed'))
    await flushMicrotasks()

    const sentText = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(sentText).toContain('已收到，正在处理…')
    expect(sentText).toContain('运行失败，请在 JDC 客户端查看详情。')
    expect(sentText).not.toContain('SECRET_TOKEN')
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_failed', 'failed')
  })

  it('fixes the Feishu permission mode when creating a new session', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
    }
    const history = {
      beginExternalEvent: vi.fn().mockReturnValue({ status: 'accepted' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn().mockReturnValue(null),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn().mockReturnValue('session_relaxed'),
      setPermissionMode: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
    const relaxedBinding = { ...binding(), permissionMode: 'relaxed' }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([relaxedBinding]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0](inboundMessage('event_new_relaxed_session'))
    await flushMicrotasks()

    expect(sessions.createSession).toHaveBeenCalledWith('Project', '/repo/project', { permissionMode: 'relaxed' })
    expect(history.upsertExternalConversation).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session_relaxed' }))
    expect(sessions.setPermissionMode).toHaveBeenCalledWith('session_relaxed', 'relaxed')
  })

  it('applies the Feishu binding permission mode before running a session message', async () => {
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
      setPermissionMode: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
    const relaxedBinding = { ...binding(), permissionMode: 'relaxed' }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([relaxedBinding]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0](inboundMessage('event_relaxed_permission'))
    await flushMicrotasks()

    expect(sessions.setPermissionMode).toHaveBeenCalledWith('session_1', 'relaxed')
    expect(sessions.setPermissionMode.mock.invocationCallOrder[0]).toBeLessThan(sessions.sendMessage.mock.invocationCallOrder[0])
    expect(sessions.sendMessage).toHaveBeenCalledWith('session_1', 'hello', undefined, expect.any(Object))
  })

  it('routes Feishu replies to pending AskUser prompts instead of starting a new model turn', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'prompt_1' }),
      waitForReply: vi.fn(),
    }
    const history = {
      beginExternalEvent: vi.fn().mockReturnValue({ status: 'accepted' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }),
      upsertExternalConversation: vi.fn(),
    }
    let askAnswer!: Promise<string>
    const sessions = {
      createSession: vi.fn(),
      sendMessage: vi.fn(async (_sessionId: string, _text: string, _images: unknown, options: any) => {
        askAnswer = options.interactionSink.askUser('Continue?', ['yes', 'no'], false)
      }),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    const handler = client.onMessage.mock.calls[0][0]
    await handler(inboundMessage('event_question'))
    await flushMicrotasks()

    await handler({ ...inboundMessage('event_answer'), text: 'yes' })

    await expect(askAnswer).resolves.toBe('yes')
    expect(sessions.sendMessage).toHaveBeenCalledTimes(1)
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_answer', 'processed')
  })

  it('routes approval replies to pending permission prompts', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'approval_1' }),
      sendApproval: vi.fn().mockResolvedValue({ requestId: 'approval_1' }),
      waitForApproval: vi.fn(),
    }
    const history = {
      beginExternalEvent: vi.fn().mockReturnValue({ status: 'accepted' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }),
      upsertExternalConversation: vi.fn(),
    }
    let approval!: Promise<boolean>
    const sessions = {
      createSession: vi.fn(),
      sendMessage: vi.fn(async (_sessionId: string, _text: string, _images: unknown, options: any) => {
        approval = options.interactionSink.requestPermission({ toolName: 'Bash', input: { command: 'git status' } })
      }),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    const handler = client.onMessage.mock.calls[0][0]
    await handler(inboundMessage('event_permission'))
    await flushMicrotasks()

    await handler({ ...inboundMessage('event_permission_reply'), text: '同意' })

    await expect(approval).resolves.toBe(true)
    expect(sessions.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('sends the final assistant message text from the session sink as a Markdown card', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
      sendMarkdown: vi.fn().mockResolvedValue({ messageId: 'markdown_1' }),
    }
    const history = {
      beginExternalEvent: vi.fn().mockReturnValue({ status: 'accepted' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn(),
      sendMessage: vi.fn(async (_sessionId: string, _text: string, _images: unknown, options: any) => {
        options.sink.messageComplete('session_1', {
          id: 'assistant_1',
          role: 'assistant',
          timestamp: Date.now(),
          content: [{ type: 'text', text: '**这是最终回复**' }],
        })
        await options.sink.finished('session_1')
      }),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0](inboundMessage('event_final_text'))
    await flushMicrotasks()

    expect(client.sendText).toHaveBeenCalledWith({ chatId: 'chat_1', threadKey: 'thread_1', text: '已收到，正在处理…' })
    expect(client.sendMarkdown).toHaveBeenCalledWith({ chatId: 'chat_1', threadKey: 'thread_1', text: '**这是最终回复**' })
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_final_text', 'processed')
  })

  it('marks the event failed when the session reports an error through the sink', async () => {
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
      sendMessage: vi.fn(async (_sessionId: string, _text: string, _images: unknown, options: any) => {
        await options.sink.error('session_1', new Error('model failed with SECRET_INTERNAL_TOKEN'))
      }),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0](inboundMessage('event_sink_error'))
    await flushMicrotasks()

    const sentText = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(sentText).toContain('运行失败，请在 JDC 客户端查看详情。')
    expect(sentText).not.toContain('SECRET_INTERNAL_TOKEN')
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_sink_error', 'failed')
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

  it('lists configured models for /model without forwarding to the model', async () => {
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
      setSessionModel: vi.fn(),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
      modelConfig: { getModelGroups: vi.fn().mockReturnValue(modelGroups) },
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0]({ ...inboundMessage('event_model_list'), text: '/model' })

    const replyText = client.sendText.mock.calls[0][0].text
    expect(replyText).toContain('可切换模型')
    expect(replyText).toContain('公司DS:deepseek-v4-flash')
    expect(replyText).toContain('公司DS:deepseek-v4-pro')
    expect(replyText).toContain('JDC OPEN AI:GPT 5.5')
    expect(sessions.setSessionModel).not.toHaveBeenCalled()
    expect(sessions.sendMessage).not.toHaveBeenCalled()
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_model_list', 'processed')
  })

  it('switches the current Feishu session model with /model group:model', async () => {
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
      setSessionModel: vi.fn(),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
      modelConfig: { getModelGroups: vi.fn().mockReturnValue(modelGroups) },
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0]({ ...inboundMessage('event_model_switch'), text: '/model 公司DS:deepseek-v4-flash' })

    expect(sessions.setSessionModel).toHaveBeenCalledWith('session_1', 'model_flash', { updateGlobal: false })
    expect(sessions.sendMessage).not.toHaveBeenCalled()
    expect(client.sendText).toHaveBeenCalledWith({ chatId: 'chat_1', threadKey: 'thread_1', text: '模型切换成功：公司DS:deepseek-v4-flash' })
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_model_switch', 'processed')
  })

  it('creates a Feishu session before switching models when no mapping exists', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
    }
    const history = {
      beginExternalEvent: vi.fn().mockReturnValue({ status: 'accepted' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn().mockReturnValue(null),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn().mockReturnValue('session_created'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      setSessionModel: vi.fn(),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
      modelConfig: { getModelGroups: vi.fn().mockReturnValue(modelGroups) },
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0]({ ...inboundMessage('event_model_new_session'), text: '/model 公司DS:deepseek-v4-pro' })

    expect(sessions.createSession).toHaveBeenCalledWith('Project', '/repo/project', { permissionMode: 'standard' })
    expect(history.upsertExternalConversation).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session_created', chatId: 'chat_1', threadKey: 'thread_1' }))
    expect(sessions.setSessionModel).toHaveBeenCalledWith('session_created', 'model_pro', { updateGlobal: false })
    expect(sessions.sendMessage).not.toHaveBeenCalled()
    expect(client.sendText).toHaveBeenCalledWith({ chatId: 'chat_1', threadKey: 'thread_1', text: '模型切换成功：公司DS:deepseek-v4-pro' })
  })

  it('replies with model switch failure when the requested model is not configured', async () => {
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
      setSessionModel: vi.fn(),
    }
    const bridge = new FeishuBridge({
      clientFactory: () => client as any,
      bindings: { getEnabledBindings: vi.fn().mockReturnValue([binding()]) } as any,
      history: history as any,
      sessions: sessions as any,
      modelConfig: { getModelGroups: vi.fn().mockReturnValue(modelGroups) },
    })

    await bridge.start()
    await client.onMessage.mock.calls[0][0]({ ...inboundMessage('event_model_missing'), text: '/model 公司DS:missing-model' })

    const replyText = client.sendText.mock.calls[0][0].text
    expect(replyText).toContain('模型切换失败：公司DS:missing-model')
    expect(replyText).toContain('模型不存在')
    expect(sessions.setSessionModel).not.toHaveBeenCalled()
    expect(sessions.sendMessage).not.toHaveBeenCalled()
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_model_missing', 'processed')
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
