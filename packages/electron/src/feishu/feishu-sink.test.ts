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

  it('uses Markdown cards for final assistant replies when supported', async () => {
    const client = {
      sendText: vi.fn().mockResolvedValue({ messageId: 'text_1' }),
      sendMarkdown: vi.fn().mockResolvedValue({ messageId: 'markdown_1' }),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1', threadKey: 'thread_1' })

    sink.messageComplete?.('session_1', {
      id: 'assistant_1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [{ type: 'text', text: '**结论**\n\n```ts\nconst ok = true\n```' }],
    } as any)
    await sink.finished?.('session_1')

    expect(client.sendMarkdown).toHaveBeenCalledWith({
      chatId: 'chat_1',
      threadKey: 'thread_1',
      text: '**结论**\n\n```ts\nconst ok = true\n```',
    })
    expect(client.sendText).not.toHaveBeenCalled()
  })

  it('falls back to plain text when Markdown card sending fails', async () => {
    const client = {
      sendText: vi.fn().mockResolvedValue({ messageId: 'text_1' }),
      sendMarkdown: vi.fn().mockRejectedValue(new Error('card failed')),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.stream('session_1', { type: 'text_delta', text: '**retry me**' } as any)
    await sink.finished?.('session_1')

    expect(client.sendMarkdown).toHaveBeenCalledWith(expect.objectContaining({ text: '**retry me**' }))
    expect(client.sendText).toHaveBeenCalledWith({ chatId: 'chat_1', text: '**retry me**' })
  })

  it('uses final assistant message text when stream deltas are unavailable', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.messageComplete?.('session_1', {
      id: 'assistant_1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [
        { type: 'text', text: '最终正文' },
        { type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: 'a.ts' } },
      ],
    } as any)
    await sink.finished?.('session_1')

    expect(client.sendText).toHaveBeenCalledWith(expect.objectContaining({ text: '最终正文' }))
  })

  it('does not duplicate the final assistant reply when text deltas already captured it', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.stream('session_1', { type: 'text_delta', text: '最终正文' } as any)
    sink.messageComplete?.('session_1', {
      id: 'assistant_1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [{ type: 'text', text: '最终正文' }],
    } as any)
    await sink.finished?.('session_1')

    expect(client.sendText).toHaveBeenCalledTimes(1)
    expect(client.sendText).toHaveBeenCalledWith(expect.objectContaining({ text: '最终正文' }))
  })

  it('summarizes tool events without dumping full tool results or raw input', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.toolEvent?.('session_1', { type: 'start', toolName: 'Bash', input: { command: 'pnpm test --token SECRET_TOKEN', run_in_background: true, timeout: 1234 } } as any)
    sink.toolEvent?.('session_1', { type: 'complete', toolName: 'Bash', result: { content: 'short secret output' } } as any)
    sink.toolEvent?.('session_1', { type: 'complete', toolName: 'Read', result: { content: 'x'.repeat(10_000) } } as any)
    await sink.flushStatus()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('正在运行工具')
    expect(text).toContain('工具运行完成')
    expect(text).toContain('命令执行')
    expect(text).toContain('文件操作')
    expect(text).not.toContain('Bash')
    expect(text).not.toContain('Read')
    expect(text).not.toContain('command provided')
    expect(text).not.toContain('background: true')
    expect(text).not.toContain('timeout: 1234')
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
    expect(text).toContain('正在运行工具')
    expect(text).toContain('工具运行失败')
    expect(text).not.toContain('Bash')
    expect(text).not.toContain('Read')
    expect(text).not.toContain('Tool progress')
    expect(text).not.toContain('Tool failed')
    expect(text).not.toContain('SECRET_PROGRESS_TOKEN')
    expect(text).not.toContain('SECRET_ERROR_TOKEN')
    expect(text).not.toContain('stdout')
    expect(text).not.toContain('file contents')
  })

  it('uses generic status wording for unknown tools instead of a processing label', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'status_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.toolEvent?.('session_1', { type: 'start', toolName: 'UnknownInternalTool', input: { secret: 'SECRET_TASK' } } as any)
    sink.toolEvent?.('session_1', { type: 'complete', toolName: 'UnknownInternalTool', result: { content: 'SECRET_RESULT' } } as any)
    await sink.drainPendingSends()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('正在处理')
    expect(text).toContain('处理步骤完成。')
    expect(text).not.toContain('正在运行工具：处理中')
    expect(text).not.toContain('工具运行完成：处理中')
    expect(text).not.toContain('UnknownInternalTool')
    expect(text).not.toContain('SECRET_TASK')
    expect(text).not.toContain('SECRET_RESULT')
  })

  it('notifies Feishu before compaction and reports completion stats in Chinese', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.stream('session_1', { type: 'compact_start' } as any)
    sink.stream('session_1', { type: 'compact_progress', text: 'SECRET_PROGRESS_TOKEN' } as any)
    sink.stream('session_1', {
      type: 'compact_complete',
      compactInfo: { originalCount: 18, keptCount: 4, summarizedCount: 14, memoriesExtracted: 3 },
    } as any)
    await sink.flushStatus()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('正在压缩上下文，可能需要几分钟，请稍等…')
    expect(text).toContain('上下文压缩完成：原始 18 条，保留 4 条，压缩 14 条，提取记忆 3 条。')
    expect(text).not.toContain('Compaction started')
    expect(text).not.toContain('Compaction complete')
    expect(text).not.toContain('SECRET_PROGRESS_TOKEN')
    expect(text).not.toContain('Compaction in progress')
  })

  it('summarizes compaction skipped and failed states safely in Chinese', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.stream('session_1', { type: 'compact_skipped', compactSkipped: { reason: 'too_short', messageCount: 2 } } as any)
    sink.stream('session_1', { type: 'compact_failed', compactFailed: { reason: 'stream_error', message: 'SECRET_FAIL_MESSAGE raw model output' } } as any)
    await sink.flushStatus()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('本次无需压缩上下文。')
    expect(text).toContain('上下文压缩失败，请在 JDC 客户端查看详情。')
    expect(text).not.toContain('Compaction skipped')
    expect(text).not.toContain('Compaction failed')
    expect(text).not.toContain('too_short')
    expect(text).not.toContain('stream_error')
    expect(text).not.toContain('SECRET_FAIL_MESSAGE')
    expect(text).not.toContain('raw model output')
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

  it('sends an AskUser prompt with options and waits for Feishu reply', async () => {
    const client = {
      sendText: vi.fn().mockResolvedValue({ messageId: 'question_prompt_1' }),
      waitForReply: vi.fn().mockResolvedValue('2'),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1', threadKey: 'thread_1' })

    const result = await sink.askUser?.('Pick one?', ['A', 'B'], false)

    expect(result).toBe('2')
    expect(client.sendText).toHaveBeenCalledWith({
      chatId: 'chat_1',
      threadKey: 'thread_1',
      text: expect.stringContaining('Pick one?'),
    })
    expect(client.sendText.mock.calls[0][0].text).toContain('1. A')
    expect(client.sendText.mock.calls[0][0].text).toContain('2. B')
    expect(client.waitForReply).toHaveBeenCalledWith({ chatId: 'chat_1', threadKey: 'thread_1', promptMessageId: 'question_prompt_1' })
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
    expect(client.sendText.mock.calls[1][0].text).toContain('正在运行工具')
    expect(client.sendText.mock.calls[1][0].text).not.toContain('SECRET_STATUS_TOKEN')
  })

  it('preserves final reply text when sending final reply fails', async () => {
    const client = {
      sendText: vi.fn()
        .mockRejectedValueOnce(new Error('network failed'))
        .mockResolvedValueOnce({ messageId: 'reply_1' }),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.stream('session_1', { type: 'text_delta', text: 'retry me' } as any)
    await expect(sink.finished?.('session_1')).rejects.toThrow('network failed')
    await sink.finished?.('session_1')

    expect(client.sendText).toHaveBeenCalledTimes(2)
    expect(client.sendText.mock.calls[0][0].text).toBe('retry me')
    expect(client.sendText.mock.calls[1][0].text).toBe('retry me')
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

  it('sends safe runtime progress immediately', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'status_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.toolEvent?.('session_1', { type: 'start', toolName: 'Bash', input: { command: 'pnpm test --token SECRET_TOKEN', timeout: 1234 } } as any)
    sink.retrying?.('session_1', { attempt: 1, maxRetries: 3, error: 'SECRET_RETRY_TOKEN', delayMs: 1000, category: 'rate_limit' })
    sink.agentProgress?.('session_1', 'agent_1', { status: 'running', message: 'SECRET_AGENT_PROGRESS' })
    sink.agentComplete?.('session_1', 'agent_1', { status: 'completed', result: 'SECRET_AGENT_RESULT' })
    await sink.drainPendingSends()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('正在运行工具')
    expect(text).not.toContain('Bash')
    expect(text).not.toContain('Tool started')
    expect(text).not.toContain('timeout: 1234')
    expect(text).toContain('Retrying request 1/3.')
    expect(text).toContain('Agent progress: running')
    expect(text).toContain('Agent completed.')
    expect(text).not.toContain('pnpm test')
    expect(text).not.toContain('SECRET_TOKEN')
    expect(text).not.toContain('SECRET_RETRY_TOKEN')
    expect(text).not.toContain('SECRET_AGENT_PROGRESS')
    expect(text).not.toContain('SECRET_AGENT_RESULT')
  })

  it('sends tool status before one consolidated final reply for Feishu', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.toolEvent?.('session_1', { type: 'start', toolName: 'Read', input: { file_path: 'a.ts' } } as any)
    sink.messageComplete?.('session_1', {
      id: 'assistant_1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [{ type: 'text', text: '我先看一下。' }],
    } as any)
    sink.toolEvent?.('session_1', { type: 'complete', toolName: 'Read', result: { content: 'SECRET_FILE_CONTENT' } } as any)
    sink.messageComplete?.('session_1', {
      id: 'assistant_2',
      role: 'assistant',
      timestamp: Date.now(),
      content: [{ type: 'text', text: '读取完成。' }],
    } as any)
    await sink.finished?.('session_1')

    expect(client.sendText).toHaveBeenCalledTimes(2)
    expect(client.sendText.mock.calls[0][0].text).toContain('正在运行工具：文件操作')
    expect(client.sendText.mock.calls[0][0].text).toContain('工具运行完成：文件操作')
    expect(client.sendText.mock.calls[0][0].text).not.toContain('SECRET_FILE_CONTENT')
    expect(client.sendText.mock.calls[1][0].text).toBe('我先看一下。\n\n读取完成。')
  })

  it('sends safe runtime errors to Feishu', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'error_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    await sink.error?.('session_1', new Error('provider failed with SECRET_ERROR_TOKEN'))

    expect(client.sendText).toHaveBeenCalledWith({ chatId: 'chat_1', text: '运行失败，请在 JDC 客户端查看详情。' })
    expect(client.sendText.mock.calls[0][0].text).not.toContain('SECRET_ERROR_TOKEN')
  })

  it('turns Feishu plan rejection replies into plan feedback', async () => {
    const client = {
      sendText: vi.fn().mockResolvedValue({ messageId: 'plan_prompt_1' }),
      waitForReply: vi.fn().mockResolvedValue('拒绝: 先补测试'),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    const result = await sink.reviewPlan?.('plan.md', 'SECRET_PLAN_CONTENT')

    expect(result).toEqual({ approved: false, feedback: '先补测试' })
    expect(client.sendText.mock.calls[0][0].text).toContain('plan.md')
    expect(client.sendText.mock.calls[0][0].text).not.toContain('SECRET_PLAN_CONTENT')
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
