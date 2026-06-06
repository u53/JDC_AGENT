# JDC Agent Constraint Engine Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make context retrieval satisfy structured evidence requirements, including Chinese and mixed-language code queries, while warming the code index in the background and returning useful fallback evidence.

**Architecture:** Split evidence requirement derivation from post-provider missing-evidence diagnostics so retrieval providers can receive structured requirements before they collect context. Add a shared query tokenizer, requirement-aware `EngineQuery` path, provider fallback scan, and repo map v1 from the existing code index without adding Repo Wiki, Stop gate, model profiles, or UI work in this phase.

**Tech Stack:** TypeScript, Vitest, existing JDC Context Engine, existing context providers, existing scheduler, fast-glob-backed scanner utilities, existing context product evals.

---

## Source Documents

- Design: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`
- Phase 1/2 plan: `docs/superpowers/plans/2026-06-05-jdc-agent-constraint-engine-phase1-2.md`
- Phase 3 plan: `docs/superpowers/plans/2026-06-06-jdc-agent-constraint-engine-phase3.md`
- Phase 3 hardening commit: `fa6e553 fix(core): harden phase 3 verification ledger`

## Scope

This plan covers Phase 4 only:

- structured requirement-based retrieval;
- Chinese and mixed-language token support;
- path, symbol, and doc query expansion;
- automatic background index warmup when the code index is missing;
- fallback code evidence while the index warms;
- repo map v1 derived from the existing `IndexStore`.

This plan intentionally does not implement:

- Repo Wiki generation;
- TurnEnd or Stop gate enforcement;
- model profile registry;
- UI constraint panels;
- embeddings or remote semantic search.

## Key Design Decision

Current `buildContextBundle()` collects provider sections before it calls `planContext()`. That means `collectCodeContext()` cannot see `plan.missingEvidence` today.

Phase 4 keeps the existing provider contract but adds a pre-provider requirement derivation step:

```text
1. deriveContextEvidenceRequirements(request)
2. attach requirements to ContextRequest
3. retrieve accepted facts with requirements
4. collect providers with requirements
5. resolve conflicts
6. planContext(requestWithRequirements, sections)
7. compute missingEvidence from structured requirements and returned sections
```

The model-facing `missingEvidence` remains a planner output. The retrieval-facing requirements are available earlier.

## File Boundary Map

Create:

- `packages/core/src/context/retrieval-requirements.ts`
- `packages/core/src/context/retrieval-requirements.test.ts`
- `packages/core/src/context-engine/query-tokenizer.ts`
- `packages/core/src/context-engine/query-tokenizer.test.ts`
- `packages/core/src/context-engine/repo-map.ts`
- `packages/core/src/context-engine/repo-map.test.ts`
- `packages/core/src/context/providers/code-fallback.ts`
- `packages/core/src/context/providers/code-fallback.test.ts`

Modify:

- `packages/core/src/context/types.ts`
- `packages/core/src/context/planner.ts`
- `packages/core/src/context/context-planner.test.ts`
- `packages/core/src/context/retriever.ts`
- `packages/core/src/context/context-retriever.test.ts`
- `packages/core/src/context/orchestrator.ts`
- `packages/core/src/context/context-orchestrator.test.ts`
- `packages/core/src/context/providers/code-provider.ts`
- `packages/core/src/context/signal-providers.test.ts`
- `packages/core/src/context/context-product-evals.test.ts`
- `packages/core/src/context-engine/query.ts`
- `packages/core/src/context-engine/__tests__/call-graph.test.ts`
- `packages/core/src/tools/context-engine-tools.ts`
- `packages/core/src/tools/context-tools.test.ts`
- `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

## Global Acceptance Gates

Run these after the final task:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/retrieval-requirements.test.ts src/context/context-planner.test.ts src/context/context-retriever.test.ts src/context/context-orchestrator.test.ts src/context-engine/query-tokenizer.test.ts src/context-engine/repo-map.test.ts src/context-engine/__tests__/call-graph.test.ts src/context/providers/code-fallback.test.ts src/context/signal-providers.test.ts src/tools/context-tools.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/core test -- --run --no-file-parallelism
git diff --check
```

Expected final result: all commands pass.

---

## Task 1: Evidence Requirement Contract

**Goal:** Add a structured retrieval requirement type and deterministic request-derived requirements without changing provider behavior yet.

**Files:**

- Modify: `packages/core/src/context/types.ts`
- Create: `packages/core/src/context/retrieval-requirements.ts`
- Create: `packages/core/src/context/retrieval-requirements.test.ts`
- Modify: `packages/core/src/context/planner.ts`
- Modify: `packages/core/src/context/context-planner.test.ts`

- [ ] **Step 1: Add failing tests for requirement derivation**

Create `packages/core/src/context/retrieval-requirements.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deriveContextEvidenceRequirements } from './retrieval-requirements.js'
import type { ContextRequest } from './types.js'

function request(userMessage: string, mode: ContextRequest['mode'] = 'chat'): ContextRequest {
  return {
    sessionId: 'session_requirements',
    cwd: '/repo',
    userMessage,
    recentMessages: [],
    mode,
    model: 'test-model',
    runtime: {},
    createdAt: 1_000,
  }
}

