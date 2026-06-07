# JDC Agent Constraint Engine Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Chinese-first UI observability for the JDC Agent Constraint Engine so users can see evidence, blocked actions, verification, model profile, and context/index health without managing internal diagnostics.

**Architecture:** Build a core constraint-observability snapshot from the existing in-memory policy and verification ledgers, enrich it with the latest Context Inspect payload, expose it through SessionManager IPC, then render it as a new tab in the existing Context panel. Phase 7 is read-only observability: it must not change file mutation gates, verification gates, context retrieval, or model behavior.

**Tech Stack:** TypeScript, Vitest, React, Zustand, Electron IPC, existing `ContextInspectPayload`, existing `ConstraintPolicyRuntime`, existing `VerificationLedger`, existing Context panel primitives.

---

## Source Documents

- Design: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`
- Phase 6 plan: `docs/superpowers/plans/2026-06-07-jdc-agent-constraint-engine-phase6.md`
- Latest Phase 6 fix: `7da37ac fix: propagate model profiles to agent and team contexts`

## Scope

This plan covers Phase 7 only:

- core constraint observability snapshot;
- session/runtime inspection method;
- Electron IPC and preload access;
- Zustand state wiring;
- Chinese-first constraint status panel;
- advanced/debug raw event view;
- focused tests and design document update.

This plan intentionally does not implement:

- persistence of long-term policy records beyond the existing process ledgers;
- Repo Wiki;
- model-assisted final-claim checking;
- hidden automatic verification command execution;
- new write gates or changed gate semantics;
- a separate operator console outside the existing Inspector/Context panel.

## Key Design Decisions

1. **Read-only:** Phase 7 reads runtime state. It must not decide whether tools can run.
2. **One product snapshot:** UI should consume a product-owned `ConstraintObservabilitySnapshot`, not reconstruct policy logic from raw ledgers.
3. **Chinese-first primary UI:** The default tab uses Chinese labels and plain task language. Literal paths, commands, model ids, tool names, and provider ids stay as-is.
4. **Debug stays advanced:** Raw policy events, raw verification requirements, and context diagnostics are shown only in the advanced/debug surface.
5. **Fail-open UI:** If inspection fails, chat and tools continue. The panel shows "约束状态暂不可用" with a diagnostic.

## File Boundary Map

Create:

- `packages/core/src/constraints/observability.ts`
- `packages/core/src/constraints/observability.test.ts`
- `packages/ui/src/components/context/ConstraintStatusPanel.tsx`
- `packages/ui/src/components/context/ConstraintStatusPanel.test.tsx`

Modify:

- `packages/core/src/index.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session-context.test.ts`
- `packages/electron/src/ipc-channels.ts`
- `packages/electron/src/ipc-handlers.ts`
- `packages/electron/src/preload.ts`
- `packages/electron/src/session-manager.ts`
- `packages/ui/src/stores/context-store.ts`
- `packages/ui/src/stores/context-store.test.tsx`
- `packages/ui/src/components/context/ContextPanel.tsx`
- `packages/ui/src/components/context/ContextPanelLayout.tsx`
- `packages/ui/src/components/context/ContextPanelPrimitives.tsx`
- `packages/ui/src/components/context/context-panels.test.tsx`
- `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

## Global Acceptance Gates

Run after the final task:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/observability.test.ts src/session-context.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx src/components/context/ConstraintStatusPanel.test.tsx src/components/context/context-panels.test.tsx --no-file-parallelism
pnpm --filter @jdcagnet/ui build
pnpm --filter @jdcagnet/core test -- --run --no-file-parallelism
git diff --check
```

Expected final result: all commands pass.

---

## Task 1: Core Constraint Observability Snapshot

**Goal:** Create a stable product snapshot type that summarizes policy events, evidence state, verification state, context health, and model profile without exposing raw internal ledgers to UI code.

**Files:**

- Create: `packages/core/src/constraints/observability.ts`
- Create: `packages/core/src/constraints/observability.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add failing observability tests**

