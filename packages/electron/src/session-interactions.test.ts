import { describe, expect, it, vi } from 'vitest'
import { createInteractionRouter } from './session-event-sink'

describe('session interaction routing', () => {
  it('prefers an external interaction sink for the active external run', async () => {
    const ui = { requestPermission: vi.fn().mockResolvedValue(false) }
    const external = { requestPermission: vi.fn().mockResolvedValue(true) }
    const router = createInteractionRouter(ui as any)

    router.attach('session_1', 'external:binding_1:chat_1', external as any)
    const allowed = await router.requestPermission('session_1', { toolName: 'Bash', input: { command: 'pnpm test' } })

    expect(allowed).toBe(true)
    expect(external.requestPermission).toHaveBeenCalled()
    expect(ui.requestPermission).not.toHaveBeenCalled()
  })

  it('falls back to the UI interaction sink when no external sink is attached', async () => {
    const ui = { askUser: vi.fn().mockResolvedValue('answer from ui') }
    const router = createInteractionRouter(ui as any)

    const answer = await router.askUser('session_1', 'Continue?', ['yes', 'no'], false)

    expect(answer).toBe('answer from ui')
    expect(ui.askUser).toHaveBeenCalled()
  })

  it('detach restores UI fallback', async () => {
    const ui = { requestPermission: vi.fn().mockResolvedValue(false) }
    const external = { requestPermission: vi.fn().mockResolvedValue(true) }
    const router = createInteractionRouter(ui as any)

    const detach = router.attach('session_1', 'external:run_1', external as any)
    detach()
    const allowed = await router.requestPermission('session_1', { toolName: 'Bash', input: {} })

    expect(allowed).toBe(false)
    expect(ui.requestPermission).toHaveBeenCalled()
    expect(external.requestPermission).not.toHaveBeenCalled()
  })

  it('does not route interactions across sessions', async () => {
    const ui = { requestPermission: vi.fn().mockResolvedValue(false) }
    const external = { requestPermission: vi.fn().mockResolvedValue(true) }
    const router = createInteractionRouter(ui as any)

    router.attach('session_a', 'external:run_1', external as any)
    const allowed = await router.requestPermission('session_b', { toolName: 'Bash', input: {} })

    expect(allowed).toBe(false)
    expect(ui.requestPermission).toHaveBeenCalled()
    expect(external.requestPermission).not.toHaveBeenCalled()
  })

  it('falls back to UI when the external sink does not implement askUser', async () => {
    const ui = { askUser: vi.fn().mockResolvedValue('answer from ui') }
    const external = { requestPermission: vi.fn().mockResolvedValue(true) }
    const router = createInteractionRouter(ui as any)

    router.attach('session_1', 'external:run_1', external as any)
    const answer = await router.askUser('session_1', 'Continue?', ['yes', 'no'], false)

    expect(answer).toBe('answer from ui')
    expect(ui.askUser).toHaveBeenCalled()
  })

  it('uses the later attached sink when no run key is provided', async () => {
    const ui = { requestPermission: vi.fn().mockResolvedValue(false) }
    const first = { requestPermission: vi.fn().mockResolvedValue(false) }
    const second = { requestPermission: vi.fn().mockResolvedValue(true) }
    const router = createInteractionRouter(ui as any)

    router.attach('session_1', 'external:run_1', first as any)
    router.attach('session_1', 'external:run_2', second as any)
    const allowed = await router.requestPermission('session_1', { toolName: 'Bash', input: {} })

    expect(allowed).toBe(true)
    expect(second.requestPermission).toHaveBeenCalled()
    expect(first.requestPermission).not.toHaveBeenCalled()
    expect(ui.requestPermission).not.toHaveBeenCalled()
  })

  it('stale detach does not remove a newer sink attached with the same key', async () => {
    const ui = { requestPermission: vi.fn().mockResolvedValue(false) }
    const first = { requestPermission: vi.fn().mockResolvedValue(false) }
    const second = { requestPermission: vi.fn().mockResolvedValue(true) }
    const router = createInteractionRouter(ui as any)

    const detachFirst = router.attach('session_1', 'external:run_1', first as any)
    router.attach('session_1', 'external:run_1', second as any)
    detachFirst()
    const allowed = await router.requestPermission('session_1', { toolName: 'Bash', input: {} }, 'external:run_1')

    expect(allowed).toBe(true)
    expect(second.requestPermission).toHaveBeenCalled()
    expect(first.requestPermission).not.toHaveBeenCalled()
    expect(ui.requestPermission).not.toHaveBeenCalled()
  })

  it('uses an exact run key even when a newer sink was attached later', async () => {
    const ui = { requestPermission: vi.fn().mockResolvedValue(false) }
    const first = { requestPermission: vi.fn().mockResolvedValue(true) }
    const second = { requestPermission: vi.fn().mockResolvedValue(false) }
    const router = createInteractionRouter(ui as any)

    router.attach('session_1', 'external:run_1', first as any)
    router.attach('session_1', 'external:run_2', second as any)
    const allowed = await router.requestPermission('session_1', { toolName: 'Bash', input: {} }, 'external:run_1')

    expect(allowed).toBe(true)
    expect(first.requestPermission).toHaveBeenCalled()
    expect(second.requestPermission).not.toHaveBeenCalled()
    expect(ui.requestPermission).not.toHaveBeenCalled()
  })

  it('keeps method this binding when routing to class-based external sinks', async () => {
    class ExternalSink {
      private readonly allowed = true

      async requestPermission() {
        return this.allowed
      }
    }
    const ui = { requestPermission: vi.fn().mockResolvedValue(false) }
    const router = createInteractionRouter(ui as any)

    router.attach('session_1', 'external:run_1', new ExternalSink() as any)
    const allowed = await router.requestPermission('session_1', { toolName: 'Bash', input: {} }, 'external:run_1')

    expect(allowed).toBe(true)
    expect(ui.requestPermission).not.toHaveBeenCalled()
  })
})
