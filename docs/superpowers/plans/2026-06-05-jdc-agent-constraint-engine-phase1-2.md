# JDC Agent Constraint Engine Phase 1-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable slice of JDC Agent Constraint Engine: hard file mutation gates plus task-aware missing-evidence planning.

**Architecture:** Add fresh-read tracking to `FileReadStateCache`, enforce mutation policy in `ToolRunner`, and extend `ContextPlanner` so code edit/debug/review turns produce missing evidence and a model-visible agent run contract. This slice must run in the real tool path; prompt-only rules do not count.

**Tech Stack:** TypeScript, Vitest, existing JDC core tool registry, existing `ToolRunner`, existing JDC Context Engine planner/orchestrator/prompt renderer.

---

## Source Documents

- Design: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`
- Context Engine V2: `docs/superpowers/specs/2026-06-03-jdc-context-engine-v2-design.md`
- Operating Contract: `docs/superpowers/specs/2026-06-04-jdc-code-operating-contract-design.md`

## Scope

This plan covers Phase 1 and Phase 2 only:

- Phase 1: hard file mutation gates.
- Phase 2: Evidence Plan V1 and model-visible Agent Run Contract.

This plan intentionally does not implement:

- Repo Wiki generation;
- embeddings;
- UI panel work;
- model profile registry;
- import graph validation;
- Stop/TurnEnd verification gate.

Those depend on the first runtime constraint path proving itself.

## Dependency Graph

```text
Task 1 Fresh Read Ledger
  -> Task 2 File Mutation Policy Evaluator
  -> Task 3 ToolRunner Integration

Task 4 Context Planner Missing Evidence
  -> Task 5 Agent Run Contract Prompt Section

Task 3 ToolRunner Integration
Task 5 Agent Run Contract Prompt Section
  -> Task 6 Product Eval And Documentation Gate
```

## File Boundary Map

Create:

- `packages/core/src/constraints/file-mutation-policy.ts`
- `packages/core/src/constraints/file-mutation-policy.test.ts`
- `packages/core/src/file-read-state.test.ts`

Modify:

- `packages/core/src/file-read-state.ts`
- `packages/core/src/tools/file-read.ts`
- `packages/core/src/tool-runner.ts`
- `packages/core/src/__tests__/tool-runner.test.ts`
- `packages/core/src/context/types.ts`
- `packages/core/src/context/planner.ts`
- `packages/core/src/context/context-planner.test.ts`
- `packages/core/src/context/ranker.ts`
- `packages/core/src/context/orchestrator.ts`
- `packages/core/src/context/context-orchestrator.test.ts`
- `packages/core/src/context/prompt-renderer.ts`
- `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

## Global Acceptance Gates

Run these after each task that touches implementation:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/file-read-state.test.ts src/constraints/file-mutation-policy.test.ts src/__tests__/tool-runner.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core exec vitest run src/context/context-planner.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected final result: all commands pass.

---

## Task 1: Fresh Read Ledger

**Goal:** Make `FileReadStateCache` able to answer "has this file been freshly read for this intended mutation?"

**Files:**

- Create: `packages/core/src/file-read-state.test.ts`
- Modify: `packages/core/src/file-read-state.ts`
- Modify: `packages/core/src/tools/file-read.ts`

- [ ] **Step 1: Write failing tests for fresh read checks**

