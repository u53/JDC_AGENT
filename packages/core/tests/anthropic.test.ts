import { describe, it, expect } from 'vitest'
import { AnthropicProvider } from '../src/providers/anthropic.js'

describe('AnthropicProvider', () => {
  it('should instantiate with an API key', () => {
    const provider = new AnthropicProvider('test-key')
    expect(provider.name).toBe('anthropic')
  })

  it('should format messages correctly', () => {
    const provider = new AnthropicProvider('test-key')
    const formatted = (provider as any).formatMessages([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.now() },
      { id: '2', role: 'system', content: [{ type: 'text', text: 'sys' }], timestamp: Date.now() },
    ])
    expect(formatted).toHaveLength(1)
    expect(formatted[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hello' }] })
  })

  it('should map content blocks', () => {
    const provider = new AnthropicProvider('test-key')
    const textBlock = (provider as any).mapContentBlock({ type: 'text', text: 'hi' })
    expect(textBlock).toEqual({ type: 'text', text: 'hi' })

    const toolBlock = (provider as any).mapContentBlock({ type: 'tool_use', id: 'x', name: 'bash', input: { cmd: 'ls' } })
    expect(toolBlock).toEqual({ type: 'tool_use', id: 'x', name: 'bash', input: { cmd: 'ls' } })
  })
})
