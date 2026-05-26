import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicProvider } from '../src/providers/anthropic.js'
import { OpenAIChatProvider } from '../src/providers/openai-chat.js'
import type { ModelConfig, StreamChunk } from '../src/types.js'

const config: ModelConfig = {
  model: 'test-model',
  maxTokens: 1024,
  effort: 'medium',
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function textOf(chunks: StreamChunk[], type: 'text_delta' | 'thinking_delta'): string {
  return chunks
    .filter((chunk) => chunk.type === type)
    .map((chunk) => chunk.text || '')
    .join('')
}

function openAIStream(events: any[]): AsyncIterable<any> {
  return (async function* () {
    for (const event of events) yield event
  })()
}

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

describe('thinking tag streaming', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps OpenAI Chat thinking tag state across content and reasoning deltas', async () => {
    const provider = new OpenAIChatProvider('test-key')
    ;(provider as any).client = {
      chat: {
        completions: {
          create: async () =>
            openAIStream([
              { choices: [{ delta: { content: '<thinking>audit note ' } }] },
              { choices: [{ delta: { reasoning_content: 'still thinking</thinking>\n\nfinal answer' } }] },
              {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 2 },
              },
            ]),
        },
      },
    }

    const chunks = await collect(provider.stream([], [], config))

    expect(textOf(chunks, 'thinking_delta')).toBe('audit note still thinking')
    expect(textOf(chunks, 'text_delta')).toBe('\n\nfinal answer')
  })

  it('does not carry untagged OpenAI reasoning into later content', async () => {
    const provider = new OpenAIChatProvider('test-key')
    ;(provider as any).client = {
      chat: {
        completions: {
          create: async () =>
            openAIStream([
              { choices: [{ delta: { reasoning_content: 'native reason ' } }] },
              { choices: [{ delta: { content: 'final answer' } }] },
              {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 2 },
              },
            ]),
        },
      },
    }

    const chunks = await collect(provider.stream([], [], config))

    expect(textOf(chunks, 'thinking_delta')).toBe('native reason ')
    expect(textOf(chunks, 'text_delta')).toBe('final answer')
  })

  it('drops orphaned OpenAI thinking close tails at the start of a fresh stream', async () => {
    const provider = new OpenAIChatProvider('test-key')
    ;(provider as any).client = {
      chat: {
        completions: {
          create: async () =>
            openAIStream([
              { choices: [{ delta: { reasoning_content: 'f.</thinking>\n\nfinal answer' } }] },
              {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 2 },
              },
            ]),
        },
      },
    }

    const chunks = await collect(provider.stream([], [], config))

    expect(textOf(chunks, 'thinking_delta')).toBe('')
    expect(textOf(chunks, 'text_delta')).toBe('\n\nfinal answer')
  })

  it('drops orphaned OpenAI thinking close tails split across stream chunks', async () => {
    const provider = new OpenAIChatProvider('test-key')
    ;(provider as any).client = {
      chat: {
        completions: {
          create: async () =>
            openAIStream([
              { choices: [{ delta: { reasoning_content: 'f.</thin' } }] },
              { choices: [{ delta: { reasoning_content: 'king>\n\nfinal answer' } }] },
              {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 2 },
              },
            ]),
        },
      },
    }

    const chunks = await collect(provider.stream([], [], config))

    expect(textOf(chunks, 'thinking_delta')).toBe('')
    expect(textOf(chunks, 'text_delta')).toBe('\n\nfinal answer')
  })

  it('keeps Anthropic thinking tag state across thinking and text deltas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(anthropicSse([
      {
        type: 'message_start',
        message: { usage: { input_tokens: 1, output_tokens: 0 } },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: '<thinking>audit note ' },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'still thinking</thinking>\n\nfinal answer' },
      },
      {
        type: 'message_stop',
      },
    ]), { status: 200 })))

    const provider = new AnthropicProvider('test-key')
    const chunks = await collect(provider.stream([], [], config))

    expect(textOf(chunks, 'thinking_delta')).toBe('audit note still thinking')
    expect(textOf(chunks, 'text_delta')).toBe('\n\nfinal answer')
  })

  it('does not carry untagged Anthropic thinking blocks into later text blocks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(anthropicSse([
      {
        type: 'message_start',
        message: { usage: { input_tokens: 1, output_tokens: 0 } },
      },
      {
        type: 'content_block_start',
        content_block: { type: 'thinking' },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'native reason ' },
      },
      {
        type: 'content_block_stop',
      },
      {
        type: 'content_block_start',
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'final answer' },
      },
      {
        type: 'message_stop',
      },
    ]), { status: 200 })))

    const provider = new AnthropicProvider('test-key')
    const chunks = await collect(provider.stream([], [], config))

    expect(textOf(chunks, 'thinking_delta')).toBe('native reason ')
    expect(textOf(chunks, 'text_delta')).toBe('final answer')
  })

  it('drops orphaned Anthropic thinking close tails at the start of a fresh stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(anthropicSse([
      {
        type: 'message_start',
        message: { usage: { input_tokens: 1, output_tokens: 0 } },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'f.</thinking>' },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '\n\nfinal answer' },
      },
      {
        type: 'message_stop',
      },
    ]), { status: 200 })))

    const provider = new AnthropicProvider('test-key')
    const chunks = await collect(provider.stream([], [], config))

    expect(textOf(chunks, 'thinking_delta')).toBe('')
    expect(textOf(chunks, 'text_delta')).toBe('\n\nfinal answer')
  })
})