Create `packages/core/src/file-read-state.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileReadStateCache } from './file-read-state.js'

describe('FileReadStateCache fresh read checks', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdc-file-read-state-test')
  const filePath = path.join(tmpDir, 'sample.ts')

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(filePath, 'const alpha = 1\nconst beta = 2\n')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('reports not_read when a file has not been read', () => {
    const cache = new FileReadStateCache()

    const result = cache.checkFreshRead(filePath, { requiredText: 'const alpha = 1' })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_read')
    expect(result.message).toContain('has not been read')
  })

  it('accepts a fresh full-file read', () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 2000, 2, 'const alpha = 1\nconst beta = 2')

    const result = cache.checkFreshRead(filePath, { requiredText: 'const beta = 2' })

    expect(result.ok).toBe(true)
  })

  it('accepts a fresh range read only when it contains the edit anchor', () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 1, 2, 'const alpha = 1')

    expect(cache.checkFreshRead(filePath, { requiredText: 'const alpha = 1' }).ok).toBe(true)
    expect(cache.checkFreshRead(filePath, { requiredText: 'const beta = 2' })).toMatchObject({
      ok: false,
      reason: 'range_not_read',
    })
  })

  it('reports stale when the file changed after it was read', async () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 2000, 2, 'const alpha = 1\nconst beta = 2')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await writeFile(filePath, 'const alpha = 10\nconst beta = 2\n')

    const result = cache.checkFreshRead(filePath, { requiredText: 'const alpha = 1' })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('stale')
  })

  it('keeps read de-duplication behavior for exact unchanged ranges', () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 2000, 2, 'const alpha = 1\nconst beta = 2')

    expect(cache.canDedup(filePath, 0, 2000)).toBe(true)
    expect(cache.canDedup(filePath, 1, 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/file-read-state.test.ts --no-file-parallelism
```

Expected: FAIL because `checkFreshRead()` and the expanded `recordRead()` signature do not exist.

- [ ] **Step 3: Expand `FileReadStateCache`**

Modify `packages/core/src/file-read-state.ts`:

```ts
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'

export type FreshReadFailureReason = 'not_read' | 'stale' | 'missing' | 'range_not_read'

export interface FreshReadCheckOptions {
  requiredText?: string
}

export type FreshReadCheck =
  | { ok: true; entry: FileReadEntry }
  | { ok: false; reason: FreshReadFailureReason; message: string; entry?: FileReadEntry }

export interface FileReadEntry {
  /** mtime in ms when the file was last read */
  mtimeMs: number
  /** file size in bytes when the file was last read */
  sizeBytes: number
  /** The offset used in the read (0 if full file) */
  offset: number
  /** The limit used in the read (Infinity if full file) */
  limit: number
  /** Total number of lines in the file at read time */
  totalLines: number
  /** Whether this read covered the complete file */
  fullFile: boolean
  /** Hash of the returned text range */
  contentHash: string
  /** Text returned to the model for this range */
  content: string
  /** Whether this entry came from a Read tool */
  fromRead: boolean
}

/**
 * Tracks which file ranges have been read in the current session. The same
 * cache serves two purposes: read de-duplication and mutation safety checks.
 */
export class FileReadStateCache {
  private cache = new Map<string, FileReadEntry[]>()
  private maxEntries: number

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries
  }

  recordRead(filePath: string, offset: number, limit: number, totalLines = Number.POSITIVE_INFINITY, content = ''): void {
    try {
      const stat = statSync(filePath)
      const effectiveLimit = limit === Infinity ? totalLines : limit
      const fullFile = offset <= 0 && offset + effectiveLimit >= totalLines
      const entry: FileReadEntry = {
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        offset,
        limit,
        totalLines,
        fullFile,
        contentHash: hashText(content),
        content,
        fromRead: true,
      }
      const entries = this.cache.get(filePath) ?? []
      entries.push(entry)
      this.cache.set(filePath, entries)
      this.evictIfNeeded()
    } catch {
      // File might not exist or be inaccessible; skip caching.
    }
  }

  invalidate(filePath: string): void {
    this.cache.delete(filePath)
  }

  canDedup(filePath: string, offset: number, limit: number): boolean {
    const entries = this.cache.get(filePath) ?? []
    const entry = entries.find((item) => item.fromRead && item.offset === offset && item.limit === limit)
    if (!entry) return false
    return this.isEntryFresh(filePath, entry)
  }

  checkFreshRead(filePath: string, options: FreshReadCheckOptions = {}): FreshReadCheck {
    const entries = this.cache.get(filePath) ?? []
    if (entries.length === 0) {
      return { ok: false, reason: 'not_read', message: `${filePath} has not been read in this session.` }
    }

    const freshEntries = entries.filter((entry) => this.isEntryFresh(filePath, entry))
    if (freshEntries.length === 0) {
      return { ok: false, reason: 'stale', message: `${filePath} changed after it was read. Read it again before editing.`, entry: entries.at(-1) }
    }

    const requiredText = options.requiredText
    if (!requiredText) return { ok: true, entry: freshEntries.at(-1)! }

    const matching = freshEntries.find((entry) => entry.fullFile || entry.content.includes(requiredText))
    if (!matching) {
      return {
        ok: false,
        reason: 'range_not_read',
        message: `${filePath} was read only in ranges that do not include the edit anchor. Read the relevant range before editing.`,
        entry: freshEntries.at(-1),
      }
    }

    return { ok: true, entry: matching }
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return Array.from(this.cache.values()).reduce((total, entries) => total + entries.length, 0)
  }

  private isEntryFresh(filePath: string, entry: FileReadEntry): boolean {
    try {
      const stat = statSync(filePath)
      return stat.mtimeMs === entry.mtimeMs && stat.size === entry.sizeBytes
    } catch {
      return false
    }
  }

  private evictIfNeeded(): void {
    while (this.size > this.maxEntries) {
      const firstKey = this.cache.keys().next().value
      if (!firstKey) return
      const entries = this.cache.get(firstKey)
      if (!entries || entries.length <= 1) {
        this.cache.delete(firstKey)
        continue
      }
      entries.shift()
      this.cache.set(firstKey, entries)
    }
  }
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}
```

