# JDC Context Engine Production Diagnosis

## Verdict

Current JDC Context Engine is not garbage, but it is not yet the product we named.

It has important building blocks: project-local persistence, provider contracts, prompt injection, harvest jobs, citations, validation, inspect panels, and model-bound async distillation. But the current user-visible effect is weak because the system does not yet close the loop from "observed signal" to "trusted durable project intelligence" to "task-aware context bundle that changes the model's next action".

The practical result is exactly what the user feels:

- The engine runs.
- It sometimes collects data.
- It can inspect data.
- It may add prompt sections.
- But the agent does not reliably feel more project-aware, more consistent, or less likely to ask for context it should already know.

That means the problem is no longer only bugs. The bigger problem is product architecture.

## Current State In Code

The runtime path is:

- `packages/core/src/session.ts` calls `injectContextForRunLoop()` before model streaming.
- `injectContextForRunLoop()` builds a `ContextRequest`.
- `packages/core/src/context/orchestrator.ts` calls every enabled provider sequentially.
- Provider output plus stored facts are ranked and budgeted.
- The rendered bundle is appended to the model system prompt.
- After runLoop completion, `enqueueHarvestAfterRunLoop()` may enqueue async harvest.
- `packages/core/src/context/harvest.ts` runs a distiller using the captured session model.
- Accepted output is either persisted as a fact or held for manual review depending on trust mode.

The store path is:

- `packages/core/src/context/store.ts` opens the DB under the project root:
  `.jdcagnet/context-engine/context.db`.
- Facts are project-key scoped.
- Bundle snapshots and harvest jobs can be queried by session.
- Accepted facts are queryable project-wide unless filtered by query options.

The UI path is:

- `packages/ui/src/components/context/ContextPanel.tsx` exposes Inspect, Harvest, Memory, and Health.
- These panels are mostly debugging/inspection surfaces.
- They do not make the engine feel automatic; they make the internal state visible.

## Why It Feels Useless

### 1. The Engine Does Not Yet Have A Task-Aware Brain

`buildContextBundle()` gathers provider sections and ranks them with static weights in `packages/core/src/context/ranker.ts`.

That means the engine does not truly ask:

- What is the user trying to do now?
- Is this a debugging turn, review turn, implementation turn, planning turn, or memory turn?
- Which files/symbols are relevant because of the current task?
- Which stored facts should be suppressed because they are stale, redundant, or too generic?
- What missing evidence should be fetched before injecting context?

It mostly says:

> Here are live provider sections and stored facts. Sort them by static score. Render them.

That is not a context engine yet. That is a context bundle assembler.

### 2. Durable Memory Defaults To Manual Review, So The Automatic Loop Is Weak

Default config in `packages/core/src/context/config.ts` sets:

```ts
memory: {
  trustMode: 'manual_review',
  minConfidence: 0.8,
}
```

In `packages/core/src/context/harvest.ts`, valid distiller output under manual review becomes `pending_review`, not an accepted `ContextFact`.

That is safe, but it means the default automatic path does not produce reusable durable memory unless the user approves it. If no one approves pending candidates, the engine keeps harvesting but does not get much smarter.

This explains why same-project cross-session reuse can look broken:

- accepted durable facts are project-level and should be shared;
- harvest jobs, rejected candidates, and latest bundle inspect views are often session-shaped;
- pending review output is not injected as trusted memory;
- if accepted memory count is zero, there is nothing meaningful to share.

### 3. Harvest Routing Is Too Shallow

`classifyHarvestCandidate()` in `packages/core/src/context/safety.ts` skips greetings and acknowledgements, then sends every substantive turn to:

```ts
{ action: 'distill_memory_candidate', reason: 'completed turn contains substantive interaction' }
```

This fixed the old keyword-only failure, but it is still not production-grade.

It should be able to route to:

- runtime narrative when tool failures happened;
- conversation state when goals/constraints changed;
- project update when files changed;
- code task context when implementation created new entry points;
- memory candidate when the user explicitly states durable preference/rule/decision;
- skip when the turn is substantive but not reusable.

Right now the model can output `skip`, but the system has already chosen the memory distiller. That makes the engine biased toward memory-like facts and underuses the richer schemas already defined in `types.ts`.

### 4. Providers Collect Signals, Not Intelligence

Current providers are mostly deterministic signal formatters:

- `conversation-provider.ts` formats recent transcript.
- `project-provider.ts` summarizes a few root files.
- `git-provider.ts` lists working changes and hot files.
- `runtime-provider.ts` formats tool events.
- `ide-provider.ts` formats active file/selection.
- `code-provider.ts` asks the code index for query context.
- `memory-provider.ts` returns health but no sections; durable facts are loaded separately by orchestrator.

This is not bad. Producers should be boring.

But there is no layer that turns those signals into an actionable per-turn plan. The main model receives text, not a structured decision like:

```json
{
  "taskIntent": "fix_context_engine_perf",
  "mustUseFacts": ["project_convention:test_first", "runtime_issue:renderer_cpu"],
  "codeTargets": ["packages/ui/src/stores/session-store.ts"],
  "avoid": ["manual reindex on foreground path"],
  "questions": []
}
```

Without that, the engine can increase prompt size without increasing usefulness.

### 5. Ranking Is Static And Can Prefer The Wrong Context

`ranker.ts` gives fixed weights to section kinds. This is simple and predictable, but it is not enough for project-level agent work.

Example:

- A stale but high-priority runtime section may outrank a fresh architecture decision if freshness/intent scoring is wrong.
- Generic conversation state can outrank specific code facts.
- Memory has low base weight, so the user's durable project preferences may be under-injected.
- The ranking does not know whether the current task is implementation, review, debugging, or planning beyond a coarse mode field.

Static ranking is acceptable as a fallback. It should not be the whole selector.

### 6. The UI Still Feels Like Manual Management

The Context panel exposes:

- Reload cached view.
- Harvest queue.
- Memory review.
- Provider health.
- Reindex.

These are useful for debugging, but they are not the product experience. The product promise is "automatic context enhancement"; the panel should read like observability, not a control center the user must operate.

The current UI therefore reinforces the feeling that the engine is something the user must nurse.

The panel also violates the product's language and audience expectation. Current visible labels such as `Inspect`, `Harvest`, `Memory`, `Health`, `Accepted`, `Skipped`, `Rejected`, `Failed`, `Diagnostics`, and `Read cached view` are English-heavy. For a Chinese-first desktop product, this makes a complex internal system feel even more alien.

Required UI contract:

- The entire JDC Context Engine panel must use Chinese user-facing copy by default.
- English protocol/model/tool identifiers may remain when they are literal technical identifiers, such as `openai-responses`, `gpt-5.5`, `JdcMemoryWrite`, or file paths.
- Section labels, empty states, warnings, explanations, button labels, status names, and metric names must be Chinese.
- The panel must not read like a developer console for normal users.
- The panel must not imply that users need to click a button for the engine to work.
- Data should appear automatically when the user switches sessions or when engine state changes.
- Manual buttons are acceptable only as secondary diagnostic actions, hidden behind subtle affordances or an advanced/debug area.
- The primary panel should show final accepted facts and current engine state, not every failed, skipped, no-op, or rejected internal attempt.

Better mental model:

```text
bad:
  User opens panel -> clicks Refresh/Reindex/Read cached view -> wonders whether Engine works.

good:
  User works normally -> Engine updates automatically -> panel quietly shows current facts if the user chooses to inspect.
```

Suggested Chinese tab naming:

```text
Inspect  -> 上下文
Harvest  -> 采集记录
Memory   -> 项目记忆
Health   -> 引擎状态
```

Suggested status copy:

```text
Accepted       -> 已采纳
Pending review -> 待确认
Skipped        -> 已跳过
Rejected       -> 已拒绝
Failed         -> 失败
Diagnostics    -> 诊断
model_noop     -> 无需保存
not reported   -> 未产生
IDE snapshot unavailable -> 未获取到 IDE 快照
```

The UI goal is not "make context management visible". The goal is "make the agent feel smoother while leaving a clear evidence trail for advanced debugging".

Required UI file changes:

```text
packages/ui/src/components/context/ContextPanel.tsx
packages/ui/src/components/context/ContextInspectPanel.tsx
packages/ui/src/components/context/HarvestQueuePanel.tsx
packages/ui/src/components/context/MemoryReviewPanel.tsx
packages/ui/src/components/context/ProviderHealthPanel.tsx
packages/ui/src/components/context/ContextPanelPrimitives.tsx
packages/ui/src/stores/context-store.ts
packages/ui/src/components/Inspector.tsx
packages/ui/src/components/tool-cards/tool-card-meta.ts
```

