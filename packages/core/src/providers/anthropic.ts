import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import type { ModelProvider } from '../model-provider.js'
import type { ContentBlock, Message, ModelConfig, PromptSegment, ReasoningEffort, StreamChunk, ToolDefinition } from '../types.js'
import { joinSegments } from '../context.js'
import { ThinkTagStreamParser } from './think-parser.js'
import { withStreamRetry } from './stream-retry.js'

const CC_VERSION = '2.1.139'
const FINGERPRINT_SALT = '59cf53e54c78'

// Stable device_id and session_id per process run. metadata.user_id must
// not change across requests in the same conversation, or some relays use
// it as a cache key and miss the prompt cache.
const STABLE_DEVICE_ID = (globalThis as any).__JDC_DEVICE_ID__
  || ((globalThis as any).__JDC_DEVICE_ID__ = (globalThis as any).crypto?.randomUUID?.() || Math.random().toString(36).slice(2))
const STABLE_SESSION_ID = (globalThis as any).__JDC_SESSION_ID__
  || ((globalThis as any).__JDC_SESSION_ID__ = (globalThis as any).crypto?.randomUUID?.() || Math.random().toString(36).slice(2))

// Client Code Hash. The relay only checks it exists and is non-zero, but it sits
// in system[0] (the billing header) — which is part of the cached prefix — so it
// MUST be byte-stable across turns. Generate once per process; never per-request
// (a per-request cch changes system[0] and kills every downstream cache read).
const STABLE_CCH = (() => {
  const seed = `${STABLE_DEVICE_ID}${STABLE_SESSION_ID}${CC_VERSION}`
  const h = createHash('sha256').update(seed).digest('hex').slice(0, 5)
  return h === '00000' ? 'a1b2c' : h
})()

function computeFingerprint(firstUserText: string): string {
  const indices = [4, 7, 20]
  const chars = indices.map(i => firstUserText[i] || '0').join('')
  const hash = createHash('sha256').update(`${FINGERPRINT_SALT}${chars}${CC_VERSION}`).digest('hex')
  return hash.slice(0, 3)
}

function getAttributionHeader(fingerprint: string): string {
  const version = `${CC_VERSION}.${fingerprint}`
  return `x-anthropic-billing-header: cc_version=${version}; cc_entrypoint=cli; cch=${STABLE_CCH};`
}

// Canonical Claude Code beta header set (docs/claude-code-impersonation.md). The
// relay validates the request against the real CC fingerprint and only serves
// prompt-cache READS for the canonical shape — `claude-code-20250219` is the core
// identity and the full string is what genuine CC sends. Keep this list byte-exact
// and in this order; do NOT trim it to "look cleaner" — deviating drops the relay
// to a write-only / non-CC path. Order is stable across requests so it never
// perturbs the cached prefix.
const STREAM_BETAS = [
  'interleaved-thinking-2025-05-14',
  'claude-code-20250219',
  'context-1m-2025-08-07',
  'token-efficient-tools-2026-03-28',
  'structured-outputs-2025-12-15',
  'effort-2025-11-24',
  'prompt-caching-scope-2026-01-05',
] as const

export function buildStreamBetas(): string[] {
  return [...STREAM_BETAS]
}