describe('deriveContextEvidenceRequirements', () => {
  it('extracts path and symbol hints from Chinese code-edit requests', () => {
    const requirements = deriveContextEvidenceRequirements(request('修复 packages/core/src/session.ts 里面 backgroundTasks 的 completion 记录'))

    expect(requirements).toEqual([
      expect.objectContaining({
        id: 'req_relevant_code',
        kind: 'relevant_code',
        priority: 'must',
        query: '修复 packages/core/src/session.ts 里面 backgroundTasks 的 completion 记录',
        relatedFiles: ['packages/core/src/session.ts'],
        relatedSymbols: ['backgroundTasks'],
      }),
    ])
  })

  it('creates review requirements with diff and code evidence kind', () => {
    const requirements = deriveContextEvidenceRequirements(request('审查刚才的 phase3 diff 有没有问题'))

    expect(requirements).toEqual([
      expect.objectContaining({
        id: 'req_diff_or_relevant_code',
        kind: 'diff_or_relevant_code',
        priority: 'must',
      }),
    ])
  })

  it('keeps chat turns lightweight when no code evidence is implied', () => {
    expect(deriveContextEvidenceRequirements(request('你好'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/retrieval-requirements.test.ts --no-file-parallelism
```

Expected: FAIL because `retrieval-requirements.ts` does not exist.

- [ ] **Step 3: Add requirement types**

Modify `packages/core/src/context/types.ts`:

```ts
export type ContextEvidenceRequirementKind =
  | 'relevant_code'
  | 'runtime_or_code'
  | 'diff_or_relevant_code'
  | 'project_doc'
  | 'repo_map'

export type ContextEvidenceRequirementPriority = 'must' | 'should'
export type ContextEvidenceRequirementStatus = 'missing' | 'satisfied'

export interface ContextEvidenceRequirement {
  id: string
  kind: ContextEvidenceRequirementKind
  reason: string
  query: string
  priority: ContextEvidenceRequirementPriority
  relatedFiles: string[]
  relatedSymbols: string[]
  docRefs: string[]
  languageHints: string[]
  status?: ContextEvidenceRequirementStatus
}
```

Extend `ContextRequest`:

```ts
  evidenceRequirements?: ContextEvidenceRequirement[]
```

Extend `ContextPlan`:

```ts
  evidenceRequirements: ContextEvidenceRequirement[]
  missingEvidence: ContextEvidenceRequirement[]
```

- [ ] **Step 4: Implement deterministic requirement derivation**

Create `packages/core/src/context/retrieval-requirements.ts`:

```ts
import type { ContextEvidenceRequirement, ContextEvidenceRequirementKind, ContextPlanIntent, ContextRequest } from './types.js'

const PATH_HINT_PATTERN = /(?:^|[\s"'`(])((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+)(?=$|[\s"'`).,;:])/g
const SYMBOL_HINT_PATTERN = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?\b/g
const RESERVED_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'this',
  'that',
  'phase',
  'fix',
  'review',
  'debug',
  'test',
  'file',
  'code',
  'packages',
  'src',
])

export function deriveContextEvidenceRequirements(request: ContextRequest): ContextEvidenceRequirement[] {
  const intent = inferRequirementIntent(request)
  const objective = request.userMessage.trim() || request.mode
  const relatedFiles = uniqueMatches(objective, PATH_HINT_PATTERN).map(normalizePathHint)
  const relatedSymbols = uniqueMatches(objective, SYMBOL_HINT_PATTERN)
    .filter((symbol) => symbol.length >= 3)
    .filter((symbol) => !RESERVED_WORDS.has(symbol.toLowerCase()))
    .filter((symbol) => !relatedFiles.some((file) => file.includes(symbol)))

  if (intent === 'code_edit') {
    return [makeRequirement('req_relevant_code', 'relevant_code', 'Code edit turns need target file or symbol evidence before mutation.', objective, 'must', relatedFiles, relatedSymbols)]
  }

  if (intent === 'debug') {
    return [makeRequirement('req_runtime_or_code', 'runtime_or_code', 'Debug turns need runtime output, relevant code, or both.', objective, 'must', relatedFiles, relatedSymbols)]
  }

  if (intent === 'review') {
    return [makeRequirement('req_diff_or_relevant_code', 'diff_or_relevant_code', 'Review turns need changed-file, git, or relevant code evidence.', objective, 'must', relatedFiles, relatedSymbols)]
  }

  if (intent === 'plan') {
    return [makeRequirement('req_repo_map', 'repo_map', 'Planning turns benefit from a compact repository map and project structure evidence.', objective, 'should', relatedFiles, relatedSymbols)]
  }

  return []
}

function makeRequirement(
  id: string,
  kind: ContextEvidenceRequirementKind,
  reason: string,
  query: string,
  priority: ContextEvidenceRequirement['priority'],
  relatedFiles: string[],
  relatedSymbols: string[],
): ContextEvidenceRequirement {
  return {
    id,
    kind,
    reason,
    query,
    priority,
    relatedFiles,
    relatedSymbols,
    docRefs: extractDocRefs(query),
    languageHints: extractLanguageHints(query),
  }
}

function inferRequirementIntent(request: ContextRequest): ContextPlanIntent {
  if (request.mode !== 'chat') return request.mode
  const text = request.userMessage.toLowerCase()
  if (/\b(review|code review|diff|pull request|pr)\b|审查|评审|审核/.test(text)) return 'review'
  if (/\b(plan|design|spec|proposal)\b|计划|方案|设计/.test(text)) return 'plan'
  if (/\b(fix|implement|refactor|change|update|edit|modify|patch)\b|修复|修改|实现|改代码|写代码|feature/.test(text)) return 'code_edit'
  if (/\b(why|investigate|diagnose|debug|explain|bug|error|failed|failure|cancelled|canceled|crash|runtime|performance)\b|为什么|为何|排查|定位|报错|错误|失败|卡死|性能|崩溃/.test(text)) return 'debug'
  return 'chat'
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(pattern)) {
    const value = String(match[1] ?? match[0]).trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function normalizePathHint(value: string): string {
  return value.replace(/\\/g, '/').replace(/^["'`]+|["'`.,;:]+$/g, '')
}

function extractDocRefs(text: string): string[] {
  return uniqueMatches(text, /\b((?:README|AGENTS|JDCAGNET|CHANGELOG|CONTRIBUTING|DESIGN|PLAN)(?:\.[A-Za-z0-9]+)?)\b/gi)
}

function extractLanguageHints(text: string): string[] {
  const hints = new Set<string>()
  if (/\b(?:ts|tsx|typescript)\b/i.test(text)) hints.add('typescript')
  if (/\b(?:js|jsx|javascript)\b/i.test(text)) hints.add('javascript')
  if (/\bpython|\.py\b/i.test(text)) hints.add('python')
  if (/\brust|\.rs\b/i.test(text)) hints.add('rust')
  if (/\bgo|golang|\.go\b/i.test(text)) hints.add('go')
  return [...hints]
}
```

- [ ] **Step 5: Update planner to consume pre-derived requirements**

Modify `packages/core/src/context/planner.ts`:

```ts
import { deriveContextEvidenceRequirements } from './retrieval-requirements.js'
import type { ContextEvidenceRequirement, ContextPlan, ContextPlanIntent, ContextRequest, ContextSection } from './types.js'

export function planContext(request: ContextRequest, sections: ContextSection[]): ContextPlan {
  const intent = inferIntent(request)
  const evidenceRequirements = request.evidenceRequirements ?? deriveContextEvidenceRequirements(request)
  const relevantSections: string[] = []
  const suppressedSections: Array<{ id: string; reason: string }> = []

  for (const section of sections) {
    const suppression = suppressionReason(request, section)
    if (suppression) {
      suppressedSections.push({ id: section.id, reason: suppression })
      continue
    }
    if (isRelevant(intent, section)) relevantSections.push(section.id)
  }

  return {
    id: `ctx_plan_${hashText(`${request.sessionId}:${request.createdAt}:${request.userMessage}`).slice(0, 16)}`,
    requestHash: hashText(JSON.stringify({
      sessionId: request.sessionId,
      cwd: request.cwd,
      userMessage: request.userMessage,
      mode: request.mode,
      transcriptAlreadyInModel: request.transcriptAlreadyInModel === true,
    })),
    intent,
    objective: request.userMessage.trim() || request.mode,
    relevantSections,
    suppressedSections,
    evidenceRequirements,
    missingEvidence: missingEvidenceFor(intent, sections, evidenceRequirements),
    diagnostics: [],
  }
}
```

Replace `missingEvidenceFor()`:

```ts
function missingEvidenceFor(_intent: ContextPlanIntent, sections: ContextSection[], requirements: ContextEvidenceRequirement[]): ContextEvidenceRequirement[] {
  return requirements
    .filter((requirement) => !requirementSatisfied(requirement, sections))
    .map((requirement) => ({ ...requirement, status: 'missing' }))
}

function requirementSatisfied(requirement: ContextEvidenceRequirement, sections: ContextSection[]): boolean {
  if (requirement.kind === 'relevant_code') return sections.some((section) => section.kind === 'relevant_code')
  if (requirement.kind === 'runtime_or_code') return sections.some((section) => section.kind === 'runtime_state' || section.kind === 'relevant_code')
  if (requirement.kind === 'diff_or_relevant_code') return sections.some((section) => section.kind === 'git_state' || section.kind === 'relevant_code')
  if (requirement.kind === 'repo_map') return sections.some((section) => section.kind === 'code_map')
  if (requirement.kind === 'project_doc') return sections.some((section) => section.kind === 'project_profile')
  return false
}
```

- [ ] **Step 6: Add planner regression tests**

Modify `packages/core/src/context/context-planner.test.ts` with tests near existing missing evidence tests:

```ts
it('uses request evidenceRequirements when checking missing evidence', () => {
  const plan = planContext(request({ userMessage: '修复 session.ts', mode: 'chat', evidenceRequirements: [{
    id: 'req_relevant_code',
    kind: 'relevant_code',
    reason: 'Need code.',
    query: '修复 session.ts',
    priority: 'must',
    relatedFiles: ['packages/core/src/session.ts'],
    relatedSymbols: [],
    docRefs: [],
    languageHints: [],
  }] }), [])

  expect(plan.evidenceRequirements).toHaveLength(1)
  expect(plan.missingEvidence).toEqual([expect.objectContaining({
    id: 'req_relevant_code',
    kind: 'relevant_code',
    status: 'missing',
  })])
})

it('marks relevant code requirement satisfied when relevant_code exists', () => {
  const plan = planContext(request({
    userMessage: '修复 session.ts',
    evidenceRequirements: [{
      id: 'req_relevant_code',
      kind: 'relevant_code',
      reason: 'Need code.',
      query: '修复 session.ts',
      priority: 'must',
      relatedFiles: ['packages/core/src/session.ts'],
      relatedSymbols: [],
      docRefs: [],
      languageHints: [],
    }],
  }), [section({ id: 'code_1', kind: 'relevant_code', content: 'session source' })])

  expect(plan.missingEvidence).toEqual([])
})
```

Adapt the local `request()` helper in the test file so it accepts `evidenceRequirements`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/retrieval-requirements.test.ts src/context/context-planner.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/retrieval-requirements.ts packages/core/src/context/retrieval-requirements.test.ts packages/core/src/context/planner.ts packages/core/src/context/context-planner.test.ts
git commit -m "feat(context): derive structured evidence requirements"
```

---

## Task 2: Orchestrator And Fact Retrieval Wiring

**Goal:** Pass structured requirements through bundle assembly and use them to rank durable facts.

**Files:**

- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`
- Modify: `packages/core/src/context/retriever.ts`
- Modify: `packages/core/src/context/context-retriever.test.ts`

- [ ] **Step 1: Add failing orchestrator test for provider-visible requirements**

Modify `packages/core/src/context/context-orchestrator.test.ts`:

```ts
it('passes derived evidence requirements to providers before planning sections', async () => {
  const store = makeStore()
  const seen: unknown[] = []

  await buildContextBundle(request({ userMessage: '修复 packages/core/src/session.ts 的 backgroundTasks' }), {
    store,
    providers: [{
      id: 'code',
      collect: async (req) => {
        seen.push(req.evidenceRequirements)
        return {
          evidence: [],
          sections: [],
          diagnostics: [],
          health: { id: 'code', status: 'enabled', updatedAt: req.createdAt },
        }
      },
    }],
    id: () => 'ctx_requirements_visible',
  })

  expect(seen[0]).toEqual([expect.objectContaining({
    kind: 'relevant_code',
    relatedFiles: ['packages/core/src/session.ts'],
    relatedSymbols: ['backgroundTasks'],
  })])
})
```

- [ ] **Step 2: Add failing fact retrieval tests**

Modify `packages/core/src/context/context-retriever.test.ts`:

```ts
it('boosts facts whose related files satisfy evidence requirements', async () => {
  const now = () => 10_000
  const result = await retrieveContextFacts(request('修复 session completion'), {
    now,
    store: makeStore([
      fact({ id: 'generic', content: 'General project fact', relatedFiles: [] }),
      fact({ id: 'session_fact', content: 'Session completion policy', relatedFiles: ['packages/core/src/session.ts'] }),
    ]),
    evidenceRequirements: [{
      id: 'req_relevant_code',
      kind: 'relevant_code',
      reason: 'Need session code.',
      query: '修复 session completion',
      priority: 'must',
      relatedFiles: ['packages/core/src/session.ts'],
      relatedSymbols: [],
      docRefs: [],
      languageHints: [],
    }],
  })

  expect(result.facts[0]?.fact.id).toBe('session_fact')
  expect(result.facts[0]?.reasons).toContain('requirement_file_match')
})

it('boosts facts whose related symbols satisfy evidence requirements', async () => {
  const result = await retrieveContextFacts(request('修复 backgroundTasks'), {
    store: makeStore([
      fact({ id: 'generic', content: 'General project fact', relatedSymbols: [] }),
      fact({ id: 'background_tasks', content: 'Background task completion rules', relatedSymbols: ['backgroundTasks'] }),
    ]),
    evidenceRequirements: [{
      id: 'req_relevant_code',
      kind: 'relevant_code',
      reason: 'Need symbol code.',
      query: '修复 backgroundTasks',
      priority: 'must',
      relatedFiles: [],
      relatedSymbols: ['backgroundTasks'],
      docRefs: [],
      languageHints: [],
    }],
  })

  expect(result.facts[0]?.fact.id).toBe('background_tasks')
  expect(result.facts[0]?.reasons).toContain('requirement_symbol_match')
})
```

Adapt existing test helpers rather than creating duplicate store fixtures.

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: FAIL because requirements are not propagated or scored.

- [ ] **Step 4: Propagate requirements in the orchestrator**

Modify `packages/core/src/context/orchestrator.ts`:

```ts
import { deriveContextEvidenceRequirements } from './retrieval-requirements.js'
```

At the start of `buildContextBundle()` after the injection-disabled branch:

```ts
    const evidenceRequirements = request.evidenceRequirements ?? deriveContextEvidenceRequirements(request)
    const requestWithRequirements: ContextRequest = evidenceRequirements.length
      ? { ...request, evidenceRequirements }
      : request
```

Use `requestWithRequirements` for store fact loading, provider collection, conflict resolution, planning, persistence, rendering, and bundle construction inside this function. Keep the original injection-disabled path as-is so disabled bundles stay empty and fast.

Change the fact load call:

```ts
    const storeFacts = await loadStoreFacts(requestWithRequirements, options.store, now, scheduler, options.actorProfile)
```

Change the provider collection call:

```ts
    const providerResults = await collectProviderResults(requestWithRequirements, options.providers ?? [], now, scheduler, options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS)
```

Change the plan call:

```ts
    const plan = planContext(requestWithRequirements, conflictResolution.sections)
```

- [ ] **Step 5: Pass requirements into fact retrieval**

Modify `loadStoreFacts()` in `packages/core/src/context/orchestrator.ts`:

```ts
  const retrieved = await retrieveContextFacts(request, {
    store,
    now,
    actorProfile,
    recorder: scheduler.recorder,
    projectKey: request.cwd,
    evidenceRequirements: request.evidenceRequirements,
  })
```

- [ ] **Step 6: Score facts with requirement matches**

Modify `packages/core/src/context/retriever.ts`.

Extend options:

```ts
  evidenceRequirements?: ContextEvidenceRequirement[]
```

Update imports:

```ts
import type { ActorContextProfile, ContextDiagnostic, ContextEvidenceRequirement, ContextFact, ContextFactKind, ContextFactStatus, ContextRequest } from './types.js'
```

Pass requirements into `scoreFact()`:

```ts
      .map((fact) => scoreFact(fact, query, now, options.citationTextLookup, options.actorProfile, options.evidenceRequirements ?? request.evidenceRequirements ?? []))
```

Extend `scoreFact()`:

```ts
function scoreFact(
  fact: ContextFact,
  query: string,
  now: () => number,
  citationTextLookup: Map<string, string[]> | undefined,
  actorProfile: ActorContextProfile | undefined,
  evidenceRequirements: ContextEvidenceRequirement[],
): RetrievedContextFact {
```

Add this before returning:

```ts
  const requirementScore = scoreEvidenceRequirements(fact, evidenceRequirements)
  score += requirementScore.score
  reasons.push(...requirementScore.reasons)
```

Add helpers:

```ts
function scoreEvidenceRequirements(fact: ContextFact, requirements: ContextEvidenceRequirement[]): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const factFiles = new Set((fact.relatedFiles ?? []).map(normalizeComparable))
  const factSymbols = new Set((fact.relatedSymbols ?? []).map(normalizeComparable))
  const factCitationRefs = new Set(fact.citations.map((citation) => normalizeComparable(citation.ref)))

  for (const requirement of requirements) {
    if (requirement.relatedFiles.some((file) => factFiles.has(normalizeComparable(file)) || factCitationRefs.has(normalizeComparable(file)))) {
      score += requirement.priority === 'must' ? 80 : 35
      reasons.push('requirement_file_match')
    }
    if (requirement.relatedSymbols.some((symbol) => factSymbols.has(normalizeComparable(symbol)))) {
      score += requirement.priority === 'must' ? 70 : 30
      reasons.push('requirement_symbol_match')
    }
    if (requirement.docRefs.some((doc) => factCitationRefs.has(normalizeComparable(doc)))) {
      score += requirement.priority === 'must' ? 50 : 25
      reasons.push('requirement_doc_match')
    }
  }

  return { score, reasons: [...new Set(reasons)] }
}

function normalizeComparable(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/retrieval-requirements.test.ts src/context/context-planner.test.ts src/context/context-orchestrator.test.ts src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/context/orchestrator.ts packages/core/src/context/context-orchestrator.test.ts packages/core/src/context/retriever.ts packages/core/src/context/context-retriever.test.ts
git commit -m "feat(context): route evidence requirements through retrieval"
```

---

## Task 3: Mixed-Language Query Tokenizer And Requirement-Aware Engine Query

**Goal:** Preserve Chinese, paths, symbols, and quoted terms in code search, then add `EngineQuery.contextForRequirements()`.

**Files:**

- Create: `packages/core/src/context-engine/query-tokenizer.ts`
- Create: `packages/core/src/context-engine/query-tokenizer.test.ts`
- Modify: `packages/core/src/context-engine/query.ts`
- Modify: `packages/core/src/context-engine/__tests__/call-graph.test.ts`
- Modify: `packages/core/src/tools/context-engine-tools.ts`

- [ ] **Step 1: Add failing tokenizer tests**

Create `packages/core/src/context-engine/query-tokenizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { tokenizeQueryText } from './query-tokenizer.js'

describe('tokenizeQueryText', () => {
  it('preserves Chinese n-grams, path hints, symbols, and quoted phrases', () => {
    const tokens = tokenizeQueryText('修复 packages/core/src/session.ts 里的 backgroundTasks 和 "tool result metadata"')

    expect(tokens).toContainEqual({ value: 'packages/core/src/session.ts', kind: 'path', weight: 6 })
    expect(tokens).toContainEqual({ value: 'backgroundTasks', kind: 'symbol', weight: 5 })
    expect(tokens).toContainEqual({ value: 'tool result metadata', kind: 'quoted', weight: 4 })
    expect(tokens.some((token) => token.kind === 'cjk' && token.value === '修复')).toBe(true)
  })

  it('keeps mixed symbol forms without dropping short CJK input', () => {
    const tokens = tokenizeQueryText('查 PM worker 的 contextRefreshPayload')

    expect(tokens).toContainEqual({ value: 'contextRefreshPayload', kind: 'symbol', weight: 5 })
    expect(tokens.some((token) => token.kind === 'cjk' && token.value === '查')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tokenizer tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context-engine/query-tokenizer.test.ts --no-file-parallelism
```

Expected: FAIL because the tokenizer module does not exist.

- [ ] **Step 3: Implement tokenizer**

Create `packages/core/src/context-engine/query-tokenizer.ts`:

```ts
export type QueryTokenKind = 'path' | 'symbol' | 'quoted' | 'word' | 'cjk'

export interface QueryToken {
  value: string
  kind: QueryTokenKind
  weight: number
}

const PATH_PATTERN = /(?:^|[\s"'`(])((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)+[\w.-]+(?:\.[A-Za-z0-9]+)?)(?=$|[\s"'`).,;:])/g
const QUOTED_PATTERN = /"([^"]+)"|'([^']+)'|`([^`]+)`/g
const SYMBOL_PATTERN = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?\b/g
const WORD_PATTERN = /\b[A-Za-z0-9_][A-Za-z0-9_-]{2,}\b/g
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu

export function tokenizeQueryText(input: string): QueryToken[] {
  const tokens: QueryToken[] = []
  collectRegex(tokens, input, PATH_PATTERN, 'path', 6)
  collectRegex(tokens, input, QUOTED_PATTERN, 'quoted', 4)
  collectRegex(tokens, input, SYMBOL_PATTERN, 'symbol', 5)
  collectRegex(tokens, input, WORD_PATTERN, 'word', 2)
  collectCjk(tokens, input)
  return dedupeTokens(tokens)
}

function collectRegex(tokens: QueryToken[], input: string, pattern: RegExp, kind: QueryTokenKind, weight: number): void {
  pattern.lastIndex = 0
  for (const match of input.matchAll(pattern)) {
    const value = String(match[1] ?? match[2] ?? match[3] ?? match[0]).trim()
    if (!value) continue
    tokens.push({ value: normalizeTokenValue(value, kind), kind, weight })
  }
}

function collectCjk(tokens: QueryToken[], input: string): void {
  CJK_PATTERN.lastIndex = 0
  for (const match of input.matchAll(CJK_PATTERN)) {
    const text = match[0]
    if (text.length === 1) {
      tokens.push({ value: text, kind: 'cjk', weight: 3 })
      continue
    }
    for (let size = 2; size <= Math.min(4, text.length); size += 1) {
      for (let index = 0; index <= text.length - size; index += 1) {
        tokens.push({ value: text.slice(index, index + size), kind: 'cjk', weight: 3 })
      }
    }
  }
}

function normalizeTokenValue(value: string, kind: QueryTokenKind): string {
  const cleaned = value.replace(/\\/g, '/').replace(/^["'`]+|["'`.,;:]+$/g, '')
  return kind === 'path' ? cleaned.replace(/^\.\/+/, '') : cleaned
}

function dedupeTokens(tokens: QueryToken[]): QueryToken[] {
  const byKey = new Map<string, QueryToken>()
  for (const token of tokens) {
    const key = `${token.kind}:${token.value.toLowerCase()}`
    const existing = byKey.get(key)
    if (!existing || token.weight > existing.weight) byKey.set(key, token)
  }
  return [...byKey.values()]
}
```

- [ ] **Step 4: Add failing EngineQuery requirement tests**

Modify `packages/core/src/context-engine/__tests__/call-graph.test.ts`:

```ts
it('context() uses mixed-language tokenizer for Chinese requests with English symbols', async () => {
  const ctx = await q.context('修复 service 调用 helper 的逻辑')
  const entryNames = ctx.entryPoints.map((entry) => entry.name)

  expect(entryNames).toContain('service')
  expect(entryNames).toContain('helper')
})

it('contextForRequirements() prioritizes related symbol and file hints', async () => {
  const ctx = await q.contextForRequirements({
    objective: '修复 helper 的调用',
    requirements: [{
      id: 'req_relevant_code',
      kind: 'relevant_code',
      reason: 'Need helper code.',
      query: '修复 helper 的调用',
      priority: 'must',
      relatedFiles: ['src/helper.ts'],
      relatedSymbols: ['helper'],
      docRefs: [],
      languageHints: [],
    }],
    maxNodes: 10,
    includeCode: true,
  })

  expect(ctx.entryPoints[0]?.name).toBe('helper')
  expect(ctx.keyCode.some((snippet) => snippet.file === 'src/helper.ts')).toBe(true)
})
```

- [ ] **Step 5: Run EngineQuery tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context-engine/query-tokenizer.test.ts src/context-engine/__tests__/call-graph.test.ts --no-file-parallelism
```

Expected: FAIL because `EngineQuery.context()` still uses ASCII splitting and `contextForRequirements()` does not exist.

- [ ] **Step 6: Add requirement query API**

Modify `packages/core/src/context-engine/query.ts`.

Add imports:

```ts
import { tokenizeQueryText, type QueryToken } from './query-tokenizer.js'
import type { ContextEvidenceRequirement } from '../context/types.js'
```

Add interfaces:

```ts
export interface RequirementContextInput {
  objective: string
  requirements: ContextEvidenceRequirement[]
  activeFile?: string
  changedFiles?: string[]
  languageHints?: string[]
  maxNodes?: number
  includeCode?: boolean
}
```

Replace the term extraction inside `context()`:

```ts
    const tokens = tokenizeQueryText(task)
    const entry = this.entrySymbolsForTokens(tokens, maxNodes)
```

Add `contextForRequirements()`:

```ts
  async contextForRequirements(input: RequirementContextInput): Promise<ContextResult> {
    const queryText = [
      input.objective,
      ...input.requirements.map((requirement) => requirement.query),
      ...(input.activeFile ? [input.activeFile] : []),
      ...(input.changedFiles ?? []),
      ...input.requirements.flatMap((requirement) => [
        ...requirement.relatedFiles,
        ...requirement.relatedSymbols,
        ...requirement.docRefs,
        ...requirement.languageHints,
      ]),
      ...(input.languageHints ?? []),
    ].join(' ')

    const tokens = tokenizeQueryText(queryText)
    const entry = this.entrySymbolsForTokens(tokens, input.maxNodes ?? 20)
    return this.contextFromEntry(queryText, entry, input.maxNodes ?? 20, input.includeCode !== false)
  }
```

Extract shared helpers from the old `context()` body:

```ts
  private entrySymbolsForTokens(tokens: QueryToken[], maxNodes: number): SymbolNode[] {
    const seen = new Set<string>()
    const entry: SymbolNode[] = []
    const sorted = [...tokens].sort((a, b) => b.weight - a.weight || b.value.length - a.value.length)

    for (const token of sorted) {
      for (const symbol of this.engine.searchSymbols(token.value, token.kind === 'symbol' ? 8 : 5)) {
        if (!seen.has(symbol.id)) {
          seen.add(symbol.id)
          entry.push(symbol)
        }
      }
      if (entry.length >= maxNodes) break
    }

    if (entry.length < maxNodes) {
      for (const token of sorted.filter((item) => item.kind === 'path')) {
        for (const file of this.engine.getStore().allFiles()) {
          if (!file.filePath.toLowerCase().includes(token.value.toLowerCase())) continue
          for (const symbol of file.symbols) {
            if (!seen.has(symbol.id)) {
              seen.add(symbol.id)
              entry.push(symbol)
            }
            if (entry.length >= maxNodes) break
          }
          if (entry.length >= maxNodes) break
        }
      }
    }

    return entry.slice(0, maxNodes)
  }

  private async contextFromEntry(task: string, entry: SymbolNode[], maxNodes: number, includeCode: boolean): Promise<ContextResult> {
    const related: SymbolNode[] = []
    const relSeen = new Set(entry.map((symbol) => symbol.id))
    for (const symbol of entry.slice(0, 5)) {
      for (const candidate of [...this.graph.callees(symbol.id), ...this.graph.callers(symbol.id)]) {
        if (!relSeen.has(candidate.id)) {
          relSeen.add(candidate.id)
          related.push(candidate)
        }
      }
    }

    const keyCode: { file: string; symbol: string; code: string }[] = []
    if (includeCode) {
      for (const symbol of entry.slice(0, 5)) {
        const code = await this.readSymbolSource(symbol)
        if (code) keyCode.push({ file: symbol.filePath, symbol: symbol.name, code })
      }
    }

    const [gitHotFiles, gitChanges] = await Promise.all([
      hotFiles(this.engine.cwd, 100, 10).catch(() => [] as GitHotFile[]),
      workingChanges(this.engine.cwd).catch(() => [] as GitChange[]),
    ])

    return {
      query: task,
      entryPoints: entry.slice(0, maxNodes).map(toLocation),
      related: related.slice(0, maxNodes).map(toLocation),
      keyCode,
      gitHotFiles,
      gitChanges,
    }
  }
```

Then make `context()` delegate:

```ts
  async context(task: string, maxNodes = 20, includeCode = true): Promise<ContextResult> {
    const tokens = tokenizeQueryText(task)
    const entry = this.entrySymbolsForTokens(tokens, maxNodes)
    return this.contextFromEntry(task, entry, maxNodes, includeCode)
  }
```

- [ ] **Step 7: Route JdcContext through the requirement-aware query**

Modify `packages/core/src/tools/context-engine-tools.ts` in `jdcContext.execute()`:

```ts
    const task = String(input.task)
    const res = await q.contextForRequirements({
      objective: task,
      requirements: [{
        id: 'tool_req_relevant_code',
        kind: 'relevant_code',
        reason: 'JdcContext requests relevant code for the provided task.',
        query: task,
        priority: 'must',
        relatedFiles: [],
        relatedSymbols: [],
        docRefs: [],
        languageHints: [],
      }],
      maxNodes: Number(input.maxNodes) || 20,
      includeCode: input.includeCode !== false,
    })
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context-engine/query-tokenizer.test.ts src/context-engine/__tests__/call-graph.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/context-engine/query-tokenizer.ts packages/core/src/context-engine/query-tokenizer.test.ts packages/core/src/context-engine/query.ts packages/core/src/context-engine/__tests__/call-graph.test.ts packages/core/src/tools/context-engine-tools.ts
git commit -m "feat(context-engine): add requirement-aware mixed-language queries"
```

---

## Task 4: Code Provider Warmup And Fallback Evidence

**Goal:** When the code index is missing, schedule background indexing automatically and return current-turn fallback evidence.

**Files:**

- Create: `packages/core/src/context/providers/code-fallback.ts`
- Create: `packages/core/src/context/providers/code-fallback.test.ts`
- Modify: `packages/core/src/context/providers/code-provider.ts`
- Modify: `packages/core/src/context/signal-providers.test.ts`
- Modify: `packages/core/src/tools/context-tools.test.ts`

- [ ] **Step 1: Add failing fallback collector tests**

Create `packages/core/src/context/providers/code-fallback.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectFallbackCodeEvidence } from './code-fallback.js'
import type { ContextEvidenceRequirement } from '../types.js'

const requirement: ContextEvidenceRequirement = {
  id: 'req_relevant_code',
  kind: 'relevant_code',
  reason: 'Need code.',
  query: '修复 backgroundTasks completion',
  priority: 'must',
  relatedFiles: ['packages/core/src/session.ts'],
  relatedSymbols: ['backgroundTasks'],
  docRefs: [],
  languageHints: ['typescript'],
}

describe('collectFallbackCodeEvidence', () => {
  it('returns matching files and snippets while the index warms', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-code-fallback-'))
    mkdirSync(path.join(cwd, 'packages/core/src'), { recursive: true })
    writeFileSync(path.join(cwd, 'packages/core/src/session.ts'), 'export const backgroundTasks = new Map()\n')

    const result = await collectFallbackCodeEvidence({ cwd, requirements: [requirement], now: () => 1_000 })

    expect(result.matches).toEqual([expect.objectContaining({
      file: 'packages/core/src/session.ts',
      reason: 'requirement_file_match',
    })])
    expect(result.content).toContain('backgroundTasks')
  })
})
```

- [ ] **Step 2: Add failing provider warmup test**

Modify `packages/core/src/context/signal-providers.test.ts`. Replace the cached-only unindexed provider test with:

```ts
it('schedules code index warmup and returns fallback code evidence when the engine is not indexed', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jdc-code-provider-warmup-'))
  mkdirSync(join(cwd, 'packages/core/src'), { recursive: true })
  writeFileSync(join(cwd, 'packages/core/src/session.ts'), 'export const backgroundTasks = new Map()\n')
  const releaseIndex = deferred<void>()
  const engine = {
    isIndexed: vi.fn(() => false),
    index: vi.fn(() => releaseIndex.promise),
  }

  const result = await collectCodeContext(request(cwd, {
    userMessage: '修复 packages/core/src/session.ts 里的 backgroundTasks',
    evidenceRequirements: [{
      id: 'req_relevant_code',
      kind: 'relevant_code',
      reason: 'Need code.',
      query: '修复 packages/core/src/session.ts 里的 backgroundTasks',
      priority: 'must',
      relatedFiles: ['packages/core/src/session.ts'],
      relatedSymbols: ['backgroundTasks'],
      docRefs: [],
      languageHints: [],
    }],
  }), {
    contextEngine: engine as any,
  })

  expect(result.health).toMatchObject({ id: 'code', status: 'indexing', backgroundJob: { status: 'queued' } })
  expect(result.sections.some((section) => section.kind === 'relevant_code' && section.content.includes('backgroundTasks'))).toBe(true)
  expect(result.evidence.some((item) => item.metadata.file === 'packages/core/src/session.ts')).toBe(true)
  expect(engine.index).not.toHaveBeenCalled()

  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(engine.index).toHaveBeenCalledTimes(1)
  releaseIndex.resolve()
  await releaseIndex.promise
})
```

- [ ] **Step 3: Update refresh-tool expectations**

Modify `packages/core/src/tools/context-tools.test.ts`:

```ts
it('refresh collects fallback code and starts warmup for an unindexed code provider', async () => {
  const releaseIndex = deferred<void>()
  const engine = {
    isIndexed: vi.fn(() => false),
    index: vi.fn(() => releaseIndex.promise),
  }
  const codeProvider = vi.fn((request) => collectCodeContext(request, { contextEngine: engine as any }))
  const store = makeStore()

  const payload = await refreshContextProviders({ sessionId: 'session_1', cwd: '/repo', providers: ['code'] }, {
    store,
    providers: [{ id: 'code', collect: codeProvider }],
    now: () => 3_000,
    id: () => 'ctx_refresh_indexing',
  })

  expect(ContextRefreshPayloadSchema.parse(payload).providerHealth[0]).toMatchObject({ id: 'code', status: 'indexing' })
  expect(codeProvider).toHaveBeenCalledTimes(1)
  expect(engine.index).not.toHaveBeenCalled()

  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(engine.index).toHaveBeenCalledTimes(1)
  releaseIndex.resolve()
})
```

Keep the health-only test unchanged: `getContextProviderHealth()` must stay read-only and must not start indexing.

- [ ] **Step 4: Run tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/providers/code-fallback.test.ts src/context/signal-providers.test.ts src/tools/context-tools.test.ts --no-file-parallelism
```

Expected: FAIL because fallback collection and automatic warmup are not implemented.

- [ ] **Step 5: Implement fallback collector**

Create `packages/core/src/context/providers/code-fallback.ts`:

```ts
import path from 'node:path'
import { scanProject, readFileSafe } from '../../context-engine/indexer/scanner.js'
import { tokenizeQueryText } from '../../context-engine/query-tokenizer.js'
import type { ContextEvidenceRequirement } from '../types.js'

export interface FallbackCodeMatch {
  file: string
  reason: 'requirement_file_match' | 'requirement_symbol_match' | 'query_text_match'
  line?: number
  preview: string
}

export interface FallbackCodeEvidenceResult {
  content: string
  matches: FallbackCodeMatch[]
}

export async function collectFallbackCodeEvidence(options: {
  cwd: string
  requirements: ContextEvidenceRequirement[]
  query?: string
  maxFiles?: number
  maxMatches?: number
  now?: () => number
}): Promise<FallbackCodeEvidenceResult> {
  const maxMatches = options.maxMatches ?? 8
  const files = await scanProject(options.cwd, options.maxFiles ?? 1_000)
  const terms = buildFallbackTerms(options.requirements, options.query ?? '')
  const matches: FallbackCodeMatch[] = []

  for (const file of files) {
    const fileKey = file.relPath.toLowerCase()
    const fileRequirement = options.requirements.find((requirement) => requirement.relatedFiles.some((related) => normalize(related) === fileKey || fileKey.endsWith(normalize(related))))
    if (fileRequirement) {
      const content = await readFileSafe(path.join(options.cwd, file.relPath))
      matches.push({ file: file.relPath, reason: 'requirement_file_match', line: 1, preview: preview(content ?? '') })
      if (matches.length >= maxMatches) break
      continue
    }

    const content = await readFileSafe(path.join(options.cwd, file.relPath))
    if (!content) continue
    const lineMatch = firstMatchingLine(content, terms)
    if (lineMatch) {
      matches.push({ file: file.relPath, reason: lineMatch.reason, line: lineMatch.line, preview: lineMatch.preview })
      if (matches.length >= maxMatches) break
    }
  }

  return {
    matches,
    content: matches.length
      ? ['Fallback code matches while index warms:', ...matches.map((match) => `- ${match.file}${match.line ? `:${match.line}` : ''} (${match.reason}) ${match.preview}`)].join('\n')
      : 'Code index is warming; fallback scan found no direct code matches for this turn.',
  }
}

function buildFallbackTerms(requirements: ContextEvidenceRequirement[], query: string): Array<{ value: string; reason: FallbackCodeMatch['reason'] }> {
  const terms: Array<{ value: string; reason: FallbackCodeMatch['reason'] }> = []
  for (const requirement of requirements) {
    terms.push(...requirement.relatedSymbols.map((value) => ({ value, reason: 'requirement_symbol_match' as const })))
    terms.push(...tokenizeQueryText(requirement.query).map((token) => ({ value: token.value, reason: 'query_text_match' as const })))
  }
  terms.push(...tokenizeQueryText(query).map((token) => ({ value: token.value, reason: 'query_text_match' as const })))
  return dedupeTerms(terms.filter((term) => term.value.length > 1))
}

function firstMatchingLine(content: string, terms: Array<{ value: string; reason: FallbackCodeMatch['reason'] }>): FallbackCodeMatch | null {
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const lower = lines[index].toLowerCase()
    const match = terms.find((term) => lower.includes(term.value.toLowerCase()))
    if (match) return { file: '', reason: match.reason, line: index + 1, preview: lines[index].trim().slice(0, 180) }
  }
  return null
}

function preview(content: string): string {
  return content.split('\n').find((line) => line.trim())?.trim().slice(0, 180) ?? ''
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

function dedupeTerms(terms: Array<{ value: string; reason: FallbackCodeMatch['reason'] }>): Array<{ value: string; reason: FallbackCodeMatch['reason'] }> {
  const seen = new Set<string>()
  const out: Array<{ value: string; reason: FallbackCodeMatch['reason'] }> = []
  for (const term of terms) {
    const key = term.value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}
```

Fix the `firstMatchingLine()` call site so the file path is set:

```ts
      matches.push({ file: file.relPath, reason: lineMatch.reason, line: lineMatch.line, preview: lineMatch.preview })
```

- [ ] **Step 6: Use fallback in code provider and auto-schedule warmup**

Modify `packages/core/src/context/providers/code-provider.ts`.

Add import:

```ts
import { collectFallbackCodeEvidence } from './code-fallback.js'
```

Replace the unindexed branch:

```ts
    if (!engine.isIndexed()) {
      const indexJob = ensureCodeIndexJob(request.cwd, engine, nowFromRequest(request), options.scheduler)
      return unindexedProviderResult(request, indexJob, await collectFallbackCodeEvidence({
        cwd: request.cwd,
        requirements: request.evidenceRequirements ?? [],
        query: request.userMessage,
      }))
    }
```

Change `unindexedProviderResult()` signature:

```ts
function unindexedProviderResult(request: ContextRequest, job: CodeIndexJob | undefined, fallback?: Awaited<ReturnType<typeof collectFallbackCodeEvidence>>) {
```

Inside `unindexedProviderResult()` create fallback evidence and section when matches exist:

```ts
  const fallbackEvidence = (fallback?.matches ?? []).map((match) => rawEvidence(
    request,
    SOURCE,
    'file',
    match.preview,
    { file: match.file, line: match.line, fallback: true, reason: match.reason },
    createdAt,
  ))
  const fallbackCitations = fallbackEvidence.map((item) => citationFor(item, String(item.metadata.file ?? item.id), typeof item.metadata.line === 'number' ? item.metadata.line : undefined))
  const fallbackSections = fallback && fallback.matches.length
    ? [section(
      [request.sessionId, SOURCE, request.userMessage, 'fallback'],
      'relevant_code',
      'Fallback code matches',
      fallback.content,
      fallbackCitations,
      65,
      0.55,
      'live',
      SOURCE,
      { authority: 'code_evidence', topic: 'code', conflictPolicy: 'render' },
    )]
    : []
```

Return those arrays:

```ts
    evidence: fallbackEvidence,
    sections: fallbackSections,
```

Update the diagnostic message so normal unindexed foreground collection says:

```ts
: 'Code index is warming in the background. Fallback code evidence was collected for this turn.'
```

- [ ] **Step 7: Keep health-only read-only**

Do not change `getCodeProviderHealth()` to start indexing. It should continue returning `not_indexed` when no job exists. The product distinction is:

- `collectCodeContext()` schedules warmup because foreground retrieval needs code evidence.
- `getCodeProviderHealth()` reports health only and does not mutate background state.

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/providers/code-fallback.test.ts src/context/signal-providers.test.ts src/tools/context-tools.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/context/providers/code-fallback.ts packages/core/src/context/providers/code-fallback.test.ts packages/core/src/context/providers/code-provider.ts packages/core/src/context/signal-providers.test.ts packages/core/src/tools/context-tools.test.ts
git commit -m "feat(context): warm code index with fallback evidence"
```

---

## Task 5: Repo Map V1

**Goal:** Build a compact repo map from the existing code index and expose it through requirement-aware code context.

**Files:**

- Create: `packages/core/src/context-engine/repo-map.ts`
- Create: `packages/core/src/context-engine/repo-map.test.ts`
- Modify: `packages/core/src/context-engine/query.ts`
- Modify: `packages/core/src/context/providers/code-provider.ts`
- Modify: `packages/core/src/context/signal-providers.test.ts`

- [ ] **Step 1: Add failing repo map tests**

Create `packages/core/src/context-engine/repo-map.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { IndexStore } from './graph/store.js'
import { buildRepoMap } from './repo-map.js'

describe('buildRepoMap', () => {
  it('classifies source files, tests, entry points, and symbols', () => {
    const store = new IndexStore()
    store.upsertFile({
      filePath: 'src/main.ts',
      language: 'typescript',
      hash: 'main',
      symbols: [{ id: 'src/main.ts#main@1', name: 'main', kind: 'function', filePath: 'src/main.ts', line: 1, column: 1, startLine: 1, endLine: 3, signature: 'export function main()' }],
      references: [],
      imports: [{ localName: 'helper', source: './helper', filePath: 'src/main.ts', line: 1 }],
    })
    store.upsertFile({
      filePath: 'src/main.test.ts',
      language: 'typescript',
      hash: 'test',
      symbols: [{ id: 'src/main.test.ts#main test@1', name: 'main test', kind: 'function', filePath: 'src/main.test.ts', line: 1, column: 1, startLine: 1, endLine: 3 }],
      references: [],
      imports: [],
    })

    const map = buildRepoMap(store, { objective: 'main helper', maxFiles: 10 })

    expect(map.files).toEqual([
      expect.objectContaining({ path: 'src/main.ts', role: 'entrypoint' }),
      expect.objectContaining({ path: 'src/main.test.ts', role: 'test' }),
    ])
    expect(map.symbols).toContainEqual(expect.objectContaining({ name: 'main', file: 'src/main.ts' }))
    expect(map.importEdges).toContainEqual({ from: 'src/main.ts', to: './helper', localName: 'helper' })
  })
})
```

- [ ] **Step 2: Run repo map test and verify it fails**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context-engine/repo-map.test.ts --no-file-parallelism
```

Expected: FAIL because `repo-map.ts` does not exist.

- [ ] **Step 3: Implement repo map builder**

Create `packages/core/src/context-engine/repo-map.ts`:

```ts
import type { IndexStore } from './graph/store.js'
import { tokenizeQueryText } from './query-tokenizer.js'

export type RepoMapFileRole = 'entrypoint' | 'source' | 'test' | 'config' | 'doc'

export interface RepoMapFile {
  path: string
  language: string
  role: RepoMapFileRole
  symbolCount: number
}

export interface RepoMapSymbol {
  name: string
  kind: string
  file: string
  line: number
  signature?: string
}

export interface RepoMapImportEdge {
  from: string
  to: string
  localName: string
}

export interface RepoMap {
  files: RepoMapFile[]
  symbols: RepoMapSymbol[]
  importEdges: RepoMapImportEdge[]
}

export function buildRepoMap(store: IndexStore, options: { objective?: string; maxFiles?: number; maxSymbols?: number } = {}): RepoMap {
  const queryTokens = tokenizeQueryText(options.objective ?? '').map((token) => token.value.toLowerCase())
  const files = store.allFiles()
    .map((file) => ({
      file,
      score: scoreFile(file.filePath, queryTokens),
    }))
    .sort((a, b) => b.score - a.score || a.file.filePath.localeCompare(b.file.filePath))
    .slice(0, options.maxFiles ?? 80)

  const selectedFiles = new Set(files.map((item) => item.file.filePath))
  const symbols = files
    .flatMap((item) => item.file.symbols.map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.filePath,
      line: symbol.line,
      signature: symbol.signature,
    })))
    .slice(0, options.maxSymbols ?? 160)

  const importEdges = store.allFiles()
    .filter((file) => selectedFiles.has(file.filePath))
    .flatMap((file) => file.imports.map((binding) => ({
      from: file.filePath,
      to: binding.source,
      localName: binding.localName,
    })))
    .slice(0, 160)

  return {
    files: files.map((item) => ({
      path: item.file.filePath,
      language: item.file.language,
      role: classifyFileRole(item.file.filePath),
      symbolCount: item.file.symbols.length,
    })),
    symbols,
    importEdges,
  }
}

export function renderRepoMap(map: RepoMap): string {
  const parts: string[] = []
  if (map.files.length) {
    parts.push('Files:\n' + map.files.map((file) => `- ${file.path} (${file.role}, ${file.language}, ${file.symbolCount} symbols)`).join('\n'))
  }
  if (map.symbols.length) {
    parts.push('Symbols:\n' + map.symbols.map((symbol) => `- ${symbol.kind} ${symbol.name} - ${symbol.file}:${symbol.line}${symbol.signature ? ` ${symbol.signature}` : ''}`).join('\n'))
  }
  if (map.importEdges.length) {
    parts.push('Imports:\n' + map.importEdges.map((edge) => `- ${edge.from} imports ${edge.localName} from ${edge.to}`).join('\n'))
  }
  return parts.join('\n\n')
}

function classifyFileRole(filePath: string): RepoMapFileRole {
  const lower = filePath.toLowerCase()
  if (/\b(readme|agents|jdcagnet|contributing|changelog|design|plan)\.md$/.test(lower)) return 'doc'
  if (/\b(package|tsconfig|vite|vitest|eslint|prettier|rollup|webpack|next)\b/.test(lower)) return 'config'
  if (/(^|[./_-])(test|spec)\.[^.]+$|__tests__/.test(lower)) return 'test'
  if (/(^|\/)(main|index|app|server|cli)\.[^.]+$/.test(lower)) return 'entrypoint'
  return 'source'
}

function scoreFile(filePath: string, queryTokens: string[]): number {
  const lower = filePath.toLowerCase()
  let score = classifyFileRole(filePath) === 'entrypoint' ? 20 : 0
  for (const token of queryTokens) {
    if (lower.includes(token)) score += 30
  }
  return score
}
```

- [ ] **Step 4: Add repo map to context results**

Modify `packages/core/src/context-engine/query.ts`.

Import:

```ts
import { buildRepoMap, type RepoMap } from './repo-map.js'
```

Extend `ContextResult`:

```ts
  repoMap?: RepoMap
```

Inside `contextFromEntry()` before return:

```ts
    const repoMap = buildRepoMap(this.engine.getStore(), { objective: task })
```

Return it:

```ts
      repoMap,
```

- [ ] **Step 5: Render repo map in code provider**

Modify `packages/core/src/context/providers/code-provider.ts`.

Import:

```ts
import { renderRepoMap } from '../../context-engine/repo-map.js'
```

When building `contentParts`, add:

```ts
    if (result.repoMap && (request.evidenceRequirements ?? []).some((requirement) => requirement.kind === 'repo_map' || requirement.priority === 'must')) {
      contentParts.push(`Repo map:\n${renderRepoMap(result.repoMap)}`)
    }
```

Add a separate `code_map` section for repo map:

```ts
    const repoMapSection = result.repoMap
      ? section(
        [request.sessionId, SOURCE, request.userMessage, 'repo_map'],
        'code_map',
        'Repo map',
        renderRepoMap(result.repoMap),
        [],
        55,
        0.8,
        'live',
        SOURCE,
        { authority: 'code_evidence', topic: 'code', conflictPolicy: 'render' },
      )
      : undefined
```

Append it to returned sections after the relevant code section:

```ts
    const sections = [
      ...relevantCodeSections,
      ...(repoMapSection ? [repoMapSection] : []),
    ]
```

Use a local `relevantCodeSections` variable for the existing `relevant_code` section so this stays clear.

- [ ] **Step 6: Add provider repo map test**

Modify `packages/core/src/context/signal-providers.test.ts`:

```ts
it('returns repo map section from indexed code context', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jdc-code-provider-repo-map-'))
  mkdirSync(join(cwd, 'src'), { recursive: true })
  writeFileSync(join(cwd, 'src', 'main.ts'), 'export function main() { return true }\n')
  const engine = new ContextEngine(cwd)
  await engine.index()

  const result = await collectCodeContext(request(cwd, {
    userMessage: '写 phase4 计划',
    evidenceRequirements: [{
      id: 'req_repo_map',
      kind: 'repo_map',
      reason: 'Need repository structure.',
      query: '写 phase4 计划',
      priority: 'should',
      relatedFiles: [],
      relatedSymbols: [],
      docRefs: [],
      languageHints: [],
    }],
  }), {
    contextEngine: engine,
  })

  expect(result.sections.some((section) => section.kind === 'code_map' && section.content.includes('src/main.ts'))).toBe(true)
})
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context-engine/repo-map.test.ts src/context-engine/__tests__/call-graph.test.ts src/context/signal-providers.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/context-engine/repo-map.ts packages/core/src/context-engine/repo-map.test.ts packages/core/src/context-engine/query.ts packages/core/src/context/providers/code-provider.ts packages/core/src/context/signal-providers.test.ts
git commit -m "feat(context-engine): expose repo map v1"
```

---

## Task 6: Product Evals And Design Decision

**Goal:** Add product-level regression coverage for the Phase 4 user outcomes and record the implementation decision in the design document.

**Files:**

- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

- [ ] **Step 1: Add product eval for Chinese query retrieval**

Modify `packages/core/src/context/context-product-evals.test.ts`:

```ts
it('Phase 4 eval: Chinese code request retrieves English path and symbol evidence', async () => {
  const cwd = tempProject()
  mkdirSync(path.join(cwd, 'packages/core/src'), { recursive: true })
  writeFileSync(path.join(cwd, 'packages/core/src/session.ts'), 'export function recordBackgroundShellCompletion() { return true }\n')
  const store = await openContextStore({ cwd, now: () => 1_000 })

  const result = await buildContextBundle(request({
    cwd,
    userMessage: '修复 packages/core/src/session.ts 里的 recordBackgroundShellCompletion',
  }), {
    injectionEnabled: true,
    includeAgentContract: true,
    store,
    providers: [{
      id: 'code',
      collect: (req) => collectCodeContext(req),
    }],
    providerTimeoutMs: 1_000,
    id: () => 'ctx_phase4_chinese_code',
  })

  expect(result.renderedPrompt).toContain('recordBackgroundShellCompletion')
  expect(result.bundle.sections.some((section) => section.kind === 'relevant_code')).toBe(true)
  expect(result.bundle.diagnostics.map((item) => item.message).join('\n')).not.toContain('Missing relevant_code evidence')
})
```

Add imports if missing:

```ts
import { collectCodeContext } from './providers/code-provider.js'
```

- [ ] **Step 2: Add product eval for automatic warmup**

Add another test in the same file:

```ts
it('Phase 4 eval: missing code index schedules warmup and returns fallback evidence', async () => {
  const cwd = tempProject()
  mkdirSync(path.join(cwd, 'packages/core/src'), { recursive: true })
  writeFileSync(path.join(cwd, 'packages/core/src/session.ts'), 'export const backgroundTasks = new Map()\n')
  const store = await openContextStore({ cwd, now: () => 1_000 })
  const releaseIndex = deferred<void>()
  const engine = {
    isIndexed: vi.fn(() => false),
    index: vi.fn(() => releaseIndex.promise),
  }

  const result = await buildContextBundle(request({
    cwd,
    userMessage: '修复 packages/core/src/session.ts 里的 backgroundTasks',
  }), {
    injectionEnabled: true,
    store,
    providers: [{
      id: 'code',
      collect: (req) => collectCodeContext(req, { contextEngine: engine as any }),
    }],
    providerTimeoutMs: 1_000,
    id: () => 'ctx_phase4_warmup',
  })

  expect(result.providerHealth[0]).toMatchObject({ id: 'code', status: 'indexing' })
  expect(result.renderedPrompt).toContain('backgroundTasks')
  expect(engine.index).not.toHaveBeenCalled()

  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(engine.index).toHaveBeenCalledTimes(1)
  releaseIndex.resolve()
})
```

If `deferred()` is not already available in this test file, add:

```ts
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
```

- [ ] **Step 3: Add product eval for repo map**

Add:

```ts
it('Phase 4 eval: repo map section summarizes indexed files and symbols', async () => {
  const cwd = tempProject()
  mkdirSync(path.join(cwd, 'src'), { recursive: true })
  writeFileSync(path.join(cwd, 'src', 'main.ts'), 'export function main() { return true }\n')
  const store = await openContextStore({ cwd, now: () => 1_000 })

  const result = await buildContextBundle(request({
    cwd,
    userMessage: '写一个实现计划，先看项目结构',
    mode: 'plan',
  }), {
    injectionEnabled: true,
    store,
    providers: [{
      id: 'code',
      collect: (req) => collectCodeContext(req),
    }],
    id: () => 'ctx_phase4_repo_map',
  })

  expect(result.bundle.sections.some((section) => section.kind === 'code_map' && section.content.includes('src/main.ts'))).toBe(true)
})
```

- [ ] **Step 4: Run product eval tests and verify they fail or expose integration gaps**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected before integration fixes: any failure points to missing wiring from earlier tasks. After earlier tasks are complete, this command must pass.

- [ ] **Step 5: Update the design document**

Modify `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md` near the implementation decision notes:

```md
Phase 4 implementation decision:

- Evidence requirements are derived before provider collection and stored on `ContextRequest.evidenceRequirements`.
- `planContext()` still owns final `missingEvidence`, computed by comparing those requirements against returned sections.
- Code retrieval uses `EngineQuery.contextForRequirements()` with a shared tokenizer that preserves CJK n-grams, path-like hints, symbol-like hints, and quoted terms.
- When the code index is missing, foreground code collection schedules a background warmup job and returns fallback code evidence from project file scans. Health-only inspection remains read-only.
- Repo map v1 is derived from the existing `IndexStore`; Repo Wiki remains deferred.
- Stop/TurnEnd verification enforcement remains Phase 5.
```

- [ ] **Step 6: Run focused eval and docs check**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
git diff --check -- docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/context-product-evals.test.ts docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md
git commit -m "test(context): add phase 4 retrieval evals"
```

---

## Task 7: Final Integration Gate

**Goal:** Verify Phase 4 as an integrated product slice and leave the branch in a reviewable state.

**Files:**

- Review all files touched by Tasks 1-6.

- [ ] **Step 1: Run Phase 4 focused suite**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/retrieval-requirements.test.ts src/context/context-planner.test.ts src/context/context-retriever.test.ts src/context/context-orchestrator.test.ts src/context-engine/query-tokenizer.test.ts src/context-engine/repo-map.test.ts src/context-engine/__tests__/call-graph.test.ts src/context/providers/code-fallback.test.ts src/context/signal-providers.test.ts src/tools/context-tools.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
pnpm --filter @jdcagnet/core build
```

Expected: PASS.

- [ ] **Step 3: Run full core test suite**

Run:

```bash
pnpm --filter @jdcagnet/core test -- --run --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Review final diff**

Run:

```bash
git diff --stat HEAD~6..HEAD
git log --oneline -n 8
```

Expected: the diff contains only Phase 4 retrieval, index warmup, repo map, eval, and design-doc changes. Recent commits include the six task commits from this plan.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on the implementation branch, ahead by the Phase 4 commits.
