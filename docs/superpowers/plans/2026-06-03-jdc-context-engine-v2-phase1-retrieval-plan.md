# JDC Context Engine V2 Phase 1 Retrieval-First Memory Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broad accepted-memory injection with query-aware relevance retrieval, and make `JdcMemorySearch` use the same retrieval path.

**Architecture:** Add a focused `ContextRetriever` in `packages/core/src/context/retriever.ts`. The retriever reads accepted project facts from `ContextStore`, scores them with lexical/citation/path/kind/freshness signals, returns relevance-ranked facts with optional explicit caps, and is used by both `buildContextBundle()` and `JdcMemorySearch`.

**Tech Stack:** TypeScript, Vitest, existing `ContextStore`, existing `ContextFact`/`ContextRequest` types, no new runtime dependency in Phase 1.

---

## Scope

This plan implements only Phase 1 of the V2 design:

- retrieval-first memory/project fact injection;
- shared retrieval scoring for automatic injection and `JdcMemorySearch`;
- tests for many-memory relevance behavior and old relevant fact recall.

This plan does not implement Team ledger ingestion, semantic embeddings, actor-specific Team PM/worker packs, UI redesign, or schema migrations beyond what this phase needs.

## Phase 0 Prerequisite

Do not execute this plan until `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase0-capacity-runtime-plan.md` has passed.

Phase 1 assumes:

- production defaults no longer impose `maxBundleTokens: 2500`, `maxSectionTokens: 700`, or `maxCodeTokens: 900`;
- memory provider can emit accepted project facts instead of returning permanent empty sections;
- project provider can preserve useful `JDCAGNET.md`, `AGENTS.md`, and `README.md` content beyond the first three lines;
- provider timeouts are not the old `120ms/200ms` defaults;
- Anthropic stream prompts keep JDC identity first and preserve official request block shape.

Retrieval-first means "select relevant context"; it does not mean "cripple context capacity." If explicit debug/user caps are configured, retrieval must honor them. If no caps are configured, retrieval should not introduce a new arbitrary 8k/32k ceiling.

## File Structure

- Create: `packages/core/src/context/retriever.ts`
  - Owns retrieval request types, scoring, token normalization, fact-to-section selection, and result diagnostics.
- Create: `packages/core/src/context/context-retriever.test.ts`
  - Unit tests for retrieval scoring, Chinese/English token matching, freshness handling, optional explicit result limits, and old relevant memory recall.
- Modify: `packages/core/src/context/orchestrator.ts`
  - Replace broad `loadStoreFacts()` use with retriever output.
  - Preserve provider collection, ranking, budgeting, evidence persistence, bundle snapshots, and quota enforcement.
- Modify: `packages/core/src/context/context-orchestrator.test.ts`
  - Update expectations around store calls and add regression tests for relevance-selected memory injection.
- Modify: `packages/core/src/tools/memory-search.ts`
  - Use `retrieveContextFacts()` for query searches while preserving payload schema and filters.
- Modify: `packages/core/src/tools/memory-tools.test.ts`
  - Verify `JdcMemorySearch` uses retrieval scoring and finds old relevant facts.
- Modify: `packages/core/src/context/context-product-evals.test.ts`
  - Add product evals for large memory sets and release workflow recall.
- Modify: `packages/core/src/context/index.ts`
  - Export retriever types/functions if context package already exports public helpers there.

## Dependencies

Tasks must be done in order:

1. Retriever tests and public contract.
2. Retriever implementation.
3. Orchestrator integration.
4. Memory search integration.
5. Product evals and regression command.

Do not start Task 3 before Task 2 passes.

---

### Task 1: Add Retriever Contract And Failing Unit Tests

**Files:**
- Create: `packages/core/src/context/context-retriever.test.ts`
- Create: `packages/core/src/context/retriever.ts`

- [ ] **Step 1: Create failing retriever tests**

Create `packages/core/src/context/context-retriever.test.ts` with this content:

