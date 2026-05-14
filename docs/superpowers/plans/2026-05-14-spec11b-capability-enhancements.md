# Spec 11b: Capability Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 independent enhancements: system prompt deepening, background tasks, edit improvements, push notifications, and token estimation optimization.

**Architecture:** Each enhancement is independent — no cross-dependencies. System prompt changes are pure text in `base-prompt.ts`. Background tasks add a new manager class + tools. Edit/notify/token are small tool-level changes.

**Tech Stack:** TypeScript, Vitest, Electron Notification API, child_process spawn

---

## File Structure

### New Files
- `packages/core/src/background-tasks.ts` — BackgroundTaskManager class
- `packages/core/src/tools/task-output.ts` — task_output tool
- `packages/core/src/tools/monitor.ts` — monitor tool
- `packages/core/src/tools/multi-edit.ts` — multi_edit tool
- `packages/core/src/tools/notify.ts` — notify tool
- `packages/core/src/__tests__/background-tasks.test.ts`
- `packages/core/src/__tests__/token-estimation.test.ts`
- `packages/core/src/__tests__/multi-edit.test.ts`

### Modified Files
- `packages/core/src/base-prompt.ts` — Add examples, verification, git safety, compaction guidance
- `packages/core/src/tools/bash.ts` — Add run_in_background parameter
- `packages/core/src/tools/file-edit.ts` — Add replace_all parameter
- `packages/core/src/token-estimation.ts` — Improved algorithm
- `packages/core/src/tools/index.ts` — Register new tools
- `packages/core/src/index.ts` — Export new types
- `packages/core/src/session.ts` — Pass BackgroundTaskManager to tools
- `packages/electron/src/ipc-channels.ts` — Add NOTIFY channel
- `packages/electron/src/ipc-handlers.ts` — Notify handler
- `packages/electron/src/preload.ts` — Expose notify

---

### Task 1: Token Estimation Optimization

**Files:**
- Modify: `packages/core/src/token-estimation.ts`
- Create: `packages/core/src/__tests__/token-estimation.test.ts`

- [ ] **Step 1: Write test**

```typescript
// packages/core/src/__tests__/token-estimation.test.ts
import { describe, it, expect } from 'vitest'
import { estimateTokens } from '../token-estimation.js'
import type { Message } from '../types.js'

function makeMsg(text: string): Message {
  return { id: '1', role: 'user', content: [{ type: 'text', text }], timestamp: 0 }
}

describe('estimateTokens', () => {
  it('estimates English text (~4 chars/token)', () => {
    const tokens = estimateTokens([makeMsg('Hello world this is a test')])
    // 26 chars / ~4 = ~7 tokens
    expect(tokens).toBeGreaterThan(5)
    expect(tokens).toBeLessThan(12)
  })

  it('estimates Chinese text (~1.5 chars/token)', () => {
    const tokens = estimateTokens([makeMsg('你好世界这是一个测试')])
    // 10 CJK chars * 1.5 = ~15 tokens
    expect(tokens).toBeGreaterThan(12)
    expect(tokens).toBeLessThan(20)
  })

  it('estimates mixed content', () => {
    const tokens = estimateTokens([makeMsg('Hello 你好 world 世界')])
    // "Hello " = 6 ascii * 0.25 = 1.5, "你好" = 2 * 1.5 = 3, " world " = 7 * 0.25 = 1.75, "世界" = 2 * 1.5 = 3
    // total ~9.25 → ceil = 10
    expect(tokens).toBeGreaterThan(7)
    expect(tokens).toBeLessThan(15)
  })

  it('handles image blocks', () => {
    const msg: Message = { id: '1', role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }], timestamp: 0 }
    expect(estimateTokens([msg])).toBe(1000)
  })

  it('handles tool_use blocks', () => {
    const msg: Message = { id: '1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'file_read', input: { file_path: '/src/index.ts' } }], timestamp: 0 }
    const tokens = estimateTokens([msg])
    expect(tokens).toBeGreaterThan(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails (or passes with wrong values)**

Run: `cd packages/core && npx vitest run src/__tests__/token-estimation.test.ts`
Expected: Chinese test likely fails (current algo uses chars/3.5 which underestimates CJK)

- [ ] **Step 3: Implement improved algorithm**

Replace `packages/core/src/token-estimation.ts`:

```typescript
import type { Message } from './types.js'

