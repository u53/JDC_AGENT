# JDC Context Engine Snapshot Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5 minute in-process rendered prompt snapshot for JDC Context Engine system prompt injection.

**Architecture:** Add a focused `ContextPromptSnapshotCache` module that derives stable keys from project, actor, mode, model/protocol, model profile, and actor selection bucket. Main session, sub-session, and Team PM injection paths call one shared helper before `buildContextBundle()`, so cache hits reuse the exact rendered `<jdc-context-engine>` prompt across user turns for five minutes without changing provider request shapes or context capacity behavior.

**Tech Stack:** TypeScript, Vitest, existing `ContextRequest` / `ActorContextProfile` types, existing Context Engine orchestrator, existing prompt segment system.

---

## File Structure

- Create: `packages/core/src/context/prompt-snapshot-cache.ts`
  - Owns TTL, key derivation, in-memory cache map, and `resolveContextPromptSnapshot()`.
  - No store access, no provider access, no prompt rendering.
- Create: `packages/core/src/context/prompt-snapshot-cache.test.ts`
  - Unit tests for key stability, isolation, TTL expiry, and empty-result behavior.
- Modify: `packages/core/src/session.ts`
  - Adds a cache field, optional test injection through `configureContextEngine()`, and uses the helper in `injectContextForRunLoop()`.
  - Passes the same cache into sub-agent and Team dependencies.
- Modify: `packages/core/src/sub-session.ts`
  - Adds optional cache on `SubSessionOptions.contextEngine` and uses the helper in `buildSubSessionContextPrompt()`.
- Modify: `packages/core/src/team/team-manager-ai.ts`
  - Adds optional cache on Team PM context engine options and uses the helper in `buildPMSystemPrompt()`.
- Modify: `packages/core/src/session-context.test.ts`
  - Covers main-session cache hit, expiry, and different intent behavior.
- Modify: `packages/core/src/sub-session-compaction.test.ts`
  - Adds a focused sub-session cache isolation test using the existing `runSubSession()` harness.
- Modify: `packages/core/src/team/__tests__/team-manager-ai.test.ts`
  - Covers Team PM cache hit without saving a new bundle snapshot.
- Modify: `packages/core/src/providers/provider-prompt-contract.test.ts`
  - Locks that cached JDC Context Engine segments remain non-cacheable for Anthropic.

## Task 1: Snapshot Cache Module

**Files:**
- Create: `packages/core/src/context/prompt-snapshot-cache.test.ts`
- Create: `packages/core/src/context/prompt-snapshot-cache.ts`

- [ ] **Step 1: Write the failing cache unit tests**

