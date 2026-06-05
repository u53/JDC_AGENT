# JDC Agent Constraint Engine Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the first file mutation guard into a product-owned ToolRunner policy runtime with deterministic pre/post gates, policy events, and a minimal verification ledger.

**Architecture:** Introduce a constraint runtime under `packages/core/src/constraints/` that owns pre-tool policy checks, post-tool state updates, event recording, and command-result verification records. `ToolRunner` calls that runtime in a fixed order around permissions, plan mode, project hooks, and tool execution, while file tools expose structured result metadata instead of mutating every ledger directly.

**Tech Stack:** TypeScript, Vitest, existing `ToolRunner`, existing core tools, existing hook engine, existing `FileReadStateCache`, existing file mutation policy evaluator.

---

## Source Documents

- Design: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`
- Previous plan: `docs/superpowers/plans/2026-06-05-jdc-agent-constraint-engine-phase1-2.md`
- Current Phase 1/2 implementation commit: `614dbda feat(context): add agent constraint engine guards`
- Current P1 hardening commit: `f29ea49 fix(core): harden agent constraints and team lifecycle`

## Scope

This plan covers Phase 3 only:

- product-owned PreToolUse gate;
- product-owned PostToolUse gate;
- policy event recording;
- minimal verification ledger updates from mutation and shell tool outputs;
- predictable ordering with permissions, plan mode, hooks, and tool execution.

This plan intentionally does not implement:

- retrieval/index warmup;
- repo map or repo wiki generation;
- Stop/TurnEnd final answer gate;
- model profile registry;
- UI observability panels.

Those are Phase 4, Phase 5, Phase 6, and Phase 7 work.

## Runtime Ordering

Phase 3 locks this ordering for `ToolRunner.execute()`:

```text
1. Tool lookup.
2. Permission check.
3. Plan mode restriction.
4. Product constraint PreToolUse gate.
5. Project/user PreToolUse hooks.
6. Tool execution.
7. Product constraint PostToolUse gate.
8. Project/user PostToolUse hooks.
9. Tool completion event.
```

Important behavior:

- Product pre gates run before user hooks so user hooks never need to duplicate product safety rules.
- Product post gates run before user post hooks so hook input can observe already-normalized tool results.
- Permission denial happens before product policy events so user-denied tools do not produce product policy noise.
- Plan mode still blocks disallowed writes before product policy records mutation-specific diagnostics.

## Dependency Graph

```text
Task 1 Tool Result Metadata
  -> Task 2 Policy Events And Verification Ledger
  -> Task 3 Constraint Policy Runtime
  -> Task 4 ToolRunner Integration And Ordering
  -> Task 5 Command Verification Classification
  -> Task 6 Product Eval And Documentation Gate
```

## File Boundary Map

Create:

- `packages/core/src/constraints/policy-events.ts`
- `packages/core/src/constraints/policy-events.test.ts`
- `packages/core/src/constraints/verification-ledger.ts`
- `packages/core/src/constraints/verification-ledger.test.ts`
- `packages/core/src/constraints/tool-output-classifier.ts`
- `packages/core/src/constraints/tool-output-classifier.test.ts`
- `packages/core/src/constraints/policy-runtime.ts`
- `packages/core/src/constraints/policy-runtime.test.ts`
- `packages/core/src/constraints/constraint-product-evals.test.ts`

Modify:

- `packages/core/src/tool-registry.ts`
- `packages/core/src/tool-runner.ts`
- `packages/core/src/__tests__/tool-runner.test.ts`
- `packages/core/src/tools/file-read.ts`
- `packages/core/src/tools/file-edit.ts`
- `packages/core/src/tools/multi-edit.ts`
- `packages/core/src/tools/file-write.ts`
- `packages/core/src/tools/bash.ts`
- `packages/core/src/tools/powershell.ts`
- `packages/core/tests/tools.test.ts`
- `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

## Global Acceptance Gates

Run these after each task that touches implementation:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/policy-events.test.ts src/constraints/verification-ledger.test.ts src/constraints/tool-output-classifier.test.ts src/constraints/policy-runtime.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core exec vitest run src/__tests__/tool-runner.test.ts tests/tools.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected final result: all commands pass.

---

## Task 1: Tool Result Metadata Contract

**Goal:** Give product policy code structured read/mutation/command facts without parsing human-facing tool output.

**Files:**

- Modify: `packages/core/src/tool-registry.ts`
- Modify: `packages/core/src/tools/file-read.ts`
- Modify: `packages/core/src/tools/file-edit.ts`
- Modify: `packages/core/src/tools/multi-edit.ts`
- Modify: `packages/core/src/tools/file-write.ts`
- Modify: `packages/core/tests/tools.test.ts`

- [ ] **Step 1: Add metadata tests for file tools**

Modify `packages/core/tests/tools.test.ts` and add these tests near the existing file tool tests:

```ts
it('file_read: returns structured metadata for policy post-processing', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jdc-read-metadata-'))
  const file = path.join(tmp, 'sample.ts')
  await fs.writeFile(file, 'const alpha = 1\nconst beta = 2\n', 'utf-8')

  const result = await fileReadTool.execute({ file_path: file }, { cwd: tmp })

  expect(result.isError).not.toBe(true)
  expect(result.metadata).toEqual({
    fileRead: {
      filePath: file,
      offset: 0,
      limit: 2000,
      totalLines: 3,
      content: 'const alpha = 1\nconst beta = 2\n',
    },
  })
})

it('file_write: returns structured mutation metadata', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jdc-write-metadata-'))
  const file = path.join(tmp, 'created.ts')

  const result = await fileWriteTool.execute({ file_path: file, content: 'export const value = 1\n' }, { cwd: tmp })

  expect(result.isError).not.toBe(true)
  expect(result.metadata).toEqual({
    mutations: [{ filePath: file, kind: 'write' }],
  })
})
```

