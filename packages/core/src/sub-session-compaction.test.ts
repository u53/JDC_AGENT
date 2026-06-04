import { describe, expect, it, vi } from 'vitest'
import { runSubSession } from './sub-session.js'
import { ToolRegistry } from './tool-registry.js'
import type { Message, ModelConfig, ToolDefinition } from './types.js'
import type { ModelProvider } from './model-provider.js'

describe('sub-session compaction', () => {
  it('compacts long sub-session history and continues with compacted messages', async () => {
    const foregroundMessages: Message[][] = []
    let compactCalls = 0
    const provider: ModelProvider = {
      name: 'sub-compact-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        if (typeof config.systemPrompt === 'string' && config.systemPrompt.includes('specialist at creating detailed')) {
          compactCalls++
          yield { type: 'text_delta', text: '<summary>Sub-session recovered summary.</summary>' }
          yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } }
          return
        }
        foregroundMessages.push(messages.map(m => ({ ...m, content: [...m.content] })))
        if (foregroundMessages.length < 5) {
          const id = `tool_${foregroundMessages.length}`
          yield { type: 'tool_use_start', toolUse: { id, name: 'Read', input: '' } }
          yield { type: 'tool_use_delta', toolUse: { id, name: 'Read', input: '{"file_path":"large.ts"}' } }
          yield { type: 'tool_use_end' }
          yield { type: 'message_end', usage: { inputTokens: 1000, outputTokens: 10 } }
          return
        }
        yield { type: 'text_delta', text: 'done after sub compact' }
        yield { type: 'message_end', usage: { inputTokens: 100, outputTokens: 10 } }
      },
    } as any

    const result = await runSubSession({
      prompt: 'long worker task',
      provider,
      toolRegistry: registryWithLargeRead(),
      modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 1200, compressAt: 0.5 },
      cwd: process.cwd(),
      maxTurns: 8,
      onStreamHeartbeat: vi.fn(),
    })

    expect(result.content).toBe('done after sub compact')
    expect(compactCalls).toBeGreaterThan(0)
    expect(JSON.stringify(foregroundMessages.at(-1))).toContain('Sub-session recovered summary')
  })

  it('continues fail-open when sub-session compaction fails', async () => {
    const foregroundMessages: Message[][] = []
    let compactCalls = 0
    const provider: ModelProvider = {
      name: 'sub-compact-fail-open-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        if (typeof config.systemPrompt === 'string' && config.systemPrompt.includes('specialist at creating detailed')) {
          compactCalls++
          throw new Error('compact stream failed')
        }
        foregroundMessages.push(messages.map(m => ({ ...m, content: [...m.content] })))
        if (foregroundMessages.length < 5) {
          const id = `tool_${foregroundMessages.length}`
          yield { type: 'tool_use_start', toolUse: { id, name: 'Read', input: '' } }
          yield { type: 'tool_use_delta', toolUse: { id, name: 'Read', input: '{"file_path":"large.ts"}' } }
          yield { type: 'tool_use_end' }
          yield { type: 'message_end', usage: { inputTokens: 1000, outputTokens: 10 } }
          return
        }
        yield { type: 'text_delta', text: 'done after failed compact' }
        yield { type: 'message_end', usage: { inputTokens: 100, outputTokens: 10 } }
      },
    } as any

    const result = await runSubSession({
      prompt: 'long worker task with failing compaction',
      provider,
      toolRegistry: registryWithLargeRead(),
      modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 1200, compressAt: 0.5 },
      cwd: process.cwd(),
      maxTurns: 8,
    })

    expect(result.content).toBe('done after failed compact')
    expect(compactCalls).toBeGreaterThan(0)
  })
})

function registryWithLargeRead(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({
    definition: { name: 'Read', description: 'fake read', inputSchema: {} },
    execute: async () => ({ content: 'x'.repeat(5000), isError: false }),
  } as any)
  return registry
}
