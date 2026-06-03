# JDC Context Engine V2 Phase 4 Team Ledger Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Team Mode a first-class JDC Context Engine producer so durable PM decisions, worker results, artifacts, contracts, and QA issues become project-level context that later sessions can retrieve.

**Architecture:** Add a focused team ledger module that turns structured Team runtime events and `team_artifact` writes into cited raw evidence and selected durable facts. The ledger is fail-open, project-local, and deterministic for already-structured Team outputs; harvest distillers are added for Team-origin runLoop candidates but normal Team event ingestion must not spawn a model call for every event.

**Tech Stack:** TypeScript, Vitest, existing sql.js `ContextStore`, `RawEvidence`/`ContextFact`, TeamRuntime, TeamWorkspace, `team_artifact`, existing harvest/distiller contracts.

---

## Phase 4 Scope

This plan implements Phase 4 from `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-master-roadmap.md`.

It adds:

- explicit Team fact kinds: `team_decision`, `task_result`, `artifact_summary`, `qa_issue`;
- Team ledger evidence/fact helpers;
- fail-open TeamRuntime event evidence capture;
- fail-open `team_artifact` artifact/contract/issue/result evidence capture;
- deterministic distillers for Team ledger harvest decisions;
- retrieval/eval tests proving Team outputs are reusable across same-project sessions.

It does not implement Phase 5 workflow detection, Phase 6 Chinese UI changes, or Phase 7 performance dashboards.

## Hard Product Contracts

- Do not rename `JDC Context Engine`.
- Do not move persistence out of `<project>/.jdcagnet/context-engine/context.db`.
- Do not make Team context session-isolated. `sessionId`, `teamId`, `memberId`, and `taskId` are provenance and ranking signals, not storage filters.
- Do not leak facts across different project roots.
- Do not store raw hidden reasoning.
- Do not store raw PM/worker logs as durable facts.
- Do not trigger a model harvest for every Team event.
- Do not block Team execution if Context Engine is unavailable.
- Do not add default token/fact/memory caps.
- Only high-signal, citation-backed Team outputs become accepted facts.
- Failed/no-op diagnostics must not appear as primary user memory.

## File Structure

- Create: `packages/core/src/context/team-ledger.ts`
- Create: `packages/core/src/context/team-ledger.test.ts`
- Create: `packages/core/src/context/distillers/team-ledger-distiller.ts`
- Create: `packages/core/src/context/distillers/artifact-summary-distiller.ts`
- Create: `packages/core/src/context/distillers/qa-issue-distiller.ts`
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Modify: `packages/core/src/context/retriever.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/context/harvest-router.ts`
- Modify: `packages/core/src/context/harvest-router.test.ts`
- Modify: `packages/core/src/context/distillers/index.ts`
- Modify: `packages/core/src/team/team-runtime.ts`
- Modify: `packages/core/src/team/team-member.ts`
- Modify: `packages/core/src/team/team-workspace.ts`
- Modify: `packages/core/src/tools/team-artifact.ts`
- Modify: `packages/core/src/team/__tests__/team-runtime.test.ts`
- Modify: `packages/core/src/team/__tests__/team-tools.test.ts`
- Modify: `packages/core/src/context/context-product-evals.test.ts`

## Team Fact Contract

Add these `ContextFactKind` values:

```ts
'team_decision' | 'task_result' | 'artifact_summary' | 'qa_issue'
```

Mapping:

- `team_decision`: durable PM/user decisions that affect project direction.
- `task_result`: completed Team task result summary.
- `artifact_summary`: structured worker artifact/contract summary.
- `qa_issue`: open or in-progress QA issue; resolved issues update the same fact to `freshness='stale'`.

All Team facts must include:

- `origin.projectKey`
- `origin.actor`
- `origin.sessionId`
- `origin.teamId`
- `origin.memberId` when worker-produced
- `origin.taskId` when task-scoped
- `origin.artifactId` for artifact/contract/issue/result facts where applicable
- citations to `.team/...` files or Team event evidence refs
- `tags` containing stable machine-readable tags such as `team`, `team_issue`, `team_artifact`, `team_result`
- `relatedTasks`
- `relatedFiles` containing `.team/...` paths

## Team Evidence Contract

Create raw evidence records for these event types:

- `team_started`
- `manager_decision`
- `task_created`
- `task_assigned`
- `team_artifact_written`
- `team_contract_written`
- `team_issue_created`
- `team_issue_resolved`
- `task_completed`
- `team_completed`
- `team_failed`

