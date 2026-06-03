# JDC Context Engine V2 Phase 6 UI Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the JDC Context Engine inspector Chinese-first, production-safe, and user-passive: normal users see accepted project understanding, not manual refresh controls or noisy diagnostics.

**Architecture:** Keep the existing React/Zustand/Electron IPC surfaces, but split the UI into primary project-understanding panels and dev-only advanced diagnostics. Reuse `ContextInspectPayload.acceptedProjectFacts`, `MemorySearchPayload.results`, and existing provider health data; do not introduce a new IPC payload unless a test proves the existing payload cannot express the view. The main panel auto-loads project context on session switch through `loadProjectContext()`.

**Tech Stack:** React, TypeScript, Zustand, Vitest server-rendered component tests, existing Electron IPC channels, existing JDC Context Engine inspect/memory/provider payloads.

---

## Hard Product Contracts

- Do not rename `JDC Context Engine`.
- Normal users must not manage the engine through refresh/reindex buttons.
- Primary UI labels must be Chinese, except literal tool ids, provider ids, file paths, protocol ids, and model ids.
- Primary UI must show accepted project facts, current injected context summary, team-derived durable facts, known issues, workflow rules, freshness, and confidence.
- Skipped harvest, model no-op, cancelled/timeout harvest, rejected candidates, raw diagnostics, provider health internals, and raw inspect JSON stay in advanced/dev-only areas.
- Switching tabs must not clear existing health/context data.
- Switching sessions in the same project must load accepted project data again from the project store, not only from in-memory tab cache.
- UI reads must not trigger code reindex or model harvest.
- Do not add heavy animation or CPU-expensive perpetual effects to context panels.

## Current Baseline

As of `aa59da5`, these Phase 6 items are already partly present:

- Context inspector is hidden in production unless `VITE_JDC_CONTEXT_INSPECTOR=true`.
- `loadProjectContext(sessionId)` auto-loads inspect, accepted memory, and provider health together.
- Primary copy is mostly Chinese.
- Manual diagnostic controls are present only in the `高级诊断` tab.
- Existing UI tests cover Chinese labels, no old English "Read cached view/health" controls, and tab switch state retention.

Remaining gaps:

- Primary tab structure still uses `当前状态 / 项目记忆 / 当前上下文 / 高级诊断`, not the roadmap's `项目理解 / 项目记忆 / 当前上下文 / 团队沉淀 / 引擎状态`.
- Team-derived facts are mixed into generic project memory and do not have a dedicated `团队沉淀` panel.
- Advanced diagnostics are still a normal tab whenever the inspector is visible; they need a deliberate dev-only affordance instead of being part of primary navigation.
- The status panel does not clearly say "本轮已注入 N 条项目事实" or distinguish engine state from provider internals.

## File Structure

- Create: `packages/ui/src/components/context/ContextTeamPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextPanelLayout.tsx`
- Modify: `packages/ui/src/components/context/ContextInspectPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextFactsPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextCurrentPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextAdvancedDiagnosticsPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextPanelPrimitives.tsx`
- Modify: `packages/ui/src/components/context/context-panels.test.tsx`
- Modify: `packages/ui/src/stores/context-store.ts`
- Modify: `packages/ui/src/stores/context-store.test.tsx`
- Modify if needed: `packages/ui/src/components/context/ContextPanel.tsx`
- Modify if needed: `packages/ui/src/lib/context-inspector-visibility.ts`

## Data Classification Contract

Team-derived fact kinds:

- `team_decision`
- `task_result`
- `artifact_summary`
- `qa_issue`

Project-understanding fact kinds:

- `project_profile`
- `architecture_decision`
- `module_boundary`
- `project_convention`
- `workflow_rule`
- `code_entrypoint`
- `known_issue`

Memory/user fact kinds:

- `user_preference`
- `project_convention`
- `workflow_rule`
- `architecture_decision`
- `known_issue`

Primary panels may show the same fact in more than one conceptual area only when it is useful. The default rule is:

- `项目理解` shows project-understanding facts and a compact injected bundle summary.
- `项目记忆` shows accepted durable memory/search results and project facts that are memory-like.
- `团队沉淀` shows team-derived facts only.
- `当前上下文` shows the current injected bundle sections.
- `引擎状态` shows aggregate engine status, counts, freshness, and provider availability summary without raw provider diagnostics.

