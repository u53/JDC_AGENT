# JDC Context Engine Production Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild JDC Context Engine into a project-level, Chinese-first, performance-bounded, invisible context system that stores only accepted durable facts and improves across sessions.

**Architecture:** Add a performance scheduler, durable-truth contract, task-aware `ContextPlanner`, routed harvest pipeline, stronger prompt/tool contracts, Chinese observability UI, and product eval gates. Normal chat must remain fail-open and cheap; expensive indexing/harvest/diagnostics must run in controlled background paths.

**Tech Stack:** TypeScript, Vitest, sql.js, Electron IPC, Zustand, React, existing JDC code engine, existing Anthropic/OpenAI provider abstractions.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-06-02-jdc-context-engine-production-diagnosis.md`
- Existing design: `docs/superpowers/specs/2026-06-01-jdc-context-engine-production-design.md`
- Existing contract: `docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md`

## Dependency Graph

```text
Task 1 Performance Scheduler
  -> Task 4 Context Planner
  -> Task 5 Harvest Router
  -> Task 7 UI Auto Observability

Task 2 Durable Truth Store Contract
  -> Task 4 Context Planner
  -> Task 6 Cross-Session Project Consistency
  -> Task 7 UI Auto Observability

Task 3 Prompt/Tool Contract Cleanup
  -> Task 5 Harvest Router
  -> Task 7 UI Auto Observability

Task 4 Context Planner
  -> Task 8 Product Evals

Task 5 Harvest Router
  -> Task 8 Product Evals

Task 6 Cross-Session Project Consistency
  -> Task 7 UI Auto Observability
  -> Task 8 Product Evals

Task 7 UI Auto Observability
  -> Task 8 Product Evals

Task 8 Product Evals
  -> Release Gate
```

## File Boundary Map

Create:

- `packages/core/src/context/performance.ts`
- `packages/core/src/context/scheduler.ts`
- `packages/core/src/context/planner.ts`
- `packages/core/src/context/harvest-router.ts`
- `packages/core/src/context/context-planner.test.ts`
- `packages/core/src/context/context-scheduler.test.ts`
- `packages/core/src/context/harvest-router.test.ts`
- `packages/core/src/context/context-product-evals.test.ts`
- `packages/ui/src/components/context/ContextFactsPanel.tsx`
- `packages/ui/src/components/context/ContextCurrentPanel.tsx`
- `packages/ui/src/components/context/ContextAdvancedDiagnosticsPanel.tsx`
- `packages/ui/src/components/context/ContextPanelLayout.tsx`

Modify:

- `packages/core/src/context/types.ts`
- `packages/core/src/context/config.ts`
- `packages/core/src/context/orchestrator.ts`
- `packages/core/src/context/store.ts`
- `packages/core/src/context/harvest.ts`
- `packages/core/src/context/safety.ts`
- `packages/core/src/context/distillers/model-client.ts`
- `packages/core/src/context-engine/prompt.ts`
- `packages/core/src/session.ts`
- `packages/core/src/sub-session.ts`
- `packages/core/src/tools/context-inspect.ts`
- `packages/core/src/tools/context-refresh.ts`
- `packages/core/src/tools/memory-search.ts`
- `packages/core/src/tools/memory-write.ts`
- `packages/core/src/tools/context-engine-tools.ts`
- `packages/core/src/index.ts`
- `packages/electron/src/ipc-handlers.ts`
- `packages/electron/src/session-manager.ts`
- `packages/ui/src/components/context/ContextPanel.tsx`
- `packages/ui/src/components/context/ContextInspectPanel.tsx`
- `packages/ui/src/components/context/HarvestQueuePanel.tsx`
- `packages/ui/src/components/context/MemoryReviewPanel.tsx`
- `packages/ui/src/components/context/ProviderHealthPanel.tsx`
- `packages/ui/src/components/context/ContextPanelPrimitives.tsx`
- `packages/ui/src/stores/context-store.ts`
- `packages/ui/src/components/Inspector.tsx`
- `packages/ui/src/components/tool-cards/tool-card-meta.ts`
- `packages/ui/src/hooks/useSession.ts`
- `packages/ui/src/stores/context-store.test.tsx`
- `packages/ui/src/components/context/context-panels.test.tsx`
- `docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md`

## Global Acceptance Gates

Every task must preserve these commands:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-scheduler.test.ts src/context/context-planner.test.ts src/context/harvest-router.test.ts src/context/context-product-evals.test.ts src/session-context.test.ts src/context/context-harvest.test.ts src/tools/context-tools.test.ts src/tools/memory-tools.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx src/components/context/context-panels.test.tsx src/stores/session-store.test.ts src/components/MarkdownRenderer.test.tsx --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/ui build
pnpm --filter ./packages/electron build
pnpm exec tsc --noEmit -p packages/electron/tsconfig.json
git diff --check
```

Expected final result: all commands pass.

---

## Task 1: Performance Scheduler And Instrumentation

**Owner:** Runtime/Performance Engineer

**Depends on:** none

**Files:**

- Create: `packages/core/src/context/performance.ts`
- Create: `packages/core/src/context/scheduler.ts`
- Create: `packages/core/src/context/context-scheduler.test.ts`
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Modify: `packages/electron/src/session-manager.ts`

**Goal:** Make all Context Engine foreground/background work budgeted, timed, and fail-open.

- [ ] **Step 1: Write scheduler timing tests**

Add this test file:

```ts
// packages/core/src/context/context-scheduler.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createContextPerformanceRecorder } from './performance.js'
import { createContextScheduler } from './scheduler.js'

describe('JDC Context Engine scheduler', () => {
  it('records foreground operation duration and returns degraded result when budget expires', async () => {
    vi.useFakeTimers()
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now() })
    const slow = scheduler.runForeground('provider:code', 50, async (signal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 100)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('aborted by context budget'))
        })
      })
      return 'slow-result'
    }, 'degraded-result')

    await vi.advanceTimersByTimeAsync(60)

    await expect(slow).resolves.toBe('degraded-result')
    expect(recorder.snapshot().operations[0]).toMatchObject({
      name: 'provider:code',
      lane: 'foreground',
      status: 'timeout',
    })
    vi.useRealTimers()
  })

  it('limits project background jobs by key', async () => {
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now(), maxBackgroundPerProject: 1 })
    const release = deferred<void>()
    const first = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      await release.promise
    })
    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined)

    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe('project_concurrency_limit')

    release.resolve()
    await first.promise
  })

  it('rate limits background jobs by project and job name', async () => {
    let clock = 1_000
    const recorder = createContextPerformanceRecorder({ now: () => clock })
    const scheduler = createContextScheduler({ recorder, now: () => clock, maxBackgroundPerProject: 1 })

    const first = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined, { minIntervalMs: 30_000 })
    expect(first.accepted).toBe(true)
    if (first.accepted) await first.promise

    clock = 5_000
    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined, { minIntervalMs: 30_000 })
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe('project_interval_limit')

    clock = 31_500
    const third = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined, { minIntervalMs: 30_000 })
    expect(third.accepted).toBe(true)
    if (third.accepted) await third.promise
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
```

- [ ] **Step 2: Run scheduler tests and verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-scheduler.test.ts --no-file-parallelism
```

Expected: FAIL because `performance.ts` and `scheduler.ts` do not exist.

- [ ] **Step 3: Implement performance recorder**

Create:

```ts
// packages/core/src/context/performance.ts
export type ContextOperationLane = 'foreground' | 'background' | 'renderer' | 'storage'
export type ContextOperationStatus = 'success' | 'timeout' | 'cancelled' | 'failed' | 'rejected'

