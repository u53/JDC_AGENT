export type FeishuPermissionMode = 'standard' | 'relaxed' | 'strict'
export type FeishuSessionStrategy = 'thread' | 'chat'

export interface FeishuBinding {
  id: string
  name: string
  enabled: boolean
  appId: string
  appSecret: string
  tenantKey?: string
  verificationToken?: string
  encryptKey?: string
  projectName: string
  cwd: string
  defaultModelId?: string
  permissionMode: FeishuPermissionMode
  allowedChatIds: string[]
  allowedOpenIds: string[]
  sessionStrategy: FeishuSessionStrategy
  createdAt: number
  updatedAt: number
}

export type FeishuBindingInput = Omit<FeishuBinding, 'id' | 'createdAt' | 'updatedAt' | 'permissionMode' | 'allowedChatIds' | 'allowedOpenIds'> & {
  permissionMode?: FeishuPermissionMode
  allowedChatIds?: string[]
  allowedOpenIds?: string[]
}

export interface FeishuInboundMessage {
  eventId: string
  messageId: string
  chatId: string
  chatType: 'group' | 'p2p'
  senderOpenId: string
  text: string
  threadKey?: string
  raw: unknown
}

export type FeishuCommand = 'new' | 'status' | 'stop' | 'compact' | 'session'

export type FeishuResolvedConversation =
  | { kind: 'message'; sessionId: string; text: string }
  | { kind: 'command'; command: FeishuCommand; sessionId?: string; text: string }
  | { kind: 'unauthorized'; reason: string }
