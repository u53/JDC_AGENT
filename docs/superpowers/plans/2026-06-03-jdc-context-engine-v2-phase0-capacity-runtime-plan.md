# JDC Context Engine V2 Phase 0 Capacity And Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove artificial context caps, make providers return real project data, and harden provider prompt construction so JDC Context Engine can actually deliver useful project context into Anthropic, OpenAI Chat, and OpenAI Responses requests.

**Architecture:** Keep the current Context Engine package and provider adapter structure. Replace small fixed token ceilings with relevance-first selection and protocol-safe degradation, increase provider runtime budgets without allowing foreground heavy jobs, implement non-empty memory/project providers, and make system prompt assembly preserve JDC identity while staying valid for each provider API.

**Tech Stack:** TypeScript, Vitest, existing `ContextStore`, sql.js, Context Engine providers, Anthropic SDK Messages API, OpenAI Chat/Responses adapters, existing prompt segment system.

## Updated Hard Constraint

JDC Context Engine implementation must not enforce local artificial capacity limits. Legacy fields such as `maxBundleTokens`, `maxSectionTokens`, and `maxCodeTokens` may stay parseable for backward compatibility, but production code must not use them to truncate, drop, summarize, or window Engine bundles, sections, code context, project docs, accepted memory, or same-project durable facts.

Selection is allowed and required, but it must be based on relevance, freshness, citations, and provider protocol safety. If a provider/model rejects an oversized request, the fix belongs in a protocol-safe adapter fallback with diagnostics, not in a hidden Engine cap.

---

## Scope

This phase is a hard prerequisite for Phase 1 retrieval and every later V2 phase.

It addresses these concrete current problems:

- `packages/core/src/context/config.ts` caps context at `maxBundleTokens: 2500`, `maxSectionTokens: 700`, `maxCodeTokens: 900`.
- `packages/core/src/context/config.ts` times providers out at `providerTimeoutMs: 120` and foreground injection at `degradedProviderTimeoutMs: 200`.
- `packages/core/src/context/providers/memory-provider.ts` returns empty evidence and sections.
- `packages/core/src/context/providers/project-provider.ts` summarizes `JDCAGNET.md`, `AGENTS.md`, and `README.md` using only the first three non-empty lines.
- `packages/core/src/providers/anthropic.ts` prepends `You are Claude Code...` before the JDC identity in stream mode.
- Stream and non-stream provider prompt assembly are not tested for equivalent JDC Context Engine behavior.

This phase does not change Anthropic adaptive thinking behavior. Current new-model `adaptive` thinking support is treated as intentional and is outside Phase 0 scope.

## File Structure

- Modify: `packages/core/src/context/types.ts`
  - Make context token budget fields optional/observable instead of mandatory production caps.
- Modify: `packages/core/src/context/schemas.ts`
  - Accept omitted context budget caps in runtime config.
- Modify: `packages/core/src/context/config.ts`
  - Remove artificial production defaults and raise provider runtime defaults.
- Create: `packages/core/src/context/context-config.test.ts`
  - Lock the no-artificial-cap defaults and provider timeout defaults.
- Modify: `packages/core/src/context/budgeter.ts`
  - Do not drop sections when no explicit cap is provided.
- Modify: `packages/core/src/context/orchestrator.ts`
  - Respect optional budget caps and keep provider runtime soft timeouts.
- Modify: `packages/core/src/session.ts`
  - Build `ContextRequest` without forcing the old `maxBundleTokens`.
- Modify: `packages/core/src/sub-session.ts`
  - Apply the same optional budget behavior for subagents and Team workers.
- Modify: `packages/core/src/context/providers/memory-provider.ts`
  - Read accepted project facts through the shared store/retrieval path and emit relevance-selected memory sections.
- Modify: `packages/core/src/context/providers/project-provider.ts`
  - Extract meaningful project docs and config summaries beyond first three lines.
- Modify: `packages/core/src/context/providers/git-provider.ts`
  - Include direct branch/status/log signals alongside existing hot-file signals.
- Modify: `packages/core/src/providers/anthropic.ts`
  - Remove the normal-mode Claude Code identity prefix and keep official Anthropic request block shape.
- Modify: `packages/core/src/providers/openai-chat.ts`
  - Add parity tests/adjustments so JDC dynamic context semantics match Anthropic.
- Modify: `packages/core/src/providers/openai-responses.ts`
  - Add parity tests/adjustments so JDC dynamic context semantics match Anthropic.
- Create: `packages/core/src/providers/provider-prompt-contract.test.ts`
  - Verify identity, context placement, and protocol-safe prompt construction.