export function estimateTokens(messages: Message[]): number {
  let tokens = 0
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'text') tokens += estimateTextTokens(block.text)
      else if (block.type === 'tool_use') tokens += estimateTextTokens(JSON.stringify(block.input)) + block.name.length
      else if (block.type === 'tool_result') tokens += estimateTextTokens(block.content)
      else if (block.type === 'image') tokens += 1000
    }
  }
  return tokens
}

function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code >= 0x4E00 && code <= 0x9FFF) {
      tokens += 1.5
    } else if (code >= 0x3000 && code <= 0x303F) {
      tokens += 1
    } else if (code >= 0xFF00 && code <= 0xFFEF) {
      tokens += 1
    } else if (code > 0x7F) {
      tokens += 1
    } else {
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && npx vitest run src/__tests__/token-estimation.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-estimation.ts packages/core/src/__tests__/token-estimation.test.ts
git commit -m "feat: improve token estimation with CJK-aware character counting"
```

---

### Task 2: Edit Enhancement (replace_all + multi_edit)

**Files:**
- Modify: `packages/core/src/tools/file-edit.ts`
- Create: `packages/core/src/tools/multi-edit.ts`
- Create: `packages/core/src/__tests__/multi-edit.test.ts`
- Modify: `packages/core/src/tools/index.ts`

- [ ] **Step 1: Add replace_all to file-edit.ts**

In `packages/core/src/tools/file-edit.ts`, update inputSchema and execute:

```typescript
// Add to inputSchema.properties:
replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' },

// In execute(), after the uniqueness check:
const replaceAll = input.replace_all as boolean || false

if (replaceAll) {
  const occurrences = content.split(oldStr).length - 1
  if (occurrences === 0) {
    return { content: 'Error: old_string not found in file', isError: true }
  }
  const updated = content.replaceAll(oldStr, newStr)
  await writeFile(filePath, updated, 'utf-8')
  if (context.fileTracker && context.toolUseId) {
    await context.fileTracker.recordChange(filePath, content, updated, context.toolUseId, context.turnIndex || 0)
  }
  return { content: `Successfully replaced ${occurrences} occurrences in ${filePath}` }
}

// Existing single-replace logic follows (unchanged)
```

- [ ] **Step 2: Write multi-edit test**

```typescript
// packages/core/src/__tests__/multi-edit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { multiEditTool } from '../tools/multi-edit.js'

describe('multi_edit tool', () => {
  const tmpDir = path.join(os.tmpdir(), 'multi-edit-test')
  const testFile = path.join(tmpDir, 'test.ts')

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(testFile, 'const a = 1\nconst b = 2\nconst c = 3\n')
  })

  afterEach(async () => {
    try { await unlink(testFile) } catch {}
  })

  it('applies multiple edits in order', async () => {
    const result = await multiEditTool.execute({
      file_path: testFile,
      edits: [
        { old_string: 'const a = 1', new_string: 'const a = 10' },
        { old_string: 'const b = 2', new_string: 'const b = 20' },
      ],
    }, { cwd: tmpDir })
    expect(result.isError).toBeFalsy()
    const content = await readFile(testFile, 'utf-8')
    expect(content).toContain('const a = 10')
    expect(content).toContain('const b = 20')
    expect(content).toContain('const c = 3')
  })

  it('rolls back on failure', async () => {
    const result = await multiEditTool.execute({
      file_path: testFile,
      edits: [
        { old_string: 'const a = 1', new_string: 'const a = 10' },
        { old_string: 'NONEXISTENT', new_string: 'whatever' },
      ],
    }, { cwd: tmpDir })
    expect(result.isError).toBe(true)
    const content = await readFile(testFile, 'utf-8')
    expect(content).toContain('const a = 1') // rolled back
  })
})
```

- [ ] **Step 3: Implement multi-edit.ts**

```typescript
// packages/core/src/tools/multi-edit.ts
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

interface EditOp {
  old_string: string
  new_string: string
}