Raw evidence can be verbose enough for inspection, but durable facts must be concise and high-signal.

## Dependencies

Tasks must be done in order:

1. Types/schemas and red tests.
2. Team ledger module.
3. TeamRuntime event capture.
4. `team_artifact` capture.
5. Harvest router/distillers.
6. Product evals and final verification.

Do not wire runtime callers before the ledger module has tests. Do not introduce model calls in runtime event capture.

---

### Task 1: Add Team Fact Kinds And Payload Schemas

**Files:**
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Modify: `packages/core/src/context/retriever.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Create: `packages/core/src/context/team-ledger.test.ts`

- [ ] **Step 1: Write failing team fact schema test**

Create `packages/core/src/context/team-ledger.test.ts` with tests that construct `ContextFact` objects for:

```ts
const teamDecision = {
  id: 'team_decision_team_alpha_1',
  kind: 'team_decision',
  scope: 'project',
  content: 'PM decision: checkout API keeps the existing response envelope.',
  citations: [{ id: 'cit_team_log', type: 'task', ref: '.team/log.md' }],
  confidence: 0.9,
  freshness: 'recent',
  sourceProvider: 'TeamLedger',
  createdAt: 1_000,
  updatedAt: 1_000,
  origin: { projectKey: '/repo', actor: 'team_pm', sessionId: 'session_a', teamId: 'team_alpha' },
  tags: ['team', 'team_decision'],
  relatedTasks: ['task_checkout'],
  relatedFiles: ['.team/log.md'],
}
```

Also cover `task_result`, `artifact_summary`, and `qa_issue`. Assert `ContextFactSchema.safeParse(fact).success` is true and that `sectionKindFromFact` through `buildContextBundle()` renders these facts into project/memory context sections.

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/team-ledger.test.ts --no-file-parallelism
```

Expected: FAIL because schemas and renderer mappings do not know the new kinds.

- [ ] **Step 3: Add fact kind types and schemas**

Update `packages/core/src/context/types.ts`:

```ts
export type ContextFactKind =
  | 'project_profile'
  | 'architecture_decision'
  | 'module_boundary'
  | 'user_preference'
  | 'current_goal'
  | 'runtime_error_chain'
  | 'code_entrypoint'
  | 'known_issue'
  | 'project_convention'
  | 'workflow_rule'
  | 'team_decision'
  | 'task_result'
  | 'artifact_summary'
  | 'qa_issue'
```

Extend `AUTO_ACCEPT_CONTEXT_FACT_KINDS` with:

```ts
'team_decision', 'task_result', 'artifact_summary', 'qa_issue'
```

Update `ContextFactKindSchema` in `schemas.ts` with the same values.

- [ ] **Step 4: Add payload schemas**

Add these schemas in `schemas.ts`:

```ts
export const TeamLedgerPayloadSchema = z.object({
  kind: z.enum(['team_decision', 'task_result']),
  summary: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  taskId: z.string().optional(),
  memberId: z.string().optional(),
  confidence: confidenceSchema.optional(),
})

export const ArtifactSummaryPayloadSchema = z.object({
  artifactId: nonEmptyStringSchema,
  summary: nonEmptyStringSchema,
  artifactType: z.string().optional(),
  teamId: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema.optional(),
  memberId: nonEmptyStringSchema.optional(),
  confidence: confidenceSchema.optional(),
})

export const QaIssuePayloadSchema = z.object({
  issueId: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  status: z.enum(['open', 'in_progress', 'resolved', 'wontfix']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema.optional(),
  confidence: confidenceSchema.optional(),
})
```

- [ ] **Step 5: Update retrieval/orchestrator mappings**

In `retriever.ts`, include `team_decision`, `task_result`, `artifact_summary`, and open `qa_issue` in high-value kinds. Keep stale `qa_issue` suppressible so resolved issues do not stay injected.

In `orchestrator.ts`, map:

- `team_decision`, `task_result`, `artifact_summary` -> `project_profile`
- `qa_issue` -> `memory`

Set priorities:

- `team_decision`: 75
- `task_result`: 72
- `artifact_summary`: 68
- `qa_issue`: 76

