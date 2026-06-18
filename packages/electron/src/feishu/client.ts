import { EventDispatcher, Client, LoggerLevel, WSClient } from '@larksuiteoapi/node-sdk'
import type { FeishuBinding, FeishuClientPort, FeishuInboundMessage, FeishuSendTextInput } from './types.js'

type FeishuMessageHandler = (message: FeishuInboundMessage) => Promise<void>

type FeishuReceiveEvent = {
  event_id?: string
  uuid?: string
  tenant_key?: string
  sender?: {
    sender_id?: {
      open_id?: string
    }
  }
  message?: {
    message_id?: string
    root_id?: string
    parent_id?: string
    thread_id?: string
    chat_id?: string
    chat_type?: string
    message_type?: string
    content?: string
  }
}

export function createFeishuClient(binding: FeishuBinding): FeishuClientPort & {
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: FeishuMessageHandler): void
} {
  const client = new Client({ appId: binding.appId, appSecret: binding.appSecret })
  const eventDispatcher = new EventDispatcher({
    verificationToken: binding.verificationToken,
    encryptKey: binding.encryptKey,
    loggerLevel: LoggerLevel.warn,
  })
  const wsClient = new WSClient({ appId: binding.appId, appSecret: binding.appSecret, loggerLevel: LoggerLevel.warn })

  let messageHandler: FeishuMessageHandler | null = null

  async function sendText(input: FeishuSendTextInput): Promise<{ messageId: string }> {
    const response = await (client as any).im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: input.chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: input.text }),
      },
    })
    const messageId = response?.data?.message_id ?? response?.data?.messageId ?? response?.message_id ?? ''
    return { messageId }
  }

  eventDispatcher.register({
    'im.message.receive_v1': async (event: FeishuReceiveEvent) => {
      const message = event.message
      if (!message?.chat_id || !message.message_id) return

      const target = {
        chatId: message.chat_id,
        threadKey: message.thread_id || message.root_id || message.parent_id || message.message_id,
      }

      if (message.message_type !== 'text') {
        await sendText({ ...target, text: 'Unsupported message type. Please send a text message.' })
        return
      }

      const text = parseTextContent(message.content)
      if (!text || !messageHandler) return

      await messageHandler({
        eventId: event.event_id || event.uuid || message.message_id,
        messageId: message.message_id,
        chatId: message.chat_id,
        chatType: message.chat_type === 'p2p' ? 'p2p' : 'group',
        senderOpenId: event.sender?.sender_id?.open_id ?? '',
        text,
        threadKey: target.threadKey,
        raw: event,
      })
    },
  } as any)

  return {
    sendText,
    onMessage(handler: FeishuMessageHandler): void {
      messageHandler = handler
    },
    async start(): Promise<void> {
      await (wsClient as any).start({ eventDispatcher })
    },
    async stop(): Promise<void> {
      ;(wsClient as any).close?.({ force: true })
    },
  }
}

function parseTextContent(content: string | undefined): string {
  if (!content) return ''
  try {
    const parsed = JSON.parse(content)
    return typeof parsed?.text === 'string' ? parsed.text : ''
  } catch {
    return ''
  }
}
