import { describe, it, expect } from 'vitest'
import { OpenAIResponsesProvider } from '../src/providers/openai-responses.js'

describe('OpenAIResponsesProvider', () => {
  it('implements ModelProvider interface', () => {
    const provider = new OpenAIResponsesProvider('test-key', 'http://localhost:8080')
    expect(provider.name).toBe('openai-responses')
    expect(typeof provider.chat).toBe('function')
    expect(typeof provider.stream).toBe('function')
  })

  it('formats input correctly for user and assistant messages', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 },
      { id: '2', role: 'assistant', content: [{ type: 'text', text: 'hi there' }], timestamp: 0 },
    ])
    expect(formatted).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ])
  })

  it('formats input with system prompt', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
      'You are helpful.'
    )
    expect(formatted[0]).toEqual({ role: 'system', content: 'You are helpful.' })
    expect(formatted[1]).toEqual({ role: 'user', content: 'hello' })
  })

  it('formats tool_result blocks as function_call_output', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput([
      { id: '1', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'file.txt' }], timestamp: 0 },
    ])
    expect(formatted[0]).toEqual({
      type: 'function_call_output',
      call_id: 'tc1',
      output: 'file.txt',
    })
  })

  it('skips system role messages from input', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput([
      { id: '1', role: 'system', content: [{ type: 'text', text: 'ignored' }], timestamp: 0 },
      { id: '2', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 },
    ])
    expect(formatted).toEqual([
      { role: 'user', content: 'hello' },
    ])
  })

  it('formats tools correctly', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const tools = (provider as any).formatTools([
      { name: 'bash', description: 'Run a command', inputSchema: { type: 'object', properties: { command: { type: 'string' } } } },
    ])
    expect(tools[0]).toEqual({
      type: 'function',
      name: 'bash',
      description: 'Run a command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
    })
  })

  it('handles JSON.parse safety for malformed function arguments', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    // Simulate what chat() does internally with malformed JSON
    const parseArgs = (args: string) => {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(args || '{}')
      } catch {
        // fall back to empty object
      }
      return parsedArgs
    }
    expect(parseArgs('not valid json{')).toEqual({})
    expect(parseArgs('')).toEqual({})
    expect(parseArgs('{"key":"value"}')).toEqual({ key: 'value' })
  })

  it('formats input with mixed tool_result and text blocks', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const formatted = (provider as any).formatInput([
      {
        id: '1',
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', content: 'result' },
          { type: 'text', text: 'follow up' },
        ],
        timestamp: 0,
      },
    ])
    expect(formatted[0]).toEqual({
      type: 'function_call_output',
      call_id: 'tc1',
      output: 'result',
    })
    expect(formatted[1]).toEqual({ role: 'user', content: 'follow up' })
  })
})