export interface ContextOperationMetric {
  id: string
  name: string
  lane: ContextOperationLane
  status: ContextOperationStatus
  startedAt: number
  completedAt: number
  durationMs: number
  projectKey?: string
  diagnostic?: string
}

export interface ContextPerformanceSnapshot {
  operations: ContextOperationMetric[]
}

export interface ContextPerformanceRecorder {
  record(metric: Omit<ContextOperationMetric, 'id' | 'durationMs'>): void
  snapshot(): ContextPerformanceSnapshot
  clear(): void
}

export function createContextPerformanceRecorder(options: { now?: () => number; maxOperations?: number } = {}): ContextPerformanceRecorder {
  const now = options.now ?? Date.now
  const maxOperations = options.maxOperations ?? 500
  const operations: ContextOperationMetric[] = []
  let counter = 0

  return {
    record(metric) {
      operations.push({
        ...metric,
        id: `ctx_perf_${++counter}`,
        durationMs: Math.max(0, metric.completedAt - metric.startedAt),
      })
      while (operations.length > maxOperations) operations.shift()
    },
    snapshot() {
      return { operations: [...operations] }
    },
    clear() {
      operations.length = 0
      counter = 0
      void now
    },
  }
}
```

- [ ] **Step 4: Implement scheduler**

Create:

```ts
// packages/core/src/context/scheduler.ts
import type { ContextPerformanceRecorder, ContextOperationLane } from './performance.js'
import { createContextPerformanceRecorder } from './performance.js'

export type BackgroundRejectReason = 'project_concurrency_limit' | 'project_interval_limit'

export interface ContextScheduler {
  runForeground<T>(name: string, timeoutMs: number, task: (signal: AbortSignal) => Promise<T>, degraded: T): Promise<T>
  enqueueBackground(projectKey: string, name: string, task: (signal: AbortSignal) => Promise<void>, options?: { minIntervalMs?: number }): { accepted: true; promise: Promise<void> } | { accepted: false; reason: BackgroundRejectReason }
  cancelProject(projectKey: string): void
  recorder: ContextPerformanceRecorder
}

export function createContextScheduler(options: {
  recorder?: ContextPerformanceRecorder
  now?: () => number
  maxBackgroundPerProject?: number
} = {}): ContextScheduler {
  const recorder = options.recorder ?? createContextPerformanceRecorder({ now: options.now })
  const now = options.now ?? Date.now
  const maxBackgroundPerProject = options.maxBackgroundPerProject ?? 1
  const active = new Map<string, Set<AbortController>>()
  const lastStartedAtByProjectJob = new Map<string, number>()

  async function runMeasured<T>(lane: ContextOperationLane, name: string, projectKey: string | undefined, task: (signal: AbortSignal) => Promise<T>, timeoutMs?: number, degraded?: T): Promise<T> {
    const startedAt = now()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => controller.abort(), timeoutMs)
    }
    try {
      const value = await task(controller.signal)
      recorder.record({ name, lane, status: 'success', startedAt, completedAt: now(), projectKey })
      return value
    } catch (error) {
      const aborted = controller.signal.aborted
      recorder.record({
        name,
        lane,
        status: aborted ? 'timeout' : 'failed',
        startedAt,
        completedAt: now(),
        projectKey,
        diagnostic: error instanceof Error ? error.message : String(error),
      })
      if (aborted && degraded !== undefined) return degraded
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return {
    recorder,
    runForeground(name, timeoutMs, task, degraded) {
      return runMeasured('foreground', name, undefined, task, timeoutMs, degraded)
    },
    enqueueBackground(projectKey, name, task, jobOptions = {}) {
      const startedAt = now()
      const intervalKey = `${projectKey}:${name}`
      const lastStartedAt = lastStartedAtByProjectJob.get(intervalKey)
      if (jobOptions.minIntervalMs && lastStartedAt !== undefined && startedAt - lastStartedAt < jobOptions.minIntervalMs) {
        recorder.record({ name, lane: 'background', status: 'rejected', startedAt, completedAt: now(), projectKey, diagnostic: 'project_interval_limit' })
        return { accepted: false, reason: 'project_interval_limit' }
      }
      const set = active.get(projectKey) ?? new Set<AbortController>()
      if (set.size >= maxBackgroundPerProject) {
        recorder.record({ name, lane: 'background', status: 'rejected', startedAt, completedAt: now(), projectKey, diagnostic: 'project_concurrency_limit' })
        return { accepted: false, reason: 'project_concurrency_limit' }
      }
      const controller = new AbortController()
      set.add(controller)
      active.set(projectKey, set)
      lastStartedAtByProjectJob.set(intervalKey, startedAt)
      const promise = task(controller.signal)
        .then(() => {
          recorder.record({ name, lane: 'background', status: 'success', startedAt, completedAt: now(), projectKey })
        })
        .catch((error) => {
          recorder.record({ name, lane: 'background', status: controller.signal.aborted ? 'cancelled' : 'failed', startedAt, completedAt: now(), projectKey, diagnostic: error instanceof Error ? error.message : String(error) })
        })
        .finally(() => {
          set.delete(controller)
          if (set.size === 0) active.delete(projectKey)
        })
      return { accepted: true, promise }
    },
    cancelProject(projectKey) {
      const set = active.get(projectKey)
      if (!set) return
      for (const controller of set) controller.abort()
      active.delete(projectKey)
    },
  }
}
```

- [ ] **Step 5: Run scheduler tests and verify green**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-scheduler.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Wire scheduler into foreground context injection**

Modify `packages/core/src/context/orchestrator.ts` and `packages/core/src/session.ts` so provider collection uses a foreground budget. Use degraded empty provider result when a provider times out. Do not start indexing or harvest inside foreground scheduler.

Required behavior:

```ts
const result = await scheduler.runForeground(
  `provider:${provider.id}`,
  contextConfig.performance.providerTimeoutMs,
  (signal) => provider.collect({ ...request, signal } as never),
  degradedProviderResult(provider.id, request),
)
```

Extend `ContextRequest` with `signal?: AbortSignal` and update provider call sites to pass it through. Providers that cannot consume a signal must still be wrapped by the scheduler timeout and return degraded context on budget expiry.

- [ ] **Step 7: Add config defaults**

Modify `packages/core/src/context/config.ts` and `packages/core/src/context/types.ts`:

```ts
performance: {
  providerTimeoutMs: 120,
  degradedProviderTimeoutMs: 200,
  maxBackgroundJobsPerProject: 1,
  harvestMinIntervalMs: 30_000,
  contextPanelMaxRows: 50,
}
```

- [ ] **Step 8: Verify core runtime remains green**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-scheduler.test.ts src/session-context.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/context/performance.ts packages/core/src/context/scheduler.ts packages/core/src/context/context-scheduler.test.ts packages/core/src/context/types.ts packages/core/src/context/config.ts packages/core/src/context/orchestrator.ts packages/core/src/session.ts packages/core/src/sub-session.ts packages/electron/src/session-manager.ts
git commit -m "feat(context): add performance scheduler"
```

---

## Task 2: Durable Truth Store Contract

**Owner:** Context Store Engineer

**Depends on:** Task 1 for performance metrics, but can begin schema tests independently.

**Files:**

- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/store.ts`
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/tools/context-inspect.ts`
- Modify: `packages/core/src/tools/memory-search.ts`
- Test: `packages/core/src/context/store.test.ts`
- Test: `packages/core/src/context/context-harvest.test.ts`
- Test: `packages/core/src/tools/context-tools.test.ts`

**Goal:** Persist only accepted durable facts as project truth. Keep skipped/rejected/no-op/failed data as short-lived advanced diagnostics, not main panel content or injected context.

- [ ] **Step 1: Write failing store test for durable truth separation**

Append to `packages/core/src/context/store.test.ts`:

```ts
it('keeps accepted durable facts separate from operational harvest noise', async () => {
  const dir = makeTempDir()
  const store = await openContextStore({ cwd: dir, now: () => 10_000 })
  await store.saveFact(fact({ id: 'project_rule', content: 'Run pnpm build before release.', scope: 'project', confidence: 0.91 }))
  await store.rejectCandidate({ action: 'skip', reason: 'model_noop' }, 'Harvest model skipped durable storage: model_noop', {
    id: 'noop_candidate',
    sessionId: 'session_1',
    createdAt: 10_000,
    validationErrors: ['model_noop'],
    status: 'rejected',
  })

  const facts = await store.listAcceptedProjectFacts()
  expect(facts.value.map((item) => item.id)).toEqual(['project_rule'])

  const diagnostics = await store.listAdvancedDiagnostics({ sessionId: 'session_1', includeNoop: true })
  expect(diagnostics.value.rejected.map((item) => item.id)).toEqual(['noop_candidate'])
  expect(diagnostics.value.harvestJobs).toEqual([])
})
```

- [ ] **Step 2: Run store test and verify red or existing behavior**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
```

Expected: FAIL because `listAcceptedProjectFacts()` and `listAdvancedDiagnostics()` do not exist yet, or because operational rows still leak into accepted fact queries.

- [ ] **Step 3: Add explicit query APIs for accepted project facts**

Modify `ContextStore` in `packages/core/src/context/store.ts`:

```ts
listAcceptedProjectFacts(query?: Omit<ContextFactQuery, 'scope'>): Promise<ContextStoreResult<ContextFact[]>>
listAdvancedDiagnostics(options?: { sessionId?: string; includeNoop?: boolean; limit?: number }): Promise<ContextStoreResult<{
  rejected: RejectedCandidateRecord[]
  diagnostics: ContextDiagnostic[]
  harvestJobs: HarvestJob[]
}>>
```

Implementation rule:

- `listAcceptedProjectFacts()` returns accepted facts with `scope in ('project','repo','global')` and excludes stale/expired by default.
- `listAdvancedDiagnostics()` is the only normal API that returns rejected/no-op/failed operational records.

- [ ] **Step 4: Update inspect tool to hide no-op by default**

Modify `packages/core/src/tools/context-inspect.ts`:

```ts
interface InspectContextInput {
  sessionId?: string
  bundleId?: string
  includeExpiredRejected?: boolean
  includeAdvancedDiagnostics?: boolean
}
```

Behavior:

- default inspect payload returns accepted project facts and current bundle summary;
- no-op/skipped/rejected/failed jobs are excluded unless `includeAdvancedDiagnostics` is true;
- `model_noop` diagnostics are collapsed into aggregate counts.

- [ ] **Step 5: Update harvest no-op persistence**

Modify `packages/core/src/context/harvest.ts`:

```ts
if (isDistillerSkipOutput(output)) {
  return await skipJob(current, output.reason, output.diagnostic ?? `Harvest model skipped durable storage: ${output.reason}`, options.store, now, {
    visibleInPrimaryUi: false,
  })
}
```

Add the `visibleInPrimaryUi: false` option to the skip persistence path and enforce the same hiding rule in `context-inspect.ts`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts src/context/context-harvest.test.ts src/tools/context-tools.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/store.ts packages/core/src/context/harvest.ts packages/core/src/tools/context-inspect.ts packages/core/src/tools/memory-search.ts packages/core/src/context/store.test.ts packages/core/src/context/context-harvest.test.ts packages/core/src/tools/context-tools.test.ts
git commit -m "feat(context): separate durable truth from diagnostics"
```

---

## Task 3: Prompt And Tool Contract Cleanup

**Owner:** Prompt/Tooling Engineer

**Depends on:** none

**Files:**

- Modify: `packages/core/src/context-engine/prompt.ts`
- Modify: `packages/core/src/tools/memory-write.ts`
- Modify: `packages/core/src/tools/memory-search.ts`
- Modify: `packages/core/src/tools/context-inspect.ts`
- Modify: `packages/core/src/tools/context-refresh.ts`
- Modify: `packages/core/src/tools/context-engine-tools.ts`
- Modify: `packages/ui/src/components/tool-cards/tool-card-meta.ts`
- Modify: `packages/ui/src/hooks/useSession.ts`
- Test: `packages/core/src/context-legacy-memory.test.ts`
- Test: `packages/core/src/tools/memory-tools.test.ts`
- Test: `packages/ui/src/components/tool-cards/tool-card-meta.test.ts`

**Goal:** Remove old memory behavior from model-facing and UI-facing contracts. Make `JdcMemoryWrite` and `JdcMemorySearch` the explicit project-memory path.

- [ ] **Step 1: Write failing prompt test**

Append to `packages/core/src/context-legacy-memory.test.ts`:

```ts
it('describes JDC project memory and forbids legacy SaveMemory in the context engine prompt', () => {
  const prompt = getContextEnginePromptSegment().segment
  expect(prompt).toContain('JdcMemoryWrite')
  expect(prompt).toContain('JdcMemorySearch')
  expect(prompt).toContain('项目级')
  expect(prompt).toContain('citation')
  expect(prompt).not.toContain('SaveMemory')
})
```

Import `getContextEnginePromptSegment` from `./context-engine/prompt.js`.