- Modify: `packages/core/src/context/signal-providers.test.ts`
  - Add memory/project provider regression coverage.
- Modify: `packages/core/src/context/context-orchestrator.test.ts`
  - Add no-artificial-cap and provider timeout regression coverage.
- Modify: `packages/core/src/session-context.test.ts`
  - Verify main and sub-session requests no longer force the 2.5k context cap.

## Dependencies

Tasks must be implemented in order:

1. Config/types/schema defaults.
2. Budgeter/orchestrator optional-cap behavior.
3. Session/sub-session request plumbing.
4. Provider implementations.
5. Provider prompt contract fixes.
6. Product/eval verification.

Do not start Phase 1 retrieval integration until Phase 0 tests pass. A retriever cannot help if the engine still cuts context at 2.5k, memory provider is empty, or provider prompt assembly conflicts with JDC identity.

---

### Task 1: Remove Artificial Production Context Caps From Config

**Files:**
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Modify: `packages/core/src/context/config.ts`
- Create: `packages/core/src/context/context-config.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `packages/core/src/context/context-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_ENGINE_CONFIG, resolveContextEngineConfig } from './config.js'

describe('Context Engine config defaults', () => {
  it('does not impose old artificial context ceilings in production defaults', () => {
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget.maxBundleTokens).toBeUndefined()
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget.maxSectionTokens).toBeUndefined()
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget.maxCodeTokens).toBeUndefined()
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget.providerOverflowPolicy).toBe('degrade_and_retry')
  })

  it('parses legacy compatibility caps without making them production defaults', () => {
    const config = resolveContextEngineConfig({
      tokenBudget: {
        maxBundleTokens: 4096,
        maxSectionTokens: 1024,
        maxCodeTokens: 2048,
      },
    })

    expect(config.tokenBudget.maxBundleTokens).toBe(4096)
    expect(config.tokenBudget.maxSectionTokens).toBe(1024)
    expect(config.tokenBudget.maxCodeTokens).toBe(2048)
  })

  it('uses realistic provider runtime defaults instead of 120ms/200ms starvation', () => {
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.performance?.providerTimeoutMs).toBeGreaterThanOrEqual(1000)
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.performance?.degradedProviderTimeoutMs).toBeGreaterThanOrEqual(1500)
  })
})
```

- [ ] **Step 2: Update config types**

In `packages/core/src/context/types.ts`, change the `ContextEngineConfig.tokenBudget` shape to optional caps plus overflow policy:

```ts
export type ContextProviderOverflowPolicy = 'degrade_and_retry' | 'diagnostic_only'

export interface ContextEngineConfig {
  // existing fields stay the same
  tokenBudget: {
    maxBundleTokens?: number
    maxSectionTokens?: number
    maxCodeTokens?: number
    providerOverflowPolicy: ContextProviderOverflowPolicy
  }
  // existing fields stay the same
}
```

Update `ContextRequest` and `ContextTokenBudget`:

```ts
export interface ContextRequest {
  sessionId: string
  cwd: string
  userMessage: string
  recentMessages: Message[]
  mode: ContextMode
  model: string
  tokenBudget?: number
  runtime: RuntimeSnapshot
  ide?: IdeSnapshot
  signal?: AbortSignal
  createdAt: number
}

export interface ContextTokenBudget {
  maxTokens?: number
  usedTokens: number
  droppedTokens: number
  providerLimitObserved?: number
  retryReason?: string
}
```

- [ ] **Step 3: Update runtime schemas**

In `packages/core/src/context/schemas.ts`, change the token budget config schema from required positive numbers to optional positive numbers plus policy:

```ts
tokenBudget: z.object({
  maxBundleTokens: z.number().int().positive().optional(),
  maxSectionTokens: z.number().int().positive().optional(),
  maxCodeTokens: z.number().int().positive().optional(),
  providerOverflowPolicy: z.enum(['degrade_and_retry', 'diagnostic_only']).default('degrade_and_retry'),
})
```

If there is a `ContextRequestSchema`, change:

```ts
tokenBudget: z.number().int().positive().optional(),
```

- [ ] **Step 4: Update production defaults**

In `packages/core/src/context/config.ts`, replace the old default block:

```ts
tokenBudget: {
  maxBundleTokens: 2500,
  maxSectionTokens: 700,
  maxCodeTokens: 900,
},
performance: {
  providerTimeoutMs: 120,
  degradedProviderTimeoutMs: 200,
  maxBackgroundJobsPerProject: 1,
  harvestMinIntervalMs: 30_000,
  contextPanelMaxRows: 50,
},
```

with:

```ts
tokenBudget: {
  providerOverflowPolicy: 'degrade_and_retry',
},
performance: {
  providerTimeoutMs: 1_200,
  degradedProviderTimeoutMs: 1_800,
  maxBackgroundJobsPerProject: 1,
  harvestMinIntervalMs: 30_000,
  contextPanelMaxRows: 50,
},
```

Keep `resolveContextEngineConfig()` merge behavior:

```ts
tokenBudget: { ...DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget, ...input.tokenBudget },
```

- [ ] **Step 5: Run config tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-config.test.ts --no-file-parallelism
```