Target panel structure:

```text
JDC 上下文引擎
  当前状态
    - 自动增强中 / 可用 / 降级 / 暂不可用
    - 最近更新时间
    - 当前项目 store 路径

  项目事实
    - 已采纳项目规则
    - 架构决策
    - 工作流约定
    - 已知问题
    - 相关代码入口

  当前上下文
    - 本轮注入了什么
    - 为什么注入
    - 哪些内容被抑制

  高级诊断（默认折叠）
    - 采集记录
    - provider 状态
    - no-op / rejected / skipped / failed
    - reindex / refresh 诊断动作
```

Normal users should mostly see `当前状态`, `项目事实`, and `当前上下文`. `采集记录`, `Provider Health`, `Diagnostics`, `Reindex`, and raw harvest jobs belong under advanced diagnostics.

### 7. Durable Storage Must Store Final Truth, Not Garbage

Project-level persistence must not become a trash bin for failed AI attempts.

The production contract should split data into two different layers:

```text
durable project truth:
  accepted ContextFact
  accepted MemoryRecord
  accepted project profile
  accepted architecture decision
  accepted workflow rule
  accepted known issue
  accepted code entrypoint

ephemeral operations/debugging:
  harvest job state
  model_noop skip
  validation failure
  rejected candidate
  provider timing
  provider warning
  transient diagnostics
```

Only durable project truth should be injected as trusted context or shown as the main panel content.

Ephemeral operations/debugging data may exist only under strict conditions:

- It is not used as accepted context.
- It is not shown in the normal user-facing panel by default.
- It has short retention.
- It is deduplicated.
- It is accessible only from advanced diagnostics.
- It is clearly labeled as operational telemetry, not project memory.

Unqualified data handling rules:

- `model_noop`: do not create user-visible memory/review rows; optionally count in aggregate telemetry.
- low confidence output: reject and hide from primary UI; show only in advanced diagnostics if needed.
- uncited output: reject and hide from primary UI.
- validation failure: do not persist as project context; keep only short-lived diagnostic if useful.
- aborted/timeout harvest: treat as cancelled operation, not a memory candidate.
- duplicate candidate: skip before model call when possible; otherwise collapse into aggregate skip metrics.

If the engine is truly production-grade, users should not need to worry about these categories. The engine should silently filter them and expose only the evidence-backed final facts that can actually improve future work.

### 8. Prompt And Tool Contracts Still Look Like The Old Memory World

Normal built-in tool registration has retired `SaveMemory`; `packages/core/src/tools/index.ts` registers `JdcMemorySearch` and `JdcMemoryWrite` instead.

However, the prompting and tool-description layer is not explicit enough:

- `packages/core/src/context-engine/prompt.ts` describes JDC code-intelligence tools, but does not clearly describe JDC project memory behavior.
- `JdcMemoryWrite` is described only as "Write a cited JDC Context Engine memory candidate"; that is too vague for models that already learned older `SaveMemory` habits.
- `JdcMemorySearch` does not clearly say that accepted durable facts are project-local and loaded from `<project>/.jdcagnet/context-engine/context.db`.
- UI tool metadata still contains `SaveMemory` in `packages/ui/src/components/tool-cards/tool-card-meta.ts`, which keeps legacy naming alive in the product surface.
- `compact_complete` still carries `memoriesExtracted`, and UI text can say "memories saved" even though legacy file extraction is now disabled. Even if the count is zero, the wording preserves the old mental model.

Required prompt/tool contract:

- The system prompt must explicitly say that legacy file-based memory is retired.
- If the user says "remember/save this", the model must use `JdcMemoryWrite` only when it can provide citations and project/repo/session/global scope.
- For project conventions, workflow rules, architecture decisions, and known issues, default scope should be `project` unless the user clearly asks otherwise.
- `JdcMemorySearch` is the retrieval path for accepted durable project memory.
- `SaveMemory` must not appear in normal tool lists, tool cards, docs, or prompt instructions except in migration/retirement docs.
- Tool descriptions must include examples and boundaries: when to search, when to write, when not to write, what citation means, and where data persists.

This is important because the model is not just reading TypeScript. It is following the prompt and tool descriptions. If those descriptions still resemble the old memory product, behavior will drift back toward the old memory product.