---

### Task 1: Lock The Phase 6 Plan And Baseline

**Files:**
- Create: `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase6-ui-diagnostics-plan.md`

- [ ] **Step 1: Save this plan**

Create the plan file with the content in this document.

- [ ] **Step 2: Verify current UI baseline**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx src/stores/context-store.test.tsx src/lib/context-inspector-visibility.test.ts --no-file-parallelism
```

Expected: PASS with 28 tests.

- [ ] **Step 3: Verify current UI build**

Run:

```bash
pnpm --filter @jdcagnet/ui build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase6-ui-diagnostics-plan.md
git commit -m "docs(context): add phase 6 UI diagnostics plan"
```

### Task 2: Add Roadmap Primary Tabs

**Files:**
- Modify: `packages/ui/src/components/context/ContextPanelLayout.tsx`
- Modify: `packages/ui/src/components/context/context-panels.test.tsx`

- [ ] **Step 1: Write failing tab structure test**

In `context-panels.test.tsx`, update the shell test to assert:

```ts
expect(html).toContain('项目理解')
expect(html).toContain('项目记忆')
expect(html).toContain('当前上下文')
expect(html).toContain('团队沉淀')
expect(html).toContain('引擎状态')
expect(html).not.toContain('高级诊断</button>')
```

Also keep the existing assertions that the UI does not contain:

```ts
expect(html).not.toContain('Read cached view')
expect(html).not.toContain('Read cached health')
expect(html).not.toContain('重新读取诊断')
expect(html).not.toContain('后台重建代码索引')
expect(html).not.toContain('读取提供方状态')
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx --no-file-parallelism
```

Expected: FAIL because current tabs are `当前状态 / 项目记忆 / 当前上下文 / 高级诊断`.

- [ ] **Step 3: Update tab ids and labels**

Change `ContextTab` in `ContextPanelLayout.tsx` to:

```ts
export type ContextTab = 'understanding' | 'facts' | 'current' | 'team' | 'status'
```

Render these primary tabs:

```ts
[
  { id: 'understanding', label: '项目理解' },
  { id: 'facts', label: '项目记忆' },
  { id: 'current', label: '当前上下文' },
  { id: 'team', label: '团队沉淀' },
  { id: 'status', label: '引擎状态' },
]
```

Do not render `高级诊断` as a primary tab.

- [ ] **Step 4: Keep tab state compatible**

If `activeTab` is an old persisted value such as `advanced`, map it to `status` in `ContextPanel.tsx` or normalize before render. Do not crash if old local state appears.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx --no-file-parallelism
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/context/ContextPanelLayout.tsx packages/ui/src/components/context/ContextPanel.tsx packages/ui/src/components/context/context-panels.test.tsx
git commit -m "feat(ui): add Chinese context primary tabs"
```

### Task 3: Add Project Understanding And Engine Status Panels

**Files:**
- Modify: `packages/ui/src/components/context/ContextInspectPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextCurrentPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextPanelLayout.tsx`
- Modify: `packages/ui/src/components/context/context-panels.test.tsx`

- [ ] **Step 1: Write failing project-understanding test**

Add a test rendering the `understanding` tab and assert the output includes:

```ts
expect(html).toContain('项目理解')
expect(html).toContain('发布前运行 pnpm build。')
expect(html).toContain('workflow_rule')
expect(html).toContain('可信度')
expect(html).not.toContain('Missing citations')
expect(html).not.toContain('Provider code exceeded context budget')
```

- [ ] **Step 2: Write failing engine-status test**

Add a test rendering the `status` tab and assert:

```ts
expect(html).toContain('引擎状态')
expect(html).toContain('本轮已注入')
expect(html).toContain('项目事实')
expect(html).toContain('提供方可用')
expect(html).not.toContain('git unavailable')
expect(html).not.toContain('IdeSignalProvider')
```

