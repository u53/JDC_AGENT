import Anthropic from '@anthropic-ai/sdk'
import type { ModelProvider } from '../model-provider.js'
import type { ContentBlock, Message, ModelConfig, PromptSegment, StreamChunk, ToolDefinition } from '../types.js'
import { joinSegments } from '../context.js'
import { parseThinkTags } from './think-parser.js'

function resolveSystemPrompt(systemPrompt?: string | PromptSegment[]): string | undefined {
  if (!systemPrompt) return undefined
  if (typeof systemPrompt === 'string') return systemPrompt
  return joinSegments(systemPrompt)
}

export class AnthropicProvider implements ModelProvider {
  name = 'anthropic'
  private client: Anthropic
  private apiKey: string
  private baseURL: string

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey
    this.baseURL = baseURL || 'https://api.anthropic.com'
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
      system: resolveSystemPrompt(config.systemPrompt),
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
    const formattedMessages = this.formatMessages(messages)
    const hasThinkingBlocks = formattedMessages.some((m: any) =>
      Array.isArray(m.content) && m.content.some((b: any) => b.type === 'thinking')
    )

    const params: any = {
      model: config.model,
      max_tokens: config.maxTokens,
      system: resolveSystemPrompt(config.systemPrompt),
      messages: formattedMessages,
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      })),
      stream: true,
    }

    if (config.thinking) {
      params.thinking = {
        type: 'enabled',
        budget_tokens: config.thinkingBudget || Math.min(config.maxTokens * 0.8, 10000),
      }
      delete params.temperature
    }

    if (hasThinkingBlocks) {
      yield* this.streamRaw(params, signal)
    } else {
      yield* this.streamSDK(params, signal)
    }
  }

  private async *streamSDK(params: any, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    delete params.stream
    const stream = this.client.messages.stream(params, { signal })

    let usage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
    let insideThink = false
    let pendingText = ''

    for await (const event of stream) {
      if (event.type === 'message_start') {
        const msg = (event as any).message
        if (msg?.usage) {
          usage.inputTokens = msg.usage.input_tokens || 0
          usage.outputTokens = msg.usage.output_tokens || 0
          usage.cacheCreationInputTokens = msg.usage.cache_creation_input_tokens || 0
          usage.cacheReadInputTokens = msg.usage.cache_read_input_tokens || 0
        }
      } else if (event.type === 'message_delta') {
        const delta = (event as any).usage
        if (delta) {
          usage.outputTokens = delta.output_tokens || usage.outputTokens
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          pendingText += event.delta.text
          const result = parseThinkTags(pendingText, insideThink)
          for (const chunk of result.chunks) yield chunk
          pendingText = result.remaining
          insideThink = result.insideThink
        } else if (event.delta.type === 'input_json_delta') {
          yield { type: 'tool_use_delta', toolUse: { id: '', name: '', input: event.delta.partial_json } }
        } else if ((event.delta as any).type === 'thinking_delta') {
          yield { type: 'thinking_delta', text: (event.delta as any).thinking }
        } else if ((event.delta as any).type === 'signature_delta') {
          yield { type: 'thinking_end', signature: (event.delta as any).signature }
        }
      } else if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          yield { type: 'tool_use_start', toolUse: { id: event.content_block.id, name: event.content_block.name, input: '' } }
        } else if ((event.content_block as any).type === 'thinking') {
          yield { type: 'thinking_delta', text: '' }
        }
      } else if (event.type === 'content_block_stop') {
        if (pendingText) {
          if (insideThink) {
            yield { type: 'thinking_delta', text: pendingText }
          } else {
            yield { type: 'text_delta', text: pendingText }
          }
          pendingText = ''
        }
        yield { type: 'tool_use_end' }
      } else if (event.type === 'message_stop') {
        if (pendingText) {
          if (insideThink) {
            yield { type: 'thinking_delta', text: pendingText }
          } else {
            yield { type: 'text_delta', text: pendingText }
          }
          pendingText = ''
        }
        yield { type: 'message_end', usage }
      }
    }
  }

  private async *streamRaw(params: any, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const url = this.baseURL.replace(/\/$/, '') + '/v1/messages'
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(params),
      signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`${response.status} ${text}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let usage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
    let insideThink = false
    let pendingText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue

        let event: any
        try { event = JSON.parse(data) } catch { continue }

        if (event.type === 'message_start') {
          if (event.message?.usage) {
            usage.inputTokens = event.message.usage.input_tokens || 0
            usage.outputTokens = event.message.usage.output_tokens || 0
            usage.cacheCreationInputTokens = event.message.usage.cache_creation_input_tokens || 0
            usage.cacheReadInputTokens = event.message.usage.cache_read_input_tokens || 0
          }
        } else if (event.type === 'message_delta') {
          if (event.usage) {
            usage.outputTokens = event.usage.output_tokens || usage.outputTokens
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') {
            pendingText += event.delta.text
            const result = parseThinkTags(pendingText, insideThink)
            for (const chunk of result.chunks) yield chunk
            pendingText = result.remaining
            insideThink = result.insideThink
          } else if (event.delta?.type === 'input_json_delta') {
            yield { type: 'tool_use_delta', toolUse: { id: '', name: '', input: event.delta.partial_json } }
          } else if (event.delta?.type === 'thinking_delta') {
            yield { type: 'thinking_delta', text: event.delta.thinking }
          } else if (event.delta?.type === 'signature_delta') {
            yield { type: 'thinking_end', signature: event.delta.signature }
          }
        } else if (event.type === 'content_block_start') {
          if (event.content_block?.type === 'tool_use') {
            yield { type: 'tool_use_start', toolUse: { id: event.content_block.id, name: event.content_block.name, input: '' } }
          } else if (event.content_block?.type === 'thinking') {
            yield { type: 'thinking_delta', text: '' }
          }
        } else if (event.type === 'content_block_stop') {
          if (pendingText) {
            if (insideThink) {
              yield { type: 'thinking_delta', text: pendingText }
            } else {
              yield { type: 'text_delta', text: pendingText }
            }
            pendingText = ''
          }
          yield { type: 'tool_use_end' }
        } else if (event.type === 'message_stop') {
          if (pendingText) {
            if (insideThink) {
              yield { type: 'thinking_delta', text: pendingText }
            } else {
              yield { type: 'text_delta', text: pendingText }
            }
            pendingText = ''
          }
          yield { type: 'message_end', usage }
        }
      }
    }
  }

  private formatMessages(messages: Message[]): Anthropic.MessageParam[] {
    const raw = (messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const content = m.content
          .map(block => {
            if (block.type === 'text') return { type: 'text' as const, text: block.text }
            if (block.type === 'image') return { type: 'image' as const, source: { type: 'base64' as const, media_type: block.source.media_type, data: block.source.data } }
            if (block.type === 'tool_use') return { type: 'tool_use' as const, id: block.id, name: block.name, input: block.input }
            if (block.type === 'tool_result') return { type: 'tool_result' as const, tool_use_id: block.tool_use_id, content: block.content }
            if (block.type === 'thinking') return { type: 'thinking' as const, thinking: block.thinking, signature: block.signature || '' }
            return { type: 'text' as const, text: '' }
          }).filter((b: any) => !(b.type === 'text' && b.text === ''))

        return { role: m.role as 'user' | 'assistant', content }
      })).filter((m: any) => Array.isArray(m.content) && m.content.length > 0) as any[]

    // Anthropic requires strict user/assistant alternation — merge consecutive same-role messages
    const merged: Anthropic.MessageParam[] = []
    for (const msg of raw) {
      const last = merged[merged.length - 1]
      if (last && last.role === msg.role) {
        const lastContent = Array.isArray(last.content) ? last.content : [{ type: 'text' as const, text: last.content }]
        const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text' as const, text: msg.content }]
        last.content = [...lastContent, ...msgContent] as any
      } else {
        merged.push(msg)
      }
    }

    // Ensure first message is user role
    if (merged.length > 0 && merged[0].role !== 'user') {
      merged.unshift({ role: 'user', content: [{ type: 'text', text: '.' }] })
    }

    // Fix orphaned tool_results: Anthropic requires tool_result to immediately follow
    // the assistant message containing the matching tool_use. Convert orphaned ones to text.
    const validToolUseIds = new Set<string>()
    for (let i = 0; i < merged.length; i++) {
      const m = merged[i]
      const content = Array.isArray(m.content) ? m.content : []

      if (m.role === 'assistant') {
        validToolUseIds.clear()
        for (const b of content) {
          if ((b as any).type === 'tool_use') validToolUseIds.add((b as any).id)
        }
      } else if (m.role === 'user') {
        const fixedContent: any[] = []
        for (const b of content) {
          if ((b as any).type === 'tool_result') {
            if (validToolUseIds.has((b as any).tool_use_id)) {
              fixedContent.push(b)
              validToolUseIds.delete((b as any).tool_use_id)
            } else {
              fixedContent.push({ type: 'text', text: `[Tool output: ${(b as any).content?.slice(0, 200) || ''}]` })
            }
          } else {
            fixedContent.push(b)
          }
        }
        m.content = fixedContent as any
        validToolUseIds.clear()
      }
    }

    // Also remove tool_use blocks from assistant messages that have no following tool_result
    for (let i = 0; i < merged.length - 1; i++) {
      if (merged[i].role === 'assistant') {
        const content = Array.isArray(merged[i].content) ? merged[i].content as any[] : []
        const toolUseIds = content.filter((b: any) => b.type === 'tool_use').map((b: any) => b.id)
        if (toolUseIds.length === 0) continue

        const nextMsg = merged[i + 1]
        if (nextMsg.role !== 'user') continue
        const nextContent = Array.isArray(nextMsg.content) ? nextMsg.content as any[] : []
        const resultIds = new Set(nextContent.filter((b: any) => b.type === 'tool_result').map((b: any) => b.tool_use_id))

        const orphanedToolUses = toolUseIds.filter((id: string) => !resultIds.has(id))
        if (orphanedToolUses.length > 0) {
          merged[i].content = content.filter((b: any) => b.type !== 'tool_use' || !orphanedToolUses.includes(b.id)) as any
          if ((merged[i].content as any[]).length === 0) {
            merged[i].content = [{ type: 'text', text: '.' }] as any
          }
        }
      }
    }

    return merged
  }

  private mapContentBlock(block: Anthropic.ContentBlock): ContentBlock {
    if (block.type === 'text') return { type: 'text', text: block.text }
    if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> }
    return { type: 'text', text: '' }
  }
}
