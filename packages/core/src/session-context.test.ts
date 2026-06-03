import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const configMock = vi.hoisted(() => ({ appConfig: {} as Record<string, any> }))

vi.mock('./config.js', () => ({
  loadAppConfig: () => configMock.appConfig,
  saveAppConfig: (config: Record<string, any>) => { configMock.appConfig = { ...configMock.appConfig, ...config } },
  getConfigDir: () => '/tmp/jdc-session-context-config',
}))
import { ConversationHistory } from './history.js'
import type { ModelProvider } from './model-provider.js'
import { Session, type SessionEvents } from './session.js'
import { runSubSession } from './sub-session.js'
import { ToolRegistry } from './tool-registry.js'
import type { Message, ModelConfig, StreamChunk, ToolDefinition } from './types.js'
import { closeAllContextStores, type ContextStoreResult } from './context/store.js'
import type { HarvestJob } from './context/types.js'
import type { ContextScheduler } from './context/scheduler.js'

const tmpDirs: string[] = []

afterEach(async () => {
  await closeAllContextStores()
  vi.restoreAllMocks()
  configMock.appConfig = {}
  rmSync('/tmp/jdc-session-context-config', { recursive: true, force: true })
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('Session JDC Context Engine runtime integration', () => {
  it('does not expose legacy SaveMemory after JDC Memory Review takes over', async () => {
    const session = await makeSession({ contextConfig: { enabled: false } as any })
    const defs = (session as any).toolRegistry.getDefinitions().map((definition: ToolDefinition) => definition.name)

    expect(defs).not.toContain('SaveMemory')
    expect(defs).not.toContain('JdcContextInspect')
    expect(defs).not.toContain('JdcContextRefresh')
    expect(defs).toContain('JdcMemorySearch')
    expect(defs).toContain('JdcMemoryWrite')
  })

  it('shares live accepted context facts across same-cwd session stores', async () => {
    const dir = makeTempDir()
    const history = new ConversationHistory(path.join(dir, 'history.db'))
    await history.ensureReady()
    history.createSession('session_a', 'Project', dir)
    history.createSession('session_b', 'Project', dir)
    const modelConfig = { model: 'test-model', maxTokens: 1024, contextWindow: 128_000 }
    const sessionA = new Session({ id: 'session_a', projectName: 'Project', cwd: dir, modelConfig }, providerFromChunks([{ type: 'text_delta', text: 'ok' }]), history)
    const sessionB = new Session({ id: 'session_b', projectName: 'Project', cwd: path.join(dir, '.'), modelConfig }, providerFromChunks([{ type: 'text_delta', text: 'ok' }]), history)

    const storeA = await (sessionA as any).getContextStore()
    const storeB = await (sessionB as any).getContextStore()
    await storeA.saveRawEvidence({
      id: 'session_a_file',
      sessionId: 'session_a',
      cwd: dir,
      sourceProvider: 'SessionTestProvider',
      kind: 'file',
      content: 'export const shared = true',
      metadata: { file: 'src/shared.ts' },
      capturedAt: 1_000,
      hash: 'hash_shared',
    })
    await storeA.saveFact({
      id: 'session_a_fact',
      kind: 'workflow_rule',
      scope: 'project',
      content: 'Same-cwd sessions share the live project context store.',
      citations: [{ id: 'cit_session_file', type: 'file', ref: 'src/shared.ts', hash: 'hash_shared' }],
      confidence: 0.91,
      freshness: 'recent',
      sourceProvider: 'SessionTestProvider',
      sessionId: 'session_a',
      createdAt: 1_000,
      updatedAt: 1_000,
    })

    const factsFromSessionB = await storeB.listAcceptedProjectFacts()

    expect(factsFromSessionB.value).toMatchObject([
      { id: 'session_a_fact', sessionId: 'session_a' },
    ])
  })

  it('compacts conversation history without extracting legacy file-based memories', async () => {
    const compactOutput = `<summary>Compacted only.</summary><memories>[{"name":"legacy-memory","type":"feedback","description":"Legacy memory","content":"Do not write this."}]</memories>`
    const events = makeEvents()
    const session = await makeSession({
      provider: providerFromChunks(compactChunks(compactOutput)),
      contextConfig: { enabled: false } as any,
      modelConfig: { contextWindow: 200, compressAt: 0.1 },
    })
    seedMessagesForCompaction(session)

    await session.sendMessage('trigger compaction', events)

    expect(events.onStreamChunk).toHaveBeenCalledWith(expect.objectContaining({
      type: 'compact_complete',
      compactInfo: expect.objectContaining({ memoriesExtracted: 0 }),
    }))
    expect(existsSync(path.join('/tmp/jdc-session-context-config', 'projects'))).toBe(false)
  })

  it('injects a protocol-neutral context bundle before streaming and falls back when bundle generation fails', async () => {
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'done' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], (_messages, config) => {
        const text = textFromSystemPrompt(config.systemPrompt)
        expect(text).toContain('<jdc-context-engine bundle="ctx_test">')
        expect(text).toContain('Runtime context')
      }),
      contextConfig: { injectionEnabled: true, harvestEnabled: false },
      contextStore: makeContextStore(),
      contextProviders: [{
        id: 'runtime',
        collect: async () => ({
          evidence: [],
          sections: [{
            id: 'section_runtime',
            kind: 'runtime_state',
            title: 'Runtime context',
            content: 'Runtime context',
            citations: [{ id: 'cit_tool', type: 'tool_event', ref: 'tool_1' }],
            priority: 90,
            confidence: 0.9,
            freshness: 'live',
            sourceProvider: 'RuntimeSignalProvider',
            tokenEstimate: 4,
          }],
          diagnostics: [],
          health: { id: 'runtime', status: 'enabled', updatedAt: 1 },
        }),
      }],
      contextId: () => 'ctx_test',
    })

    await session.sendMessage('use context', makeEvents())

    const fallbackSession = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'still works' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], (_messages, config) => {
        expect(textFromSystemPrompt(config.systemPrompt)).not.toContain('<jdc-context-engine bundle=')
      }),
      contextConfig: { injectionEnabled: true, harvestEnabled: false },
      contextStore: makeContextStore({ queryError: new Error('context store unavailable') }),
    })

    await fallbackSession.sendMessage('context failure should not fail chat', makeEvents())
    expect(fallbackSession.getMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'still works' }])
  })

  it('does not inject context when injection is disabled but can still enqueue harvest after runLoop completion', async () => {
    const store = makeContextStore()
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'remembered' },
        { type: 'message_end', usage: { inputTokens: 8, outputTokens: 3 } },
      ], (_messages, config) => {
        expect(textFromSystemPrompt(config.systemPrompt)).not.toContain('<jdc-context-engine bundle=')
      }),
      contextConfig: { injectionEnabled: false, harvestEnabled: true },
      contextStore: store,
      providerProtocol: 'openai-chat',
      modelGroupId: 'group_1',
      baseUrl: 'https://models.local',
    })

    await session.sendMessage('Remember that runtime harvest uses current-session binding.', makeEvents())

    expect(store.savedHarvestJobs).toHaveLength(1)
    expect(store.savedHarvestJobs[0]).toMatchObject({
      sessionId: session.id,
      status: 'queued',
      modelBinding: {
        sessionId: session.id,
        providerProtocol: 'openai-chat',
        modelId: 'test-model',
        modelGroupId: 'group_1',
        baseUrl: 'https://models.local',
        contextWindow: 128_000,
      },
    })
    expect(store.savedHarvestJobs[0]?.candidate.assistantMessages[0]?.content).toEqual([{ type: 'text', text: 'remembered' }])
  })

  it('captures the completion-time model binding for Anthropic, OpenAI Chat, and OpenAI Responses harvest jobs', async () => {
    for (const providerProtocol of ['anthropic', 'openai-chat', 'openai-responses'] as const) {
      const store = makeContextStore()
      const session = await makeSession({
        provider: providerFromChunks([
          { type: 'thinking_delta', text: 'raw hidden reasoning' },
          { type: 'text_delta', text: `done with ${providerProtocol}` },
          { type: 'message_end', usage: { inputTokens: 12, outputTokens: 4 } },
        ]),
        contextConfig: { injectionEnabled: false, harvestEnabled: true },
        contextStore: store,
        providerProtocol,
        modelConfig: { model: `${providerProtocol}-model`, maxTokens: 2048, contextWindow: 64_000 },
      })

      await session.sendMessage(`Remember ${providerProtocol} binding`, makeEvents())

      expect(store.savedHarvestJobs).toHaveLength(1)
      expect(store.savedHarvestJobs[0]?.modelBinding).toMatchObject({
        sessionId: session.id,
        providerProtocol,
        modelId: `${providerProtocol}-model`,
        contextWindow: 64_000,
      })
      expect(JSON.stringify(store.savedHarvestJobs[0]?.candidate)).not.toContain('raw hidden reasoning')
    }
  })

  it('captures production session modelGroupId and baseUrl for all protocols without storing secrets or reasoning metadata', async () => {
    for (const providerProtocol of ['anthropic', 'openai-chat', 'openai-responses'] as const) {
      const sessionModelId = `stored_${providerProtocol}_model`
      const modelId = `${providerProtocol}-current-session-model`
      const protocolInConfig = providerProtocol === 'openai-chat' ? 'openai' : providerProtocol
      configMock.appConfig = {
        modelGroups: {
          activeModelId: 'global_default_model',
          groups: [
            {
              id: `session_group_${providerProtocol}`,
              name: `Session ${providerProtocol}`,
              protocol: protocolInConfig,
              apiKey: 'sk-should-never-be-captured',
              baseUrl: `https://session-${providerProtocol}.models.local`,
              models: [{ id: sessionModelId, modelId, maxTokens: 2048, contextWindow: 96_000 }],
            },
            {
              id: 'global_default_group',
              name: 'Wrong global default',
              protocol: 'anthropic',
              baseUrl: 'https://wrong-global-default.models.local',
              models: [{ id: 'global_default_model', modelId: 'wrong-global-model', maxTokens: 1024, contextWindow: 32_000 }],
            },
          ],
        },
      }
      const store = makeContextStore()
      const session = await makeSession({
        provider: providerFromChunks([
          { type: 'thinking_delta', text: 'raw hidden reasoning from provider' },
          { type: 'text_delta', text: `done with ${providerProtocol}` },
          { type: 'message_end', usage: { inputTokens: 12, outputTokens: 4 } },
        ]),
        contextConfig: { injectionEnabled: false, harvestEnabled: true },
        contextStore: store,
        modelConfig: {
          model: modelId,
          maxTokens: 2048,
          contextWindow: 96_000,
          apiKey: 'sk-model-config-secret',
          headers: { Authorization: 'Bearer secret-header' },
          reasoning: 'raw reasoning summary must not persist',
          thinking: 'raw thinking must not persist',
        } as any,
        sessionModelId,
        runtimeProtocol: protocolInConfig,
      })

      await session.sendMessage(`Remember production metadata for ${providerProtocol}.`, makeEvents())

      await waitFor(() => store.savedHarvestJobs.length === 1)
      const binding = store.savedHarvestJobs[0]!.modelBinding
      expect(binding).toMatchObject({
        sessionId: session.id,
        providerProtocol,
        modelId,
        modelGroupId: `session_group_${providerProtocol}`,
        baseUrl: `https://session-${providerProtocol}.models.local`,
        contextWindow: 96_000,
      })
      expect(binding.modelConfig).toMatchObject({ model: modelId, maxTokens: 2048, contextWindow: 96_000 })
      expect((binding.modelConfig as any).apiKey).toBeUndefined()
      expect((binding.modelConfig as any).headers).toBeUndefined()
      expect((binding.modelConfig as any).reasoning).toBeUndefined()
      expect((binding.modelConfig as any).thinking).toBeUndefined()
      expect(JSON.stringify(binding)).not.toContain('sk-should-never-be-captured')
      expect(JSON.stringify(binding)).not.toContain('wrong-global-default')
      expect(JSON.stringify(store.savedHarvestJobs[0]!.candidate)).not.toContain('raw hidden reasoning')
    }
  })

  it('starts harvest asynchronously after foreground chat completes instead of blocking runLoop', async () => {
    const store = makeContextStore({ saveHarvestJobDelayMs: 250 })
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'fast foreground' },
        { type: 'message_end', usage: { inputTokens: 7, outputTokens: 3 } },
      ]),
      contextConfig: { injectionEnabled: false, harvestEnabled: true },
      contextStore: store,
      providerProtocol: 'anthropic',
    })

    const start = Date.now()
    await session.sendMessage('Remember async harvest behavior', makeEvents())
    const elapsedMs = Date.now() - start

    expect(elapsedMs).toBeLessThan(200)
    expect(session.getMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'fast foreground' }])
  })

  it('schedules completed runLoop harvest through the project scheduler interval before running harvest work', async () => {
    const store = makeContextStore()
    const scheduler = makeManualScheduler()
    const session = await makeSession({
      provider: providerWithDistillerNoop([
        { type: 'text_delta', text: 'manual scheduler complete' },
        { type: 'message_end', usage: { inputTokens: 9, outputTokens: 3 } },
      ]),
      contextConfig: {
        injectionEnabled: false,
        harvestEnabled: true,
        harvest: { minIntervalMs: 12_345 },
        performance: { harvestMinIntervalMs: 99_999 },
      },
      contextStore: store,
      scheduler,
      providerProtocol: 'anthropic',
    })

    await session.sendMessage('Remember that scheduler harvest waits for assistant completion.', makeEvents())

    expect(session.getMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'manual scheduler complete' }])
    expect(scheduler.backgroundJobs).toHaveLength(1)
    expect(scheduler.backgroundJobs[0]).toMatchObject({
      projectKey: session.config.cwd,
      name: 'harvest',
      options: { minIntervalMs: 12_345 },
    })
    expect(store.savedHarvestJobs).toEqual([])

    await scheduler.backgroundJobs[0]!.task(new AbortController().signal)

    expect(store.savedHarvestJobs).toHaveLength(1)
    expect(store.savedHarvestJobs[0]?.candidate.assistantMessages[0]?.content).toEqual([{ type: 'text', text: 'manual scheduler complete' }])
  })

  it('skips low-value turns before creating harvest jobs and avoids overlapping background harvest', async () => {
    const lowValueStore = makeContextStore()
    const lowValueSession = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'hello there' },
        { type: 'message_end', usage: { inputTokens: 4, outputTokens: 2 } },
      ]),
      contextConfig: { injectionEnabled: false, harvestEnabled: true },
      contextStore: lowValueStore,
    })

    await lowValueSession.sendMessage('hi', makeEvents())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(lowValueStore.savedHarvestJobs).toEqual([])

    const store = makeContextStore({ saveHarvestJobDelayMs: 250 })
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'first harvest' },
        { type: 'message_end', usage: { inputTokens: 9, outputTokens: 3 } },
      ]),
      contextConfig: { injectionEnabled: false, harvestEnabled: true },
      contextStore: store,
      providerProtocol: 'anthropic',
    })

    await session.sendMessage('Remember the first production context fact.', makeEvents())
    await session.sendMessage('Remember the second production context fact.', makeEvents())

    await waitFor(() => store.savedHarvestJobs.length >= 1)
    expect(store.savedHarvestJobs).toHaveLength(1)
  })

  it('records harvest budget skips as info diagnostics instead of false errors', async () => {
    const store = makeContextStore()
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'remembered' },
        { type: 'message_end', usage: { inputTokens: 9, outputTokens: 3 } },
      ]),
      contextConfig: {
        injectionEnabled: false,
        harvestEnabled: true,
        harvest: { maxJobsPerSession: 0 },
      } as any,
      contextStore: store,
      providerProtocol: 'anthropic',
    })

    await session.sendMessage('Remember the budget diagnostic behavior.', makeEvents())
    await waitFor(() => store.saveDiagnostic.mock.calls.length > 0)

    expect(store.saveDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      source: 'SessionContextRuntime',
      message: 'Harvest skipped: max 0 jobs per session reached',
    }))
    expect(store.saveDiagnostic).not.toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      message: expect.stringContaining('Harvest skipped: max 0 jobs per session reached'),
    }))
  })
})

