import { EventDispatcher, Client, LoggerLevel, WSClient } from '@larksuiteoapi/node-sdk'
import type { FeishuApprovalInput, FeishuBinding, FeishuClientPort, FeishuInboundMessage, FeishuSendMarkdownInput, FeishuSendTextInput } from './types.js'

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

type PendingReply = {
  chatId: string
  threadKey?: string
  resolve: (reply: string) => void
  timeout: ReturnType<typeof setTimeout>
}

type PendingApproval = {
  requestId: string
  resolve: (approved: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

const interactionTimeoutMs = 30 * 60 * 1000

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

  const pendingReplies: PendingReply[] = []
  const pendingApprovals = new Map<string, PendingApproval>()
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

  async function sendMarkdown(input: FeishuSendMarkdownInput): Promise<{ messageId: string }> {
    const response = await (client as any).im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: input.chatId,
        msg_type: 'interactive',
        content: JSON.stringify({
          config: { wide_screen_mode: true },
          elements: [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: input.text,
              },
            },
          ],
        }),
      },
    })
    const messageId = response?.data?.message_id ?? response?.data?.messageId ?? response?.message_id ?? ''
    return { messageId }
  }

  async function sendApproval(input: FeishuApprovalInput): Promise<{ requestId: string }> {
    const message = await sendText({
      chatId: input.chatId,
      threadKey: input.threadKey,
      text: `需要审批工具: ${input.toolName}\n${input.summary}\n回复“同意/允许/approve/yes”批准，回复“拒绝/deny/no”拒绝。`,
    })
    return { requestId: message.messageId }
  }

  function waitForReply(input: { chatId: string; threadKey?: string; promptMessageId: string }): Promise<string> {
    return new Promise((resolve) => {
      const pending: PendingReply = {
        chatId: input.chatId,
        threadKey: input.threadKey,
        resolve,
        timeout: setTimeout(() => {
          removePendingReply(pending)
          resolve('')
        }, interactionTimeoutMs),
      }
      pendingReplies.push(pending)
    })
  }

  function waitForApproval(requestId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const pending: PendingApproval = {
        requestId,
        resolve,
        timeout: setTimeout(() => {
          pendingApprovals.delete(requestId)
          resolve(false)
        }, interactionTimeoutMs),
      }
      pendingApprovals.set(requestId, pending)
    })
  }

  function resolvePendingInteraction(message: { chatId: string; threadKey?: string; text: string }): boolean {
    const approval = Array.from(pendingApprovals.values())[0]
    if (approval) {
      clearTimeout(approval.timeout)
      pendingApprovals.delete(approval.requestId)
      approval.resolve(parseApprovalReply(message.text))
      return true
    }

    const reply = pendingReplies.find((item) => item.chatId === message.chatId && (!item.threadKey || !message.threadKey || item.threadKey === message.threadKey))
    if (!reply) return false
    removePendingReply(reply)
    reply.resolve(message.text.trim())
    return true
  }

  function removePendingReply(pending: PendingReply): void {
    clearTimeout(pending.timeout)
    const index = pendingReplies.indexOf(pending)
    if (index !== -1) pendingReplies.splice(index, 1)
  }

  function clearPendingInteractions(): void {
    for (const reply of [...pendingReplies]) {
      removePendingReply(reply)
      reply.resolve('')
    }
    for (const approval of pendingApprovals.values()) {
      clearTimeout(approval.timeout)
      approval.resolve(false)
    }
    pendingApprovals.clear()
  }

  eventDispatcher.register({
    'im.message.receive_v1': async (event: FeishuReceiveEvent) => {
      const message = event.message
      if (!message?.chat_id || !message.message_id) return

      const target = {
        chatId: message.chat_id,
        threadKey: message.thread_id || message.root_id || message.parent_id || message.chat_id,
      }

      if (message.message_type !== 'text') {
        await sendText({ ...target, text: 'Unsupported message type. Please send a text message.' })
        return
      }

      const text = parseTextContent(message.content)
      if (!text) return
      if (resolvePendingInteraction({ ...target, text })) return
      if (!messageHandler) return

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
    sendMarkdown,
    sendApproval,
    waitForReply,
    waitForApproval,
    onMessage(handler: FeishuMessageHandler): void {
      messageHandler = handler
    },
    async start(): Promise<void> {
      await (wsClient as any).start({ eventDispatcher })
    },
    async stop(): Promise<void> {
      clearPendingInteractions()
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

function parseApprovalReply(text: string): boolean {
  const trimmed = text.trim()
  if (/^(?:同意|允许|通过|yes|y|approve|approved|allow)$/i.test(trimmed)) return true
  if (/^(?:拒绝|不允许|否|no|n|deny|denied|reject)$/i.test(trimmed)) return false
  return false
}
