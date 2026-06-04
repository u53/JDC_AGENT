import OpenAI from 'openai'
import type { ModelProvider } from '../model-provider.js'
import type { ContentBlock, Message, ModelConfig, PromptSegment, ReasoningEffort, StreamChunk, ToolDefinition } from '../types.js'
import { joinSegments } from '../context.js'
import { ThinkTagStreamParser } from './think-parser.js'
import { withStreamRetry } from './stream-retry.js'
import { getModelTraits } from './model-traits.js'

function resolveSystemPrompt(systemPrompt?: string | PromptSegment[]): string | undefined {
  if (!systemPrompt) return undefined
  if (typeof systemPrompt === 'string') return systemPrompt
  return joinSegments(systemPrompt)
}

export const __openAiResponsesPromptTest = {
  resolveSystemPrompt,
}

function effortToOpenAI(effort: ReasoningEffort): 'low' | 'medium' | 'high' | 'xhigh' {
  if (effort === 'max') return 'xhigh'
  return effort
}

function buildBaseParams(config: ModelConfig, tools: ToolDefinition[], formatTools: (t: ToolDefinition[]) => any): Record<string, unknown> {
  const traits = getModelTraits(config.model)
  const params: Record<string, unknown> = {
    model: config.model,
    instructions: resolveSystemPrompt(config.systemPrompt),
    store: true,
    ...(tools.length > 0 ? { tools: formatTools(tools) } : {}),
    ...(config.maxTokens ? { max_output_tokens: config.maxTokens } : {}),
  }

  if (!traits.rejectsTemperature && config.temperature !== undefined) {
    params.temperature = config.temperature
  }

  if (config.effort && traits.isReasoning) {
    params.reasoning = { effort: effortToOpenAI(config.effort), summary: 'auto' }
  }

  if (config.cacheKey) params.prompt_cache_key = config.cacheKey
  if (config.cacheUser) params.safety_identifier = config.cacheUser

  return params
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
  id?: string
  call_id: string
  name: string
  arguments: string
}

type ResponsesOutputItem = ResponsesMessageItem | ResponsesFunctionCallItem

interface PendingFunctionCall {
  outputIndex: number
  itemId?: string
  callId?: string
  name?: string
  arguments: string
  emitted: boolean
}

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
    const params = {
      ...buildBaseParams(config, tools, this.formatTools.bind(this)),
      input: this.formatInput(messages),
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
      if ((item as any).type === 'reasoning') {
        const summary = (item as any).summary
        if (Array.isArray(summary)) {
          const text = summary.map((s: any) => s.text || '').join('')
          if (text) content.push({ type: 'thinking', thinking: text })
        }
      } else if (item.type === 'message') {
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
        inputTokens: (response.usage?.input_tokens ?? 0) - (response.usage?.input_tokens_details?.cached_tokens ?? 0),
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      },
    }
  }

  stream(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    // Retry only before the first chunk — the OpenAI SDK's maxRetries covers
    // the initial create() call but NOT a socket dropped mid-iteration of the
    // stream. withStreamRetry closes that gap for transient drops.
    return withStreamRetry(() => this.streamOnce(messages, tools, config, signal), signal)
  }

  private async *streamOnce(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const params = {
      ...buildBaseParams(config, tools, this.formatTools.bind(this)),
      input: this.formatInput(messages),
      stream: true,
    }

    const stream = await (this.client as any).responses.create(params, { signal })

    const thinkParser = new ThinkTagStreamParser()
    let flushed = false
    const pendingFunctionCallsByOutput = new Map<number, PendingFunctionCall>()
    const pendingFunctionCallsByItem = new Map<string, PendingFunctionCall>()

    const getPendingFunctionCall = (
      event: { output_index?: number; item_id?: string },
      item?: Partial<ResponsesFunctionCallItem>,
    ): PendingFunctionCall => {
      const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0
      let pending = event.item_id ? pendingFunctionCallsByItem.get(event.item_id) : undefined
      if (!pending) pending = pendingFunctionCallsByOutput.get(outputIndex)
      if (!pending) {
        pending = { outputIndex, arguments: '', emitted: false }
        pendingFunctionCallsByOutput.set(outputIndex, pending)
      }
      if (event.item_id) {
        pending.itemId = event.item_id
        pendingFunctionCallsByItem.set(event.item_id, pending)
      }
      if (item?.id) {
        pending.itemId = item.id
        pendingFunctionCallsByItem.set(item.id, pending)
      }
      if (item?.call_id) pending.callId = item.call_id
      if (item?.name) pending.name = item.name
      if (typeof item?.arguments === 'string' && item.arguments.length > 0) pending.arguments = item.arguments
      return pending
    }

    const completedFunctionCallChunks = (
      item: ResponsesFunctionCallItem,
      event: { output_index?: number },
    ): StreamChunk[] => {
      const pending = getPendingFunctionCall(event, item)
      if (pending.emitted) return []
      const callId = item.call_id || pending.callId || item.id || pending.itemId || `function_call_${pending.outputIndex}`
      const name = item.name || pending.name || ''
      const args = item.arguments || pending.arguments || ''
      if (!name) return []
      pending.emitted = true
      if (pending.itemId) pendingFunctionCallsByItem.delete(pending.itemId)
      pendingFunctionCallsByOutput.delete(pending.outputIndex)
      const chunks: StreamChunk[] = [
        { type: 'tool_use_start', toolUse: { id: callId, name, input: '' } },
      ]
      if (args) chunks.push({ type: 'tool_use_delta', toolUse: { id: '', name: '', input: args } })
      chunks.push({ type: 'tool_use_end' })
      return chunks
    }

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        for (const c of thinkParser.writeText(event.delta)) yield c
      } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        getPendingFunctionCall(event, event.item)
      } else if (event.type === 'response.function_call_arguments.delta') {
        const pending = getPendingFunctionCall(event)
        pending.arguments += event.delta || ''
      } else if (event.type === 'response.function_call_arguments.done') {
        const pending = getPendingFunctionCall(event)
        pending.arguments = event.arguments || pending.arguments
        if (event.name) pending.name = event.name
      } else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
        for (const c of completedFunctionCallChunks(event.item, event)) yield c
      } else if (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') {
        if (event.delta) {
          for (const c of thinkParser.writeThinking(event.delta)) yield c
        }
      } else if (event.type === 'response.completed') {
        for (const c of thinkParser.flush()) yield c
        flushed = true
        const usage = event.response?.usage
        const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0
        yield {
          type: 'message_end',
          usage: {
            inputTokens: (usage?.input_tokens ?? 0) - cachedTokens,
            outputTokens: usage?.output_tokens ?? 0,
            cacheReadInputTokens: cachedTokens,
          },
        }
      }
    }

    if (!flushed) {
      for (const c of thinkParser.flush()) yield c
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

      // User text messages. Emitted even alongside tool_result blocks (handled
      // just above) so trailing user text in a tool-result turn isn't dropped.
      if (textBlocks.length > 0) {
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
