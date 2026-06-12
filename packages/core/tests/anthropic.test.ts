import { afterEach, describe, it, expect, vi } from 'vitest'
import { AnthropicProvider, buildStreamBetas } from '../src/providers/anthropic.js'
import type { Message, ModelConfig, StreamChunk, ToolDefinition } from '../src/types.js'

// Canonical Claude Code beta set the relay validates against
// (docs/claude-code-impersonation.md). Must be sent byte-exact and in order.
const CANONICAL_STREAM_BETAS = [
  'interleaved-thinking-2025-05-14',
  'claude-code-20250219',
  'context-1m-2025-08-07',
  'token-efficient-tools-2026-03-28',
  'structured-outputs-2025-12-15',
  'effort-2025-11-24',
  'prompt-caching-scope-2026-01-05',
]

function anthropicSse(events: any[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const streamConfig: ModelConfig = {
  model: 'test-model',
  maxTokens: 1024,
  effort: 'medium',
  systemPrompt: [
    { content: 'stable system prompt', cacheable: true },
    { content: 'dynamic system prompt', cacheable: false },
  ],
}

const streamMessages: Message[] = [
  {
    id: 'm1',
    role: 'user',
    content: [{ type: 'text', text: 'hello from the first user message' }],
    timestamp: 0,
  },
]

const streamTools: ToolDefinition[] = [
  {
    name: 'example_tool',
    description: 'Example tool',
    inputSchema: { type: 'object', properties: {} },
  },
]

describe('AnthropicProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

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
    expect(formatted[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }] })
  })

  it('uses a stable text checkpoint after tool_result blocks for message cache reuse', () => {
    const provider = new AnthropicProvider('test-key')
    const formatted = (provider as any).formatMessages([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'read src/App.tsx' }], timestamp: Date.now() },
      { id: '2', role: 'assistant', content: [{ type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: 'src/App.tsx' } }], timestamp: Date.now() },
      { id: '3', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'file contents' }], timestamp: Date.now() },
    ])

    const toolResultMessage = formatted[2]
    expect(toolResultMessage.role).toBe('user')
    expect(toolResultMessage.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tool_1', content: 'file contents' },
      { type: 'text', text: '<tool-result-cache-checkpoint/>', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('keeps the latest tool_result checkpoint cacheable alongside the latest user cache marker', () => {
    const provider = new AnthropicProvider('test-key')
    const formatted = (provider as any).formatMessages([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'read src/App.tsx' }], timestamp: Date.now() },
      { id: '2', role: 'assistant', content: [{ type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: 'src/App.tsx' } }], timestamp: Date.now() },
      { id: '3', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'file contents' }], timestamp: Date.now() },
      { id: '4', role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: Date.now() },
      { id: '5', role: 'user', content: [{ type: 'text', text: 'next turn' }], timestamp: Date.now() },
    ])

    expect(formatted[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'tool_1', content: 'file contents' },
      { type: 'text', text: '<tool-result-cache-checkpoint/>', cache_control: { type: 'ephemeral' } },
    ])
    expect(formatted[4].content).toEqual([
      { type: 'text', text: 'next turn', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('should map content blocks', () => {
    const provider = new AnthropicProvider('test-key')
    const textBlock = (provider as any).mapContentBlock({ type: 'text', text: 'hi' })
    expect(textBlock).toEqual({ type: 'text', text: 'hi' })

    const toolBlock = (provider as any).mapContentBlock({ type: 'tool_use', id: 'x', name: 'bash', input: { cmd: 'ls' } })
    expect(toolBlock).toEqual({ type: 'tool_use', id: 'x', name: 'bash', input: { cmd: 'ls' } })
  })

  it('keeps stream attribution stable across identical requests so message cache prefixes can hit', async () => {
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)))
      return new Response(anthropicSse([
        { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'message_stop' },
      ]), { status: 200 })
    }))

    const provider = new AnthropicProvider('test-key')
    await collect(provider.stream(streamMessages, streamTools, streamConfig))
    await collect(provider.stream(streamMessages, streamTools, streamConfig))

    expect(bodies).toHaveLength(2)
    expect(bodies[0].system[0].text).toBe(bodies[1].system[0].text)
  })

  it('does not put cache_control on non-cacheable system prompt segments in stream requests', async () => {
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)))
      return new Response(anthropicSse([
        { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'message_stop' },
      ]), { status: 200 })
    }))

    const provider = new AnthropicProvider('test-key')
    await collect(provider.stream(streamMessages, streamTools, streamConfig))

    const system = bodies[0].system
    const dynamicBlocks = system.filter((block: any) => block.text.includes('dynamic system prompt'))
    expect(dynamicBlocks).toHaveLength(1)
    expect(dynamicBlocks[0]).not.toHaveProperty('cache_control')
  })

  it('sends the canonical Claude Code envelope the relay validates against', async () => {
    const captured: Array<{ headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      captured.push({ headers: (init as RequestInit).headers as Record<string, string> })
      return new Response(anthropicSse([
        { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'message_stop' },
      ]), { status: 200 })
    }))

    const provider = new AnthropicProvider('test-key')
    await collect(provider.stream(streamMessages, streamTools, streamConfig))

    // Beta string must match the validated CC fingerprint byte-exact and in order.
    expect(captured[0].headers['anthropic-beta']).toBe(CANONICAL_STREAM_BETAS.join(','))
    // x-client-request-id is part of the genuine CC envelope (not a cache key).
    expect(captured[0].headers).toHaveProperty('x-client-request-id')
    expect(captured[0].headers['x-app']).toBe('cli')
  })

  it('builds the canonical beta list', () => {
    expect(buildStreamBetas()).toEqual(CANONICAL_STREAM_BETAS)
  })

  it('puts a stable, non-zero cch in the billing header (system[0])', async () => {
    const systems: any[][] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      systems.push(JSON.parse(String((init as RequestInit).body)).system)
      return new Response(anthropicSse([
        { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'message_stop' },
      ]), { status: 200 })
    }))

    const provider = new AnthropicProvider('test-key')
    await collect(provider.stream(streamMessages, streamTools, streamConfig))
    await collect(provider.stream(streamMessages, streamTools, streamConfig))

    const cch = (text: string) => text.match(/cch=([0-9a-f]+);/)?.[1]
    const cch1 = cch(systems[0][0].text)
    expect(cch1).toMatch(/^[0-9a-f]{5}$/)
    expect(cch1).not.toBe('00000')
    // billing header (system[0]) must be byte-identical across turns, or the
    // cached block after it can never read.
    expect(systems[0][0].text).toBe(systems[1][0].text)
    expect(systems[0][0]).not.toHaveProperty('cache_control')
  })

  it('does not send a Claude persona in Anthropic stream system blocks', async () => {
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)))
      return new Response(anthropicSse([
        { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'message_stop' },
      ]), { status: 200 })
    }))

    const provider = new AnthropicProvider('test-key')
    await collect(provider.stream(streamMessages, streamTools, {
      ...streamConfig,
      systemPrompt: [
        { content: '# Identity\nYou are JDC CODE.', cacheable: true },
        { content: '<jdc-context-engine>dynamic context</jdc-context-engine>', cacheable: false },
      ],
    }))

    const systemText = bodies[0].system.map((block: any) => block.text).join('\n')
    expect(systemText).toContain('You are JDC CODE')
    expect(systemText).not.toContain(['You are', 'Claude'].join(' '))
    expect(systemText).not.toContain('Claude Code, Anthropic')
    expect(systemText).not.toContain('official CLI for Claude')
  })

  it('retries a transient connection drop before the first chunk', async () => {
    const fetchMock = vi.fn()
      // First attempt: undici-style bare "terminated" while opening the stream.
      .mockRejectedValueOnce(new TypeError('terminated'))
      // Second attempt: succeeds.
      .mockResolvedValueOnce(new Response(anthropicSse([
        { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new AnthropicProvider('test-key')
    const retries: Array<{ attempt: number; maxRetries: number }> = []
    const chunks = await collect(provider.stream(streamMessages, streamTools, {
      ...streamConfig,
      onStreamRetry: (attempt, _error, _delayMs, maxRetries) => {
        retries.push({ attempt, maxRetries })
      },
    }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(retries).toEqual([{ attempt: 1, maxRetries: 10 }])
    expect(chunks.some(c => c.type === 'text_delta' && c.text === 'hi')).toBe(true)
  })

  it('does not retry once chunks have already been emitted', async () => {
    // Stream delivers a few SSE lines across reads, then the reader throws
    // mid-flight. Because content was already yielded, retry is unsafe.
    const encoder = new TextEncoder()
    const queued = [
      `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a long partial response that is well past any tag-prefix buffer threshold' } })}\n\n`,
    ]
    const fetchMock = vi.fn(async () => {
      let i = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (i < queued.length) {
            controller.enqueue(encoder.encode(queued[i++]))
          } else {
            controller.error(new TypeError('terminated'))
          }
        },
      })
      return new Response(stream, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new AnthropicProvider('test-key')
    await expect(collect(provider.stream(streamMessages, streamTools, streamConfig))).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
