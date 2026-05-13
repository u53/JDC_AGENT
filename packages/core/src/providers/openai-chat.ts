import OpenAI from 'openai'
import type { ModelProvider } from '../model-provider.js'
import type { ContentBlock, Message, ModelConfig, StreamChunk, ToolDefinition } from '../types.js'

export class OpenAIChatProvider implements ModelProvider {
  name = 'openai'
  private client: OpenAI

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({
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
    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: config.model,
      max_tokens: config.maxTokens,
      messages: this.formatMessages(messages, config.systemPrompt),
      ...(tools.length > 0 ? { tools: this.formatTools(tools) } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    }

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
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    }
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: config.model,
      max_tokens: config.maxTokens,
      messages: this.formatMessages(messages, config.systemPrompt),
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 ? { tools: this.formatTools(tools) } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    }

    const stream = await this.client.chat.completions.create(params, { signal })

    let toolCallsStarted = 0

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const finishReason = chunk.choices[0]?.finish_reason

      if (delta?.content) {
        yield { type: 'text_delta', text: delta.content }
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
        // Close the last open tool call
        if (toolCallsStarted > 0) {
          yield { type: 'tool_use_end' }
        }
      } else if (finishReason === 'stop') {
        yield {
          type: 'message_end',
          usage: {
            inputTokens: chunk.usage?.prompt_tokens ?? 0,
            outputTokens: chunk.usage?.completion_tokens ?? 0,
          },
        }
      }

      // Final chunk with usage (stream_options: include_usage)
      if (!chunk.choices.length && chunk.usage) {
        yield {
          type: 'message_end',
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
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

    return formatted
  }
}