- [ ] **Step 2: Run metadata tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run tests/tools.test.ts --no-file-parallelism
```

Expected: FAIL because `ToolResult.metadata`, `fileRead`, and `mutations` metadata do not exist yet.

- [ ] **Step 3: Add `ToolResult.metadata` types**

Modify `packages/core/src/tool-registry.ts`:

```ts
import type { ToolDefinition } from './types.js'

export interface ToolHandler {
  definition: ToolDefinition
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
}

export interface ToolContext {
  cwd: string
  signal?: AbortSignal
  onProgress?: (message: string) => void
  toolUseId?: string
  fileTracker?: import('./file-tracker.js').FileTracker
  fileReadState?: import('./file-read-state.js').FileReadStateCache
  turnIndex?: number
  backgroundTasks?: import('./background-tasks.js').BackgroundTaskManager
  ideManager?: import('./ide/ide-manager.js').IdeManager
  contextEngine?: import('./context-engine/engine.js').ContextEngine
}

export interface ToolResultMetadata {
  fileRead?: {
    filePath: string
    offset: number
    limit: number
    totalLines: number
    content: string
  }
  mutations?: Array<{
    filePath: string
    kind: 'edit' | 'multi_edit' | 'write'
  }>
  command?: {
    shell: 'bash' | 'powershell'
    command: string
    exitCode: number | null
  }
}

export interface ToolResult {
  content: string
  isError?: boolean
  metadata?: ToolResultMetadata
}

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>()

  register(handler: ToolHandler): void {
    this.tools.set(handler.definition.name, handler)
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name)
  }

  getAll(): ToolHandler[] {
    return Array.from(this.tools.values())
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map(h => h.definition)
  }
}
```

- [ ] **Step 4: Add file read metadata without removing current ledger behavior**

Modify the successful return path in `packages/core/src/tools/file-read.ts` so it returns metadata:

```ts
      context.fileReadState?.recordRead(filePath, offset, limit, totalLines, content)

      const continuation = offset + lines.length < totalLines
        ? `\n\n[Showing lines ${offset + 1}-${offset + lines.length} of ${totalLines}. Use offset=${offset + lines.length} to continue.]`
        : ''

      return {
        content: numbered + continuation,
        metadata: {
          fileRead: {
            filePath,
            offset,
            limit,
            totalLines,
            content,
          },
        },
      }
```

Keep the existing direct `recordRead()` call for this task. Task 4 centralizes the post gate after the runtime exists.

- [ ] **Step 5: Add mutation metadata to file tools**

Modify successful mutation returns.

In `packages/core/src/tools/file-edit.ts`, for `replace_all` success:

```ts
        return {
          content: `Successfully replaced ${occurrences} occurrences in ${filePath}`,
          metadata: { mutations: [{ filePath, kind: 'edit' }] },
        }
```

In `packages/core/src/tools/file-edit.ts`, for single edit success:

```ts
      return {
        content: `Successfully edited ${filePath}`,
        metadata: { mutations: [{ filePath, kind: 'edit' }] },
      }
```

In `packages/core/src/tools/multi-edit.ts`, for success:

```ts
    return {
      content: `Successfully applied ${edits.length} edits to ${filePath}`,
      metadata: { mutations: [{ filePath, kind: 'multi_edit' }] },
    }
```

In `packages/core/src/tools/file-write.ts`, for success:

```ts
      return {
        content: `Successfully wrote to ${filePath}`,
        metadata: { mutations: [{ filePath, kind: 'write' }] },
      }
```

- [ ] **Step 6: Run file tool tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run tests/tools.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/core/src/tool-registry.ts packages/core/src/tools/file-read.ts packages/core/src/tools/file-edit.ts packages/core/src/tools/multi-edit.ts packages/core/src/tools/file-write.ts packages/core/tests/tools.test.ts
git commit -m "feat: expose structured tool result metadata"
```

---

## Task 2: Policy Events And Verification Ledger

**Goal:** Add small in-memory ledgers that Phase 3 runtime can update without changing session storage yet.

**Files:**

- Create: `packages/core/src/constraints/policy-events.ts`
- Create: `packages/core/src/constraints/policy-events.test.ts`
- Create: `packages/core/src/constraints/verification-ledger.ts`
- Create: `packages/core/src/constraints/verification-ledger.test.ts`

- [ ] **Step 1: Write policy event ledger tests**

