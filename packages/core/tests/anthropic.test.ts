import { afterEach, describe, it, expect, vi } from 'vitest'
import { AnthropicProvider } from '../src/providers/anthropic.js'
import type { Message, ModelConfig, StreamChunk, ToolDefinition } from '../src/types.js'

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
})
