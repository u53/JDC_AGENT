# Evidence-First Tool Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve JDCAGNET tool-result continuity by removing pre-compaction history clearing, keeping automatic compaction safeguards, returning real Read output, and making Edit/MultiEdit safer across consecutive mutations.

**Architecture:** Keep the existing automatic `compactMessages()` summary system as the only context compression mechanism. Disable `Session.microCompact()` by default, make compaction-time tool-result retention configurable and head+tail based, and centralize post-mutation file snapshots in `ConstraintPolicyRuntime`.

**Tech Stack:** TypeScript, Vitest, existing JDCAGNET core tool runner, session compaction, file mutation policy.

---

## File Structure

### Modified Files

| File | Responsibility |
|------|----------------|
| `packages/core/src/types.ts` | Add `ToolResultRetentionConfig` to `ModelConfig` |
| `packages/core/src/compact.ts` | Add configurable head+tail tool-result retention for summarized and kept messages |
| `packages/core/src/session.ts` | Disable `microCompact()` unless explicitly enabled |
| `packages/core/src/tools/file-read.ts` | Always return real file content instead of Read dedup stub |
| `packages/core/src/tool-registry.ts` | Extend mutation metadata with post-write content snapshot support |
| `packages/core/src/file-read-state.ts` | Add a full-file mutation snapshot recorder and richer diagnostics |
| `packages/core/src/constraints/policy-runtime.ts` | Record mutation snapshots instead of invalidating when snapshot metadata is present |
| `packages/core/src/constraints/file-mutation-policy.ts` | Surface richer fresh-read failure messages |
| `packages/core/src/tools/file-edit.ts` | Attach updated content snapshot to edit mutation metadata |
| `packages/core/src/tools/multi-edit.ts` | Attach updated content snapshot to multi-edit mutation metadata |
| `packages/core/src/tools/file-write.ts` | Attach written content snapshot to write mutation metadata |
| `packages/core/tests/compact-status.test.ts` | Cover head+tail compaction retention and configured budgets |
| `packages/core/src/session-context.test.ts` | Cover default-disabled microCompact and continued compaction behavior |
| `packages/core/tests/tools.test.ts` | Cover Read re-read behavior and consecutive edits without re-reading |
| `packages/core/src/file-read-state.test.ts` | Cover mutation snapshots and diagnostic messages |
| `packages/core/src/constraints/file-mutation-policy.test.ts` | Cover richer policy messages |

---

## Task 1: Add Tool Result Retention Configuration

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Write the type-level test expectation by compiling current code after adding usage in later tasks**

No standalone test is needed for this pure interface change. Later compaction/session tests will fail to compile until this type exists.

- [ ] **Step 2: Add retention config types**

Add this interface above `ModelConfig` in `packages/core/src/types.ts`:

```typescript
export interface ToolResultRetentionConfig {
  /**
   * Legacy pre-compaction cleanup. Defaults to false because the product
   * prioritizes evidence retention over token conservation.
   */
  microCompact?: boolean
  /** Maximum chars kept for successful tool_result blocks that survive compaction. */
  keptToolResultChars?: number
  /** Maximum chars kept for error tool_result blocks that survive compaction. */
  keptErrorToolResultChars?: number
  /** Maximum chars from old successful tool_result blocks shown to the summarizer. */
  summaryToolResultChars?: number
  /** Maximum chars from old error tool_result blocks shown to the summarizer. */
  summaryErrorToolResultChars?: number
}
```

Then add this field near `compressAt?: number` in `ModelConfig`:

```typescript
  toolResultRetention?: ToolResultRetentionConfig
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core build
```