Create `packages/core/src/constraints/policy-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PolicyEventLedger } from './policy-events.js'

describe('PolicyEventLedger', () => {
  it('records bounded product policy events in insertion order', () => {
    const ledger = new PolicyEventLedger({ maxEvents: 2, now: () => 123 })

    ledger.record({
      phase: 'pre_tool_use',
      source: 'FileMutationPolicy',
      decision: 'allow',
      toolName: 'Read',
      toolUseId: 'read_1',
      cwd: '/repo',
    })
    ledger.record({
      phase: 'pre_tool_use',
      source: 'FileMutationPolicy',
      decision: 'block',
      reason: 'must read file first',
      toolName: 'Edit',
      toolUseId: 'edit_1',
      cwd: '/repo',
    })
    ledger.record({
      phase: 'post_tool_use',
      source: 'VerificationLedger',
      decision: 'record',
      toolName: 'Bash',
      toolUseId: 'bash_1',
      cwd: '/repo',
    })

    expect(ledger.list().map(event => event.toolUseId)).toEqual(['edit_1', 'bash_1'])
    expect(ledger.list()[0]).toMatchObject({
      id: 'policy_123_2',
      phase: 'pre_tool_use',
      decision: 'block',
      reason: 'must read file first',
    })
  })
})
```

- [ ] **Step 2: Write verification ledger tests**

Create `packages/core/src/constraints/verification-ledger.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { VerificationLedger } from './verification-ledger.js'

describe('VerificationLedger', () => {
  it('marks changed files pending until a verification command passes', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordMutation({ filePath: '/repo/src/a.ts', toolUseId: 'edit_1' })

    expect(ledger.getChangedFiles()).toEqual([
      expect.objectContaining({
        filePath: '/repo/src/a.ts',
        status: 'pending',
        changedByToolUseId: 'edit_1',
      }),
    ])

    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm --filter @jdcagnet/core build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })

    expect(ledger.getChangedFiles()[0]).toMatchObject({
      status: 'verified',
      verifiedByToolUseId: 'bash_1',
    })
  })

  it('keeps changed files failed when verification command fails', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordMutation({ filePath: '/repo/src/a.ts', toolUseId: 'edit_1' })

    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'failed',
      output: '1 failed',
    })

    expect(ledger.getChangedFiles()[0]).toMatchObject({
      status: 'failed',
      verificationFailure: '1 failed',
    })
  })

  it('does not mark later mutations verified by earlier commands', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'passed',
      output: 'ok',
    })
    ledger.recordMutation({ filePath: '/repo/src/a.ts', toolUseId: 'edit_1' })

    expect(ledger.getChangedFiles()[0].status).toBe('pending')
  })
})
```

- [ ] **Step 3: Run ledgers tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/policy-events.test.ts src/constraints/verification-ledger.test.ts --no-file-parallelism
```

Expected: FAIL because both ledgers do not exist.

- [ ] **Step 4: Implement policy event ledger**

Create `packages/core/src/constraints/policy-events.ts`:

```ts
export type PolicyEventPhase = 'pre_tool_use' | 'post_tool_use'
export type PolicyEventDecision = 'allow' | 'block' | 'record'
export type PolicyEventSource = 'FileMutationPolicy' | 'ToolResultMetadata' | 'VerificationLedger'

export interface PolicyEvent {
  id: string
  phase: PolicyEventPhase
  source: PolicyEventSource
  decision: PolicyEventDecision
  toolName: string
  toolUseId: string
  cwd: string
  reason?: string
  createdAt: number
}

export interface PolicyEventInput {
  phase: PolicyEventPhase
  source: PolicyEventSource
  decision: PolicyEventDecision
  toolName: string
  toolUseId?: string
  cwd: string
  reason?: string
}

export class PolicyEventLedger {
  private events: PolicyEvent[] = []
  private sequence = 0
  private maxEvents: number
  private now: () => number

  constructor(options: { maxEvents?: number; now?: () => number } = {}) {
    this.maxEvents = options.maxEvents ?? 200
    this.now = options.now ?? Date.now
  }

  record(input: PolicyEventInput): PolicyEvent {
    this.sequence += 1
    const createdAt = this.now()
    const event: PolicyEvent = {
      id: `policy_${createdAt}_${this.sequence}`,
      phase: input.phase,
      source: input.source,
      decision: input.decision,
      toolName: input.toolName,
      toolUseId: input.toolUseId ?? '',
      cwd: input.cwd,
      reason: input.reason,
      createdAt,
    }
    this.events.push(event)
    while (this.events.length > this.maxEvents) this.events.shift()
    return event
  }

  list(): PolicyEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events = []
  }
}
```

- [ ] **Step 5: Implement verification ledger**

Create `packages/core/src/constraints/verification-ledger.ts`:

```ts
export type VerificationKind = 'build' | 'test' | 'typecheck' | 'lint'
export type VerificationCommandStatus = 'passed' | 'failed'
export type ChangedFileVerificationStatus = 'pending' | 'verified' | 'failed'

export interface ChangedFileRecord {
  filePath: string
  changedByToolUseId: string
  changedAt: number
  status: ChangedFileVerificationStatus
  verifiedByToolUseId?: string
  verificationFailure?: string
  updatedAt: number
}

export interface VerificationCommandRecord {
  toolUseId: string
  command: string
  kind: VerificationKind
  status: VerificationCommandStatus
  output: string
  createdAt: number
}

