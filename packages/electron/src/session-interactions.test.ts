import { describe, expect, it, vi } from 'vitest'
import { createInteractionRouter } from './session-event-sink'

describe('session interaction routing', () => {
  it('prefers a Feishu interaction sink for the active external run', async () => {
    const ui = { requestPermission: vi.fn().mockResolvedValue(false) }
    const feishu = { requestPermission: vi.fn().mockResolvedValue(true) }
    const router = createInteractionRouter(ui as any)

    router.attach('session_1', 'feishu:binding_1:chat_1', feishu as any)
    const allowed = await router.requestPermission('session_1', { toolName: 'Bash', input: { command: 'pnpm test' } })

    expect(allowed).toBe(true)
    expect(feishu.requestPermission).toHaveBeenCalled()
    expect(ui.requestPermission).not.toHaveBeenCalled()
  })

  it('falls back to the UI interaction sink when no external sink is attached', async () => {
    const ui = { askUser: vi.fn().mockResolvedValue('answer from ui') }
    const router = createInteractionRouter(ui as any)

    const answer = await router.askUser('session_1', 'Continue?', ['yes', 'no'], false)

    expect(answer).toBe('answer from ui')
    expect(ui.askUser).toHaveBeenCalled()
  })
})