// --- Prompt-cache diagnostic (opt-in via JDC_CACHE_DEBUG) ---------------------
// Logs a per-block hash of the cached prefix (betas + tools + each system block)
// and flags which block CHANGED from the previous request in this process. If the
// relay keeps returning cache writes only, the changed block is the silent
// invalidator; if nothing changes across turns yet reads stay zero, the problem
// is the relay/account, not our prompt shape.
const __lastPrefixHashes: string[] = []
let __debugRequestSeq = 0
function sha8(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 8)
}
function summarizeCacheBreakpoints(params: any, betaHeaders: string, requestSeq: number): void {
  const system = Array.isArray(params.system) ? params.system : (params.system ? [{ text: params.system }] : [])
  const messages = Array.isArray(params.messages) ? params.messages : []
  const messageBreakpoints: string[] = []
  const messageShape = messages.map((message: any, mi: number) => {
    const content = Array.isArray(message.content) ? message.content : (message.content ? [{ type: 'text', text: message.content }] : [])
    const types = content.map((block: any, bi: number) => {
      if (block?.cache_control) messageBreakpoints.push(`messages[${mi}].${message.role}[${bi}].${block.type || 'unknown'}`)
      return `${block?.type || typeof block}${block?.cache_control ? '*' : ''}`
    })
    return `${mi}:${message.role}:${types.join(',')}`
  })
  const summary = {
    requestSeq,
    pid: process.pid,
    model: params.model,
    betasHash: sha8(betaHeaders),
    toolCount: (params.tools || []).length,
    toolHash: sha8(JSON.stringify(params.tools || [])),
    toolCacheCount: (params.tools || []).filter((tool: any) => tool?.cache_control).length,
    system: system.map((block: any, index: number) => ({
      index,
      cache: Boolean(block?.cache_control),
      chars: String(block?.text || '').length,
      hash: sha8(String(block?.text || '')),
    })),
    messageBreakpoints,
    messageShape,
  }
  // eslint-disable-next-line no-console
  console.error('[jdc-cache] request', JSON.stringify(summary))
}
function debugPromptPrefix(params: any, betaHeaders: string): void {
  const blocks: Array<{ where: string; hash: string }> = []
  blocks.push({ where: 'betas', hash: sha8(betaHeaders) })
  blocks.push({ where: `tools[x${(params.tools || []).length}]`, hash: sha8(JSON.stringify(params.tools || [])) })
  const system = Array.isArray(params.system) ? params.system : (params.system ? [{ text: params.system }] : [])
  system.forEach((b: any, i: number) => blocks.push({ where: `system[${i}]${b?.cache_control ? '*' : ''}`, hash: sha8(b?.text || '') }))
  const diff = blocks.map((b, i) => ({ ...b, changed: __lastPrefixHashes[i] !== undefined && __lastPrefixHashes[i] !== b.hash }))
  __lastPrefixHashes.length = 0
  for (const b of blocks) __lastPrefixHashes.push(b.hash)
  // eslint-disable-next-line no-console
  console.error('[jdc-cache] prefix', JSON.stringify(diff))
}
function debugPromptUsage(usage: { inputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number }, requestSeq?: number): void {
  // eslint-disable-next-line no-console
  console.error('[jdc-cache] usage', JSON.stringify({ requestSeq, read: usage.cacheReadInputTokens, write: usage.cacheCreationInputTokens, uncached: usage.inputTokens }))
}

// Partition system segments into three caching tiers so the rendered prompt is
// ordered stable→volatile, which is what Anthropic prefix caching requires:
//
//   base    — cacheable, shared across actors/turns (identity, engine
//             instructions, project rules). Cached prefix #1.
//   cached  — everything byte-stable across turns: base prompt (identity, engine
//             instructions, rules) + the auto-injected <jdc-context-engine>
//             snapshot bundle (cacheable:true). MERGED into ONE block with a
//             single cache_control.
//   dynamic — non-cacheable, changes every turn (active tasks, model groups,
//             per-request markers). Never marked, sits after the cached block.
//
// IMPORTANT — relay shape contract (docs/claude-code-impersonation.md): the relay
// validates the request against the canonical Claude Code shape and only serves
// prompt-cache READS for it. That shape is: system[0] = billing header (no
// cache_control), system[1] = ONE merged cacheable block, optional dynamic tail.
// Do NOT split the cacheable content across multiple breakpoints — extra system
// blocks / breakpoints deviate from the fingerprint and the relay falls back to
// write-only (and >4-5 system blocks 400s upstream).
function partitionSystemSegments(segments: PromptSegment[]): { cached: string[]; dynamic: string[] } {
  const base: string[] = []
  const engine: string[] = []
  const dynamic: string[] = []
  for (const seg of segments) {
    if (!seg.content) continue
    if (seg.jdcContextEngine) engine.push(seg.content)
    else if (seg.cacheable) base.push(seg.content)
    else dynamic.push(seg.content)
  }
  // base first, then the engine snapshot — one stable cacheable prefix.
  return { cached: [...base, ...engine], dynamic }
}