Expected: PASS after the type/schema/default updates.

- [ ] **Step 6: Commit config contract**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/schemas.ts packages/core/src/context/config.ts packages/core/src/context/context-config.test.ts
git commit -m "feat(context): remove artificial context token caps"
```

---

### Task 2: Make Budgeter And Orchestrator Honor Optional Caps

**Files:**
- Modify: `packages/core/src/context/budgeter.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`

- [ ] **Step 1: Add failing no-cap orchestrator test**

Add this test to `packages/core/src/context/context-orchestrator.test.ts`:

```ts
  it('does not drop large relevant sections when no explicit token caps are configured', async () => {
    const largeProjectSection = section({
      id: 'project_large',
      kind: 'project_profile',
      title: 'Project Primer',
      content: 'JDC Context Engine '.repeat(1200),
      tokenEstimate: 6000,
      priority: 90,
    })
    const store = makeStore({ facts: [] })

    const result = await buildContextBundle({ ...request, tokenBudget: undefined }, {
      injectionEnabled: true,
      store,
      providers: [{ id: 'project', collect: async () => providerResult([largeProjectSection]) }],
      maxSectionTokens: undefined,
      maxCodeTokens: undefined,
      now: () => 1_000,
      id: () => 'bundle_no_cap',
    })

    expect(result.dropped).toEqual([])
    expect(result.renderedPrompt).toContain('JDC Context Engine')
    expect(result.bundle.budget.maxTokens).toBeUndefined()
    expect(result.bundle.budget.usedTokens).toBeGreaterThanOrEqual(6000)
  })
```

- [ ] **Step 2: Update budget limits**

In `packages/core/src/context/budgeter.ts`, allow no-cap limits:

```ts
export interface ContextBudgetLimits {
  maxTokens?: number
  maxSectionTokens?: number
  maxCodeTokens?: number
}
```

Even when `limits.maxTokens`, `limits.maxSectionTokens`, or `limits.maxCodeTokens` are present for backward compatibility, do not drop or truncate sections locally:

```ts
return {
  sections,
  dropped: [],
  budget: { maxTokens: limits.maxTokens, usedTokens, droppedTokens: 0 },
}
```

Do not add `hasBundleCap`, `hasSectionCap`, or `hasCodeCap` comparisons. Provider/model overflow belongs in adapter fallback logic, not local Engine budgeting.

- [ ] **Step 3: Update orchestrator defaults**

In `packages/core/src/context/orchestrator.ts`, remove tiny constants:

```ts
const DEFAULT_MAX_SECTION_TOKENS = 700
const DEFAULT_MAX_CODE_TOKENS = 900
```

Change `budgetLimits()` so it returns observed compatibility metadata only:

```ts
function budgetLimits(request: ContextRequest, options: BuildContextBundleOptions): ContextBudgetLimits {
  return {
    maxTokens: request.tokenBudget,
  }
}
```

Change `makeBundle()` and `emptyBundle()` budget construction to preserve `undefined`:

```ts
budget: {
  maxTokens: request.tokenBudget,
  usedTokens,
  droppedTokens,
}
```

- [ ] **Step 4: Update old tests that assumed numeric caps**

In `packages/core/src/context/context-orchestrator.test.ts`, for tests that intentionally need clipping, pass explicit caps:

```ts
tokenBudget: 200,
maxSectionTokens: 100,
maxCodeTokens: 100,
```

For tests that represent production behavior, leave caps undefined and assert that large relevant content is kept.

- [ ] **Step 5: Run orchestrator budget tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: PASS and no regression to old 2.5k/700/900 caps.

- [ ] **Step 6: Commit optional cap behavior**

```bash
git add packages/core/src/context/budgeter.ts packages/core/src/context/orchestrator.ts packages/core/src/context/context-orchestrator.test.ts
git commit -m "feat(context): make context budgeting relevance first"
```

---

### Task 3: Stop Session And Sub-Session From Reintroducing The Old Cap

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Modify: `packages/core/src/session-context.test.ts`

- [ ] **Step 1: Add failing session plumbing tests**

In `packages/core/src/session-context.test.ts`, add assertions around the existing context injection tests:

```ts
expect(buildContextBundleSpy).toHaveBeenCalledWith(
  expect.objectContaining({ tokenBudget: undefined }),
  expect.not.objectContaining({
    maxSectionTokens: expect.any(Number),
    maxCodeTokens: expect.any(Number),
  }),
)
```

Add a second test proving explicit legacy config caps are parsed but not forwarded as production limits:

```ts
const harness = createSessionHarness({
  contextConfig: {
    tokenBudget: {
      maxBundleTokens: 8192,
      maxSectionTokens: 2048,
      maxCodeTokens: 4096,
    },
  },
})

