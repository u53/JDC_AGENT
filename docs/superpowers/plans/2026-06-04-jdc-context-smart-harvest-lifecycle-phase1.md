# JDC Context Smart Harvest Lifecycle Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first production slice of Smart Harvest route assistant project summaries and confirmation turns into durable project-context distillation, while preventing existing retention numbers from becoming hidden knowledge capacity limits.

**Architecture:** Keep the existing harvest pipeline and distiller state machine. Add a focused smart-routing layer inside `harvest-router.ts` that inspects assistant text and bounded confirmation turns before the generic conversation fallback. Add store tests that separate temporary retention cleanup from accepted project knowledge capacity policy.

**Tech Stack:** TypeScript, Vitest, sql.js context store, existing JDC Context Engine harvest/store modules.

---

## File Map

- Modify `packages/core/src/context/harvest-router.ts`
  - Add assistant-summary signal detection.
  - Add short confirmation detection.
  - Route project-summary-shaped assistant content to `distill_project_update`.
  - Keep greetings, sensitive content, failed tools, Team routing, workflow file routing, changed-file routing, explicit memory, and generic conversation behavior intact.

- Modify `packages/core/src/context/harvest-router.test.ts`
  - Add RED tests for assistant project-summary routing.
  - Add RED tests for confirmation turns that include prior assistant summary evidence in the current harvest candidate.
  - Keep existing small-talk skip tests passing.

- Modify `packages/core/src/context/store.test.ts`
  - Add a RED test documenting that accepted project facts should not be silently treated as token/context capacity by default.
  - Keep explicit small test quotas available for temporary cleanup tests.

- Modify `packages/core/src/context/store.ts`
  - If the store test exposes unwanted default accepted-fact deletion, adjust default quota behavior so normal stores do not delete accepted project facts by count.
  - Preserve explicit test/user-provided quotas for maintenance tests.

- Modify `docs/superpowers/specs/2026-06-04-jdc-context-smart-harvest-memory-lifecycle-design.md`
  - Keep the spec aligned with implementation if any detail changes.

## Task 1: Assistant Summary Harvest Routing

**Files:**
- Modify: `packages/core/src/context/harvest-router.test.ts`
- Modify: `packages/core/src/context/harvest-router.ts`
- Modify: `packages/core/src/session-context.test.ts`
- Modify: `packages/core/src/session.ts`

- [x] **Step 1: Write the failing test**

Add this test after the workflow/package routing test in `packages/core/src/context/harvest-router.test.ts`:

```ts
  it('routes assistant project summaries to project update distillation', () => {
    const decision = routeHarvestCandidate(candidate({
      userMessage: '帮我总结一下这个项目整体',
      assistantMessages: [{
        id: 'assistant_project_summary',
        role: 'assistant',
        timestamp: 2,
        content: [{
          type: 'text',
          text: [
            '# 项目整体架构',
            'packages/core 负责 runLoop、JDC Context Engine、工具调度和上下文注入。',
            'packages/electron 负责桌面主进程、IPC 和窗口管理。',
            'packages/ui 负责 React UI、Inspector 和 Context Panel。',
            '常用命令包括 pnpm --filter @jdcagnet/core test 和 pnpm --filter @jdcagnet/core build。',
          ].join('\n'),
        }],
      }],
    }))

    expect(decision).toEqual({
      action: 'distill_project_update',
      reason: expect.stringContaining('assistant project summary'),
    })
  })
```

- [x] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts --no-file-parallelism
```

Expected: FAIL because the new summary-shaped assistant output currently routes to `distill_conversation`.

- [x] **Step 3: Implement minimal assistant summary detection**

In `packages/core/src/context/harvest-router.ts`, add helpers near the existing regex constants:

```ts
const ASSISTANT_PROJECT_SUMMARY_SIGNAL = /(?:项目整体|项目架构|整体架构|架构概览|模块边界|包边界|package boundaries|architecture overview|project overview|module boundary|release workflow|常用命令|测试命令|构建命令|packages\/core|packages\/ui|packages\/electron)/i
const ASSISTANT_SUMMARY_MIN_CHARS = 120
```

Add helper functions near the bottom:

```ts
function assistantText(candidate: HarvestCandidate): string {
  return candidate.assistantMessages
    .flatMap((message) => Array.isArray(message.content)
      ? message.content.flatMap((block) => {
        if (!block || typeof block !== 'object') return []
        const typed = block as { type?: string; text?: unknown }
        return typed.type === 'text' && typeof typed.text === 'string' ? [typed.text] : []
      })
      : [])
    .join('\n')
}

