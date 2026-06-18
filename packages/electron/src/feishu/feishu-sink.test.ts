import { describe, expect, it, vi } from 'vitest'
import { FeishuSink } from './feishu-sink'

describe('FeishuSink', () => {
  it('buffers text deltas and sends a final reply', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1', threadKey: 'thread_1' })

    sink.stream('session_1', { type: 'text_delta', text: 'hello' } as any)
    sink.stream('session_1', { type: 'text_delta', text: ' world' } as any)
    await sink.finished?.('session_1')

    expect(client.sendText).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat_1',
      text: 'hello world',
    }))
  })

  it('summarizes tool events without dumping full tool results', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.toolEvent?.('session_1', { type: 'start', toolName: 'Bash', input: { command: 'pnpm test' } } as any)
    sink.toolEvent?.('session_1', { type: 'complete', toolName: 'Bash', result: { content: 'x'.repeat(10_000) } } as any)
    await sink.flushStatus()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('Bash')
    expect(text.length).toBeLessThan(1000)
  })
  it('asks for permission through Feishu and resolves on approval', async () => {
    const client = {
      sendApproval: vi.fn().mockResolvedValue({ requestId: 'approval_1' }),
      waitForApproval: vi.fn().mockResolvedValue(true),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    const allowed = await sink.requestPermission?.({ toolName: 'Bash', input: { command: 'git status' } })

    expect(allowed).toBe(true)
    expect(client.sendApproval).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'Bash' }))
  })

  it.each(['同意', '通过'])('approves localized plan review reply %s', async (reply) => {
    const client = {
      sendText: vi.fn().mockResolvedValue({ messageId: 'plan_prompt_1' }),
      waitForReply: vi.fn().mockResolvedValue(reply),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    const result = await sink.reviewPlan?.('plan.md', 'Plan content')

    expect(result).toEqual({ approved: true })
    expect(client.waitForReply).toHaveBeenCalledWith(expect.objectContaining({ promptMessageId: 'plan_prompt_1' }))
  })
})