- [ ] **Step 6: Verify tests pass**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/team-ledger.test.ts src/context/context-orchestrator.test.ts src/context/context-retriever.test.ts --no-file-parallelism
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/schemas.ts packages/core/src/context/retriever.ts packages/core/src/context/orchestrator.ts packages/core/src/context/team-ledger.test.ts
git commit -m "feat(context): add team context fact kinds"
```

---

### Task 2: Implement Team Ledger Evidence Producer

**Files:**
- Create: `packages/core/src/context/team-ledger.ts`
- Modify: `packages/core/src/context/team-ledger.test.ts`

- [ ] **Step 1: Write failing producer tests**

Add tests proving:

- `recordTeamEventEvidence()` saves raw evidence for `team_started`, `task_created`, `task_assigned`, `task_completed`, `team_completed`, and `team_failed`;
- durable `manager_decision` only saves a `team_decision` fact when the text is durable, not status chatter like `PM 思考中`;
- `recordTeamArtifactEvidence()` saves `artifact_summary`;
- `recordTeamIssueEvidence(status='open')` saves a recent `qa_issue`;
- `recordTeamIssueEvidence(status='resolved')` updates the same deterministic issue fact to `freshness='stale'`.

Use a fake store:

```ts
const store = {
  saveRawEvidence: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
  saveFact: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
  saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
}
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/team-ledger.test.ts --no-file-parallelism
```

Expected: FAIL because `team-ledger.ts` does not exist.

- [ ] **Step 3: Implement ledger module**

Create `packages/core/src/context/team-ledger.ts` exporting:

```ts
export interface TeamLedgerContext {
  store?: Pick<ContextStore, 'saveRawEvidence' | 'saveFact' | 'saveDiagnostic'>
  cwd: string
  sessionId?: string
  teamId: string
  now?: () => number
  id?: () => string
}

export async function recordTeamEventEvidence(event: TeamEvent, context: TeamLedgerContext): Promise<void>
export async function recordTeamArtifactEvidence(input: TeamArtifactEvidenceInput, context: TeamLedgerContext): Promise<void>
export async function recordTeamIssueEvidence(input: TeamIssueEvidenceInput, context: TeamLedgerContext): Promise<void>
export async function recordTeamTaskResultEvidence(input: TeamTaskResultEvidenceInput, context: TeamLedgerContext): Promise<void>
```

Implementation rules:

- If `context.store` is undefined, return without throwing.
- Catch and persist diagnostics; never throw to Team runtime.
- `projectKey = path.resolve(context.cwd)`.
- Evidence ids are deterministic enough for replace/update:
  - `team_event_${teamId}_${event.type}_${hash}`
  - `team_artifact_${teamId}_${taskId}_${artifactId}`
  - `team_issue_${teamId}_${issueId}`
  - `team_result_${teamId}_${taskId}`
- Fact ids:
  - `team_decision_${teamId}_${hash}`
  - `artifact_summary_${teamId}_${taskId}_${artifactId}`
  - `qa_issue_${teamId}_${issueId}`
  - `task_result_${teamId}_${taskId}`
- Citations use `type:'task'` and `.team/...` refs.
- Redact content through existing redaction helpers if needed.

- [ ] **Step 4: Verify producer tests pass**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/team-ledger.test.ts --no-file-parallelism
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/team-ledger.ts packages/core/src/context/team-ledger.test.ts
git commit -m "feat(context): capture team ledger evidence"
```

---

### Task 3: Wire TeamRuntime Event Capture

**Files:**
- Modify: `packages/core/src/team/team-runtime.ts`
- Modify: `packages/core/src/team/__tests__/team-runtime.test.ts`
- Modify: `packages/core/src/context/team-ledger.test.ts`

- [ ] **Step 1: Write failing TeamRuntime test**

Add a TeamRuntime test that creates a fake `contextEngine.store`, starts a small team, and asserts:

- `saveRawEvidence` receives `team_started`;
- `saveRawEvidence` receives `task_created` or `task_assigned`;
- Team still completes when `saveRawEvidence` rejects.