### 9. Screenshot Findings From June 3

The screenshots show three product-quality failures in the current inspectability surface.

First screenshot:

- Harvest tab shows `1 jobs retained for inspection`.
- Status summary shows `Skipped 1`.
- Job reason is `model_noop`.
- Durable fact and validation both show `not reported`.

Interpretation:

The model was called for harvest, decided there was no durable fact, and returned a legal no-op. That is technically correct, but the UI makes it look like the engine did useful work and produced an inspectable harvest artifact. For a normal user, this reads as noise.

Required behavior:

- `model_noop` should be treated as low-salience successful skip, not a retained queue item that dominates the panel.
- The Harvest panel should separate "actionable retained jobs" from "quiet skips".
- `Durable fact: not reported` and `Validation: Not reported` should not be prominent for a skip. They should be hidden or replaced with "No durable storage attempted".
- A model no-op should contribute to metrics/evals, but not make the user think memory failed.

Second screenshot:

- Diagnostics show duplicate `Harvest model skipped durable storage: model_noop`.
- Diagnostics also show `IdeSignalProvider` warning: `IDE snapshot is unavailable; IDE provider returned stale degraded context.`

Interpretation:

The diagnostics layer is too noisy and not deduplicated. The IDE warning is technically true when no IDE snapshot was supplied, but it is not necessarily a user-facing warning. It may simply mean the current inspect/health request did not include an IDE selection.

Required behavior:

- Deduplicate diagnostics by `source + message + citation + runLoopId`.
- Hide or collapse low-salience `model_noop` diagnostics by default.
- Treat missing IDE snapshot as `info` or `not_available` unless the current turn required IDE context.
- Provider health should distinguish "not connected", "not selected", "not supplied in this request", and "stale actual IDE state".
- Inspect panels should not make normal absence of IDE selection look like engine degradation.

These screenshot issues support the larger diagnosis: the engine currently exposes internal mechanics instead of presenting a clear product truth.

### 10. Project Persistence Works, But The Mental Model Is Confusing

The code now stores context under:

```text
<project>/.jdcagnet/context-engine/context.db
```

That is the right direction for project-scoped reuse.

However, the existing engineering contract still says "under app config dir" in its Contract Status section. That is now stale and must be corrected. A stale contract is dangerous because future work may accidentally reintroduce global persistence or mixed project data.

### 11. Same-Project Session Consistency Must Be A Hard Contract

JDC Context Engine data must be project-level durable state, not session-level cache.

Required contract:

- All sessions with the same normalized project root must open the same store:
  `<project>/.jdcagnet/context-engine/context.db`.
- Switching between sessions in the same project must show the same accepted durable facts, memory records, project profile, architecture decisions, workflow rules, known issues, and code task facts.
- Restarting the app must not lose accepted durable context.
- The UI may keep temporary view state in Zustand, but Zustand is not a source of truth for Context Engine data.
- On session switch, Electron IPC must resolve `sessionId -> cwd`, open the project store, and reload project-level Context Engine data from disk.
- `sessionId` on `ContextFact`, `RawEvidence`, `HarvestJob`, and `ContextBundle` is provenance. It records where data came from. It must not become the isolation boundary for accepted durable project context.
- Project-level APIs must not filter accepted durable facts by current session unless the call explicitly asks for provenance-only debugging.
- Session-specific views are allowed only for active runLoop state, in-flight harvest jobs, and historical debugging. They must be labeled as session diagnostics, not as the project memory source.

Data ownership rule:

```text
project durable truth:
  accepted ContextFact
  accepted MemoryRecord
  project profile
  architecture decisions
  workflow rules
  code entrypoints
  known issues

session provenance/debugging:
  raw runLoop harvest job
  rejected candidate from a runLoop
  in-flight provider timings
  latest active turn bundle
  transient diagnostics
```

This matters because a project is normally developed across many conversations. If the engine only feels useful inside the session where data was collected, it is not a project context engine; it is just a chat cache.

### 12. The Engine Lacks Product Evals

There are unit tests for store, schemas, providers, harvest, inspect, and protocol safety.

What is missing is the test that matters:

> Given a real project and a user task, does the next model turn make a better decision because of JDC Context Engine?

Without this, the team can keep passing tests while users still feel no value.

Production-grade JDC Context Engine needs behavior evals:

- "User states a project convention in session A; session B follows it without being reminded."
- "User switches to a bugfix task; engine injects relevant runtime error chain and code targets."
- "A file changes; stale code fact stops being injected."
- "A trivial chat turn does not create memory or CPU load."
- "Manual review disabled in high-confidence mode creates accepted project facts safely."
- "The engine reduces tool calls needed to understand the project."

### 13. Performance Is A Product Contract

Performance decides whether users experience JDC Context Engine as intelligence or as drag.

The engine can be architecturally correct and still fail the product if it:

- increases CPU during normal chat;
- makes session switching feel sticky;
- blocks the first token;
- repeatedly scans the project;
- writes the full DB too often;
- forces the renderer to re-render heavy panels;
- sends background AI harvest calls too frequently;
- makes users wait for manual refresh/reindex.

Required performance contract:

```text
foreground chat:
  context injection must be cheap, bounded, and fail-open
  no AI harvest call may run before foreground response completion
  provider failures must not block the runLoop

session switch:
  load accepted project facts from disk automatically
  avoid full provider refresh on switch
  avoid code reindex on switch unless background budget allows

startup:
  delay and throttle index warmup
  never saturate CPU on app open
  cancel or pause background jobs when the project/session changes

renderer:
  do not re-render context panels on every token
  do not render raw harvest history by default
  virtualize or limit diagnostic lists

storage:
  batch writes
  avoid full sql.js DB export on every small row when possible
  enforce quotas on normal paths
  keep no-op/rejected/debug rows short-lived

background harvest:
  project-level queue
  min interval
  max in-flight
  max per project time window
  duplicate detection before model call
  timeout + cancellation
```

Suggested initial budgets:

```text
warm per-turn context injection:
  p50 <= 30ms
  p95 <= 120ms

cold/degraded context injection:
  return degraded bundle <= 200ms
  continue chat without waiting for index/harvest

session switch:
  visible chat switch <= 150ms
  context panel project facts <= 300ms

renderer:
  stream update flush interval >= 32ms
  no full markdown/history rerender per token

background harvest:
  max 1 active harvest per project by default
  no harvest for greetings/no-op/short acknowledgements
  no more than 1 harvest model call per project per 30-60 seconds unless user explicitly asks to save memory

indexing:
  background only
  cancellable or pausable
  bounded concurrency
  visible as advanced diagnostic, not normal required action
```

The exact numbers can be tuned, but the contract cannot be vague. If no SLO exists, the engine will drift toward "technically works, practically annoying".

Performance observability must be first-class:

- record provider durations;
- record context injection duration;
- record time-to-first-token impact;
- record harvest queue latency;
- record renderer panel render count in tests where practical;
- record DB write/export time;
- surface slow operations only in advanced diagnostics.

Success signal:

> Users should not notice the engine running. They should only notice that the agent understands the project faster.

## What A Production JDC Context Engine Should Be

The engine should be a project-local context operating system with these layers:

### 1. Evidence Layer

Deterministic producers collect raw facts from code, git, IDE, runtime, conversation, docs, and tools.

This layer should stay mostly non-AI.

### 2. Semantic Distillation Layer

AI distillers turn evidence into structured records:

- project profile;
- architecture map;
- decisions;
- workflow rules;
- current goals;
- runtime error chains;
- code task maps;
- user preferences.

Every durable record must have citations.

### 3. Value Gate

Before any AI harvest call, a cheap gate decides whether the runLoop has enough signal.

After the AI call, a stricter gate decides whether output is:

- auto accepted;
- queued for review;
- rejected;
- skipped;
- stored only as diagnostic.

The decision must be explicit and inspectable.

### 4. Context Planner

Before prompt rendering, the engine needs a planner/selector that builds a task-specific context plan.

It should output:

- inferred task intent;
- required context facts;
- relevant files/symbols;
- recent runtime failures;
- active project rules;
- stale/suppressed context;
- missing evidence that should be fetched by a tool instead of injected blindly.

This planner can be deterministic first, then optionally model-assisted under budget.

### 5. Bundle Renderer

The renderer should convert the context plan into compact prompt text.

It should not dump provider sections. It should say what matters and why.

### 6. Observability UI

The UI should answer:

- What did the engine inject?
- Why did it inject this?
- What did it suppress?
- What is stale?
- What was learned automatically?
- What needs review?
- Did this context improve the model turn?

It should not imply that the user must manually refresh context for normal use.

