import type { ContentBlock, Message, ModelConfig, StreamChunk, ToolDefinition } from './types.js'

export interface ModelProvider {
  name: string
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): Promise<{ content: ContentBlock[]; usage: { inputTokens: number; outputTokens: number } }>

  stream(
    messages: Message[],
    tools: ToolDefinition[],
    config: ModelConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk>
}
