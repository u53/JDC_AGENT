import { z } from 'zod'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface TextContent {
  type: 'text'
  text: string
}

export interface ToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultContent {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export interface ImageContent {
  type: 'image'
  source: {
    type: 'base64'
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    data: string
  }
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent | ImageContent | ThinkingContent

export interface Message {
  id: string
  role: MessageRole
  content: ContentBlock[]
  timestamp: number
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface StreamChunk {
  type: 'text_delta' | 'thinking_delta' | 'thinking_end' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'message_end' | 'compact_complete'
  text?: string
  signature?: string
  toolUse?: { id: string; name: string; input: string }
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
  compactInfo?: {
    originalCount: number
    keptCount: number
    memoriesExtracted: number
  }
}

export interface PromptSegment {
  content: string
  cacheable: boolean
}

export interface ModelConfig {
  model: string
  maxTokens: number
  temperature?: number
  systemPrompt?: string | PromptSegment[]
  thinking?: boolean
  thinkingBudget?: number
  contextWindow?: number
  compressAt?: number
}

export interface SessionConfig {
  id: string
  projectName: string
  cwd: string
  modelConfig: ModelConfig
}

export const AppConfigSchema = z.object({
  defaultProvider: z.enum(['anthropic', 'openai', 'custom', 'ollama']).default('anthropic'),
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  customEndpoint: z.string().optional(),
  ollamaEndpoint: z.string().default('http://localhost:11434'),
  defaultModel: z.string().default('claude-sonnet-4-6'),
  theme: z.enum(['dark', 'light']).default('dark'),
})

export type AppConfig = z.infer<typeof AppConfigSchema>
