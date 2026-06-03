# Spec 6: Parallel Tool Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sequential tool execution with a read/write-separated parallel executor that runs read-only tools concurrently (max 5) and write tools serially, with batch-level abort on first failure.

**Architecture:** New `ParallelExecutor` class owns the scheduling logic (classify → parallel reads → serial writes → abort on failure). `ToolRunner` stays unchanged (single-tool executor). `Session.runLoop` replaces its `for...of` loop with one `parallelExecutor.executeBatch()` call.

**Tech Stack:** TypeScript, Vitest, Node.js AbortController/AbortSignal

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/core/src/parallel-executor.ts` (CREATE) | ParallelExecutor class + Semaphore utility |
| `packages/core/tests/parallel-executor.test.ts` (CREATE) | Unit tests for parallel execution logic |
| `packages/core/src/session.ts` (MODIFY) | Replace for-loop with executeBatch call |
| `packages/core/src/index.ts` (MODIFY) | Export ParallelExecutor |

---

### Task 1: Semaphore + ParallelExecutor — Read-Only Parallel Execution

**Files:**
- Create: `packages/core/tests/parallel-executor.test.ts`
- Create: `packages/core/src/parallel-executor.ts`

- [ ] **Step 1: Write failing test — semaphore limits concurrency**

```typescript
// packages/core/tests/parallel-executor.test.ts
import { describe, it, expect } from 'vitest'
import { ParallelExecutor } from '../src/parallel-executor.js'
import { ToolRegistry } from '../src/tool-registry.js'
import { ToolRunner } from '../src/tool-runner.js'
import { PermissionChecker } from '../src/permissions.js'

function createRunner(registry: ToolRegistry) {
  return new ToolRunner(registry, '/tmp', new PermissionChecker('relaxed'))
}