Create `packages/core/src/constraints/observability.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ConstraintPolicyRuntime } from './policy-runtime.js'
import { buildConstraintObservabilitySnapshot } from './observability.js'
import { FileReadStateCache } from '../file-read-state.js'

describe('buildConstraintObservabilitySnapshot', () => {
  it('reports blocked write attempts as the primary status', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 1_700_000_000_000 })
    const fileReadState = new FileReadStateCache()

    runtime.preToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: 'src/app.ts', old_string: 'old', new_string: 'new' },
      cwd: '/repo',
      fileReadState,
    })

    const snapshot = buildConstraintObservabilitySnapshot({
      runtime,
      cwd: '/repo',
      inspectedAt: 1_700_000_000_500,
    })

    expect(snapshot.status).toBe('blocked')
    expect(snapshot.blockedActions).toEqual([
      expect.objectContaining({
        toolName: 'Edit',
        toolUseId: 'edit_1',
        reason: expect.stringContaining('Read'),
      }),
    ])
    expect(snapshot.summary.primary).toBe('有操作被约束拦截')
  })

  it('reports pending verification after mutations', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 100 })
    runtime.verificationLedger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })

    const snapshot = buildConstraintObservabilitySnapshot({
      runtime,
      cwd: '/repo',
      inspectedAt: 150,
    })

    expect(snapshot.status).toBe('needs_verification')
    expect(snapshot.verification.status).toBe('pending')
    expect(snapshot.verification.changedFiles).toEqual([
      expect.objectContaining({ filePath: 'packages/core/src/session.ts', status: 'pending' }),
    ])
  })

  it('reports verified files when a covering command passed', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 100 })
    runtime.verificationLedger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })
    runtime.verificationLedger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm --filter @jdcagnet/core test',
      kind: 'test',
      status: 'passed',
      output: 'ok',
    })

    const snapshot = buildConstraintObservabilitySnapshot({
      runtime,
      cwd: '/repo',
      inspectedAt: 200,
    })

    expect(snapshot.status).toBe('verified')
    expect(snapshot.verification.status).toBe('passed')
    expect(snapshot.verification.changedFiles[0]).toMatchObject({ status: 'verified', verifiedByToolUseId: 'bash_1' })
  })

  it('derives missing evidence from the latest agent contract section', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 100 })
    const snapshot = buildConstraintObservabilitySnapshot({
      runtime,
      cwd: '/repo',
      inspectedAt: 200,
      context: {
        status: 'available',
        inspectedAt: 200,
        bundle: {
          id: 'ctx_1',
          sessionId: 'session_1',
          requestHash: 'hash',
          createdAt: 150,
          sections: [{
            id: 'agent_contract_1',
            kind: 'agent_contract',
            title: 'Agent run contract',
            content: [
              'Agent run contract',
              'Intent: code_edit',
              'Objective: Fix login bug',
              'Model profile: strict_tool_grounding',
              'Evidence strictness: strict',
              'Missing evidence:',
              '- relevant_code: Code edit turns need target file or symbol evidence before mutation.',
              'Policy: Existing files must be read with fresh content before mutation.',
            ].join('\n'),
            citations: [],
            priority: 100,
            confidence: 1,
            freshness: 'live',
            sourceProvider: 'JdcAgentConstraintEngine',
            tokenEstimate: 80,
            tokenCost: { tokenEstimate: 80 },
          }],
          citations: [],
          diagnostics: [],
          budget: { usedTokens: 80, droppedTokens: 0 },
        },
        acceptedProjectFacts: [],
        droppedSections: [],
        providerHealth: [],
        providerTimings: [],
        harvestQueue: { jobs: [], summary: { queued: 0, classified: 0, distilling: 0, validating: 0, accepted: 0, pending_review: 0, rejected: 0, skipped: 0, failed: 0 } },
        memoryReview: { rejected: [] },
        diagnostics: [],
      },
    })

    expect(snapshot.intent).toBe('code_edit')
    expect(snapshot.objective).toBe('Fix login bug')
    expect(snapshot.evidence.status).toBe('missing')
    expect(snapshot.evidence.missing[0]).toMatchObject({ kind: 'relevant_code' })
    expect(snapshot.modelProfile).toMatchObject({ id: 'strict_tool_grounding', evidenceStrictness: 'strict' })
  })
})
```

- [ ] **Step 2: Run the observability test and verify it fails**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/observability.test.ts --no-file-parallelism
```

Expected: FAIL because `observability.ts` does not exist.

- [ ] **Step 3: Implement the snapshot builder**

Create `packages/core/src/constraints/observability.ts`:

```ts
import type { ContextInspectPayload } from '../tools/context-inspect.js'
import type { ModelCapabilityProfile } from '../model-profile.js'
import type { ConstraintPolicyRuntime } from './policy-runtime.js'
import type { PolicyEvent } from './policy-events.js'
import type { ChangedFileRecord, VerificationCommandRecord, VerificationRequirementRecord } from './verification-ledger.js'

export type ConstraintObservabilityStatus =
  | 'idle'
  | 'checking'
  | 'blocked'
  | 'needs_evidence'
  | 'needs_verification'
  | 'verified'
  | 'failed'
  | 'unavailable'

export interface ConstraintEvidenceSummary {
  status: 'not_required' | 'satisfied' | 'missing'
  missing: Array<{ kind: string; reason: string }>
}

export interface ConstraintVerificationSummary {
  status: 'not_required' | 'pending' | 'passed' | 'failed' | 'unavailable'
  changedFiles: ChangedFileRecord[]
  requirements: VerificationRequirementRecord[]
  commands: VerificationCommandRecord[]
}

export interface ConstraintContextHealthSummary {
  status: ContextInspectPayload['status'] | 'not_reported'
  latestBundleId?: string
  providerCount: number
  unhealthyProviderCount: number
  diagnostics: ContextInspectPayload['diagnostics']
}

export interface ConstraintModelProfileSummary {
  id: string
  label?: string
  evidenceStrictness?: string
  maxParallelToolCalls?: number
}

export interface ConstraintObservabilitySnapshot {
  status: ConstraintObservabilityStatus
  inspectedAt: number
  cwd: string
  intent?: string
  objective?: string
  modelProfile?: ConstraintModelProfileSummary
  summary: {
    primary: string
    secondary: string
  }
  evidence: ConstraintEvidenceSummary
  blockedActions: PolicyEvent[]
  verification: ConstraintVerificationSummary
  contextHealth: ConstraintContextHealthSummary
  policyEvents: PolicyEvent[]
}

export interface BuildConstraintObservabilitySnapshotInput {
  runtime: ConstraintPolicyRuntime
  cwd: string
  inspectedAt?: number
  context?: ContextInspectPayload | null
  modelProfile?: ModelCapabilityProfile
}