Use the existing mocked `runSubSession()` in `team-runtime.test.ts`.

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/team/__tests__/team-runtime.test.ts --no-file-parallelism
```

Expected: FAIL because TeamRuntime does not call the ledger.

- [ ] **Step 3: Wire `recordEvent()`**

In `TeamRuntime.recordEvent(event)`, after adding to the ring buffer and before/after external callback, call:

```ts
void recordTeamEventEvidence(event, {
  store: this.opts.subSessionDeps.contextEngine?.store,
  cwd: this.opts.subSessionDeps.cwd,
  sessionId: this.opts.subSessionDeps.contextEngine?.sessionId,
  teamId: this.id,
}).catch(() => undefined)
```

Do not await this call. Team runtime must stay responsive.

- [ ] **Step 4: Add task result evidence**

In completion paths where `result.summary` is available, call `recordTeamTaskResultEvidence()` with `taskId`, `memberId`, `summary`, and `.team/tasks/<taskId>/result.md`.

- [ ] **Step 5: Verify TeamRuntime tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/team/__tests__/team-runtime.test.ts src/context/team-ledger.test.ts --no-file-parallelism
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/team/team-runtime.ts packages/core/src/team/__tests__/team-runtime.test.ts packages/core/src/context/team-ledger.test.ts
git commit -m "feat(context): wire team runtime ledger events"
```

---

### Task 4: Wire `team_artifact` Evidence Capture

**Files:**
- Modify: `packages/core/src/team/team-member.ts`
- Modify: `packages/core/src/tools/team-artifact.ts`
- Modify: `packages/core/src/team/team-workspace.ts`
- Modify: `packages/core/src/team/__tests__/team-tools.test.ts`

- [ ] **Step 1: Write failing team_artifact test**

Add a test in `team-tools.test.ts` or a focused tool test that executes:

- `create_artifact`
- `create_contract`
- `create_issue`
- `update_status` resolving an issue
- `update_status` completing a task

Assert `contextEngine.store.saveRawEvidence` and `saveFact` receive the right fact kinds and deterministic ids.

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/team/__tests__/team-tools.test.ts --no-file-parallelism
```

- [ ] **Step 3: Extend TeamArtifactDeps**

Add optional context fields:

```ts
contextLedger?: {
  store?: Pick<ContextStore, 'saveRawEvidence' | 'saveFact' | 'saveDiagnostic'>
  cwd: string
  sessionId?: string
  teamId: string
}
```

- [ ] **Step 4: Call ledger helpers**

In `team-artifact.ts`:

- after `writeArtifact()`, call `recordTeamArtifactEvidence({ artifactKind:'artifact', ... })`;
- after `writeContract()`, call `recordTeamArtifactEvidence({ artifactKind:'contract', ... })`;
- after `writeIssue()`, call `recordTeamIssueEvidence({ status:'open', ... })`;
- after `updateIssueStatus()` with `resolved` or `wontfix`, call `recordTeamIssueEvidence()` with the new status;
- after writing `result.md`, call `recordTeamTaskResultEvidence()`.

All calls must be `await` inside the tool execution only because the user/tool result already waits for file writes; the helper itself is fail-open and must not throw.

- [ ] **Step 5: Pass context from TeamMember**

When TeamMember creates `team_artifact`, pass:

```ts
contextLedger: {
  store: this.opts.subSessionDeps.contextEngine?.store,
  cwd: this.opts.subSessionDeps.cwd,
  sessionId: this.opts.subSessionDeps.contextEngine?.sessionId,
  teamId: this.opts.teamId,
}
```

- [ ] **Step 6: Verify tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/team/__tests__/team-tools.test.ts src/team/__tests__/team-member.test.ts src/context/team-ledger.test.ts --no-file-parallelism
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tools/team-artifact.ts packages/core/src/team/team-member.ts packages/core/src/team/team-workspace.ts packages/core/src/team/__tests__/team-tools.test.ts
git commit -m "feat(context): capture team artifacts and issues"
```

---

### Task 5: Add Team Harvest Router And Distillers