export const multiEditTool: ToolHandler = {
  definition: {
    name: 'multi_edit',
    description: 'Apply multiple string replacements to a single file atomically. All edits succeed or none are applied.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file' },
        edits: {
          type: 'array',
          description: 'Array of {old_string, new_string} replacements applied in order',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string' },
              new_string: { type: 'string' },
            },
            required: ['old_string', 'new_string'],
          },
        },
      },
      required: ['file_path', 'edits'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePathInput = input.file_path as string
    const edits = input.edits as EditOp[]
    if (!filePathInput || !edits || !Array.isArray(edits)) {
      return { content: 'Error: file_path and edits array are required', isError: true }
    }

    const filePath = path.isAbsolute(filePathInput) ? filePathInput : path.resolve(context.cwd, filePathInput)

    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch (err: any) {
      return { content: `Error reading file: ${err.message}`, isError: true }
    }

    const original = content
    for (let i = 0; i < edits.length; i++) {
      const { old_string, new_string } = edits[i]
      if (!content.includes(old_string)) {
        return { content: `Error: edit ${i + 1} old_string not found in file (after applying previous edits)`, isError: true }
      }
      const occurrences = content.split(old_string).length - 1
      if (occurrences > 1) {
        return { content: `Error: edit ${i + 1} old_string appears ${occurrences} times, must be unique`, isError: true }
      }
      content = content.replace(old_string, new_string)
    }

    await writeFile(filePath, content, 'utf-8')
    if (context.fileTracker && context.toolUseId) {
      await context.fileTracker.recordChange(filePath, original, content, context.toolUseId, context.turnIndex || 0)
    }
    return { content: `Successfully applied ${edits.length} edits to ${filePath}` }
  },
}
```

- [ ] **Step 4: Register multi_edit in tools/index.ts**

Add to `packages/core/src/tools/index.ts`:

```typescript
import { multiEditTool } from './multi-edit.js'

// In registerBuiltinTools:
registry.register(multiEditTool)

// In exports:
export { multiEditTool }
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run src/__tests__/multi-edit.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/file-edit.ts packages/core/src/tools/multi-edit.ts packages/core/src/__tests__/multi-edit.test.ts packages/core/src/tools/index.ts
git commit -m "feat: add replace_all to file_edit + new multi_edit tool"
```

---

### Task 3: Push Notifications

**Files:**
- Create: `packages/core/src/tools/notify.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/electron/src/ipc-channels.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`

- [ ] **Step 1: Implement notify tool**

```typescript
// packages/core/src/tools/notify.ts
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export type NotifyCallback = (message: string) => void

export function createNotifyTool(onNotify: NotifyCallback): ToolHandler {
  return {
    definition: {
      name: 'notify',
      description: 'Send a desktop notification to get the user\'s attention. Use sparingly — only when a long task completes or you need user input while they may be away.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Notification body (max 200 chars)' },
        },
        required: ['message'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const message = (input.message as string || '').slice(0, 200)
      if (!message) {
        return { content: 'Error: message is required', isError: true }
      }
      onNotify(message)
      return { content: 'Notification sent.' }
    },
  }
}
```

- [ ] **Step 2: Add IPC channel and handler**

In `packages/electron/src/ipc-channels.ts`:
```typescript
NOTIFY_SHOW: 'notify:show',
```

In `packages/electron/src/ipc-handlers.ts`, no handler needed — the notify tool calls directly via the callback wired in session-manager.

- [ ] **Step 3: Wire notify in session-manager.ts**

In `activateSession()`, after creating the session:

```typescript
import { Notification } from 'electron'
import { createNotifyTool } from '@jdcagnet/core'

// In activateSession, create notify callback:
const onNotify = (message: string) => {
  const notification = new Notification({ title: 'JDCAGNET', body: message })
  notification.on('click', () => { this.window?.focus() })
  notification.show()
}
session.registerTool(createNotifyTool(onNotify))
```

Note: `Notification` must be imported from `electron` in the main process. Since session-manager runs in main, this works directly.

- [ ] **Step 4: Build and test**

Run: `node packages/electron/build.mjs`
Run: `cd packages/electron && NODE_ENV=development npx electron dist/main.js`
Test: Ask the model to "send me a notification saying hello" — should see desktop notification.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/notify.ts packages/electron/src/session-manager.ts packages/electron/src/ipc-channels.ts
git commit -m "feat: add notify tool for desktop notifications"
```

---

### Task 4: Background Tasks

**Files:**
- Create: `packages/core/src/background-tasks.ts`
- Create: `packages/core/src/tools/task-output.ts`
- Create: `packages/core/src/tools/monitor.ts`
- Create: `packages/core/src/__tests__/background-tasks.test.ts`
- Modify: `packages/core/src/tools/bash.ts`
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: Write BackgroundTaskManager test**

