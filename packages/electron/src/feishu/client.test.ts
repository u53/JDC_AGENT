import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const dispatchers: any[] = []
  const create = vi.fn().mockResolvedValue({ data: { message_id: 'sent_1' } })
  const patch = vi.fn().mockResolvedValue({ data: { message_id: 'updated_1' } })
  class EventDispatcher {
    handlers: Record<string, (event: any) => Promise<void>> = {}
    constructor() {
      dispatchers.push(this)
    }
    register(handlers: Record<string, (event: any) => Promise<void>>) {
      this.handlers = { ...this.handlers, ...handlers }
    }
  }
  class Client {
    im = { message: { create, patch } }
  }
  class WSClient {
    start = vi.fn()
    close = vi.fn()
  }
  return { dispatchers, create, patch, EventDispatcher, Client, WSClient }
})

vi.mock('@larksuiteoapi/node-sdk', () => ({
  EventDispatcher: mocks.EventDispatcher,
  Client: mocks.Client,
  WSClient: mocks.WSClient,
  LoggerLevel: { warn: 'warn' },
}))

import { createFeishuClient } from './client'

function binding() {
  return {
    id: 'binding_1',
    name: 'Project bot',
    enabled: true,
    appId: 'cli',
    appSecret: 'secret',
    projectName: 'Project',
    cwd: '/repo/project',
    permissionMode: 'standard' as const,
    allowedChatIds: [],
    allowedOpenIds: [],
    sessionStrategy: 'thread' as const,
    createdAt: 1,
    updatedAt: 1,
  }
}

function receiveEvent(text: string, messageId: string, threadId = 'thread_1') {
  return {
    event_id: `event_${messageId}`,
    sender: { sender_id: { open_id: 'user_1' } },
    message: {
      message_id: messageId,
      ...(threadId ? { thread_id: threadId } : {}),
      chat_id: 'chat_1',
      chat_type: 'group',
      message_type: 'text',
      content: JSON.stringify({ text }),
    },
  }
}

describe('createFeishuClient interactions', () => {
  it('resolves pending replies before forwarding messages to the bridge', async () => {
    const client = createFeishuClient(binding())
    const forwarded = vi.fn()
    client.onMessage(forwarded)

    const reply = client.waitForReply!({ chatId: 'chat_1', threadKey: 'thread_1', promptMessageId: 'prompt_1' })
    await mocks.dispatchers.at(-1).handlers['im.message.receive_v1'](receiveEvent('answer text', 'msg_1'))

    await expect(reply).resolves.toBe('answer text')
    expect(forwarded).not.toHaveBeenCalled()
  })

  it('uses chat id instead of each message id for non-threaded messages', async () => {
    const client = createFeishuClient(binding())
    const forwarded = vi.fn()
    client.onMessage(forwarded)

    await mocks.dispatchers.at(-1).handlers['im.message.receive_v1'](receiveEvent('first', 'msg_1', ''))
    await mocks.dispatchers.at(-1).handlers['im.message.receive_v1'](receiveEvent('second', 'msg_2', ''))

    expect(forwarded.mock.calls[0][0].threadKey).toBe('chat_1')
    expect(forwarded.mock.calls[1][0].threadKey).toBe('chat_1')
  })

  it('updates an existing status card through Feishu message patch API', async () => {
    const client = createFeishuClient(binding())

    await client.updateText!({ messageId: 'message_1', chatId: 'chat_1', threadKey: 'thread_1', text: '运行中\n当前：正在运行工具：文件操作' })

    expect(mocks.patch).toHaveBeenCalledWith({
      path: { message_id: 'message_1' },
      data: {
        content: JSON.stringify({
          config: { wide_screen_mode: true, update_multi: true },
          elements: [{ tag: 'div', text: { tag: 'lark_md', content: '运行中\n当前：正在运行工具：文件操作' } }],
        }),
      },
    })
  })

  it('sends Markdown as an interactive lark_md card', async () => {
    const client = createFeishuClient(binding())

    await client.sendMarkdown!({ chatId: 'chat_1', threadKey: 'thread_1', text: '**加粗**\n\n```ts\nconst x = 1\n```' })

    expect(mocks.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: expect.objectContaining({
        receive_id: 'chat_1',
        msg_type: 'interactive',
      }),
    })
    const content = JSON.parse(mocks.create.mock.calls.at(-1)[0].data.content)
    expect(content).toMatchObject({
      config: { wide_screen_mode: true, update_multi: true },
      elements: [{ tag: 'div', text: { tag: 'lark_md', content: '**加粗**\n\n```ts\nconst x = 1\n```' } }],
    })
  })
})