describe('Sub-session JDC Context Engine runtime integration', () => {
  it('injects configured context and enqueues harvest with the current sub-session model binding', async () => {
    const store = makeContextStore()
    const dir = makeTempDir()

    const result = await runSubSession({
      prompt: 'Remember sub-session model binding.',
      provider: providerFromChunks([
        { type: 'thinking_delta', text: 'hidden sub-session reasoning' },
        { type: 'text_delta', text: 'sub-session done' },
        { type: 'message_end', usage: { inputTokens: 9, outputTokens: 4 } },
      ], (_messages, config) => {
        expect(textFromSystemPrompt(config.systemPrompt)).toContain('<jdc-context-engine bundle="ctx_sub">')
      }),
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'sub-model', maxTokens: 1024, contextWindow: 32_000 },
      cwd: dir,
      maxTurns: 1,
      contextEngine: {
        sessionId: 'sub_session_1',
        config: { enabled: true, injectionEnabled: true, harvestEnabled: true },
        store,
        providers: [{
          id: 'conversation',
          collect: async () => ({
            evidence: [],
            sections: [{
              id: 'section_sub',
              kind: 'conversation_state',
              title: 'Sub context',
              content: 'Sub-session context',
              citations: [{ id: 'cit_sub', type: 'message', ref: 'sub_session_1:user' }],
              priority: 90,
              confidence: 0.9,
              freshness: 'live',
              sourceProvider: 'ConversationSignalProvider',
              tokenEstimate: 5,
            }],
            diagnostics: [],
            health: { id: 'conversation', status: 'enabled', updatedAt: 1 },
          }),
        }],
        id: () => 'ctx_sub',
        protocol: 'openai-responses',
        modelGroupId: 'group_sub',
        baseUrl: 'https://sub.models.local',
      },
    })

    expect(result.content).toBe('sub-session done')
    await waitFor(() => store.savedHarvestJobs.length === 1)
    expect(store.savedHarvestJobs[0]?.modelBinding).toMatchObject({
      sessionId: 'sub_session_1',
      providerProtocol: 'openai-responses',
      modelId: 'sub-model',
      modelGroupId: 'group_sub',
      baseUrl: 'https://sub.models.local',
      contextWindow: 32_000,
    })
    expect(JSON.stringify(store.savedHarvestJobs[0]?.candidate)).not.toContain('hidden sub-session reasoning')
  })

  it('captures sub-session provider metadata without defaulting to Anthropic or storing reasoning metadata', async () => {
    const store = makeContextStore()
    const dir = makeTempDir()

    const result = await runSubSession({
      prompt: 'Remember sub-session provider metadata.',
      provider: providerFromChunks([
        { type: 'thinking_delta', text: 'hidden sub-session reasoning metadata' },
        { type: 'text_delta', text: 'sub-session provider metadata done' },
        { type: 'message_end', usage: { inputTokens: 9, outputTokens: 4 } },
      ], undefined, 'openai', { modelGroupId: 'sub_provider_group', baseUrl: 'https://sub-provider.models.local' }),
      toolRegistry: new ToolRegistry(),
      modelConfig: {
        model: 'sub-provider-model',
        maxTokens: 1024,
        contextWindow: 32_000,
        apiKey: 'sk-sub-secret',
        headers: { Authorization: 'Bearer sub-secret-header' },
        reasoning: 'sub raw reasoning must not persist',
        thinking: 'sub raw thinking must not persist',
      } as any,
      cwd: dir,
      maxTurns: 1,
      contextEngine: {
        sessionId: 'sub_session_provider_metadata',
        config: { enabled: true, injectionEnabled: false, harvestEnabled: true },
        store,
        providers: [],
      },
    })

    expect(result.content).toBe('sub-session provider metadata done')
    await waitFor(() => store.savedHarvestJobs.length === 1)
    const binding = store.savedHarvestJobs[0]!.modelBinding
    expect(binding).toMatchObject({
      sessionId: 'sub_session_provider_metadata',
      providerProtocol: 'openai-chat',
      modelId: 'sub-provider-model',
      modelGroupId: 'sub_provider_group',
      baseUrl: 'https://sub-provider.models.local',
      contextWindow: 32_000,
    })
    expect((binding.modelConfig as any).apiKey).toBeUndefined()
    expect((binding.modelConfig as any).headers).toBeUndefined()
    expect((binding.modelConfig as any).reasoning).toBeUndefined()
    expect((binding.modelConfig as any).thinking).toBeUndefined()
    expect(JSON.stringify(store.savedHarvestJobs[0]!.candidate)).not.toContain('hidden sub-session reasoning metadata')
  })

  it('skips sub-session harvest instead of falling back to a default protocol when provider metadata is unknown', async () => {
    const store = makeContextStore()
    const dir = makeTempDir()

    const result = await runSubSession({
      prompt: 'Remember unknown provider should not guess.',
      provider: providerFromChunks([
        { type: 'text_delta', text: 'unknown provider done' },
        { type: 'message_end', usage: { inputTokens: 9, outputTokens: 4 } },
      ], undefined, 'custom-provider'),
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'custom-model', maxTokens: 1024, contextWindow: 32_000 },
      cwd: dir,
      maxTurns: 1,
      contextEngine: {
        sessionId: 'sub_session_unknown_provider',
        config: { enabled: true, injectionEnabled: false, harvestEnabled: true },
        store,
        providers: [],
      },
    })

    expect(result.content).toBe('unknown provider done')
    expect(store.savedHarvestJobs).toHaveLength(0)
    expect(store.saveDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      source: 'SubSessionContextRuntime',
      message: expect.stringContaining('Sub-session harvest model binding capture failed; harvest skipped'),
    }))
  })

  it('schedules completed sub-session harvest through the project scheduler interval before running harvest work', async () => {
    const store = makeContextStore()
    const scheduler = makeManualScheduler()
    const dir = makeTempDir()

    const result = await runSubSession({
      prompt: 'Remember that sub-session harvest also waits for completion.',
      provider: providerWithDistillerNoop([
        { type: 'text_delta', text: 'sub-session scheduler complete' },
        { type: 'message_end', usage: { inputTokens: 9, outputTokens: 4 } },
      ]),
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'sub-model', maxTokens: 1024, contextWindow: 32_000 },
      cwd: dir,
      maxTurns: 1,
      contextEngine: {
        sessionId: 'sub_session_scheduler',
        config: {
          enabled: true,
          injectionEnabled: false,
          harvestEnabled: true,
          harvest: { minIntervalMs: 54_321 },
          performance: { harvestMinIntervalMs: 99_999 },
        },
        store,
        providers: [],
        scheduler,
        protocol: 'anthropic',
      },
    })

    expect(result.content).toBe('sub-session scheduler complete')
    expect(scheduler.backgroundJobs).toHaveLength(1)
    expect(scheduler.backgroundJobs[0]).toMatchObject({
      projectKey: dir,
      name: 'harvest',
      options: { minIntervalMs: 54_321 },
    })
    expect(store.savedHarvestJobs).toEqual([])

    await scheduler.backgroundJobs[0]!.task(new AbortController().signal)

    expect(store.savedHarvestJobs).toHaveLength(1)
    expect(store.savedHarvestJobs[0]?.candidate.assistantMessages[0]?.content).toEqual([{ type: 'text', text: 'sub-session scheduler complete' }])
  })
})