```typescript
// packages/core/src/__tests__/background-tasks.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { BackgroundTaskManager } from '../background-tasks.js'
import os from 'node:os'
import path from 'node:path'

describe('BackgroundTaskManager', () => {
  const mgr = new BackgroundTaskManager(path.join(os.tmpdir(), 'bg-tasks-test'))

  afterEach(() => { mgr.stopAll() })

  it('spawns a background task', async () => {
    const task = mgr.spawn('echo hello', '/tmp')
    expect(task.id).toBeDefined()
    expect(task.status).toBe('running')
    // Wait for completion
    await new Promise(r => setTimeout(r, 500))
    const updated = mgr.getTask(task.id)
    expect(updated?.status).toBe('completed')
    expect(updated?.exitCode).toBe(0)
  })

  it('gets task output', async () => {
    const task = mgr.spawn('echo hello && echo world', '/tmp')
    await new Promise(r => setTimeout(r, 500))
    const output = mgr.getOutput(task.id)
    expect(output).toContain('hello')
    expect(output).toContain('world')
  })

  it('stops a running task', async () => {
    const task = mgr.spawn('sleep 60', '/tmp')
    expect(task.status).toBe('running')
    mgr.stop(task.id)
    await new Promise(r => setTimeout(r, 200))
    const updated = mgr.getTask(task.id)
    expect(updated?.status).toBe('failed')
  })

  it('lists running tasks', () => {
    const t1 = mgr.spawn('sleep 60', '/tmp')
    const t2 = mgr.spawn('sleep 60', '/tmp')
    const running = mgr.listRunning()
    expect(running.length).toBeGreaterThanOrEqual(2)
    mgr.stop(t1.id)
    mgr.stop(t2.id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/background-tasks.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement BackgroundTaskManager**

```typescript
// packages/core/src/background-tasks.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { v4 as uuid } from 'uuid'
import path from 'node:path'