- [ ] **Step 2: Run prompt test and verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context-legacy-memory.test.ts --no-file-parallelism
```

Expected: FAIL because current context-engine prompt only describes code tools.

- [ ] **Step 3: Rewrite context engine prompt segment**

Modify `packages/core/src/context-engine/prompt.ts` so it explains three surfaces:

```text
1. 代码理解：JdcContext/JdcSearch/JdcNode/...
2. 项目记忆：JdcMemorySearch/JdcMemoryWrite
3. 诊断观察：JdcContextInspect/JdcContextRefresh
```

Required model-facing rules:

```text
- 不要使用旧的 SaveMemory。
- 用户明确要求“记住/保存”时，只有能提供 citation 才使用 JdcMemoryWrite。
- 项目约定、工作流规则、架构决策、已知问题默认 scope=project。
- 问“你记得什么/项目约定是什么”时，使用 JdcMemorySearch。
- 不保存问候、确认、猜测、无 citation 摘要、raw reasoning、secret、一次性临时状态。
```

- [ ] **Step 4: Strengthen memory tool descriptions**

Modify `packages/core/src/tools/memory-write.ts` tool description:

```ts
description: [
  'Write an accepted, citation-backed JDC Context Engine memory fact into the current project store.',
  'Use only when the user explicitly asks to remember/save a durable project rule, workflow convention, architecture decision, known issue, or preference.',
  'Default scope is project for project conventions and repo-specific workflow rules.',
  'Do not write greetings, guesses, uncited summaries, secrets, raw thinking/reasoning, or transient one-turn state.',
  'Requires citations. Data persists under <project>/.jdcagnet/context-engine/context.db.',
].join(' ')
```

Modify `packages/core/src/tools/memory-search.ts` tool description:

```ts
description: [
  'Search accepted durable JDC Context Engine memory facts from the current project store.',
  'Use before relying on project conventions, architecture decisions, workflow rules, known issues, or user preferences.',
  'Results are accepted facts only; rejected/skipped/no-op harvest attempts are not memory.',
].join(' ')
```

- [ ] **Step 5: Remove normal UI SaveMemory metadata**

Modify `packages/ui/src/components/tool-cards/tool-card-meta.ts`:

```ts
const TASK_TOOLS = new Set([
  'AskUser',
  'BackgroundEvents',
  'BackgroundSend',
  'BackgroundStatus',
  'EnterPlanMode',
  'ExitPlanMode',
  'Notify',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'Team',
  'TodoWrite',
  'team_add_task',
  'team_artifact',
  'team_list',
  'team_report',
])
```

Old historical messages that still contain `SaveMemory` must render through the generic tool card path with the label `旧记忆工具（已退役）`. Do not include `SaveMemory` in normal tool metadata, search keywords, prompt copy, or primary UI labels.

- [ ] **Step 6: Remove old compaction memory wording**

Modify `packages/ui/src/hooks/useSession.ts` so compact completion no longer says `memories saved`.

Replace:

```ts
const memText = memoriesExtracted > 0 ? ` ${memoriesExtracted} memories saved.` : ''
```

with:

```ts
const memText = memoriesExtracted > 0 ? ` ${memoriesExtracted} legacy memory records ignored.` : ''
```

When `memoriesExtracted` is zero, the compact UI must render no memory-related phrase.

- [ ] **Step 7: Run prompt/tool tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context-legacy-memory.test.ts src/tools/memory-tools.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/ui exec vitest run src/components/tool-cards/tool-card-meta.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/context-engine/prompt.ts packages/core/src/tools/memory-write.ts packages/core/src/tools/memory-search.ts packages/core/src/tools/context-inspect.ts packages/core/src/tools/context-refresh.ts packages/core/src/tools/context-engine-tools.ts packages/core/src/context-legacy-memory.test.ts packages/core/src/tools/memory-tools.test.ts packages/ui/src/components/tool-cards/tool-card-meta.ts packages/ui/src/components/tool-cards/tool-card-meta.test.ts packages/ui/src/hooks/useSession.ts
git commit -m "feat(context): clarify JDC memory tool contract"
```

---

## Task 4: Task-Aware Context Planner

**Owner:** Core Lead

**Depends on:** Task 1, Task 2

**Files:**

- Create: `packages/core/src/context/planner.ts`
- Create: `packages/core/src/context/context-planner.test.ts`
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/ranker.ts`
- Modify: `packages/core/src/context/prompt-renderer.ts`

**Goal:** Replace "rank all sections then render" with "infer task intent, select useful facts, suppress noise, then render a plan-backed bundle".

- [ ] **Step 1: Write planner tests**

Create:

```ts
// packages/core/src/context/context-planner.test.ts
import { describe, expect, it } from 'vitest'
import { planContext } from './planner.js'
import type { ContextRequest, ContextSection } from './types.js'

describe('ContextPlanner', () => {
  it('selects project rules and code context for code_edit turns while suppressing noop diagnostics', () => {
    const request = makeRequest({ mode: 'code_edit', userMessage: '修复 Context Engine 面板 CPU 和记忆问题' })
    const sections = [
      section({ id: 'rule_build', kind: 'memory', title: '项目规则', content: '上线前必须跑 pnpm build', sourceProvider: 'Harvest:MemoryCuratorDistiller', confidence: 0.92 }),
      section({ id: 'code_context_panel', kind: 'relevant_code', title: 'ContextPanel', content: 'packages/ui/src/components/context/ContextPanel.tsx', confidence: 0.9 }),
      section({ id: 'noop_diag', kind: 'diagnostics', title: 'Noop', content: 'model_noop', confidence: 0.8 }),
    ]

    const plan = planContext(request, sections)

    expect(plan.intent).toBe('code_edit')
    expect(plan.relevantSections).toEqual(['rule_build', 'code_context_panel'])
    expect(plan.suppressedSections).toEqual([{ id: 'noop_diag', reason: 'low_salience_diagnostic' }])
  })

  it('keeps runtime error chain for debug turns', () => {
    const request = makeRequest({ mode: 'debug', userMessage: '为什么 ParallelToolExecutor cancelled sibling tool failed' })
    const sections = [
      section({ id: 'runtime_error', kind: 'runtime_state', title: 'Runtime', content: 'Cancelled: sibling tool failed', confidence: 0.9 }),
      section({ id: 'project_profile', kind: 'project_profile', title: 'Project', content: 'JDCAGNET', confidence: 0.85 }),
    ]

    const plan = planContext(request, sections)

    expect(plan.intent).toBe('debug')
    expect(plan.relevantSections).toContain('runtime_error')
  })
})

