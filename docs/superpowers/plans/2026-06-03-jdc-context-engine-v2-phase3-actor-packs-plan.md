# JDC Context Engine V2 Phase 3 Actor-Aware Context Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make JDC Context Engine produce role-specific context packs for main sessions, subagents, Team PM, and Team workers from the same project-level fact pool. Actor profile changes ranking and rendering intent; it must never become a session isolation boundary.

**Architecture:** Add an `ActorContextProfile` contract, build profiles at each runtime entrypoint, pass the profile into retrieval and bundle construction, and score durable project facts differently by actor/task/file scope. The store remains project-local under `.jdcagnet/context-engine/context.db`; accepted project facts stay shared across sessions and actors.

**Tech Stack:** TypeScript, Vitest, existing `ContextRetriever`, existing `buildContextBundle()`, existing `Session`/`runSubSession()` injection path, existing Team runtime/member types.

---

## Phase 3 Scope

This plan implements only Phase 3 from `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-master-roadmap.md`.

It adds:

- actor profile builders for main session, subagent, Team PM, and Team worker;
- profile-aware retrieval scoring for role, task, team, and file-scope relevance;
- profile metadata on bundles so prompt rendering can show which actor pack was built;
- runtime plumbing from main session, sub-session, and Team worker entrypoints;
- tests proving the same project fact pool produces different packs for different actors without breaking project-level sharing.

It does not implement Team ledger ingestion, new Team fact producers, embeddings, UI redesign, or diagnostics gating. Those are later phases.

## Hard Product Contracts

- Do not rename `JDC Context Engine`.
- Do not move persistence out of `<project>/.jdcagnet/context-engine/context.db`.
- Do not make accepted project facts session-isolated.
- Do not filter project facts by `origin.sessionId` unless an explicit debug option asks for it.
- Do not leak facts across different project roots.
- Do not store raw hidden reasoning.
- Do not add default token, fact, memory, or retrieval caps.
- `preferredFactCount`, `explicitTokenCap`, and `explicitCodeTokenCap` are explicit caller/debug hints only; production defaults remain uncapped and relevance-first.
- Actor profiles may boost, suppress, or annotate facts, but the project store remains the source of truth.
- Main sessions should not receive raw worker logs as primary context.
- Workers should receive their task, file scope, project conventions, and upstream constraints before generic memories.
- PM should receive team decisions, issues, task results, and open risk context before generic memories.
- Subagents should receive parent objective/constraints plus relevant code/project facts, not unrelated recent chat.

## File Structure

- Create: `packages/core/src/context/actor-profile.ts`
- Create: `packages/core/src/context/context-packs.test.ts`
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/retriever.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/prompt-renderer.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Modify: `packages/core/src/team/team-runtime.ts`
- Modify: `packages/core/src/team/team-member.ts`
- Modify: `packages/core/src/team/team-manager-ai.ts`
- Modify: `packages/core/src/session-context.test.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`

## Data Contract

Add this interface to `packages/core/src/context/types.ts`:

```ts
export interface ActorContextProfile {
  actor: ContextActor
  sessionId: string
  cwd: string
  mode: ContextMode
  objective: string
  subSessionId?: string
  teamId?: string
  memberId?: string
  taskId?: string
  fileScope?: string[]
  preferredFactCount?: number
  explicitTokenCap?: number
  explicitCodeTokenCap?: number
  includeTeamState: boolean
  includeWorkerLogs: false
}
```

Rules:

- `actor`, `sessionId`, `cwd`, `mode`, and `objective` are always required.
- `fileScope` must use project-relative paths when possible.
- `includeWorkerLogs` is deliberately typed as `false` for this phase. Raw worker logs are not primary user context.
- `preferredFactCount` is not a hidden production cap. If present, retrieval may use it as an explicit caller hint.
- `explicitTokenCap` and `explicitCodeTokenCap` are not default limits. If present, pass them through only as explicit debug/runtime constraints.

## Dependencies

Tasks must be done in order:

1. Plan and red tests.
2. Actor profile types/builders.
3. Profile-aware retriever scoring.
4. Bundle/rendering metadata.
5. Runtime plumbing for main session, subagent, and Team worker/PM surfaces.
6. Verification, merge, and push.

Do not update runtime entrypoints before the profile contract exists. Do not implement Team ledger ingestion in this phase.

---

### Task 1: Specify Actor-Specific Pack Behavior

**Files:**
- Create: `packages/core/src/context/context-packs.test.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`

- [ ] **Step 1: Write failing tests for same pool, different actors**

Create `packages/core/src/context/context-packs.test.ts` with tests that build a temp project store and save facts like:

- a project convention relevant to all actors;
- a Team PM decision/risk fact with `origin.actor='team_pm'`, `teamId`, `relatedTasks`;
- a Team worker task result with `origin.actor='team_worker'`, `teamId`, `memberId`, `taskId`, `relatedFiles`;
- an unrelated recent chat/current-goal fact.

Assert:

- a `main_session` profile receives project convention and relevant memory, but not raw worker-log-style facts;
- a `team_pm` profile ranks team issue/decision facts above generic memory;
- a `team_worker` profile ranks task/file-scoped facts above generic project facts;
- a `subagent` profile ranks parent objective/code/project facts above unrelated recent chat.

- [ ] **Step 2: Write failing orchestrator metadata test**

Add a test proving `buildContextBundle(request, { actorProfile })` preserves actor metadata on the bundle and rendered prompt includes an actor/profile marker without breaking the existing `<jdc-context-engine>` protocol.

- [ ] **Step 3: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-packs.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: FAIL because `actor-profile.ts`, `ActorContextProfile`, and `actorProfile` options do not exist.

- [ ] **Step 4: Commit red tests**

```bash
git add packages/core/src/context/context-packs.test.ts packages/core/src/context/context-orchestrator.test.ts
git commit -m "test(context): specify actor-aware context packs"
```

---

### Task 2: Add Actor Profile Contract And Builders

**Files:**
- Create: `packages/core/src/context/actor-profile.ts`
- Modify: `packages/core/src/context/types.ts`

- [ ] **Step 1: Add `ActorContextProfile` type**

Add the data contract above to `packages/core/src/context/types.ts`.

- [ ] **Step 2: Implement profile builders**

Create `packages/core/src/context/actor-profile.ts` exporting:

```ts
export function mainSessionProfile(request: ContextRequest, objective?: string): ActorContextProfile
export function subAgentProfile(opts: SubAgentProfileOptions): ActorContextProfile
export function teamPmProfile(opts: TeamPmProfileOptions): ActorContextProfile
export function teamWorkerProfile(opts: TeamWorkerProfileOptions): ActorContextProfile
```

Builder requirements:

- normalize `cwd`;
- trim objective without dropping meaningful Chinese text;
- preserve project-level sharing by never adding isolation filters;
- normalize `fileScope` to stable project-relative paths when possible;
- default `includeTeamState` to `false` for main/subagent and `true` for Team PM/worker;
- always set `includeWorkerLogs: false`.

- [ ] **Step 3: Run profile tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-packs.test.ts --no-file-parallelism
```

Expected: Some tests may still fail until retriever scoring is implemented, but type/builders should compile.

- [ ] **Step 4: Commit profile contract**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/actor-profile.ts packages/core/src/context/context-packs.test.ts
git commit -m "feat(context): add actor-aware context profiles"
```

---

### Task 3: Make Retrieval Actor-Aware

**Files:**
- Modify: `packages/core/src/context/retriever.ts`
- Modify: `packages/core/src/context/context-packs.test.ts`

- [ ] **Step 1: Add `actorProfile` to retrieval options**

Extend `ContextRetrievalOptions`:

```ts
actorProfile?: ActorContextProfile
```

- [ ] **Step 2: Add actor-aware scoring**

Update scoring without adding default limits:

- all actors keep lexical/confidence/freshness scoring from Phase 1;
- `team_pm` boosts same `teamId`, team decisions, issues, task results, `relatedTasks`, and high-risk known issues;
- `team_worker` boosts same `taskId`, `memberId`, `teamId`, matching `relatedFiles`, and project conventions/workflow rules;
- `subagent` boosts relevant code/project facts and parent objective matches, while suppressing unrelated `current_goal` and `runtime_error_chain`;
- `main_session` boosts relevant project conventions/workflows/user preference and suppresses facts tagged or sourced as raw worker logs.

Use provenance fields already added in Phase 2:

- `fact.origin.actor`
- `fact.origin.teamId`
- `fact.origin.memberId`
- `fact.origin.taskId`
- `fact.relatedFiles`
- `fact.relatedTasks`
- `fact.tags`
- `fact.citations`

- [ ] **Step 3: Add explainable scoring reasons**

Add reasons such as:

- `actor_team_match`
- `actor_task_match`
- `actor_member_match`
- `actor_file_scope_match`
- `actor_pm_priority`
- `actor_worker_priority`
- `actor_main_suppressed_worker_log`
- `actor_subagent_project_priority`

- [ ] **Step 4: Verify actor pack tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-packs.test.ts --no-file-parallelism
```

Expected: PASS for retrieval-level actor differences.

- [ ] **Step 5: Commit retriever scoring**

```bash
git add packages/core/src/context/retriever.ts packages/core/src/context/context-packs.test.ts
git commit -m "feat(context): rank facts by actor profile"
```

---

### Task 4: Thread Actor Profile Through Bundle And Rendering

**Files:**
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/prompt-renderer.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`
- Modify: `packages/core/src/context/context-packs.test.ts`

- [ ] **Step 1: Add bundle profile metadata**

Extend `ContextBundle` with:

```ts
actorProfile?: Pick<ActorContextProfile, 'actor' | 'sessionId' | 'subSessionId' | 'teamId' | 'memberId' | 'taskId' | 'objective'>
```