- [ ] **Step 4: Update `Read` to record total lines and returned content**

Modify `packages/core/src/tools/file-read.ts`:

```ts
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n')
      const effectiveLimit = limit === Infinity ? lines.length : limit
      const slice = lines.slice(offset, offset + effectiveLimit)
      const returnedContent = slice.join('\n')
      const numbered = slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')

      context.fileReadState?.recordRead(filePath, offset, limit, lines.length, returnedContent)

      return { content: numbered }
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/file-read-state.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/file-read-state.ts packages/core/src/tools/file-read.ts packages/core/src/file-read-state.test.ts
git commit -m "feat: track fresh file reads for mutation safety"
```

---

## Task 2: File Mutation Policy Evaluator

**Goal:** Create the product-owned policy evaluator that blocks unread/stale/range-unsafe file mutations.

**Files:**

- Create: `packages/core/src/constraints/file-mutation-policy.ts`
- Create: `packages/core/src/constraints/file-mutation-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `packages/core/src/constraints/file-mutation-policy.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileReadStateCache } from '../file-read-state.js'
import { evaluateFileMutationPolicy } from './file-mutation-policy.js'

describe('file mutation policy', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdc-file-mutation-policy-test')
  const existingFile = path.join(tmpDir, 'existing.ts')
  const newFile = path.join(tmpDir, 'new.ts')

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(existingFile, 'const alpha = 1\nconst beta = 2\n')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('blocks Edit when the existing file was not read', () => {
    const decision = evaluateFileMutationPolicy({
      toolName: 'Edit',
      input: { file_path: existingFile, old_string: 'const alpha = 1', new_string: 'const alpha = 10' },
      cwd: tmpDir,
      fileReadState: new FileReadStateCache(),
    })

    expect(decision).toMatchObject({ decision: 'block' })
    expect(decision.reason).toContain('has not been read')
  })

  it('allows Edit after a fresh read covering the edit anchor', () => {
    const fileReadState = new FileReadStateCache()
    fileReadState.recordRead(existingFile, 0, 2000, 2, 'const alpha = 1\nconst beta = 2')

    const decision = evaluateFileMutationPolicy({
      toolName: 'Edit',
      input: { file_path: existingFile, old_string: 'const alpha = 1', new_string: 'const alpha = 10' },
      cwd: tmpDir,
      fileReadState,
    })

    expect(decision).toMatchObject({ decision: 'allow' })
  })

  it('blocks MultiEdit when one edit anchor was not read', () => {
    const fileReadState = new FileReadStateCache()
    fileReadState.recordRead(existingFile, 0, 1, 2, 'const alpha = 1')

    const decision = evaluateFileMutationPolicy({
      toolName: 'MultiEdit',
      input: {
        file_path: existingFile,
        edits: [
          { old_string: 'const alpha = 1', new_string: 'const alpha = 10' },
          { old_string: 'const beta = 2', new_string: 'const beta = 20' },
        ],
      },
      cwd: tmpDir,
      fileReadState,
    })

    expect(decision).toMatchObject({ decision: 'block' })
    expect(decision.reason).toContain('edit anchor')
  })

  it('allows Write for a new file', () => {
    expect(existsSync(newFile)).toBe(false)
    const decision = evaluateFileMutationPolicy({
      toolName: 'Write',
      input: { file_path: newFile, content: 'export const created = true\n' },
      cwd: tmpDir,
      fileReadState: new FileReadStateCache(),
    })

    expect(decision).toMatchObject({ decision: 'allow' })
  })

  it('blocks Write when overwriting an unread existing file', () => {
    const decision = evaluateFileMutationPolicy({
      toolName: 'Write',
      input: { file_path: existingFile, content: 'export const replaced = true\n' },
      cwd: tmpDir,
      fileReadState: new FileReadStateCache(),
    })

    expect(decision).toMatchObject({ decision: 'block' })
    expect(decision.reason).toContain('has not been read')
  })
})
```

- [ ] **Step 2: Run policy tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/file-mutation-policy.test.ts --no-file-parallelism
```