function providerFromChunks(chunks: StreamChunk[], inspectMessages?: (messages: Message[], config: ModelConfig) => void, providerName = 'test-provider', metadata: Record<string, unknown> = {}): ModelProvider {
  return {
    ...metadata,
    name: providerName,
    chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
    stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
      inspectMessages?.(messages, config)
      for (const chunk of chunks) yield chunk
    },
  } as ModelProvider
}

function providerWithDistillerNoop(chunks: StreamChunk[]): ModelProvider {
  return {
    ...providerFromChunks(chunks),
    chat: async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 1,
          distiller: 'MemoryCuratorDistiller',
          action: 'skip',
          reason: 'model_noop',
          confidence: 0.94,
        }),
      }],
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  } as ModelProvider
}

function compactChunks(text: string): StreamChunk[] {
  return [
    { type: 'text_delta', text },
    { type: 'message_end', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'text_delta', text: 'done after compact' },
    { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
  ]
}

function seedMessagesForCompaction(session: Session): void {
  const messages: Message[] = []
  for (let index = 0; index < 10; index++) {
    messages.push({ id: `seed_user_${index}`, role: 'user', content: [{ type: 'text', text: `seed user ${index}` }], timestamp: index * 2 })
    messages.push({ id: `seed_assistant_${index}`, role: 'assistant', content: [{ type: 'text', text: `seed assistant ${index}` }], timestamp: index * 2 + 1 })
  }
  ;(session as any).messages = messages
}

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'jdc-session-context-'))
  tmpDirs.push(dir)
  return dir
}