function resolveSystemPrompt(systemPrompt?: string | PromptSegment[]): any {
  if (!systemPrompt) return undefined
  if (typeof systemPrompt === 'string') return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]

  const { cached, dynamic } = partitionSystemSegments(systemPrompt)
  const blocks: any[] = []
  if (cached.length > 0) blocks.push({ type: 'text', text: cached.join('\n\n'), cache_control: { type: 'ephemeral' } })
  if (dynamic.length > 0) blocks.push({ type: 'text', text: dynamic.join('\n\n') })
  return blocks
}

function resolveStreamSystemPrompt(systemPrompt: string | PromptSegment[] | undefined, attribution: string): any[] {
  const result: any[] = []

  // Block 0: billing/attribution header (no cache_control, stable across turns).
  if (attribution) {
    result.push({ type: 'text', text: attribution })
  }

  if (typeof systemPrompt === 'string') {
    // JDC CODE owns the assistant identity. Keep Anthropic request shape as
    // official text blocks, but never prepend a conflicting Claude Code persona.
    result.push({ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } })
    return result
  }

  const { cached, dynamic } = partitionSystemSegments(systemPrompt || [])

  // Block 1: the single merged cacheable block (base + engine snapshot). ONE
  // breakpoint — this is the shape the relay caches against.
  if (cached.length > 0) {
    result.push({ type: 'text', text: cached.join('\n\n'), cache_control: { type: 'ephemeral' } })
  }

  // Block 2: dynamic content (no cache_control — changes every turn).
  if (dynamic.length > 0) {
    result.push({ type: 'text', text: dynamic.join('\n\n') })
  }

  return result
}

export const __anthropicPromptTest = {
  resolveSystemPrompt,
  resolveStreamSystemPrompt,
}

function effortToBudget(effort: ReasoningEffort, maxTokens: number): number {
  const reserve = 4096
  const ceiling = Math.max(1024, maxTokens - reserve)
  const target = effort === 'low' ? 4_000
    : effort === 'medium' ? 10_000
    : effort === 'high' ? 16_000
    : effort === 'xhigh' ? 24_000
    : maxTokens - reserve
  return Math.max(1024, Math.min(target, ceiling))
}

