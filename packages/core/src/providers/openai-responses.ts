import OpenAI from 'openai'
import type { ModelProvider } from '../model-provider.js'
import type { ContentBlock, Message, ModelConfig, PromptSegment, StreamChunk, ToolDefinition } from '../types.js'
import { joinSegments } from '../context.js'

function resolveSystemPrompt(systemPrompt?: string | PromptSegment[]): string | undefined {
  if (!systemPrompt) return undefined
  if (typeof systemPrompt === 'string') return systemPrompt
  return joinSegments(systemPrompt)
}

interface ResponsesInput {
  role?: string
  type?: string
  content?: string
  call_id?: string
  output?: string
}

interface ResponsesTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface ResponsesOutputText {
  type: 'output_text'
  text: string
}

interface ResponsesMessageItem {
  type: 'message'
  content: ResponsesOutputText[]
}

interface ResponsesFunctionCallItem {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

type ResponsesOutputItem = ResponsesMessageItem | ResponsesFunctionCallItem

interface ResponsesResult {
  output: ResponsesOutputItem[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    input_tokens_details?: { cached_tokens?: number }
  }
}

export class OpenAIResponsesProvider implements ModelProvider {
  name = 'openai-responses'
  private client: OpenAI

  constructor(apiKey: string, baseURL?: string) {
    const url = baseURL && !baseURL.endsWith('/v1') && !baseURL.endsWith('/v1/') ? `${baseURL}/v1` : baseURL
    this.client = new OpenAI({
      apiKey,
      ...(url ? { baseURL: url } : {}),
    })
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ) {
    const maxOutput = config.maxTokens > 32768 ? 16384 : config.maxTokens
    const systemPrompt = resolveSystemPrompt(config.systemPrompt)
    const params: Record<string, unknown> = {
      model: config.model,
      instructions: systemPrompt,
      input: this.formatInput(messages),
      ...(tools.length > 0 ? { tools: this.formatTools(tools) } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      ...(maxOutput ? { max_output_tokens: maxOutput } : {}),
    }

    const response = (await (this.client as any).responses.create(params, { signal })) as ResponsesResult

    if (!response.output || response.output.length === 0) {
      return {
        content: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    }

    const content: ContentBlock[] = []

    for (const item of response.output) {
      if (item.type === 'message') {
        for (const part of item.content) {
          if (part.type === 'output_text') {
            content.push({ type: 'text', text: part.text })
          }
        }
      } else if (item.type === 'function_call') {
        let parsedArgs: Record<string, unknown> = {}
        try {
          parsedArgs = JSON.parse(item.arguments || '{}')
        } catch {
          // Malformed JSON from API — fall back to empty object
        }
        content.push({
          type: 'tool_use',
          id: item.call_id,
          name: item.name,
          input: parsedArgs,
        })
      }
    }

    return {
      content,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      },
    }
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const maxOutput = config.maxTokens > 32768 ? 16384 : config.maxTokens
    const systemPrompt = resolveSystemPrompt(config.systemPrompt)
    const params: Record<string, unknown> = {
      model: config.model,
      instructions: systemPrompt,
      input: this.formatInput(messages),
      stream: true,
      ...(tools.length > 0 ? { tools: this.formatTools(tools) } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      ...(maxOutput ? { max_output_tokens: maxOutput } : {}),
    }

    const stream = await (this.client as any).responses.create(params, { signal })

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield { type: 'text_delta', text: event.delta }
      } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        yield {
          type: 'tool_use_start',
          toolUse: { id: event.item.call_id || '', name: event.item.name || '', input: '' },
        }
      } else if (event.type === 'response.function_call_arguments.delta') {
        yield {
          type: 'tool_use_delta',
          toolUse: { id: '', name: '', input: event.delta },
        }
      } else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
        yield { type: 'tool_use_end' }
      } else if (event.type === 'response.completed') {
        const usage = event.response?.usage
        yield {
          type: 'message_end',
          usage: {
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
            cacheReadInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
          },
        }
      }
    }
  }

  private formatTools(tools: ToolDefinition[]): ResponsesTool[] {
    return tools.map(t => ({
      type: 'function' as const,
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }))
  }

  private formatInput(messages: Message[]): ResponsesInput[] {
    const input: ResponsesInput[] = []

    for (const msg of messages) {
      if (msg.role === 'system') continue

      const textBlocks = msg.content.filter(b => b.type === 'text')
      const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use')
      const toolResultBlocks = msg.content.filter(b => b.type === 'tool_result')
      const imageBlocks = msg.content.filter(b => b.type === 'image')

      // Handle user messages with images
      if (msg.role === 'user' && imageBlocks.length > 0 && toolResultBlocks.length === 0) {
        const parts: any[] = []
        for (const block of msg.content) {
          if (block.type === 'text') parts.push({ type: 'input_text', text: block.text })
          if (block.type === 'image') parts.push({ type: 'input_image', image_url: `data:${block.source.media_type};base64,${block.source.data}` })
        }
        input.push({ role: 'user', content: parts as any })
        continue
      }

      // Tool results (function_call_output)
      if (toolResultBlocks.length > 0) {
        for (const block of toolResultBlocks) {
          if (block.type === 'tool_result') {
            input.push({
              type: 'function_call_output',
              call_id: block.tool_use_id,
              output: block.content,
            })
          }
        }
      }

      // Assistant messages: emit text + function_call items
      if (msg.role === 'assistant') {
        if (textBlocks.length > 0) {
          const text = textBlocks
            .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
            .map(b => b.text)
            .join('\n')
          if (text) {
            input.push({ role: 'assistant', content: text })
          }
        }
        for (const block of toolUseBlocks) {
          if (block.type === 'tool_use') {
            input.push({
              type: 'function_call',
              call_id: block.id,
              name: block.name,
              arguments: JSON.stringify(block.input),
            } as any)
          }
        }
        continue
      }

      // User text messages
      if (textBlocks.length > 0 && toolResultBlocks.length === 0) {
        const text = textBlocks
          .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
          .map(b => b.text)
          .join('\n')
        if (text) {
          input.push({ role: 'user', content: text })
        }
      }
    }

    // Merge consecutive same-role messages (user/assistant text only)
    const merged: ResponsesInput[] = []
    for (const item of input) {
      const last = merged[merged.length - 1]
      if (last && 'role' in item && 'role' in last && item.role === last.role && item.role !== 'system') {
        const lastContent = typeof last.content === 'string' ? last.content : ''
        const itemContent = typeof item.content === 'string' ? item.content : ''
        if (lastContent && itemContent) {
          last.content = lastContent + '\n' + itemContent
          continue
        }
      }
      merged.push(item)
    }

    // Fix orphaned function_call / function_call_output pairs
    const functionCallIds = new Set(
      merged.filter((item: any) => item.type === 'function_call').map((item: any) => item.call_id)
    )
    const functionOutputIds = new Set(
      merged.filter((item: any) => item.type === 'function_call_output').map((item: any) => item.call_id)
    )

    return merged.filter((item: any) => {
      if (item.type === 'function_call_output' && !functionCallIds.has(item.call_id)) {
        return false
      }
      if (item.type === 'function_call' && !functionOutputIds.has(item.call_id)) {
        return false
      }
      return true
    })
  }
}
