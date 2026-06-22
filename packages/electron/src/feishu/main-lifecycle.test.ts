import { describe, expect, it, vi } from 'vitest'
import { createFeishuRuntime } from './bridge'

describe('Feishu lifecycle', () => {
  it('starts after session manager readiness and stops on shutdown', async () => {
    const bridge = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }
    const runtime = createFeishuRuntime({ bridge: bridge as any })

    await runtime.start()
    await runtime.stop()

    expect(bridge.start).toHaveBeenCalledTimes(1)
    expect(bridge.stop).toHaveBeenCalledTimes(1)
  })
})