Expected: build passes.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add tool result retention config"
```

---

## Task 2: Make Automatic Compaction Retain Head and Tail Evidence

**Files:**
- Modify: `packages/core/src/compact.ts`
- Modify: `packages/core/tests/compact-status.test.ts`
- Modify: `packages/core/src/session-context.test.ts`

- [ ] **Step 1: Update the existing kept tool result test to expect tail retention**

In `packages/core/tests/compact-status.test.ts`, update the test named `trims large tool results that are kept as recent messages` so the final expectations become:

```typescript
expect(toolResult?.content).toContain('Tool result truncated')
expect(toolResult?.content).toContain(`${largeOutput.length} chars`)
expect(toolResult?.content.length).toBeLessThan(9_000)
expect(toolResult?.content).toContain('start')
expect(toolResult?.content).toContain('end')
```

Expected before implementation: FAIL because current code drops the tail.

- [ ] **Step 2: Add a configurable budget test**

Add this test to `packages/core/tests/compact-status.test.ts`:

```typescript
it('uses configured kept tool result budgets during compaction', async () => {
  const largeOutput = `alpha\n${'x'.repeat(4_000)}\nomega`
  const msgs = Array.from({ length: MIN_COMPACT_LENGTH + 4 }, (_, i) =>
    i % 2 === 0 ? userMsg(`u${i}`, `u${i}`) : assistantMsg(`a${i}`, `a${i}`)
  )
  msgs.splice(
    msgs.length - 2,
    0,
    { id: 'recent_tool_use', role: 'assistant', content: [{ type: 'tool_use', id: 't-budget', name: 'Bash', input: { command: 'big output' } }], timestamp: 0 },
    { id: 'recent_tool_result', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-budget', content: largeOutput, is_error: false }], timestamp: 0 },
  )

  const result = await compactMessages(msgs, fakeProvider('summary content'), {
    ...baseConfig,
    toolResultRetention: { keptToolResultChars: 600 },
  })

  expect(result.status).toBe('compacted')
  const toolResult = result.messages
    .flatMap(msg => msg.content)
    .find(block => block.type === 'tool_result' && block.tool_use_id === 't-budget')
  expect(toolResult?.type).toBe('tool_result')
  expect(toolResult?.content).toContain('alpha')
  expect(toolResult?.content).toContain('omega')
  expect(toolResult?.content.length).toBeLessThan(1_000)
})
```

Expected before implementation: FAIL because current code ignores the configured budget.

- [ ] **Step 3: Update session context test tail expectation**

In `packages/core/src/session-context.test.ts`, update the test around lines 254-307 so it expects the retained recent tool result to include the end marker:

```typescript
expect(textFromMessages(continuedMessages)).toContain('Tool result truncated')
expect(textFromMessages(continuedMessages)).toContain('start')
expect(textFromMessages(continuedMessages)).toContain('end')
```

Expected before implementation: FAIL because current code intentionally drops `end`.

- [ ] **Step 4: Implement head+tail compaction helpers**

In `packages/core/src/compact.ts`, replace `MAX_KEPT_TOOL_RESULT_CHARS` with defaults:

```typescript
const DEFAULT_KEPT_TOOL_RESULT_CHARS = 8_000
const DEFAULT_KEPT_ERROR_TOOL_RESULT_CHARS = 16_000
const DEFAULT_SUMMARY_TOOL_RESULT_CHARS = 4_000
const DEFAULT_SUMMARY_ERROR_TOOL_RESULT_CHARS = 8_000
```

Add helpers below the constants:

```typescript
function retentionBudget(
  config: ModelConfig,
  isError: boolean | undefined,
  kind: 'kept' | 'summary'
): number {
  const retention = config.toolResultRetention
  if (kind === 'kept') {
    return isError
      ? retention?.keptErrorToolResultChars ?? DEFAULT_KEPT_ERROR_TOOL_RESULT_CHARS
      : retention?.keptToolResultChars ?? DEFAULT_KEPT_TOOL_RESULT_CHARS
  }
  return isError
    ? retention?.summaryErrorToolResultChars ?? DEFAULT_SUMMARY_ERROR_TOOL_RESULT_CHARS
    : retention?.summaryToolResultChars ?? DEFAULT_SUMMARY_TOOL_RESULT_CHARS
}

function headTail(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text
  const marker = `\n[${label} — original ${text.length} chars, ${text.length - maxChars} chars removed.]\n`
  const bodyBudget = Math.max(0, maxChars - marker.length)
  const headChars = Math.ceil(bodyBudget / 2)
  const tailChars = Math.floor(bodyBudget / 2)
  return `${text.slice(0, headChars)}${marker}${text.slice(text.length - tailChars)}`
}
```

- [ ] **Step 5: Pass config into summary sanitization and kept trimming**

Change the call sites in `compactMessages()`:

```typescript
const toKeep = trimKeptToolResults(messages.slice(cutIndex), config)
```

```typescript
...sanitizeForSummaryPrompt(toCompress, config),
```

Change the function signatures:

```typescript
function sanitizeForSummaryPrompt(messages: Message[], config: ModelConfig): Message[] {
```

```typescript
function trimKeptToolResults(messages: Message[], config: ModelConfig): Message[] {
```

- [ ] **Step 6: Use head+tail preview for summarized old tool results**

Inside `sanitizeForSummaryPrompt()`, replace:

```typescript
const preview = typeof block.content === 'string' ? block.content.slice(0, 500) : ''
const errMark = block.is_error ? ' (error)' : ''
return { type: 'text', text: `[tool result${errMark}: ${preview}]` }
```

with:

```typescript
const raw = typeof block.content === 'string' ? block.content : ''
const preview = headTail(raw, retentionBudget(config, block.is_error, 'summary'), 'Tool result summarized with head and tail')
const errMark = block.is_error ? ' (error)' : ''
return { type: 'text', text: `[tool result${errMark}: ${preview}]` }
```

- [ ] **Step 7: Use head+tail retention for kept recent tool results**

Inside `trimKeptToolResults()`, replace the body of the `map` callback with:

```typescript
if (block.type !== 'tool_result') return block

const budget = retentionBudget(config, block.is_error, 'kept')
if (block.content.length <= budget) return block

changed = true
const errMark = block.is_error ? ' error' : ''
return {
  ...block,
  content: headTail(block.content, budget, `Tool result truncated during compaction${errMark}`),
}
```

- [ ] **Step 8: Run compaction tests**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core test ../../packages/core/tests/compact-status.test.ts ../../packages/core/src/session-context.test.ts
```

Expected: compaction-related tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/compact.ts packages/core/tests/compact-status.test.ts packages/core/src/session-context.test.ts
git commit -m "feat(core): preserve head and tail in compacted tool results"
```

---

## Task 3: Disable Pre-Compaction Micro-Compaction by Default

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session-context.test.ts`

- [ ] **Step 1: Add tests for default-disabled and explicitly-enabled microCompact**

Add these tests to `packages/core/src/session-context.test.ts` near the other compaction tests:

```typescript
it('does not micro-compact old tool results by default', async () => {
  const session = await makeSession({
    contextConfig: { enabled: false } as any,
    modelConfig: { contextWindow: 128_000, compressAt: 0.9 },
  })
  ;(session as any).messages = [
    { id: 'a1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_old', name: 'Bash', input: { command: 'printf big' } }], timestamp: 1 },
    { id: 'u1', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_old', content: `start\n${'x'.repeat(2_000)}\nend`, is_error: false }], timestamp: 2 },
  ]
  ;(session as any).usageTracker.getSnapshot = () => ({ contextUsedPercent: 50 })

  ;(session as any).microCompact()

  expect(textFromMessages(session.getMessages())).toContain('start')
  expect(textFromMessages(session.getMessages())).toContain('end')
  expect(textFromMessages(session.getMessages())).not.toContain('Tool result cleared')
})

it('keeps legacy micro-compact available when explicitly enabled', async () => {
  const session = await makeSession({
    contextConfig: { enabled: false } as any,
    modelConfig: {
      contextWindow: 128_000,
      compressAt: 0.9,
      toolResultRetention: { microCompact: true },
    },
  })
  ;(session as any).messages = Array.from({ length: 12 }, (_, i) => ({
    id: `u${i}`,
    role: 'user' as const,
    content: [{ type: 'tool_result' as const, tool_use_id: `toolu_${i}`, content: `result ${i}\n${'x'.repeat(600)}`, is_error: false }],
    timestamp: i,
  }))
  ;(session as any).usageTracker.getSnapshot = () => ({ contextUsedPercent: 50 })

  ;(session as any).microCompact()

  expect(textFromMessages(session.getMessages())).toContain('Tool result cleared')
})
```

Expected before implementation: first test fails because `microCompact()` mutates old results by default.

- [ ] **Step 2: Guard microCompact with retention config**

At the top of `microCompact()` in `packages/core/src/session.ts`, add:

```typescript
    if (this.config.modelConfig.toolResultRetention?.microCompact !== true) {
      return
    }
```

Leave the rest of the legacy method intact so explicit opt-in still works.

- [ ] **Step 3: Verify compaction still runs when needed**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core test ../../packages/core/src/session-context.test.ts
```

Expected: all session context tests pass, including automatic compaction tests.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/session-context.test.ts
git commit -m "feat(core): disable micro compaction by default"
```

---

## Task 4: Always Return Real Read Output

**Files:**
- Modify: `packages/core/src/tools/file-read.ts`
- Modify: `packages/core/tests/tools.test.ts`

- [ ] **Step 1: Add a failing re-read test**

Add this test to `packages/core/tests/tools.test.ts`:

```typescript
it('file_read: returns real content when re-reading an unchanged range', async () => {
  const runner = await setup()
  const testFile = path.join(tmpDir, 'reread.txt')
  await writeFile(testFile, 'alpha\nbeta\n', 'utf-8')

  const first = await runner.execute('Read', 'id-reread-1', { file_path: testFile }, () => {})
  const second = await runner.execute('Read', 'id-reread-2', { file_path: testFile }, () => {})

  expect(first.content).toContain('1\talpha')
  expect(second.content).toContain('1\talpha')
  expect(second.content).toContain('2\tbeta')
  expect(second.content).not.toContain('File unchanged since last read')
})
```

Expected before implementation: FAIL because the second read returns the dedup stub.

- [ ] **Step 2: Remove Read dedup branch**

In `packages/core/src/tools/file-read.ts`, delete the exported `FILE_UNCHANGED_MESSAGE` constant and delete this block:

```typescript
    // Dedup: if we've already read this exact range and the file hasn't changed, return stub
    if (context.fileReadState?.canDedup(filePath, offset, limit)) {
      return { content: FILE_UNCHANGED_MESSAGE }
    }
```

Update the tool description by replacing:

```typescript
- Do NOT re-read a file you just edited — the edit was successful if no error was returned.
- If you re-read an unchanged file, you'll get a stub message pointing you to the earlier result.
```

with:

```typescript
- Re-reading returns the current file content so later edits can rely on visible context.
- After a successful edit or write, the mutation is recorded as fresh state; re-read only when you need visible context.
```

- [ ] **Step 3: Run tool tests**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core test ../../packages/core/tests/tools.test.ts
```

Expected: all tool tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tools/file-read.ts packages/core/tests/tools.test.ts
git commit -m "feat(core): always return content from read tool"
```

---

## Task 5: Record Fresh File State After Mutations

**Files:**
- Modify: `packages/core/src/tool-registry.ts`
- Modify: `packages/core/src/file-read-state.ts`
- Modify: `packages/core/src/constraints/policy-runtime.ts`
- Modify: `packages/core/src/tools/file-edit.ts`
- Modify: `packages/core/src/tools/multi-edit.ts`
- Modify: `packages/core/src/tools/file-write.ts`
- Modify: `packages/core/src/file-read-state.test.ts`
- Modify: `packages/core/tests/tools.test.ts`

- [ ] **Step 1: Add a FileReadState mutation snapshot test**

Add this test to `packages/core/src/file-read-state.test.ts`:

```typescript
it('accepts a fresh mutation snapshot after a file changes', async () => {
  const cache = new FileReadStateCache()
  await writeFile(filePath, 'const alpha = 10\nconst beta = 2\n', 'utf-8')

  cache.recordMutationSnapshot(filePath, 'const alpha = 10\nconst beta = 2\n')

  expect(cache.checkFreshRead(filePath, { requiredText: 'const alpha = 10' }).ok).toBe(true)
  expect(cache.canDedup(filePath, 0, 3)).toBe(false)
})
```

Expected before implementation: FAIL because `recordMutationSnapshot()` does not exist.

- [ ] **Step 2: Add a ToolRunner consecutive edit test**

Add this test to `packages/core/tests/tools.test.ts`:

```typescript
it('file_edit: supports consecutive edits after mutation snapshot without re-reading', async () => {
  const runner = await setup()
  const testFile = path.join(tmpDir, 'consecutive-edit.txt')
  await writeFile(testFile, 'const alpha = 1\nconst beta = 2\n', 'utf-8')

  await runner.execute('Read', 'id-consecutive-read', { file_path: testFile }, () => {})
  const first = await runner.execute('Edit', 'id-consecutive-edit-1', {
    file_path: testFile,
    old_string: 'const alpha = 1',
    new_string: 'const alpha = 10',
  }, () => {})
  const second = await runner.execute('Edit', 'id-consecutive-edit-2', {
    file_path: testFile,
    old_string: 'const beta = 2',
    new_string: 'const beta = 20',
  }, () => {})

  expect(first.isError).not.toBe(true)
  expect(second.isError).not.toBe(true)
  expect(second.content).toContain('Successfully')
})
```

Expected before implementation: FAIL because the first edit invalidates read state and the second edit is blocked.

- [ ] **Step 3: Extend mutation metadata**

In `packages/core/src/tool-registry.ts`, change the mutation metadata type from:

```typescript
  mutations?: Array<{
    filePath: string
    kind: 'edit' | 'multi_edit' | 'write'
  }>
```

to:

```typescript
  mutations?: Array<{
    filePath: string
    kind: 'edit' | 'multi_edit' | 'write'
    contentSnapshot?: string
  }>
```

- [ ] **Step 4: Add mutation snapshot support to FileReadStateCache**

In `packages/core/src/file-read-state.ts`, add this public method after `recordRead()`:

```typescript
  /**
   * Record the current full-file content after a successful mutation. This is
   * fresh enough for later mutation checks but is not used for Read dedup.
   */
  recordMutationSnapshot(filePath: string, content: string): void {
    const totalLines = content.split('\n').length
    this.recordEntry(filePath, 0, totalLines, totalLines, content, false)
  }
```

Refactor `recordRead()` to call a new private helper:

```typescript
  recordRead(filePath: string, offset: number, limit: number, totalLines = Number.POSITIVE_INFINITY, content = ''): void {
    this.recordEntry(filePath, offset, limit, totalLines, content, true)
  }

  private recordEntry(filePath: string, offset: number, limit: number, totalLines: number, content: string, fromRead: boolean): void {
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
        fromRead,
      }
      const entries = this.cache.get(filePath) ?? []
      entries.push(entry)
      this.cache.set(filePath, entries)
      this.entryOrder.push({ filePath, entry })
      this.evictIfNeeded()
    } catch {
      // File might not exist or be inaccessible — skip caching
    }
  }
```

Delete the duplicated body from the old `recordRead()` after the helper is in place.

- [ ] **Step 5: Centralize mutation state handling in policy runtime**

In `packages/core/src/constraints/policy-runtime.ts`, replace:

```typescript
        context.fileReadState.invalidate(mutation.filePath)
```

with:

```typescript
        if (mutation.contentSnapshot !== undefined) {
          context.fileReadState.recordMutationSnapshot(mutation.filePath, mutation.contentSnapshot)
        } else {
          context.fileReadState.invalidate(mutation.filePath)
        }
```

- [ ] **Step 6: Attach snapshots from file tools**

In `packages/core/src/tools/file-edit.ts`, remove both direct `context.fileReadState?.invalidate(filePath)` calls and change both mutation metadata returns to include `contentSnapshot: updated`:

```typescript
metadata: { mutations: [{ filePath, kind: 'edit', contentSnapshot: updated }] },
```

In `packages/core/src/tools/multi-edit.ts`, remove `context.fileReadState?.invalidate(filePath)` and change metadata to:

```typescript
metadata: { mutations: [{ filePath, kind: 'multi_edit', contentSnapshot: content }] },
```

In `packages/core/src/tools/file-write.ts`, remove `context.fileReadState?.invalidate(filePath)` and change metadata to:

```typescript
metadata: { mutations: [{ filePath, kind: 'write', contentSnapshot: contentInput }] },
```

- [ ] **Step 7: Update existing metadata tests**

In `packages/core/tests/tools.test.ts`, update the `file_write: returns structured mutation metadata` expectation to:

```typescript
expect(result.metadata).toEqual({
  mutations: [{ filePath: file, kind: 'write', contentSnapshot: 'export const value = 1\n' }],
})
```

- [ ] **Step 8: Run file state and tool tests**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core test ../../packages/core/src/file-read-state.test.ts ../../packages/core/tests/tools.test.ts ../../packages/core/src/constraints/file-mutation-policy.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/tool-registry.ts packages/core/src/file-read-state.ts packages/core/src/constraints/policy-runtime.ts packages/core/src/tools/file-edit.ts packages/core/src/tools/multi-edit.ts packages/core/src/tools/file-write.ts packages/core/src/file-read-state.test.ts packages/core/tests/tools.test.ts
git commit -m "feat(core): record fresh snapshots after file mutations"
```

---

## Task 6: Improve File Mutation Policy Diagnostics

**Files:**
- Modify: `packages/core/src/file-read-state.ts`
- Modify: `packages/core/src/constraints/file-mutation-policy.test.ts`
- Modify: `packages/core/src/file-read-state.test.ts`

- [ ] **Step 1: Add diagnostic expectation for missing edit anchor**

In `packages/core/src/constraints/file-mutation-policy.test.ts`, update `blocks MultiEdit when one edit anchor was not read` to also assert:

```typescript
expect(decision.reason).toContain('Read ranges:')
expect(decision.reason).toContain('lines 1-1')
expect(decision.reason).toContain('Missing edit anchor:')
expect(decision.reason).toContain('const beta = 2')
```

Expected before implementation: FAIL because the message is currently generic.

- [ ] **Step 2: Add stale diagnostics test**

Add this test to `packages/core/src/file-read-state.test.ts`:

```typescript
it('includes read range diagnostics when an edit anchor is outside the read ranges', () => {
  const cache = new FileReadStateCache()
  cache.recordRead(filePath, 0, 1, 2, 'const alpha = 1')

  const result = cache.checkFreshRead(filePath, { requiredText: 'const beta = 2' })

  expect(result.ok).toBe(false)
  expect(result.message).toContain('Read ranges:')
  expect(result.message).toContain('lines 1-1')
  expect(result.message).toContain('Missing edit anchor:')
  expect(result.message).toContain('const beta = 2')
})
```

- [ ] **Step 3: Add helper methods to FileReadStateCache**

In `packages/core/src/file-read-state.ts`, add these private methods before `isEntryFresh()`:

```typescript
  private describeEntries(entries: FileReadEntry[]): string {
    if (entries.length === 0) return 'none'
    return entries.map((entry) => {
      const start = entry.offset + 1
      const effectiveLimit = entry.limit === Infinity ? entry.totalLines : entry.limit
      const end = Math.min(entry.offset + effectiveLimit, entry.totalLines)
      const source = entry.fromRead ? 'Read' : 'mutation snapshot'
      return `${source} lines ${start}-${end}${entry.fullFile ? ' (full file)' : ''}`
    }).join('; ')
  }

  private previewRequiredText(requiredText?: string): string {
    if (!requiredText) return '(none)'
    const normalized = requiredText.replace(/\s+/g, ' ').trim()
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
  }
```

- [ ] **Step 4: Use diagnostics in failure messages**

In `checkFreshRead()`, change the `not_read` branch to:

```typescript
return {
  ok: false,
  reason: 'not_read',
  message: `${filePath} has not been read in this session. Missing edit anchor: ${this.previewRequiredText(options.requiredText)}.`,
}
```

Change the `range_not_read` branch for `requireFullFile` to:

```typescript
message: `${filePath} was read only in ranges. Read the entire file before overwriting it. Read ranges: ${this.describeEntries(freshEntries)}.`,
```

Change the `range_not_read` branch for required text to:

```typescript
message: `${filePath} was read only in ranges that do not include the edit anchor. Read the relevant range before editing. Read ranges: ${this.describeEntries(freshEntries)}. Missing edit anchor: ${this.previewRequiredText(requiredText)}.`,
```

- [ ] **Step 5: Run policy tests**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core test ../../packages/core/src/file-read-state.test.ts ../../packages/core/src/constraints/file-mutation-policy.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/file-read-state.ts packages/core/src/file-read-state.test.ts packages/core/src/constraints/file-mutation-policy.test.ts
git commit -m "feat(core): improve file mutation policy diagnostics"
```

---

## Task 7: Full Verification

**Files:**
- No source changes unless verification exposes a failure.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core test ../../packages/core/tests/compact-status.test.ts ../../packages/core/src/session-context.test.ts ../../packages/core/tests/tools.test.ts ../../packages/core/src/file-read-state.test.ts ../../packages/core/src/constraints/file-mutation-policy.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full core tests**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core test
```

Expected: all core tests pass.

- [ ] **Step 3: Run core build**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core build
```

Expected: build passes with no TypeScript errors.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
cd /Users/chenmingxu/Documents/jdcagnet
git diff --stat
git diff -- packages/core/src/compact.ts packages/core/src/session.ts packages/core/src/tools/file-read.ts packages/core/src/file-read-state.ts packages/core/src/constraints/policy-runtime.ts packages/core/src/constraints/file-mutation-policy.ts packages/core/src/tools/file-edit.ts packages/core/src/tools/multi-edit.ts packages/core/src/tools/file-write.ts packages/core/src/tool-registry.ts
```

Expected: changes match this plan, with no UI Bash card expansion changes.

- [ ] **Step 5: Handle verification failures**

If Step 1, Step 2, or Step 3 fails, return to the task that introduced the failing behavior and complete that task's test-fix-commit loop again. Do not create a catch-all verification commit from this task.

---

## Completion Criteria

- `Session.microCompact()` does nothing unless `modelConfig.toolResultRetention.microCompact === true`.
- Automatic `compactMessages()` still trims retained recent tool results, but uses configurable head+tail retention.
- Older tool results shown to the summarizer use configurable head+tail previews instead of only the first 500 chars.
- `Read` always returns current file content.
- Consecutive file edits work after one initial read because mutation snapshots become fresh file state.
- Edit/MultiEdit/Write metadata includes `contentSnapshot` for successful mutations.
- File mutation policy errors include read ranges and missing edit anchor previews.
- No Bash card default expansion behavior changes.
- Focused tests, full core tests, and core build pass.