describe('ParallelExecutor', () => {
  it('should execute read-only tools in parallel', async () => {
    const registry = new ToolRegistry()
    const order: string[] = []

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        order.push(`start-${input.id}`)
        await new Promise(r => setTimeout(r, 50))
        order.push(`end-${input.id}`)
        return { content: `read-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const events: any[] = []

    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'a', name: 'file_read', input: { id: '1' } },
        { type: 'tool_use', id: 'b', name: 'file_read', input: { id: '2' } },
        { type: 'tool_use', id: 'c', name: 'file_read', input: { id: '3' } },
      ],
      (e) => events.push(e)
    )

    // All 3 should start before any ends (parallel)
    expect(order.slice(0, 3)).toEqual(['start-1', 'start-2', 'start-3'])
    // Results maintain original order
    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({ tool_use_id: 'a', content: 'read-1', is_error: false })
    expect(results[1]).toEqual({ tool_use_id: 'b', content: 'read-2', is_error: false })
    expect(results[2]).toEqual({ tool_use_id: 'c', content: 'read-3', is_error: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/parallel-executor.test.ts`
Expected: FAIL — cannot resolve `../src/parallel-executor.js`

- [ ] **Step 3: Write ParallelExecutor with semaphore**

```typescript
// packages/core/src/parallel-executor.ts
import type { ToolRunner, ToolExecutionEvent } from './tool-runner.js'

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolBatchResult {
  tool_use_id: string
  content: string
  is_error: boolean
}

const READ_TOOLS = new Set([
  'file_read', 'glob', 'grep', 'ls', 'tree',
  'web_fetch', 'web_search', 'lsp',
  'task_get', 'task_list', 'task_stop',
  'list_mcp_resources', 'read_mcp_resource', 'skill',
])

const MAX_CONCURRENCY = 5

class Semaphore {
  private queue: Array<() => void> = []
  private running = 0

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++
      return
    }
    await new Promise<void>(resolve => this.queue.push(resolve))
  }

  release(): void {
    this.running--
    const next = this.queue.shift()
    if (next) {
      this.running++
      next()
    }
  }
}

export class ParallelExecutor {
  constructor(private toolRunner: ToolRunner) {}

  async executeBatch(
    blocks: ToolUseBlock[],
    onEvent: (event: ToolExecutionEvent) => void,
    signal?: AbortSignal
  ): Promise<ToolBatchResult[]> {
    const results = new Array<ToolBatchResult>(blocks.length)
    const batchAbort = new AbortController()

    const combinedSignal = signal
      ? AbortSignal.any([signal, batchAbort.signal])
      : batchAbort.signal

    const readIndices: number[] = []
    const writeIndices: number[] = []

    for (let i = 0; i < blocks.length; i++) {
      if (READ_TOOLS.has(blocks[i].name)) {
        readIndices.push(i)
      } else {
        writeIndices.push(i)
      }
    }

    // Execute reads in parallel
    if (readIndices.length > 0) {
      const semaphore = new Semaphore(MAX_CONCURRENCY)
      const readPromises = readIndices.map(async (idx) => {
        if (batchAbort.signal.aborted) {
          results[idx] = { tool_use_id: blocks[idx].id, content: 'Cancelled: sibling tool failed', is_error: true }
          return
        }
        await semaphore.acquire()
        try {
          if (batchAbort.signal.aborted) {
            results[idx] = { tool_use_id: blocks[idx].id, content: 'Cancelled: sibling tool failed', is_error: true }
            return
          }
          const timeoutSignal = AbortSignal.timeout(120_000)
          const toolSignal = AbortSignal.any([combinedSignal, timeoutSignal])
          const result = await this.toolRunner.execute(
            blocks[idx].name, blocks[idx].id, blocks[idx].input, onEvent, toolSignal
          )
          results[idx] = { tool_use_id: blocks[idx].id, content: result.content, is_error: result.isError || false }
          if (result.isError) {
            batchAbort.abort()
          }
        } finally {
          semaphore.release()
        }
      })
      await Promise.all(readPromises)
    }

    // Execute writes serially
    for (const idx of writeIndices) {
      if (batchAbort.signal.aborted) {
        results[idx] = { tool_use_id: blocks[idx].id, content: 'Cancelled: sibling tool failed', is_error: true }
        continue
      }
      const timeoutSignal = AbortSignal.timeout(120_000)
      const toolSignal = AbortSignal.any([combinedSignal, timeoutSignal])
      const result = await this.toolRunner.execute(
        blocks[idx].name, blocks[idx].id, blocks[idx].input, onEvent, toolSignal
      )
      results[idx] = { tool_use_id: blocks[idx].id, content: result.content, is_error: result.isError || false }
      if (result.isError) {
        batchAbort.abort()
      }
    }

    // Fill any remaining nulls (shouldn't happen, but safety)
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        results[i] = { tool_use_id: blocks[i].id, content: 'Cancelled: sibling tool failed', is_error: true }
      }
    }

    return results
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/parallel-executor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parallel-executor.ts packages/core/tests/parallel-executor.test.ts
git commit -m "feat(core): add ParallelExecutor with semaphore-based concurrency"
```

---

### Task 2: Write Tools Serial Execution + Order Preservation

**Files:**
- Modify: `packages/core/tests/parallel-executor.test.ts`

- [ ] **Step 1: Write failing test — write tools execute serially**

Add to the existing test file:

```typescript
  it('should execute write tools serially in order', async () => {
    const registry = new ToolRegistry()
    const order: string[] = []

    registry.register({
      definition: { name: 'file_write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        order.push(`start-${input.id}`)
        await new Promise(r => setTimeout(r, 30))
        order.push(`end-${input.id}`)
        return { content: `wrote-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'w1', name: 'file_write', input: { id: '1' } },
        { type: 'tool_use', id: 'w2', name: 'file_write', input: { id: '2' } },
        { type: 'tool_use', id: 'w3', name: 'file_write', input: { id: '3' } },
      ],
      () => {}
    )

    // Serial: each starts only after previous ends
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3'])
    expect(results[0].content).toBe('wrote-1')
    expect(results[1].content).toBe('wrote-2')
    expect(results[2].content).toBe('wrote-3')
  })

  it('should execute reads before writes and preserve original order in results', async () => {
    const registry = new ToolRegistry()
    const execOrder: string[] = []

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        execOrder.push(`read-${input.id}`)
        await new Promise(r => setTimeout(r, 20))
        return { content: `r-${input.id}` }
      },
    })
    registry.register({
      definition: { name: 'file_write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        execOrder.push(`write-${input.id}`)
        return { content: `w-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    // Mixed order: write, read, read, write
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'a', name: 'file_write', input: { id: 'A' } },
        { type: 'tool_use', id: 'b', name: 'file_read', input: { id: 'B' } },
        { type: 'tool_use', id: 'c', name: 'file_read', input: { id: 'C' } },
        { type: 'tool_use', id: 'd', name: 'file_write', input: { id: 'D' } },
      ],
      () => {}
    )

    // Reads execute first (parallel), then writes (serial)
    expect(execOrder[0]).toBe('read-B')
    expect(execOrder[1]).toBe('read-C')
    expect(execOrder[2]).toBe('write-A')
    expect(execOrder[3]).toBe('write-D')

    // Results maintain original block order
    expect(results[0]).toEqual({ tool_use_id: 'a', content: 'w-A', is_error: false })
    expect(results[1]).toEqual({ tool_use_id: 'b', content: 'r-B', is_error: false })
    expect(results[2]).toEqual({ tool_use_id: 'c', content: 'r-C', is_error: false })
    expect(results[3]).toEqual({ tool_use_id: 'd', content: 'w-D', is_error: false })
  })
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/parallel-executor.test.ts`
Expected: PASS (implementation from Task 1 already handles this)

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/parallel-executor.test.ts
git commit -m "test(core): add serial write + order preservation tests for ParallelExecutor"
```

---

### Task 3: Batch Abort on Failure

**Files:**
- Modify: `packages/core/tests/parallel-executor.test.ts`

- [ ] **Step 1: Write failing test — abort cancels siblings**

```typescript
  it('should abort remaining tools when one fails', async () => {
    const registry = new ToolRegistry()
    const executed: string[] = []

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async (input, context) => {
        if (input.id === 'fail') {
          executed.push('fail')
          return { content: 'Error: not found', isError: true }
        }
        // Slow read — should be cancelled
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { executed.push(`done-${input.id}`); resolve(undefined) }, 200)
          context.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) })
        })
        return { content: `ok-${input.id}` }
      },
    })
    registry.register({
      definition: { name: 'file_write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        executed.push(`write-${input.id}`)
        return { content: `w-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'r1', name: 'file_read', input: { id: 'fail' } },
        { type: 'tool_use', id: 'r2', name: 'file_read', input: { id: 'slow' } },
        { type: 'tool_use', id: 'w1', name: 'file_write', input: { id: 'X' } },
      ],
      () => {}
    )

    // The failing read should have aborted the slow read and the write
    expect(results[0].is_error).toBe(true)
    expect(results[0].content).toBe('Error: not found')
    // Slow read was cancelled (either aborted or cancelled message)
    expect(results[1].is_error).toBe(true)
    // Write was never started
    expect(results[2].is_error).toBe(true)
    expect(results[2].content).toBe('Cancelled: sibling tool failed')
    expect(executed).not.toContain('write-X')
  })
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/parallel-executor.test.ts`
Expected: PASS (abort logic already in Task 1 implementation)

If the slow-read abort doesn't work cleanly (ToolRunner catches the error and returns isError), adjust the test expectation: the slow read result will have `is_error: true` with content "aborted" or similar from the ToolRunner catch block.

- [ ] **Step 3: Write test — unknown tools default to write (serial)**

```typescript
  it('should treat unknown tools as write (serial)', async () => {
    const registry = new ToolRegistry()
    const order: string[] = []

    registry.register({
      definition: { name: 'custom_tool', description: 'Custom', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        order.push(`custom-${input.id}`)
        await new Promise(r => setTimeout(r, 20))
        return { content: `c-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'x1', name: 'custom_tool', input: { id: '1' } },
        { type: 'tool_use', id: 'x2', name: 'custom_tool', input: { id: '2' } },
      ],
      () => {}
    )

    // Unknown tools run serially (treated as write)
    expect(order).toEqual(['custom-1', 'custom-2'])
    expect(results[0].is_error).toBe(false)
    expect(results[1].is_error).toBe(false)
  })