export class VerificationLedger {
  private changedFiles = new Map<string, ChangedFileRecord>()
  private commands: VerificationCommandRecord[] = []
  private now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }

  recordMutation(input: { filePath: string; toolUseId: string }): ChangedFileRecord {
    const timestamp = this.now()
    const record: ChangedFileRecord = {
      filePath: input.filePath,
      changedByToolUseId: input.toolUseId,
      changedAt: timestamp,
      status: 'pending',
      updatedAt: timestamp,
    }
    this.changedFiles.set(input.filePath, record)
    return record
  }

  recordCommand(input: {
    toolUseId: string
    command: string
    kind: VerificationKind
    status: VerificationCommandStatus
    output: string
  }): VerificationCommandRecord {
    const record: VerificationCommandRecord = {
      toolUseId: input.toolUseId,
      command: input.command,
      kind: input.kind,
      status: input.status,
      output: input.output,
      createdAt: this.now(),
    }
    this.commands.push(record)
    this.applyCommandToPendingChanges(record)
    return record
  }

  getChangedFiles(): ChangedFileRecord[] {
    return [...this.changedFiles.values()]
  }

  getCommands(): VerificationCommandRecord[] {
    return [...this.commands]
  }

  clear(): void {
    this.changedFiles.clear()
    this.commands = []
  }

  private applyCommandToPendingChanges(command: VerificationCommandRecord): void {
    for (const record of this.changedFiles.values()) {
      if (record.changedAt > command.createdAt) continue
      if (record.status === 'verified') continue

      record.updatedAt = this.now()
      if (command.status === 'passed') {
        record.status = 'verified'
        record.verifiedByToolUseId = command.toolUseId
        record.verificationFailure = undefined
      } else {
        record.status = 'failed'
        record.verificationFailure = command.output.slice(0, 500)
      }
    }
  }
}
```

- [ ] **Step 6: Run ledgers tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/policy-events.test.ts src/constraints/verification-ledger.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add packages/core/src/constraints/policy-events.ts packages/core/src/constraints/policy-events.test.ts packages/core/src/constraints/verification-ledger.ts packages/core/src/constraints/verification-ledger.test.ts
git commit -m "feat: add constraint policy ledgers"
```

---

## Task 3: Constraint Policy Runtime

**Goal:** Create the product-owned runtime that runs file mutation pre gates and post-tool ledger updates.

**Files:**

- Create: `packages/core/src/constraints/policy-runtime.ts`
- Create: `packages/core/src/constraints/policy-runtime.test.ts`
- Modify: `packages/core/src/constraints/file-mutation-policy.ts`

- [ ] **Step 1: Write runtime tests**

Create `packages/core/src/constraints/policy-runtime.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileReadStateCache } from '../file-read-state.js'
import { ConstraintPolicyRuntime } from './policy-runtime.js'

describe('ConstraintPolicyRuntime', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdc-policy-runtime-test')
  const filePath = path.join(tmpDir, 'target.ts')

  beforeEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })
    await writeFile(filePath, 'const value = 1\n', 'utf-8')
  })

  it('blocks unread edits in the product pre gate and records the event', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 10 })
    const fileReadState = new FileReadStateCache()

    const decision = runtime.preToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: filePath, old_string: 'const value = 1', new_string: 'const value = 2' },
      cwd: tmpDir,
      fileReadState,
    })

    expect(decision).toMatchObject({ decision: 'block' })
    expect(runtime.policyEvents.list()).toEqual([
      expect.objectContaining({
        phase: 'pre_tool_use',
        source: 'FileMutationPolicy',
        decision: 'block',
        toolName: 'Edit',
        toolUseId: 'edit_1',
      }),
    ])
  })

  it('records read metadata in the post gate', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 10 })
    const fileReadState = new FileReadStateCache()

    runtime.postToolUse({
      toolName: 'Read',
      toolUseId: 'read_1',
      input: { file_path: filePath },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'read ok',
        metadata: {
          fileRead: {
            filePath,
            offset: 0,
            limit: 2000,
            totalLines: 2,
            content: 'const value = 1\n',
          },
        },
      },
    })

    expect(fileReadState.checkFreshRead(filePath, { requiredText: 'const value = 1' }).ok).toBe(true)
    expect(runtime.policyEvents.list()[0]).toMatchObject({
      phase: 'post_tool_use',
      source: 'ToolResultMetadata',
      decision: 'record',
      toolName: 'Read',
    })
  })

  it('records successful mutations as pending verification', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 10 })
    const fileReadState = new FileReadStateCache()
    fileReadState.recordRead(filePath, 0, 2000, 2, 'const value = 1\n')

    runtime.postToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: filePath },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'Successfully edited',
        metadata: { mutations: [{ filePath, kind: 'edit' }] },
      },
    })

    expect(runtime.verificationLedger.getChangedFiles()).toEqual([
      expect.objectContaining({
        filePath,
        status: 'pending',
        changedByToolUseId: 'edit_1',
      }),
    ])
  })
})
```

- [ ] **Step 2: Run runtime tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/policy-runtime.test.ts --no-file-parallelism
```

Expected: FAIL because `ConstraintPolicyRuntime` does not exist.

- [ ] **Step 3: Export a reusable allow/block decision type from mutation policy**

Modify `packages/core/src/constraints/file-mutation-policy.ts` only if the current type is not already exported:

```ts
export type FileMutationPolicyDecision =
  | { decision: 'allow' }
  | { decision: 'block'; reason: string }
```

Expected: `evaluateFileMutationPolicy()` keeps its current behavior.

- [ ] **Step 4: Implement constraint policy runtime**

Create `packages/core/src/constraints/policy-runtime.ts`:

```ts
import type { FileReadStateCache } from '../file-read-state.js'
import type { ToolResult } from '../tool-registry.js'
import { evaluateFileMutationPolicy } from './file-mutation-policy.js'
import { PolicyEventLedger } from './policy-events.js'
import { VerificationLedger } from './verification-ledger.js'

