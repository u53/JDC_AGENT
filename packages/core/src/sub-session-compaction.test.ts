import { describe, expect, it, vi } from 'vitest'
import { runSubSession } from './sub-session.js'
import { ToolRegistry } from './tool-registry.js'
import type { Message, ModelConfig, ToolDefinition } from './types.js'
import type { ModelProvider } from './model-provider.js'
import { ContextPromptSnapshotCache } from './context/prompt-snapshot-cache.js'
import type { ContextProvider } from './context/orchestrator.js'
import type { ContextRequest } from './context/types.js'

describe('sub-session compaction', () => {
  it('compacts long sub-session history and continues with compacted messages', async () => {
    const foregroundMessages: Message[][] = []
    let compactCalls = 0
    const provider: ModelProvider = {
      name: 'sub-compact-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        if (typeof config.systemPrompt === 'string' && config.systemPrompt.includes('specialist at creating detailed')) {
          compactCalls++
          yield { type: 'text_delta', text: '<summary>Sub-session recovered summary.</summary>' }
          yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } }
          return
        }
        foregroundMessages.push(messages.map(m => ({ ...m, content: [...m.content] })))
        if (foregroundMessages.length < 5) {
          const id = `tool_${foregroundMessages.length}`
          yield { type: 'tool_use_start', toolUse: { id, name: 'Read', input: '' } }
          yield { type: 'tool_use_delta', toolUse: { id, name: 'Read', input: '{"file_path":"large.ts"}' } }
          yield { type: 'tool_use_end' }
          yield { type: 'message_end', usage: { inputTokens: 1000, outputTokens: 10 } }
          return
        }
        yield { type: 'text_delta', text: 'done after sub compact' }
        yield { type: 'message_end', usage: { inputTokens: 100, outputTokens: 10 } }
      },
    } as any

    const result = await runSubSession({
      prompt: 'long worker task',
      provider,
      toolRegistry: registryWithLargeRead(),
      modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 1200, compressAt: 0.5 },
      cwd: process.cwd(),
      maxTurns: 8,
      onStreamHeartbeat: vi.fn(),
    })

    expect(result.content).toBe('done after sub compact')
    expect(compactCalls).toBeGreaterThan(0)
    expect(JSON.stringify(foregroundMessages.at(-1))).toContain('Sub-session recovered summary')
  })

  it('continues fail-open when sub-session compaction fails', async () => {
    const foregroundMessages: Message[][] = []
    let compactCalls = 0
    const provider: ModelProvider = {
      name: 'sub-compact-fail-open-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        if (typeof config.systemPrompt === 'string' && config.systemPrompt.includes('specialist at creating detailed')) {
          compactCalls++
          throw new Error('compact stream failed')
        }
        foregroundMessages.push(messages.map(m => ({ ...m, content: [...m.content] })))
        if (foregroundMessages.length < 5) {
          const id = `tool_${foregroundMessages.length}`
          yield { type: 'tool_use_start', toolUse: { id, name: 'Read', input: '' } }
          yield { type: 'tool_use_delta', toolUse: { id, name: 'Read', input: '{"file_path":"large.ts"}' } }
          yield { type: 'tool_use_end' }
          yield { type: 'message_end', usage: { inputTokens: 1000, outputTokens: 10 } }
          return
        }
        yield { type: 'text_delta', text: 'done after failed compact' }
        yield { type: 'message_end', usage: { inputTokens: 100, outputTokens: 10 } }
      },
    } as any

    const result = await runSubSession({
      prompt: 'long worker task with failing compaction',
      provider,
      toolRegistry: registryWithLargeRead(),
      modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 1200, compressAt: 0.5 },
      cwd: process.cwd(),
      maxTurns: 8,
    })

    expect(result.content).toBe('done after failed compact')
    expect(compactCalls).toBeGreaterThan(0)
  })

  it('reuses a rendered context prompt for identical sub-session actor intent inside the snapshot window', async () => {
    const cache = new ContextPromptSnapshotCache({ now: () => 10_000 })
    let collectCount = 0
    const prompts: string[] = []
    const provider: ModelProvider = {
      name: 'sub-session-context-cache-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (_messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        const text = Array.isArray(config.systemPrompt)
          ? config.systemPrompt.map(segment => segment.content).join('\n')
          : String(config.systemPrompt ?? '')
        prompts.push(text)
        yield { type: 'text_delta', text: `done ${prompts.length}` }
        yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } }
      },
    }
    const contextProvider: ContextProvider = {
      id: 'runtime',
      collect: async (_request: ContextRequest) => {
        collectCount++
        return {
          evidence: [],
          sections: [{
            id: `sub_memory_${collectCount}`,
            kind: 'memory',
            title: 'Sub memory context',
            content: `Sub memory snapshot ${collectCount}`,
            citations: [],
            priority: 90,
            confidence: 0.9,
            freshness: 'live',
            sourceProvider: 'RuntimeSignalProvider',
            tokenEstimate: 4,
          }],
          diagnostics: [],
          health: { id: 'runtime', status: 'enabled', updatedAt: 1 },
        }
      },
    }
    const store = {
      saveRawEvidence: async () => ({ ok: true, value: undefined, diagnostics: [] }),
      saveBundleSnapshot: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
      saveDiagnostic: async () => ({ ok: true, value: undefined, diagnostics: [] }),
      queryFacts: async () => ({ ok: true, value: [], diagnostics: [] }),
      listAcceptedProjectFacts: async () => ({ ok: true, value: [], diagnostics: [] }),
      enforceQuotas: async () => ({ ok: true, value: { deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 }, diagnostics: [] }),
    }

    await runSubSession({
      prompt: 'inspect cache behavior',
      provider,
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 128_000 },
      cwd: process.cwd(),
      maxTurns: 1,
      subSessionId: 'sub_cache_1',
      contextEngine: {
        sessionId: 'parent_session',
        config: { enabled: true, injectionEnabled: true, harvestEnabled: false },
        store: store as any,
        providers: [contextProvider],
        promptSnapshotCache: cache,
      },
    })
    await runSubSession({
      prompt: ' inspect   cache behavior ',
      provider,
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 128_000 },
      cwd: process.cwd(),
      maxTurns: 1,
      subSessionId: 'sub_cache_1',
      contextEngine: {
        sessionId: 'parent_session',
        config: { enabled: true, injectionEnabled: true, harvestEnabled: false },
        store: store as any,
        providers: [contextProvider],
        promptSnapshotCache: cache,
      },
    })

    expect(collectCount).toBe(1)
    expect(store.saveBundleSnapshot).toHaveBeenCalledTimes(1)
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('Sub memory snapshot 1')
    expect(prompts[1]).toBe(prompts[0])
  })
})

function registryWithLargeRead(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({
    definition: { name: 'Read', description: 'fake read', inputSchema: {} },
    execute: async () => ({ content: 'x'.repeat(5000), isError: false }),
  } as any)
  return registry
}