**Files:**
- Create: `packages/core/src/context/distillers/team-ledger-distiller.ts`
- Create: `packages/core/src/context/distillers/artifact-summary-distiller.ts`
- Create: `packages/core/src/context/distillers/qa-issue-distiller.ts`
- Modify: `packages/core/src/context/distillers/index.ts`
- Modify: `packages/core/src/context/harvest-router.ts`
- Modify: `packages/core/src/context/harvest-router.test.ts`
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/context/safety.ts`
- Modify: `packages/core/src/context/schemas.ts`

- [ ] **Step 1: Write failing harvest router tests**

Add tests:

```ts
expect(routeHarvestCandidate(candidate({
  origin: { projectKey: '/repo', actor: 'team_worker', teamId: 'team_alpha', taskId: 'task_checkout' },
  toolEvents: [{ id: 'tool_1', name: 'team_artifact', status: 'complete' }],
  userMessage: 'Worker completed checkout artifact.',
})).action).toBe('distill_artifact_summary')
```

Also test:

- team PM durable decision -> `distill_team_ledger`
- QA issue event -> `distill_qa_issue`
- raw worker chatter without artifact/tool evidence -> `skip`.

- [ ] **Step 2: Add HarvestDecision variants**

Extend `HarvestDecision`:

```ts
| { action: 'distill_team_ledger'; reason: string }
| { action: 'distill_artifact_summary'; reason: string }
| { action: 'distill_qa_issue'; reason: string }
```

Update `HarvestDecisionSchema`.

- [ ] **Step 3: Add payload schemas to safety payload router**

Update `payloadSchemaForDistiller()` in `safety.ts` and payload map in `distillers/index.ts`.

- [ ] **Step 4: Implement deterministic distillers**

Each distiller should:

- use structured candidate fields and tool events;
- call the model only if a `modelClient` is present and the candidate is not already structured;
- return `DistillerSkipOutput` for raw log/no durable fact;
- return envelopes with citations to provided candidate refs only.

This keeps Team event ingestion stable and avoids CPU spikes.

- [ ] **Step 5: Update `kindFromEnvelope()`**

Map:

- `TeamLedgerDistiller` -> `team_decision` or `task_result` based on payload kind;
- `ArtifactSummaryDistiller` -> `artifact_summary`;
- `QaIssueDistiller` -> `qa_issue`.

- [ ] **Step 6: Verify harvest tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts src/context/context-harvest.test.ts src/context/team-ledger.test.ts --no-file-parallelism
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/distillers packages/core/src/context/harvest-router.ts packages/core/src/context/harvest-router.test.ts packages/core/src/context/harvest.ts packages/core/src/context/safety.ts packages/core/src/context/schemas.ts packages/core/src/context/types.ts
git commit -m "feat(context): distill team ledger candidates"
```

---

### Task 6: Product Eval For Cross-Session Team Output Reuse

**Files:**
- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `packages/core/src/context/team-ledger.test.ts`

- [ ] **Step 1: Write failing product eval**

Add an eval:

- create project store under temp cwd;
- record a team artifact summary for `task_checkout`;
- open another same-cwd session/request;
- call `buildContextBundle()` with user message `checkout task 做了什么`;
- assert rendered prompt contains the artifact summary;
- assert different cwd does not see it.

- [ ] **Step 2: Verify red or pass based on previous tasks**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
```

- [ ] **Step 3: Fix retrieval if needed**

If the eval fails because `artifact_summary` is not retrieved, adjust `retriever.ts` actor/path/kind scoring. Do not add hidden limits.

- [ ] **Step 4: Final Phase 4 verification**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/team-ledger.test.ts src/team/__tests__/team-runtime.test.ts src/team/__tests__/team-tools.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts src/context/context-harvest.test.ts src/context/context-retriever.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

Run:

```bash
pnpm --filter @jdcagnet/core build
```

Run:

```bash
git diff --check
```

- [ ] **Step 5: Commit eval/hardening**

```bash
git add packages/core/src/context/context-product-evals.test.ts packages/core/src/context/team-ledger.test.ts packages/core/src/context/retriever.ts
git commit -m "test(context): reuse team outputs across sessions"
```

## Acceptance Criteria

- Team completion writes raw evidence under the project context store.
- Artifact summaries become accepted `artifact_summary` facts and are retrievable in another same-project session.
- QA issues become `qa_issue` facts while open/in-progress and are stale after resolved/wontfix.
- Durable PM decisions can become `team_decision` facts with citations.
- Raw PM/worker chatter is not accepted as durable fact.
- Team still runs if context store writes fail.
- Different project roots do not share Team facts.
- No default token/fact/memory cap is added.

## Verification Commands

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/team-ledger.test.ts src/team/__tests__/team-runtime.test.ts src/team/__tests__/team-tools.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
```

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts src/context/context-harvest.test.ts src/context/context-retriever.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

```bash
pnpm --filter @jdcagnet/core build
```

```bash
git diff --check
```

## Recommended Commit Messages

```bash
git commit -m "feat(context): add team context fact kinds"
git commit -m "feat(context): capture team ledger evidence"
git commit -m "feat(context): wire team runtime ledger events"
git commit -m "feat(context): capture team artifacts and issues"
git commit -m "feat(context): distill team ledger candidates"
git commit -m "test(context): reuse team outputs across sessions"
```
