import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runSubSession } from './sub-session.js'
import { ToolRegistry } from './tool-registry.js'
import { registerBuiltinTools } from './tools/index.js'
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
    expect(result.status).toBe('max_turns_exhausted')
  })

  it('blocks write-capable sub-agents from editing existing files before a fresh read', async () => {
    const cwd = path.join(os.tmpdir(), `sub-session-fresh-read-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(cwd, { recursive: true })
    const target = path.join(cwd, 'target.ts')
    writeFileSync(target, 'const alpha = 1\n', 'utf8')

    let calls = 0
    const provider: ModelProvider = {
      name: 'fresh-read-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (_messages: any[], _tools: any[], _config: ModelConfig) {
        calls++
        if (calls > 1) {
          yield { type: 'text_delta', text: 'done' }
          yield { type: 'message_end', usage: { inputTokens: 0, outputTokens: 0 } }
          return
        }
        yield { type: 'tool_use_start', toolUse: { id: 'edit1', name: 'Edit', input: '' } }
        yield {
          type: 'tool_use_delta',
          toolUse: {
            id: 'edit1',
            name: 'Edit',
            input: JSON.stringify({
              file_path: 'target.ts',
              old_string: 'const alpha = 1',
              new_string: 'const alpha = 2',
            }),
          },
        }
        yield { type: 'tool_use_end' }
        yield { type: 'message_end', usage: { inputTokens: 0, outputTokens: 0 } }
      },
    } as any
    const registry = new ToolRegistry()
    registerBuiltinTools(registry)

    try {
      const result = await runSubSession({
        prompt: 'edit target.ts',
        provider,
        toolRegistry: registry,
        modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 200000 },
        cwd,
        agentType: 'general',
        maxTurns: 2,
      })

      expect(result.status).toBe('completed')
      expect(readFileSync(target, 'utf8')).toBe('const alpha = 1\n')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