```

- [ ] **Step 4: Run all tests**

Run: `cd packages/core && npx vitest run tests/parallel-executor.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/tests/parallel-executor.test.ts
git commit -m "test(core): add abort + unknown-tool-fallback tests for ParallelExecutor"
```

---

### Task 4: Integrate ParallelExecutor into Session

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add ParallelExecutor import and field to Session**

In `packages/core/src/session.ts`, add import at the top (near other imports):

```typescript
import { ParallelExecutor } from './parallel-executor.js'
```

Add field to the Session class (next to `private toolRunner`):

```typescript
private parallelExecutor: ParallelExecutor
```

In the constructor, after `this.toolRunner = new ToolRunner(...)`:

```typescript
this.parallelExecutor = new ParallelExecutor(this.toolRunner)
```

Also in `initHooks()` after the new ToolRunner is created, add:

```typescript
this.parallelExecutor = new ParallelExecutor(this.toolRunner)
```

- [ ] **Step 2: Replace the for-loop with executeBatch**

In `packages/core/src/session.ts`, find the tool execution block (around line 393-401):

```typescript
// BEFORE:
const toolResults: any[] = []
for (const block of assistantContent) {
  if (block.type === 'tool_use') {
    const result = await this.toolRunner.execute(
      block.name, block.id, block.input, events.onToolEvent, this.abortController!.signal
    )
    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.content, is_error: result.isError })
  }
}
```

Replace with:

```typescript
// AFTER:
const toolUseBlocks = assistantContent.filter((b: any) => b.type === 'tool_use')
const batchResults = await this.parallelExecutor.executeBatch(
  toolUseBlocks,
  events.onToolEvent,
  this.abortController!.signal
)
const toolResults = batchResults.map(r => ({
  type: 'tool_result',
  tool_use_id: r.tool_use_id,
  content: r.content,
  is_error: r.is_error,
}))
```

- [ ] **Step 3: Export from index.ts**

In `packages/core/src/index.ts`, add:

```typescript
export { ParallelExecutor, type ToolUseBlock, type ToolBatchResult } from './parallel-executor.js'
```

- [ ] **Step 4: Run all core tests**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Build electron and verify app launches**

Run: `cd packages/electron && node build.mjs`
Expected: Build succeeds with no errors

Run: `cd packages/electron && NODE_ENV=development npx electron dist/main.js`
Expected: App launches, send a message, tools execute normally

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/index.ts
git commit -m "feat(core): integrate ParallelExecutor into session tool loop"
```