Expected: FAIL because `evaluateFileMutationPolicy()` does not exist.

- [ ] **Step 3: Implement the evaluator**

Create `packages/core/src/constraints/file-mutation-policy.ts`:

```ts
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { FileReadStateCache } from '../file-read-state.js'

export type FileMutationPolicyDecision =
  | { decision: 'allow' }
  | { decision: 'block'; reason: string }

export interface FileMutationPolicyInput {
  toolName: string
  input: Record<string, unknown>
  cwd: string
  fileReadState?: FileReadStateCache
}

const FILE_MUTATION_TOOLS = new Set(['Edit', 'MultiEdit', 'Write'])

export function evaluateFileMutationPolicy(args: FileMutationPolicyInput): FileMutationPolicyDecision {
  if (!FILE_MUTATION_TOOLS.has(args.toolName)) return { decision: 'allow' }
  if (!args.fileReadState) return { decision: 'allow' }

  const filePathInput = typeof args.input.file_path === 'string' ? args.input.file_path : undefined
  if (!filePathInput) return { decision: 'allow' }

  const filePath = path.isAbsolute(filePathInput) ? filePathInput : path.resolve(args.cwd, filePathInput)

  if (args.toolName === 'Write' && !existsSync(filePath)) return { decision: 'allow' }

  if (args.toolName === 'MultiEdit') {
    const edits = Array.isArray(args.input.edits) ? args.input.edits : []
    for (const edit of edits) {
      const oldString = isEditObject(edit) ? edit.old_string : undefined
      const check = args.fileReadState.checkFreshRead(filePath, { requiredText: oldString })
      if (!check.ok) return { decision: 'block', reason: check.message }
    }
    return { decision: 'allow' }
  }

  const requiredText = args.toolName === 'Edit' && typeof args.input.old_string === 'string'
    ? args.input.old_string
    : undefined
  const check = args.fileReadState.checkFreshRead(filePath, { requiredText })
  if (!check.ok) return { decision: 'block', reason: check.message }
  return { decision: 'allow' }
}

function isEditObject(value: unknown): value is { old_string: string } {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as { old_string?: unknown }).old_string === 'string'
}
```