```ts
import { describe, expect, it, vi } from 'vitest'
import { retrieveContextFacts } from './retriever.js'
import type { ContextFact, ContextRequest } from './types.js'

const request: ContextRequest = {
  sessionId: 'session_1',
  cwd: '/repo',
  userMessage: '我们的发布流程是咋样的',
  recentMessages: [],
  mode: 'chat',
  model: 'test-model',
  tokenBudget: 400,
  runtime: {},
  createdAt: 1_000,
}

describe('ContextRetriever', () => {
  it('retrieves old relevant workflow memory ahead of newer irrelevant facts', async () => {
    const facts = [
      ...Array.from({ length: 40 }, (_, index) => fact({
        id: `recent_irrelevant_${index}`,
        content: `Recent unrelated preference ${index}`,
        updatedAt: 10_000 + index,
      })),
      fact({
        id: 'old_release_flow',
        kind: 'workflow_rule',
        content: 'JDCAGNET 发布流程：修改 packages/electron/package.json version，提交 bump commit，打 tag，然后 push tag 触发 release workflow。',
        updatedAt: 1,
        confidence: 1,
      }),
    ]
    const store = makeStore(facts)

    const result = await retrieveContextFacts(request, { store, limit: 5, now: () => 20_000 })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['old_release_flow'])
    expect(result.facts[0]?.reasons).toContain('query_match')
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
      minConfidence: 0.01,
      includeStale: true,
      includeExpired: false,
      limit: 500,
      orderBy: 'updated_desc',
    }))
  })

  it('does not return stale low-value facts by default', async () => {
    const store = makeStore([
      fact({ id: 'stale_pref', kind: 'user_preference', content: 'Use the old release process.', freshness: 'stale' }),
      fact({ id: 'recent_rule', kind: 'workflow_rule', content: 'Use the current release workflow.', freshness: 'recent' }),
    ])

    const result = await retrieveContextFacts({ ...request, userMessage: 'release workflow' }, { store, limit: 5, now: () => 20_000 })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['recent_rule'])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      source: 'ContextRetriever',
      message: expect.stringContaining('stale_pref'),
      visibleInPrimaryUi: false,
    }))
  })

  it('supports citation and path matching for workflow files', async () => {
    const store = makeStore([
      fact({
        id: 'release_yaml_rule',
        kind: 'workflow_rule',
        content: 'Release workflow is defined in GitHub Actions.',
        citations: [{ id: 'cit_release_yml', type: 'file', ref: '.github/workflows/release.yml' }],
      }),
    ])

    const result = await retrieveContextFacts({ ...request, userMessage: 'release.yml 是干嘛的' }, { store, limit: 5, now: () => 20_000 })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['release_yaml_rule'])
    expect(result.facts[0]?.reasons).toContain('citation_match')
  })

  it('returns bounded results when query is empty', async () => {
    const store = makeStore([
      fact({ id: 'rule_1', kind: 'workflow_rule', content: 'Run pnpm build before release.', updatedAt: 10 }),
      fact({ id: 'rule_2', kind: 'project_convention', content: 'Use JDC Context Engine naming.', updatedAt: 20 }),
      fact({ id: 'rule_3', kind: 'known_issue', content: 'Renderer can freeze on full refresh.', updatedAt: 30 }),
    ])

    const result = await retrieveContextFacts({ ...request, userMessage: '' }, { store, limit: 2, now: () => 20_000 })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['rule_3', 'rule_2'])
  })
})

function makeStore(facts: ContextFact[]) {
  return {
    listAcceptedProjectFacts: vi.fn(async () => ({ ok: true, value: facts, diagnostics: [] })),
  } as any
}

function fact(overrides: Partial<ContextFact> = {}): ContextFact {
  return {
    id: 'fact_1',
    kind: 'workflow_rule',
    scope: 'project',
    content: 'Run pnpm build before release.',
    citations: [{ id: 'cit_1', type: 'memory', ref: 'memory_1' }],
    confidence: 0.92,
    freshness: 'recent',
    sourceProvider: 'EvalProvider',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}
```

- [ ] **Step 2: Create retriever stub**

Create `packages/core/src/context/retriever.ts` with this minimal stub so the failing test imports compile:

```ts
import type { ContextDiagnostic, ContextFact, ContextRequest } from './types.js'
import type { ContextStore } from './store.js'

export interface RetrievedContextFact {
  fact: ContextFact
  score: number
  reasons: string[]
}

export interface ContextRetrievalResult {
  facts: RetrievedContextFact[]
  diagnostics: ContextDiagnostic[]
}

export interface ContextRetrievalOptions {
  store: Pick<ContextStore, 'listAcceptedProjectFacts'>
  limit?: number
  now?: () => number
}

export async function retrieveContextFacts(_request: ContextRequest, _options: ContextRetrievalOptions): Promise<ContextRetrievalResult> {
  return { facts: [], diagnostics: [] }
}
```

