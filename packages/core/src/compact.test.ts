import { describe, expect, it } from 'vitest'
import { compactMessages } from './compact.js'
import type { ModelProvider } from './model-provider.js'
import type { Message, ModelConfig, StreamChunk, ToolDefinition } from './types.js'

function summarizerProvider(): ModelProvider {
  return {
    name: 'compact-test-provider',
    chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
    stream: async function* (_messages: Message[], _tools: ToolDefinition[], _config: ModelConfig): AsyncGenerator<StreamChunk> {
      yield { type: 'text_delta', text: '<summary>Earlier work summarized.</summary>' }
      yield { type: 'message_end', usage: { inputTokens: 4, outputTokens: 2 } }
    },
  }
}

const compactConfig: ModelConfig = {
  model: 'compact-test-model',
  maxTokens: 1024,
  toolResultRetention: {
    keptToolResultChars: 700,
    keptErrorToolResultChars: 1_400,
    summaryToolResultChars: 700,
    summaryErrorToolResultChars: 1_400,
    summaryTotalToolResultChars: 2_000,
  },
}

function baseMessages(
  toolName: string,
  input: Record<string, unknown>,
  content: string,
  isError = false,
  metadata?: Record<string, unknown>
): Message[] {
  return [
    message('old_user_1', 'user', [{ type: 'text', text: 'old user one' }], 1),
    message('old_assistant_1', 'assistant', [{ type: 'text', text: 'old assistant one' }], 2),
    message('old_user_2', 'user', [{ type: 'text', text: 'old user two' }], 3),
    message('recent_user_1', 'user', [{ type: 'text', text: 'recent context one' }], 4),
    message('recent_assistant_1', 'assistant', [{ type: 'text', text: 'recent context two' }], 5),
    message('recent_user_2', 'user', [{ type: 'text', text: 'recent context three' }], 6),
    message('recent_assistant_tool', 'assistant', [{ type: 'tool_use', id: 'toolu_large', name: toolName, input }], 7),
    message('recent_tool_result', 'user', [{ type: 'tool_result', tool_use_id: 'toolu_large', content, is_error: isError, metadata } as any], 8),
    message('recent_user_3', 'user', [{ type: 'text', text: 'continue after tool' }], 9),
  ]
}

function message(id: string, role: Message['role'], content: Message['content'], timestamp: number): Message {
  return { id, role, content, timestamp }
}

function keptToolResultText(messages: Message[]): string {
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_result') return block.content
    }
  }
  throw new Error('No kept tool result found')
}

function lines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix} line ${String(index + 1).padStart(3, '0')} ${'x'.repeat(36)}`).join('\n')
}

describe('compactMessages tool result condensation', () => {
  it('condenses kept Read results with file metadata and omitted line counts', async () => {
    const content = lines('read-output', 120)

    const result = await compactMessages(
      baseMessages('Read', { file_path: 'packages/core/src/session.ts', offset: 1, limit: 120 }, content),
      summarizerProvider(),
      compactConfig,
    )

    expect(result.status).toBe('compacted')
    const kept = keptToolResultText(result.messages)
    expect(kept).toContain('[Tool result condensed: Read]')
    expect(kept).toContain('file_path: packages/core/src/session.ts')
    expect(kept).toContain('range: offset=1, limit=120')
    expect(kept).toMatch(/omitted: \d+ lines/)
    expect(kept).toContain('read-output line 001')
    expect(kept).toContain('read-output line 120')
    expect(kept).not.toContain('read-output line 060')
  })

  it('condenses kept Grep results with query metadata and match excerpts', async () => {
    const content = Array.from({ length: 140 }, (_, index) => (
      `packages/core/src/file-${index + 1}.ts:${index + 3}: matched constraint token ${'y'.repeat(28)}`
    )).join('\n')

    const result = await compactMessages(
      baseMessages('Grep', { pattern: 'constraint token', path: 'packages/core/src' }, content),
      summarizerProvider(),
      compactConfig,
    )

    expect(result.status).toBe('compacted')
    const kept = keptToolResultText(result.messages)
    expect(kept).toContain('[Tool result condensed: Grep]')
    expect(kept).toContain('pattern: constraint token')
    expect(kept).toContain('path: packages/core/src')
    expect(kept).toMatch(/omitted: \d+ lines/)
    expect(kept).toContain('file-1.ts')
    expect(kept).toContain('file-140.ts')
    expect(kept).not.toContain('file-070.ts')
  })

  it('condenses kept Bash results with command status and generous error tail', async () => {
    const content = `${lines('build-output', 110)}\nERROR final compiler failure\nstack frame a\nstack frame b`

    const result = await compactMessages(
      baseMessages('Bash', { command: 'pnpm build', cwd: '/repo' }, content, true),
      summarizerProvider(),
      compactConfig,
    )

    expect(result.status).toBe('compacted')
    const kept = keptToolResultText(result.messages)
    expect(kept).toContain('[Tool result condensed: Bash error]')
    expect(kept).toContain('command: pnpm build')
    expect(kept).toContain('cwd: /repo')
    expect(kept).toContain('status: error')
    expect(kept).toMatch(/omitted: \d+ lines/)
    expect(kept).toContain('build-output line 001')
    expect(kept).toContain('ERROR final compiler failure')
    expect(kept).toContain('stack frame b')
    expect(kept).not.toContain('build-output line 060')
  })

  it('includes shell exit metadata when Bash tool results provide it', async () => {
    const content = `${lines('test-output', 110)}\nFAIL final test assertion`

    const result = await compactMessages(
      baseMessages(
        'Bash',
        { command: 'pnpm test', cwd: '/repo' },
        content,
        true,
        { command: { shell: 'bash', command: 'pnpm test', exitCode: 1 } },
      ),
      summarizerProvider(),
      compactConfig,
    )

    expect(result.status).toBe('compacted')
    const kept = keptToolResultText(result.messages)
    expect(kept).toContain('shell: bash')
    expect(kept).toContain('exit_code: 1')
    expect(kept).toContain('FAIL final test assertion')
  })
})