export type ConstraintPreToolDecision =
  | { decision: 'allow' }
  | { decision: 'block'; reason: string }

export interface ConstraintPolicyRuntimeOptions {
  now?: () => number
}

export interface ConstraintToolContext {
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  cwd: string
  fileReadState: FileReadStateCache
}

export interface ConstraintPostToolContext extends ConstraintToolContext {
  result: ToolResult
}

export class ConstraintPolicyRuntime {
  readonly policyEvents: PolicyEventLedger
  readonly verificationLedger: VerificationLedger

  constructor(options: ConstraintPolicyRuntimeOptions = {}) {
    this.policyEvents = new PolicyEventLedger({ now: options.now })
    this.verificationLedger = new VerificationLedger({ now: options.now })
  }

  preToolUse(context: ConstraintToolContext): ConstraintPreToolDecision {
    const mutationDecision = evaluateFileMutationPolicy({
      toolName: context.toolName,
      input: context.input,
      cwd: context.cwd,
      fileReadState: context.fileReadState,
    })

    this.policyEvents.record({
      phase: 'pre_tool_use',
      source: 'FileMutationPolicy',
      decision: mutationDecision.decision,
      reason: mutationDecision.decision === 'block' ? mutationDecision.reason : undefined,
      toolName: context.toolName,
      toolUseId: context.toolUseId,
      cwd: context.cwd,
    })

    return mutationDecision
  }

  postToolUse(context: ConstraintPostToolContext): void {
    if (context.result.isError) return

    const fileRead = context.result.metadata?.fileRead
    if (fileRead) {
      context.fileReadState.recordRead(
        fileRead.filePath,
        fileRead.offset,
        fileRead.limit,
        fileRead.totalLines,
        fileRead.content,
      )
      this.policyEvents.record({
        phase: 'post_tool_use',
        source: 'ToolResultMetadata',
        decision: 'record',
        toolName: context.toolName,
        toolUseId: context.toolUseId,
        cwd: context.cwd,
      })
    }

    for (const mutation of context.result.metadata?.mutations ?? []) {
      context.fileReadState.invalidate(mutation.filePath)
      this.verificationLedger.recordMutation({
        filePath: mutation.filePath,
        toolUseId: context.toolUseId ?? '',
      })
      this.policyEvents.record({
        phase: 'post_tool_use',
        source: 'VerificationLedger',
        decision: 'record',
        toolName: context.toolName,
        toolUseId: context.toolUseId,
        cwd: context.cwd,
      })
    }
  }
}
```

- [ ] **Step 5: Run runtime tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/policy-runtime.test.ts src/constraints/policy-events.test.ts src/constraints/verification-ledger.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add packages/core/src/constraints/file-mutation-policy.ts packages/core/src/constraints/policy-runtime.ts packages/core/src/constraints/policy-runtime.test.ts
git commit -m "feat: add constraint policy runtime"
```

---

## Task 4: ToolRunner Integration And Ordering

**Goal:** Make the runtime the single product policy path in `ToolRunner`, with explicit ordering around permissions, plan mode, hooks, execution, and post-gate updates.

**Files:**

- Modify: `packages/core/src/tool-runner.ts`
- Modify: `packages/core/src/__tests__/tool-runner.test.ts`
- Modify: `packages/core/src/tools/file-read.ts`
- Modify: `packages/core/src/tools/file-edit.ts`
- Modify: `packages/core/src/tools/multi-edit.ts`
- Modify: `packages/core/src/tools/file-write.ts`

- [ ] **Step 1: Add ordering tests**

Modify `packages/core/src/__tests__/tool-runner.test.ts` and add:

```ts
it('runs product pre gate before project hooks', async () => {
  const registry = new ToolRegistry()
  registry.register(fileEditTool)
  const hookEngine = {
    runPreToolUse: vi.fn(async () => ({})),
    runPostToolUse: vi.fn(async () => ({})),
  } as any
  const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'), undefined, hookEngine)

  const result = await runner.execute('Edit', 'edit_unread', {
    file_path: targetPath,
    old_string: 'const value = 1',
    new_string: 'const value = 2',
  }, () => {})

  expect(result.isError).toBe(true)
  expect(result.content).toContain('Blocked by JDC Agent Constraint Engine')
  expect(hookEngine.runPreToolUse).not.toHaveBeenCalled()
})

it('records file reads through the product post gate', async () => {
  const registry = new ToolRegistry()
  registry.register(fileReadTool)
  registry.register(fileEditTool)
  const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))

  await runner.execute('Read', 'read_1', { file_path: targetPath }, () => {})
  const edit = await runner.execute('Edit', 'edit_1', {
    file_path: targetPath,
    old_string: 'const value = 1\n',
    new_string: 'const value = 2\n',
  }, () => {})

  expect(edit.isError).not.toBe(true)
  expect(runner.constraintRuntime.verificationLedger.getChangedFiles()).toEqual([
    expect.objectContaining({
      filePath: targetPath,
      status: 'pending',
      changedByToolUseId: 'edit_1',
    }),
  ])
})
```

If `vi` is not imported in this file, change the import to:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
```

- [ ] **Step 2: Run ToolRunner tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/__tests__/tool-runner.test.ts --no-file-parallelism
```

Expected: FAIL because `ToolRunner` does not expose `constraintRuntime` and does not call the new runtime.

- [ ] **Step 3: Integrate runtime in ToolRunner**

Modify `packages/core/src/tool-runner.ts`:

```ts
import type { ToolContext, ToolRegistry, ToolResult } from './tool-registry.js'
import { ConstraintPolicyRuntime } from './constraints/policy-runtime.js'
import { FileReadStateCache } from './file-read-state.js'
import { PermissionChecker } from './permissions.js'
import type { HookEngine } from './hooks/engine.js'
import type { FileTracker } from './file-tracker.js'
import { isPlanModeToolAllowed } from './tools/enter-plan-mode.js'
```

Add the public runtime property next to `fileReadState`:

```ts
  fileTracker?: FileTracker
  fileReadState = new FileReadStateCache()
  constraintRuntime = new ConstraintPolicyRuntime()
  backgroundTasks?: import('./background-tasks.js').BackgroundTaskManager
```

Move the product pre-gate to after permission and plan mode, before hooks:

```ts
    // Permission check
    const decision = this.permissionChecker.check(toolName, input)
    if (decision === 'deny') {
      const result: ToolResult = { content: `Permission denied: ${toolName}`, isError: true }
      onEvent({ type: 'error', toolName, toolUseId, result })
      return result
    }
    if (decision === 'ask') {
      if (!this.onPermissionRequest) {
        const result: ToolResult = { content: `Permission required but no callback provided: ${toolName}`, isError: true }
        onEvent({ type: 'error', toolName, toolUseId, result })
        return result
      }
      const allowed = await this.onPermissionRequest({ toolName, input })
      if (!allowed) {
        this.permissionChecker.recordDenial(toolName, input)
        const result: ToolResult = { content: `Permission denied by user: ${toolName}`, isError: true }
        onEvent({ type: 'error', toolName, toolUseId, result })
        return result
      }
    }

    if (this.planMode === 'planning' && toolName !== 'EnterPlanMode') {
      if (!isPlanModeToolAllowed(toolName, input, this.planModeCwd || this.cwd)) {
        const result: ToolResult = {
          content: `Cannot use ${toolName} in plan mode. Only read operations and writing plan files are allowed.`,
          isError: true,
        }
        onEvent({ type: 'error', toolName, toolUseId, result })
        return result
      }
    }

    const productPreToolUse = this.constraintRuntime.preToolUse({
      toolName,
      toolUseId,
      input,
      cwd: this.cwd,
      fileReadState: this.fileReadState,
    })
    if (productPreToolUse.decision === 'block') {
      const result: ToolResult = {
        content: `Blocked by JDC Agent Constraint Engine: ${productPreToolUse.reason}`,
        isError: true,
      }
      onEvent({ type: 'error', toolName, toolUseId, result })
      return result
    }
```

After tool execution and before post hooks:

```ts
      const result = await handler.execute(input, context)

      this.constraintRuntime.postToolUse({
        toolName,
        toolUseId,
        input,
        cwd: this.cwd,
        fileReadState: this.fileReadState,
        result,
      })

      if (this.hookEngine) {
        await this.hookEngine.runPostToolUse({
          session_id: this.sessionId || '',
          cwd: this.cwd,
          tool_name: toolName,
          tool_input: input,
          tool_result: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
        })
      }
```

Remove the old direct `evaluateFileMutationPolicy()` import and direct policy block from the top of `execute()`.

- [ ] **Step 4: Centralize read ledger recording in the post gate**

Modify `packages/core/src/tools/file-read.ts` and remove the direct call:

```ts
      context.fileReadState?.recordRead(filePath, offset, limit, totalLines, content)
```

Keep the returned `metadata.fileRead` from Task 1.

Keep direct invalidation in `file-edit.ts`, `multi-edit.ts`, and `file-write.ts` for now. The post gate also invalidates, and duplicate invalidation is harmless. Removing those calls can wait until the post-gate path has shipped for one phase.

- [ ] **Step 5: Run ToolRunner and file tool tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/__tests__/tool-runner.test.ts tests/tools.test.ts src/constraints/policy-runtime.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Run build**

Run:

```bash
pnpm --filter @jdcagnet/core build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add packages/core/src/tool-runner.ts packages/core/src/__tests__/tool-runner.test.ts packages/core/src/tools/file-read.ts packages/core/src/tools/file-edit.ts packages/core/src/tools/multi-edit.ts packages/core/src/tools/file-write.ts
git commit -m "feat: route tool execution through constraint runtime"
```

---

## Task 5: Command Verification Classification

**Goal:** Record shell verification results so changed files can move from pending to verified or failed.

**Files:**

- Create: `packages/core/src/constraints/tool-output-classifier.ts`
- Create: `packages/core/src/constraints/tool-output-classifier.test.ts`
- Modify: `packages/core/src/constraints/policy-runtime.ts`
- Modify: `packages/core/src/constraints/policy-runtime.test.ts`
- Modify: `packages/core/src/tools/bash.ts`
- Modify: `packages/core/src/tools/powershell.ts`

- [ ] **Step 1: Write command classifier tests**