async function makeSession(options: {
  provider?: ModelProvider
  modelConfig?: Partial<ModelConfig>
  contextConfig?: any
  contextStore?: ReturnType<typeof makeContextStore>
  contextProviders?: any[]
  contextId?: () => string
  providerProtocol?: 'anthropic' | 'openai-chat' | 'openai-responses'
  modelGroupId?: string
  baseUrl?: string
  runtimeProtocol?: 'anthropic' | 'openai' | 'openai-chat' | 'openai-responses'
  sessionModelId?: string
  scheduler?: ReturnType<typeof makeManualScheduler>
} = {}) {
  const dir = makeTempDir()
  const history = new ConversationHistory(path.join(dir, 'history.db'))
  await history.ensureReady()
  const sessionId = `session_${tmpDirs.length}`
  history.createSession(sessionId, 'Project', dir)
  if (options.sessionModelId) history.setSessionModel(sessionId, options.sessionModelId)
  const session = new Session(
    { id: sessionId, projectName: 'Project', cwd: dir, modelConfig: { model: 'test-model', maxTokens: 1024, contextWindow: 128_000, ...options.modelConfig } },
    options.provider ?? providerFromChunks([{ type: 'text_delta', text: 'ok' }]),
    history,
  )
  session.configureContextEngine({
    config: { enabled: true, inspectEnabled: true, providerToggles: {}, tokenBudget: {}, harvest: {}, retention: {}, memory: {}, redaction: {}, ...options.contextConfig } as any,
    store: options.contextStore ?? makeContextStore(),
    providers: options.contextProviders ?? [],
    scheduler: options.scheduler,
    id: options.contextId,
    protocol: options.providerProtocol,
    modelGroupId: options.modelGroupId,
    baseUrl: options.baseUrl,
  })
  if (options.runtimeProtocol) (session as any)._protocol = options.runtimeProtocol
  return session
}