Create `packages/core/src/context/prompt-snapshot-cache.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  CONTEXT_PROMPT_SNAPSHOT_TTL_MS,
  ContextPromptSnapshotCache,
  createContextPromptSnapshotKey,
  resolveContextPromptSnapshot,
} from './prompt-snapshot-cache.js'
import type { ActorContextProfile, ContextRequest } from './types.js'

const request: ContextRequest = {
  sessionId: 'session_1',
  cwd: '/repo/project',
  userMessage: 'Fix   Cache Bug',
  recentMessages: [],
  mode: 'chat',
  model: 'claude-sonnet-4',
  runtime: {},
  createdAt: 1_000,
}

describe('ContextPromptSnapshotCache', () => {
  it('derives stable keys across user turns and isolates actor, project, mode, and model', () => {
    const profile: ActorContextProfile = {
      actor: 'main_session',
      sessionId: 'session_1',
      cwd: '/repo/project',
      mode: 'chat',
      objective: 'Fix Cache Bug',
    }

    const first = createContextPromptSnapshotKey({
      request,
      actorProfile: profile,
      providerProtocol: 'anthropic',
    })
    const sameIntent = createContextPromptSnapshotKey({
      request: { ...request, userMessage: ' fix cache   bug ' },
      actorProfile: profile,
      providerProtocol: 'anthropic',
    })
    const differentActor = createContextPromptSnapshotKey({
      request,
      actorProfile: { ...profile, actor: 'subagent', subSessionId: 'sub_1' },
      providerProtocol: 'anthropic',
    })
    const differentProject = createContextPromptSnapshotKey({
      request: { ...request, cwd: '/repo/other-project' },
      actorProfile: { ...profile, cwd: '/repo/other-project' },
      providerProtocol: 'anthropic',
    })
    const differentMode = createContextPromptSnapshotKey({
      request: { ...request, mode: 'plan' },
      actorProfile: { ...profile, mode: 'plan' },
      providerProtocol: 'anthropic',
    })
    const differentModel = createContextPromptSnapshotKey({
      request: { ...request, model: 'gpt-5' },
      actorProfile: profile,
      providerProtocol: 'openai-responses',
    })

    expect(sameIntent).toBe(first)
    expect(differentActor).not.toBe(first)
    expect(differentProject).not.toBe(first)
    expect(differentMode).not.toBe(first)
    expect(differentModel).not.toBe(first)
  })

  it('reuses rendered prompts inside the five minute TTL and rebuilds after expiry', async () => {
    let now = 10_000
    const cache = new ContextPromptSnapshotCache({ now: () => now })
    const build = vi.fn()
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>first</jdc-context-engine>', bundleId: 'bundle_1' })
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>second</jdc-context-engine>', bundleId: 'bundle_2' })

    const first = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1', objective: 'Fix Cache Bug' },
      providerProtocol: 'anthropic',
      build,
    })
    now += CONTEXT_PROMPT_SNAPSHOT_TTL_MS - 1
    const second = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1', objective: 'Fix Cache Bug' },
      providerProtocol: 'anthropic',
      build,
    })
    now += 2
    const third = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1', objective: 'Fix Cache Bug' },
      providerProtocol: 'anthropic',
      build,
    })

    expect(first).toMatchObject({ renderedPrompt: '<jdc-context-engine>first</jdc-context-engine>', cacheHit: false, bundleId: 'bundle_1' })
    expect(second).toMatchObject({ renderedPrompt: '<jdc-context-engine>first</jdc-context-engine>', cacheHit: true, bundleId: 'bundle_1' })
    expect(third).toMatchObject({ renderedPrompt: '<jdc-context-engine>second</jdc-context-engine>', cacheHit: false, bundleId: 'bundle_2' })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('does not cache empty rendered prompts', async () => {
    const cache = new ContextPromptSnapshotCache({ now: () => 1_000 })
    const build = vi.fn()
      .mockResolvedValueOnce({ renderedPrompt: '', bundleId: 'empty_bundle' })
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>fresh</jdc-context-engine>', bundleId: 'fresh_bundle' })

    const first = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1', objective: 'Fix Cache Bug' },
      build,
    })
    const second = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1', objective: 'Fix Cache Bug' },
      build,
    })

    expect(first).toMatchObject({ renderedPrompt: '', cacheHit: false, bundleId: 'empty_bundle' })
    expect(second).toMatchObject({ renderedPrompt: '<jdc-context-engine>fresh</jdc-context-engine>', cacheHit: false, bundleId: 'fresh_bundle' })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('bypasses a valid snapshot when forceRefresh is true', async () => {
    const cache = new ContextPromptSnapshotCache({ now: () => 1_000 })
    const build = vi.fn()
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>first</jdc-context-engine>', bundleId: 'bundle_1' })
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>forced</jdc-context-engine>', bundleId: 'bundle_2' })

    await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1', objective: 'Fix Cache Bug' },
      build,
    })
    const forced = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1', objective: 'Fix Cache Bug' },
      forceRefresh: true,
      build,
    })

    expect(forced).toMatchObject({ renderedPrompt: '<jdc-context-engine>forced</jdc-context-engine>', cacheHit: false, bundleId: 'bundle_2' })
    expect(build).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the cache unit tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/prompt-snapshot-cache.test.ts --no-file-parallelism
```

Expected: FAIL because `./prompt-snapshot-cache.js` does not exist.

- [ ] **Step 3: Implement the snapshot cache module**

Create `packages/core/src/context/prompt-snapshot-cache.ts`:

```ts
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ActorContextProfile, ContextRequest, ProviderProtocol } from './types.js'

export const CONTEXT_PROMPT_SNAPSHOT_TTL_MS = 5 * 60_000

export interface ContextPromptSnapshot {
  key: string
  renderedPrompt: string
  bundleId?: string
  createdAt: number
  expiresAt: number
  source: 'fresh'
}

export type ContextPromptSnapshotActorProfile =
  Pick<ActorContextProfile, 'actor'> &
  Partial<Pick<ActorContextProfile, 'sessionId' | 'subSessionId' | 'teamId' | 'memberId' | 'taskId'>>

export interface ContextPromptSnapshotKeyInput {
  request: Pick<ContextRequest, 'cwd' | 'sessionId' | 'mode' | 'userMessage' | 'model'>
  actorProfile?: ContextPromptSnapshotActorProfile
  providerProtocol?: ProviderProtocol | 'openai' | string
}

export interface ContextPromptSnapshotCacheOptions {
  ttlMs?: number
  now?: () => number
}

export interface ResolveContextPromptSnapshotOptions {
  cache?: ContextPromptSnapshotCache
  request: ContextRequest
  actorProfile?: ContextPromptSnapshotActorProfile
  providerProtocol?: ProviderProtocol | 'openai' | string
  forceRefresh?: boolean
  build: () => Promise<{ renderedPrompt: string; bundleId?: string }>
}

export interface ResolveContextPromptSnapshotResult {
  key: string
  renderedPrompt: string
  bundleId?: string
  cacheHit: boolean
}

export class ContextPromptSnapshotCache {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly entries = new Map<string, ContextPromptSnapshot>()

  constructor(options: ContextPromptSnapshotCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? CONTEXT_PROMPT_SNAPSHOT_TTL_MS
    this.now = options.now ?? Date.now
  }

  get(key: string): ContextPromptSnapshot | undefined {
    const snapshot = this.entries.get(key)
    if (!snapshot) return undefined
    if (snapshot.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return snapshot
  }

  set(key: string, renderedPrompt: string, bundleId?: string): ContextPromptSnapshot {
    const createdAt = this.now()
    const snapshot: ContextPromptSnapshot = {
      key,
      renderedPrompt,
      bundleId,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      source: 'fresh',
    }
    this.entries.set(key, snapshot)
    return snapshot
  }

  clear(): void {
    this.entries.clear()
  }
}

export const globalContextPromptSnapshotCache = new ContextPromptSnapshotCache()

export async function resolveContextPromptSnapshot(options: ResolveContextPromptSnapshotOptions): Promise<ResolveContextPromptSnapshotResult> {
  const cache = options.cache ?? globalContextPromptSnapshotCache
  const key = createContextPromptSnapshotKey({
    request: options.request,
    actorProfile: options.actorProfile,
    providerProtocol: options.providerProtocol,
  })

  if (!options.forceRefresh) {
    const snapshot = cache.get(key)
    if (snapshot) {
      return {
        key,
        renderedPrompt: snapshot.renderedPrompt,
        bundleId: snapshot.bundleId,
        cacheHit: true,
      }
    }
  }

  const fresh = await options.build()
  if (fresh.renderedPrompt) {
    cache.set(key, fresh.renderedPrompt, fresh.bundleId)
  }
  return {
    key,
    renderedPrompt: fresh.renderedPrompt,
    bundleId: fresh.bundleId,
    cacheHit: false,
  }
}

export function createContextPromptSnapshotKey(input: ContextPromptSnapshotKeyInput): string {
  const parts = {
    projectRoot: path.resolve(input.request.cwd),
    actorKey: actorKey(input.actorProfile, input.request.sessionId),
    mode: input.request.mode,
    modelFamilyKey: modelFamilyKey(input.providerProtocol, input.request.model),
  }
  return `ctx_prompt_snapshot_${hashText(JSON.stringify(parts)).slice(0, 24)}`
}

function actorKey(profile: ContextPromptSnapshotKeyInput['actorProfile'], sessionId: string): string {
  if (!profile) return `session:${sessionId}`
  if (profile.actor === 'main_session') return `session:${profile.sessionId ?? sessionId}`
  if (profile.actor === 'team_pm') return `team-pm:${profile.teamId ?? profile.sessionId ?? sessionId}`
  if (profile.actor === 'team_worker') {
    return [
      'team-worker',
      profile.teamId ?? 'team',
      profile.memberId ?? 'member',
      profile.taskId ?? profile.sessionId ?? sessionId,
    ].join(':')
  }
  if (profile.actor === 'subagent') return `sub:${profile.subSessionId ?? profile.sessionId ?? sessionId}`
  return `${profile.actor}:${profile.sessionId ?? sessionId}`
}

function modelFamilyKey(protocol: ContextPromptSnapshotKeyInput['providerProtocol'], model: string): string {
  const normalizedProtocol = protocol === 'openai' ? 'openai-chat' : (protocol || 'unknown')
  return `${normalizedProtocol}:${model}`
}

function normalizeIntent(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}
```