export function buildConstraintObservabilitySnapshot(input: BuildConstraintObservabilitySnapshotInput): ConstraintObservabilitySnapshot {
  const inspectedAt = input.inspectedAt ?? Date.now()
  const policyEvents = input.runtime.policyEvents.list()
  const blockedActions = policyEvents.filter((event) => event.decision === 'block')
  const changedFiles = input.runtime.verificationLedger.getChangedFiles()
  const requirements = input.runtime.verificationLedger.getRequirements()
  const commands = input.runtime.verificationLedger.getCommands()
  const contract = extractAgentContract(input.context)
  const evidence = evidenceSummary(contract)
  const verification = verificationSummary(changedFiles, requirements, commands)
  const contextHealth = contextHealthSummary(input.context)
  const modelProfile = modelProfileSummary(input.modelProfile, contract)
  const status = deriveStatus({ blockedActions, evidence, verification, contextHealth })

  return {
    status,
    inspectedAt,
    cwd: input.cwd,
    intent: contract.intent,
    objective: contract.objective,
    modelProfile,
    summary: statusSummary(status, evidence, verification, contextHealth),
    evidence,
    blockedActions,
    verification,
    contextHealth,
    policyEvents,
  }
}

function deriveStatus(input: {
  blockedActions: PolicyEvent[]
  evidence: ConstraintEvidenceSummary
  verification: ConstraintVerificationSummary
  contextHealth: ConstraintContextHealthSummary
}): ConstraintObservabilityStatus {
  if (input.blockedActions.length > 0) return 'blocked'
  if (input.evidence.status === 'missing') return 'needs_evidence'
  if (input.verification.status === 'failed') return 'failed'
  if (input.verification.status === 'pending') return 'needs_verification'
  if (input.verification.status === 'passed') return 'verified'
  if (input.contextHealth.status === 'unavailable') return 'unavailable'
  return 'idle'
}

function verificationSummary(
  changedFiles: ChangedFileRecord[],
  requirements: VerificationRequirementRecord[],
  commands: VerificationCommandRecord[],
): ConstraintVerificationSummary {
  if (requirements.some((requirement) => requirement.status === 'failed') || changedFiles.some((file) => file.status === 'failed')) {
    return { status: 'failed', changedFiles, requirements, commands }
  }
  if (requirements.some((requirement) => requirement.status === 'pending' || requirement.status === 'unavailable') || changedFiles.some((file) => file.status === 'pending')) {
    return { status: 'pending', changedFiles, requirements, commands }
  }
  if (changedFiles.length > 0 || requirements.length > 0) return { status: 'passed', changedFiles, requirements, commands }
  return { status: 'not_required', changedFiles, requirements, commands }
}

interface ExtractedAgentContract {
  intent?: string
  objective?: string
  modelProfileId?: string
  evidenceStrictness?: string
  missing: Array<{ kind: string; reason: string }>
}

function extractAgentContract(context?: ContextInspectPayload | null): ExtractedAgentContract {
  const section = context?.bundle?.sections.find((item) => item.kind === 'agent_contract')
  if (!section) return { missing: [] }

  const lines = section.content.split('\n')
  const missing: Array<{ kind: string; reason: string }> = []
  for (const line of lines) {
    const missingMatch = line.match(/^- ([^:]+):\s*(.+)$/)
    if (missingMatch) missing.push({ kind: missingMatch[1], reason: missingMatch[2] })
  }

  return {
    intent: valueAfterPrefix(lines, 'Intent: '),
    objective: valueAfterPrefix(lines, 'Objective: '),
    modelProfileId: valueAfterPrefix(lines, 'Model profile: '),
    evidenceStrictness: valueAfterPrefix(lines, 'Evidence strictness: '),
    missing,
  }
}

function valueAfterPrefix(lines: string[], prefix: string): string | undefined {
  const line = lines.find((item) => item.startsWith(prefix))
  return line ? line.slice(prefix.length).trim() : undefined
}

function evidenceSummary(contract: ExtractedAgentContract): ConstraintEvidenceSummary {
  if (contract.missing.length > 0) return { status: 'missing', missing: contract.missing }
  return { status: 'not_required', missing: [] }
}

function contextHealthSummary(context?: ContextInspectPayload | null): ConstraintContextHealthSummary {
  if (!context) return { status: 'not_reported', providerCount: 0, unhealthyProviderCount: 0, diagnostics: [] }
  const unhealthy = context.providerHealth.filter((provider) => (
    provider.status === 'failed' ||
    provider.status === 'timeout' ||
    provider.status === 'rate_limited' ||
    provider.status === 'stale' ||
    provider.status === 'not_indexed'
  ))
  return {
    status: context.status,
    latestBundleId: context.bundle?.id,
    providerCount: context.providerHealth.length,
    unhealthyProviderCount: unhealthy.length,
    diagnostics: context.diagnostics,
  }
}

function modelProfileSummary(
  profile: ModelCapabilityProfile | undefined,
  contract: ExtractedAgentContract,
): ConstraintModelProfileSummary | undefined {
  if (profile) {
    return {
      id: profile.id,
      label: profile.label,
      evidenceStrictness: profile.evidenceStrictness,
      maxParallelToolCalls: profile.maxParallelToolCalls,
    }
  }
  if (!contract.modelProfileId) return undefined
  return {
    id: contract.modelProfileId,
    evidenceStrictness: contract.evidenceStrictness,
  }
}

function statusSummary(
  status: ConstraintObservabilityStatus,
  evidence: ConstraintEvidenceSummary,
  verification: ConstraintVerificationSummary,
  contextHealth: ConstraintContextHealthSummary,
): ConstraintObservabilitySnapshot['summary'] {
  if (status === 'blocked') return { primary: '有操作被约束拦截', secondary: '模型需要先补齐文件证据或调整工具调用。' }
  if (status === 'needs_evidence') return { primary: '还缺少行动证据', secondary: `${evidence.missing.length} 项证据仍需补齐。` }
  if (status === 'needs_verification') return { primary: '修改等待验证', secondary: `${verification.changedFiles.length} 个文件需要验证。` }
  if (status === 'failed') return { primary: '验证失败', secondary: '最近的验证命令失败，需要修复或说明。' }
  if (status === 'verified') return { primary: '修改已验证', secondary: '当前已记录覆盖修改的验证。' }
  if (status === 'unavailable') return { primary: '约束状态暂不可用', secondary: contextHealth.diagnostics[0]?.message ?? '无法读取上下文状态。' }
  return { primary: '约束状态正常', secondary: '没有未处理的阻塞、证据缺口或验证缺口。' }
}
```

- [ ] **Step 4: Export the snapshot API**

Modify `packages/core/src/index.ts`:

```ts
export {
  buildConstraintObservabilitySnapshot,
  type ConstraintObservabilitySnapshot,
  type ConstraintObservabilityStatus,
} from './constraints/observability.js'
```

- [ ] **Step 5: Run focused core test**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/observability.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/constraints/observability.ts packages/core/src/constraints/observability.test.ts packages/core/src/index.ts
git commit -m "feat(core): add constraint observability snapshot"
```