## Production Rebuild Priorities

### Priority 0: Performance Budget Before More Features

Before adding more providers, panels, or distillers, set hard performance budgets.

Required changes:

- Add timing instrumentation around context injection, provider collection, store reads/writes, code index jobs, harvest enqueue/run, and Context panel render/load.
- Add foreground fail-open behavior for slow providers.
- Add project-level background job scheduler with concurrency and interval limits.
- Add automatic cancellation/pause when switching projects or sessions.
- Add storage batching or write coalescing where sql.js export cost is visible.
- Add renderer guards so streaming chat does not re-render heavy context panels or markdown history.

Success signal:

> The engine can be enabled by default without users seeing CPU spikes, sticky session switches, delayed first token, or manual-refresh friction.

### Priority 1: Make The Engine Visibly Useful

The first goal is not more data. It is better next-turn behavior.

Required changes:

- Add `ContextPlanner` before `renderContextBundle`.
- Add task intent classification.
- Route harvest to the correct distiller.
- Add auto-accept mode for high-confidence cited project facts.
- Keep manual review only for risky memory types.
- Update Inspect UI to show accepted project facts separately from session harvest jobs.
- Make accepted durable project facts the primary displayed data; hide skipped/no-op/rejected attempts from the normal panel.

Success signal:

> Same project, new session, user asks for work, and the model immediately follows project conventions and uses relevant known files without being manually reminded.

### Priority 2: Make Harvest Cheap And Trustworthy

Required changes:

- Add project-level harvest queue and backpressure.
- Track total jobs by project, not only session.
- Add duplicate detection before model calls.
- Add distiller routing.
- Add persistent skip diagnostics that do not look like errors.
- Add an explicit `auto_accept_high_confidence` policy for project facts, with stricter thresholds.
- Persist only accepted facts into durable context tables; keep rejected/skipped/no-op attempts as short-lived operational diagnostics only.

Success signal:

> Saying "hi" or "continue" does nothing; completing a meaningful runLoop creates at most one high-value candidate; garbage output does not enter memory review.

### Priority 3: Build Project Intelligence, Not Prompt Filler

Required changes:

- Add `ArchitectureMapDistiller`.
- Add `DecisionLedgerDistiller`.
- Add `ProjectConventionDistiller`.
- Add `CodeTaskMapDistiller`.
- Store symbols/files as structured payloads, not just prose.
- Make code provider able to answer "why this file matters for this task".

Success signal:

> The engine can explain the project, active constraints, relevant files, and previous decisions in a way that directly helps implementation.

### Priority 4: Fix The Product Contract

Required changes:

- Update `2026-06-01-jdc-context-engine-engineering-contract.md` to project-local `.jdcagnet/context-engine/context.db`.
- Define which data is project-shared and which is session-only.
- Require session switching to reload project-level durable context by resolving `sessionId -> cwd`, not by reading renderer cache or session-only rows.
- Define durable project truth separately from ephemeral operations/debugging data.
- Define memory approval policy.
- Define what old tools become obsolete.
- Rewrite JDC Context Engine system-prompt segment so explicit memory save/search routes are `JdcMemoryWrite` and `JdcMemorySearch`, not legacy `SaveMemory`.
- Expand `JdcMemoryWrite`, `JdcMemorySearch`, `JdcContextInspect`, and `JdcContextRefresh` tool descriptions with persistence, citation, scope, and non-use rules.
- Remove `SaveMemory` from normal UI metadata and old-memory wording from compaction UI.
- Define UI as Chinese-first observability, not manual operation.
- Remove normal-use refresh/read buttons from the primary panel flow; use automatic reload on session switch/state change and keep manual refresh/reindex only as advanced diagnostics.
- Replace English panel copy with Chinese copy while preserving literal technical identifiers.
- Rebuild the Context panel information architecture around `当前状态`, `项目事实`, `当前上下文`, and collapsed `高级诊断`; do not keep Harvest/Health as equally prominent normal-user tabs.

Success signal:

> The team has one hard contract and no contradictory docs.

### Priority 5: Add Evals That Measure Usefulness

Required changes:

- Add fixture projects.
- Add cross-session reuse eval.
- Add project convention eval.
- Add runtime error chain eval.
- Add stale fact eval.
- Add CPU/no-harvest-on-noise eval.
- Add "reduced tool calls" eval.
- Add screenshot-regression evals for model-noop noise, duplicate diagnostics, and missing IDE snapshot severity.
- Add UI copy evals that fail when primary Context Engine panel labels/buttons regress to English or manual-refresh-first behavior.
- Add durability evals that fail if skipped, rejected, no-op, uncited, low-confidence, aborted, or timed-out harvest output appears as accepted project context or primary panel content.
- Add performance evals for context injection latency, session switch reload, renderer stream updates, DB write cost, code indexing CPU budget, and harvest rate limiting.

Success signal:

> The engine can fail a test when it is technically working but product-useless.

## Recommended Architecture Change

Add a new module:

```text
packages/core/src/context/planner.ts
```

Also add a performance governor:

```text
packages/core/src/context/scheduler.ts
packages/core/src/context/performance.ts
```

The scheduler owns:

- foreground vs background execution;
- provider timeout budgets;
- project-level harvest concurrency;
- index warmup throttling;
- cancellation on project/session switch;
- coalesced store writes;
- slow-operation diagnostics.

No provider, distiller, or UI refresh path should directly start expensive work without going through this budget layer.

Suggested API:

```ts
export interface ContextPlan {
  id: string
  requestId: string
  intent: 'chat' | 'debug' | 'code_edit' | 'review' | 'plan' | 'memory_update'
  objective: string
  requiredFacts: string[]
  relevantSections: string[]
  suppressedSections: Array<{ id: string; reason: string }>
  missingEvidence: Array<{ kind: string; reason: string }>
  diagnostics: ContextDiagnostic[]
}
```

`buildContextBundle()` should become:

```text
collect evidence -> load facts -> plan context -> rank within plan -> render plan-backed bundle
```

Not:

```text
collect evidence -> rank all sections -> render
```

This one change would make the system feel much more intentional.

## Recommended Prompt And Tool Description Change

Update:

```text
packages/core/src/context-engine/prompt.ts
packages/core/src/tools/memory-write.ts
packages/core/src/tools/memory-search.ts
packages/core/src/tools/context-inspect.ts
packages/core/src/tools/context-refresh.ts
packages/ui/src/components/tool-cards/tool-card-meta.ts
packages/ui/src/hooks/useSession.ts
```

The prompt segment should describe JDC Context Engine as one product with three surfaces:

- code intelligence: `JdcContext`, `JdcSearch`, `JdcNode`, `JdcCallers`, `JdcCallees`, `JdcImpact`, `JdcTrace`, `JdcExplore`, `JdcFiles`;
- durable project memory: `JdcMemorySearch`, `JdcMemoryWrite`;
- diagnostics and observability: `JdcContextInspect`, `JdcContextRefresh`.

Required model-facing rules:

- Do not use or mention legacy `SaveMemory` in normal operation.
- When the user explicitly asks to remember something durable, use `JdcMemoryWrite` only with a citation.
- When the user asks "what do you remember" or the current task may depend on saved project rules, use `JdcMemorySearch`.
- Default memory scope is `project` for project conventions, workflow rules, architecture decisions, known issues, and codebase preferences.
- Use `session` scope only for temporary conversation state that should not affect other sessions.
- Do not write greetings, confirmations, guesses, uncited summaries, raw reasoning, secrets, or one-off transient state.
- `JdcContextInspect` and `JdcContextRefresh` are debugging tools. The model should not require the user to click the panel or refresh context for normal work.

This change matters because the model learns behavior from tool descriptions. A production Context Engine cannot rely on the model inferring the memory contract from TypeScript schemas.

## Recommended Harvest Change

Add a router:

```text
packages/core/src/context/harvest-router.ts
```

Suggested behavior:

- Deterministically skip obvious no-value turns.
- If tool failures exist, route to runtime narrative.
- If files changed, route to project/code task update.
- If user confirmed a durable rule/decision/preference, route to memory or decision ledger.
- If conversation goal/constraints changed, route to conversation state.
- Otherwise ask the model for a skip-or-route decision with a very small schema.

This keeps "AI decides what is worth storing" while avoiding one giant memory distiller for every substantive turn.

## Recommended Default Policy

Default should not be pure manual review.

Use:

```ts
memory: {
  trustMode: 'auto_accept_high_confidence',
  minConfidence: 0.86,
}
```

But only auto-accept:

- project conventions;
- architecture decisions;
- workflow rules;
- project profile updates;
- code entrypoints with file citations;
- runtime error chains with tool citations.

Keep manual review for:

- global memories;
- user preference memories;
- low-confidence facts;
- facts without file/tool/message citations;
- facts that mention secrets, credentials, or hidden reasoning.

## What Can Be Removed After The Real Engine Works

Do not remove these yet. They should be removed only after the production engine passes cross-session and behavior evals.

Candidates:

- Legacy compact-memory extraction path, already mostly disabled.
- Legacy `SaveMemory` tool, already removed from normal registry.
- Any system prompt text telling the model to manually save memory through old tools.
- Manual "remember this" workflows that duplicate `JdcMemoryWrite`, if `JdcMemoryWrite` remains reliable.
- User-facing refresh/reindex copy that implies the user must operate the engine.
- Separate memory files outside project `.jdcagnet`, if any remain.

Keep:

- `JdcMemoryWrite` as an explicit model/user escape hatch.
- `JdcMemorySearch` as an inspectable retrieval tool.
- `JdcContextInspect` and `JdcContextRefresh` as diagnostics, not primary workflow.
- Existing `JdcSearch`, `JdcRead`, and code intelligence tools.

## Final Judgment

The current engine is worth saving because the foundations are pointing in the right direction:

- project-local persistence;
- current-session model binding;
- protocol-aware harvest;
- citation validation;
- stale/expiry handling;
- inspectability;
- code index integration;
- agent/team wiring.

But it is not yet a production-grade JDC Context Engine because it lacks the layer that matters most: task-aware context planning and high-signal durable learning.

If we keep adding providers and panels, it will stay noisy.

If we add planner, router, high-confidence auto-accept, project intelligence distillers, and behavior evals, it can become the thing the name promises.

The next engineering move should be:

> Stop expanding the panel. Build the planner and harvest router. Then prove usefulness with cross-session evals.

## Feasibility: Can It Become Invisible And Increasingly Useful?

Yes, but only if the engine is built as three closed loops instead of a panel plus background jobs.

### Loop 1: Invisible Foreground Context

Before each model turn, the engine should cheaply select already-available project facts, current intent, IDE/runtime state, and relevant code hints. It must not block the chat or wait for expensive work.

If something is slow, the engine should degrade silently:

```text
good:
  context available -> inject useful bundle
  context slow/unavailable -> continue chat without drama

bad:
  user sends message -> engine scans/indexes/harvests -> CPU spikes or first token waits
```

This loop makes the user feel: "It just understands the project."

### Loop 2: Background Learning

After a meaningful runLoop completes, the engine should decide whether anything durable was learned. High-confidence, cited, project-level facts are accepted. Garbage is skipped. Risky items go to review or advanced diagnostics.

This learning must be project-level:

```text
session A learns project convention
session B in same project uses it
app restarts
session C still uses it
```

This loop makes the user feel: "It remembers the right things without me managing it."

### Loop 3: Evals And Feedback

The engine must test whether it is actually helping:

- fewer repeated project-discovery tool calls;
- fewer repeated user reminders;
- faster correct file targeting;
- better cross-session convention reuse;
- no CPU spikes on normal chat;
- no garbage memories in the main panel;
- no English/debug-console UI regression.

This loop makes the product improve instead of merely accumulate data.

## What Would Make It Fail

The design will not achieve "invisible and increasingly useful" if the team ships only these parts:

- more providers without a planner;
- harvest jobs without routing and auto-accept policy;
- a panel full of skipped/rejected/no-op records;
- manual refresh/reindex as normal workflow;
- memory stored per session instead of per project;
- no performance budget;
- no product evals;
- English debug labels in a Chinese-first UI;
- durable storage that mixes final facts with failed attempts.

That version will keep feeling like "it runs, but why should I care?"

## What Would Prove It Works

A production-ready JDC Context Engine should pass this user story:

> In session A, the user says the project convention is "上线前必须跑 pnpm build". The engine stores it as a cited project convention. In session B, after app restart, the user asks for a code change. The assistant finishes the change and naturally runs or reminds about `pnpm build` without the user repeating the convention. The UI does not require any refresh click. CPU stays normal. The Context panel, if opened, shows the accepted project convention in Chinese under 项目事实.

If that story works reliably, the engine is becoming the right product.

If that story fails, the engine is still mostly infrastructure.
