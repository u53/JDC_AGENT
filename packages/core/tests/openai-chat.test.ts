import { describe, it, expect } from 'vitest'
import { OpenAIChatProvider } from '../src/providers/openai-chat.js'

describe('OpenAIChatProvider', () => {
  it('implements ModelProvider interface', () => {
    const provider = new OpenAIChatProvider('test-key', 'http://localhost:8080')
    expect(provider.name).toBe('openai')
    expect(typeof provider.chat).toBe('function')
    expect(typeof provider.stream).toBe('function')
  })

  it('formats messages correctly', () => {
    const provider = new OpenAIChatProvider('test-key')
    const formatted = (provider as any).formatMessages([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 },
      { id: '2', role: 'assistant', content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 'tc1', name: 'bash', input: { command: 'ls' } }], timestamp: 0 },
      { id: '3', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'file.txt' }], timestamp: 0 },
    ])
    expect(formatted[0]).toEqual({ role: 'user', content: 'hello' })
    expect(formatted[1].role).toBe('assistant')
    expect(formatted[1].tool_calls[0].function.name).toBe('bash')
    expect(formatted[2]).toEqual({ role: 'tool', tool_call_id: 'tc1', content: 'file.txt' })
  })

  it('formats messages with system prompt', () => {
    const provider = new OpenAIChatProvider('test-key')
    const formatted = (provider as any).formatMessages(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
      'You are helpful.'
    )
    expect(formatted[0]).toEqual({ role: 'system', content: 'You are helpful.' })
    expect(formatted[1]).toEqual({ role: 'user', content: 'hello' })
  })

  it('formats tools correctly', () => {
    const provider = new OpenAIChatProvider('test-key')
    const tools = (provider as any).formatTools([
      { name: 'bash', description: 'Run a command', inputSchema: { type: 'object', properties: { command: { type: 'string' } } } },
    ])
    expect(tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'bash',
        description: 'Run a command',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
      },
    })
  })

  it('handles assistant message with tool_calls arguments as JSON', () => {
    const provider = new OpenAIChatProvider('test-key')
    const formatted = (provider as any).formatMessages([
      { id: '1', role: 'assistant', content: [{ type: 'tool_use', id: 'tc1', name: 'bash', input: { command: 'ls', flags: ['-la'] } }], timestamp: 0 },
    ])
    expect(formatted[0].tool_calls[0].function.arguments).toBe('{"command":"ls","flags":["-la"]}')
  })
})