Create `packages/core/src/constraints/tool-output-classifier.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyVerificationCommand } from './tool-output-classifier.js'

describe('classifyVerificationCommand', () => {
  it.each([
    ['pnpm --filter @jdcagnet/core build', 'build'],
    ['npm run typecheck', 'typecheck'],
    ['pnpm exec vitest run src/foo.test.ts', 'test'],
    ['pytest tests/test_api.py -q', 'test'],
    ['cargo test', 'test'],
    ['go test ./...', 'test'],
    ['pnpm lint', 'lint'],
  ])('classifies %s as %s', (command, kind) => {
    expect(classifyVerificationCommand(command)).toEqual({ kind })
  })

  it('ignores non-verification commands', () => {
    expect(classifyVerificationCommand('git status --short')).toBeUndefined()
    expect(classifyVerificationCommand('ls packages/core/src')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Write runtime verification update test**

Add this test to `packages/core/src/constraints/policy-runtime.test.ts`:

```ts
it('marks pending changed files verified after a successful verification command', () => {
  const runtime = new ConstraintPolicyRuntime({ now: () => 10 })
  const fileReadState = new FileReadStateCache()

  runtime.postToolUse({
    toolName: 'Edit',
    toolUseId: 'edit_1',
    input: { file_path: filePath },
    cwd: tmpDir,
    fileReadState,
    result: {
      content: 'Successfully edited',
      metadata: { mutations: [{ filePath, kind: 'edit' }] },
    },
  })

  runtime.postToolUse({
    toolName: 'Bash',
    toolUseId: 'bash_1',
    input: { command: 'pnpm --filter @jdcagnet/core build' },
    cwd: tmpDir,
    fileReadState,
    result: {
      content: 'build ok',
      metadata: { command: { shell: 'bash', command: 'pnpm --filter @jdcagnet/core build', exitCode: 0 } },
    },
  })

  expect(runtime.verificationLedger.getChangedFiles()[0]).toMatchObject({
    status: 'verified',
    verifiedByToolUseId: 'bash_1',
  })
})
```

- [ ] **Step 3: Run classifier/runtime tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/tool-output-classifier.test.ts src/constraints/policy-runtime.test.ts --no-file-parallelism
```

Expected: FAIL because the classifier and command post-gate behavior do not exist.

- [ ] **Step 4: Implement command classifier**

Create `packages/core/src/constraints/tool-output-classifier.ts`:

```ts
import type { VerificationKind } from './verification-ledger.js'

export function classifyVerificationCommand(command: string): { kind: VerificationKind } | undefined {
  const normalized = command.toLowerCase()

  if (/\b(vitest|jest|mocha|pytest)\b/.test(normalized)) return { kind: 'test' }
  if (/\b(go test|cargo test|mvn test|gradle test)\b/.test(normalized)) return { kind: 'test' }
  if (/\b(npm|pnpm|yarn|bun)\b.*\btest\b/.test(normalized)) return { kind: 'test' }
  if (/\b(tsc|typecheck)\b/.test(normalized)) return { kind: 'typecheck' }
  if (/\b(npm|pnpm|yarn|bun)\b.*\b(typecheck|check-types)\b/.test(normalized)) return { kind: 'typecheck' }
  if (/\b(npm|pnpm|yarn|bun)\b.*\bbuild\b/.test(normalized)) return { kind: 'build' }
  if (/\b(npm|pnpm|yarn|bun)\b.*\blint\b/.test(normalized)) return { kind: 'lint' }
  if (/\beslint\b/.test(normalized)) return { kind: 'lint' }

  return undefined
}
```

- [ ] **Step 5: Add command metadata to Bash**

Modify the `proc.on('close')` resolve block in `packages/core/src/tools/bash.ts`:

```ts
        resolve({
          content: truncated || '(no output)',
          isError: code !== 0,
          metadata: {
            command: {
              shell: 'bash',
              command,
              exitCode: code,
            },
          },
        })
```

- [ ] **Step 6: Add command metadata to PowerShell**

Modify the `proc.on('close')` resolve block in `packages/core/src/tools/powershell.ts`:

```ts
          resolve({
            content: truncated || '(no output)',
            isError: code !== 0,
            metadata: {
              command: {
                shell: 'powershell',
                command,
                exitCode: code,
              },
            },
          })
```

- [ ] **Step 7: Update runtime to record verification commands**

Modify `packages/core/src/constraints/policy-runtime.ts`:

```ts
import { classifyVerificationCommand } from './tool-output-classifier.js'
```

Add this block at the end of `postToolUse()` after mutation handling:

```ts
    const command = context.result.metadata?.command
    if (command) {
      const classified = classifyVerificationCommand(command.command)
      if (classified) {
        this.verificationLedger.recordCommand({
          toolUseId: context.toolUseId ?? '',
          command: command.command,
          kind: classified.kind,
          status: command.exitCode === 0 && !context.result.isError ? 'passed' : 'failed',
          output: context.result.content,
        })
        this.policyEvents.record({
          phase: 'post_tool_use',
          source: 'VerificationLedger',
          decision: 'record',
          toolName: context.toolName,
          toolUseId: context.toolUseId,
          cwd: context.cwd,
        })
      }
    }
```

If `postToolUse()` currently returns early on `result.isError`, replace the early return with:

```ts
    const command = context.result.metadata?.command
    if (context.result.isError && !command) return
```

This allows failed verification commands to be recorded.

- [ ] **Step 8: Run classifier/runtime tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/tool-output-classifier.test.ts src/constraints/policy-runtime.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 9: Run Bash/PowerShell type build**

Run:

```bash
pnpm --filter @jdcagnet/core build
```

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

```bash
git add packages/core/src/constraints/tool-output-classifier.ts packages/core/src/constraints/tool-output-classifier.test.ts packages/core/src/constraints/policy-runtime.ts packages/core/src/constraints/policy-runtime.test.ts packages/core/src/tools/bash.ts packages/core/src/tools/powershell.ts
git commit -m "feat: record verification command results"
```