function makeEvents(): SessionEvents {
  return {
    onStreamChunk: vi.fn(),
    onToolEvent: vi.fn(),
    onMessageComplete: vi.fn(),
    onError: vi.fn(),
    onUsage: vi.fn(),
  }
}

function makeContextStore(options: { queryError?: Error; saveHarvestJobDelayMs?: number } = {}) {
  const savedHarvestJobs: HarvestJob[] = []
  return {
    savedHarvestJobs,
    saveRawEvidence: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveFact: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveHarvestJob: vi.fn(async (job: HarvestJob) => {
      if (options.saveHarvestJobDelayMs) await new Promise(resolve => setTimeout(resolve, options.saveHarvestJobDelayMs))
      savedHarvestJobs.push(job)
      return { ok: true, value: undefined, diagnostics: [] }
    }),
    updateHarvestJob: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    listHarvestJobs: vi.fn(async () => ({ ok: true, value: savedHarvestJobs, diagnostics: [] })),
    rejectCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
    saveBundleSnapshot: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    queryFacts: vi.fn(async () => {
      if (options.queryError) throw options.queryError
      return { ok: true, value: [], diagnostics: [] } as ContextStoreResult<any[]>
    }),
    listAcceptedProjectFacts: vi.fn(async () => {
      if (options.queryError) throw options.queryError
      return { ok: true, value: [], diagnostics: [] } as ContextStoreResult<any[]>
    }),
    listAdvancedDiagnostics: vi.fn(async () => ({ ok: true, value: { rejected: [], diagnostics: [], harvestJobs: [] }, diagnostics: [] })),
    invalidateByFileHash: vi.fn(async () => ({ ok: true, value: { invalidatedFacts: 0 }, diagnostics: [] })),
    enforceQuotas: vi.fn(async () => ({ ok: true, value: { deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 }, diagnostics: [] })),
    getSchemaInfo: vi.fn(async () => ({ ok: true, value: { version: 1, dbPath: '/tmp/context.db' }, diagnostics: [] })),
    listBundleSnapshots: vi.fn(async () => ({ ok: true, value: [], diagnostics: [] })),
    listRawEvidence: vi.fn(async () => ({ ok: true, value: [], diagnostics: [] })),
    listRejectedCandidates: vi.fn(async () => ({ ok: true, value: [], diagnostics: [] })),
    listDiagnostics: vi.fn(async () => ({ ok: true, value: [], diagnostics: [] })),
    approvePendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
    rejectPendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
  }
}

