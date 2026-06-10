import { z } from 'zod'
import type { ModelCapabilityProfile } from './model-profile.js'

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

export interface ToolResultMetadata {
  fileRead?: {
    filePath: string
    offset: number
    limit: number
    totalLines: number
    content: string
  }
  mutations?: Array<{
    filePath: string
    kind: 'edit' | 'multi_edit' | 'write'
  }>
  command?: {
    shell: 'bash' | 'powershell'
    command: string
    exitCode: number | null
  }
}

export interface ToolResultContent {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
  metadata?: ToolResultMetadata
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
  type:
    | 'text_delta'
    | 'thinking_delta'
    | 'thinking_end'
    | 'tool_use_start'
    | 'tool_use_delta'
    | 'tool_use_end'
    | 'message_end'
    | 'compact_start'
    | 'compact_progress'
    | 'compact_complete'
    | 'compact_skipped'
    | 'compact_failed'
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
    summarizedCount: number
    memoriesExtracted: number
  }
  compactSkipped?: {
    reason: 'too_short' | 'no_session' | 'in_progress'
    messageCount: number
  }
  compactFailed?: {
    reason: 'aborted' | 'empty_response' | 'stream_error'
    message?: string
  }
}

export interface PromptSegment {
  content: string
  cacheable: boolean
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ToolResultRetentionConfig {
  /**
   * Legacy pre-compaction cleanup. Defaults to false because the product
   * prioritizes evidence retention over token conservation.
   */
  microCompact?: boolean
  /** Maximum chars kept for successful tool_result blocks that survive compaction. */
  keptToolResultChars?: number
  /** Maximum chars kept for error tool_result blocks that survive compaction. */
  keptErrorToolResultChars?: number
  /** Maximum chars from old successful tool_result blocks shown to the summarizer. */
  summaryToolResultChars?: number
  /** Maximum chars from old error tool_result blocks shown to the summarizer. */
  summaryErrorToolResultChars?: number
  /** Total chars from all old tool_result blocks shown to the summarizer. */
  summaryTotalToolResultChars?: number
}

export interface ModelConfig {
  model: string
  maxTokens: number
  temperature?: number
  systemPrompt?: string | PromptSegment[]
  effort?: ReasoningEffort
  contextWindow?: number
  compressAt?: number
  toolResultRetention?: ToolResultRetentionConfig
  /**
   * Stable identifier for cache routing. Same value across calls of the
   * same role (main session / PM / specific worker role / skill router) so
   * providers can route requests to the same prompt-cache shard.
   *
   * Anthropic ignores this (uses explicit cache_control); OpenAI Chat /
   * Responses pass it as `prompt_cache_key`.
   */
  cacheKey?: string
  /**
   * End-user identifier for OpenAI abuse/safety signals. Chat Completions pass
   * this as `user`; Responses pass it as `safety_identifier`. Usually the
   * session id.
   */
  cacheUser?: string
  /**
   * Runtime model capability profile. When set, the system prompt includes
   * a Model Profile Adaptation section so the model sees strict, standard,
   * or relaxed evidence/contract expectations.
   */
  modelProfile?: ModelCapabilityProfile
  /**
   * UI/host-facing progress for provider-level stream retries. Providers call
   * this only when retrying is still protocol-safe: before any chunks have
   * been yielded for the current stream attempt.
   */
  onStreamRetry?: (
    attempt: number,
    error: Error,
    delayMs: number,
    maxRetries: number,
  ) => void
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
  theme: z.enum(['system', 'dark', 'light']).default('system'),
  themePreferenceVersion: z.number().optional(),
})

export type AppConfig = z.infer<typeof AppConfigSchema>
