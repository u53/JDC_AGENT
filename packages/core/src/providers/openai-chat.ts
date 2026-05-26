import OpenAI from 'openai'
import type { ModelProvider } from '../model-provider.js'
import type { ContentBlock, Message, ModelConfig, PromptSegment, ReasoningEffort, StreamChunk, ToolDefinition } from '../types.js'
import { joinSegments } from '../context.js'
import { ThinkTagStreamParser } from './think-parser.js'
import { getModelTraits } from './model-traits.js'

function resolveSystemPrompt(systemPrompt?: string | PromptSegment[]): string | undefined {
  if (!systemPrompt) return undefined
  if (typeof systemPrompt === 'string') return systemPrompt
  return joinSegments(systemPrompt)
}

function effortToOpenAI(effort: ReasoningEffort): 'low' | 'medium' | 'high' | 'xhigh' {
  if (effort === 'max') return 'xhigh'
  return effort
}

function buildBaseParams(config: ModelConfig): Record<string, any> {
  const traits = getModelTraits(config.model)
  const params: Record<string, any> = { model: config.model }

  if (traits.useMaxCompletionTokens) {
    params.max_completion_tokens = config.maxTokens
  } else {
    params.max_tokens = config.maxTokens
  }

  if (!traits.rejectsTemperature && config.temperature !== undefined) {
    params.temperature = config.temperature
  }

  if (config.effort && traits.isReasoning) {
    params.reasoning_effort = effortToOpenAI(config.effort)
  }

  // Prompt-cache routing. Same key → same cache shard, dramatically improves
  // hit rate when many parallel sub-agents share a stable system prefix.
  if (config.cacheKey) params.prompt_cache_key = config.cacheKey
  if (config.cacheUser) params.user = config.cacheUser

  return params
}

