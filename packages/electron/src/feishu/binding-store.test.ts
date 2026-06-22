import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, any>,
}))

vi.mock('@jdcagnet/core', () => ({
  loadAppConfig: () => mocks.config,
  saveAppConfig: (patch: Record<string, any>) => {
    mocks.config = { ...mocks.config, ...patch }
  },
}))

describe('FeishuBindingStore', () => {
  beforeEach(() => {
    mocks.config = {}
  })

  it('adds multiple bot bindings and preserves one cwd per binding', async () => {
    const { FeishuBindingStore } = await import('./binding-store')
    const store = new FeishuBindingStore()

    const first = store.addBinding({
      name: 'HR bot',
      appId: 'cli_hr',
      appSecret: 'secret_hr',
      projectName: 'hr_demo',
      cwd: '/repo/hr_demo',
      sessionStrategy: 'thread',
      enabled: true,
    })
    const second = store.addBinding({
      name: 'Ops bot',
      appId: 'cli_ops',
      appSecret: 'secret_ops',
      projectName: 'ops',
      cwd: '/repo/ops',
      sessionStrategy: 'chat',
      enabled: false,
    })

    expect(store.listBindings().map((item: any) => [item.id, item.cwd])).toEqual([
      [first.id, '/repo/hr_demo'],
      [second.id, '/repo/ops'],
    ])
  })

  it('updates and deletes bindings by id', async () => {
    const { FeishuBindingStore } = await import('./binding-store')
    const store = new FeishuBindingStore()
    const binding = store.addBinding({
      name: 'HR bot',
      appId: 'cli_hr',
      appSecret: 'secret_hr',
      projectName: 'hr_demo',
      cwd: '/repo/hr_demo',
      sessionStrategy: 'thread',
      enabled: true,
    })

    store.updateBinding(binding.id, { enabled: false, cwd: '/repo/hr_v2', projectName: 'hr_v2' })
    expect(store.getBinding(binding.id)).toMatchObject({ enabled: false, cwd: '/repo/hr_v2' })

    store.deleteBinding(binding.id)
    expect(store.listBindings()).toEqual([])
  })

  it('applies safe defaults for omitted binding fields', async () => {
    const { FeishuBindingStore } = await import('./binding-store')
    const store = new FeishuBindingStore()

    const binding = store.addBinding({
      name: 'HR bot',
      appId: 'cli_hr',
      appSecret: 'secret_hr',
      projectName: 'hr_demo',
      cwd: '/repo/hr_demo',
      enabled: true,
    })

    expect(binding).toMatchObject({
      permissionMode: 'standard',
      allowedChatIds: [],
      allowedOpenIds: [],
      sessionStrategy: 'thread',
    })
  })

  it('throws when updating or deleting an unknown binding', async () => {
    const { FeishuBindingStore } = await import('./binding-store')
    const store = new FeishuBindingStore()

    expect(() => store.updateBinding('missing', { enabled: false })).toThrow('Feishu binding not found: missing')
    expect(() => store.deleteBinding('missing')).toThrow('Feishu binding not found: missing')
  })

  it('rejects invalid create and update input', async () => {
    const { FeishuBindingStore } = await import('./binding-store')
    const store = new FeishuBindingStore()

    expect(() => store.addBinding({
      name: 'HR bot',
      appId: ' ',
      appSecret: 'secret_hr',
      projectName: 'hr_demo',
      cwd: '/repo/hr_demo',
      enabled: true,
    })).toThrow('Feishu binding appId is required')

    const binding = store.addBinding({
      name: 'HR bot',
      appId: 'cli_hr',
      appSecret: 'secret_hr',
      projectName: 'hr_demo',
      cwd: '/repo/hr_demo',
      enabled: true,
    })

    expect(() => store.updateBinding(binding.id, { cwd: ' ' })).toThrow('Feishu binding cwd is required')
    expect(() => store.updateBinding(binding.id, { permissionMode: 'open' as any })).toThrow('Feishu binding permissionMode must be standard, relaxed, or strict')
  })
})