---

## Task 2: Session And IPC Inspection

**Goal:** Expose the constraint snapshot through Session, SessionManager, and Electron IPC while reusing the latest Context Inspect payload for context health and agent contract evidence.

**Files:**

- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session-context.test.ts`
- Modify: `packages/electron/src/ipc-channels.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`
- Modify: `packages/electron/src/preload.ts`
- Modify: `packages/electron/src/session-manager.ts`

- [ ] **Step 1: Add failing Session inspection test**

Add to `packages/core/src/session-context.test.ts` inside `Session JDC Context Engine runtime integration`:

```ts
it('inspects the current constraint runtime for UI observability', async () => {
  const session = await makeSession()
  const runtime = (session as any).toolRunner.constraintRuntime
  runtime.verificationLedger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })

  const snapshot = session.inspectConstraints({
    status: 'empty',
    inspectedAt: 200,
    bundle: null,
    acceptedProjectFacts: [],
    droppedSections: [],
    providerHealth: [],
    providerTimings: [],
    harvestQueue: { jobs: [], summary: { queued: 0, classified: 0, distilling: 0, validating: 0, accepted: 0, pending_review: 0, rejected: 0, skipped: 0, failed: 0 } },
    memoryReview: { rejected: [] },
    diagnostics: [],
  })

  expect(snapshot.status).toBe('needs_verification')
  expect(snapshot.cwd).toBe((session as any).config.cwd)
  expect(snapshot.verification.changedFiles[0]).toMatchObject({ filePath: 'packages/core/src/session.ts' })
})
```

- [ ] **Step 2: Run the Session test and verify it fails**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: FAIL because `Session.inspectConstraints()` does not exist.

- [ ] **Step 3: Implement Session inspection**

Modify `packages/core/src/session.ts` imports:

```ts
import type { ContextInspectPayload } from './tools/context-inspect.js'
import { buildConstraintObservabilitySnapshot, type ConstraintObservabilitySnapshot } from './constraints/observability.js'
```

Add this method inside `Session`:

```ts
  inspectConstraints(context?: ContextInspectPayload | null): ConstraintObservabilitySnapshot {
    return buildConstraintObservabilitySnapshot({
      runtime: this.toolRunner.constraintRuntime,
      cwd: this.config.cwd,
      context,
      modelProfile: this.config.modelConfig.modelProfile ?? this.modelProfile,
    })
  }
```

- [ ] **Step 4: Add Electron IPC channel**

Modify `packages/electron/src/ipc-channels.ts`:

```ts
  CONSTRAINT_INSPECT: 'constraint:inspect',
```

Place it near the JDC Context Engine channels.

- [ ] **Step 5: Add SessionManager inspection method**

Modify `packages/electron/src/session-manager.ts` imports:

```ts
  openContextStore,
  inspectContext,
  ContextInspectPayloadSchema,
  type ConstraintObservabilitySnapshot,
```

Add:

```ts
  async inspectConstraints(sessionId: string): Promise<ConstraintObservabilitySnapshot> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const cwd = session.getCwd()
    const store = await openContextStore({ cwd })
    const context = ContextInspectPayloadSchema.parse(await inspectContext({ sessionId }, { store, cwd }))
    return session.inspectConstraints(context)
  }
```

If `Session.getCwd()` does not exist, add it to `packages/core/src/session.ts`:

```ts
  getCwd(): string {
    return this.config.cwd
  }
```

- [ ] **Step 6: Add IPC handler and preload helper**

Modify `packages/electron/src/ipc-handlers.ts`:

```ts
  ipcMain.handle(IPC_CHANNELS.CONSTRAINT_INSPECT, async (_event, { sessionId }) => {
    if (!sessionId) throw new Error('sessionId is required')
    return sessionManager.inspectConstraints(sessionId)
  })
```

Modify `packages/electron/src/preload.ts`:

```ts
  constraintInspect: (sessionId: string) => ipcRenderer.invoke('constraint:inspect', { sessionId }),
```

The generic `invoke()` remains available; this helper is for typed app code and tests.

- [ ] **Step 7: Run focused core/electron type checks**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts src/constraints/observability.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/electron build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/session-context.test.ts packages/electron/src/ipc-channels.ts packages/electron/src/ipc-handlers.ts packages/electron/src/preload.ts packages/electron/src/session-manager.ts
git commit -m "feat(electron): expose constraint inspection"
```

---

## Task 3: UI Store Wiring

**Goal:** Load the constraint snapshot alongside existing context inspection data and keep session-switch behavior race-safe.

**Files:**

- Modify: `packages/ui/src/stores/context-store.ts`
- Modify: `packages/ui/src/stores/context-store.test.tsx`

- [ ] **Step 1: Add failing store tests**

Add to `packages/ui/src/stores/context-store.test.tsx`:

```ts
it('loads constraint inspection with project context', async () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'context:inspect') return inspectPayload
    if (channel === 'context:memory:list') return { results: [] }
    if (channel === 'context:providers:health') return []
    if (channel === 'constraint:inspect') {
      return {
        status: 'needs_verification',
        inspectedAt: 1_700_000_000_000,
        cwd: '/repo',
        summary: { primary: '修改等待验证', secondary: '1 个文件需要验证。' },
        evidence: { status: 'not_required', missing: [] },
        blockedActions: [],
        verification: {
          status: 'pending',
          changedFiles: [{ filePath: 'src/app.ts', changedByToolUseId: 'edit_1', changedAt: 1, status: 'pending', updatedAt: 1 }],
          requirements: [],
          commands: [],
        },
        contextHealth: { status: 'available', latestBundleId: 'ctx_1', providerCount: 0, unhealthyProviderCount: 0, diagnostics: [] },
        policyEvents: [],
      }
    }
    throw new Error(`Unexpected channel ${channel}`)
  })
  ;(window as any).electronAPI = { invoke }

  await useContextStore.getState().loadProjectContext({ sessionId: 'sess-1' })

  expect(invoke).toHaveBeenCalledWith('constraint:inspect', { sessionId: 'sess-1' })
  expect(useContextStore.getState().constraint.data?.status).toBe('needs_verification')
})

it('does not let stale constraint inspect results overwrite the active session', async () => {
  let resolveFirst!: (value: unknown) => void
  const firstConstraint = new Promise(resolve => { resolveFirst = resolve })
  const invoke = vi.fn((channel: string, input: any) => {
    if (channel === 'context:inspect') return Promise.resolve({ ...inspectPayload, inspectedAt: input.sessionId === 'session_b' ? 2 : 1 })
    if (channel === 'context:memory:list') return Promise.resolve({ results: [] })
    if (channel === 'context:providers:health') return Promise.resolve([])
    if (channel === 'constraint:inspect' && input.sessionId === 'session_a') return firstConstraint
    if (channel === 'constraint:inspect' && input.sessionId === 'session_b') {
      return Promise.resolve({
        status: 'verified',
        inspectedAt: 2,
        cwd: '/repo',
        summary: { primary: '修改已验证', secondary: '当前已记录覆盖修改的验证。' },
        evidence: { status: 'not_required', missing: [] },
        blockedActions: [],
        verification: { status: 'passed', changedFiles: [], requirements: [], commands: [] },
        contextHealth: { status: 'available', providerCount: 0, unhealthyProviderCount: 0, diagnostics: [] },
        policyEvents: [],
      })
    }
    return Promise.resolve(null)
  })
  ;(window as any).electronAPI = { invoke }

  const first = useContextStore.getState().loadProjectContext({ sessionId: 'session_a' })
  await useContextStore.getState().loadProjectContext({ sessionId: 'session_b' })
  resolveFirst({
    status: 'blocked',
    inspectedAt: 1,
    cwd: '/repo',
    summary: { primary: '有操作被约束拦截', secondary: '旧会话结果' },
    evidence: { status: 'not_required', missing: [] },
    blockedActions: [],
    verification: { status: 'not_required', changedFiles: [], requirements: [], commands: [] },
    contextHealth: { status: 'available', providerCount: 0, unhealthyProviderCount: 0, diagnostics: [] },
    policyEvents: [],
  })
  await first

  expect(useContextStore.getState().constraint.data?.status).toBe('verified')
})
```

- [ ] **Step 2: Run store tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx --no-file-parallelism
```

Expected: FAIL because `constraint` state is not present.

- [ ] **Step 3: Add constraint request state**

Modify `packages/ui/src/stores/context-store.ts`:

```ts
import type { ConstraintObservabilitySnapshot, ContextInspectPayload, ContextRefreshInput, ContextRefreshPayload, MemorySearchPayload } from '@jdcagnet/core'
```

Add:

```ts
export type ConstraintInspectState = ConstraintObservabilitySnapshot
```

Extend `ContextStoreState`:

```ts
  constraint: ContextRequestState<ConstraintInspectState>
  loadConstraintInspect: (input: { sessionId: string }) => Promise<void>
```

Add `constraint` to `ContextRequestKey` and `requestTokens`.

Initialize:

```ts
  constraint: emptyRequest(),
```

In `loadProjectContext`, create a `constraintToken`, set `constraint.loading`, and include:

```ts
invokeContract<ConstraintInspectState>('constraint:inspect', { sessionId }),
```

When the promise resolves, write:

```ts
...(currentSession && isLatestRequest('constraint', constraintToken)
  ? constraintData
    ? { constraint: { data: constraintData, loading: false, error: null, loadedAt } }
    : { constraint: { ...state.constraint, data: null, loading: false, error: constraintError } }
  : {}),
```

Add `loadConstraintInspect` using the same request-token pattern as `loadProviderHealth`.

Reset must include:

```ts
constraint: emptyRequest(),
```

- [ ] **Step 4: Run store tests**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/stores/context-store.ts packages/ui/src/stores/context-store.test.tsx
git commit -m "feat(ui): load constraint observability state"
```

---

## Task 4: Chinese-First Constraint Status Panel

**Goal:** Render a primary, non-operator UI surface for constraint state in the existing Context panel.

**Files:**

- Create: `packages/ui/src/components/context/ConstraintStatusPanel.tsx`
- Create: `packages/ui/src/components/context/ConstraintStatusPanel.test.tsx`
- Modify: `packages/ui/src/components/context/ContextPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextPanelLayout.tsx`
- Modify: `packages/ui/src/components/context/ContextPanelPrimitives.tsx`
- Modify: `packages/ui/src/components/context/context-panels.test.tsx`