expect(buildContextBundleSpy).toHaveBeenCalledWith(
  expect.not.objectContaining({ tokenBudget: 8192 }),
  expect.not.objectContaining({
    maxSectionTokens: expect.any(Number),
    maxCodeTokens: expect.any(Number),
  }),
)
```

- [ ] **Step 2: Update main session request creation**

In `packages/core/src/session.ts`, keep this behavior:

```ts
tokenBudget: this.contextConfig.tokenBudget.maxBundleTokens,
```

but only because the field is now optional. Do not default it elsewhere to `2500`.

When calling `buildContextBundle()`, pass optional caps exactly:

```ts
maxSectionTokens: this.contextConfig.tokenBudget.maxSectionTokens,
maxCodeTokens: this.contextConfig.tokenBudget.maxCodeTokens,
```

Do not replace `undefined` with old constants.

- [ ] **Step 3: Update sub-session request creation**

In `packages/core/src/sub-session.ts`, keep:

```ts
tokenBudget: contextConfig.tokenBudget.maxBundleTokens,
maxSectionTokens: contextConfig.tokenBudget.maxSectionTokens,
maxCodeTokens: contextConfig.tokenBudget.maxCodeTokens,
```

and ensure `undefined` flows through unchanged for subagents, Team PM, and Team workers.

- [ ] **Step 4: Run session context tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: PASS. The test must prove default production config does not pass the old 2.5k cap.

- [ ] **Step 5: Commit session plumbing**

```bash
git add packages/core/src/session.ts packages/core/src/sub-session.ts packages/core/src/session-context.test.ts
git commit -m "feat(context): preserve uncapped context requests"
```

---

### Task 4: Implement Real Memory Provider Output

**Files:**
- Modify: `packages/core/src/context/providers/memory-provider.ts`
- Modify: `packages/core/src/context/signal-providers.test.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`

- [ ] **Step 1: Add failing memory provider test**

In `packages/core/src/context/signal-providers.test.ts`, replace the empty-provider expectation with:

```ts
  it('collects accepted project memories as cited memory context', async () => {
    const store = {
      listAcceptedProjectFacts: vi.fn(async () => ({
        ok: true,
        value: [
          {
            id: 'fact_release',
            kind: 'workflow_rule',
            scope: 'project',
            content: '发布前必须运行 pnpm build。',
            citations: [{ id: 'cit_release', type: 'memory', ref: 'memory_release' }],
            confidence: 0.95,
            freshness: 'recent',
            sourceProvider: 'JdcMemoryWrite',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        diagnostics: [],
      })),
    }

    const result = await collectMemoryContext(request('/repo', { userMessage: '发布流程是什么' }), { store: store as any })

    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]?.kind).toBe('memory')
    expect(result.sections[0]?.content).toContain('发布前必须运行 pnpm build')
    expect(result.sections[0]?.citations[0]?.ref).toBe('memory_release')
    expect(result.health.status).toBe('cached')
  })
```

- [ ] **Step 2: Update memory provider options**

In `packages/core/src/context/providers/memory-provider.ts`, change options:

```ts
import type { ContextStore } from '../store.js'

export interface MemoryProviderOptions {
  enabled?: boolean
  store?: Pick<ContextStore, 'listAcceptedProjectFacts'>
  maxMemories?: number
}
```

- [ ] **Step 3: Implement provider body**

Use accepted facts and convert them to one memory section:

```ts
const maxMemories = options.maxMemories ?? 12
const factsResult = options.store
  ? await options.store.listAcceptedProjectFacts({
      minConfidence: 0.01,
      includeStale: false,
      includeExpired: false,
      limit: maxMemories,
      orderBy: 'updated_desc',
    })
  : { ok: true as const, value: [], diagnostics: [] }

if (!factsResult.ok) {
  const diag = factsResult.diagnostics[0] ?? diagnostic(SOURCE, 'warning', 'Memory provider could not read accepted project facts.', nowFromRequest(request))
  return { evidence: [], sections: [], diagnostics: [diag], health: providerHealth('memory', 'failed', nowFromRequest(request), diag) }
}