- [ ] **Step 4: Run the cache unit tests and verify they pass**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/prompt-snapshot-cache.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit the cache module**

```bash
git add packages/core/src/context/prompt-snapshot-cache.ts packages/core/src/context/prompt-snapshot-cache.test.ts
git commit -m "feat(context): add prompt snapshot cache"
```

## Task 2: Main Session Injection

**Files:**
- Modify: `packages/core/src/session-context.test.ts`
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: Write failing main-session cache tests**

In `packages/core/src/session-context.test.ts`, add this import near the other context imports:

```ts
import { ContextPromptSnapshotCache } from './context/prompt-snapshot-cache.js'
```

Then add these tests inside `describe('Session JDC Context Engine runtime integration', () => { ... })`, after the existing test named `injects a protocol-neutral context bundle before streaming and falls back when bundle generation fails`:

```ts
  it('reuses the same rendered context prompt across main-session user turns inside the snapshot window', async () => {
    const cache = new ContextPromptSnapshotCache({ now: () => 10_000 })
    const store = makeContextStore()
    let collectCount = 0
    const prompts: string[] = []
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'first' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
        { type: 'text_delta', text: 'second' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], (_messages, config) => {
        prompts.push(textFromSystemPrompt(config.systemPrompt))
      }),
      contextConfig: { injectionEnabled: true, harvestEnabled: false },
      contextStore: store,
      contextProviders: [{
        id: 'runtime',
        collect: async () => {
          collectCount++
          return {
            evidence: [],
            sections: [{
              id: `section_runtime_${collectCount}`,
              kind: 'runtime_state',
              title: 'Runtime context',
              content: `Runtime snapshot ${collectCount}`,
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
      }],
      promptSnapshotCache: cache,
    })

    await session.sendMessage('Fix cache bug', makeEvents())
    await session.sendMessage(' fix   cache bug ', makeEvents())

    expect(collectCount).toBe(1)
    expect(store.saveBundleSnapshot).toHaveBeenCalledTimes(1)
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('Runtime snapshot 1')
    expect(prompts[1]).toContain('Runtime snapshot 1')
    expect(prompts[1]).not.toContain('Runtime snapshot 2')
    expect(prompts[1]).toBe(prompts[0])
  })

  it('refreshes the main-session context prompt after the snapshot window expires', async () => {
    let now = 10_000
    const cache = new ContextPromptSnapshotCache({ now: () => now })
    let collectCount = 0
    const prompts: string[] = []
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'first' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
        { type: 'text_delta', text: 'second' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], (_messages, config) => {
        prompts.push(textFromSystemPrompt(config.systemPrompt))
      }),
      contextConfig: { injectionEnabled: true, harvestEnabled: false },
      contextStore: makeContextStore(),
      contextProviders: [{
        id: 'runtime',
        collect: async () => {
          collectCount++
          return {
            evidence: [],
            sections: [{
              id: `section_runtime_${collectCount}`,
              kind: 'runtime_state',
              title: 'Runtime context',
              content: `Runtime snapshot ${collectCount}`,
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
      }],
      promptSnapshotCache: cache,
    })

    await session.sendMessage('Fix cache bug', makeEvents())
    now += 5 * 60_000 + 1
    await session.sendMessage('fix cache bug', makeEvents())

    expect(collectCount).toBe(2)
    expect(prompts[0]).toContain('Runtime snapshot 1')
    expect(prompts[1]).toContain('Runtime snapshot 2')
    expect(prompts[1]).not.toBe(prompts[0])
  })

  it('reuses main-session context snapshots across different user turns inside the snapshot window', async () => {
    const cache = new ContextPromptSnapshotCache({ now: () => 10_000 })
    let collectCount = 0
    const prompts: string[] = []
    const session = await makeSession({
      provider: providerFromChunks([
        { type: 'text_delta', text: 'first' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
        { type: 'text_delta', text: 'second' },
        { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
      ], (_messages, config) => {
        prompts.push(textFromSystemPrompt(config.systemPrompt))
      }),
      contextConfig: { injectionEnabled: true, harvestEnabled: false },
      contextStore: makeContextStore(),
      contextProviders: [{
        id: 'runtime',
        collect: async () => {
          collectCount++
          return {
            evidence: [],
            sections: [{
              id: `section_runtime_${collectCount}`,
              kind: 'runtime_state',
              title: 'Runtime context',
              content: `Runtime snapshot ${collectCount}`,
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
      }],
      promptSnapshotCache: cache,
    })

    await session.sendMessage('Fix cache bug', makeEvents())
    await session.sendMessage('Review provider prompt shape', makeEvents())

    expect(collectCount).toBe(2)
    expect(prompts[0]).toContain('Runtime snapshot 1')
    expect(prompts[1]).toContain('Runtime snapshot 2')
  })
```