- [ ] **Step 3: Run test to verify failure**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: tests fail because `retrieveContextFacts()` returns no facts.

- [ ] **Step 4: Commit failing tests and stub**

```bash
git add packages/core/src/context/context-retriever.test.ts packages/core/src/context/retriever.ts
git commit -m "test(context): specify retrieval-first memory selection"
```

---

### Task 2: Implement Lexical/Citation/Freshness Retrieval

**Files:**
- Modify: `packages/core/src/context/retriever.ts`
- Test: `packages/core/src/context/context-retriever.test.ts`

- [ ] **Step 1: Replace retriever stub with implementation**

Implement `packages/core/src/context/retriever.ts` with these exported contracts and helpers:

```ts
import type { ContextDiagnostic, ContextFact, ContextRequest } from './types.js'
import type { ContextStore } from './store.js'

const DEFAULT_CANDIDATE_LIMIT = 500
const DEFAULT_RESULT_LIMIT = 8
const HIGH_VALUE_KINDS = new Set<ContextFact['kind']>([
  'workflow_rule',
  'project_convention',
  'architecture_decision',
  'known_issue',
  'current_goal',
  'runtime_error_chain',
  'code_entrypoint',
])

export interface RetrievedContextFact {
  fact: ContextFact
  score: number
  reasons: string[]
}

export interface ContextRetrievalResult {
  facts: RetrievedContextFact[]
  diagnostics: ContextDiagnostic[]
}

export interface ContextRetrievalOptions {
  store: Pick<ContextStore, 'listAcceptedProjectFacts'>
  limit?: number
  candidateLimit?: number
  now?: () => number
}

export async function retrieveContextFacts(request: ContextRequest, options: ContextRetrievalOptions): Promise<ContextRetrievalResult> {
  const now = options.now ?? Date.now
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT
  const diagnostics: ContextDiagnostic[] = []

  const loaded = await options.store.listAcceptedProjectFacts({
    minConfidence: 0.01,
    includeStale: true,
    includeExpired: false,
    limit: candidateLimit,
    orderBy: 'updated_desc',
  })
  if (!loaded.ok) {
    return { facts: [], diagnostics: loaded.diagnostics }
  }

  const query = normalizeSearchText([request.userMessage, request.mode].filter(Boolean).join(' '))
  const scored = loaded.value
    .map((fact) => scoreFact(fact, query, now))
    .filter((item) => {
      if (item.fact.freshness === 'stale' && !isHighValueStaleFact(item.fact)) {
        diagnostics.push(makeDiagnostic(`Suppressed stale low-value fact ${item.fact.id}.`, now()))
        return false
      }
      return !query || item.score > 0 || HIGH_VALUE_KINDS.has(item.fact.kind)
    })
    .sort((a, b) => b.score - a.score || b.fact.updatedAt - a.fact.updatedAt)
    .slice(0, limit)

  return { facts: scored, diagnostics }
}

function scoreFact(fact: ContextFact, query: string, now: () => number): RetrievedContextFact {
  const reasons: string[] = []
  let score = 0

  if (HIGH_VALUE_KINDS.has(fact.kind)) {
    score += 8
    reasons.push('high_value_kind')
  }
  score += Math.max(0, fact.confidence) * 10
  if (fact.freshness === 'live') score += 10
  if (fact.freshness === 'recent') score += 6
  if (fact.freshness === 'cached') score += 2
  if (fact.freshness === 'stale') score -= 20

  const ageMs = Math.max(0, now() - fact.updatedAt)
  score += Math.max(0, 5 - ageMs / (7 * 24 * 60 * 60 * 1000))

  if (query) {
    const text = normalizeSearchText(searchableFactText(fact))
    if (text.includes(query)) {
      score += 80 + query.length
      reasons.push('query_match')
    }
    const queryTokens = searchTokens(query)
    const textTokens = new Set(searchTokens(text))
    const matched = queryTokens.filter((token) => textTokens.has(token))
    if (matched.length) {
      score += matched.length * 10 + (matched.length / queryTokens.length) * 30
      reasons.push('query_match')
    }
    if (fact.citations.some((citation) => normalizeSearchText(citation.ref).includes(query) || queryTokens.some((token) => normalizeSearchText(citation.ref).includes(token)))) {
      score += 45
      reasons.push('citation_match')
    }
  }

  return { fact, score, reasons: [...new Set(reasons)] }
}

function searchableFactText(fact: ContextFact): string {
  return [
    fact.id,
    fact.kind,
    fact.scope,
    fact.content,
    fact.sourceProvider,
    ...fact.citations.flatMap((citation) => [citation.id, citation.type, citation.ref, citation.hash ?? '']),
  ].join(' ')
}

function isHighValueStaleFact(fact: ContextFact): boolean {
  return fact.kind === 'known_issue' || fact.kind === 'architecture_decision'
}

function makeDiagnostic(message: string, createdAt: number): ContextDiagnostic {
  return {
    id: `diag_context_retriever_${Math.abs(hashText(`${message}:${createdAt}`)).toString(16)}`,
    level: 'info',
    source: 'ContextRetriever',
    message,
    createdAt,
    visibleInPrimaryUi: false,
  }
}

function normalizeSearchText(text: string): string {
  return text
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function searchTokens(text: string): string[] {
  return normalizeSearchText(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function hashText(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return hash
}
```

