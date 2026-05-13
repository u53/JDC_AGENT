import Anthropic from '@anthropic-ai/sdk'
import type { ModelProvider } from '../model-provider.js'
import type { ContentBlock, Message, ModelConfig, StreamChunk, ToolDefinition } from '../types.js'

export class AnthropicProvider implements ModelProvider {
  name = 'anthropic'
  private client: Anthropic

  constructor(apiKey: string, baseURL?: string) {
    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    })
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ) {
    const response = await this.client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      messages: this.formatMessages(messages),
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      })),
    }, { signal })

    return {
      content: response.content.map(block => this.mapContentBlock(block)),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    }
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const stream = this.client.messages.stream({
      model: config.model,
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      messages: this.formatMessages(messages),
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      })),
    }, { signal })

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text }
        } else if (event.delta.type === 'input_json_delta') {
          yield { type: 'tool_use_delta', toolUse: { id: '', name: '', input: event.delta.partial_json } }
        }
      } else if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          yield { type: 'tool_use_start', toolUse: { id: event.content_block.id, name: event.content_block.name, input: '' } }
        }
      } else if (event.type === 'content_block_stop') {
        yield { type: 'tool_use_end' }
      } else if (event.type === 'message_stop') {
        yield { type: 'message_end', usage: { inputTokens: 0, outputTokens: 0 } }
      }
    }
  }

  private formatMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.map(block => {
          if (block.type === 'text') return { type: 'text' as const, text: block.text }
          if (block.type === 'tool_use') return { type: 'tool_use' as const, id: block.id, name: block.name, input: block.input }
          if (block.type === 'tool_result') return { type: 'tool_result' as const, tool_use_id: block.tool_use_id, content: block.content }
          return block
        }),
      }))
  }

  private mapContentBlock(block: Anthropic.ContentBlock): ContentBlock {
    if (block.type === 'text') return { type: 'text', text: block.text }
    if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> }
    return { type: 'text', text: '' }
  }
}