- [ ] **Step 1: Add failing panel tests**

Create `packages/ui/src/components/context/ConstraintStatusPanel.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConstraintStatusPanel } from './ConstraintStatusPanel'
import type { ConstraintObservabilitySnapshot } from '@jdcagnet/core'

function snapshot(overrides: Partial<ConstraintObservabilitySnapshot> = {}): ConstraintObservabilitySnapshot {
  return {
    status: 'needs_verification',
    inspectedAt: 1_700_000_000_000,
    cwd: '/repo',
    intent: 'code_edit',
    objective: 'Fix login bug',
    modelProfile: { id: 'strict_tool_grounding', evidenceStrictness: 'strict', maxParallelToolCalls: 2 },
    summary: { primary: '修改等待验证', secondary: '1 个文件需要验证。' },
    evidence: { status: 'not_required', missing: [] },
    blockedActions: [],
    verification: {
      status: 'pending',
      changedFiles: [{ filePath: 'src/app.ts', changedByToolUseId: 'edit_1', changedAt: 1, status: 'pending', updatedAt: 1 }],
      requirements: [{ id: 'verify_test', kind: 'test', command: 'pnpm test', status: 'pending', files: ['src/app.ts'], reason: 'covers edit', coveredChangedAt: 1 }],
      commands: [],
    },
    contextHealth: { status: 'available', latestBundleId: 'ctx_1', providerCount: 3, unhealthyProviderCount: 1, diagnostics: [] },
    policyEvents: [],
    ...overrides,
  }
}

describe('ConstraintStatusPanel', () => {
  it('renders Chinese-first primary constraint status', () => {
    const html = renderToStaticMarkup(<ConstraintStatusPanel snapshot={snapshot()} loading={false} error={null} advancedVisible={false} />)

    expect(html).toContain('约束状态')
    expect(html).toContain('修改等待验证')
    expect(html).toContain('任务意图')
    expect(html).toContain('code_edit')
    expect(html).toContain('src/app.ts')
    expect(html).toContain('strict_tool_grounding')
  })

  it('renders blocked actions without requiring advanced mode', () => {
    const html = renderToStaticMarkup(<ConstraintStatusPanel snapshot={snapshot({
      status: 'blocked',
      summary: { primary: '有操作被约束拦截', secondary: '模型需要先补齐文件证据或调整工具调用。' },
      blockedActions: [{ id: 'policy_1', phase: 'pre_tool_use', source: 'FileMutationPolicy', decision: 'block', toolName: 'Edit', toolUseId: 'edit_1', cwd: '/repo', reason: 'File must be read first.', createdAt: 1 }],
    })} loading={false} error={null} advancedVisible={false} />)

    expect(html).toContain('被拦截的操作')
    expect(html).toContain('Edit')
    expect(html).toContain('File must be read first.')
  })

  it('shows raw policy events only in advanced mode', () => {
    const data = snapshot({
      policyEvents: [{ id: 'policy_1', phase: 'post_tool_use', source: 'VerificationLedger', decision: 'record', toolName: 'Bash', toolUseId: 'bash_1', cwd: '/repo', createdAt: 1 }],
    })
    const normal = renderToStaticMarkup(<ConstraintStatusPanel snapshot={data} loading={false} error={null} advancedVisible={false} />)
    const advanced = renderToStaticMarkup(<ConstraintStatusPanel snapshot={data} loading={false} error={null} advancedVisible />)

    expect(normal).not.toContain('原始策略事件')
    expect(advanced).toContain('原始策略事件')
    expect(advanced).toContain('VerificationLedger')
  })
})
```

- [ ] **Step 2: Run panel test and verify it fails**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/ConstraintStatusPanel.test.tsx --no-file-parallelism
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `ConstraintStatusPanel`**

Create `packages/ui/src/components/context/ConstraintStatusPanel.tsx`:

```tsx
import type { ConstraintObservabilitySnapshot } from '@jdcagnet/core'
import { Badge, formatDate, Metric, PanelFrame, PanelState, statusLabel, statusTone } from './ContextPanelPrimitives'

export function ConstraintStatusPanel({ snapshot, loading, error, advancedVisible = false }: {
  snapshot: ConstraintObservabilitySnapshot | null
  loading: boolean
  error: string | null
  advancedVisible?: boolean
}) {
  if (loading) return <PanelState title="正在读取约束状态" message="正在读取证据、拦截和验证状态。" />
  if (error) return <PanelState title="约束状态暂不可用" message={error} />
  if (!snapshot) return <PanelState title="暂无约束状态" message="等待当前会话产生约束运行状态。" />

  return (
    <PanelFrame title="约束状态" subtitle={`最近读取 ${formatDate(snapshot.inspectedAt)}`}>
      <section className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={statusTone(snapshot.status)}>{constraintStatusLabel(snapshot.status)}</Badge>
          {snapshot.modelProfile && <Badge tone="accent">{snapshot.modelProfile.id}</Badge>}
        </div>
        <div className="mt-2 whitespace-normal break-words text-[13px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{snapshot.summary.primary}</div>
        <div className="mt-1 whitespace-normal break-words text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">{snapshot.summary.secondary}</div>
      </section>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
        <Metric label="任务意图" value={snapshot.intent ?? '未报告'} />
        <Metric label="证据状态" value={evidenceLabel(snapshot.evidence.status)} />
        <Metric label="验证状态" value={verificationLabel(snapshot.verification.status)} />
        <Metric label="上下文健康" value={contextHealthLabel(snapshot)} />
      </div>

      {snapshot.objective && (
        <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">当前目标</div>
          <div className="mt-1 whitespace-normal break-words text-[12px] text-[var(--text)] [overflow-wrap:anywhere]">{snapshot.objective}</div>
        </section>
      )}

      {snapshot.evidence.missing.length > 0 && (
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">缺少的证据</div>
          {snapshot.evidence.missing.map((item, index) => (
            <div key={`${item.kind}_${index}`} className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <div className="font-mono text-[11px] text-[var(--text)]">{item.kind}</div>
              <div className="mt-1 whitespace-normal break-words text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">{item.reason}</div>
            </div>
          ))}
        </section>
      )}

      {snapshot.blockedActions.length > 0 && (
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">被拦截的操作</div>
          {snapshot.blockedActions.map((event) => (
            <div key={event.id} className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge tone="bad">{event.toolName}</Badge>
                <span className="font-mono text-[10px] text-[var(--muted)]">{event.toolUseId || 'unknown'}</span>
              </div>
              {event.reason && <div className="mt-1 whitespace-normal break-words text-[11px] text-[var(--text)] [overflow-wrap:anywhere]">{event.reason}</div>}
            </div>
          ))}
        </section>
      )}

      {snapshot.verification.changedFiles.length > 0 && (
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">已修改文件</div>
          {snapshot.verification.changedFiles.map((file) => (
            <div key={file.filePath} className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 whitespace-normal break-words font-mono text-[11px] text-[var(--text)] [overflow-wrap:anywhere]">{file.filePath}</span>
                <Badge tone={file.status === 'verified' ? 'good' : file.status === 'failed' ? 'bad' : 'warn'}>{changedFileStatusLabel(file.status)}</Badge>
              </div>
              {file.verificationFailure && <div className="mt-1 whitespace-normal break-words text-[11px] text-[var(--bad)] [overflow-wrap:anywhere]">{file.verificationFailure}</div>}
            </div>
          ))}
        </section>
      )}

      {advancedVisible && snapshot.policyEvents.length > 0 && (
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">原始策略事件</div>
          {snapshot.policyEvents.map((event) => (
            <div key={event.id} className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-[10px] text-[var(--muted)]">
              {event.phase} · {event.source} · {event.decision} · {event.toolName}
            </div>
          ))}
        </section>
      )}
    </PanelFrame>
  )
}

function constraintStatusLabel(status: ConstraintObservabilitySnapshot['status']): string {
  const labels: Record<ConstraintObservabilitySnapshot['status'], string> = {
    idle: '正常',
    checking: '检查中',
    blocked: '已拦截',
    needs_evidence: '缺少证据',
    needs_verification: '等待验证',
    verified: '已验证',
    failed: '验证失败',
    unavailable: '不可用',
  }
  return labels[status]
}

function evidenceLabel(status: ConstraintObservabilitySnapshot['evidence']['status']): string {
  if (status === 'missing') return '缺少证据'
  if (status === 'satisfied') return '已满足'
  return '无需额外证据'
}

function verificationLabel(status: ConstraintObservabilitySnapshot['verification']['status']): string {
  if (status === 'not_required') return '无需验证'
  return statusLabel(status)
}

function contextHealthLabel(snapshot: ConstraintObservabilitySnapshot): string {
  if (snapshot.contextHealth.providerCount === 0) return statusLabel(snapshot.contextHealth.status)
  return `${snapshot.contextHealth.providerCount - snapshot.contextHealth.unhealthyProviderCount}/${snapshot.contextHealth.providerCount}`
}

function changedFileStatusLabel(status: string): string {
  if (status === 'verified') return '已验证'
  if (status === 'failed') return '验证失败'
  return '待验证'
}
```

- [ ] **Step 4: Wire tab into existing Context panel**

Modify `packages/ui/src/components/context/ContextPanel.tsx` to select constraint state:

```tsx
const constraint = useContextStore((state) => state.constraint)
```

Pass it into `ContextPanelLayout`.

Modify `packages/ui/src/components/context/ContextPanelLayout.tsx`:

```tsx
import { ConstraintStatusPanel } from './ConstraintStatusPanel'
import type { ConstraintInspectState } from '../../stores/context-store'
```

Extend `ContextTab`:

```ts
export type ContextTab = 'constraints' | 'understanding' | 'facts' | 'current' | 'team' | 'status' | 'advanced'
```

Set the default tab in `ContextPanel.tsx` to:

```tsx
const [tab, setTab] = useState<ContextTab>('constraints')
```

Update `contextTabs()` to include:

```ts
{ id: 'constraints' as const, label: '约束状态', badge: constraintBadge(constraint) },
```

Render:

```tsx
{effectiveTab === 'constraints' && (
  <ConstraintStatusPanel
    snapshot={constraint.data}
    loading={constraint.loading}
    error={constraint.error}
    advancedVisible={advancedVisible}
  />
)}
```

Add:

```ts
function constraintBadge(constraint: ConstraintInspectState | null): string | null {
  if (!constraint) return null
  if (constraint.status === 'blocked') return '拦截'
  if (constraint.status === 'needs_evidence') return '证据'
  if (constraint.status === 'needs_verification') return '验证'
  if (constraint.status === 'failed') return '失败'
  return null
}
```

- [ ] **Step 5: Update context panel tests**

Modify `packages/ui/src/components/context/context-panels.test.tsx` to assert the new tab label and default panel:

```tsx
it('renders the constraint status tab first', () => {
  const html = renderToStaticMarkup(
    <ContextPanelLayout
      sessionId="session_1"
      activeTab="constraints"
      onTabChange={() => undefined}
      inspect={requestState(inspectPayload)}
      constraint={requestState(constraintSnapshot)}
      harvest={requestState({ jobs: [], summary: emptyHarvestSummary })}
      memoryReview={requestState({ accepted: null, rejected: [] })}
      providerHealth={requestState([])}
      refresh={requestState(null)}
      onReloadDiagnostics={() => undefined}
      onReindexCode={() => undefined}
      onReadProviderStatus={() => undefined}
    />
  )

  expect(html).toContain('约束状态')
  expect(html).toContain('JDC 正在检查项目证据和验证工作')
})
```

