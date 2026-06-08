import { describe, it, expect, vi } from 'vitest'
import { OpenAIChatProvider } from '../src/providers/openai-chat.js'
import type { StreamChunk } from '../src/types.js'

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

async function* asyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item
}

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
    // An assistant tool_use with no matching tool_result is dropped (OpenAI
    // rejects unpaired tool_calls), so the pair must be complete to round-trip.
    const formatted = (provider as any).formatMessages([
      { id: '1', role: 'assistant', content: [{ type: 'tool_use', id: 'tc1', name: 'bash', input: { command: 'ls', flags: ['-la'] } }], timestamp: 0 },
      { id: '2', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'out' }], timestamp: 0 },
    ])
    const assistant = formatted.find((m: any) => m.role === 'assistant')
    expect(assistant.tool_calls[0].function.arguments).toBe('{"command":"ls","flags":["-la"]}')
  })

  it('keeps dynamic prompt segments out of the stable system cache prefix', async () => {
    const provider = new OpenAIChatProvider('test-key')
    let capturedParams: any
    ;(provider as any).client = {
      chat: {
        completions: {
          create: async (params: any) => {
            capturedParams = params
            return { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
          },
        },
      },
    }

    await provider.chat(
      [
        { id: '1', role: 'user', content: [{ type: 'text', text: 'old question' }], timestamp: 0 },
        { id: '2', role: 'assistant', content: [{ type: 'text', text: 'old answer' }], timestamp: 0 },
        { id: '3', role: 'user', content: [{ type: 'text', text: 'current question' }], timestamp: 0 },
      ],
      [],
      {
        model: 'gpt-5',
        maxTokens: 100,
        systemPrompt: [
          { content: '# Identity\nYou are JDCAGNET.', cacheable: true },
          { content: '<jdc-context-engine>项目上下文</jdc-context-engine>', cacheable: false },
        ],
      },
    )

    expect(capturedParams.messages[0]).toEqual({ role: 'system', content: '# Identity\nYou are JDCAGNET.' })
    expect(capturedParams.messages[0].content).not.toContain('<jdc-context-engine>')
    expect(capturedParams.messages[1]).toEqual({ role: 'user', content: 'old question' })
    expect(capturedParams.messages[2]).toEqual({ role: 'assistant', content: 'old answer' })
    expect(capturedParams.messages[3]).toEqual({ role: 'user', content: 'current question' })
    expect(capturedParams.messages[4].role).toBe('system')
    expect(capturedParams.messages[4].content).toContain('<jdc-context-engine>项目上下文</jdc-context-engine>')
  })

  it('reports stream retries before the first chunk', async () => {
    const provider = new OpenAIChatProvider('test-key')
    const create = vi.fn()
      .mockRejectedValueOnce(new TypeError('terminated'))
      .mockResolvedValueOnce(asyncIterable([
        { choices: [{ delta: { content: 'ok' } }] },
      ]))
    ;(provider as any).client = {
      chat: { completions: { create } },
    }
    const retries: Array<{ attempt: number; maxRetries: number }> = []

    const chunks = await collect(provider.stream(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
      [],
      {
        model: 'gpt-5',
        maxTokens: 100,
        onStreamRetry: (attempt, _error, _delayMs, maxRetries) => {
          retries.push({ attempt, maxRetries })
        },
      },
    ))

    expect(create).toHaveBeenCalledTimes(2)
    expect(retries).toEqual([{ attempt: 1, maxRetries: 10 }])
    expect(chunks.some(c => c.type === 'text_delta' && c.text === 'ok')).toBe(true)
  })
})
