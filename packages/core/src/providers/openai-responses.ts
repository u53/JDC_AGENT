import OpenAI from 'openai'
import type { ModelProvider } from '../model-provider.js'
import type { ContentBlock, Message, ModelConfig, PromptSegment, ReasoningEffort, StreamChunk, ToolDefinition } from '../types.js'
import { ThinkTagStreamParser } from './think-parser.js'
import { withStreamRetry } from './stream-retry.js'
import { getModelTraits } from './model-traits.js'
import { formatOpenAIDynamicPrompt, resolveOpenAIPromptParts } from './openai-prompt.js'

function resolveSystemPrompt(systemPrompt?: string | PromptSegment[]): string | undefined {
  return resolveOpenAIPromptParts(systemPrompt).stablePrompt
}

export const __openAiResponsesPromptTest = {
  resolveSystemPrompt,
  resolvePromptParts: resolveOpenAIPromptParts,
}

function effortToOpenAI(effort: ReasoningEffort): 'low' | 'medium' | 'high' | 'xhigh' {
  if (effort === 'max') return 'xhigh'
  return effort
}

function buildBaseParams(config: ModelConfig, tools: ToolDefinition[], formatTools: (t: ToolDefinition[]) => any, instructions?: string): Record<string, unknown> {
  const traits = getModelTraits(config.model)
  const params: Record<string, unknown> = {
    model: config.model,
    instructions,
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
  content?: string | any[]
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
  private defaultClient: OpenAI
  private baseURL: string
  private apiKey: string

  constructor(apiKey: string, baseURL?: string) {
    const url = baseURL && !baseURL.endsWith('/v1') && !baseURL.endsWith('/v1/') ? `${baseURL}/v1` : baseURL
    this.apiKey = apiKey
    this.baseURL = (url || 'https://api.openai.com/v1').replace(/\/+$/, '')
    this.client = new OpenAI({
      apiKey,
      ...(url ? { baseURL: url } : {}),
    })
    this.defaultClient = this.client
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ) {
    const promptParts = resolveOpenAIPromptParts(config.systemPrompt)
    const params = {
      ...buildBaseParams(config, tools, this.formatTools.bind(this), promptParts.stablePrompt),
      input: this.formatInput(messages, promptParts.dynamicPrompt),
    }

    const response = (await this.createResponse(params, signal)) as ResponsesResult

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
    return this.streamWithCompatibilityFallback(messages, tools, config, signal)
  }

  private async *streamWithCompatibilityFallback(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    // Retry only before the first chunk — the OpenAI SDK's maxRetries covers
    // the initial create() call but NOT a socket dropped mid-iteration of the
    // stream. withStreamRetry closes that gap for transient drops.
    try {
      yield* withStreamRetry(
        () => this.streamOnce(messages, tools, config, signal),
        signal,
        undefined,
        config.onStreamRetry,
      )
    } catch (err) {
      if (signal?.aborted || !isStreamingBlockedByProxy(err)) throw err
      yield* this.streamNonStreamingResponse(messages, tools, config, signal)
    }
  }

  private async *streamOnce(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const promptParts = resolveOpenAIPromptParts(config.systemPrompt)
    const params = {
      ...buildBaseParams(config, tools, this.formatTools.bind(this), promptParts.stablePrompt),
      input: this.formatInput(messages, promptParts.dynamicPrompt),
      stream: true,
    }

    const stream = await this.createResponse(params, signal) as AsyncIterable<any>

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

  private async *streamNonStreamingResponse(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const result = await this.chat(messages, tools, config, signal)
    for (const block of result.content) {
      if (block.type === 'text' && block.text) {
        yield { type: 'text_delta', text: block.text }
      } else if (block.type === 'thinking' && block.thinking) {
        yield { type: 'thinking_delta', text: block.thinking }
        yield { type: 'thinking_end', signature: block.signature }
      } else if (block.type === 'tool_use') {
        yield { type: 'tool_use_start', toolUse: { id: block.id, name: block.name, input: '' } }
        yield { type: 'tool_use_delta', toolUse: { id: '', name: '', input: JSON.stringify(block.input) } }
        yield { type: 'tool_use_end' }
      }
    }
    yield { type: 'message_end', usage: result.usage }
  }

  private formatTools(tools: ToolDefinition[]): ResponsesTool[] {
    return tools.map(t => ({
      type: 'function' as const,
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }))
  }

  private async createResponse(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    // Unit tests often replace `client` with a small mock. Runtime uses raw fetch
    // to avoid OpenAI SDK Stainless headers that some compatible proxies block.
    if (this.client !== this.defaultClient) {
      return (this.client as any).responses.create(params, { signal })
    }

    const response = await fetch(`${this.baseURL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: params.stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(params),
      signal,
    })

    if (!response.ok) {
      throw await buildResponsesFetchError(response)
    }

    if (params.stream) {
      return parseResponsesSse(response)
    }

    return response.json()
  }

  private formatInput(messages: Message[], dynamicPrompt?: string): ResponsesInput[] {
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

    const filtered = merged.filter((item: any) => {
      if (item.type === 'function_call_output' && !functionCallIds.has(item.call_id)) {
        return false
      }
      if (item.type === 'function_call' && !functionOutputIds.has(item.call_id)) {
        return false
      }
      return true
    })

    return this.withDynamicPrompt(filtered, dynamicPrompt)
  }

  private withDynamicPrompt(input: ResponsesInput[], dynamicPrompt?: string): ResponsesInput[] {
    if (!dynamicPrompt) return input
    const dynamicText = formatOpenAIDynamicPrompt(dynamicPrompt)
    const dynamicInput: ResponsesInput = { role: 'system', content: dynamicText }

    input.unshift(dynamicInput)
    return input
  }
}

function isStreamingBlockedByProxy(err: unknown): boolean {
  const e = err as any
  const message = String(e?.message ?? e)
  const statusFromMessage = /^\s*(\d{3})\b/.exec(message)?.[1]
  const status = typeof e?.status === 'number'
    ? e.status
    : typeof e?.statusCode === 'number'
      ? e.statusCode
      : typeof e?.response?.status === 'number'
        ? e.response.status
        : statusFromMessage
          ? Number(statusFromMessage)
          : undefined
  const haystack = [
    message,
    e?.code,
    e?.error?.message,
    e?.response?.statusText,
    e?.response?.data,
  ].filter(Boolean).join(' ').toLowerCase()
  return status === 403 && /blocked|forbidden/.test(haystack)
}

async function buildResponsesFetchError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '')
  let detail = text
  try {
    const parsed = JSON.parse(text)
    detail = parsed?.error?.message || parsed?.message || text
  } catch {
    // keep raw text
  }
  const message = [String(response.status), response.statusText, detail].filter(Boolean).join(' ')
  const error = new Error(message)
  ;(error as any).status = response.status
  ;(error as any).response = { status: response.status, statusText: response.statusText, data: text }
  return error
}

async function* parseResponsesSse(response: Response): AsyncIterable<unknown> {
  const body = response.body
  if (!body) throw new Error('Responses stream did not include a response body')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      yield* drainSseBuffer(buffer, (remaining) => { buffer = remaining })
    }
    buffer += decoder.decode()
    yield* drainSseBuffer(buffer, (remaining) => { buffer = remaining }, true)
  } finally {
    reader.releaseLock()
  }
}

function* drainSseBuffer(buffer: string, setRemaining: (remaining: string) => void, flush = false): Iterable<unknown> {
  while (true) {
    const boundary = findSseBoundary(buffer)
    if (boundary.index < 0) break
    const rawEvent = buffer.slice(0, boundary.index)
    buffer = buffer.slice(boundary.index + boundary.length)
    const parsed = parseSseEvent(rawEvent)
    if (parsed !== undefined) yield parsed
  }

  if (flush && buffer.trim()) {
    const parsed = parseSseEvent(buffer)
    if (parsed !== undefined) yield parsed
    buffer = ''
  }

  setRemaining(buffer)
}

function findSseBoundary(buffer: string): { index: number; length: number } {
  const candidates = ['\r\n\r\n', '\n\n', '\r\r']
    .map(separator => ({ index: buffer.indexOf(separator), length: separator.length }))
    .filter(candidate => candidate.index >= 0)
    .sort((a, b) => a.index - b.index)
  return candidates[0] ?? { index: -1, length: 0 }
}

function parseSseEvent(rawEvent: string): unknown | undefined {
  const data = rawEvent
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
    .trim()
  if (!data || data === '[DONE]') return undefined
  return JSON.parse(data)
}