Use the existing helper style in that file; if helpers are named differently, keep local conventions and only add the constraint prop.

- [ ] **Step 6: Run UI panel tests**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/ConstraintStatusPanel.test.tsx src/components/context/context-panels.test.tsx --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/context/ConstraintStatusPanel.tsx packages/ui/src/components/context/ConstraintStatusPanel.test.tsx packages/ui/src/components/context/ContextPanel.tsx packages/ui/src/components/context/ContextPanelLayout.tsx packages/ui/src/components/context/ContextPanelPrimitives.tsx packages/ui/src/components/context/context-panels.test.tsx
git commit -m "feat(ui): render constraint observability panel"
```

---

## Task 5: Product Coverage And Design Update

**Goal:** Record Phase 7 decisions and verify the end-to-end product surface with focused tests.

**Files:**

- Modify: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`
- Modify: `packages/core/src/constraints/constraint-product-evals.test.ts`

- [ ] **Step 1: Add product eval for blocked-action observability**

Modify `packages/core/src/constraints/constraint-product-evals.test.ts`:

```ts
import { buildConstraintObservabilitySnapshot } from './observability.js'
```

Add:

```ts
it('Phase 7 eval: blocked writes are visible in the constraint snapshot', async () => {
  const runner = makeRunner()
  const result = await runner.execute(
    'Edit',
    'edit_without_read',
    { file_path: 'src/app.ts', old_string: 'old', new_string: 'new' },
    () => undefined,
  )

  expect(result.isError).toBe(true)

  const snapshot = buildConstraintObservabilitySnapshot({
    runtime: runner.constraintRuntime,
    cwd: cwd,
    inspectedAt: 1_700_000_000_000,
  })

  expect(snapshot.status).toBe('blocked')
  expect(snapshot.summary.primary).toBe('有操作被约束拦截')
  expect(snapshot.blockedActions[0]).toMatchObject({
    toolName: 'Edit',
    toolUseId: 'edit_without_read',
    decision: 'block',
  })
})
```

Use the existing test fixture names in `constraint-product-evals.test.ts`; if `makeRunner()` or `cwd` are named differently, adapt to the local helpers without changing behavior.

- [ ] **Step 2: Update the design document**

Append to `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`:

```md
## Phase 7 implementation decision

- Constraint observability is exposed as a product-owned snapshot, not as UI-owned reconstruction of policy logic.
- The primary UI is Chinese-first and describes what JDC is checking: task intent, evidence, blocked actions, required verification, changed-file verification, model profile, and context/index health.
- Raw policy events, verification requirements, provider diagnostics, and bundle details remain in the advanced/debug surface.
- Phase 7 is read-only. It does not change file mutation policy, verification gates, context retrieval, or model profile resolution.
- The first implementation reads process-local policy and verification ledgers. Durable retention of policy records remains a later storage hardening step.
```

- [ ] **Step 3: Run product and UI focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/constraint-product-evals.test.ts src/constraints/observability.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx src/components/context/ConstraintStatusPanel.test.tsx src/components/context/context-panels.test.tsx --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md packages/core/src/constraints/constraint-product-evals.test.ts
git commit -m "test: cover phase 7 constraint observability"
```

---

## Task 6: Final Verification

**Goal:** Verify the whole Phase 7 slice and leave the branch ready for review.

- [ ] **Step 1: Run focused core tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/observability.test.ts src/constraints/constraint-product-evals.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 2: Run focused UI tests**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/stores/context-store.test.tsx src/components/context/ConstraintStatusPanel.test.tsx src/components/context/context-panels.test.tsx --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 3: Run builds**

Run:

```bash
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/electron build
pnpm --filter @jdcagnet/ui build
```

Expected: PASS.

- [ ] **Step 4: Run full core suite**

Run:

```bash
pnpm --filter @jdcagnet/core test -- --run --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Check whitespace and git state**

Run:

```bash
git diff --check
git status --short --branch
```

Expected:

- `git diff --check` prints nothing and exits 0.
- `git status --short --branch` shows only intended Phase 7 files before final commit, then clean after final commit.

- [ ] **Step 6: Final commit if needed**

If prior tasks left final verification-only doc updates or small fixes:

```bash
git add docs/superpowers/plans/2026-06-07-jdc-agent-constraint-engine-phase7.md docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md packages/core/src/constraints/observability.ts packages/core/src/constraints/observability.test.ts packages/core/src/constraints/constraint-product-evals.test.ts packages/core/src/index.ts packages/core/src/session.ts packages/core/src/session-context.test.ts packages/electron/src/ipc-channels.ts packages/electron/src/ipc-handlers.ts packages/electron/src/preload.ts packages/electron/src/session-manager.ts packages/ui/src/stores/context-store.ts packages/ui/src/stores/context-store.test.tsx packages/ui/src/components/context/ConstraintStatusPanel.tsx packages/ui/src/components/context/ConstraintStatusPanel.test.tsx packages/ui/src/components/context/ContextPanel.tsx packages/ui/src/components/context/ContextPanelLayout.tsx packages/ui/src/components/context/ContextPanelPrimitives.tsx packages/ui/src/components/context/context-panels.test.tsx
git commit -m "chore: finalize phase 7 constraint observability"
```

Expected: branch contains commits for core snapshot, IPC exposure, UI panel, eval/docs, and final fixes if needed.