- [ ] **Step 2: Run retriever tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: all retriever tests pass.

- [ ] **Step 3: Commit retriever implementation**

```bash
git add packages/core/src/context/retriever.ts packages/core/src/context/context-retriever.test.ts
git commit -m "feat(context): add project fact retriever"
```

---

### Task 3: Integrate Retriever Into Context Orchestrator

**Files:**
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`

- [ ] **Step 1: Add failing orchestrator regression**

Add this test to `packages/core/src/context/context-orchestrator.test.ts`:

```ts
  it('injects query-relevant memory instead of recent irrelevant memory', async () => {
    const facts = [
      ...Array.from({ length: 20 }, (_, index) => fact({
        id: `recent_irrelevant_${index}`,
        kind: 'user_preference',
        content: `Recent unrelated preference ${index}`,
        updatedAt: 10_000 + index,
      })),
      fact({
        id: 'release_process',
        kind: 'workflow_rule',
        content: 'JDCAGNET 发布流程：bump version，commit，tag vX.Y.Z，然后 push tag 触发 release workflow。',
        updatedAt: 1,
        confidence: 1,
      }),
    ]
    const store = makeStore({ facts })

    const result = await buildContextBundle({ ...request, userMessage: '我们的发布流程是咋样的', tokenBudget: 120 }, {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 20_000,
      id: () => 'bundle_release_memory',
    })

    expect(result.renderedPrompt).toContain('JDCAGNET 发布流程')
    expect(result.renderedPrompt).not.toContain('Recent unrelated preference')
  })
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: this new test fails until orchestrator uses the retriever.

- [ ] **Step 2: Replace broad fact loading with retriever output**

In `packages/core/src/context/orchestrator.ts`:

1. Import the retriever:

```ts
import { retrieveContextFacts } from './retriever.js'
```

2. Replace `const storeFacts = await loadStoreFacts(options.store)` with:

```ts
    const retrieved = await retrieveContextFacts(request, {
      store: options.store,
      limit: 12,
      now,
    })
    const storeFacts = Object.assign(retrieved.facts.map((item) => item.fact), { diagnostics: retrieved.diagnostics })
```

3. Remove the now-unused focused store query constants if TypeScript reports them as unused:

```ts
const DEFAULT_STORE_FACT_LIMIT = 200
const FOCUSED_STORE_FACT_LIMIT = 75
const HIGH_VALUE_STORE_FACT_KINDS: ContextFactKind[] = [...]
```

4. Remove or simplify `loadStoreFacts()` if it is no longer used.

- [ ] **Step 3: Update old test expectations**

In `context-orchestrator.test.ts`, update any expectations that require `queryFacts()` to be called for store fact loading. The new expectation should be:

```ts
expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
  minConfidence: 0.01,
  includeStale: true,
  includeExpired: false,
  limit: 500,
  orderBy: 'updated_desc',
}))
```