function hasAssistantProjectSummary(candidate: HarvestCandidate): boolean {
  const text = assistantText(candidate)
  return text.length >= ASSISTANT_SUMMARY_MIN_CHARS && ASSISTANT_PROJECT_SUMMARY_SIGNAL.test(text)
}
```

Then route before generic memory/conversation checks:

```ts
  if (hasAssistantProjectSummary(candidate)) {
    return { action: 'distill_project_update', reason: 'assistant project summary requires project update distillation' }
  }
```

- [x] **Step 4: Run the test to verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 5: Write the failing Session backfill test**

Add a session integration test proving a second confirmation turn can backfill the previous assistant project summary into the harvest candidate:

```ts
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
```

- [x] **Step 6: Run the Session backfill test to verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts -t "backfills previous assistant project summaries" --no-file-parallelism
```

Expected: FAIL because the second confirmation turn is skipped before the previous summary is included.

- [x] **Step 7: Implement bounded Session backfill**

Export cheap confirmation and assistant-summary helpers from `harvest-router.ts`, then use them in `Session.enqueueHarvestAfterRunLoop()` to include one previous assistant project-summary message when the current user message is a confirmation save turn. Strip thinking from backfilled messages with the existing `stripThinkingForHarvest()`.

- [x] **Step 8: Run the Session backfill test to verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts -t "backfills previous assistant project summaries" --no-file-parallelism
```

Expected: PASS.

## Task 2: Confirmation Turn Backfill Routing

**Files:**
- Modify: `packages/core/src/context/harvest-router.test.ts`
- Modify: `packages/core/src/context/harvest-router.ts`

- [x] **Step 1: Write the failing test**

Add this test after the summary-routing test:

```ts
  it('routes short confirmation turns when assistant evidence contains a project summary', () => {
    const decision = routeHarvestCandidate(candidate({
      userMessage: '当然，存一下',
      assistantMessages: [{
        id: 'assistant_previous_summary',
        role: 'assistant',
        timestamp: 2,
        content: [{
          type: 'text',
          text: [
            '项目整体架构：packages/core 管理 JDC Context Engine、Session runLoop、harvest 和 tool runner。',
            'packages/electron 管理 IPC、窗口和桌面服务。',
            'packages/ui 管理 React Inspector、Context Panel 和聊天界面。',
          ].join('\n'),
        }],
      }],
    }))

    expect(decision.action).toBe('distill_project_update')
    expect(decision.reason).toContain('confirmation')
  })
```

- [x] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts --no-file-parallelism
```

Expected: FAIL because short confirmations are currently skipped or routed without using assistant summary evidence.

- [x] **Step 3: Implement confirmation-aware routing**

In `packages/core/src/context/harvest-router.ts`, add:

```ts
const CONFIRMATION_SAVE_SIGNAL = /^(?:yes|yep|yeah|sure|of course|save it|store it|remember that|remember this|当然|可以|对|是的|存一下|记住|记下来)[!.。！,\s]*(?:存一下|记住|记下来)?[!.。！,\s]*$/i
```

Add helper:

```ts
function isConfirmationSaveTurn(message: string): boolean {
  return CONFIRMATION_SAVE_SIGNAL.test(message.trim())
}
```

Add route before the existing no-new-fact skip:

```ts
  if (isConfirmationSaveTurn(message) && hasAssistantProjectSummary(candidate)) {
    return { action: 'distill_project_update', reason: 'confirmation turn backfilled assistant project summary' }
  }
```

Keep the existing `NO_NEW_FACT` skip for confirmations that do not include durable assistant evidence.