const facts = factsResult.value
if (facts.length === 0) {
  return { evidence: [], sections: [], diagnostics: factsResult.diagnostics, health: providerHealth('memory', 'cached', nowFromRequest(request)) }
}

const content = facts.map((fact) => `- [${fact.kind}] ${fact.content}`).join('\n')
const citations = facts.flatMap((fact) => fact.citations)

return {
  evidence: [],
  sections: [section([request.sessionId, SOURCE, ...facts.map((fact) => fact.id)], 'memory', 'Project memory', content, citations, 80, Math.max(...facts.map((fact) => fact.confidence)), 'cached', SOURCE)],
  diagnostics: factsResult.diagnostics,
  health: providerHealth('memory', 'cached', nowFromRequest(request)),
}
```

If Phase 1 retriever already exists when this task is implemented, call `retrieveContextFacts()` instead of direct recency ordering. If Phase 1 has not started, direct accepted-fact output is acceptable for Phase 0 and Phase 1 will replace it with retrieval ranking.

- [ ] **Step 4: Wire store into provider registration**

In `packages/core/src/session.ts`, update provider registration:

```ts
{ id: 'memory', collect: async (request) => collectMemoryContext(request, { enabled: toggles.memory, store: await this.getContextStore() }) },
```

In `packages/core/src/sub-session.ts`, pass `opts.contextEngine.store` to memory provider when sub-session providers are constructed. If sub-session providers are supplied by the parent, ensure parent registration already includes the store.

- [ ] **Step 5: Run provider tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/signal-providers.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS. Memory provider must not return permanent empty sections when accepted project facts exist.

- [ ] **Step 6: Commit memory provider**

```bash
git add packages/core/src/context/providers/memory-provider.ts packages/core/src/context/signal-providers.test.ts packages/core/src/session.ts packages/core/src/sub-session.ts
git commit -m "feat(context): emit accepted project memory context"
```

---

### Task 5: Expand Project Provider Beyond First Three Lines

**Files:**
- Modify: `packages/core/src/context/providers/project-provider.ts`
- Modify: `packages/core/src/context/signal-providers.test.ts`

- [ ] **Step 1: Add failing project provider test**

In `packages/core/src/context/signal-providers.test.ts`, add:

```ts
  it('keeps meaningful project docs beyond the first three non-empty lines', async () => {
    const cwd = await makeTempProject({
      'JDCAGNET.md': [
        '# JDCAGNET',
        '',
        '第一行简介。',
        '第二行简介。',
        '第三行简介。',
        '',
        '## 发布流程',
        '必须先运行 pnpm build，再打 tag。',
        '',
        '## 上下文引擎约定',
        'JDC Context Engine 数据必须按项目持久化。',
      ].join('\n'),
    })

    const result = await collectProjectContext(request(cwd))

    expect(result.sections[0]?.content).toContain('发布流程')
    expect(result.sections[0]?.content).toContain('pnpm build')
    expect(result.sections[0]?.content).toContain('上下文引擎约定')
  })
```

- [ ] **Step 2: Replace `summarizeProjectFile()` for markdown files**

In `packages/core/src/context/providers/project-provider.ts`, implement markdown extraction:

```ts
function summarizeProjectFile(fileName: string, content: string): string {
  if (fileName === 'package.json') return summarizePackageJson(content)
  if (fileName.endsWith('.md')) return summarizeMarkdownProjectFile(fileName, content)
  if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) return summarizeYamlProjectFile(fileName, content)
  return summarizePlainProjectFile(fileName, content)
}
```

Add:

```ts
function summarizeMarkdownProjectFile(fileName: string, content: string): string {
  const lines = content.split('\n')
  const kept: string[] = []
  let currentHeading = ''

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^#{1,3}\s+/.test(line)) {
      currentHeading = line.replace(/^#{1,3}\s+/, '')
      kept.push(`## ${currentHeading}`)
      continue
    }
    if (kept.length < 80) {
      kept.push(currentHeading ? `${currentHeading}: ${line}` : line)
    }
  }

  return `${fileName}:\n${kept.slice(0, 80).join('\n')}`
}
```

Keep this extraction bounded by line count, not by the old three-line summary.

- [ ] **Step 3: Improve package and workspace summaries**

For `package.json`, include name, scripts, dependencies keys, workspaces, and version:

```ts
function summarizePackageJson(content: string): string {
  try {
    const pkg = JSON.parse(content) as {
      name?: string
      version?: string
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      workspaces?: unknown
    }
    const scripts = Object.entries(pkg.scripts ?? {}).map(([name, command]) => `${name}: ${command}`).join('\n')
    const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).slice(0, 80).join(', ')
    return [
      `package.json name=${pkg.name ?? 'unknown'} version=${pkg.version ?? 'unknown'}`,
      scripts ? `scripts:\n${scripts}` : 'scripts: none',
      pkg.workspaces ? `workspaces=${JSON.stringify(pkg.workspaces)}` : 'workspaces: none',
      deps ? `dependencies=${deps}` : 'dependencies: none',
    ].join('\n')
  } catch {
    return 'package.json is present but could not be parsed'
  }
}
```

- [ ] **Step 4: Run provider tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/signal-providers.test.ts --no-file-parallelism
```