Keep `queryFacts()` expectations only for tests that explicitly exercise `queryFacts()`.

- [ ] **Step 4: Run orchestrator tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: all tests pass.

- [ ] **Step 5: Commit orchestrator integration**

```bash
git add packages/core/src/context/orchestrator.ts packages/core/src/context/context-orchestrator.test.ts
git commit -m "feat(context): inject retrieved project facts"
```

---

### Task 4: Make JdcMemorySearch Use ContextRetriever

**Files:**
- Modify: `packages/core/src/tools/memory-search.ts`
- Modify: `packages/core/src/tools/memory-tools.test.ts`

- [ ] **Step 1: Add failing memory search test**

Add this test to `packages/core/src/tools/memory-tools.test.ts`:

```ts
  it('uses retrieval ranking so an old relevant workflow beats newer irrelevant facts', async () => {
    const store = makeStore({
      facts: [
        ...Array.from({ length: 30 }, (_, index) => fact({
          id: `recent_irrelevant_${index}`,
          content: `Recent unrelated memory ${index}`,
          updatedAt: 10_000 + index,
        })),
        fact({
          id: 'old_release_workflow',
          content: 'JDCAGNET 发布流程：bump version，commit，tag，然后 push tag 触发 release workflow。',
          updatedAt: 1,
        }),
      ],
    })

    const payload = await searchMemoryRecords({ query: '发布流程', limit: 3 }, { store, now: () => 20_000 })

    expect(payload.status).toBe('available')
    expect(payload.results.map((item) => item.id)).toEqual(['old_release_workflow'])
  })
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/tools/memory-tools.test.ts --no-file-parallelism
```

Expected: fail until `searchMemoryRecords()` uses retriever scoring.

- [ ] **Step 2: Wire searchMemoryRecords to retriever**

In `packages/core/src/tools/memory-search.ts`:

1. Import retriever:

```ts
import { retrieveContextFacts } from '../context/retriever.js'
```

2. After resolving `store`, replace the manual `.map(score).filter().sort()` path for text queries with retriever output:

```ts
    const retrieval = await retrieveContextFacts({
      sessionId: 'memory_search',
      cwd: options.cwd ?? process.cwd(),
      userMessage: parsed.query ?? '',
      recentMessages: [],
      mode: 'chat',
      model: 'memory-search',
      tokenBudget: 1_000,
      runtime: {},
      createdAt: now(),
    }, {
      store,
      limit: Math.max(limit, 1),
      now,
    })
```

3. Preserve scope, kind, `citationRef`, and `citationType` behavior by filtering the retrieved facts before mapping them to payload rows:

```ts
function matchesMemoryFilters(fact: ContextFact, parsed: MemorySearchInput): boolean {
  if (parsed.citationRef && !fact.citations.some((citation) => citation.ref === parsed.citationRef)) return false
  if (parsed.citationType && !fact.citations.some((citation) => citation.type === parsed.citationType)) return false
  if (parsed.scope && fact.scope !== parsed.scope) return false
  if (parsed.kind && memoryKindFromFact(fact) !== parsed.kind) return false
  return true
}
```

Then apply it in the retrieval branch:

```ts
    const matches = retrieval.facts
      .map((item) => item.fact)
      .filter((fact) => fact.scope === 'project' || fact.scope === 'repo' || fact.scope === 'global')
      .filter(isMemoryFact)
      .filter((fact) => matchesMemoryFilters(fact, parsed))
      .slice(0, limit)
      .map(memorySearchResultFromFact)
```

- [ ] **Step 3: Run memory tool tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/tools/memory-tools.test.ts src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: all tests pass.

- [ ] **Step 4: Commit memory search integration**

```bash
git add packages/core/src/tools/memory-search.ts packages/core/src/tools/memory-tools.test.ts
git commit -m "feat(context): share retrieval for memory search"
```

---

### Task 5: Add Product Evals For Many Facts And Release Recall

**Files:**
- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `packages/core/src/context/evals/assertions.ts`

- [ ] **Step 1: Add large-memory product eval**

Add this test to `packages/core/src/context/context-product-evals.test.ts` inside the existing `describe('JDC Context Engine product evals', () => { ... })` block:

