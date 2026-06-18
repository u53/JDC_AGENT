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

  it('summarizes tool events without dumping full tool results or raw input', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.toolEvent?.('session_1', { type: 'start', toolName: 'Bash', input: { command: 'pnpm test --token SECRET_TOKEN', run_in_background: true, timeout: 1234 } } as any)
    sink.toolEvent?.('session_1', { type: 'complete', toolName: 'Bash', result: { content: 'short secret output' } } as any)
    sink.toolEvent?.('session_1', { type: 'complete', toolName: 'Read', result: { content: 'x'.repeat(10_000) } } as any)
    await sink.flushStatus()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('Bash')
    expect(text).toContain('Read')
    expect(text).toContain('command provided')
    expect(text).toContain('background: true')
    expect(text).toContain('timeout: 1234')
    expect(text).not.toContain('pnpm test')
    expect(text).not.toContain('SECRET_TOKEN')
    expect(text).not.toContain('short secret output')
    expect(text).not.toContain('x'.repeat(200))
    expect(text.length).toBeLessThan(1000)
  })

  it('redacts raw progress and error messages from tool status', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.toolEvent?.('session_1', { type: 'progress', toolName: 'Bash', message: 'stdout SECRET_PROGRESS_TOKEN file contents' } as any)
    sink.toolEvent?.('session_1', { type: 'error', toolName: 'Read', message: 'failed with SECRET_ERROR_TOKEN' } as any)
    await sink.flushStatus()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('Tool progress: Bash')
    expect(text).toContain('Tool failed: Read')
    expect(text).not.toContain('SECRET_PROGRESS_TOKEN')
    expect(text).not.toContain('SECRET_ERROR_TOKEN')
    expect(text).not.toContain('stdout')
    expect(text).not.toContain('file contents')
  })

  it('summarizes compaction status without raw skipped or failed details', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.stream('session_1', { type: 'compact_skipped', compactSkipped: { reason: 'SECRET_SKIP_TOKEN /Users/private/session.md' } } as any)
    sink.stream('session_1', { type: 'compact_failed', compactFailed: { message: 'SECRET_FAIL_MESSAGE raw model output', reason: 'SECRET_FAIL_REASON' } } as any)
    await sink.flushStatus()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('Compaction skipped.')
    expect(text).toContain('Compaction failed.')
    expect(text).not.toContain('SECRET_SKIP_TOKEN')
    expect(text).not.toContain('/Users/private/session.md')
    expect(text).not.toContain('SECRET_FAIL_MESSAGE')
    expect(text).not.toContain('raw model output')
    expect(text).not.toContain('SECRET_FAIL_REASON')
  })

  it('asks for permission through Feishu and resolves on approval', async () => {
    const client = {
      sendApproval: vi.fn().mockResolvedValue({ requestId: 'approval_1' }),
      waitForApproval: vi.fn().mockResolvedValue(true),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    const allowed = await sink.requestPermission?.({ toolName: 'Bash', input: { command: 'git status --token SECRET_PERMISSION_TOKEN', timeout: 5000 } })

    expect(allowed).toBe(true)
    expect(client.sendApproval).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'Bash' }))
    expect(client.sendApproval.mock.calls[0][0].summary).toContain('command provided')
    expect(client.sendApproval.mock.calls[0][0].summary).toContain('timeout: 5000')
    expect(client.sendApproval.mock.calls[0][0].summary).not.toContain('git status')
    expect(client.sendApproval.mock.calls[0][0].summary).not.toContain('SECRET_PERMISSION_TOKEN')
  })

  it('does not send question prompts when replies are unsupported', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'question_prompt_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    const result = await sink.askUser?.('Should I continue?', ['yes', 'no'])

    expect(result).toBe('')
    expect(client.sendText).not.toHaveBeenCalled()
  })

  it('does not send plan prompts when replies are unsupported', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'plan_prompt_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    const result = await sink.reviewPlan?.('plan.md', 'Plan content')

    expect(result).toEqual({ approved: false, feedback: 'No reply handler is available.' })
    expect(client.sendText).not.toHaveBeenCalled()
  })

  it('does not send plan content when requesting review replies', async () => {
    const client = {
      sendText: vi.fn().mockResolvedValue({ messageId: 'plan_prompt_1' }),
      waitForReply: vi.fn().mockResolvedValue('approved'),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    const result = await sink.reviewPlan?.('secret-plan.md', 'SECRET_PLAN_CONTENT\n/private/path')

    expect(result).toEqual({ approved: true })
    expect(client.sendText).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('secret-plan.md'),
    }))
    expect(client.sendText.mock.calls[0][0].text).not.toContain('SECRET_PLAN_CONTENT')
    expect(client.sendText.mock.calls[0][0].text).not.toContain('/private/path')
  })

  it('preserves buffered status when sending status fails', async () => {
    const client = {
      sendText: vi.fn()
        .mockRejectedValueOnce(new Error('network failed'))
        .mockResolvedValueOnce({ messageId: 'status_1' }),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.toolEvent?.('session_1', { type: 'progress', toolName: 'Bash', message: 'SECRET_STATUS_TOKEN' } as any)
    await expect(sink.flushStatus()).rejects.toThrow('network failed')
    await sink.flushStatus()

    expect(client.sendText).toHaveBeenCalledTimes(2)
    expect(client.sendText.mock.calls[1][0].text).toContain('Tool progress: Bash')
    expect(client.sendText.mock.calls[1][0].text).not.toContain('SECRET_STATUS_TOKEN')
  })

  it('splits long final replies and does not resend them on a second finish', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.stream('session_1', { type: 'text_delta', text: 'a'.repeat(3501) } as any)
    await sink.finished?.('session_1')
    await sink.finished?.('session_1')

    expect(client.sendText).toHaveBeenCalledTimes(2)
    expect(client.sendText.mock.calls[0][0].text).toHaveLength(3500)
    expect(client.sendText.mock.calls[1][0].text).toHaveLength(1)
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