---

### Task 5: Semaphore Concurrency Limit Test

**Files:**
- Modify: `packages/core/tests/parallel-executor.test.ts`

- [ ] **Step 1: Write test — semaphore caps at 5 concurrent**

```typescript
  it('should limit concurrency to 5', async () => {
    const registry = new ToolRegistry()
    let maxConcurrent = 0
    let current = 0

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async () => {
        current++
        if (current > maxConcurrent) maxConcurrent = current
        await new Promise(r => setTimeout(r, 50))
        current--
        return { content: 'ok' }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    // 10 reads — should never exceed 5 concurrent
    const blocks = Array.from({ length: 10 }, (_, i) => ({
      type: 'tool_use' as const,
      id: `r${i}`,
      name: 'file_read',
      input: {},
    }))

    await executor.executeBatch(blocks, () => {})

    expect(maxConcurrent).toBe(5)
  })
```

- [ ] **Step 2: Run test**

Run: `cd packages/core && npx vitest run tests/parallel-executor.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/parallel-executor.test.ts
git commit -m "test(core): verify semaphore limits concurrency to 5"
```

---

### Task 6: External Signal Abort Test

**Files:**
- Modify: `packages/core/tests/parallel-executor.test.ts`

- [ ] **Step 1: Write test — external abort signal cancels batch**

```typescript
  it('should respect external abort signal', async () => {
    const registry = new ToolRegistry()

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async (_input, context) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 500)
          context.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) })
        })
        return { content: 'ok' }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const externalAbort = new AbortController()

    // Abort after 50ms
    setTimeout(() => externalAbort.abort(), 50)

    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'r1', name: 'file_read', input: {} },
        { type: 'tool_use', id: 'r2', name: 'file_read', input: {} },
      ],
      () => {},
      externalAbort.signal
    )

    // Both should be errors (aborted)
    expect(results[0].is_error).toBe(true)
    expect(results[1].is_error).toBe(true)
  })
```

- [ ] **Step 2: Run test**

Run: `cd packages/core && npx vitest run tests/parallel-executor.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/parallel-executor.test.ts
git commit -m "test(core): verify external abort signal propagation in ParallelExecutor"
```

---

### Task 7: End-to-End Manual Verification

**Files:** None (manual testing)

- [ ] **Step 1: Build and launch**

```bash
cd packages/electron && node build.mjs
cd packages/electron && NODE_ENV=development npx electron dist/main.js
```

- [ ] **Step 2: Test parallel reads**

Send a message that triggers multiple file reads (e.g., "读取 src/session.ts 和 src/tool-runner.ts 和 src/index.ts 的内容"). Verify all three results come back and the response is faster than sequential.

- [ ] **Step 3: Test write serialization**

Send a message that triggers multiple file writes. Verify they execute in order (check file contents or timestamps).

- [ ] **Step 4: Test mixed batch**

Send a message that triggers both reads and writes in one turn. Verify reads complete first, then writes execute serially.

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(core): address issues found in parallel executor manual testing"
```

Only commit if fixes were needed. If everything works, skip this step.