- [ ] **Step 3: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx --no-file-parallelism
```

Expected: FAIL because these labels/panels do not exist yet.

- [ ] **Step 4: Refactor `ContextInspectPanel` into mode-specific rendering**

Keep `ContextInspectPanel` as the engine status panel. It should render:

- engine availability;
- injected section count;
- accepted project fact count;
- provider availability ratio;
- used/dropped token metrics as Chinese labels;
- no raw provider diagnostic messages.

- [ ] **Step 5: Add project understanding renderer**

In `ContextPanelLayout.tsx`, render a project-understanding view for the `understanding` tab using accepted project facts from `inspect.data.acceptedProjectFacts`.

The display should prioritize:

```ts
['project_profile', 'architecture_decision', 'module_boundary', 'project_convention', 'workflow_rule', 'code_entrypoint', 'known_issue']
```

Use existing `ContextFactsPanel` helpers if clean, or add a small internal component with one responsibility.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx --no-file-parallelism
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/context/ContextInspectPanel.tsx packages/ui/src/components/context/ContextPanelLayout.tsx packages/ui/src/components/context/context-panels.test.tsx
git commit -m "feat(ui): show project understanding status"
```

### Task 4: Add Team-Derived Facts Panel

**Files:**
- Create: `packages/ui/src/components/context/ContextTeamPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextPanelLayout.tsx`
- Modify: `packages/ui/src/components/context/context-panels.test.tsx`

- [ ] **Step 1: Write failing team panel test**

Extend the sample `payload.acceptedProjectFacts` with at least:

```ts
{
  id: 'team-result-1',
  kind: 'artifact_summary',
  scope: 'project',
  content: 'Checkout task fixed validation handling.',
  citations: [{ id: 'cite-team-1', type: 'task', ref: 'task_checkout' }],
  confidence: 0.94,
  freshness: 'recent',
  sourceProvider: 'TeamLedger',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_100,
}
```

Render `activeTab="team"` and assert:

```ts
expect(html).toContain('团队沉淀')
expect(html).toContain('Checkout task fixed validation handling.')
expect(html).toContain('artifact_summary')
expect(html).not.toContain('发布前运行 pnpm build。')
expect(html).not.toContain('candidate-1')
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx --no-file-parallelism
```

Expected: FAIL because `ContextTeamPanel` does not exist and team facts are not separated.

- [ ] **Step 3: Implement `ContextTeamPanel`**

Create `ContextTeamPanel.tsx`:

```ts
import type { ContextInspectPayload } from '@jdcagnet/core'
import { Badge, formatDate, formatPercent, freshnessLabel, kindLabel, PanelFrame, PanelState } from './ContextPanelPrimitives'

const TEAM_FACT_KINDS = new Set(['team_decision', 'task_result', 'artifact_summary', 'qa_issue'])

export function ContextTeamPanel({ payload, loading, error }: {
  payload: ContextInspectPayload | null
  loading: boolean
  error: string | null
}) {
  const facts = (payload?.acceptedProjectFacts ?? []).filter((fact) => TEAM_FACT_KINDS.has(fact.kind))
  if (loading && facts.length === 0) return <PanelState title="正在读取团队沉淀" message="正在读取当前项目中已接受的团队事实。" />
  if (error && facts.length === 0) return <PanelState title="团队沉淀暂不可用" message={error} />
  return (
    <PanelFrame title="团队沉淀" subtitle={`${facts.length} 条已接受团队事实`}>
      {facts.length === 0 ? <PanelState title="暂无团队沉淀" message="Team/PM/Worker 还没有产出可复用的项目事实。" /> : (
        <div className="space-y-2">
          {facts.map((fact) => (
            <article key={fact.id} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2">
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone="neutral">{kindLabel(fact.kind)}</Badge>
                <Badge tone="neutral">{freshnessLabel(fact.freshness)}</Badge>
                <Badge tone="neutral">{formatPercent(fact.confidence)}</Badge>
              </div>
              <div className="mt-2 text-[12px] leading-relaxed text-[var(--text)]">{fact.content}</div>
              <div className="mt-2 text-[10px] text-[var(--muted)]">{formatDate(fact.updatedAt)}</div>
            </article>
          ))}
        </div>
      )}
    </PanelFrame>
  )
}
```

Adjust exact imports/types to match current primitives.

- [ ] **Step 4: Wire `team` tab**