Update the `makeSession()` helper option type in the same file:

```ts
  promptSnapshotCache?: ContextPromptSnapshotCache
```

Then pass it through in the `session.configureContextEngine({ ... })` call inside `makeSession()`:

```ts
    promptSnapshotCache: options.promptSnapshotCache,
```

- [ ] **Step 2: Run the main-session tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: FAIL because `configureContextEngine()` does not accept `promptSnapshotCache`, and `Session.injectContextForRunLoop()` still calls `buildContextBundle()` on every turn.

- [ ] **Step 3: Add the cache to `Session` and use it in main injection**

In `packages/core/src/session.ts`, add this import near the existing context imports:

```ts
import { globalContextPromptSnapshotCache, resolveContextPromptSnapshot, type ContextPromptSnapshotCache } from './context/prompt-snapshot-cache.js'
```

Add this private field near the other context fields:

```ts
  private contextPromptSnapshotCache: ContextPromptSnapshotCache = globalContextPromptSnapshotCache
```

Update the `configureContextEngine()` options type:

```ts
    promptSnapshotCache?: ContextPromptSnapshotCache
```

Set the field inside `configureContextEngine()`:

```ts
    this.contextPromptSnapshotCache = options.promptSnapshotCache ?? globalContextPromptSnapshotCache
```

In `injectContextForRunLoop()`, replace the current `runForeground()` body with this exact structure:

```ts
  private async injectContextForRunLoop(userMessage: string): Promise<void> {
    if (!this.contextConfig.enabled || !this.contextConfig.injectionEnabled) return
    const request = await this.createContextRequest(userMessage)
    const performance = this.contextPerformanceConfig()
    const actorProfile = mainSessionProfile(request, userMessage)
    let renderedPrompt = ''
    try {
      const resolved = await this.contextScheduler.runForeground(
        'context:inject',
        performance.degradedProviderTimeoutMs,
        async (signal) => {
          const requestWithSignal = { ...request, signal }
          const snapshot = await resolveContextPromptSnapshot({
            cache: this.contextPromptSnapshotCache,
            request: requestWithSignal,
            actorProfile,
            providerProtocol: this.contextProtocol ?? normalizeProviderProtocol(this.provider.name),
            build: async () => {
              const store = await this.getContextStore()
              if (signal.aborted) throw new Error('context injection budget expired')
              const result = await buildContextBundle(requestWithSignal, {
                injectionEnabled: this.contextConfig.injectionEnabled,
                includeAgentContract: true,
                store,
                providers: this.getContextProviders(),
                providerTimeoutMs: performance.providerTimeoutMs,
                scheduler: this.contextScheduler,
                actorProfile,
                id: this.contextId,
              })
              return { renderedPrompt: result.renderedPrompt, bundleId: result.bundle.id }
            },
          })
          return snapshot.renderedPrompt
        },
        '',
      )
      renderedPrompt = resolved
    } catch (error) {
      void this.saveContextInjectionDiagnostic(error)
    }
    if (!renderedPrompt) return
    this.config.modelConfig.systemPrompt = appendContextPromptSegment(this.config.modelConfig.systemPrompt, renderedPrompt)
  }
```

In both places where a `contextEngine` object is built for sub-agents or Team dependencies, add:

```ts
          promptSnapshotCache: this.contextPromptSnapshotCache,
```

- [ ] **Step 4: Run the main-session tests and verify they pass**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit main-session integration**

```bash
git add packages/core/src/session.ts packages/core/src/session-context.test.ts
git commit -m "feat(context): snapshot main session context prompt"
```

## Task 3: Sub-Session Injection

**Files:**
- Modify: `packages/core/src/sub-session-compaction.test.ts`
- Modify: `packages/core/src/sub-session.ts`

- [ ] **Step 1: Write the failing sub-session cache test**

In `packages/core/src/sub-session-compaction.test.ts`, add these imports:

```ts
import { ContextPromptSnapshotCache } from './context/prompt-snapshot-cache.js'
import type { ContextProvider } from './context/orchestrator.js'
import type { ContextRequest } from './context/types.js'
```

Add this test inside `describe('sub-session compaction', () => { ... })`:

```ts
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
            id: `sub_runtime_${collectCount}`,
            kind: 'runtime_state',
            title: 'Sub runtime context',
            content: `Sub runtime snapshot ${collectCount}`,
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
    expect(prompts[0]).toContain('Sub runtime snapshot 1')
    expect(prompts[1]).toBe(prompts[0])
  })
```

- [ ] **Step 2: Run the sub-session test and verify it fails**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/sub-session-compaction.test.ts --no-file-parallelism
```

Expected: FAIL because `SubSessionOptions.contextEngine` does not accept `promptSnapshotCache`, and sub-sessions still rebuild context every run.

- [ ] **Step 3: Use the helper in sub-session context injection**

In `packages/core/src/sub-session.ts`, add this import:

```ts
import { globalContextPromptSnapshotCache, resolveContextPromptSnapshot, type ContextPromptSnapshotCache } from './context/prompt-snapshot-cache.js'
```

Add this optional field to `SubSessionOptions.contextEngine`:

```ts
    promptSnapshotCache?: ContextPromptSnapshotCache
```

In `buildSubSessionContextPrompt()`, replace the existing context build block inside `runForeground()` with:

```ts
        const request: ContextRequest = {
          sessionId: contextSessionId,
          cwd: opts.cwd,
          userMessage: prompt,
          recentMessages: messages.slice(-8),
          transcriptAlreadyInModel: true,
          carriedContext: {
            projectInstructionRefs: [],
            gitStatusInSystemPrompt: false,
            taskRefs: [],
          },
          mode: 'chat',
          model: opts.modelConfig.model,
          modelProfile: opts.modelConfig.modelProfile,
          runtime: {},
          signal,
          createdAt: Date.now(),
        }
        const actorProfile = buildSubSessionActorProfile(opts, contextSessionId, prompt)
        const snapshot = await resolveContextPromptSnapshot({
          cache: opts.contextEngine!.promptSnapshotCache ?? globalContextPromptSnapshotCache,
          request,
          actorProfile,
          providerProtocol: opts.contextEngine!.protocol ?? opts.provider.name,
          build: async () => {
            const result = await buildContextBundle(request, {
              injectionEnabled: contextConfig.injectionEnabled,
              includeAgentContract: true,
              store: opts.contextEngine!.store,
              providers: opts.contextEngine!.providers ?? [],
              providerTimeoutMs: performance.providerTimeoutMs,
              scheduler: contextScheduler,
              id: opts.contextEngine!.id,
              actorProfile,
            })
            return { renderedPrompt: result.renderedPrompt, bundleId: result.bundle.id }
          },
        })
        if (!snapshot.renderedPrompt) return systemPrompt
        return appendContextPromptSegment(systemPrompt, snapshot.renderedPrompt)
```

Also change the early return at the top of `buildSubSessionContextPrompt()`:

```ts
  if (!opts.contextEngine || !contextConfig.enabled || !contextConfig.injectionEnabled) return systemPrompt