export class OpenAIChatProvider implements ModelProvider {
  name = 'openai'
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
      ...buildBaseParams(config),
      messages: this.formatMessages(messages, resolveSystemPrompt(config.systemPrompt)),
      ...(tools.length > 0 ? { tools: this.formatTools(tools) } : {}),
    } as OpenAI.ChatCompletionCreateParamsNonStreaming

    const response = await this.client.chat.completions.create(params, { signal })

    const choice = response.choices[0]
    if (!choice) {
      return {
        content: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    }

    const content: ContentBlock[] = []

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content })
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.type === 'function') {
          let parsedArgs: Record<string, unknown> = {}
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}')
          } catch {
            // Malformed JSON from API — fall back to empty object
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parsedArgs,
          })
        }
      }
    }

    return {
      content,
      usage: {
        inputTokens: (response.usage?.prompt_tokens ?? 0) - ((response.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0),
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadInputTokens: (response.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0,
      },
    }
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const params = {
      ...buildBaseParams(config),
      messages: this.formatMessages(messages, resolveSystemPrompt(config.systemPrompt)),
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 ? { tools: this.formatTools(tools) } : {}),
    } as OpenAI.ChatCompletionCreateParamsStreaming

    const stream = await this.client.chat.completions.create(params, { signal })

    let toolCallsStarted = 0
    const thinkParser = new ThinkTagStreamParser()

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as any
      const finishReason = chunk.choices[0]?.finish_reason

      if (delta?.reasoning_content) {
        for (const c of thinkParser.writeThinking(delta.reasoning_content)) yield c
      }

      if (delta?.content) {
        for (const c of thinkParser.writeText(delta.content)) yield c
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            // Close previous tool call before starting a new one
            if (toolCallsStarted > 0) {
              yield { type: 'tool_use_end' }
            }
            toolCallsStarted++
            yield {
              type: 'tool_use_start',
              toolUse: { id: tc.id || '', name: tc.function.name, input: '' },
            }
          }
          if (tc.function?.arguments) {
            yield {
              type: 'tool_use_delta',
              toolUse: { id: '', name: '', input: tc.function.arguments },
            }
          }
        }
      }

      if (finishReason === 'tool_calls') {
        // Flush remaining pendingText before tool calls
        for (const c of thinkParser.flush()) yield c
        // Close the last open tool call
        if (toolCallsStarted > 0) {
          yield { type: 'tool_use_end' }
        }
      } else if (finishReason === 'stop') {
        // Flush remaining pendingText
        for (const c of thinkParser.flush()) yield c
        yield {
          type: 'message_end',
          usage: {
            inputTokens: (chunk.usage?.prompt_tokens ?? 0) - ((chunk.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0),
            outputTokens: chunk.usage?.completion_tokens ?? 0,
            cacheReadInputTokens: (chunk.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0,
          },
        }
      }

      // Final chunk with usage (stream_options: include_usage)
      if (!chunk.choices.length && chunk.usage) {
        yield {
          type: 'message_end',
          usage: {
            inputTokens: (chunk.usage.prompt_tokens ?? 0) - ((chunk.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0),
            outputTokens: chunk.usage.completion_tokens ?? 0,
            cacheReadInputTokens: (chunk.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0,
          },
        }
      }
    }
  }

  private formatTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }))
  }

  private formatMessages(
    messages: Message[],
    systemPrompt?: string
  ): OpenAI.ChatCompletionMessageParam[] {
    const formatted: OpenAI.ChatCompletionMessageParam[] = []

    if (systemPrompt) {
      formatted.push({ role: 'system', content: systemPrompt })
    }

    for (const msg of messages) {
      if (msg.role === 'system') continue

      const textBlocks = msg.content.filter(b => b.type === 'text')
      const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use')
      const toolResultBlocks = msg.content.filter(b => b.type === 'tool_result')
      const imageBlocks = msg.content.filter(b => b.type === 'image')

      // Handle user messages with images using content array format
      if (msg.role === 'user' && imageBlocks.length > 0 && toolResultBlocks.length === 0) {
        const parts: any[] = []
        for (const block of msg.content) {
          if (block.type === 'text') parts.push({ type: 'text', text: block.text })
          if (block.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } })
        }
        formatted.push({ role: 'user', content: parts })
        continue
      }

      if (toolResultBlocks.length > 0) {
        for (const block of toolResultBlocks) {
          if (block.type === 'tool_result') {
            formatted.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: block.content,
            })
          }
        }
        // If there are also text blocks alongside tool_result, emit them as a separate user message
        if (textBlocks.length > 0) {
          const text = textBlocks
            .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
            .map(b => b.text)
            .join('\n')
          if (text) {
            formatted.push({ role: 'user', content: text })
          }
        }
      } else if (msg.role === 'assistant') {
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
        }
        const thinkingBlocks = msg.content.filter(b => b.type === 'thinking')
        if (thinkingBlocks.length > 0) {
          const thinking = thinkingBlocks
            .filter((b): b is Extract<typeof b, { type: 'thinking' }> => b.type === 'thinking')
            .map(b => b.thinking)
            .join('')
          if (thinking) {
            ;(assistantMsg as any).reasoning_content = thinking
          }
        }
        if (textBlocks.length > 0) {
          assistantMsg.content = textBlocks
            .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
            .map(b => b.text)
            .join('\n')
        }
        if (toolUseBlocks.length > 0) {
          assistantMsg.tool_calls = toolUseBlocks
            .filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use')
            .map(b => ({
              id: b.id,
              type: 'function' as const,
              function: {
                name: b.name,
                arguments: JSON.stringify(b.input),
              },
            }))
        }
        formatted.push(assistantMsg)
      } else {
        const text = textBlocks
          .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
          .map(b => b.text)
          .join('\n')
        formatted.push({ role: 'user', content: text })
      }
    }

    // Merge consecutive user messages (OpenAI doesn't strictly require alternation but it's cleaner)
    const merged: OpenAI.ChatCompletionMessageParam[] = []
    for (const msg of formatted) {
      const last = merged[merged.length - 1]
      if (last && last.role === 'user' && msg.role === 'user') {
        const lastText = typeof last.content === 'string' ? last.content : ''
        const msgText = typeof msg.content === 'string' ? msg.content : ''
        last.content = lastText + '\n' + msgText
      } else {
        merged.push(msg)
      }
    }

    // Fix orphaned tool messages: each tool message's tool_call_id must match
    // a tool_call in a preceding assistant message
    const validToolCallIds = new Set<string>()
    for (const msg of merged) {
      if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          validToolCallIds.add(tc.id)
        }
      }
    }

    const result = merged.filter(msg => {
      if (msg.role === 'tool') {
        const toolMsg = msg as OpenAI.ChatCompletionToolMessageParam
        return validToolCallIds.has(toolMsg.tool_call_id)
      }
      return true
    })

    // Also remove tool_calls from assistant messages that have no matching tool response
    const toolResponseIds = new Set(
      result.filter((m): m is OpenAI.ChatCompletionToolMessageParam => m.role === 'tool').map(m => m.tool_call_id)
    )
    for (const msg of result) {
      if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
        const filtered = msg.tool_calls.filter(tc => toolResponseIds.has(tc.id))
        if (filtered.length === 0) {
          delete (msg as any).tool_calls
        } else {
          msg.tool_calls = filtered
        }
      }
    }

    return result
  }
}
