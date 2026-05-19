# Background Tasks System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete background task system to JDCAGNET so AI agents can run independently without blocking the main conversation, with automatic completion notifications.

**Architecture:** Extend the existing `BackgroundTaskManager` to support both shell and agent tasks with an `onComplete` callback. Add a `pendingNotifications` queue to `Session` that drains notifications as user messages before each AI turn. When idle, notifications trigger a new AI response automatically via IPC.

**Tech Stack:** TypeScript, Vitest, Electron IPC, Zustand, React

---

## File Structure

```
packages/core/src/
  background-tasks.ts          — MODIFY: Add TaskType, onComplete, agent methods, listAll
  session.ts                   — MODIFY: Add pendingNotifications, drainNotifications, processNotifications, onNotificationReady
  context.ts                   — MODIFY: Add background tasks section to system prompt
  tools/agent.ts               — MODIFY: Add run_in_background param + fire-and-forget logic
  index.ts                     — MODIFY: Export new types
  __tests__/background-tasks.test.ts — MODIFY: Add tests for new functionality

packages/electron/src/
  ipc-channels.ts              — MODIFY: Add background IPC channels
  ipc-handlers.ts              — MODIFY: Add background IPC handlers
  session-manager.ts           — MODIFY: Wire up onNotificationReady, add background methods
  preload.ts                   — MODIFY: Expose background APIs

packages/ui/src/
  stores/background-task-store.ts  — CREATE: Zustand store for background tasks
  components/Inspector.tsx         — MODIFY: Expand TasksSection with background tasks
  lib/ipc-client.ts               — MODIFY: Add background IPC methods
```

---

## Phase 1: Shell Notification

### Task 1: Refactor BackgroundTaskManager

**Files:**
- Modify: `packages/core/src/background-tasks.ts`
- Modify: `packages/core/src/__tests__/background-tasks.test.ts`

- [ ] **Step 1: Write tests for new functionality**

```typescript
// Add to packages/core/src/__tests__/background-tasks.test.ts

it('calls onComplete when a shell task finishes', async () => {
  const completed: BackgroundTask[] = []
  mgr.setOnComplete((task) => completed.push(task))
  mgr.spawn('echo done', '/tmp')
  await new Promise(r => setTimeout(r, 500))
  expect(completed.length).toBe(1)
  expect(completed[0].status).toBe('completed')
  expect(completed[0].type).toBe('shell')
})

it('calls onComplete with failed status on non-zero exit', async () => {
  const completed: BackgroundTask[] = []
  mgr.setOnComplete((task) => completed.push(task))
  mgr.spawn('exit 1', '/tmp')
  await new Promise(r => setTimeout(r, 500))
  expect(completed.length).toBe(1)
  expect(completed[0].status).toBe('failed')
  expect(completed[0].exitCode).toBe(1)
})

it('registers and completes an agent task', async () => {
  const completed: BackgroundTask[] = []
  mgr.setOnComplete((task) => completed.push(task))
  const task = mgr.registerAgent('Fix the bug', 'general')
  expect(task.type).toBe('agent')
  expect(task.status).toBe('running')
  mgr.completeAgent(task.id, { content: 'Fixed it', turns: 3, toolsUsed: ['bash'] })
  expect(completed.length).toBe(1)
  expect(completed[0].status).toBe('completed')
  expect(completed[0].result).toBe('Fixed it')
})

it('fails an agent task', () => {
  const completed: BackgroundTask[] = []
  mgr.setOnComplete((task) => completed.push(task))
  const task = mgr.registerAgent('Do something', 'explore')
  mgr.failAgent(task.id, new Error('timeout'))
  expect(completed.length).toBe(1)
  expect(completed[0].status).toBe('failed')
})

it('listAll returns both shell and agent tasks', () => {
  mgr.spawn('sleep 60', '/tmp')
  mgr.registerAgent('test prompt', 'general')
  const all = mgr.listAll()
  expect(all.length).toBeGreaterThanOrEqual(2)
  expect(all.some(t => t.type === 'shell')).toBe(true)
  expect(all.some(t => t.type === 'agent')).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/__tests__/background-tasks.test.ts`
Expected: FAIL — `setOnComplete`, `registerAgent`, `completeAgent`, `failAgent`, `listAll` not found

- [ ] **Step 3: Implement the refactored BackgroundTaskManager**

Replace `packages/core/src/background-tasks.ts` with:

```typescript
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { v4 as uuid } from 'uuid'
import path from 'node:path'

export type TaskType = 'shell' | 'agent'

export interface BackgroundTask {
  id: string
  type: TaskType
  command?: string
  prompt?: string
  agentType?: string
  pid?: number
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  logFile: string
  startedAt: number
  completedAt?: number
  result?: string
  turns?: number
  toolsUsed?: string[]
}

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>()
  private processes = new Map<string, ChildProcess>()
  private logDir: string
  private onComplete?: (task: BackgroundTask) => void

  constructor(logDir: string) {
    this.logDir = logDir
    mkdirSync(logDir, { recursive: true })
  }

  setOnComplete(cb: (task: BackgroundTask) => void): void {
    this.onComplete = cb
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
      type: 'shell',
      command,
      pid: proc.pid || 0,
      status: 'running',
      logFile,
      startedAt: Date.now(),
    }

    proc.stdout?.on('data', (data) => { appendFileSync(logFile, data.toString()) })
    proc.stderr?.on('data', (data) => { appendFileSync(logFile, data.toString()) })
    proc.on('close', (code) => {
      task.status = code === 0 ? 'completed' : 'failed'
      task.exitCode = code ?? 1
      task.completedAt = Date.now()
      this.processes.delete(id)
      this.onComplete?.(task)
    })

    this.tasks.set(id, task)
    this.processes.set(id, proc)
    return task
  }

  registerAgent(prompt: string, agentType: string): BackgroundTask {
    const id = uuid().slice(0, 8)
    const logFile = path.join(this.logDir, `${id}.log`)
    writeFileSync(logFile, '')

    const task: BackgroundTask = {
      id,
      type: 'agent',
      prompt,
      agentType,
      status: 'running',
      logFile,
      startedAt: Date.now(),
    }
    this.tasks.set(id, task)
    return task
  }

  completeAgent(id: string, result: { content: string; turns: number; toolsUsed: string[] }): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = 'completed'
    task.completedAt = Date.now()
    task.result = result.content
    task.turns = result.turns
    task.toolsUsed = result.toolsUsed
    this.onComplete?.(task)
  }

  failAgent(id: string, error: Error): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = 'failed'
    task.completedAt = Date.now()
    task.result = `Error: ${error.message}`
    this.onComplete?.(task)
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
    const task = this.tasks.get(id)
    if (task && task.status === 'running' && task.type === 'agent') {
      task.status = 'failed'
      task.completedAt = Date.now()
      task.result = 'Stopped by user'
    }
  }

  stopAll(): void {
    for (const id of this.processes.keys()) { this.stop(id) }
    for (const [id, task] of this.tasks) {
      if (task.status === 'running' && task.type === 'agent') {
        task.status = 'failed'
        task.completedAt = Date.now()
      }
    }
  }

  listRunning(): BackgroundTask[] {
    return [...this.tasks.values()].filter(t => t.status === 'running')
  }

  listAll(): BackgroundTask[] {
    return [...this.tasks.values()]
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/__tests__/background-tasks.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Update exports in index.ts**

In `packages/core/src/index.ts`, the existing export already covers the new types:
```typescript
export { BackgroundTaskManager, type BackgroundTask } from './background-tasks.js'
```
Add `TaskType` to the export:
```typescript
export { BackgroundTaskManager, type BackgroundTask, type TaskType } from './background-tasks.js'
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/background-tasks.ts packages/core/src/__tests__/background-tasks.test.ts packages/core/src/index.ts
git commit -m "feat(core): refactor BackgroundTaskManager with onComplete, agent support, listAll"
```

---

### Task 2: Add notification queue to Session

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: Add pendingNotifications queue and drain logic**

Add after the `ideContext` field declaration (around line 78):

```typescript
private pendingNotifications: Array<{
  type: 'shell_complete' | 'agent_complete'
  taskId: string
  status: 'completed' | 'failed'
  command?: string
  prompt?: string
  output?: string
  exitCode?: number
  result?: string
  turns?: number
  toolsUsed?: string[]
}> = []
onNotificationReady?: () => void
```

- [ ] **Step 2: Register onComplete callback in constructor**

In the constructor, after `this.backgroundTasks = new BackgroundTaskManager(...)` (line 95), add:

```typescript
this.backgroundTasks.setOnComplete((task) => {
  if (task.type === 'shell') {
    this.pendingNotifications.push({
      type: 'shell_complete',
      taskId: task.id,
      status: task.status as 'completed' | 'failed',
      command: task.command,
      output: this.backgroundTasks.getOutput(task.id, 50),
      exitCode: task.exitCode,
    })
  } else {
    this.pendingNotifications.push({
      type: 'agent_complete',
      taskId: task.id,
      status: task.status as 'completed' | 'failed',
      prompt: task.prompt,
      result: task.result,
      turns: task.turns,
      toolsUsed: task.toolsUsed,
    })
  }
  this.onNotificationReady?.()
})
```

- [ ] **Step 3: Add drainNotifications method**

Add before the `runLoop` method:

```typescript
private drainNotifications(): Message | null {
  if (this.pendingNotifications.length === 0) return null
  const items = this.pendingNotifications.splice(0)
  const parts = items.map(n => {
    if (n.type === 'shell_complete') {
      return `<task-notification>\n<task-id>${n.taskId}</task-id>\n<type>shell_complete</type>\n<status>${n.status}</status>\n<command>${n.command || ''}</command>\n<exit-code>${n.exitCode ?? 'N/A'}</exit-code>\n<output>\n${n.output || '(no output)'}\n</output>\n</task-notification>`
    }
    return `<task-notification>\n<task-id>${n.taskId}</task-id>\n<type>agent_complete</type>\n<status>${n.status}</status>\n<agent-prompt>${n.prompt || ''}</agent-prompt>\n<result>${n.result || '(no result)'}</result>\n<turns>${n.turns ?? 0}</turns>\n<tools-used>${(n.toolsUsed || []).join(', ')}</tools-used>\n</task-notification>`
  })
  return {
    id: uuid(),
    role: 'user',
    content: [{ type: 'text', text: parts.join('\n\n') }],
    timestamp: Date.now(),
  }
}
```

- [ ] **Step 4: Inject notifications at the start of runLoop**

In the `runLoop` method, right after `this.abortController = new AbortController()` and `this.currentEvents = events` (around line 422-423), add:

```typescript
const notificationMsg = this.drainNotifications()
if (notificationMsg) {
  this.messages.push(notificationMsg)
}
```

- [ ] **Step 5: Add processNotifications method for idle trigger**

Add a public method:

```typescript
async processNotifications(events: SessionEvents): Promise<void> {
  if (this.pendingNotifications.length === 0) return
  if (this.abortController) return // already running
  await this.runLoop(events)
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts
git commit -m "feat(core): add notification queue and drain logic to Session"
```

---

### Task 3: Wire up idle trigger in Electron layer

**Files:**
- Modify: `packages/electron/src/session-manager.ts`
- Modify: `packages/electron/src/ipc-channels.ts`

- [ ] **Step 1: Add IPC channel for notification-triggered AI response**

In `packages/electron/src/ipc-channels.ts`, add inside the object:

```typescript
// Background Tasks
BACKGROUND_LIST: 'background:list',
BACKGROUND_STOP: 'background:stop',
BACKGROUND_OUTPUT: 'background:output',
BACKGROUND_STATE_CHANGED: 'background:state-changed',
BACKGROUND_NOTIFICATION: 'background:notification',
AGENT_BACKGROUND: 'agent:background',
```

- [ ] **Step 2: Wire onNotificationReady in SessionManager.activateSession**

In `packages/electron/src/session-manager.ts`, after `session.loadHistory()` (around line 200), add:

```typescript
session.onNotificationReady = () => {
  // Only auto-trigger if session is idle (not currently streaming)
  if ((session as any).abortController) return
  const notificationEvents: SessionEvents = {
    onStreamChunk: (chunk: StreamChunk) => {
      this.window?.webContents.send('query:stream', { sessionId, chunk })
    },
    onToolEvent: (event: ToolExecutionEvent) => {
      this.window?.webContents.send('query:tool-event', { sessionId, event })
    },
    onMessageComplete: (message) => {
      this.window?.webContents.send('query:complete', { sessionId, message })
    },
    onError: (error) => {
      this.window?.webContents.send('query:error', { sessionId, error: error.message })
    },
    onRetrying: (attempt: number, error: Error, delayMs: number, category: string) => {
      this.window?.webContents.send('query:retrying', { sessionId, attempt, error: error.message, delayMs, category })
    },
    onAgentProgress: (agentToolUseId: string, event: any) => {
      this.window?.webContents.send('agent:progress', { sessionId, agentToolUseId, ...event })
    },
    onAgentText: (agentToolUseId: string, text: string) => {
      this.window?.webContents.send('agent:text', { sessionId, agentToolUseId, text })
    },
    onAgentComplete: (agentToolUseId: string, result: any) => {
      this.window?.webContents.send('agent:complete', { sessionId, agentToolUseId, ...result })
    },
    onUsage: (usage) => {
      this.window?.webContents.send('query:usage', { sessionId, usage })
    },
  }
  this.window?.webContents.send('background:notification', { sessionId })
  session.processNotifications(notificationEvents).then(() => {
    this.window?.webContents.send('query:finished', { sessionId })
  }).catch((err: any) => {
    this.window?.webContents.send('query:error', { sessionId, error: err.message })
  })
}
```

- [ ] **Step 3: Add background task IPC handlers**

Add methods to `SessionManager`:

```typescript
getBackgroundTasks(sessionId: string): BackgroundTask[] {
  const session = this.sessions.get(sessionId)
  if (!session) return []
  return (session as any).backgroundTasks.listAll()
}

stopBackgroundTask(sessionId: string, taskId: string): void {
  const session = this.sessions.get(sessionId)
  if (!session) return
  ;(session as any).backgroundTasks.stop(taskId)
}

getBackgroundTaskOutput(sessionId: string, taskId: string, tail?: number): string {
  const session = this.sessions.get(sessionId)
  if (!session) return ''
  return (session as any).backgroundTasks.getOutput(taskId, tail)
}
```

- [ ] **Step 4: Register IPC handlers in ipc-handlers.ts**

Add to `packages/electron/src/ipc-handlers.ts`:

```typescript
ipcMain.handle('background:list', async (_event, { sessionId }) => {
  return sessionManager.getBackgroundTasks(sessionId)
})

ipcMain.handle('background:stop', async (_event, { sessionId, taskId }) => {
  sessionManager.stopBackgroundTask(sessionId, taskId)
  return { success: true }
})

ipcMain.handle('background:output', async (_event, { sessionId, taskId, tail }) => {
  return sessionManager.getBackgroundTaskOutput(sessionId, taskId, tail)
})
```

- [ ] **Step 5: Commit**

```bash
git add packages/electron/src/session-manager.ts packages/electron/src/ipc-channels.ts packages/electron/src/ipc-handlers.ts
git commit -m "feat(electron): wire up background task notification trigger and IPC handlers"
```

---

### Task 4: System prompt enhancement

**Files:**
- Modify: `packages/core/src/context.ts`

- [ ] **Step 1: Add background tasks section to assembleSystemPrompt**

In `packages/core/src/context.ts`, in the `assembleSystemPrompt` function, add a new segment after the skills listing section (after line 143):

```typescript
// Background tasks capability
segments.push({
  content: `# Background Tasks

You can run tasks in the background:

**Background Agents:** Use the Agent tool with \`run_in_background: true\` to dispatch sub-agents that run independently. You can continue the conversation while they work.

**Background Shell:** Use the bash tool with \`run_in_background: true\` for long-running commands.

**Notifications:** When a background task completes, you will receive a \`<task-notification>\` message. Respond naturally — summarize what happened and suggest next steps if needed.

**When to use background:**
- Long-running tasks (builds, large refactors, multi-file changes)
- Independent subtasks that don't block the current conversation
- Parallel work (dispatch multiple agents for different parts)

**When NOT to use background:**
- Tasks where you need the result immediately to continue
- Simple, fast operations (< 30 seconds)

You can check running tasks with \`task_output\` tool, or wait for the notification.`,
  cacheable: true,
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/context.ts
git commit -m "feat(core): add background tasks section to system prompt"
```

---

## Phase 2: Background Agent Sessions

### Task 5: Add run_in_background to Agent tool

**Files:**
- Modify: `packages/core/src/tools/agent.ts`

- [ ] **Step 1: Add run_in_background to inputSchema**

In `packages/core/src/tools/agent.ts`, add to the `properties` object in `inputSchema` (after `maxTurns`):

```typescript
run_in_background: {
  type: 'boolean',
  description: 'Run this agent in the background. Returns immediately with a task_id. You will receive a <task-notification> when it completes.',
},
```

- [ ] **Step 2: Add backgroundTasks to AgentToolDeps**

Add to the `AgentToolDeps` interface:

```typescript
backgroundTasks?: import('../background-tasks.js').BackgroundTaskManager
```

- [ ] **Step 3: Implement background execution path**

In the `execute` function, after the `agentAbort` setup (after line 79), add the background path before the existing `try` block:

```typescript
if (input.run_in_background && deps.backgroundTasks) {
  const task = deps.backgroundTasks.registerAgent(prompt, agentType)

  runSubSession({
    prompt,
    provider: effectiveProvider,
    toolRegistry: deps.toolRegistry,
    modelConfig: effectiveModelConfig,
    cwd: deps.cwd,
    maxTurns,
    agentType,
    signal: agentAbort.signal,
    onToolEvent: deps.onToolEvent,
    onPermissionRequest: deps.onPermissionRequest,
    onAgentProgress: (event) => deps.onAgentProgress?.(toolUseId, event),
    onAgentText: (text) => deps.onAgentText?.(toolUseId, text),
  }).then(result => {
    deps.onAgentComplete?.(toolUseId, result)
    deps.backgroundTasks!.completeAgent(task.id, result)
  }).catch(err => {
    deps.backgroundTasks!.failAgent(task.id, err instanceof Error ? err : new Error(String(err)))
  }).finally(() => {
    deps.agentAbortControllers?.delete(toolUseId)
    context.signal?.removeEventListener('abort', onParentAbort)
  })

  return {
    content: `Background agent started.\nTask ID: ${task.id}\nType: ${agentType}\nPrompt: ${prompt}\nYou will receive a <task-notification> when it completes.`,
  }
}
```

- [ ] **Step 4: Update description to mention background capability**

Update the tool description string to include:

```typescript
description:
  'Dispatch a sub-agent to handle a task independently. Available types:\n' +
  '- explore: Fast read-only search for locating code (no modifications)\n' +
  '- plan: Analyze code and write implementation plans\n' +
  '- refactor: Improve code structure without changing behavior (no bash)\n' +
  '- security-auditor: Analyze code for vulnerabilities\n' +
  '- frontend-designer: Convert designs into components\n' +
  '- general: Full tool access for complex multi-step tasks (default)\n\n' +
  'Set run_in_background: true for long-running tasks. The agent runs independently and you receive a <task-notification> when it completes.',
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/agent.ts
git commit -m "feat(core): add run_in_background parameter to Agent tool"
```

---

### Task 6: Pass backgroundTasks to Agent tool in Session

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: Pass backgroundTasks when creating Agent tool**

In `packages/core/src/session.ts`, find the `createAgentTool` call (around line 155). Add `backgroundTasks` to the deps object:

```typescript
this.toolRegistry.register(createAgentTool({
  provider: this.provider,
  toolRegistry: this.toolRegistry,
  modelConfig: this.config.modelConfig,
  cwd: this.config.cwd,
  onToolEvent: undefined,
  onPermissionRequest,
  isSubAgent: false,
  resolveModel: (modelId: string) => this.resolveModel?.(modelId) ?? null,
  backgroundTasks: this.backgroundTasks,
  onAgentProgress: (agentToolUseId, event) => {
    this.currentEvents?.onAgentProgress?.(agentToolUseId, event)
  },
  onAgentText: (agentToolUseId, text) => {
    this.currentEvents?.onAgentText?.(agentToolUseId, text)
  },
  onAgentComplete: (agentToolUseId, result) => {
    this.currentEvents?.onAgentComplete?.(agentToolUseId, result)
  },
  agentAbortControllers: this.agentAbortControllers,
}))
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/session.ts
git commit -m "feat(core): pass backgroundTasks to Agent tool for background execution"
```

---

### Task 7: Add concurrency control

**Files:**
- Modify: `packages/core/src/background-tasks.ts`

- [ ] **Step 1: Add max concurrent agents limit**

Add to `BackgroundTaskManager` class:

```typescript
private maxConcurrentAgents = 3
private agentQueue: Array<{ resolve: () => void }> = []

setMaxConcurrentAgents(max: number): void {
  this.maxConcurrentAgents = max
}

async acquireAgentSlot(): Promise<void> {
  const runningAgents = [...this.tasks.values()].filter(t => t.type === 'agent' && t.status === 'running').length
  if (runningAgents < this.maxConcurrentAgents) return
  return new Promise(resolve => {
    this.agentQueue.push({ resolve })
  })
}

private releaseAgentSlot(): void {
  const next = this.agentQueue.shift()
  if (next) next.resolve()
}
```

- [ ] **Step 2: Call releaseAgentSlot in completeAgent and failAgent**

Add `this.releaseAgentSlot()` at the end of both `completeAgent` and `failAgent` methods.

- [ ] **Step 3: Use acquireAgentSlot in Agent tool**

In `packages/core/src/tools/agent.ts`, in the background execution path, add before `runSubSession`:

```typescript
if (input.run_in_background && deps.backgroundTasks) {
  const task = deps.backgroundTasks.registerAgent(prompt, agentType)

  // Concurrency control — wait for slot then run
  deps.backgroundTasks.acquireAgentSlot().then(() => {
    return runSubSession({ ... })
  }).then(result => { ... }).catch(err => { ... }).finally(() => { ... })

  return { content: `Background agent started.\nTask ID: ${task.id}...` }
}
```

- [ ] **Step 4: Add test for concurrency**

```typescript
it('queues agents when max concurrent reached', async () => {
  mgr.setMaxConcurrentAgents(1)
  const t1 = mgr.registerAgent('task 1', 'general')
  let slotAcquired = false
  mgr.acquireAgentSlot().then(() => { slotAcquired = true })
  await new Promise(r => setTimeout(r, 100))
  expect(slotAcquired).toBe(false)
  mgr.completeAgent(t1.id, { content: 'done', turns: 1, toolsUsed: [] })
  await new Promise(r => setTimeout(r, 100))
  expect(slotAcquired).toBe(true)
  mgr.setMaxConcurrentAgents(3) // reset
})
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run src/__tests__/background-tasks.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/background-tasks.ts packages/core/src/tools/agent.ts packages/core/src/__tests__/background-tasks.test.ts
git commit -m "feat(core): add concurrency control for background agents (max 3)"
```

---

## Phase 3: Foreground-to-Background Transition

### Task 8: Add backgroundSignal mechanism to Agent tool

**Files:**
- Modify: `packages/core/src/tools/agent.ts`
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: Add registerBackgroundTrigger to AgentToolDeps**

```typescript
registerBackgroundTrigger?: (toolUseId: string, resolve: () => void) => void
```

- [ ] **Step 2: Refactor Agent tool execute to use Promise.race**

Replace the existing synchronous execution path (the `try` block) with:

```typescript
try {
  const backgroundResolvers = new Map<string, () => void>()
  deps.registerBackgroundTrigger?.(toolUseId, () => {
    const resolver = backgroundResolvers.get(toolUseId)
    if (resolver) resolver()
  })

  let backgroundResolver: (() => void) | undefined
  const backgroundSignal = new Promise<void>(resolve => {
    backgroundResolver = resolve
    backgroundResolvers.set(toolUseId, resolve)
  })

  const sessionPromise = runSubSession({
    prompt,
    provider: effectiveProvider,
    toolRegistry: deps.toolRegistry,
    modelConfig: effectiveModelConfig,
    cwd: deps.cwd,
    maxTurns,
    agentType,
    signal: agentAbort.signal,
    onToolEvent: deps.onToolEvent,
    onPermissionRequest: deps.onPermissionRequest,
    onAgentProgress: (event) => deps.onAgentProgress?.(toolUseId, event),
    onAgentText: (text) => deps.onAgentText?.(toolUseId, text),
  })

  const raceResult = await Promise.race([
    sessionPromise.then(r => ({ type: 'done' as const, result: r })),
    backgroundSignal.then(() => ({ type: 'backgrounded' as const, result: undefined })),
  ])

  if (raceResult.type === 'backgrounded') {
    const task = deps.backgroundTasks!.registerAgent(prompt, agentType)
    sessionPromise.then(result => {
      deps.onAgentComplete?.(toolUseId, result)
      deps.backgroundTasks!.completeAgent(task.id, result)
    }).catch(err => {
      deps.backgroundTasks!.failAgent(task.id, err instanceof Error ? err : new Error(String(err)))
    })
    return {
      content: `Agent moved to background.\nTask ID: ${task.id}\nYou will receive a <task-notification> when it completes.`,
    }
  }

  deps.onAgentComplete?.(toolUseId, raceResult.result!)
  return { content: raceResult.result!.content }
} catch (error) {
  return {
    content: `Sub-agent error: ${error instanceof Error ? error.message : String(error)}`,
    isError: true,
  }
} finally {
  deps.agentAbortControllers?.delete(toolUseId)
  context.signal?.removeEventListener('abort', onParentAbort)
}
```

- [ ] **Step 3: Add backgroundAgent method to Session**

In `packages/core/src/session.ts`, add:

```typescript
private backgroundTriggers = new Map<string, () => void>()

backgroundAgent(agentToolUseId: string): void {
  const trigger = this.backgroundTriggers.get(agentToolUseId)
  if (trigger) {
    trigger()
    this.backgroundTriggers.delete(agentToolUseId)
  }
}
```

And pass `registerBackgroundTrigger` in the `createAgentTool` deps:

```typescript
registerBackgroundTrigger: (toolUseId: string, resolve: () => void) => {
  this.backgroundTriggers.set(toolUseId, resolve)
},
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tools/agent.ts packages/core/src/session.ts
git commit -m "feat(core): add foreground-to-background transition via backgroundSignal"
```

---

### Task 9: Add IPC and UI for backgrounding an agent

**Files:**
- Modify: `packages/electron/src/session-manager.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`
- Modify: `packages/electron/src/preload.ts`
- Modify: `packages/ui/src/lib/ipc-client.ts`
- Modify: `packages/ui/src/components/AgentDetailPanel.tsx`

- [ ] **Step 1: Add backgroundAgent to SessionManager**

```typescript
backgroundAgent(sessionId: string, agentToolUseId: string): void {
  const session = this.sessions.get(sessionId)
  if (session) {
    session.backgroundAgent(agentToolUseId)
  }
}
```

- [ ] **Step 2: Add IPC handler**

In `packages/electron/src/ipc-handlers.ts`:

```typescript
ipcMain.handle('agent:background', async (_event, { sessionId, agentToolUseId }) => {
  sessionManager.backgroundAgent(sessionId, agentToolUseId)
  return { success: true }
})
```

- [ ] **Step 3: Add to preload.ts**

```typescript
agentBackground: (sessionId: string, agentToolUseId: string) =>
  ipcRenderer.invoke('agent:background', { sessionId, agentToolUseId }),
```

- [ ] **Step 4: Add to ipc-client.ts**

In the `agent` section of `ipc`:

```typescript
background: (sessionId: string, agentToolUseId: string) =>
  invoke('agent:background', { sessionId, agentToolUseId }),
```

- [ ] **Step 5: Add [BACKGROUND] button to AgentDetailPanel**

In `packages/ui/src/components/AgentDetailPanel.tsx`, add a button next to [ABORT]:

```typescript
{agent.status === 'running' && (
  <>
    <button
      onClick={handleBackground}
      className="text-[10px] uppercase tracking-[0.05em] text-[var(--accent)] hover:opacity-80 transition-opacity"
    >
      [BG]
    </button>
    <button
      onClick={handleAbort}
      className="text-[10px] uppercase tracking-[0.05em] text-[var(--bad)] hover:opacity-80 transition-opacity"
    >
      [ABORT]
    </button>
  </>
)}
```

And the handler:

```typescript
const handleBackground = () => {
  if (activeSessionId && activeAgentId) {
    ipc.agent.background(activeSessionId, activeAgentId)
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/electron/src/session-manager.ts packages/electron/src/ipc-handlers.ts packages/electron/src/preload.ts packages/ui/src/lib/ipc-client.ts packages/ui/src/components/AgentDetailPanel.tsx
git commit -m "feat: add [BG] button to move running agent to background"
```

---

## Phase 4: UI Management Panel

### Task 10: Create background-task-store

**Files:**
- Create: `packages/ui/src/stores/background-task-store.ts`

- [ ] **Step 1: Create the store**

```typescript
import { create } from 'zustand'

export interface BackgroundTaskItem {
  id: string
  type: 'shell' | 'agent'
  status: 'running' | 'completed' | 'failed'
  command?: string
  prompt?: string
  agentType?: string
  startedAt: number
  completedAt?: number
  exitCode?: number
  result?: string
  turns?: number
  toolsUsed?: string[]
}

interface BackgroundTaskStoreState {
  tasks: BackgroundTaskItem[]
  setTasks: (tasks: BackgroundTaskItem[]) => void
  updateTask: (id: string, updates: Partial<BackgroundTaskItem>) => void
  removeTask: (id: string) => void
}

export const useBackgroundTaskStore = create<BackgroundTaskStoreState>((set) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  updateTask: (id, updates) => set((s) => ({
    tasks: s.tasks.map(t => t.id === id ? { ...t, ...updates } : t),
  })),
  removeTask: (id) => set((s) => ({
    tasks: s.tasks.filter(t => t.id !== id),
  })),
}))
```

- [ ] **Step 2: Add IPC listener to sync state**

Add to `packages/ui/src/lib/ipc-client.ts` in the `ipc` object:

```typescript
background: {
  list: (sessionId: string) =>
    invoke('background:list', { sessionId }) as Promise<BackgroundTaskItem[]>,
  stop: (sessionId: string, taskId: string) =>
    invoke('background:stop', { sessionId, taskId }) as Promise<{ success: boolean }>,
  output: (sessionId: string, taskId: string, tail?: number) =>
    invoke('background:output', { sessionId, taskId, tail }) as Promise<string>,
  onStateChanged: (cb: (data: { sessionId: string }) => void) =>
    on('background:state-changed', (_e, data) => cb(data as any)),
  onNotification: (cb: (data: { sessionId: string }) => void) =>
    on('background:notification', (_e, data) => cb(data as any)),
},
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/background-task-store.ts packages/ui/src/lib/ipc-client.ts
git commit -m "feat(ui): create background-task-store and IPC client methods"
```

---

### Task 11: Expand Inspector TasksSection

**Files:**
- Modify: `packages/ui/src/components/Inspector.tsx`

- [ ] **Step 1: Import the store and add background tasks section**

Add import:
```typescript
import { useBackgroundTaskStore, type BackgroundTaskItem } from '../stores/background-task-store'
```

In the `Inspector` component, add:
```typescript
const backgroundTasks = useBackgroundTaskStore((s) => s.tasks)
```

- [ ] **Step 2: Replace TasksSection with expanded version**

Replace the existing `TasksSection` function with:

```typescript
function TasksSection({ tasks, backgroundTasks }: {
  tasks: Array<{ id: string; subject: string; status: string }>
  backgroundTasks: BackgroundTaskItem[]
}) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const runningBg = backgroundTasks.filter(t => t.status === 'running')
  const completedBg = backgroundTasks.filter(t => t.status !== 'running')

  const handleStop = (taskId: string) => {
    if (activeSessionId) {
      ipc.background.stop(activeSessionId, taskId)
    }
  }

  return (
    <div className="space-y-4">
      {/* Background Tasks */}
      {backgroundTasks.length > 0 && (
        <div>
          <SectionHeader>Background ({runningBg.length} running)</SectionHeader>
          <div className="space-y-1.5">
            {backgroundTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 text-[12px] group">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${task.status === 'running' ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: task.status === 'running' ? 'var(--accent)' : task.status === 'completed' ? 'var(--good)' : 'var(--bad)' }}
                />
                <span className="text-[10px] text-[var(--muted)] uppercase w-[32px] flex-shrink-0">
                  {task.type === 'shell' ? 'SH' : 'AI'}
                </span>
                <span className="truncate text-[var(--text)] flex-1">
                  {task.type === 'shell' ? (task.command || '').slice(0, 40) : (task.prompt || '').slice(0, 40)}
                </span>
                {task.status === 'running' && (
                  <button
                    onClick={() => handleStop(task.id)}
                    className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--bad)] hover:opacity-80"
                  >
                    [STOP]
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Tasks (existing TodoWrite tasks) */}
      {tasks.length > 0 && (
        <div>
          <SectionHeader>Tasks ({tasks.filter(t => t.status === 'completed').length}/{tasks.length})</SectionHeader>
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 text-[12px]">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: task.status === 'completed' ? 'var(--good)' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--muted)' }}
                />
                <span className={`truncate ${task.status === 'completed' ? 'text-[var(--good)]' : 'text-[var(--text)]'}`}>
                  {task.subject}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {backgroundTasks.length === 0 && tasks.length === 0 && (
        <div>
          <SectionHeader>Tasks</SectionHeader>
          <p className="text-[12px] text-[var(--muted)]">No tasks</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update TasksSection usage in Inspector**

Change the render call from:
```typescript
{activeSection === 'tasks' && <TasksSection tasks={tasks} />}
```
to:
```typescript
{activeSection === 'tasks' && <TasksSection tasks={tasks} backgroundTasks={backgroundTasks} />}
```

- [ ] **Step 4: Add periodic refresh of background tasks**

In the `Inspector` component, add a useEffect to poll background tasks:

```typescript
useEffect(() => {
  if (!activeSessionId) return
  const refresh = () => {
    ipc.background.list(activeSessionId).then(tasks => {
      useBackgroundTaskStore.getState().setTasks(tasks)
    })
  }
  refresh()
  const interval = setInterval(refresh, 2000)
  return () => clearInterval(interval)
}, [activeSessionId])
```

- [ ] **Step 5: Update badge to include background tasks**

Update the badge calculation:
```typescript
const bgRunning = backgroundTasks.filter(t => t.status === 'running').length
const taskBadge = (tasks.length > 0 || bgRunning > 0)
  ? (pendingCount + bgRunning > 0 ? pendingCount + bgRunning : null)
  : null
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/Inspector.tsx
git commit -m "feat(ui): expand Inspector Tasks tab with background task management"
```

---

### Task 12: Emit state-changed events from Electron

**Files:**
- Modify: `packages/electron/src/session-manager.ts`

- [ ] **Step 1: Emit background:state-changed when tasks complete**

In the `onNotificationReady` callback (added in Task 3), also emit state-changed:

```typescript
session.onNotificationReady = () => {
  this.window?.webContents.send('background:state-changed', { sessionId })
  // ... rest of existing code
}
```

Also emit when a task is stopped:

```typescript
stopBackgroundTask(sessionId: string, taskId: string): void {
  const session = this.sessions.get(sessionId)
  if (!session) return
  ;(session as any).backgroundTasks.stop(taskId)
  this.window?.webContents.send('background:state-changed', { sessionId })
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/electron/src/session-manager.ts
git commit -m "feat(electron): emit background:state-changed events for UI sync"
```

---

### Task 13: Add preload API for background tasks

**Files:**
- Modify: `packages/electron/src/preload.ts`

- [ ] **Step 1: Add background task APIs to preload**

```typescript
// Background Tasks
backgroundList: (sessionId: string) => ipcRenderer.invoke('background:list', { sessionId }),
backgroundStop: (sessionId: string, taskId: string) => ipcRenderer.invoke('background:stop', { sessionId, taskId }),
backgroundOutput: (sessionId: string, taskId: string, tail?: number) => ipcRenderer.invoke('background:output', { sessionId, taskId, tail }),
onBackgroundStateChanged: (callback: (data: { sessionId: string }) => void) => {
  const listener = (_event: unknown, data: any) => callback(data)
  ipcRenderer.on('background:state-changed', listener)
  return () => { ipcRenderer.removeListener('background:state-changed', listener) }
},
onBackgroundNotification: (callback: (data: { sessionId: string }) => void) => {
  const listener = (_event: unknown, data: any) => callback(data)
  ipcRenderer.on('background:notification', listener)
  return () => { ipcRenderer.removeListener('background:notification', listener) }
},
```

- [ ] **Step 2: Commit**

```bash
git add packages/electron/src/preload.ts
git commit -m "feat(electron): expose background task APIs in preload"
```

---

## Final Verification

- [ ] **Run all core tests:**

```bash
cd packages/core && npx vitest run
```

- [ ] **Build the project:**

```bash
cd /Users/chenmingxu/Documents/jdcagnet && pnpm build
```

- [ ] **Manual test:**

1. Start the app (`pnpm dev`)
2. Send a message asking AI to run a long command in background: "Run `sleep 5 && echo done` in the background"
3. Verify: AI uses bash with `run_in_background: true`, returns task_id
4. Verify: After 5 seconds, AI receives `<task-notification>` and responds
5. Check Inspector Tasks tab shows the completed task
6. Test background agent: Ask AI to dispatch a background agent for a simple task
7. Verify: Main conversation remains responsive while agent runs
8. Verify: Notification arrives when agent completes