```ts
  it('retrieves a relevant old memory without injecting hundreds of recent memories', async () => {
    const cwd = tempProject()
    const store = await openContextStore({ cwd, now: () => 100_000 })

    for (let index = 0; index < 500; index += 1) {
      await store.saveFact({
        id: `recent_noise_${index}`,
        kind: 'user_preference',
        scope: 'project',
        content: `Recent unrelated preference ${index}`,
        citations: [{ id: `cit_noise_${index}`, type: 'message', ref: `noise_${index}` }],
        confidence: 0.9,
        freshness: 'recent',
        sourceProvider: 'ProductEval',
        sessionId: 'session_a',
        createdAt: 50_000 + index,
        updatedAt: 50_000 + index,
      })
    }

    await store.saveFact({
      id: 'release_flow_fact',
      kind: 'workflow_rule',
      scope: 'project',
      content: 'JDCAGNET 发布流程：修改 package version，commit bump，tag vX.Y.Z，push tag 触发 release workflow。',
      citations: [{ id: 'cit_release_flow', type: 'message', ref: 'release_flow_memory' }],
      confidence: 1,
      freshness: 'recent',
      sourceProvider: 'ProductEval',
      sessionId: 'session_a',
      createdAt: 1,
      updatedAt: 1,
    })

    const report = await buildContextBundle(request({
      cwd,
      sessionId: 'session_b',
      userMessage: '我们的发布流程是咋样的',
      tokenBudget: 500,
    }), {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 100_000,
      id: () => 'ctx_release_retrieval',
    })

    expect(report.renderedPrompt).toContain('JDCAGNET 发布流程')
    expect(report.renderedPrompt).not.toContain('Recent unrelated preference 499')
    expect(report.bundle.budget.usedTokens).toBeLessThanOrEqual(500)
  })
```

No import changes are required because the file already imports `expect`, `buildContextBundle`, `openContextStore`, and `ContextRequest`.

- [ ] **Step 2: Add eval command coverage**

In `packages/core/src/context/evals/assertions.ts`, append `src/context/context-retriever.test.ts` to `GATE_F_CONTEXT_EVAL_COMMAND`:

```ts
export const GATE_F_CONTEXT_EVAL_COMMAND = 'pnpm --filter @jdcagnet/core exec vitest run src/context/context-evals.test.ts src/context/context-product-evals.test.ts src/context/context-retriever.test.ts src/context/store.test.ts src/tools/__tests__/context-engine-tools.test.ts tests/anthropic.test.ts tests/openai-chat.test.ts tests/openai-responses.test.ts src/session-context.test.ts src/context/context-harvest.test.ts src/context/context-redaction.test.ts src/context/context-safety.test.ts --no-file-parallelism'
```

Keep the command one line.

- [ ] **Step 3: Run eval subset**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts src/context/context-orchestrator.test.ts src/context/context-product-evals.test.ts src/tools/memory-tools.test.ts --no-file-parallelism
```

Expected: all tests pass.

- [ ] **Step 4: Commit eval coverage**

```bash
git add packages/core/src/context/context-product-evals.test.ts packages/core/src/context/evals/assertions.ts
git commit -m "test(context): cover retrieval-first memory evals"
```

---

### Task 6: Final Verification

**Files:**
- No new files beyond previous tasks.

- [ ] **Step 1: Run focused context test suite**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts src/context/context-orchestrator.test.ts src/context/context-product-evals.test.ts src/tools/memory-tools.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: all tests pass.

- [ ] **Step 2: Run core build**

Run:

```bash
pnpm --filter @jdcagnet/core build
```

Expected: TypeScript build exits 0.

- [ ] **Step 3: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Review final behavior**

Run a one-off smoke check after tests:

```bash
node --input-type=module - <<'NODE'
import { searchMemoryRecords } from './packages/core/dist/tools/memory-search.js'
const result = await searchMemoryRecords({ query: '发布流程', limit: 3 }, { cwd: process.cwd() })
console.log(JSON.stringify({ status: result.status, count: result.results.length, first: result.results[0]?.content?.slice(0, 80) }, null, 2))
NODE
```

Expected: command runs without throwing. It may return `empty` in a clean project; in this repository it should find the saved release workflow memory if the local context DB still contains it.

- [ ] **Step 5: Final commit if any verification-only edits were made**

```bash
git status --short
```

Expected: clean working tree after all implementation commits.
