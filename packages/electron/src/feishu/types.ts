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