- [ ] **Step 4: Run policy tests and verify they pass**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/file-mutation-policy.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constraints/file-mutation-policy.ts packages/core/src/constraints/file-mutation-policy.test.ts
git commit -m "feat: add file mutation policy evaluator"
```

---

## Task 3: ToolRunner Integration

**Goal:** Make the mutation policy run in the real tool path before file writes happen.

**Files:**

- Modify: `packages/core/src/tool-runner.ts`
- Modify: `packages/core/src/__tests__/tool-runner.test.ts`

- [ ] **Step 1: Add ToolRunner tests for unread and fresh-read edits**

Modify the import block at the top of `packages/core/src/__tests__/tool-runner.test.ts` to include these imports:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ToolRunner } from '../tool-runner.js'
import { ToolRegistry } from '../tool-registry.js'
import { PermissionChecker } from '../permissions.js'
import { FileReadStateCache } from '../file-read-state.js'
import { fileEditTool } from '../tools/file-edit.js'
import { fileReadTool } from '../tools/file-read.js'
import { fileWriteTool } from '../tools/file-write.js'
```

Append this `describe` block to `packages/core/src/__tests__/tool-runner.test.ts`:

```ts

describe('ToolRunner file mutation constraints', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdc-tool-runner-constraints-test')
  const filePath = path.join(tmpDir, 'target.ts')

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(filePath, 'const value = 1\n')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  function makeFileRunner() {
    const registry = new ToolRegistry()
    registry.register(fileReadTool)
    registry.register(fileEditTool)
    registry.register(fileWriteTool)
    const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))
    runner.fileReadState = new FileReadStateCache()
    return runner
  }

  it('blocks Edit before the file has been read', async () => {
    const runner = makeFileRunner()

    const result = await runner.execute('Edit', 'edit_1', {
      file_path: filePath,
      old_string: 'const value = 1',
      new_string: 'const value = 2',
    }, () => {})

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Blocked by JDC Agent Constraint Engine')
    await expect(readFile(filePath, 'utf-8')).resolves.toBe('const value = 1\n')
  })

  it('allows Edit after the file has been freshly read', async () => {
    const runner = makeFileRunner()

    const read = await runner.execute('Read', 'read_1', { file_path: filePath }, () => {})
    expect(read.isError).toBeFalsy()

    const edit = await runner.execute('Edit', 'edit_1', {
      file_path: filePath,
      old_string: 'const value = 1',
      new_string: 'const value = 2',
    }, () => {})

    expect(edit.isError).toBeFalsy()
    await expect(readFile(filePath, 'utf-8')).resolves.toBe('const value = 2\n')
  })

  it('blocks Write when overwriting an existing unread file', async () => {
    const runner = makeFileRunner()

    const result = await runner.execute('Write', 'write_1', {
      file_path: filePath,
      content: 'const replaced = true\n',
    }, () => {})

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Blocked by JDC Agent Constraint Engine')
    await expect(readFile(filePath, 'utf-8')).resolves.toBe('const value = 1\n')
  })
})
```

If the file already imports `describe`, `expect`, or `it`, merge imports rather than duplicating them.

- [ ] **Step 2: Run ToolRunner tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/__tests__/tool-runner.test.ts --no-file-parallelism
```

Expected: FAIL because `ToolRunner` does not call the mutation policy yet.

- [ ] **Step 3: Integrate the policy into ToolRunner**

Modify `packages/core/src/tool-runner.ts`.

Add the import:

```ts
import { evaluateFileMutationPolicy } from './constraints/file-mutation-policy.js'
```

Add this block after the unknown-tool check and before permission checks:

```ts
    const policy = evaluateFileMutationPolicy({
      toolName,
      input,
      cwd: this.cwd,
      fileReadState: this.fileReadState,
    })
    if (policy.decision === 'block') {
      const result: ToolResult = {
        content: `Blocked by JDC Agent Constraint Engine: ${policy.reason}`,
        isError: true,
      }
      onEvent({ type: 'error', toolName, toolUseId, result })
      return result
    }
