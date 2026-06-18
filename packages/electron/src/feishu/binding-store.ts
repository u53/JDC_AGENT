import { randomUUID } from 'node:crypto'
import { loadAppConfig, saveAppConfig } from '@jdcagnet/core'
import type { FeishuBinding, FeishuBindingInput, FeishuPermissionMode, FeishuSessionStrategy } from './types.js'

type FeishuConfig = {
  bindings?: FeishuBinding[]
  [key: string]: unknown
}

type AppConfigWithFeishu = {
  feishu?: FeishuConfig
  [key: string]: unknown
}

function isPermissionMode(value: unknown): value is FeishuPermissionMode {
  return value === 'standard' || value === 'relaxed' || value === 'strict'
}

function isSessionStrategy(value: unknown): value is FeishuSessionStrategy {
  return value === 'thread' || value === 'chat'
}

function cloneBinding(binding: FeishuBinding): FeishuBinding {
  return {
    ...binding,
    allowedChatIds: [...binding.allowedChatIds],
    allowedOpenIds: [...binding.allowedOpenIds],
  }
}

function normalizeBinding(binding: Partial<FeishuBinding>): FeishuBinding {
  const now = Date.now()
  return {
    id: typeof binding.id === 'string' ? binding.id : randomUUID(),
    name: typeof binding.name === 'string' ? binding.name : '',
    enabled: Boolean(binding.enabled),
    appId: typeof binding.appId === 'string' ? binding.appId : '',
    appSecret: typeof binding.appSecret === 'string' ? binding.appSecret : '',
    tenantKey: binding.tenantKey,
    verificationToken: binding.verificationToken,
    encryptKey: binding.encryptKey,
    projectName: typeof binding.projectName === 'string' ? binding.projectName : '',
    cwd: typeof binding.cwd === 'string' ? binding.cwd : '',
    defaultModelId: binding.defaultModelId,
    permissionMode: isPermissionMode(binding.permissionMode) ? binding.permissionMode : 'standard',
    allowedChatIds: Array.isArray(binding.allowedChatIds) ? [...binding.allowedChatIds] : [],
    allowedOpenIds: Array.isArray(binding.allowedOpenIds) ? [...binding.allowedOpenIds] : [],
    sessionStrategy: isSessionStrategy(binding.sessionStrategy) ? binding.sessionStrategy : 'thread',
    createdAt: typeof binding.createdAt === 'number' ? binding.createdAt : now,
    updatedAt: typeof binding.updatedAt === 'number' ? binding.updatedAt : now,
  }
}

export class FeishuBindingStore {
  listBindings(): FeishuBinding[] {
    return this.readBindings().map(cloneBinding)
  }

  getBinding(id: string): FeishuBinding | null {
    const binding = this.readBindings().find((item) => item.id === id)
    return binding ? cloneBinding(binding) : null
  }

  getEnabledBindings(): FeishuBinding[] {
    return this.readBindings().filter((binding) => binding.enabled).map(cloneBinding)
  }

  addBinding(input: FeishuBindingInput): FeishuBinding {
    const now = Date.now()
    const binding = normalizeBinding({
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    const bindings = [...this.readBindings(), binding]
    this.writeBindings(bindings)
    return cloneBinding(binding)
  }

  updateBinding(id: string, patch: Partial<FeishuBindingInput>): FeishuBinding {
    const bindings = this.readBindings()
    const index = bindings.findIndex((binding) => binding.id === id)
    if (index === -1) {
      throw new Error(`Feishu binding not found: ${id}`)
    }

    const updated = normalizeBinding({
      ...bindings[index],
      ...patch,
      id,
      createdAt: bindings[index].createdAt,
      updatedAt: Date.now(),
    })
    const nextBindings = [...bindings]
    nextBindings[index] = updated
    this.writeBindings(nextBindings)
    return cloneBinding(updated)
  }

  deleteBinding(id: string): void {
    const bindings = this.readBindings().filter((binding) => binding.id !== id)
    this.writeBindings(bindings)
  }

  private readBindings(): FeishuBinding[] {
    const config = loadAppConfig() as AppConfigWithFeishu
    const bindings = config.feishu?.bindings
    if (!Array.isArray(bindings)) return []
    return bindings.map((binding) => normalizeBinding(binding))
  }

  private writeBindings(bindings: FeishuBinding[]): void {
    const config = loadAppConfig() as AppConfigWithFeishu
    saveAppConfig({
      feishu: {
        ...(config.feishu ?? {}),
        bindings: bindings.map(cloneBinding),
      },
    })
  }
}