function makeRequest(overrides: Partial<ContextRequest>): ContextRequest {
  return {
    sessionId: 'session_1',
    cwd: '/repo',
    userMessage: '',
    recentMessages: [],
    mode: 'chat',
    model: 'gpt-test',
    tokenBudget: 2500,
    runtime: {},
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function section(overrides: Partial<ContextSection>): ContextSection {
  return {
    id: 'section_1',
    kind: 'memory',
    title: 'Section',
    content: 'content',
    citations: [{ id: `cit_${overrides.id ?? 'section_1'}`, type: 'message', ref: 'session_1/run_1' }],
    priority: 50,
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'test',
    tokenEstimate: 10,
    ...overrides,
  }
}
```

- [ ] **Step 2: Run planner test and verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-planner.test.ts --no-file-parallelism
```

Expected: FAIL because `planner.ts` does not exist.

- [ ] **Step 3: Add planner types**

Modify `packages/core/src/context/types.ts`:

```ts
export type ContextPlanIntent = 'chat' | 'debug' | 'code_edit' | 'review' | 'plan' | 'memory_update'

export interface ContextPlan {
  id: string
  requestHash: string
  intent: ContextPlanIntent
  objective: string
  relevantSections: string[]
  suppressedSections: Array<{ id: string; reason: string }>
  missingEvidence: Array<{ kind: string; reason: string }>
  diagnostics: ContextDiagnostic[]
}
```

- [ ] **Step 4: Implement deterministic planner**

Create:

```ts
// packages/core/src/context/planner.ts
import { createHash } from 'node:crypto'
import type { ContextPlan, ContextPlanIntent, ContextRequest, ContextSection } from './types.js'

export function planContext(request: ContextRequest, sections: ContextSection[]): ContextPlan {
  const intent = inferIntent(request)
  const relevantSections: string[] = []
  const suppressedSections: Array<{ id: string; reason: string }> = []

  for (const section of sections) {
    const suppression = suppressionReason(section)
    if (suppression) {
      suppressedSections.push({ id: section.id, reason: suppression })
      continue
    }
    if (isRelevant(intent, section)) relevantSections.push(section.id)
  }

  return {
    id: `ctx_plan_${hashText(`${request.sessionId}:${request.createdAt}:${request.userMessage}`).slice(0, 16)}`,
    requestHash: hashText(JSON.stringify({ sessionId: request.sessionId, cwd: request.cwd, userMessage: request.userMessage, mode: request.mode })),
    intent,
    objective: request.userMessage.trim() || request.mode,
    relevantSections,
    suppressedSections,
    missingEvidence: [],
    diagnostics: [],
  }
}

function inferIntent(request: ContextRequest): ContextPlanIntent {
  if (request.mode !== 'chat') return request.mode
  const text = request.userMessage.toLowerCase()
  if (/bug|error|报错|错误|失败|卡死|cpu|性能|崩溃|cancelled/.test(text)) return 'debug'
  if (/改|修|实现|代码|feature|fix|implement|refactor/.test(text)) return 'code_edit'
  if (/记住|保存|remember|memory/.test(text)) return 'memory_update'
  return 'chat'
}

function suppressionReason(section: ContextSection): string | null {
  const content = section.content.toLowerCase()
  if (section.kind === 'diagnostics' && /model_noop|noop|no durable/.test(content)) return 'low_salience_diagnostic'
  if (section.freshness === 'stale') return 'stale'
  if (section.confidence < 0.5) return 'low_confidence'
  return null
}

function isRelevant(intent: ContextPlanIntent, section: ContextSection): boolean {
  if (section.kind === 'memory') return true
  if (intent === 'debug') return ['runtime_state', 'diagnostics', 'relevant_code', 'ide_state', 'memory', 'project_profile'].includes(section.kind)
  if (intent === 'code_edit') return ['relevant_code', 'ide_state', 'git_state', 'memory', 'project_profile', 'conversation_state'].includes(section.kind)
  if (intent === 'review') return ['relevant_code', 'git_state', 'memory', 'project_profile'].includes(section.kind)
  if (intent === 'plan') return ['project_profile', 'memory', 'conversation_state', 'code_map'].includes(section.kind)
  if (intent === 'memory_update') return ['conversation_state', 'memory', 'project_profile'].includes(section.kind)
  return ['memory', 'conversation_state', 'project_profile', 'ide_state'].includes(section.kind)
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}
```

- [ ] **Step 5: Wire planner into orchestrator**

Modify `packages/core/src/context/orchestrator.ts`:

```ts
const rawSections = [
  ...providerResults.sections,
  ...freshStoreFacts.map((fact) => sectionFromFact(fact)),
]
const plan = planContext(request, rawSections)
const plannedSections = rawSections.filter((section) => plan.relevantSections.includes(section.id))
const ranked = rankContextSections(plannedSections)
```

Add plan diagnostics and suppressed sections to bundle diagnostics or inspect payload. Keep prompt rendering focused on planned sections.

- [ ] **Step 6: Run planner/orchestrator tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-planner.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/planner.ts packages/core/src/context/context-planner.test.ts packages/core/src/context/types.ts packages/core/src/context/orchestrator.ts packages/core/src/context/ranker.ts packages/core/src/context/prompt-renderer.ts
git commit -m "feat(context): add task-aware context planner"
```

---

## Task 5: Harvest Router And Model-Led Auto-Accept Policy

**Owner:** Distillation Engineer

**Depends on:** Task 1, Task 2, Task 3

**Files:**

- Create: `packages/core/src/context/harvest-router.ts`
- Create: `packages/core/src/context/harvest-router.test.ts`
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/config.ts`
- Modify: `packages/core/src/context/safety.ts`
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/context/distillers/model-client.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Test: `packages/core/src/context/context-harvest.test.ts`
- Test: `packages/core/src/session-context.test.ts`

**Goal:** Use code only for cheap eligibility/routing and let the model decide durable accept/no-op/review. Auto-accept only high-confidence cited project facts.

- [ ] **Step 1: Write harvest router tests**

Create:

```ts
// packages/core/src/context/harvest-router.test.ts
import { describe, expect, it } from 'vitest'
import { routeHarvestCandidate } from './harvest-router.js'
import type { HarvestCandidate } from './types.js'

describe('HarvestRouter', () => {
  it('skips greetings and no-op confirmations before model calls', () => {
    expect(routeHarvestCandidate(candidate({ userMessage: '你好' }))).toEqual({ action: 'skip', reason: 'greeting_or_smalltalk' })
    expect(routeHarvestCandidate(candidate({ userMessage: '继续' }))).toEqual({ action: 'skip', reason: 'no_new_fact' })
  })

  it('routes tool failures to runtime distiller', () => {
    expect(routeHarvestCandidate(candidate({
      userMessage: '看下这个报错',
      toolEvents: [{ id: 'tool_1', name: 'JDC ENGINE', status: 'error', result: { content: 'Cancelled: sibling tool failed' } }],
    }))).toMatchObject({ action: 'distill_runtime' })
  })

  it('routes changed files to project update distiller', () => {
    expect(routeHarvestCandidate(candidate({
      userMessage: '已经修好 ContextPanel',
      changedFiles: ['packages/ui/src/components/context/ContextPanel.tsx'],
    }))).toMatchObject({ action: 'distill_project_update' })
  })

  it('routes explicit project conventions to memory candidate', () => {
    expect(routeHarvestCandidate(candidate({
      userMessage: '记住这个项目约定：上线前必须跑 pnpm build',
    }))).toMatchObject({ action: 'distill_memory_candidate' })
  })

  it('routes substantive non-keyword turns to model distillation instead of hard-coded skip', () => {
    expect(routeHarvestCandidate(candidate({
      userMessage: '这次改完以后同项目跨会话要保持一致，切换会话以后页面事实也要正常加载。',
    }))).toMatchObject({ action: 'distill_conversation' })
  })
})

function candidate(overrides: Partial<HarvestCandidate>): HarvestCandidate {
  return {
    sessionId: 'session_1',
    runLoopId: 'run_1',
    userMessage: 'default',
    assistantMessages: [],
    toolEvents: [],
    changedFiles: [],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}
```

- [ ] **Step 2: Run router tests and verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts --no-file-parallelism
```

Expected: FAIL because `harvest-router.ts` does not exist.

- [ ] **Step 3: Implement harvest router**

Create:

```ts
// packages/core/src/context/harvest-router.ts
import type { HarvestCandidate, HarvestDecision } from './types.js'
import { containsSensitiveContext } from './redaction.js'

const GREETING_OR_SMALLTALK = /^(?:hi|hello|hey|你好|您好|嗨|哈喽|早上好|晚上好)[!.。！~\s]*$/i
const NO_NEW_FACT = /^(?:ok|okay|k|yes|yep|yeah|no|nope|thanks?|thank you|continue|继续|可以|好的|好|嗯|行|收到|明白|了解|不用|算了)[!.。！\s]*$/i
const EXPLICIT_MEMORY = /记住|保存|remember|store this|项目约定|工作流|架构决策|known issue|已知问题/i
const GOAL_OR_CONSTRAINT = /目标|约束|不要|必须|计划|需求|pm|方案|decision|requirement/i
const MIN_SUBSTANTIVE_CHARS = 18

export function routeHarvestCandidate(candidate: HarvestCandidate): HarvestDecision {
  const message = candidate.userMessage.trim()
  if (!message || GREETING_OR_SMALLTALK.test(message)) return { action: 'skip', reason: 'greeting_or_smalltalk' }
  if (NO_NEW_FACT.test(message)) return { action: 'skip', reason: 'no_new_fact' }
  if (containsSensitiveContext(candidate)) return { action: 'skip', reason: 'sensitive_content' }
  if (hasToolFailure(candidate)) return { action: 'distill_runtime', reason: 'tool failure or runtime error was observed' }
  if (candidate.changedFiles.length > 0) return { action: 'distill_project_update', reason: 'project files changed during runLoop' }
  if (EXPLICIT_MEMORY.test(message)) return { action: 'distill_memory_candidate', reason: 'user explicitly requested durable memory or project convention' }
  if (GOAL_OR_CONSTRAINT.test(message)) return { action: 'distill_conversation', reason: 'conversation goal or constraint changed' }
  if (message.length >= MIN_SUBSTANTIVE_CHARS) return { action: 'distill_conversation', reason: 'substantive turn requires model storage decision' }
  return { action: 'skip', reason: 'no_new_fact' }
}

function hasToolFailure(candidate: HarvestCandidate): boolean {
  return candidate.toolEvents.some((event) => {
    const status = String(event.status ?? '').toLowerCase()
    const type = String((event as { type?: unknown }).type ?? '').toLowerCase()
    const result = JSON.stringify((event as { result?: unknown }).result ?? '').toLowerCase()
    return status === 'error' || type === 'error' || /error|failed|cancelled|aborted/.test(result)
  })
}
```

`SkipReason` must include `model_noop`. Do not collapse model no-op into `no_new_fact`; the UI and metrics need to distinguish "model checked and found no durable fact" from "cheap gate skipped before model call".

- [ ] **Step 4: Replace classifier usage**

Modify `packages/core/src/context/safety.ts`:

```ts
export { routeHarvestCandidate as classifyHarvestCandidate } from './harvest-router.js'
```

or change callers in `harvest.ts`, `session.ts`, and `sub-session.ts` to use `routeHarvestCandidate()` directly.

- [ ] **Step 5: Keep model no-op as a first-class legal output**

Modify `packages/core/src/context/distillers/model-client.ts` prompt requirements to keep this exact durable storage decision contract:

```ts
requirements: [
  'schemaVersion must be 1 and distiller must equal the requested distiller name.',
  'First decide whether the candidate contains durable, reusable, citation-backed project context.',
  'If it does not, return {"schemaVersion":1,"distiller":"<name>","action":"skip","reason":"model_noop","confidence":0.9,"diagnostic":"No durable project context."}.',
  'For durable output, return a DistillerEnvelope with confidence > 0 and <= 1, citations, and payload.',
  'Durable citations must cite only provided candidate message/tool/file references.',
  'Durable payload must match the requested distiller payload schema.',
  'Do not include raw thinking, reasoning, hidden chain-of-thought, secrets, markdown, or extra keys.',
]
```

No-op model outputs must update harvest diagnostics as quiet successful skips and must not create primary UI rows, accepted facts, or review items.

- [ ] **Step 6: Add auto-accept policy**

Modify `packages/core/src/context/config.ts`:

```ts
memory: {
  trustMode: 'auto_accept_high_confidence',
  minConfidence: 0.86,
}
```

Modify `packages/core/src/context/harvest.ts` so auto-accept is allowed only for:

```ts
const AUTO_ACCEPT_KINDS = new Set([
  'project_profile',
  'architecture_decision',
  'module_boundary',
  'project_convention',
  'workflow_rule',
  'code_entrypoint',
  'runtime_error_chain',
])
```

For every fact kind outside this set, keep `pending_review`.

- [ ] **Step 7: Wire project-level harvest interval limit**

Modify `RunHarvestJobOptions` in `packages/core/src/context/harvest.ts`:

```ts
export interface RunHarvestJobOptions extends AcceptanceOptions {
  store?: HarvestPersistence
  distillers?: HarvestDistiller[]
  modelClient?: DistillerModelClient
  now?: () => number
  maxOutputTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
  trustMode?: 'manual_review' | 'auto_accept_high_confidence'
  ambientModelBindingForTest?: HarvestModelBinding
}
```

Wrap the distiller call with the earlier of `timeoutMs` and `signal` abort. Timeout/cancelled harvest results must call `skipJob()` with `reason: 'timeout' | 'cancelled'` and must not call `rejectCandidate()`.

Modify `packages/core/src/session.ts` and `packages/core/src/sub-session.ts` so completed runLoops enqueue harvest through `ContextScheduler.enqueueBackground()`:

```ts
const scheduled = contextScheduler.enqueueBackground(projectKey, 'harvest', async (signal) => {
  await runHarvestJob(job, { ...harvestOptions, signal, timeoutMs: contextConfig.harvest.timeoutMs })
}, { minIntervalMs: contextConfig.performance.harvestMinIntervalMs })

if (!scheduled.accepted) {
  await contextStore.saveDiagnostic?.({
    id: `harvest_rate_limited_${runLoopId}`,
    level: 'info',
    source: 'JDC Context Engine',
    message: `Harvest skipped by ${scheduled.reason}`,
    createdAt: Date.now(),
  })
}
```

Do not enqueue a harvest model call before the assistant response is fully complete.

- [ ] **Step 8: Run harvest tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts src/context/context-harvest.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/context/harvest-router.ts packages/core/src/context/harvest-router.test.ts packages/core/src/context/types.ts packages/core/src/context/config.ts packages/core/src/context/safety.ts packages/core/src/context/harvest.ts packages/core/src/context/distillers/model-client.ts packages/core/src/session.ts packages/core/src/sub-session.ts packages/core/src/context/context-harvest.test.ts packages/core/src/session-context.test.ts
git commit -m "feat(context): route harvest and auto-accept project facts"
```

---

## Task 6: Cross-Session Project Consistency

**Owner:** Electron/Core Integration Engineer

**Depends on:** Task 2

**Files:**

- Modify: `packages/core/src/context/store.ts`
- Modify: `packages/core/src/tools/context-inspect.ts`
- Modify: `packages/core/src/tools/memory-search.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`
- Modify: `packages/electron/src/session-manager.ts`
- Modify: `packages/ui/src/stores/context-store.ts`
- Test: `packages/core/src/context/store.test.ts`
- Test: `packages/core/src/tools/memory-tools.test.ts`
- Test: `packages/ui/src/stores/context-store.test.tsx`

**Goal:** Same normalized project root always reads the same accepted durable context across sessions and restarts.

- [ ] **Step 1: Write cross-session store test**

Append to `packages/core/src/context/store.test.ts`:

```ts
it('shares accepted durable project facts across sessions in the same project', async () => {
  const dir = makeTempDir()
  const storeA = await openContextStore({ cwd: dir, now: () => 1_000 })
  await storeA.saveFact(fact({ id: 'project_convention_build', scope: 'project', content: '上线前必须跑 pnpm build', sessionId: 'session_a' }))

  const storeB = await openContextStore({ cwd: dir, now: () => 2_000 })
  const facts = await storeB.queryFacts({ scope: 'project' })

  expect(facts.value.map((item) => item.content)).toContain('上线前必须跑 pnpm build')
  expect(facts.value[0]?.sessionId).toBe('session_a')
})
```

- [ ] **Step 2: Write UI store test for sessionId -> cwd reload**

Modify `packages/ui/src/stores/context-store.test.tsx`:

```ts
it('loads project memory by session id so same-project sessions do not rely on renderer cache', async () => {
  const invoke = installInvoke((channel: string, input?: any) => {
    if (channel === 'context:memory:list') {
      expect(input.sessionId).toBe('session_b')
      return acceptedMemoryPayload
    }
    if (channel === 'context:memory:reject') return { rejected: [] }
    throw new Error(`unexpected channel ${channel}`)
  })

  await useContextStore.getState().loadMemoryReview({ sessionId: 'session_b' })

  expect(invoke).toHaveBeenCalledWith('context:memory:list', { limit: 50, sessionId: 'session_b' })
  expect(useContextStore.getState().memoryReview.data?.accepted?.results[0]?.content).toBe('Use project-local context persistence.')
})
```

- [ ] **Step 3: Run tests and verify current behavior**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts src/tools/memory-tools.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx --no-file-parallelism
```

Expected: PASS if current store behavior is correct; FAIL if an IPC path still uses process cwd or renderer cache.

- [ ] **Step 4: Fix Electron IPC cwd resolution**

In `packages/electron/src/ipc-handlers.ts`, every context/memory IPC handler must:

```ts
const cwd = input.sessionId ? sessionManager.getSessionCwd(input.sessionId) : input.cwd
if (!cwd) throw new Error('Context Engine request requires sessionId or cwd')
const store = await openContextStore({ cwd })
```

Do not use default `openContextStore()` in Electron IPC.

- [ ] **Step 5: Ensure UI reloads on session switch**

Modify `packages/ui/src/stores/context-store.ts`:

- `loadInspect({ sessionId })` must load current bundle and project facts.
- `loadMemoryReview({ sessionId })` must load accepted project memory and rejected session diagnostics separately.
- `reset()` must clear renderer view state only; it must not delete project store data.

- [ ] **Step 6: Run verification**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts src/tools/memory-tools.test.ts src/tools/context-tools.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx --no-file-parallelism
pnpm exec tsc --noEmit -p packages/electron/tsconfig.json
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/store.ts packages/core/src/tools/context-inspect.ts packages/core/src/tools/memory-search.ts packages/electron/src/ipc-handlers.ts packages/electron/src/session-manager.ts packages/ui/src/stores/context-store.ts packages/core/src/context/store.test.ts packages/core/src/tools/memory-tools.test.ts packages/ui/src/stores/context-store.test.tsx
git commit -m "feat(context): enforce project-level session consistency"
```

---

## Task 7: Chinese-First Automatic Context Panel

**Owner:** Frontend Engineer

**Depends on:** Task 2, Task 4, Task 6

**Files:**

- Create: `packages/ui/src/components/context/ContextFactsPanel.tsx`
- Create: `packages/ui/src/components/context/ContextCurrentPanel.tsx`
- Create: `packages/ui/src/components/context/ContextAdvancedDiagnosticsPanel.tsx`
- Create: `packages/ui/src/components/context/ContextPanelLayout.tsx`
- Modify: `packages/ui/src/components/context/ContextPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextInspectPanel.tsx`
- Modify: `packages/ui/src/components/context/HarvestQueuePanel.tsx`
- Modify: `packages/ui/src/components/context/MemoryReviewPanel.tsx`
- Modify: `packages/ui/src/components/context/ProviderHealthPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextPanelPrimitives.tsx`
- Modify: `packages/ui/src/stores/context-store.ts`
- Modify: `packages/ui/src/components/Inspector.tsx`
- Test: `packages/ui/src/components/context/context-panels.test.tsx`
- Test: `packages/ui/src/stores/context-store.test.tsx`

**Goal:** Replace English/debug-console panel with Chinese automatic observability: `当前状态`, `项目事实`, `当前上下文`, collapsed `高级诊断`.

- [ ] **Step 1: Write failing UI copy test**

Modify `packages/ui/src/components/context/context-panels.test.tsx`:

```tsx
it('renders Chinese-first Context Engine panel without primary manual refresh controls', () => {
  const html = renderToStaticMarkup(<ContextPanelLayout sessionId="sess-1" />)

  expect(html).toContain('JDC 上下文引擎')
  expect(html).toContain('当前状态')
  expect(html).toContain('项目事实')
  expect(html).toContain('当前上下文')
  expect(html).toContain('高级诊断')
  expect(html).not.toContain('Inspect')
  expect(html).not.toContain('Harvest')
  expect(html).not.toContain('Memory')
  expect(html).not.toContain('Health')
  expect(html).not.toContain('Read cached view')
})
```

Create and export `ContextPanelLayout` from `packages/ui/src/components/context/ContextPanelLayout.tsx`. `ContextPanel.tsx` must become the store-connected wrapper around this pure layout.

- [ ] **Step 2: Run UI copy test and verify red**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx --no-file-parallelism
```

Expected: FAIL because current tabs are English and buttons are primary.

- [ ] **Step 3: Refactor panel structure**

Modify `packages/ui/src/components/context/ContextPanel.tsx`:

```tsx
export type ContextTab = 'status' | 'facts' | 'current' | 'advanced'
```

Use labels:

```ts
const tabs = [
  { id: 'status', label: '当前状态' },
  { id: 'facts', label: '项目事实' },
  { id: 'current', label: '当前上下文' },
  { id: 'advanced', label: '高级诊断' },
] as const
```

Remove primary `Read cached view` and `Read cached health` buttons. Keep reindex/refresh inside the advanced panel.

- [ ] **Step 4: Add automatic reload behavior**

Modify `packages/ui/src/stores/context-store.ts`:

```ts
loadProjectContext: (input: { sessionId: string }) => Promise<void>
```

Implementation:

- call `context:inspect` for current bundle/project facts;
- call `context:memory:list` for accepted project memory;
- call `context:providers:health` for cached status;
- do not call `context:refresh` automatically;
- do not start reindex automatically from renderer.

- [ ] **Step 5: Create facts panel**

Create:

```tsx
// packages/ui/src/components/context/ContextFactsPanel.tsx
import type { MemorySearchPayload } from '@jdcagnet/core'
import { PanelFrame, PanelState, formatPercent } from './ContextPanelPrimitives'

export function ContextFactsPanel({ accepted }: { accepted: MemorySearchPayload | null | undefined }) {
  const facts = accepted?.results ?? []
  return (
    <PanelFrame title="项目事实" subtitle="已采纳并会跨会话复用的项目级上下文">
      {facts.length === 0 ? (
        <PanelState title="暂无项目事实" message="引擎还没有采纳可复用的项目级事实。" />
      ) : (
        <div className="space-y-2">
          {facts.map((fact) => (
            <article key={fact.id} className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
              <div className="text-[11px] text-[var(--muted)]">{fact.kind} · {fact.scope} · 置信度 {formatPercent(fact.confidence)}</div>
              <div className="mt-1 text-[12px] leading-relaxed text-[var(--text)] whitespace-pre-wrap">{fact.content}</div>
            </article>
          ))}
        </div>
      )}
    </PanelFrame>
  )
}
```

- [ ] **Step 6: Create current context panel**

Create `packages/ui/src/components/context/ContextCurrentPanel.tsx` that displays:

- bundle sections in Chinese;
- why injected, if plan data exists;
- suppressed section count;
- no raw no-op/rejected rows.

Use copy:

```text
本轮注入
来源
置信度
新鲜度
引用
未注入
```

- [ ] **Step 7: Create advanced diagnostics panel**

Create `packages/ui/src/components/context/ContextAdvancedDiagnosticsPanel.tsx` that contains:

- harvest records;
- provider status;
- diagnostics;
- manual refresh/reindex buttons.

Button labels:

```text
重新读取诊断
后台重建代码索引
读取 Provider 状态
```

This panel must be collapsed or non-default.

- [ ] **Step 8: Run UI tests**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx src/stores/context-store.test.tsx --no-file-parallelism
pnpm --filter @jdcagnet/ui build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/components/context/ContextFactsPanel.tsx packages/ui/src/components/context/ContextCurrentPanel.tsx packages/ui/src/components/context/ContextAdvancedDiagnosticsPanel.tsx packages/ui/src/components/context/ContextPanelLayout.tsx packages/ui/src/components/context/ContextPanel.tsx packages/ui/src/components/context/ContextInspectPanel.tsx packages/ui/src/components/context/HarvestQueuePanel.tsx packages/ui/src/components/context/MemoryReviewPanel.tsx packages/ui/src/components/context/ProviderHealthPanel.tsx packages/ui/src/components/context/ContextPanelPrimitives.tsx packages/ui/src/stores/context-store.ts packages/ui/src/components/Inspector.tsx packages/ui/src/components/context/context-panels.test.tsx packages/ui/src/stores/context-store.test.tsx
git commit -m "feat(context-ui): make panel Chinese and automatic"
```

---

## Task 8: Product Evals And Release Gate

**Owner:** Evals/QA Engineer

**Depends on:** Tasks 1-7

**Files:**

- Create: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `packages/core/src/context/evals/index.ts`
- Modify: `packages/core/src/context/evals/assertions.ts`
- Modify: `packages/ui/src/components/context/context-panels.test.tsx`
- Modify: `docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md`

**Goal:** Add tests that fail when the engine technically works but product behavior is useless.

- [ ] **Step 1: Write cross-session convention eval**

Create:

```ts
// packages/core/src/context/context-product-evals.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildContextBundle } from './orchestrator.js'
import { openContextStore } from './store.js'
import type { ContextRequest } from './types.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('JDC Context Engine product evals', () => {
  it('reuses accepted project convention across sessions after reopening the store', async () => {
    const cwd = tempProject()
    const storeA = await openContextStore({ cwd, now: () => 1_000 })
    await storeA.saveFact({
      id: 'project_convention_build',
      kind: 'project_convention',
      scope: 'project',
      content: '上线前必须跑 pnpm build',
      citations: [{ id: 'cit_user_rule', type: 'message', ref: 'session_a/run_1' }],
      confidence: 0.91,
      freshness: 'recent',
      sourceProvider: 'Harvest:MemoryCuratorDistiller',
      sessionId: 'session_a',
      createdAt: 1_000,
      updatedAt: 1_000,
    })

    const storeB = await openContextStore({ cwd, now: () => 2_000 })
    const result = await buildContextBundle(request({ cwd, sessionId: 'session_b', userMessage: '帮我改一下 UI 文案' }), {
      store: storeB,
      providers: [],
      id: () => 'ctx_cross_session',
    })

    expect(result.renderedPrompt).toContain('上线前必须跑 pnpm build')
  })

  it('does not render model_noop as primary durable context', async () => {
    const cwd = tempProject()
    const store = await openContextStore({ cwd, now: () => 1_000 })
    await store.rejectCandidate({ action: 'skip', reason: 'model_noop' }, 'Harvest model skipped durable storage: model_noop', {
      id: 'noop_1',
      sessionId: 'session_a',
      createdAt: 1_000,
      validationErrors: ['model_noop'],
      status: 'rejected',
    })

    const result = await buildContextBundle(request({ cwd, sessionId: 'session_b', userMessage: '继续' }), {
      store,
      providers: [],
      id: () => 'ctx_noop',
    })

    expect(result.renderedPrompt).not.toContain('model_noop')
  })
})

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'jdc-context-product-eval-'))
  dirs.push(dir)
  return dir
}

function request(overrides: Partial<ContextRequest>): ContextRequest {
  return {
    sessionId: 'session_1',
    cwd: '/repo',
    userMessage: '',
    recentMessages: [],
    mode: 'chat',
    model: 'gpt-test',
    tokenBudget: 2500,
    runtime: {},
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}
```

- [ ] **Step 2: Run product eval and verify red or green**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected: FAIL until Tasks 2, 4, and 6 are complete. Expected: PASS after those tasks are implemented.

- [ ] **Step 3: Add performance eval**

Append:

```ts
it('returns foreground context quickly when a provider is slow', async () => {
  const cwd = tempProject()
  const store = await openContextStore({ cwd, now: () => 1_000 })
  const started = Date.now()
  const result = await buildContextBundle(request({ cwd, userMessage: '修复性能' }), {
    store,
    providers: [{
      id: 'code',
      collect: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250))
        return { evidence: [], sections: [], diagnostics: [], health: { id: 'code', status: 'enabled', updatedAt: 1_000 } }
      },
    }],
    id: () => 'ctx_perf',
  })
  expect(Date.now() - started).toBeLessThan(220)
  expect(result.renderedPrompt).not.toContain('undefined')
})
```

This requires Task 1 foreground budget integration.

- [ ] **Step 4: Update engineering contract**

Modify `docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md`:

- storage is project-local: `<project>/.jdcagnet/context-engine/context.db`;
- `sessionId` is provenance, not durable context isolation;
- UI is Chinese-first observability;
- primary panel shows accepted durable facts only;
- advanced diagnostics holds no-op/rejected/skipped/failed rows;
- performance budgets are release gates.

- [ ] **Step 5: Run full verification gate**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-scheduler.test.ts src/context/context-planner.test.ts src/context/harvest-router.test.ts src/context/context-product-evals.test.ts src/session-context.test.ts src/context/context-harvest.test.ts src/context/store.test.ts src/tools/context-tools.test.ts src/tools/memory-tools.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx src/components/context/context-panels.test.tsx src/stores/session-store.test.ts src/components/MarkdownRenderer.test.tsx --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/ui build
pnpm --filter ./packages/electron build
pnpm exec tsc --noEmit -p packages/electron/tsconfig.json
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/context/context-product-evals.test.ts packages/core/src/context/evals/index.ts packages/core/src/context/evals/assertions.ts packages/ui/src/components/context/context-panels.test.tsx docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md
git commit -m "test(context): add product evals for production engine"
```

---

## Release Criteria

The rebuild is not complete until all criteria pass:

- Same-project cross-session accepted facts are shared after app restart.
- `model_noop`, rejected, skipped, failed, aborted, timeout, uncited, and low-confidence harvest outputs do not appear as primary panel content or injected durable context.
- `JdcMemoryWrite` and `JdcMemorySearch` are the only explicit memory save/search tools in normal prompt/tool UI.
- Context panel is Chinese-first and automatic.
- Manual refresh/reindex is advanced diagnostics only.
- Foreground context injection is bounded and fail-open.
- Background harvest is project-limited and cannot spam model calls.
- Code indexing is background, throttled, and not required for normal chat.
- Product evals prove the engine makes the next turn better.
- Full verification gate passes.

## Execution Notes For PM

Split work by dependency, not by layer:

- Team A: Task 1 Performance Scheduler.
- Team B: Task 2 Durable Truth Store.
- Team C: Task 3 Prompt/Tool Contract.
- Team D: Task 4 Planner after Task 1/2 APIs stabilize.
- Team E: Task 5 Harvest Router after Task 2/3.
- Team F: Task 6 Cross-Session Consistency after Task 2.
- Team G: Task 7 UI after Task 2/6 payloads stabilize.
- QA: Task 8 throughout, but final evals require Tasks 1-7.

Do not let UI start final implementation until accepted project facts and inspect payload shape are stable. Do not let harvest work expand before performance scheduling exists. Do not ship planner without product evals.