```

- [ ] **Step 4: Run ToolRunner tests and verify they pass**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/__tests__/tool-runner.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Run the Phase 1 focused test group**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/file-read-state.test.ts src/constraints/file-mutation-policy.test.ts src/__tests__/tool-runner.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tool-runner.ts packages/core/src/__tests__/tool-runner.test.ts
git commit -m "feat: enforce file mutation constraints in tool runner"
```

---

## Task 4: Context Planner Missing Evidence V1

**Goal:** Make `ContextPlanner` produce concrete missing evidence for code edit, debug, and review turns.

**Files:**

- Modify: `packages/core/src/context/planner.ts`
- Modify: `packages/core/src/context/context-planner.test.ts`

- [ ] **Step 1: Add failing planner tests for missing evidence**

Append to `packages/core/src/context/context-planner.test.ts`:

```ts
  it('requires code evidence for code_edit turns when no relevant code is present', () => {
    const plan = planContext(makeRequest({ mode: 'code_edit', userMessage: '修复登录状态 bug' }), [
      section({ id: 'project', kind: 'project_profile', title: 'Project', content: 'package scripts' }),
    ])

    expect(plan.missingEvidence).toContainEqual({
      kind: 'relevant_code',
      reason: 'Code edit turns require target file or symbol evidence before mutation.',
    })
  })

  it('requires runtime or code evidence for debug turns', () => {
    const plan = planContext(makeRequest({ mode: 'debug', userMessage: '为什么这里报错' }), [
      section({ id: 'project', kind: 'project_profile', title: 'Project', content: 'package scripts' }),
    ])

    expect(plan.missingEvidence).toContainEqual({
      kind: 'runtime_or_code',
      reason: 'Debug turns require observed runtime output, relevant code, or both.',
    })
  })

  it('requires diff or code evidence for review turns', () => {
    const plan = planContext(makeRequest({ mode: 'review', userMessage: 'review this change' }), [
      section({ id: 'project', kind: 'project_profile', title: 'Project', content: 'package scripts' }),
    ])

    expect(plan.missingEvidence).toContainEqual({
      kind: 'diff_or_relevant_code',
      reason: 'Review turns require changed-file, git, or relevant code evidence.',
    })
  })

  it('does not report missing code evidence when relevant code is already present', () => {
    const plan = planContext(makeRequest({ mode: 'code_edit', userMessage: '修复登录状态 bug' }), [
      section({ id: 'code', kind: 'relevant_code', title: 'Relevant code', content: 'src/session.ts' }),
    ])

    expect(plan.missingEvidence).toEqual([])
  })
```

- [ ] **Step 2: Run planner tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-planner.test.ts --no-file-parallelism
```

Expected: FAIL because `missingEvidence` is still always empty.

- [ ] **Step 3: Implement missing evidence derivation**

Modify `packages/core/src/context/planner.ts`.

Change the return value:

```ts
    missingEvidence: missingEvidenceFor(intent, sections),
```

Add this helper near `isRelevant()`:

```ts
function missingEvidenceFor(intent: ContextPlanIntent, sections: ContextSection[]): Array<{ kind: string; reason: string }> {
  const kinds = new Set(sections.map((section) => section.kind))
  const missing: Array<{ kind: string; reason: string }> = []

  if (intent === 'code_edit' && !kinds.has('relevant_code')) {
    missing.push({
      kind: 'relevant_code',
      reason: 'Code edit turns require target file or symbol evidence before mutation.',
    })
  }

  if (intent === 'debug' && !kinds.has('runtime_state') && !kinds.has('relevant_code')) {
    missing.push({
      kind: 'runtime_or_code',
      reason: 'Debug turns require observed runtime output, relevant code, or both.',
    })
  }

  if (intent === 'review' && !kinds.has('git_state') && !kinds.has('relevant_code')) {
    missing.push({
      kind: 'diff_or_relevant_code',
      reason: 'Review turns require changed-file, git, or relevant code evidence.',
    })
  }

  return missing
}
```

- [ ] **Step 4: Run planner tests and verify they pass**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-planner.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/planner.ts packages/core/src/context/context-planner.test.ts
git commit -m "feat: derive missing evidence in context planner"
```

