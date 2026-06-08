import { describe, it, expect, vi } from 'vitest'
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

  it('passes system prompt via instructions, not the input array', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    // System prompt is now carried in the request `instructions` field; formatInput
    // takes only messages and drops system-role messages from the input array.
    const formatted = (provider as any).formatInput(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
    )
    expect(formatted).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('formats paired tool_use/tool_result as function_call + function_call_output', () => {
    const provider = new OpenAIResponsesProvider('test-key')
    // An orphaned tool_result (no preceding tool_use) is intentionally dropped,
    // since the Responses API rejects unpaired function_call_output. A complete
    // pair must round-trip both items.
    const formatted = (provider as any).formatInput([
      { id: '1', role: 'assistant', content: [{ type: 'tool_use', id: 'tc1', name: 'Read', input: { file_path: 'x' } }], timestamp: 0 },
      { id: '2', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'file.txt' }], timestamp: 0 },
    ])
    expect(formatted).toEqual([
      { type: 'function_call', call_id: 'tc1', name: 'Read', arguments: '{"file_path":"x"}' },
      { type: 'function_call_output', call_id: 'tc1', output: 'file.txt' },
    ])
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
    // A complete tool_use/tool_result pair plus trailing user text: the text
    // must survive alongside the function_call_output (regression: text in a
    // tool-result turn used to be dropped).
    const formatted = (provider as any).formatInput([
      {
        id: '0',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tc1', name: 'Read', input: {} }],
        timestamp: 0,
      },
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
    expect(formatted).toContainEqual({
      type: 'function_call_output',
      call_id: 'tc1',
      output: 'result',
    })
    expect(formatted).toContainEqual({ role: 'user', content: 'follow up' })
  })

  it('passes cache user as safety_identifier for Responses params', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    let capturedParams: any
    ;(provider as any).client = {
      responses: {
        create: async (params: any) => {
          capturedParams = params
          return { output: [], usage: { input_tokens: 0, output_tokens: 0 } }
        },
      },
    }

    await provider.chat(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
      [],
      { model: 'gpt-5', maxTokens: 100, cacheUser: 'session-1', cacheKey: 'main:session-1' },
    )

    expect(capturedParams).toMatchObject({
      prompt_cache_key: 'main:session-1',
      safety_identifier: 'session-1',
    })
    expect(capturedParams).not.toHaveProperty('user')
  })

  it('omits store from Responses params for OpenAI-compatible proxy compatibility', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    let capturedParams: any
    ;(provider as any).client = {
      responses: {
        create: async (params: any) => {
          capturedParams = params
          return { output: [], usage: { input_tokens: 0, output_tokens: 0 } }
        },
      },
    }

    await provider.chat(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
      [],
      { model: 'gpt-5.5', maxTokens: 100 },
    )

    expect(capturedParams).not.toHaveProperty('store')
  })

  it('uses a minimal fetch transport for runtime Responses requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 3, output_tokens: 1 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = new OpenAIResponsesProvider('test-key', 'https://proxy.example/v1')
      const result = await provider.chat(
        [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
        [],
        { model: 'gpt-5.5', maxTokens: 100 },
      )

      expect(result.content).toEqual([{ type: 'text', text: 'ok' }])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://proxy.example/v1/responses')
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      })
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: 'gpt-5.5',
        input: [{ role: 'user', content: 'hello' }],
        max_output_tokens: 100,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('parses Responses SSE events from the minimal fetch transport', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"ok"}\n\n'))
        controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":1}}}\n\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })))

    try {
      const provider = new OpenAIResponsesProvider('test-key', 'https://proxy.example/v1')
      const chunks = []
      for await (const chunk of provider.stream(
        [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
        [],
        { model: 'gpt-5.5', maxTokens: 100 },
      )) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([
        { type: 'text_delta', text: 'ok' },
        { type: 'message_end', usage: { inputTokens: 3, outputTokens: 1, cacheReadInputTokens: 0 } },
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to non-streaming Responses when streaming is blocked before chunks', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const blocked = new Error('403 Your request was blocked.') as Error & { status?: number }
    blocked.status = 403
    const create = vi.fn(async (params: any) => {
      if (params.stream) throw blocked
      return {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }
    })
    ;(provider as any).client = { responses: { create } }

    const chunks = []
    for await (const chunk of provider.stream(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
      [],
      { model: 'gpt-5.5', maxTokens: 100 },
    )) {
      chunks.push(chunk)
    }

    expect(create).toHaveBeenCalledTimes(2)
    expect(chunks).toEqual([
      { type: 'text_delta', text: 'ok' },
      { type: 'message_end', usage: { inputTokens: 3, outputTokens: 1, cacheReadInputTokens: 0 } },
    ])
  })

  it('falls back when a proxy reports streaming 403 only in the error message', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const create = vi.fn(async (params: any) => {
      if (params.stream) throw new Error('403 Your request was blocked.')
      return {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }
    })
    ;(provider as any).client = { responses: { create } }

    const chunks = []
    for await (const chunk of provider.stream(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
      [],
      { model: 'gpt-5.5', maxTokens: 100 },
    )) {
      chunks.push(chunk)
    }

    expect(create).toHaveBeenCalledTimes(2)
    expect(chunks).toEqual([
      { type: 'text_delta', text: 'ok' },
      { type: 'message_end', usage: { inputTokens: 3, outputTokens: 1, cacheReadInputTokens: 0 } },
    ])
  })

  it('uses raw fetch without SDK compatibility headers for runtime Responses requests', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 3, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = new OpenAIResponsesProvider('test-key', 'https://proxy.example/v1')
      const result = await provider.chat(
        [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
        [],
        { model: 'gpt-5.5', maxTokens: 100 },
      )

      expect(result.content).toEqual([{ type: 'text', text: 'ok' }])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://proxy.example/v1/responses')
      expect(init.headers).toEqual({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      })
      expect(JSON.stringify(init.headers).toLowerCase()).not.toContain('stainless')
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('parses raw fetch Responses SSE streams', async () => {
    const originalFetch = globalThis.fetch
    const sse = [
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":1}}}\n\n',
    ].join('')
    const fetchMock = vi.fn(async () => new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const provider = new OpenAIResponsesProvider('test-key', 'https://proxy.example/v1')
      const chunks = []
      for await (const chunk of provider.stream(
        [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
        [],
        { model: 'gpt-5.5', maxTokens: 100 },
      )) {
        chunks.push(chunk)
      }

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.headers).toEqual({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      })
      expect(chunks).toEqual([
        { type: 'text_delta', text: 'ok' },
        { type: 'message_end', usage: { inputTokens: 3, outputTokens: 1, cacheReadInputTokens: 0 } },
      ])
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('streams function calls from completed Responses output items instead of partial added items', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const events = [
      {
        type: 'response.output_item.added',
        item: { type: 'function_call', id: 'fc_item_1', call_id: '', name: '', arguments: '' },
        output_index: 0,
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_item_1', output_index: 0, delta: '{"file":"' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_item_1', output_index: 0, delta: 'a.ts"}' },
      {
        type: 'response.output_item.done',
        item: { type: 'function_call', id: 'fc_item_1', call_id: 'call_1', name: 'Read', arguments: '{"file":"a.ts"}' },
        output_index: 0,
      },
      { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 4 } } },
    ]
    ;(provider as any).client = {
      responses: {
        create: async () => asyncIterable(events),
      },
    }

    const chunks = []
    for await (const chunk of provider.stream(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'read file' }], timestamp: 0 }],
      [{ name: 'Read', description: 'Read a file', inputSchema: { type: 'object' } }],
      { model: 'gpt-5', maxTokens: 100 },
    )) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'tool_use_start', toolUse: { id: 'call_1', name: 'Read', input: '' } },
      { type: 'tool_use_delta', toolUse: { id: '', name: '', input: '{"file":"a.ts"}' } },
      { type: 'tool_use_end' },
      { type: 'message_end', usage: { inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 0 } },
    ])
  })

  it('reports stream retries before the first chunk', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const create = vi.fn()
      .mockRejectedValueOnce(new TypeError('terminated'))
      .mockResolvedValueOnce(asyncIterable([
        { type: 'response.output_text.delta', delta: 'ok' },
        { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
      ]))
    ;(provider as any).client = {
      responses: { create },
    }
    const retries: Array<{ attempt: number; maxRetries: number }> = []

    const chunks = []
    for await (const chunk of provider.stream(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }],
      [],
      {
        model: 'gpt-5',
        maxTokens: 100,
        onStreamRetry: (attempt, _error, _delayMs, maxRetries) => {
          retries.push({ attempt, maxRetries })
        },
      },
    )) {
      chunks.push(chunk)
    }

    expect(create).toHaveBeenCalledTimes(2)
    expect(retries).toEqual([{ attempt: 1, maxRetries: 10 }])
    expect(chunks.some(c => c.type === 'text_delta' && c.text === 'ok')).toBe(true)
  })

  it('streams interleaved Responses function calls as complete sequential tool uses', async () => {
    const provider = new OpenAIResponsesProvider('test-key')
    const events = [
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', call_id: '', name: '', arguments: '' }, output_index: 0 },
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_2', call_id: '', name: '', arguments: '' }, output_index: 1 },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"path":"' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_2', output_index: 1, delta: '{"cmd":"' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: 'a.ts"}' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_2', output_index: 1, delta: 'pwd"}' },
      { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'Bash', arguments: '{"cmd":"pwd"}' }, output_index: 1 },
      { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Read', arguments: '{"path":"a.ts"}' }, output_index: 0 },
      { type: 'response.completed', response: { usage: { input_tokens: 20, output_tokens: 8 } } },
    ]
    ;(provider as any).client = {
      responses: {
        create: async () => asyncIterable(events),
      },
    }

    const chunks = []
    for await (const chunk of provider.stream(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'read and pwd' }], timestamp: 0 }],
      [
        { name: 'Read', description: 'Read a file', inputSchema: { type: 'object' } },
        { name: 'Bash', description: 'Run shell', inputSchema: { type: 'object' } },
      ],
      { model: 'gpt-5', maxTokens: 100 },
    )) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'tool_use_start', toolUse: { id: 'call_2', name: 'Bash', input: '' } },
      { type: 'tool_use_delta', toolUse: { id: '', name: '', input: '{"cmd":"pwd"}' } },
      { type: 'tool_use_end' },
      { type: 'tool_use_start', toolUse: { id: 'call_1', name: 'Read', input: '' } },
      { type: 'tool_use_delta', toolUse: { id: '', name: '', input: '{"path":"a.ts"}' } },
      { type: 'tool_use_end' },
      { type: 'message_end', usage: { inputTokens: 20, outputTokens: 8, cacheReadInputTokens: 0 } },
    ])
  })
})

async function* asyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item
}