Expected: PASS. Project provider must retain useful JDCAGNET/AGENTS/README sections.

- [ ] **Step 5: Commit project provider**

```bash
git add packages/core/src/context/providers/project-provider.ts packages/core/src/context/signal-providers.test.ts
git commit -m "feat(context): preserve project documentation signals"
```

---

### Task 6: Add Direct Git Status Signals Without Removing Hot Files

**Files:**
- Modify: `packages/core/src/context/providers/git-provider.ts`
- Modify: `packages/core/src/context/signal-providers.test.ts`

- [ ] **Step 1: Add failing git provider test**

Add a test that stubs git command output and expects branch, short status, and recent log to appear in the git section:

```ts
expect(result.sections[0]?.content).toContain('branch: main')
expect(result.sections[0]?.content).toContain('M packages/core/src/context/config.ts')
expect(result.sections[0]?.content).toContain('recent commits:')
```

- [ ] **Step 2: Extend git provider collection**

In `packages/core/src/context/providers/git-provider.ts`, add bounded command reads:

```ts
const branch = await runGit(cwd, ['branch', '--show-current'])
const status = await runGit(cwd, ['status', '--short'])
const log = await runGit(cwd, ['log', '--oneline', '-5'])
```

Include them before existing hot-file summary:

```ts
const content = [
  `branch: ${branch.trim() || 'unknown'}`,
  status.trim() ? `status:\n${status.trim()}` : 'status: clean',
  log.trim() ? `recent commits:\n${log.trim()}` : 'recent commits: unavailable',
  hotFilesSummary,
].filter(Boolean).join('\n\n')
```

- [ ] **Step 3: Run git provider tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/signal-providers.test.ts --no-file-parallelism
```

Expected: PASS. Existing hot-file behavior must still be present.

- [ ] **Step 4: Commit git provider**

```bash
git add packages/core/src/context/providers/git-provider.ts packages/core/src/context/signal-providers.test.ts
git commit -m "feat(context): include direct git state signals"
```

---

### Task 7: Preserve JDC Identity And Anthropic Official Request Shape

**Files:**
- Modify: `packages/core/src/providers/anthropic.ts`
- Create: `packages/core/src/providers/provider-prompt-contract.test.ts`

- [ ] **Step 1: Export test-only prompt helpers**

In `packages/core/src/providers/anthropic.ts`, expose pure helpers for tests without changing runtime behavior:

```ts
export const __anthropicPromptTest = {
  resolveSystemPrompt,
  resolveStreamSystemPrompt,
}
```

If the project style avoids exporting test hooks from production files, move shared prompt assembly into `packages/core/src/providers/anthropic-prompt.ts` and import it from `anthropic.ts`.

- [ ] **Step 2: Write failing identity/prompt tests**

Create `packages/core/src/providers/provider-prompt-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { __anthropicPromptTest } from './anthropic.js'
import type { PromptSegment } from '../types.js'