```

- [ ] **Step 4: Run sub-session tests and focused session tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/sub-session-compaction.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit sub-session integration**

```bash
git add packages/core/src/sub-session.ts packages/core/src/sub-session-compaction.test.ts
git commit -m "feat(context): snapshot sub-session context prompt"
```

## Task 4: Team PM Injection

**Files:**
- Modify: `packages/core/src/team/__tests__/team-manager-ai.test.ts`
- Modify: `packages/core/src/team/team-manager-ai.ts`

- [ ] **Step 1: Write the failing Team PM cache test**

In `packages/core/src/team/__tests__/team-manager-ai.test.ts`, add this import:

```ts
import { ContextPromptSnapshotCache } from '../../context/prompt-snapshot-cache.js'
```

Update `makeContextStore()` so `saveBundleSnapshot` is a `vi.fn` by importing `vi` and returning a mock:

```ts
import { describe, it, expect, vi } from 'vitest'
```

```ts
    saveBundleSnapshot: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
```

Add this test inside `describe('TeamManagerAI scheduling', () => { ... })`:

```ts
  it('reuses the rendered context prompt for repeated Team PM cycles inside the snapshot window', async () => {
    const provider = new DeferredProvider()
    const cache = new ContextPromptSnapshotCache({ now: () => 10_000 })
    const store = makeContextStore()
    let collectCount = 0
    const contextProviders: ContextProvider[] = [{
      id: 'runtime',
      collect: async () => {
        collectCount++
        return {
          evidence: [],
          sections: [{
            id: `team_pm_runtime_${collectCount}`,
            kind: 'runtime_state',
            title: 'Team PM runtime',
            content: `Team PM snapshot ${collectCount}`,
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
    }]
    const manager = new TeamManagerAI({
      initialTasks: [{ title: 'A', description: 'do A' }],
      provider,
      modelConfig: { model: 'test-model', maxTokens: 1000 },
      memberStates: () => [],
      cwd: '/tmp/team-manager-ai-test',
      teamId: 'team_cache_test',
      objective: 'Fix cache coordination',
      contextEngine: {
        sessionId: 'team_pm_cache_session',
        config: { enabled: true, injectionEnabled: true, harvestEnabled: false },
        store: store as any,
        providers: contextProviders,
        promptSnapshotCache: cache,
      },
    })

    manager.triggerProactiveCheck({ kind: 'task_completed', taskId: manager.getTasks()[0].id })
    await waitFor(() => provider.calls.length === 1)
    const firstPrompt = systemPromptText(provider.calls[0].config.systemPrompt)
    provider.respond(0, '[]')
    await flush()

    manager.triggerProactiveCheck({ kind: 'task_completed', taskId: manager.getTasks()[0].id })
    await waitFor(() => provider.calls.length === 2)
    const secondPrompt = systemPromptText(provider.calls[1].config.systemPrompt)
    provider.respond(1, '[]')
    await flush()

    expect(collectCount).toBe(1)
    expect(store.saveBundleSnapshot).toHaveBeenCalledTimes(1)
    expect(firstPrompt).toContain('Team PM snapshot 1')
    expect(secondPrompt).toBe(firstPrompt)
  })
```

- [ ] **Step 2: Run Team PM tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/team/__tests__/team-manager-ai.test.ts --no-file-parallelism
```

Expected: FAIL because `TeamManagerAIOptions.contextEngine` does not accept `promptSnapshotCache`, and Team PM still rebuilds context each cycle.

- [ ] **Step 3: Use the helper in Team PM context injection**

In `packages/core/src/team/team-manager-ai.ts`, add this import:

```ts
import { globalContextPromptSnapshotCache, resolveContextPromptSnapshot, type ContextPromptSnapshotCache } from '../context/prompt-snapshot-cache.js'
```

Update the existing context type import:

```ts
import type { ContextRequest, ProviderProtocol } from '../context/types.js'
```

Add this optional field to `TeamManagerAIOptions.contextEngine`:

```ts
    promptSnapshotCache?: ContextPromptSnapshotCache
```

In `buildPMSystemPrompt()`, change the early return:

```ts
    if (!contextConfig.enabled || !contextConfig.injectionEnabled) return systemPrompt
```

Replace the `buildContextBundle()` block inside `scheduler.runForeground()` with:

```ts
          const request: ContextRequest = {
            sessionId: contextSessionId,
            cwd: this.cwd,
            userMessage: userText,
            recentMessages: recentMessages.slice(-8),
            transcriptAlreadyInModel: true,
            carriedContext: {
              projectInstructionRefs: [],
              gitStatusInSystemPrompt: false,
              taskRefs: [],
            },
            mode: 'plan',
            model: this.modelConfig.model,
            modelProfile: this.modelConfig.modelProfile,
            runtime: { teamId: this.teamId, memberStates: this.getMemberStates() },
            signal,
            createdAt: Date.now(),
          }
          const actorProfile = teamPmProfile({
            sessionId: contextSessionId,
            cwd: this.cwd,
            mode: 'plan',
            objective: this.objective,
            teamId: this.teamId,
          })
          const snapshot = await resolveContextPromptSnapshot({
            cache: engine.promptSnapshotCache ?? globalContextPromptSnapshotCache,
            request,
            actorProfile,
            providerProtocol: engine.protocol ?? this.provider.name,
            build: async () => {
              const result = await buildContextBundle(request, {
                injectionEnabled: contextConfig.injectionEnabled,
                includeAgentContract: true,
                store: engine.store,
                providers: engine.providers ?? [],
                providerTimeoutMs: performance.providerTimeoutMs,
                scheduler,
                actorProfile,
                id: engine.id,
              })
              return { renderedPrompt: result.renderedPrompt, bundleId: result.bundle.id }
            },
          })
          if (!snapshot.renderedPrompt) return systemPrompt
          return appendContextPromptSegment(systemPrompt, snapshot.renderedPrompt)
```

- [ ] **Step 4: Run Team PM tests and focused context tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/team/__tests__/team-manager-ai.test.ts src/sub-session-compaction.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit Team PM integration**

```bash
git add packages/core/src/team/team-manager-ai.ts packages/core/src/team/__tests__/team-manager-ai.test.ts
git commit -m "feat(context): snapshot team pm context prompt"
```

## Task 5: Provider Contract And Final Verification

**Files:**
- Modify: `packages/core/src/providers/provider-prompt-contract.test.ts`
- Modify only if tests reveal a real issue: `packages/core/src/providers/anthropic.ts`

- [ ] **Step 1: Add a provider contract regression for cached Engine segments**

In `packages/core/src/providers/provider-prompt-contract.test.ts`, add this test:

```ts
  it('keeps cached JDC Context Engine prompt segments outside Anthropic cache_control breakpoints', () => {
    const cachedContext = '<jdc-context-engine bundle="ctx_cached">cached project context</jdc-context-engine>'
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDC CODE.', cacheable: true },
      { content: cachedContext, cacheable: false },
    ]

    const blocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, 'x-anthropic-billing-header: cc_version=test;')
    const contextBlock = blocks.find((block: any) => block.text.includes('ctx_cached'))

    expect(contextBlock).toBeDefined()
    expect(contextBlock?.cache_control).toBeUndefined()
    expect(blocks.filter((block: any) => block.cache_control).length).toBe(1)
  })
```

- [ ] **Step 2: Run provider prompt tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/providers/provider-prompt-contract.test.ts --no-file-parallelism
```

Expected: PASS. If this fails because Anthropic adds `cache_control` to the Engine segment, fix `packages/core/src/providers/anthropic.ts` so only `PromptSegment.cacheable === true` segments can receive `cache_control`.

- [ ] **Step 3: Run the full focused verification set**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/prompt-snapshot-cache.test.ts src/session-context.test.ts src/sub-session-compaction.test.ts src/team/__tests__/team-manager-ai.test.ts src/providers/provider-prompt-contract.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 4: Build core**

Run:

```bash
pnpm --filter @jdcagnet/core build
```

Expected: PASS.

- [ ] **Step 5: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 6: Commit provider contract and verification test updates**

```bash
git add packages/core/src/providers/provider-prompt-contract.test.ts
git commit -m "test(context): lock snapshot prompt provider contract"
```

## Final Acceptance

- Same project + actor + mode + model/protocol + model profile + selection bucket reuses identical rendered JDC Context Engine prompt for 5 minutes, even when the next user turn text differs.
- Empty rendered prompts are not cached.
- Expired snapshots rebuild normally.
- Main session, sub-session, and Team PM all use the same cache helper.
- Cache hits do not call providers or save new bundle snapshots.
- Anthropic request shape stays unchanged: cached Engine prompt remains a non-cacheable system segment.
- Context Engine capacity remains relevance-first with no new local token cap.
