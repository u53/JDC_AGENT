import { ParallelExecutor } from './parallel-executor.js'
import { strictToolGroundingProfile } from './model-profile.js'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { TeamRuntime } from './team/team-runtime.js'
import { runSubSession } from './sub-session.js'
import { ToolRegistry } from './tool-registry.js'
import type { Message, ModelConfig, StreamChunk, ToolDefinition } from './types.js'
import { closeAllContextStores, type ContextStoreResult } from './context/store.js'
import type { ContextRequest, HarvestJob } from './context/types.js'
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
  it('derives verification requirements without appending a disclosure tail to the reply', async () => {
    const session = await makeSession({
      provider: providerFromChunks([
        ...assistantToolUseChunks('toolu_write', 'Write', { file_path: 'src/app.ts', content: 'export const value = 1\n' }),
        { type: 'text_delta', text: 'Done, fixed.' },
        { type: 'message_end', usage: { inputTokens: 8, outputTokens: 4 } },
      ]),
      contextConfig: { enabled: false } as any,
    })
    seedVerificationProject(session.config.cwd)
    ;(session as any).permissionChecker.allowForSession('Write')
    const events = makeEvents()

    await session.sendMessage('修复 src/app.ts', events)

    const finalAssistant = (events.onMessageComplete as any).mock.calls
      .map((call: [Message]) => call[0])
      .filter((message: Message) => message.role === 'assistant')
      .at(-1)
    // The runtime-injected "Verification status" tail must never appear in the reply.
    expect(textFromMessages(finalAssistant ? [finalAssistant] : [])).not.toContain('Verification status:')
    expect(events.onStreamChunk).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'text_delta',
      text: expect.stringContaining('Verification status:'),
    }))
    // Requirements are still derived into the ledger for the constraint observability panel.
    const ledger = (session as any).toolRunner.constraintRuntime.verificationLedger
    expect(ledger.getRequirements().some((requirement: { kind: string }) => requirement.kind === 'test')).toBe(true)
  })

  it('does not append a failure disclosure tail even when a required command failed', async () => {
    const session = await makeSession({
      provider: providerFromChunks([
        ...assistantToolUseChunks('toolu_write', 'Write', { file_path: 'src/app.ts', content: 'export const value = 1\n' }),
        ...assistantToolUseChunks('toolu_test', 'Bash', { command: 'pnpm test' }),
        { type: 'text_delta', text: 'All done.' },
        { type: 'message_end', usage: { inputTokens: 8, outputTokens: 4 } },
      ]),
      contextConfig: { enabled: false } as any,
    })
    seedVerificationProject(session.config.cwd)
    session.registerTool({
      definition: {
        name: 'Bash',
        description: 'Test Bash override',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      },
      execute: async () => ({
        content: '1 failed',
        isError: true,
        metadata: { command: { shell: 'bash', command: 'pnpm test', exitCode: 1 } },
      }),
    })
    ;(session as any).permissionChecker.allowForSession('Write')
    ;(session as any).permissionChecker.allowForSession('Bash')
    const events = makeEvents()

    await session.sendMessage('修复 src/app.ts', events)

    const finalAssistant = (events.onMessageComplete as any).mock.calls
      .map((call: [Message]) => call[0])
      .filter((message: Message) => message.role === 'assistant')
      .at(-1)
    const finalText = textFromMessages(finalAssistant ? [finalAssistant] : [])
    expect(finalText).not.toContain('Verification status:')
    expect(events.onStreamChunk).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'text_delta',
      text: expect.stringContaining('Verification status:'),
    }))
  })

  it('does not expose legacy SaveMemory after JDC Memory Review takes over', async () => {
    const session = await makeSession({ contextConfig: { enabled: false } as any })
    const defs = (session as any).toolRegistry.getDefinitions().map((definition: ToolDefinition) => definition.name)

    expect(defs).not.toContain('SaveMemory')
    expect(defs).not.toContain('JdcContextInspect')
    expect(defs).not.toContain('JdcContextRefresh')
    expect(defs).toContain('JdcMemorySearch')
    expect(defs).toContain('JdcMemoryWrite')
  })

  it('includes repo_wiki in the default context provider list before code', async () => {
    const dir = makeTempDir()
    const history = new ConversationHistory(path.join(dir, 'history.db'))
    await history.ensureReady()
    history.createSession('session_provider_order', 'Project', dir)
    const session = new Session(
      { id: 'session_provider_order', projectName: 'Project', cwd: dir, modelConfig: { model: 'test-model', maxTokens: 1024, contextWindow: 128_000 } },
      providerFromChunks([{ type: 'text_delta', text: 'ok' }]),
      history,
    )

    const providerIds = (session as any).getContextProviders().map((provider: { id: string }) => provider.id)

    expect(providerIds.indexOf('repo_wiki')).toBeGreaterThanOrEqual(0)
    expect(providerIds.indexOf('repo_wiki')).toBeLessThan(providerIds.indexOf('code'))
  })

  it('invalidates repo wiki entries after a cited file changes', async () => {
    const store = makeContextStore()
    const session = await makeSession({ contextStore: store })
    const filePath = 'packages/core/src/session.ts'
    const absolutePath = path.join((session as any).config.cwd, filePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, 'export class Session {}\n')
    await (session as any).fileTracker.recordChange(filePath, 'export class OldSession {}\n', 'export class Session {}\n', 'toolu_write', 1)

    await (session as any).invalidateStaleFileFactsAfterRunLoop()

    expect(store.invalidateByFileHash).toHaveBeenCalledWith(filePath, expect.any(String))
    expect(store.invalidateRepoWikiByFileHash).toHaveBeenCalledWith(filePath, expect.any(String))
  })

  it('records repo wiki invalidation diagnostics without blocking file fact invalidation', async () => {
    const store = makeContextStore()
    store.invalidateRepoWikiByFileHash.mockRejectedValueOnce(new Error('repo wiki store locked'))
    const session = await makeSession({ contextStore: store })
    const filePath = 'packages/core/src/session.ts'
    const absolutePath = path.join((session as any).config.cwd, filePath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, 'export class Session {}\n')
    await (session as any).fileTracker.recordChange(filePath, 'export class OldSession {}\n', 'export class Session {}\n', 'toolu_write', 1)

    await expect((session as any).invalidateStaleFileFactsAfterRunLoop()).resolves.toBeUndefined()

    expect(store.invalidateByFileHash).toHaveBeenCalledWith(filePath, expect.any(String))
    expect(store.saveDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      source: 'SessionContextRuntime',
      message: expect.stringContaining('Repo Wiki file-hash invalidation failed without blocking foreground chat'),
    }))
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

  it('continues runLoop with the compacted message list after automatic compaction', async () => {
    let streamCalls = 0
    let foregroundMessages: Message[] = []
    const provider: ModelProvider = {
      name: 'compact-continuation-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        streamCalls++
        if (config.systemPrompt === undefined || typeof config.systemPrompt === 'string') {
          yield { type: 'text_delta', text: '<summary>Recovered project state after compact.</summary>' }
          yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 5 } }
          return
        }
        foregroundMessages = messages
        yield { type: 'text_delta', text: 'continued after compact' }
        yield { type: 'message_end', usage: { inputTokens: 8, outputTokens: 2 } }
      },
    }
    const events = makeEvents() as ReturnType<typeof makeEvents> & { onMessagesReplaced: ReturnType<typeof vi.fn> }
    events.onMessagesReplaced = vi.fn()
    const session = await makeSession({
      provider,
      contextConfig: { enabled: false } as any,
      modelConfig: { contextWindow: 200, compressAt: 0.1 },
    })
    seedMessagesForCompaction(session)

    await session.sendMessage('trigger automatic compact and continue', events)

    expect(streamCalls).toBe(2)
    expect(textFromMessages(foregroundMessages)).toContain('Recovered project state after compact.')
    expect(textFromMessages(foregroundMessages)).toContain('trigger automatic compact and continue')
    expect(textFromMessages(foregroundMessages)).not.toContain('seed user 0')
    expect(events.onMessagesReplaced).toHaveBeenCalled()
    const replacedMessages = events.onMessagesReplaced.mock.calls.at(-1)?.[0] as Message[]
    expect(textFromMessages(replacedMessages)).toContain('Recovered project state after compact.')
    expect(textFromMessages(replacedMessages)).not.toContain('seed user 0')
    expect(session.getMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'continued after compact' }])
  })

  it('uses the compacted message list for the next request after manual compact', async () => {
    let foregroundMessages: Message[] = []
    const provider: ModelProvider = {
      name: 'manual-compact-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        if (config.systemPrompt === undefined || typeof config.systemPrompt === 'string') {
          yield { type: 'text_delta', text: '<summary>Manual compact retained project state.</summary>' }
          yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 5 } }
          return
        }
        foregroundMessages = messages
        yield { type: 'text_delta', text: 'after manual compact' }
        yield { type: 'message_end', usage: { inputTokens: 8, outputTokens: 2 } }
      },
    }
    const session = await makeSession({
      provider,
      contextConfig: { enabled: false } as any,
      modelConfig: { contextWindow: 200, compressAt: 0.1 },
    })
    seedMessagesForCompaction(session)

    await session.compactNow(makeEvents())
    expect(textFromMessages(session.getMessages())).toContain('Manual compact retained project state.')
    expect(textFromMessages(session.getMessages())).not.toContain('seed user 0')

    await session.sendMessage('continue after manual compact', makeEvents())

    expect(textFromMessages(foregroundMessages)).toContain('Manual compact retained project state.')
    expect(textFromMessages(foregroundMessages)).toContain('continue after manual compact')
    expect(textFromMessages(foregroundMessages)).not.toContain('seed user 0')
  })

  it('does not micro-compact old tool results by default', async () => {
    const session = await makeSession({
      contextConfig: { enabled: false } as any,
      modelConfig: { contextWindow: 128_000, compressAt: 0.9 },
    })
    ;(session as any).messages = Array.from({ length: 12 }, (_, i) => ({
      id: `u${i}`,
      role: 'user' as const,
      content: [{ type: 'tool_result' as const, tool_use_id: `toolu_${i}`, content: `result ${i}\n${'x'.repeat(600)}`, is_error: false }],
      timestamp: i,
    }))
    ;(session as any).usageTracker.getSnapshot = () => ({ contextUsedPercent: 50 })

    ;(session as any).microCompact()

    expect(textFromMessages(session.getMessages())).toContain('result 0')
    expect(textFromMessages(session.getMessages())).toContain('result 11')
    expect(textFromMessages(session.getMessages())).not.toContain('Tool result cleared')
  })

  it('keeps legacy micro-compact available when explicitly enabled', async () => {
    const session = await makeSession({
      contextConfig: { enabled: false } as any,
      modelConfig: {
        contextWindow: 128_000,
        compressAt: 0.9,
        toolResultRetention: { microCompact: true },
      },
    })
    ;(session as any).messages = Array.from({ length: 12 }, (_, i) => ({
      id: `u${i}`,
      role: 'user' as const,
      content: [{ type: 'tool_result' as const, tool_use_id: `toolu_${i}`, content: `result ${i}\n${'x'.repeat(600)}`, is_error: false }],
      timestamp: i,
    }))
    ;(session as any).usageTracker.getSnapshot = () => ({ contextUsedPercent: 50 })

    ;(session as any).microCompact()

    expect(textFromMessages(session.getMessages())).toContain('Tool result cleared')
  })

  it('continues prompt_too_long recovery with trimmed recent tool results', async () => {
    const largeOutput = `start\n${'x'.repeat(12_000)}\nend`
    let mainCalls = 0
    let compactCalls = 0
    let continuedMessages: Message[] = []
    const provider: ModelProvider = {
      name: 'prompt-too-long-recovery-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        if (typeof config.systemPrompt === 'string') {
          compactCalls++
          yield { type: 'text_delta', text: '<summary>Recovered after prompt too long.</summary>' }
          yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 5 } }
          return
        }

        mainCalls++
        if (mainCalls === 1) {
          throw new Error('prompt is too long')
        }

        continuedMessages = messages
        yield { type: 'text_delta', text: 'continued after prompt compact' }
        yield { type: 'message_end', usage: { inputTokens: 8, outputTokens: 2 } }
      },
    }
    const events = makeEvents()
    const session = await makeSession({
      provider,
      contextConfig: { enabled: false } as any,
      modelConfig: { contextWindow: 128_000, compressAt: 0.9 },
    })
    const seedMessages: Message[] = []
    for (let index = 0; index < 12; index++) {
      seedMessages.push(index % 2 === 0
        ? { id: `seed_user_${index}`, role: 'user', content: [{ type: 'text', text: `seed user ${index}` }], timestamp: index }
        : { id: `seed_assistant_${index}`, role: 'assistant', content: [{ type: 'text', text: `seed assistant ${index}` }], timestamp: index }
      )
    }
    seedMessages.push(
      { id: 'recent_tool_use', role: 'assistant', content: [{ type: 'tool_use', id: 't-large', name: 'bash', input: { cmd: 'big output' } }], timestamp: 20 },
      { id: 'recent_tool_result', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-large', content: largeOutput, is_error: false }], timestamp: 21 },
    )
    ;(session as any).messages = seedMessages

    await session.sendMessage('recover and keep going', events)

    expect(mainCalls).toBe(2)
    expect(compactCalls).toBe(1)
    expect(events.onError).not.toHaveBeenCalled()
    expect(textFromMessages(continuedMessages)).toContain('Recovered after prompt too long.')
    expect(textFromMessages(continuedMessages)).toContain('recover and keep going')
    expect(textFromMessages(continuedMessages)).toContain('Tool result condensed: Bash')
    expect(textFromMessages(continuedMessages)).toContain('command: big output')
    expect(textFromMessages(continuedMessages)).toContain('start')
    expect(textFromMessages(continuedMessages)).toContain('end')
    expect(textFromMessages(session.getMessages())).toContain('continued after prompt compact')
  })

  it('stops prompt_too_long recovery when compaction fails', async () => {
    let mainCalls = 0
    let compactCalls = 0
    const provider: ModelProvider = {
      name: 'prompt-too-long-compact-fail-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (_messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        if (typeof config.systemPrompt === 'string') {
          compactCalls++
          yield { type: 'text_delta', text: '<summary>   </summary>' }
          yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 1 } }
          return
        }

        mainCalls++
        if (mainCalls === 1) {
          throw new Error('prompt is too long')
        }

        yield { type: 'text_delta', text: 'should not continue after failed compact' }
        yield { type: 'message_end', usage: { inputTokens: 8, outputTokens: 2 } }
      },
    }
    const events = makeEvents()
    const session = await makeSession({
      provider,
      contextConfig: { enabled: false } as any,
      modelConfig: { contextWindow: 128_000, compressAt: 0.9 },
    })
    seedMessagesForCompaction(session)

    await session.sendMessage('recover from failed compact', events)

    expect(mainCalls).toBe(1)
    expect(compactCalls).toBe(1)
    expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Prompt is too long and compaction could not reduce the session context.',
    }))
    expect(textFromMessages(session.getMessages())).not.toContain('should not continue after failed compact')
  })

  it('injects a protocol-neutral context bundle before streaming and falls back when bundle generation fails', async () => {
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'done' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], (_messages, config) => {
        const text = textFromSystemPrompt(config.systemPrompt)
        expect(text).toMatch(/<jdc-context-engine bundle="ctx_[0-9a-f]{16}">/)
        expect(text).toContain('<actor>main_session</actor>')
        expect(text).toContain('Runtime context')
      }),
      contextConfig: { injectionEnabled: true, harvestEnabled: false },
      contextStore: makeContextStore(),
      contextProviders: [{
        id: 'runtime',
        collect: async (request: ContextRequest) => {
          expect(request.tokenBudget).toBeUndefined()
          expect(request.transcriptAlreadyInModel).toBe(true)
          expect(request.carriedContext).toMatchObject({
            gitStatusInSystemPrompt: false,
            projectInstructionRefs: expect.any(Array),
            taskRefs: expect.any(Array),
          })
          return {
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
          }
        },
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

  it('passes active task refs into context requests without copying task content', async () => {
    let captured: ContextRequest | undefined
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'done' },
        { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } },
      ]),
      contextConfig: { injectionEnabled: true, harvestEnabled: false },
      contextStore: makeContextStore(),
      contextProviders: [{
        id: 'runtime',
        collect: async (request: ContextRequest) => {
          captured = request
          return {
            evidence: [],
            sections: [],
            diagnostics: [],
            health: { id: 'runtime', status: 'enabled', updatedAt: 1 },
          }
        },
      }],
    })

    ;(session as any).taskStore.create('Fix retry UI', 'Make automatic retry visible')
    await session.sendMessage('continue current task', makeEvents())

    expect(captured?.carriedContext?.taskRefs.length).toBeGreaterThan(0)
    expect(JSON.stringify(captured?.carriedContext)).not.toContain('Fix retry UI')
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

  it('still harvests completed assistant messages when the user stops immediately after a completed turn', async () => {
    const store = makeContextStore()
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'Remember that stopped completed turns can still salvage context.' },
        { type: 'message_end', usage: { inputTokens: 8, outputTokens: 4 } },
      ]),
      contextConfig: {
        injectionEnabled: false,
        harvestEnabled: true,
        harvest: { minIntervalMs: 0 },
        performance: { harvestMinIntervalMs: 0 },
      },
      contextStore: store,
      providerProtocol: 'anthropic',
    })
    const events = makeEvents()
    events.onMessageComplete = vi.fn((message: Message) => {
      if (message.role === 'assistant') session.abort()
    })

    await session.sendMessage('Remember interrupted completed turn salvage.', events)

    await waitFor(() => store.savedHarvestJobs.length >= 1)
    expect(store.savedHarvestJobs).toHaveLength(1)
    expect(store.savedHarvestJobs[0]?.candidate.assistantMessages[0]?.content).toEqual([
      { type: 'text', text: 'Remember that stopped completed turns can still salvage context.' },
    ])
  })

  it('still harvests streamed assistant text when the user stops before message_end', async () => {
    const store = makeContextStore()
    const provider: ModelProvider = {
      name: 'abort-after-text-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (_messages: Message[], _tools: ToolDefinition[], _config: ModelConfig, signal?: AbortSignal) {
        yield { type: 'text_delta', text: 'Remember that stop salvages already streamed text.' }
        if (signal?.aborted) return
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    }
    const session = await makeSession({
      provider,
      contextConfig: {
        injectionEnabled: false,
        harvestEnabled: true,
        harvest: { minIntervalMs: 0 },
        performance: { harvestMinIntervalMs: 0 },
      },
      contextStore: store,
      providerProtocol: 'anthropic',
    })
    const events = makeEvents()
    events.onStreamChunk = vi.fn((chunk: StreamChunk) => {
      if (chunk.type === 'text_delta') session.abort()
    })

    await session.sendMessage('Remember interrupted stream salvage.', events)

    await waitFor(() => store.savedHarvestJobs.length >= 1)
    expect(store.savedHarvestJobs).toHaveLength(1)
    expect(store.savedHarvestJobs[0]?.candidate.assistantMessages[0]?.content).toEqual([
      { type: 'text', text: 'Remember that stop salvages already streamed text.' },
    ])
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

  it('backfills previous assistant project summaries for confirmation harvest turns', async () => {
    const store = makeContextStore()
    const scheduler = makeManualScheduler()
    const projectSummary = [
      '# 项目整体架构',
      'packages/core 负责 JDC Context Engine、Session runLoop、harvest、工具注册和上下文注入。',
      'packages/electron 负责桌面主进程、IPC、窗口和系统服务。',
      'packages/ui 负责 React 聊天界面、Inspector、Context Panel 和设置界面。',
      '常用命令包括 pnpm --filter @jdcagnet/core test 和 pnpm --filter @jdcagnet/core build。',
    ].join('\n')
    const session = await makeSession({
      provider: providerWithTurnTexts([projectSummary, '当然，已准备保存。']),
      contextConfig: {
        injectionEnabled: false,
        harvestEnabled: true,
        harvest: { minIntervalMs: 0 },
        performance: { harvestMinIntervalMs: 0 },
      },
      contextStore: store,
      scheduler,
      providerProtocol: 'anthropic',
    })

    await session.sendMessage('帮我总结一下这个项目整体', makeEvents())
    await session.sendMessage('当然，存一下', makeEvents())

    expect(scheduler.backgroundJobs).toHaveLength(2)
    await scheduler.backgroundJobs[1]!.task(new AbortController().signal)

    expect(store.savedHarvestJobs).toHaveLength(1)
    const candidateText = JSON.stringify(store.savedHarvestJobs[0]?.candidate.assistantMessages)
    expect(candidateText).toContain('packages/core 负责 JDC Context Engine')
    expect(candidateText).toContain('当然，已准备保存。')
  })

  it('skips low-value turns before creating harvest jobs and queues overlapping background harvest', async () => {
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

    const store = makeContextStore({ saveHarvestJobDelayMs: 80 })
    const session = await makeSession({
      provider: providerWithTurnTexts(['first harvest', 'second harvest']),
      contextConfig: { injectionEnabled: false, harvestEnabled: true, harvest: { minIntervalMs: 0 }, performance: { harvestMinIntervalMs: 0 } },
      contextStore: store,
      providerProtocol: 'anthropic',
    })

    await session.sendMessage('Remember the first production context fact.', makeEvents())
    await session.sendMessage('Remember the second production context fact.', makeEvents())

    await waitFor(() => store.savedHarvestJobs.length === 2)
    expect(store.savedHarvestJobs.map(job => job.candidate.userMessage)).toEqual([
      'Remember the first production context fact.',
      'Remember the second production context fact.',
    ])
  })

  it('injects the resolved strict model profile into system and context prompts', async () => {
    let observedSystemPrompt = ''
    let capturedRequest: ContextRequest | undefined
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'ok' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], (_messages, config) => {
        observedSystemPrompt = textFromSystemPrompt(config.systemPrompt)
      }, 'ollama'),
      modelConfig: { model: 'glm-4.5', maxTokens: 1024, contextWindow: 128_000 },
      contextConfig: { enabled: true, injectionEnabled: true, providerToggles: {}, harvestEnabled: false } as any,
      contextProviders: [{
        id: 'runtime',
        collect: async (request: ContextRequest) => {
          capturedRequest = request
          return {
            evidence: [],
            sections: [],
            diagnostics: [],
            health: { id: 'runtime', status: 'enabled', updatedAt: 1 },
          }
        },
      }],
    })

    await session.sendMessage('修复 src/app.ts', makeEvents())

    expect(observedSystemPrompt).toContain('# Model Profile Adaptation')
    expect(observedSystemPrompt).toContain('Evidence strictness: strict')
    expect(observedSystemPrompt).toContain('Strict profile instructions:')
    expect(capturedRequest?.modelProfile).toMatchObject({ id: 'strict_tool_grounding', evidenceStrictness: 'strict' })
  })

  it('inspects the current constraint runtime for UI observability', async () => {
    const session = await makeSession()
    const runtime = (session as any).toolRunner.constraintRuntime
    runtime.verificationLedger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })

    const snapshot = session.inspectConstraints({
      status: 'empty',
      inspectedAt: 200,
      bundle: null,
      acceptedProjectFacts: [],
      droppedSections: [],
      providerHealth: [],
      providerTimings: [],
      harvestQueue: { jobs: [], summary: { queued: 0, classified: 0, distilling: 0, validating: 0, accepted: 0, pending_review: 0, rejected: 0, skipped: 0, failed: 0 } },
      memoryReview: { rejected: [] },
      diagnostics: [],
    })

    expect(snapshot.status).toBe('needs_verification')
    expect(snapshot.cwd).toBe((session as any).config.cwd)
    expect(snapshot.verification.changedFiles[0]).toMatchObject({ filePath: 'packages/core/src/session.ts' })
  })

  it('refreshes model profile before retrying after provider changes', async () => {
    const observedProfiles: Array<string | undefined> = []
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'strict turn' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], (_messages, config) => {
        observedProfiles.push(config.modelProfile?.id)
      }, 'ollama'),
      modelConfig: { model: 'glm-4.5', maxTokens: 1024, contextWindow: 128_000 },
      contextConfig: { enabled: false, injectionEnabled: false, providerToggles: {}, harvestEnabled: false } as any,
    })

    await session.sendMessage('修复 src/app.ts', makeEvents())
    session.updateProvider(
      providerFromChunks([
        { type: 'text_delta', text: 'standard retry' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], (_messages, config) => {
        observedProfiles.push(config.modelProfile?.id)
      }, 'anthropic'),
      { model: 'claude-sonnet-4-6', maxTokens: 1024, contextWindow: 128_000 },
    )

    await session.retryLastTurn(makeEvents())

    expect(observedProfiles).toEqual(['strict_tool_grounding', 'standard_default'])
  })

  it('applies resolved model profile read concurrency to the parallel executor', async () => {
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'ok' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], undefined, 'ollama'),
      modelConfig: { model: 'glm-4.5', maxTokens: 1024, contextWindow: 128_000 },
      contextConfig: { enabled: false, injectionEnabled: false, providerToggles: {}, harvestEnabled: false } as any,
    })
    const setMaxReadConcurrency = vi.spyOn(ParallelExecutor.prototype, 'setMaxReadConcurrency')

    await session.sendMessage('修复 src/app.ts', makeEvents())

    expect(setMaxReadConcurrency).toHaveBeenCalledWith(2)
    expect((session as any).config.modelConfig.modelProfile).toMatchObject({
      id: 'strict_tool_grounding',
      maxParallelToolCalls: 2,
    })

    setMaxReadConcurrency.mockRestore()
  })

  it('adds resolved model profiles to modelId override runtime configs', async () => {
    const session = await makeSession()
    session.resolveModel = (modelId: string) => ({
      status: 'resolved',
      provider: providerFromChunks([], undefined, 'ollama'),
      modelConfig: { model: modelId, maxTokens: 1024, contextWindow: 128_000 },
    })

    const resolution = (session as any).resolveRuntimeModelWithProfile('glm-override')

    expect(resolution.status).toBe('resolved')
    expect(resolution.modelConfig.modelProfile).toMatchObject({
      id: 'strict_tool_grounding',
      evidenceStrictness: 'strict',
    })
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
        expect(textFromSystemPrompt(config.systemPrompt)).toMatch(/<jdc-context-engine bundle="ctx_[0-9a-f]{16}">/)
        expect(textFromSystemPrompt(config.systemPrompt)).toContain('<actor>subagent</actor>')
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

  it('passes strict model profile into sub-session context contracts', async () => {
    const store = makeContextStore()
    const dir = makeTempDir()
    let capturedRequest: ContextRequest | undefined
    const strictProfile = strictToolGroundingProfile({ id: 'strict_sub_session', providerPattern: 'test', modelPattern: 'weak-*' })

    const result = await runSubSession({
      prompt: 'Fix src/app.ts without enough repository evidence.',
      provider: providerFromChunks([
        { type: 'text_delta', text: 'strict sub-session done' },
        { type: 'message_end', usage: { inputTokens: 9, outputTokens: 4 } },
      ], (_messages, config) => {
        const promptText = textFromSystemPrompt(config.systemPrompt)
        expect(promptText).toContain('Model profile: strict_sub_session')
        expect(promptText).toContain('Strict profile instructions:')
      }),
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'weak-agent', maxTokens: 1024, contextWindow: 32_000, modelProfile: strictProfile },
      cwd: dir,
      maxTurns: 1,
      contextEngine: {
        sessionId: 'sub_session_strict_profile',
        config: { enabled: true, injectionEnabled: true, harvestEnabled: false },
        store,
        providers: [{
          id: 'conversation',
          collect: async (request) => {
            capturedRequest = request
            return { evidence: [], sections: [], diagnostics: [], health: { id: 'conversation', status: 'enabled', updatedAt: 1 } }
          },
        }],
        id: () => 'ctx_sub_strict_profile',
      },
    })

    expect(result.content).toBe('strict sub-session done')
    expect(capturedRequest?.modelProfile).toMatchObject({ id: 'strict_sub_session', evidenceStrictness: 'strict' })
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

describe('Session team model_resolution_warning notification', () => {
  it('forwards model_resolution_warning team event to pending notifications', async () => {
    const session = await makeSession({ contextConfig: { enabled: false } as any })
    const sessionAny = session as any
    sessionAny.pendingNotifications = []
    sessionAny.onNotificationReady = vi.fn()

    // Call the onTeamEvent handler directly (stored during construction for testability)
    sessionAny._teamEventHandler?.('team_xyz', {
      type: 'model_resolution_warning',
      memberId: 'member_1',
      requestedModelId: 'missing-model',
      message: 'Requested model "missing-model" not found',
      timestamp: Date.now(),
    })

    expect(sessionAny.pendingNotifications.some((n: any) => n.teamEvent?.includes('Model warning:'))).toBe(true)
    expect(sessionAny.onNotificationReady).toHaveBeenCalled()
  })
})

describe('Session team status snapshots', () => {
  it('returns final snapshots for archived team runtimes', async () => {
    const session = await makeSession({ contextConfig: { enabled: false } as any })
    const sessionAny = session as any
    const bgTask = sessionAny.backgroundTasks.registerTeam('Archived team status', [])
    const team = new TeamRuntime({
      id: bgTask.id,
      objective: 'Archived team status',
      plan: { members: [], tasks: [] },
      subSessionDeps: {
        provider: providerFromChunks([{ type: 'text_delta', text: 'ok' }]),
        toolRegistry: new ToolRegistry(),
        modelConfig: { model: 'test-model', maxTokens: 1024, contextWindow: 128_000 },
        cwd: session.config.cwd,
      },
    })
    sessionAny.teamRegistry.register(team)
    sessionAny.teamFinalSnapshots.set(bgTask.id, {
      type: 'team',
      id: bgTask.id,
      status: 'completed',
      members: [],
      tasks: [],
    })
    sessionAny.backgroundTasks.completeTeam(bgTask.id, { summary: 'done' })
    sessionAny.teamRegistry.remove(bgTask.id)

    const status = session.getTeamStatus(bgTask.id)

    expect(status.finished).toBe(true)
    expect(status.status).toBe('completed')
  })
})

function providerFromChunks(chunks: StreamChunk[], inspectMessages?: (messages: Message[], config: ModelConfig) => void, providerName = 'test-provider', metadata: Record<string, unknown> = {}): ModelProvider {
  let offset = 0
  return {
    ...metadata,
    name: providerName,
    chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
    stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
      inspectMessages?.(messages, config)
      while (offset < chunks.length) {
        const chunk = chunks[offset++]!
        yield chunk
        if (chunk.type === 'message_end') break
      }
    },
  } as ModelProvider
}

function assistantToolUseChunks(id: string, name: string, input: Record<string, unknown>): StreamChunk[] {
  return [
    { type: 'tool_use_start', toolUse: { id, name, input: '' } },
    { type: 'tool_use_delta', toolUse: { id, name, input: JSON.stringify(input) } },
    { type: 'tool_use_end' },
    { type: 'message_end', usage: { inputTokens: 8, outputTokens: 4 } },
  ]
}

function seedVerificationProject(cwd: string): void {
  writeFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', build: 'tsc' } }))
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

function providerWithTurnTexts(texts: string[]): ModelProvider {
  let streamCalls = 0
  return {
    name: 'turn-text-provider',
    chat: async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 1,
          distiller: 'ProjectProfileDistiller',
          action: 'skip',
          reason: 'model_noop',
          confidence: 0.94,
        }),
      }],
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
    stream: async function* () {
      const text = texts[Math.min(streamCalls, texts.length - 1)] ?? ''
      streamCalls++
      yield { type: 'text_delta', text }
      yield { type: 'message_end', usage: { inputTokens: 9, outputTokens: 3 } }
    },
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
    invalidateRepoWikiByFileHash: vi.fn(async () => ({ ok: true, value: { invalidatedEntries: 0 }, diagnostics: [] })),
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