- [ ] **Step 2: Add `actorProfile` to `BuildContextBundleOptions`**

Pass it into `retrieveContextFacts()` and attach sanitized metadata to the bundle.

- [ ] **Step 3: Render actor marker**

Update `renderContextBundle()` so `<jdc-context-engine>` includes compact role metadata, for example:

```xml
<actor>team_worker</actor>
<objective>...</objective>
```

Do not render raw worker logs. Do not add token caps. Keep existing protocol shape valid for Anthropic, OpenAI Chat, and OpenAI Responses.

- [ ] **Step 4: Verify orchestrator tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-packs.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit bundle/rendering plumbing**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/orchestrator.ts packages/core/src/context/prompt-renderer.ts packages/core/src/context/context-orchestrator.test.ts packages/core/src/context/context-packs.test.ts
git commit -m "feat(context): render role-specific context packs"
```

---

### Task 5: Wire Main Session, Subagent, And Team Entry Points

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Modify: `packages/core/src/team/team-runtime.ts`
- Modify: `packages/core/src/team/team-member.ts`
- Modify: `packages/core/src/team/team-manager-ai.ts`
- Modify: `packages/core/src/session-context.test.ts`
- Modify: relevant Team tests if signatures change

- [ ] **Step 1: Main session profile**

In `Session.injectContextForRunLoop()`, create a `mainSessionProfile(request, userMessage)` and pass it to `buildContextBundle()`.

- [ ] **Step 2: Subagent profile**

Extend `SubSessionOptions` with optional actor metadata:

```ts
contextActor?: 'subagent' | 'team_worker'
subSessionId?: string
teamId?: string
memberId?: string
taskId?: string
fileScope?: string[]
parentObjective?: string
```

In `runSubSession()`, build `subAgentProfile()` by default or `teamWorkerProfile()` when `contextActor === 'team_worker'`.

- [ ] **Step 3: Team worker profile**

In `TeamMember`, pass `contextActor='team_worker'`, `teamId`, `memberId`, `taskId`, responsibility/objective, and file scope if it is derivable from task/artifact metadata.

Do not invent Phase 4 ledger. This is only profile metadata for context selection.

- [ ] **Step 4: Team PM profile**

Add a Team PM profile builder usage at the PM context-construction point if `TeamManagerAI` has a context bundle path. If PM currently does not call `buildContextBundle()`, add type support and leave a documented no-op TODO for Phase 4 instead of fabricating a new PM injection pipeline.

- [ ] **Step 5: Verify runtime tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts src/team/__tests__/team-member.test.ts src/team/__tests__/team-runtime.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit runtime plumbing**

```bash
git add packages/core/src/session.ts packages/core/src/sub-session.ts packages/core/src/team/team-runtime.ts packages/core/src/team/team-member.ts packages/core/src/team/team-manager-ai.ts packages/core/src/session-context.test.ts packages/core/src/team/__tests__/team-member.test.ts packages/core/src/team/__tests__/team-runtime.test.ts
git commit -m "feat(context): wire actor profiles into runtime sessions"
```

---

### Task 6: Product Verification And Merge

**Files:**
- Modify as needed based on verification only.

- [ ] **Step 1: Run Phase 3 verification**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-packs.test.ts src/session-context.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

- [ ] **Step 2: Run related context suite**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts src/context/context-product-evals.test.ts src/tools/memory-tools.test.ts --no-file-parallelism
```

- [ ] **Step 3: Build**

```bash
pnpm --filter @jdcagnet/core build
```

- [ ] **Step 4: Diff hygiene**

```bash
git diff --check
```

- [ ] **Step 5: Merge and push**

Fast-forward merge into `main`, verify the same commands on `main`, then push using the local proxy:

```bash
GIT_SSH_COMMAND="ssh -o HostName=ssh.github.com -o Port=443 -o ProxyCommand='nc -x 127.0.0.1:7890 -X connect %h %p' -o ServerAliveInterval=30 -o ServerAliveCountMax=3" git push origin main
```

## Acceptance Criteria

- Same project, different sessions can reuse accepted project facts.
- Different project roots cannot share facts because the store remains project-local.
- Main session, subagent, Team PM, and Team worker receive measurably different ranked packs from the same fact pool.
- Worker pack prioritizes assigned task/file-scoped context plus project conventions.
- PM pack prioritizes team-level decisions/issues/task state when such facts exist.
- Main session pack avoids raw worker-log-style context while keeping durable project decisions/results available.
- No hidden token/fact/memory cap is introduced.
- Existing prompt rendering remains valid for Anthropic, OpenAI Chat, and OpenAI Responses.

## Recommended Commit Messages

```bash
git commit -m "test(context): specify actor-aware context packs"
git commit -m "feat(context): add actor-aware context profiles"
git commit -m "feat(context): rank facts by actor profile"
git commit -m "feat(context): render role-specific context packs"
git commit -m "feat(context): wire actor profiles into runtime sessions"
```