Render `ContextTeamPanel` from `ContextPanelLayout.tsx` when `activeTab === 'team'`.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx --no-file-parallelism
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/context/ContextTeamPanel.tsx packages/ui/src/components/context/ContextPanelLayout.tsx packages/ui/src/components/context/context-panels.test.tsx
git commit -m "feat(ui): show team-derived project facts"
```

### Task 5: Move Advanced Diagnostics Behind Dev-Only Affordance

**Files:**
- Modify: `packages/ui/src/components/context/ContextPanelLayout.tsx`
- Modify: `packages/ui/src/components/context/ContextPanel.tsx`
- Modify: `packages/ui/src/components/context/context-panels.test.tsx`
- Modify if needed: `packages/ui/src/lib/context-inspector-visibility.ts`

- [ ] **Step 1: Write failing production-safe diagnostics test**

Render `ContextPanelLayout` with a new prop:

```ts
advancedVisible={false}
```

Assert:

```ts
expect(html).not.toContain('高级诊断')
expect(html).not.toContain('重新读取诊断')
expect(html).not.toContain('job-1')
expect(html).not.toContain('candidate-1')
```

Render with:

```ts
advancedVisible={true}
```

Assert:

```ts
expect(html).toContain('高级诊断')
expect(html).toContain('重新读取诊断')
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx --no-file-parallelism
```

Expected: FAIL because `advancedVisible` does not exist.

- [ ] **Step 3: Add `advancedVisible` prop**

Update `ContextPanelLayout` props:

```ts
advancedVisible?: boolean
```

When false:

- do not render advanced tab;
- do not render advanced controls;
- if active tab is advanced from old state, show `status`.

When true:

- show a small secondary `高级诊断` action or tab after primary tabs;
- keep manual buttons inside the advanced content only.

- [ ] **Step 4: Pass dev visibility from `ContextPanel`**

Use the existing inspector visibility rules or `import.meta.env.DEV` so production builds do not expose advanced diagnostics unless explicitly enabled.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx src/lib/context-inspector-visibility.test.ts --no-file-parallelism
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/context/ContextPanelLayout.tsx packages/ui/src/components/context/ContextPanel.tsx packages/ui/src/components/context/context-panels.test.tsx packages/ui/src/lib/context-inspector-visibility.ts
git commit -m "feat(ui): gate context diagnostics behind dev mode"
```

### Task 6: Store Cross-Session Loading Guard

**Files:**
- Modify: `packages/ui/src/stores/context-store.test.tsx`
- Modify if needed: `packages/ui/src/stores/context-store.ts`

- [ ] **Step 1: Write stale-session test**

Add a test proving:

- `loadProjectContext({ sessionId: 'session_a' })` starts;
- `loadProjectContext({ sessionId: 'session_b' })` starts and resolves first;
- late `session_a` responses do not overwrite `session_b` data.

Use deferred promises and assert the final store state is for `session_b`.

- [ ] **Step 2: Verify red or existing green**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx --no-file-parallelism
```

If it already passes, keep the test as a regression guard.

- [ ] **Step 3: Fix store if needed**

Use existing `requestTokens` and `activeSessionId` guards. Do not clear provider health when a tab read returns empty provider health.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx --no-file-parallelism
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/stores/context-store.ts packages/ui/src/stores/context-store.test.tsx
git commit -m "test(ui): guard context session switching"
```

### Task 7: Final UI Verification

**Files:**
- Modify if needed: any touched UI file

- [ ] **Step 1: Run UI phase tests**

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx src/stores/context-store.test.tsx src/lib/context-inspector-visibility.test.ts --no-file-parallelism
```

- [ ] **Step 2: Run UI build**

```bash
pnpm --filter @jdcagnet/ui build
```

- [ ] **Step 3: Run core smoke tests affected by payload contracts**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

- [ ] **Step 4: Run diff whitespace check**

```bash
git diff --check
```

- [ ] **Step 5: Commit any final test adjustments**

If Task 7 changes code:

```bash
git add <changed-files>
git commit -m "test(ui): cover Chinese context panel states"
```

## Acceptance Criteria

- Primary tabs are `项目理解`, `项目记忆`, `当前上下文`, `团队沉淀`, `引擎状态`.
- Advanced diagnostics are not a normal production tab.
- Normal users do not see rejected candidates, no-op diagnostics, skipped harvest, provider raw errors, or manual refresh/reindex controls.
- Team-derived facts have a dedicated panel.
- Current context view clearly communicates injected sections and citations in Chinese.
- Engine status uses aggregate, user-safe wording such as `本轮已注入 N 条项目事实`.
- Switching sessions and tabs preserves correct project data and does not clear provider health.
- UI tests and UI build pass.