describe('provider prompt contracts', () => {
  it('keeps JDC identity first in Anthropic stream system blocks', () => {
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDCAGNET, JDC Context Engine powered coding agent.', cacheable: true },
      { content: '<jdc-context-engine>本轮注入项目上下文</jdc-context-engine>', cacheable: false, jdcContextEngine: true },
    ]

    const blocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, 'x-anthropic-billing-header: cc_version=test;')
    const text = blocks.map((block: any) => block.text).join('\n')

    expect(text).toContain('You are JDCAGNET')
    expect(text).not.toContain('You are Claude Code')
    expect(blocks.every((block: any) => block.type === 'text')).toBe(true)
    expect(blocks.find((block: any) => block.text.includes('<jdc-context-engine>'))?.cache_control).toBeUndefined()
  })

  it('keeps stream and non-stream prompt semantics aligned for JDC context segments', () => {
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDCAGNET.', cacheable: true },
      { content: '<jdc-context-engine>动态项目上下文</jdc-context-engine>', cacheable: false, jdcContextEngine: true },
    ]

    const streamBlocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, '')
    const chatBlocks = __anthropicPromptTest.resolveSystemPrompt(segments)

    expect(streamBlocks.map((block: any) => block.text).join('\n')).toContain('<jdc-context-engine>')
    expect(chatBlocks.map((block: any) => block.text).join('\n')).toContain('<jdc-context-engine>')
  })
})
```

- [ ] **Step 3: Remove normal-mode Claude Code prefix**

In `packages/core/src/providers/anthropic.ts`, remove:

```ts
const cliPrefix = `You are Claude Code, Anthropic's official CLI for Claude.`
```

Change stream prompt assembly so cacheable parts start empty:

```ts
const cacheableParts: string[] = []
```

For a string system prompt, do:

```ts
result.push({ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } })
```

Keep attribution as a separate text block exactly as current request shape expects.

- [ ] **Step 4: Preserve official Anthropic block shape**

Do not convert Anthropic `system` into a single plain string if the current SDK path expects an array of text blocks. Keep:

```ts
{ type: 'text', text: '...', cache_control: { type: 'ephemeral' } }
```

only on valid text blocks. Do not attach cache control to dynamic JDC context blocks unless official cache semantics allow it and tests prove it.

Do not change `applyEffort()` in this phase.

- [ ] **Step 5: Run prompt contract tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/providers/provider-prompt-contract.test.ts --no-file-parallelism
```

Expected: PASS. The stream path must not contain the Claude Code identity prefix in normal mode.

- [ ] **Step 6: Commit Anthropic prompt contract**

```bash
git add packages/core/src/providers/anthropic.ts packages/core/src/providers/provider-prompt-contract.test.ts
git commit -m "fix(provider): keep JDC identity in anthropic system prompt"
```

---

### Task 8: Verify OpenAI Chat And Responses Context Semantics

**Files:**
- Modify: `packages/core/src/providers/openai-chat.ts`
- Modify: `packages/core/src/providers/openai-responses.ts`
- Modify: `packages/core/src/providers/provider-prompt-contract.test.ts`

- [ ] **Step 1: Add OpenAI provider prompt tests**

Extend `packages/core/src/providers/provider-prompt-contract.test.ts`:

```ts
import { __openAiChatPromptTest } from './openai-chat.js'
import { __openAiResponsesPromptTest } from './openai-responses.js'

it('preserves JDC context in OpenAI Chat system prompt', () => {
  const prompt = __openAiChatPromptTest.resolveSystemPrompt([
    { content: '# Identity\nYou are JDCAGNET.', cacheable: true },
    { content: '<jdc-context-engine>项目上下文</jdc-context-engine>', cacheable: false, jdcContextEngine: true },
  ])

  expect(prompt).toContain('You are JDCAGNET')
  expect(prompt).toContain('<jdc-context-engine>')
})

it('preserves JDC context in OpenAI Responses instructions', () => {
  const prompt = __openAiResponsesPromptTest.resolveSystemPrompt([
    { content: '# Identity\nYou are JDCAGNET.', cacheable: true },
    { content: '<jdc-context-engine>项目上下文</jdc-context-engine>', cacheable: false, jdcContextEngine: true },
  ])

  expect(prompt).toContain('You are JDCAGNET')
  expect(prompt).toContain('<jdc-context-engine>')
})
```

- [ ] **Step 2: Export prompt helpers for OpenAI tests**

In `packages/core/src/providers/openai-chat.ts`:

```ts
export const __openAiChatPromptTest = {
  resolveSystemPrompt,
}
```

In `packages/core/src/providers/openai-responses.ts`:

```ts
export const __openAiResponsesPromptTest = {
  resolveSystemPrompt,
}
```

- [ ] **Step 3: Adjust only if tests expose semantic loss**

If either provider drops non-cacheable JDC context segments, change its resolver to join all segment contents in order:

```ts
return systemPrompt
  .map((segment) => segment.content)
  .filter(Boolean)
  .join('\n\n')
```

Do not add Anthropic-only cache metadata to OpenAI payloads.

