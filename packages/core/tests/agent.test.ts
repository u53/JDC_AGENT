import { describe, it, expect, vi } from 'vitest'
import { createAgentTool } from '../src/tools/agent.js'
import { ToolRegistry } from '../src/tool-registry.js'
import type { ModelProvider } from '../src/model-provider.js'
import type { ModelConfig } from '../src/types.js'

function makeMockProvider(responses: Array<{ text?: string; toolUses?: Array<{ id: string; name: string; input: string }> }>): ModelProvider {
  let callIndex = 0
  return {
    name: 'mock',
    async chat() {
      return { content: [], usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async *stream() {
      const response = responses[callIndex++] || { text: 'done' }
      if (response.text) {
        yield { type: 'text_delta' as const, text: response.text }
      }
      if (response.toolUses) {
        for (const tu of response.toolUses) {
          yield { type: 'tool_use_start' as const, toolUse: { id: tu.id, name: tu.name, input: '' } }
          yield { type: 'tool_use_delta' as const, text: tu.input, toolUse: { id: tu.id, name: tu.name, input: tu.input } }
          yield { type: 'tool_use_end' as const }
        }
      }
      yield { type: 'message_end' as const, usage: { inputTokens: 10, outputTokens: 10 } }
    },
  }
}

describe('AgentTool', () => {
  const baseConfig: ModelConfig = { model: 'test', maxTokens: 1000 }

  it('blocks recursive sub-agent dispatch', async () => {
    const registry = new ToolRegistry()
    const tool = createAgentTool({
      provider: makeMockProvider([]),
      toolRegistry: registry,
      modelConfig: baseConfig,
      cwd: '/tmp',
      isSubAgent: true,
    })
    const result = await tool.execute({ prompt: 'do something' }, { cwd: '/tmp' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('cannot dispatch')
  })

  it('has correct tool definition', () => {
    const registry = new ToolRegistry()
    const tool = createAgentTool({
      provider: makeMockProvider([]),
      toolRegistry: registry,
      modelConfig: baseConfig,
      cwd: '/tmp',
    })
    expect(tool.definition.name).toBe('Agent')
    expect(tool.definition.inputSchema.required).toContain('prompt')
  })

  it('runs sub-session and returns text response', async () => {
    const registry = new ToolRegistry()
    const provider = makeMockProvider([{ text: 'Task completed successfully.' }])
    const tool = createAgentTool({
      provider,
      toolRegistry: registry,
      modelConfig: baseConfig,
      cwd: '/tmp',
    })
    const result = await tool.execute({ prompt: 'do a thing' }, { cwd: '/tmp' })
    expect(result.isError).toBeUndefined()
    expect(result.content).toBe('Task completed successfully.')
  })

  it('handles provider errors gracefully', async () => {
    const registry = new ToolRegistry()
    const provider: ModelProvider = {
      name: 'error-mock',
      async chat() { return { content: [], usage: { inputTokens: 0, outputTokens: 0 } } },
      async *stream() { throw new Error('API connection failed') },
    }
    const tool = createAgentTool({
      provider,
      toolRegistry: registry,
      modelConfig: baseConfig,
      cwd: '/tmp',
    })
    const result = await tool.execute({ prompt: 'do a thing' }, { cwd: '/tmp' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('API connection failed')
  })

  it('respects abort signal', async () => {
    const registry = new ToolRegistry()
    const controller = new AbortController()
    controller.abort()
    const provider = makeMockProvider([{ text: 'should not reach' }])
    const tool = createAgentTool({
      provider,
      toolRegistry: registry,
      modelConfig: baseConfig,
      cwd: '/tmp',
    })
    const result = await tool.execute({ prompt: 'do a thing' }, { cwd: '/tmp', signal: controller.signal })
    // When aborted before first turn, returns empty or max-turns message
    expect(result.content).toContain('max turns')
  })
})