- [x] **Step 4: Run the test to verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts --no-file-parallelism
```

Expected: PASS.

## Task 3: Accepted Facts Must Not Be A Hidden Capacity Cap

**Files:**
- Modify: `packages/core/src/context/store.test.ts`
- Modify: `packages/core/src/context/store.ts`

- [x] **Step 1: Write the failing test**

Add this test after `enforces quotas for facts, bundle snapshots, raw evidence, and rejected candidates`:

```ts
  it('does not apply accepted project fact count deletion unless an explicit fact quota is configured', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 10_000 })
    await saveFileEvidence(store)

    const factCountAboveLegacyDefault = 1_001
    await expectOk(store.withWriteBatch!('seed facts above legacy default quota', async () => {
      for (let index = 0; index < factCountAboveLegacyDefault; index++) {
        await expectOk(store.saveFact(makeFact({
          id: `fact_${index}`,
          content: `Durable project fact ${index} must not be removed by a hidden default count cap.`,
          confidence: 0.91,
          updatedAt: index + 1,
        })))
      }
    }))

    const quota = await store.enforceQuotas()

    expect(quota.ok).toBe(true)
    expect(quota.value.deletedFacts).toBe(0)
    const facts = await store.queryFacts()
    expect(facts.value).toHaveLength(factCountAboveLegacyDefault)
    expect(facts.value.map((fact) => fact.id)).toContain('fact_0')
    expect(facts.value.map((fact) => fact.id)).toContain('fact_1000')
  })
```

- [x] **Step 2: Run the test to verify RED or existing GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
```

Expected: FAIL before implementation because default `maxFacts` deletes the 1001st accepted fact by count.

- [x] **Step 3: Remove default accepted-fact deletion by count while preserving explicit quotas**

If the test fails, change `DEFAULT_CONTEXT_STORE_QUOTAS.maxFacts` in `packages/core/src/context/store.ts` from a numeric deletion cap to no deletion cap. Use `Number.POSITIVE_INFINITY` and update `selectOverflowFactIds()` to return no ids when the cap is not finite:

```ts
const DEFAULT_CONTEXT_STORE_QUOTAS: ContextStoreQuotas = {
  maxFacts: Number.POSITIVE_INFINITY,
  maxBundleSnapshots: 50,
  maxRejectedCandidates: 100,
  rawEvidenceTtlMs: 7 * 24 * 60 * 60 * 1000,
}
```

```ts
  private selectOverflowFactIds(): { table: string; ids: string[] } {
    if (!Number.isFinite(this.quotas.maxFacts)) return { table: 'context_facts', ids: [] }
    const count = Number(this.selectRows('SELECT COUNT(*) AS count FROM context_facts WHERE project_key = ?', [this.projectKey])[0]?.count ?? 0)
    const overflow = count - this.quotas.maxFacts
    if (overflow <= 0) return { table: 'context_facts', ids: [] }
    ...
  }
```

Keep the existing explicit quota test with `quotas: { maxFacts: 2 }` passing, because explicit maintenance tests still need a way to exercise deletion.

- [x] **Step 4: Run store tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
```

Expected: PASS.

## Task 4: Spec Alignment

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-jdc-context-smart-harvest-memory-lifecycle-design.md`

- [x] **Step 1: Inspect spec language**

Run:

```bash
rg -n "maxFacts|maxBundleSnapshots|maxRejectedCandidates|cap|quota|capacity" docs/superpowers/specs/2026-06-04-jdc-context-smart-harvest-memory-lifecycle-design.md
```

Expected: The spec says existing count values are implementation observations, not desired capacity limits.

- [x] **Step 2: Patch spec only if implementation changes terminology**

If implementation names differ from the spec, update the spec to match the final names. Do not add new product scope in this task.

## Task 5: Focused Verification

**Files:**
- Verify only.

- [x] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts src/context/store.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 2: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [x] **Step 3: Inspect git diff**

Run:

```bash
git diff -- packages/core/src/context/harvest-router.ts packages/core/src/context/harvest-router.test.ts packages/core/src/context/store.ts packages/core/src/context/store.test.ts docs/superpowers/specs/2026-06-04-jdc-context-smart-harvest-memory-lifecycle-design.md docs/superpowers/plans/2026-06-04-jdc-context-smart-harvest-lifecycle-phase1.md
```

Expected: diff only contains Phase 1 smart routing, accepted-fact capacity guard, and docs/plan updates.