---

## Task 5: Agent Run Contract Prompt Section

**Goal:** Render missing evidence into the model prompt through JDC Context Engine so the model sees what the runtime requires.

**Files:**

- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/ranker.ts`
- Modify: `packages/core/src/context/planner.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/prompt-renderer.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`

- [ ] **Step 1: Add failing orchestrator test**

Append to `packages/core/src/context/context-orchestrator.test.ts`:

```ts
  it('renders an agent run contract when required evidence is missing', async () => {
    const store = makeStore({ facts: [] })

    const result = await buildContextBundle({
      ...request,
      mode: 'code_edit',
      userMessage: '修复登录状态 bug',
    }, {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 1_000,
      id: () => 'bundle_agent_contract',
    })

    expect(result.renderedPrompt).toContain('<section kind="agent_contract"')
    expect(result.renderedPrompt).toContain('Code edit turns require target file or symbol evidence before mutation.')
    expect(result.bundle.sections.some((section) => section.kind === 'agent_contract')).toBe(true)
  })
```

- [ ] **Step 2: Run orchestrator test and verify it fails**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: FAIL because `agent_contract` is not a section kind and no contract section is rendered.

- [ ] **Step 3: Add `agent_contract` section kind**

Modify `packages/core/src/context/types.ts`:

```ts
export type ContextSectionKind = 'agent_contract' | 'user_intent' | 'project_profile' | 'code_map' | 'relevant_code' | 'git_state' | 'memory' | 'conversation_state' | 'runtime_state' | 'ide_state' | 'diagnostics'
```

Modify `packages/core/src/context/ranker.ts`:

```ts
const KIND_WEIGHT: Record<ContextSection['kind'], number> = {
  agent_contract: 1_400,
  user_intent: 1_300,
  runtime_state: 900,
  ide_state: 800,
  conversation_state: 700,
  relevant_code: 650,
  git_state: 600,
  project_profile: 500,
  code_map: 450,
  memory: 350,
  diagnostics: 100,
}
```

Modify `packages/core/src/context/planner.ts` so task-bearing intents keep `agent_contract`:

```ts
  if (section.kind === 'agent_contract') return ['debug', 'code_edit', 'review', 'plan', 'memory_update'].includes(intent)
```

Place that branch before `user_intent`.

- [ ] **Step 4: Build the contract section in the orchestrator**

Modify `packages/core/src/context/orchestrator.ts`.

After:

```ts
    const plan = planContext(request, conflictResolution.sections)
    const plannedSectionIds = new Set(plan.relevantSections)
    const plannedSections = conflictResolution.sections.filter((section) => plannedSectionIds.has(section.id))
```

Change to:

```ts
    const plan = planContext(request, conflictResolution.sections)
    const plannedSectionIds = new Set(plan.relevantSections)
    const plannedSections = [
      ...agentContractSections(request, plan, now()),
      ...conflictResolution.sections.filter((section) => plannedSectionIds.has(section.id)),
    ]