---

## Task 6: Product Eval And Documentation Gate

**Goal:** Prove Phase 3 behavior end-to-end and update the design document with the chosen runtime-ordering decisions.

**Files:**

- Create: `packages/core/src/constraints/constraint-product-evals.test.ts`
- Modify: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

- [ ] **Step 1: Write product eval for policy runtime**

Create `packages/core/src/constraints/constraint-product-evals.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PermissionChecker } from '../permissions.js'
import { ToolRegistry } from '../tool-registry.js'
import { ToolRunner } from '../tool-runner.js'
import { fileEditTool } from '../tools/file-edit.js'
import { fileReadTool } from '../tools/file-read.js'

describe('JDC Agent Constraint Engine Phase 3 product evals', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdc-constraint-phase3-eval')
  const targetPath = path.join(tmpDir, 'target.ts')

  beforeEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })
    await writeFile(targetPath, 'export const value = 1\n', 'utf-8')
  })

  it('blocks unread mutation, records policy event, then records pending verification after read and edit', async () => {
    const registry = new ToolRegistry()
    registry.register(fileReadTool)
    registry.register(fileEditTool)
    const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))

    const blocked = await runner.execute('Edit', 'edit_blocked', {
      file_path: targetPath,
      old_string: 'export const value = 1\n',
      new_string: 'export const value = 2\n',
    }, () => {})

    expect(blocked.isError).toBe(true)
    expect(blocked.content).toContain('Blocked by JDC Agent Constraint Engine')
    expect(await readFile(targetPath, 'utf-8')).toBe('export const value = 1\n')
    expect(runner.constraintRuntime.policyEvents.list()).toEqual([
      expect.objectContaining({
        phase: 'pre_tool_use',
        decision: 'block',
        toolUseId: 'edit_blocked',
      }),
    ])

    await runner.execute('Read', 'read_1', { file_path: targetPath }, () => {})
    const edit = await runner.execute('Edit', 'edit_allowed', {
      file_path: targetPath,
      old_string: 'export const value = 1\n',
      new_string: 'export const value = 2\n',
    }, () => {})

    expect(edit.isError).not.toBe(true)
    expect(runner.constraintRuntime.verificationLedger.getChangedFiles()).toEqual([
      expect.objectContaining({
        filePath: targetPath,
        status: 'pending',
        changedByToolUseId: 'edit_allowed',
      }),
    ])
  })
})
```

- [ ] **Step 2: Run product eval and verify it passes**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/constraint-product-evals.test.ts --no-file-parallelism
```

Expected after Task 5: PASS.

- [ ] **Step 3: Update the design document Phase 3 decision**

Append this section near `Phase 1/2 implementation decision` in `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`:

```markdown
Phase 3 implementation decision:

- `ToolRunner` owns a `ConstraintPolicyRuntime`.
- Product PreToolUse gates run after permission and plan-mode checks, before project/user PreToolUse hooks.
- Product PostToolUse gates run after tool execution, before project/user PostToolUse hooks.
- File tools return structured `ToolResult.metadata` so product policy does not parse user-facing tool output.
- `PolicyEventLedger` records bounded in-memory product policy events for blocked and recorded actions.
- `VerificationLedger` records changed files as pending and updates them from recognized shell verification commands.
- Stop/TurnEnd enforcement remains deferred to Phase 5; Phase 3 only records the state Phase 5 will consume.
```

- [ ] **Step 4: Run full Phase 3 focused suite**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/policy-events.test.ts src/constraints/verification-ledger.test.ts src/constraints/tool-output-classifier.test.ts src/constraints/policy-runtime.test.ts src/constraints/constraint-product-evals.test.ts src/__tests__/tool-runner.test.ts tests/tools.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit Task 6**

```bash
git add packages/core/src/constraints/constraint-product-evals.test.ts docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md
git commit -m "test: add phase 3 constraint runtime eval"
```

---

## Final Verification

Before merging Phase 3, run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/policy-events.test.ts src/constraints/verification-ledger.test.ts src/constraints/tool-output-classifier.test.ts src/constraints/policy-runtime.test.ts src/constraints/constraint-product-evals.test.ts src/__tests__/tool-runner.test.ts tests/tools.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected:

- all Phase 3 focused tests pass;
- core TypeScript build passes;
- no whitespace errors;
- policy events record pre/post product decisions;
- changed file records become pending after mutation;
- recognized successful verification commands mark pending changes verified;
- recognized failed verification commands mark pending changes failed;
- project hooks are not called when product pre gate blocks a tool.

## Self-Review Checklist

- Phase 3 design coverage:
  - product-owned PreToolUse gate: Task 3 and Task 4;
  - product-owned PostToolUse gate: Task 3 and Task 4;
  - policy event recording: Task 2, Task 3, Task 6;
  - verification ledger updates from tool outputs: Task 2 and Task 5;
  - predictable ordering with permissions and hooks: Task 4.
- Placeholder scan:
  - placeholder-marker scan is clean;
  - every new file has concrete code;
  - every test command has an expected result.
- Type consistency:
  - `ToolResult.metadata` is defined once in `tool-registry.ts`;
  - `ConstraintPolicyRuntime` consumes `ToolResult.metadata`;
  - `VerificationLedger` uses `VerificationKind` shared by `tool-output-classifier.ts`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-jdc-agent-constraint-engine-phase3.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