function applyEffort(params: any, config: ModelConfig): void {
  params.thinking = { type: 'adaptive' }
  delete params.temperature
  delete params.top_p
  delete params.top_k
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
    const params: any = {
      model: config.model,
      max_tokens: config.maxTokens,
      system: resolveSystemPrompt(config.systemPrompt),
      messages: this.formatMessages(messages),
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      })),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    }
    applyEffort(params, config)
    const response = await this.client.messages.create(params, { signal })

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

    // Compute fingerprint from first user message text (matches Claude Code's algorithm)
    let firstUserText = ''
    for (const m of formattedMessages) {
      if (m.role === 'user') {
        const content = Array.isArray(m.content) ? m.content : []
        const textBlock = content.find((b: any) => b.type === 'text') as any
        if (textBlock) firstUserText = textBlock.text
        break
      }
    }
    const fingerprint = computeFingerprint(firstUserText)
    const attribution = getAttributionHeader(fingerprint)

    const injectedSystem = resolveStreamSystemPrompt(config.systemPrompt, attribution)

    const params: any = {
      model: config.model,
      max_tokens: config.maxTokens,
      system: injectedSystem,
      messages: formattedMessages,
      tools: tools.map((t) => {
        const tool: any = {
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
        }
        return tool
      }),
      stream: true,
      metadata: {
        user_id: JSON.stringify({
          device_id: STABLE_DEVICE_ID,
          account_uuid: '',
          session_id: STABLE_SESSION_ID,
        }),
      },
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    }

    applyEffort(params, config)

    yield* this.streamRaw(params, signal, config.onStreamRetry)
  }

  private async *streamSDK(params: any, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    delete params.stream
    const stream = this.client.messages.stream(params, { signal })

    let usage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
    const thinkParser = new ThinkTagStreamParser()
    let currentBlockType: string | undefined

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
          const chunks = currentBlockType === 'thinking'
            ? thinkParser.writeThinking(event.delta.text)
            : thinkParser.writeText(event.delta.text)
          for (const chunk of chunks) yield chunk
        } else if (event.delta.type === 'input_json_delta') {
          yield { type: 'tool_use_delta', toolUse: { id: '', name: '', input: event.delta.partial_json } }
        } else if ((event.delta as any).type === 'thinking_delta') {
          for (const chunk of thinkParser.writeThinking((event.delta as any).thinking)) yield chunk
        } else if ((event.delta as any).type === 'signature_delta') {
          yield { type: 'thinking_end', signature: (event.delta as any).signature }
        }
      } else if (event.type === 'content_block_start') {
        currentBlockType = (event.content_block as any).type
        if (event.content_block.type === 'tool_use') {
          for (const chunk of thinkParser.flush()) yield chunk
          yield { type: 'tool_use_start', toolUse: { id: event.content_block.id, name: event.content_block.name, input: '' } }
        } else if ((event.content_block as any).type === 'thinking') {
          for (const chunk of thinkParser.startThinking()) yield chunk
        }
      } else if (event.type === 'content_block_stop') {
        const chunks = currentBlockType === 'thinking'
          ? thinkParser.endThinking()
          : thinkParser.flush()
        for (const chunk of chunks) yield chunk
        currentBlockType = undefined
        yield { type: 'tool_use_end' }
      } else if (event.type === 'message_stop') {
        for (const chunk of thinkParser.flush()) yield chunk
        yield { type: 'message_end', usage }
      }
    }
  }

  // A streaming response cannot be resumed once it has emitted content
  // (Anthropic SSE has no replay), so retries only apply before the first
  // chunk — see withStreamRetry. Mid-flight failures surface to the caller
  // (the PM layer already counts consecutive failures and falls back).
  private streamRaw(
    params: any,
    signal?: AbortSignal,
    onRetry?: ModelConfig['onStreamRetry'],
  ): AsyncIterable<StreamChunk> {
    return withStreamRetry(
      () => this.streamRawOnce(params, signal),
      signal,
      undefined,
      onRetry,
    )
  }

  private async *streamRawOnce(params: any, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const url = this.baseURL.replace(/\/$/, '') + '/v1/messages?beta=true'
    const betaHeaders = buildStreamBetas().join(',')
    // Canonical Claude Code header envelope (docs/claude-code-impersonation.md).
    // x-client-request-id is per-request by design in real CC and is NOT part of
    // the prompt-cache key (genuine CC reads cache with it), so it is restored to
    // match the validated fingerprint.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': betaHeaders,
      'User-Agent': `claude-cli/${CC_VERSION} (consumer, cli)`,
      'x-app': 'cli',
      'X-Claude-Code-Session-Id': STABLE_SESSION_ID,
      'x-client-request-id': (globalThis as any).crypto?.randomUUID?.() || `${Date.now()}`,
      'X-Stainless-Lang': 'js',
      'X-Stainless-Package-Version': '0.39.0',
      'X-Stainless-OS': process.platform,
      'X-Stainless-Arch': process.arch,
      'X-Stainless-Runtime': 'node',
      'X-Stainless-Runtime-Version': process.versions.node,
      'x-stainless-retry-count': '0',
    }
    const debugRequestSeq = process.env.JDC_CACHE_DEBUG ? ++__debugRequestSeq : undefined
    if (process.env.JDC_CACHE_DEBUG) {
      summarizeCacheBreakpoints(params, betaHeaders, debugRequestSeq!)
      debugPromptPrefix(params, betaHeaders)
    }
    const body = JSON.stringify(params)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
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
    const thinkParser = new ThinkTagStreamParser()
    let currentBlockType: string | undefined

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        // SSE spec allows both 'data: <value>' and 'data:<value>' — strip leading
        // spaces from value (Anthropic official adds the space; some gateways don't)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trimStart()
        if (!data || data === '[DONE]') continue

        let event: any
        try { event = JSON.parse(data) } catch { continue }

        if (event.type === 'message_start') {
          if (event.message?.usage) {
            usage.inputTokens = event.message.usage.input_tokens || 0
            usage.outputTokens = event.message.usage.output_tokens || 0
            usage.cacheCreationInputTokens = event.message.usage.cache_creation_input_tokens || 0
            usage.cacheReadInputTokens = event.message.usage.cache_read_input_tokens || 0
            if (process.env.JDC_CACHE_DEBUG) debugPromptUsage(usage, debugRequestSeq)
          }
        } else if (event.type === 'message_delta') {
          if (event.usage) {
            usage.outputTokens = event.usage.output_tokens || usage.outputTokens
            if (event.usage.cache_read_input_tokens !== undefined) {
              usage.cacheReadInputTokens = event.usage.cache_read_input_tokens || 0
            }
            if (event.usage.cache_creation_input_tokens !== undefined) {
              usage.cacheCreationInputTokens = event.usage.cache_creation_input_tokens || 0
            }
            if (event.usage.input_tokens !== undefined) {
              usage.inputTokens = event.usage.input_tokens || 0
            }
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') {
            const chunks = currentBlockType === 'thinking'
              ? thinkParser.writeThinking(event.delta.text)
              : thinkParser.writeText(event.delta.text)
            for (const chunk of chunks) yield chunk
          } else if (event.delta?.type === 'input_json_delta') {
            yield { type: 'tool_use_delta', toolUse: { id: '', name: '', input: event.delta.partial_json } }
          } else if (event.delta?.type === 'thinking_delta') {
            for (const chunk of thinkParser.writeThinking(event.delta.thinking)) yield chunk
          } else if (event.delta?.type === 'signature_delta') {
            yield { type: 'thinking_end', signature: event.delta.signature }
          }
        } else if (event.type === 'content_block_start') {
          currentBlockType = event.content_block?.type
          if (event.content_block?.type === 'tool_use') {
            for (const chunk of thinkParser.flush()) yield chunk
            yield { type: 'tool_use_start', toolUse: { id: event.content_block.id, name: event.content_block.name, input: '' } }
          } else if (event.content_block?.type === 'thinking') {
            for (const chunk of thinkParser.startThinking()) yield chunk
          }
        } else if (event.type === 'content_block_stop') {
          const chunks = currentBlockType === 'thinking'
            ? thinkParser.endThinking()
            : thinkParser.flush()
          for (const chunk of chunks) yield chunk
          currentBlockType = undefined
          yield { type: 'tool_use_end' }
        } else if (event.type === 'message_stop') {
          for (const chunk of thinkParser.flush()) yield chunk
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

    this.addLatestMessageCacheMarker(merged)

    return merged
  }

  private addLatestMessageCacheMarker(messages: Anthropic.MessageParam[]): void {
    const latest = messages[messages.length - 1]
    if (!latest) return

    if (!Array.isArray(latest.content)) {
      latest.content = [{ type: 'text', text: String(latest.content || '') }] as any
    }

    const content = latest.content as any[]
    if (content.length === 0) return

    const target = latest.role === 'assistant'
      ? [...content].reverse().find((block: any) => block.type !== 'thinking' && block.type !== 'redacted_thinking')
      : content[content.length - 1]

    if (target) target.cache_control = { type: 'ephemeral' }
  }

  private mapContentBlock(block: Anthropic.ContentBlock): ContentBlock {
    if (block.type === 'text') return { type: 'text', text: block.text }
    if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> }
    return { type: 'text', text: '' }
  }
}