```

Add this helper near `sectionFromFact()`:

```ts
function agentContractSections(request: ContextRequest, plan: ContextPlan, createdAt: number): ContextSection[] {
  if (plan.missingEvidence.length === 0) return []
  const content = [
    `Intent: ${plan.intent}`,
    `Objective: ${plan.objective}`,
    'Missing evidence:',
    ...plan.missingEvidence.map((item) => `- ${item.kind}: ${item.reason}`),
    'Policy: Existing files must be read with fresh content before mutation.',
  ].join('\n')

  return [{
    id: `agent_contract_${plan.id}`,
    kind: 'agent_contract',
    title: 'Agent run contract',
    content,
    citations: [],
    priority: 100,
    confidence: 1,
    freshness: 'live',
    sourceProvider: 'JdcAgentConstraintEngine',
    tokenEstimate: Math.ceil(content.length / 4),
    ownership: { authority: 'system_instruction', topic: 'task', conflictPolicy: 'render' },
  }]
}
```

- [ ] **Step 5: Ensure prompt renderer accepts the new kind**

No special rendering code is required if `ContextSectionKind` is updated. Confirm `packages/core/src/context/prompt-renderer.ts` still uses `section.kind` in the `kind` attribute:

```ts
    `kind="${escapeAttribute(section.kind)}"`,
```

Keep this unchanged.

- [ ] **Step 6: Run context tests and verify they pass**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-planner.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/ranker.ts packages/core/src/context/planner.ts packages/core/src/context/orchestrator.ts packages/core/src/context/context-orchestrator.test.ts
git commit -m "feat: render agent run contract for missing evidence"
```

---

## Task 6: Product Eval And Documentation Gate

**Goal:** Add a focused product eval for the first runtime constraint slice and update the design spec with the chosen Phase 1/2 decisions.

**Files:**

- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

- [ ] **Step 1: Add product eval cases**

Append this test inside the existing `describe('JDC Context Engine product evals', () => { ... })` block in `packages/core/src/context/context-product-evals.test.ts`, before that block's closing `})`:

```ts
  it('surfaces a model-visible contract for code edits without relevant code evidence', async () => {
    const result = await buildContextBundle(makeEvalRequest({
      userMessage: '修复登录状态 bug',
      mode: 'code_edit',
    }), {
      injectionEnabled: true,
      store: makeEvalStore({ facts: [] }),
      providers: [],
      now: () => 1,
      id: () => 'ctx_agent_contract_eval',
    })

    expect(result.renderedPrompt).toContain('agent_contract')
    expect(result.renderedPrompt).toContain('Missing evidence')
    expect(result.renderedPrompt).toContain('Existing files must be read with fresh content before mutation.')
  })
```

- [ ] **Step 2: Run eval test and verify it passes**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected after Task 5: PASS.

- [ ] **Step 3: Update the design spec with implementation decisions**

Modify `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`.

Under `Recommended First Implementation Slice`, add:

```md
Phase 1/2 implementation decision:

- Fresh-read enforcement is implemented first in `FileReadStateCache` and `ToolRunner`.
- `Edit`, `MultiEdit`, and existing-file `Write` are blocked in the product tool path when read evidence is missing or stale.
- `ContextPlanner.missingEvidence` is the first evidence-plan surface.
- Missing evidence is rendered through an `agent_contract` context section so every model sees the runtime requirement.
- Stop/TurnEnd verification is deferred to the next implementation plan.
```

- [ ] **Step 4: Run final focused checks**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/file-read-state.test.ts src/constraints/file-mutation-policy.test.ts src/__tests__/tool-runner.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core exec vitest run src/context/context-planner.test.ts src/context/context-orchestrator.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected: PASS for all tests/build/checks.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/context-product-evals.test.ts docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md
git commit -m "test: add agent constraint product eval"
```

---

## Release Gate

Before merging the Phase 1/2 implementation, verify:

- Unread `Edit` is blocked through `ToolRunner`.
- Freshly read `Edit` passes through `ToolRunner`.
- Existing-file `Write` is blocked until read.
- New-file `Write` remains allowed.
- `ContextPlanner` reports missing evidence for code edit/debug/review turns.
- `buildContextBundle()` renders `agent_contract` when missing evidence exists.
- No existing JDC Context Engine tests lose no-cap behavior.
- No implementation adds local context token caps.

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/file-read-state.test.ts src/constraints/file-mutation-policy.test.ts src/__tests__/tool-runner.test.ts src/context/context-planner.test.ts src/context/context-orchestrator.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected: all commands pass.