export interface BackgroundTask {
  id: string
  command: string
  pid: number
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  logFile: string
  startedAt: number
}

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>()
  private processes = new Map<string, ChildProcess>()
  private logDir: string

  constructor(logDir: string) {
    this.logDir = logDir
    mkdirSync(logDir, { recursive: true })
  }

  spawn(command: string, cwd: string): BackgroundTask {
    const id = uuid().slice(0, 8)
    const logFile = path.join(this.logDir, `${id}.log`)
    writeFileSync(logFile, '')

    const proc = spawn('sh', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    const task: BackgroundTask = {
      id,
      command,
      pid: proc.pid || 0,
      status: 'running',
      logFile,
      startedAt: Date.now(),
    }

    proc.stdout?.on('data', (data) => {
      appendFileSync(logFile, data.toString())
    })
    proc.stderr?.on('data', (data) => {
      appendFileSync(logFile, data.toString())
    })
    proc.on('close', (code) => {
      task.status = code === 0 ? 'completed' : 'failed'
      task.exitCode = code ?? 1
      this.processes.delete(id)
    })

    this.tasks.set(id, task)
    this.processes.set(id, proc)
    return task
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  getOutput(id: string, tail?: number): string {
    const task = this.tasks.get(id)
    if (!task) return ''
    try {
      const content = readFileSync(task.logFile, 'utf-8')
      if (tail) {
        const lines = content.split('\n')
        return lines.slice(-tail).join('\n')
      }
      return content
    } catch { return '' }
  }

  stop(id: string): void {
    const proc = this.processes.get(id)
    if (proc) {
      proc.kill('SIGTERM')
      setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 3000)
    }
  }

  stopAll(): void {
    for (const id of this.processes.keys()) {
      this.stop(id)
    }
  }

  listRunning(): BackgroundTask[] {
    return [...this.tasks.values()].filter(t => t.status === 'running')
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && npx vitest run src/__tests__/background-tasks.test.ts`
Expected: All PASS

- [ ] **Step 5: Implement task_output tool**

```typescript
// packages/core/src/tools/task-output.ts
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'

export function createTaskOutputTool(mgr: BackgroundTaskManager): ToolHandler {
  return {
    definition: {
      name: 'task_output',
      description: 'Get the output of a background task by its ID.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The background task ID' },
          tail: { type: 'number', description: 'Only return last N lines' },
        },
        required: ['task_id'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const taskId = input.task_id as string
      const tail = input.tail as number | undefined
      const task = mgr.getTask(taskId)
      if (!task) return { content: `Error: task ${taskId} not found`, isError: true }

      const output = mgr.getOutput(taskId, tail)
      const header = `Task ${taskId}: ${task.status} (command: ${task.command})\nExit code: ${task.exitCode ?? 'still running'}\n---\n`
      return { content: header + (output || '(no output yet)') }
    },
  }
}
```

- [ ] **Step 6: Implement monitor tool**

```typescript
// packages/core/src/tools/monitor.ts
import { spawn } from 'node:child_process'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const monitorTool: ToolHandler = {
  definition: {
    name: 'monitor',
    description: 'Run a command and stream each stdout line as a progress event. Use for watching logs, waiting for conditions, or monitoring long processes.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command. Each stdout line becomes a progress event.' },
        description: { type: 'string', description: 'What you are monitoring (shown in UI)' },
        timeout_ms: { type: 'number', description: 'Kill after this time in ms (default: 300000)' },
      },
      required: ['command', 'description'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = input.command as string
    const description = input.description as string
    const timeout = (input.timeout_ms as number) || 300000

    return new Promise<ToolResult>((resolve) => {
      const proc = spawn('sh', ['-c', command], { cwd: context.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      const lines: string[] = []
      let killed = false

      const timer = setTimeout(() => {
        killed = true
        proc.kill('SIGTERM')
      }, timeout)

      const onAbort = () => { proc.kill('SIGTERM'); killed = true }
      context.signal?.addEventListener('abort', onAbort, { once: true })

      proc.stdout?.on('data', (data) => {
        const newLines = data.toString().split('\n').filter((l: string) => l.trim())
        for (const line of newLines) {
          lines.push(line)
          context.onProgress?.(`[${description}] ${line}`)
        }
      })

      proc.stderr?.on('data', (data) => {
        lines.push(`[stderr] ${data.toString().trim()}`)
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        context.signal?.removeEventListener('abort', onAbort)
        const status = killed ? 'timed out' : code === 0 ? 'completed' : `failed (exit ${code})`
        resolve({
          content: `Monitor "${description}" ${status}.\nEvents captured: ${lines.length}\n---\n${lines.slice(-50).join('\n')}`,
        })
      })
    })
  },
}
```

- [ ] **Step 7: Add run_in_background to bash tool**

In `packages/core/src/tools/bash.ts`, add to inputSchema:

```typescript
run_in_background: { type: 'boolean', description: 'Run in background and return task_id immediately' },
```

At the top of execute(), check for background mode:

```typescript
if (input.run_in_background && context.backgroundTasks) {
  const task = context.backgroundTasks.spawn(command, context.cwd)
  return { content: `Background task started: ${task.id}\nCommand: ${command}\nUse task_output to check results.` }
}
```

Add `backgroundTasks?: BackgroundTaskManager` to `ToolContext` interface in `tool-registry.ts`.

- [ ] **Step 8: Register tools and wire BackgroundTaskManager in session**

In `packages/core/src/session.ts`:
```typescript
import { BackgroundTaskManager } from './background-tasks.js'
import { createTaskOutputTool } from './tools/task-output.js'
import { monitorTool } from './tools/monitor.js'

// In constructor:
private backgroundTasks: BackgroundTaskManager

// Initialize:
this.backgroundTasks = new BackgroundTaskManager(path.join(getConfigDir(), 'tasks'))
this.toolRegistry.register(createTaskOutputTool(this.backgroundTasks))
this.toolRegistry.register(monitorTool)
```

In `tool-runner.ts`, pass backgroundTasks in context:
```typescript
const context: ToolContext = {
  cwd: this.cwd,
  signal,
  toolUseId,
  fileTracker: this.fileTracker,
  turnIndex: this.turnIndex,
  backgroundTasks: this.backgroundTasks,  // new
  onProgress: (message) => { onEvent({ type: 'progress', toolName, toolUseId, message }) },
}
```

Add `backgroundTasks?: BackgroundTaskManager` field to ToolRunner class.

- [ ] **Step 9: Run all tests + build**

Run: `cd packages/core && npx vitest run`
Run: `node packages/electron/build.mjs`
Expected: All pass

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/background-tasks.ts packages/core/src/tools/task-output.ts packages/core/src/tools/monitor.ts packages/core/src/tools/bash.ts packages/core/src/tool-registry.ts packages/core/src/tool-runner.ts packages/core/src/session.ts packages/core/src/__tests__/background-tasks.test.ts
git commit -m "feat: background task system with task_output and monitor tools"
```

---

### Task 5: System Prompt Deepening

**Files:**
- Modify: `packages/core/src/base-prompt.ts`

- [ ] **Step 1: Add failure loop detection example**

In `getDoingTasksSection()`, append:

```typescript
+ `

<examples title="failure loop recognition">
<example title="wrong — incremental patching">
assistant: [tries approach A, gets error]
assistant: [tweaks approach A slightly, gets same error]
assistant: [tweaks approach A again, gets different error]
</example>
<example title="right — step back and reconsider">
assistant: [tries approach A, gets error]
assistant: [tries small variation, gets same error]
assistant: This approach isn't working. The root cause is X. A different approach would be Y — want me to try that?
</example>
</examples>`
```

- [ ] **Step 2: Add verification requirements**

Add new function `getVerificationSection()`:

```typescript
function getVerificationSection(): string {
  return `# Verification

After any code change, run the project's build step before presenting the result. If the build does not run tests automatically, run relevant tests separately. If verification reveals errors, fix them before presenting the result.

- After editing code: run build (check package.json for the build command)
- After adding features: write and run tests
- If build/tests fail: fix before reporting success
- If you cannot run build/tests (missing deps, env issues): state that clearly

For safety-sensitive changes (auth, data handling), state what was verified and what could not be verified.`
}
```

Add to sections array in `getBasePrompt()`.

- [ ] **Step 3: Add Git safety protocol**

Expand `getGitSection()` with detailed rules:

```typescript
function getGitSection(): string {
  return `# Git Safety

- Only create commits when the user explicitly asks
- Prefer staging specific files over \`git add .\`
- Never amend published commits or force push to main/master
- Use HEREDOC for commit messages:
  \`\`\`
  git commit -m "$(cat <<'EOF'
  commit message here
  EOF
  )"
  \`\`\`
- Never skip hooks (--no-verify) unless user explicitly asks
- Never use interactive git commands (-i flag)
- If a pre-commit hook fails, fix the issue and create a NEW commit (don't amend)
- Flag files that likely contain secrets (.env, credentials) before committing

<examples title="when to confirm vs proceed">
<example>
user: fix the typo in src/utils.ts
assistant: [reads file, fixes typo, runs build]
Fixed the typo.
</example>
<example>
user: force push to main
assistant: Force pushing to main can overwrite others' work and is hard to reverse. Are you sure?
</example>
</examples>`
}
```

- [ ] **Step 4: Add compaction behavior guidance**

Add new function `getCompactionSection()`:

```typescript
function getCompactionSection(): string {
  return `# Context Compaction

When the conversation is compressed, some earlier context is summarized. After compaction:
- Re-confirm your current position by checking file states or command outputs
- Do not rely on memory of prior context — verify before acting
- Continue working through the task without stopping
- If unsure what was done before, read recent git log or file states`
}
```

Add to sections array.

- [ ] **Step 5: Add action confirmation examples**

In `getActionsSection()`, append examples:

```typescript
+ `

<examples title="when to confirm vs proceed">
<example>
user: rename getUserName to getUsername across the project
assistant: [finds all references, renames them, runs build]
Renamed across 4 files.
</example>
<example>
user: delete all the log files
assistant: That would recursively delete files. This is hard to reverse. Want me to proceed, or target specific files?
</example>
</examples>`
```

- [ ] **Step 6: Build**

Run: `node packages/electron/build.mjs`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/base-prompt.ts
git commit -m "feat: deepen system prompt with examples, verification, git safety, compaction guidance"
```

---

### Task 6: Final Exports + Integration Test

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update exports**

Add to `packages/core/src/index.ts`:

```typescript
export { BackgroundTaskManager, type BackgroundTask } from './background-tasks.js'
export { createTaskOutputTool } from './tools/task-output.js'
export { monitorTool } from './tools/monitor.js'
export { multiEditTool } from './tools/multi-edit.js'
export { createNotifyTool, type NotifyCallback } from './tools/notify.js'
```

- [ ] **Step 2: Run full test suite**

Run: `cd packages/core && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Build full project**

Run: `node packages/electron/build.mjs`
Expected: Build succeeds

- [ ] **Step 4: Manual integration test**

Run: `cd packages/electron && NODE_ENV=development npx electron dist/main.js`

Test scenarios:
1. Ask model to "run `sleep 3 && echo done` in background" → should get task_id back immediately
2. Ask "check task {id}" → should show output
3. Ask "send me a notification" → desktop notification appears
4. Ask model to rename a variable across a file → should use replace_all or multi_edit
5. Check /stats → token counts should be more accurate for Chinese text

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat: export background tasks, multi-edit, notify from core"
```