function makeManualScheduler(): ContextScheduler & {
  backgroundJobs: Array<{
    projectKey: string
    name: string
    task: (signal: AbortSignal) => Promise<void>
    options?: { minIntervalMs?: number }
  }>
} {
  const backgroundJobs: Array<{
    projectKey: string
    name: string
    task: (signal: AbortSignal) => Promise<void>
    options?: { minIntervalMs?: number }
  }> = []

  return {
    backgroundJobs,
    runForeground: async <T>(_name: string, _timeoutMs: number, task: (signal: AbortSignal) => Promise<T>, _degraded: T): Promise<T> => task(new AbortController().signal),
    enqueueBackground(projectKey: string, name: string, task: (signal: AbortSignal) => Promise<void>, options?: { minIntervalMs?: number }) {
      backgroundJobs.push({ projectKey, name, task, options })
      return { accepted: true as const, promise: Promise.resolve() }
    },
    cancelProject: vi.fn(),
    recorder: {
      record: vi.fn(),
      snapshot: () => ({ operations: [] }),
      clear: vi.fn(),
    },
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > 500) throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function textFromSystemPrompt(systemPrompt: ModelConfig['systemPrompt']): string {
  if (!systemPrompt) return ''
  if (typeof systemPrompt === 'string') return systemPrompt
  return systemPrompt.map(segment => segment.content).join('\n')
}

function textFromMessages(messages: Message[]): string {
  return messages.flatMap(message => message.content).map(block => {
    if (block.type === 'text') return block.text
    if (block.type === 'tool_result') return block.content
    return ''
  }).join('\n')
}