- [ ] **Step 4: Run provider prompt tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/providers/provider-prompt-contract.test.ts --no-file-parallelism
```

Expected: PASS for Anthropic, OpenAI Chat, and OpenAI Responses.

- [ ] **Step 5: Commit protocol parity tests**

```bash
git add packages/core/src/providers/openai-chat.ts packages/core/src/providers/openai-responses.ts packages/core/src/providers/provider-prompt-contract.test.ts
git commit -m "test(provider): cover context prompt protocol parity"
```

---

### Task 9: Add Phase 0 Product Evals

**Files:**
- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `packages/core/src/context/evals/assertions.ts`

- [ ] **Step 1: Add eval for no artificial cap**

Add:

```ts
it('keeps a large relevant project primer when no explicit cap is configured', async () => {
  const primer = makeSection({
    id: 'large_project_primer',
    kind: 'project_profile',
    content: 'JDCAGNET 项目背景 '.repeat(3000),
    tokenEstimate: 15_000,
    priority: 100,
  })

  const report = await buildContextBundle(makeEvalRequest({ tokenBudget: undefined }), {
    injectionEnabled: true,
    store: makeEvalStore([]),
    providers: [{ id: 'project', collect: async () => providerResult([primer]) }],
  })

  assertContextIncludes(report, 'JDCAGNET 项目背景')
  assertNoDroppedReason(report, 'bundle_token_budget')
})
```

- [ ] **Step 2: Add eval for memory provider output**

Add:

```ts
it('injects accepted project memory through the memory provider', async () => {
  const store = makeEvalStore([
    makeFact({
      id: 'release_rule',
      kind: 'workflow_rule',
      content: '发布前必须运行 pnpm build。',
      confidence: 0.95,
    }),
  ])

  const memory = await collectMemoryContext(makeEvalRequest({ userMessage: '发布流程是什么' }), { store })

  expect(memory.sections.map((section) => section.content).join('\n')).toContain('pnpm build')
})
```

- [ ] **Step 3: Add eval for project docs beyond first three lines**

Add a temp-project eval that writes `JDCAGNET.md` with a release section after the third line and asserts `collectProjectContext()` includes it.

- [ ] **Step 4: Run product evals**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected: PASS. These evals become the gate preventing the engine from regressing into tiny/empty context.

- [ ] **Step 5: Commit evals**

```bash
git add packages/core/src/context/context-product-evals.test.ts packages/core/src/context/evals/assertions.ts
git commit -m "test(context): evaluate capacity and provider baselines"
```

---

### Task 10: Full Phase 0 Verification

**Files:**
- Verify all files touched in this phase.

- [ ] **Step 1: Run focused Phase 0 test suite**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-config.test.ts src/context/context-orchestrator.test.ts src/context/signal-providers.test.ts src/providers/provider-prompt-contract.test.ts src/session-context.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 2: Run core build**

Run:

```bash
pnpm --filter @jdcagnet/core build
```

Expected: exit code 0.

- [ ] **Step 3: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 4: Manual acceptance checklist**

Verify these by reading test output and relevant code:

```text
- Default config no longer sets 2500/700/900 caps.
- Default provider timeouts are no longer 120ms/200ms.
- Memory provider returns accepted project memory sections when facts exist.
- Project provider includes meaningful markdown sections beyond first three non-empty lines.
- Anthropic stream system prompt does not prepend "You are Claude Code" in normal mode.
- Anthropic system prompt is still an array of official text blocks with valid cache_control placement.
- OpenAI Chat and Responses still receive JDC context in their system/instructions payload.
- Adaptive thinking behavior was not changed in this phase.
```

- [ ] **Step 5: Commit final verification fixes if needed**

If verification required any fixes:

```bash
git add <changed-files>
git commit -m "fix(context): complete phase0 runtime hardening"
```

If no fixes were needed, do not create an empty commit.

## Phase 0 Acceptance Criteria

- JDC Context Engine no longer has an artificial production cap of 2.5k tokens.
- Context sections are dropped for relevance/freshness/protocol-safe fallback, not because of tiny local defaults.
- Provider collection is not starved by 120ms/200ms defaults.
- Memory provider is no longer a permanent empty shell.
- Project provider preserves useful project docs, release notes, rules, and README/AGENTS/JDCAGNET content beyond the first three lines.
- Git provider includes direct branch/status/recent-log context while preserving current hot-file value.
- Anthropic system prompt keeps JDC identity first and follows official block shape.
- OpenAI Chat and OpenAI Responses preserve equivalent JDC Context Engine semantics.
- Foreground chat still does not run model harvest or full code indexing.
- All Phase 0 verification commands pass.

## Required Commit Messages

Use these commit boundaries:

```bash
git commit -m "feat(context): remove artificial context token caps"
git commit -m "feat(context): make context budgeting relevance first"
git commit -m "feat(context): preserve uncapped context requests"
git commit -m "feat(context): emit accepted project memory context"
git commit -m "feat(context): preserve project documentation signals"
git commit -m "feat(context): include direct git state signals"
git commit -m "fix(provider): keep JDC identity in anthropic system prompt"
git commit -m "test(provider): cover context prompt protocol parity"
git commit -m "test(context): evaluate capacity and provider baselines"
```
