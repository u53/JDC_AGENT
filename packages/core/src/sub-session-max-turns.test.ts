import { describe, expect, it } from 'vitest'
import { runSubSession } from './sub-session.js'
import { ToolRegistry } from './tool-registry.js'
import type { ModelConfig } from './types.js'
import type { ModelProvider } from './model-provider.js'

describe('runSubSession maxTurns', () => {
  it('uses the agentType maxTurns when maxTurns is not explicitly provided', async () => {
    let calls = 0
    const provider: ModelProvider = {
      name: 'max-turns-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (_messages: any[], _tools: any[], _config: ModelConfig) {
        calls++
        if (calls > 30) throw new Error('agentType maxTurns was not applied')
        yield { type: 'tool_use_start', toolUse: { id: `tool_${calls}`, name: 'Read', input: '' } }
        yield { type: 'tool_use_delta', toolUse: { id: `tool_${calls}`, name: 'Read', input: '{"file_path":"missing.ts"}' } }
        yield { type: 'tool_use_end' }
      },
    } as any
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'Read', description: 'fake read', inputSchema: {} },
      execute: async () => ({ content: 'missing', isError: true }),
    } as any)

    const result = await runSubSession({
      prompt: 'loop',
      provider,
      toolRegistry: registry,
      modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 200000 },
      cwd: process.cwd(),
      agentType: 'explore',
    })

    expect(result.turns).toBeLessThan(1000)
    expect(result.turns).toBeLessThanOrEqual(25)
  })
})
