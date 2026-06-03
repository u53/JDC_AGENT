# Spec 12: Workspace Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist plans and tasks across sessions, add message queuing, and show task progress in the UI.

**Architecture:** Plan files live in `.jdcagnet/plans/` and are auto-loaded into system prompt context. TaskStore is rewritten to use SQLite (existing history.db). Message queuing is frontend-only (Zustand store). Task UI is a collapsible card above the input.

**Tech Stack:** TypeScript, SQLite (sql.js), Zustand, React, Vitest

---

## File Structure

### New Files
- `packages/ui/src/components/TaskPanel.tsx` — Collapsible task list card
- `packages/ui/src/components/QueueIndicator.tsx` — Message queue status
- `packages/core/src/__tests__/plan-loader.test.ts` — Tests for plan loading

### Modified Files
- `packages/core/src/context.ts` — Add `loadActivePlan(cwd)`
- `packages/core/src/history.ts` — Add tasks table + CRUD methods
- `packages/core/src/task-store.ts` — Rewrite to use ConversationHistory
- `packages/core/src/session.ts` — Wire new TaskStore, inject tasks into context
- `packages/core/src/tools/task-create.ts` — Adapt to new TaskStore interface
- `packages/core/src/tools/task-update.ts` — Adapt to new TaskStore interface
- `packages/core/src/tools/task-get.ts` — Adapt to new TaskStore interface
- `packages/core/src/tools/task-list.ts` — Adapt to new TaskStore interface
- `packages/core/src/tools/task-stop.ts` — Adapt to new TaskStore interface
- `packages/core/src/tools/todo-write.ts` — Adapt to new TaskStore interface
- `packages/electron/src/session-manager.ts` — Add getTasks method
- `packages/electron/src/ipc-handlers.ts` — Add get-tasks handler
- `packages/electron/src/ipc-channels.ts` — Add SESSION_GET_TASKS
- `packages/ui/src/stores/session-store.ts` — Add messageQueue + tasks state
- `packages/ui/src/hooks/useSession.ts` — Auto-send from queue on finish
- `packages/ui/src/components/PromptInput.tsx` — Dual SEND/STOP button
- `packages/ui/src/components/ChatView.tsx` — Mount TaskPanel + QueueIndicator

---

### Task 1: Plan Auto-Loading

**Files:**
- Modify: `packages/core/src/context.ts`
- Create: `packages/core/src/__tests__/plan-loader.test.ts`

- [ ] **Step 1: Write test**

```typescript
// packages/core/src/__tests__/plan-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadActivePlan } from '../context.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('loadActivePlan', () => {
  const tmpDir = path.join(os.tmpdir(), 'plan-loader-test-' + Date.now())
  const planDir = path.join(tmpDir, '.jdcagnet', 'plans')

  beforeEach(() => { mkdirSync(planDir, { recursive: true }) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns null when no plans exist', async () => {
    const result = await loadActivePlan(tmpDir)
    expect(result).toBeNull()
  })

  it('returns the most recent plan', async () => {
    writeFileSync(path.join(planDir, '001-old.md'), 'old plan')
    writeFileSync(path.join(planDir, '002-new.md'), 'new plan')
    const result = await loadActivePlan(tmpDir)
    expect(result).not.toBeNull()
    expect(result!.content).toBe('new plan')
    expect(result!.fileName).toBe('002-new.md')
  })

  it('skips completed plans', async () => {
    writeFileSync(path.join(planDir, '001-done.md'), '<!-- COMPLETED -->\nold plan')
    writeFileSync(path.join(planDir, '002-active.md'), 'active plan')
    const result = await loadActivePlan(tmpDir)
    expect(result!.content).toBe('active plan')
  })

  it('returns null when all plans are completed', async () => {
    writeFileSync(path.join(planDir, '001-done.md'), '<!-- COMPLETED -->\ndone')
    const result = await loadActivePlan(tmpDir)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/plan-loader.test.ts`
Expected: FAIL — `loadActivePlan` not exported

- [ ] **Step 3: Implement loadActivePlan in context.ts**

Add to `packages/core/src/context.ts`:

```typescript
export async function loadActivePlan(cwd: string): Promise<{ fileName: string; content: string } | null> {
  const planDir = path.join(cwd, '.jdcagnet', 'plans')
  try {
    const files = await readdir(planDir)
    const mdFiles = files.filter(f => f.endsWith('.md')).sort()
    // Iterate from newest to oldest (sorted alphabetically, timestamps make newest last)
    for (let i = mdFiles.length - 1; i >= 0; i--) {
      const content = await readFile(path.join(planDir, mdFiles[i]), 'utf-8')
      if (content.trimStart().startsWith('<!-- COMPLETED -->')) continue
      return { fileName: mdFiles[i], content }
    }
    return null
  } catch { return null }
}
```

- [ ] **Step 4: Inject plan into assembleSystemPrompt**

In `assembleSystemPrompt()`, after the memory segment and before the instructions segment, add:

```typescript
// Active plan
const activePlan = await loadActivePlan(opts.cwd)
if (activePlan) {
  segments.push({
    content: `<plan>\nPlan file: .jdcagnet/plans/${activePlan.fileName}\n\n${activePlan.content}\n\nIf this plan is relevant to the current work and not already complete, continue working on it.\n</plan>`,
    cacheable: true,
  })
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run src/__tests__/plan-loader.test.ts`
Expected: All 4 PASS

- [ ] **Step 6: Build**

Run: `node packages/electron/build.mjs`
Expected: Success

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context.ts packages/core/src/__tests__/plan-loader.test.ts
git commit -m "feat: auto-load active plan from .jdcagnet/plans/ into system prompt"
```

---

### Task 2: Task Persistence (SQLite)

**Files:**
- Modify: `packages/core/src/history.ts`
- Modify: `packages/core/src/task-store.ts`
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: Add tasks table to history.ts migrate()**

In `packages/core/src/history.ts`, in the `migrate()` method, add after the file_snapshots table:

```typescript
this.db!.run(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`)
this.db!.run(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, status)`)
```

- [ ] **Step 2: Add task CRUD methods to history.ts**

Add these methods to the `ConversationHistory` class:

```typescript
createTask(sessionId: string, id: string, subject: string, description: string): void {
  const now = Date.now()
  this.db!.run(
    'INSERT INTO tasks (id, session_id, subject, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, sessionId, subject, description, 'pending', now, now]
  )
  this.save()
}

updateTask(id: string, updates: { status?: string; subject?: string; description?: string }): void {
  const parts: string[] = ['updated_at = ?']
  const values: any[] = [Date.now()]
  if (updates.status) { parts.push('status = ?'); values.push(updates.status) }
  if (updates.subject) { parts.push('subject = ?'); values.push(updates.subject) }
  if (updates.description) { parts.push('description = ?'); values.push(updates.description) }
  values.push(id)
  this.db!.run(`UPDATE tasks SET ${parts.join(', ')} WHERE id = ?`, values)
  this.save()
}

deleteTask(id: string): void {
  this.db!.run('DELETE FROM tasks WHERE id = ?', [id])
  this.save()
}

getTasks(sessionId: string): Array<{ id: string; subject: string; description: string; status: string; createdAt: number; updatedAt: number }> {
  const stmt = this.db!.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC')
  stmt.bind([sessionId])
  const results: any[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    results.push({
      id: row.id, subject: row.subject, description: row.description,
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    })
  }
  stmt.free()
  return results
}

getActiveTasks(sessionId: string): Array<{ id: string; subject: string; description: string; status: string }> {
  const stmt = this.db!.prepare("SELECT * FROM tasks WHERE session_id = ? AND status IN ('pending', 'in_progress') ORDER BY created_at ASC")
  stmt.bind([sessionId])
  const results: any[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    results.push({ id: row.id, subject: row.subject, description: row.description, status: row.status })
  }
  stmt.free()
  return results
}
```

- [ ] **Step 3: Rewrite task-store.ts**

Replace `packages/core/src/task-store.ts` entirely:

```typescript
import type { ConversationHistory } from './history.js'

export interface Task {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: number
  updatedAt: number
}

export class TaskStore {
  private history: ConversationHistory
  private sessionId: string
  private nextId: number

  constructor(history: ConversationHistory, sessionId: string) {
    this.history = history
    this.sessionId = sessionId
    const existing = history.getTasks(sessionId)
    this.nextId = existing.length > 0
      ? Math.max(...existing.map(t => parseInt(t.id, 10) || 0)) + 1
      : 1
  }

  create(subject: string, description: string): Task {
    const id = String(this.nextId++)
    this.history.createTask(this.sessionId, id, subject, description)
    return { id, subject, description, status: 'pending', createdAt: Date.now(), updatedAt: Date.now() }
  }

  get(id: string): Task | undefined {
    const tasks = this.history.getTasks(this.sessionId)
    const t = tasks.find(t => t.id === id)
    if (!t) return undefined
    return { ...t, status: t.status as Task['status'] }
  }

  list(): Task[] {
    return this.history.getTasks(this.sessionId).map(t => ({ ...t, status: t.status as Task['status'] }))
  }

  update(id: string, updates: Partial<Pick<Task, 'status' | 'subject' | 'description'>>): Task | undefined {
    const task = this.get(id)
    if (!task) return undefined
    this.history.updateTask(id, updates)
    return { ...task, ...updates, updatedAt: Date.now() }
  }

  delete(id: string): boolean {
    const task = this.get(id)
    if (!task) return false
    this.history.deleteTask(id)
    return true
  }
}
```

- [ ] **Step 4: Update session.ts TaskStore creation**

In `packages/core/src/session.ts`, change the TaskStore instantiation from:
```typescript
private taskStore = new TaskStore()
```
to:
```typescript
private taskStore!: TaskStore
```

And in the constructor, after `this.history = history`:
```typescript
this.taskStore = new TaskStore(history, config.id)
```

- [ ] **Step 5: Inject active tasks into context**

In `packages/core/src/session.ts`, in `sendMessage()`, after assembling the system prompt, add task injection:

```typescript
// Inject active tasks
const activeTasks = this.history.getActiveTasks(this.id)
if (activeTasks.length > 0) {
  const taskLines = activeTasks.map(t => `- [${t.status}] #${t.id}: ${t.subject}`).join('\n')
  const taskSegment = `<tasks>\nCurrent tasks for this session:\n${taskLines}\n</tasks>`
  // Append as dynamic (non-cacheable) segment
  if (Array.isArray(this.config.modelConfig.systemPrompt)) {
    this.config.modelConfig.systemPrompt.push({ content: taskSegment, cacheable: false })
  }
}
```

- [ ] **Step 6: Run tests + build**

Run: `cd packages/core && npx vitest run`
Run: `node packages/electron/build.mjs`
Expected: All pass (task tools still work since interface is compatible)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/history.ts packages/core/src/task-store.ts packages/core/src/session.ts
git commit -m "feat: persist tasks to SQLite, inject active tasks into context"
```

---

### Task 3: Task IPC + Frontend Data

**Files:**
- Modify: `packages/electron/src/session-manager.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`
- Modify: `packages/electron/src/ipc-channels.ts`
- Modify: `packages/ui/src/stores/session-store.ts`

- [ ] **Step 1: Add IPC channel**

In `packages/electron/src/ipc-channels.ts`, add:
```typescript
SESSION_GET_TASKS: 'session:get-tasks',
```

- [ ] **Step 2: Add getTasks to session-manager.ts**

```typescript
getTasks(sessionId: string) {
  return this.history.getTasks(sessionId)
}
```

Note: `this.history` is the ConversationHistory instance already available in SessionManager.

- [ ] **Step 3: Add IPC handler**

In `packages/electron/src/ipc-handlers.ts`:
```typescript
ipcMain.handle(IPC_CHANNELS.SESSION_GET_TASKS, async (_event, { sessionId }) => {
  return sessionManager.getTasks(sessionId)
})
```

- [ ] **Step 4: Add tasks state to session-store.ts**

In `packages/ui/src/stores/session-store.ts`, add to the interface and store:

```typescript
// In SessionState interface:
tasks: Array<{ id: string; subject: string; description: string; status: string }>
loadTasks: (sessionId: string) => Promise<void>

// In the store:
tasks: [],
loadTasks: async (sessionId: string) => {
  const tasks = await window.electronAPI?.invoke('session:get-tasks', { sessionId })
  if (tasks) set({ tasks })
},
```

- [ ] **Step 5: Build**

Run: `node packages/electron/build.mjs`
Expected: Success

- [ ] **Step 6: Commit**

```bash
git add packages/electron/src/session-manager.ts packages/electron/src/ipc-handlers.ts packages/electron/src/ipc-channels.ts packages/ui/src/stores/session-store.ts
git commit -m "feat: task IPC and frontend store for task data"
```

---

### Task 4: Task UI Panel

**Files:**
- Create: `packages/ui/src/components/TaskPanel.tsx`
- Modify: `packages/ui/src/components/ChatView.tsx`
- Modify: `packages/ui/src/hooks/useSession.ts`

- [ ] **Step 1: Create TaskPanel.tsx**

```typescript
// packages/ui/src/components/TaskPanel.tsx
import { useState } from 'react'
import { useSessionStore } from '../stores/session-store'

export function TaskPanel() {
  const tasks = useSessionStore((s) => s.tasks)
  const [expanded, setExpanded] = useState(false)

  const active = tasks.filter(t => t.status !== 'completed')
  const pending = active.filter(t => t.status === 'pending').length
  const inProgress = active.filter(t => t.status === 'in_progress').length

  if (active.length === 0) return null

  return (
    <div className="border-t border-[#333] mx-6">
      <div
        className="flex items-center justify-between px-0 py-1.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#4AF626]" />
          <span className="text-[#EAEAEA]">TASKS</span>
          <span className="text-[#666]">
            {pending > 0 && `${pending} pending`}
            {pending > 0 && inProgress > 0 && ' · '}
            {inProgress > 0 && `${inProgress} in progress`}
          </span>
        </div>
        <span className="text-[10px] text-[#666]">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="pb-2">
          {active.map(task => (
            <div key={task.id} className="flex items-center gap-2 px-0 py-0.5 text-xs">
              <span className={task.status === 'in_progress' ? 'text-[#4AF626] animate-pulse' : 'text-[#666]'}>
                {task.status === 'in_progress' ? '●' : '○'}
              </span>
              <span className="text-[#666]">#{task.id}</span>
              <span className="text-[#EAEAEA] truncate">{task.subject}</span>
              <span className="text-[10px] text-[#666] ml-auto">[{task.status}]</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Refresh tasks on query:complete**

In `packages/ui/src/hooks/useSession.ts`, in the `unsubFinished` handler (where `store.finishSession(sessionId)` is called), add:

```typescript
const unsubFinished = window.electronAPI?.on('query:finished', (_e: unknown, data: unknown) => {
  const { sessionId } = data as { sessionId: string }
  store.finishSession(sessionId)
  // Refresh tasks after each turn
  const current = useSessionStore.getState()
  if (sessionId === current.activeSessionId) {
    current.loadTasks(sessionId)
  }
}) || (() => {})
```

- [ ] **Step 3: Mount TaskPanel in ChatView**

In `packages/ui/src/components/ChatView.tsx`, import and mount:

```typescript
import { TaskPanel } from './TaskPanel'
```

Place `<TaskPanel />` right before the `{planMode && ...}` indicator (above the input area):

```typescript
<TaskPanel />
{planMode && (
  <div className="border-t border-purple-600/30 ...">
```

- [ ] **Step 4: Load tasks on session switch**

In `packages/ui/src/hooks/useSession.ts` or in `ChatView.tsx`, when `activeSessionId` changes, call `loadTasks`:

In ChatView's existing `useEffect` that runs on `activeSessionId` change, add:
```typescript
useEffect(() => {
  if (activeSessionId) {
    useSessionStore.getState().loadTasks(activeSessionId)
  }
}, [activeSessionId])
```

- [ ] **Step 5: Build and test**

Run: `node packages/electron/build.mjs`
Expected: Success

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/TaskPanel.tsx packages/ui/src/components/ChatView.tsx packages/ui/src/hooks/useSession.ts
git commit -m "feat: task panel UI with collapsible task list above input"
```

---

### Task 5: Message Queuing

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts`
- Modify: `packages/ui/src/hooks/useSession.ts`
- Modify: `packages/ui/src/components/PromptInput.tsx`
- Create: `packages/ui/src/components/QueueIndicator.tsx`
- Modify: `packages/ui/src/components/ChatView.tsx`

- [ ] **Step 1: Add messageQueue to session store**

In `packages/ui/src/stores/session-store.ts`, add to interface and implementation:

```typescript
// Interface:
messageQueue: string[]
enqueueMessage: (text: string) => void
dequeueMessage: () => string | undefined

// Implementation:
messageQueue: [],
enqueueMessage: (text: string) => {
  set((s) => ({ messageQueue: [...s.messageQueue, text] }))
},
dequeueMessage: () => {
  const queue = get().messageQueue
  if (queue.length === 0) return undefined
  const [first, ...rest] = queue
  set({ messageQueue: rest })
  return first
},
```

- [ ] **Step 2: Auto-send from queue on finish**

In `packages/ui/src/hooks/useSession.ts`, modify the `unsubFinished` handler to dequeue:

```typescript
const unsubFinished = window.electronAPI?.on('query:finished', (_e: unknown, data: unknown) => {
  const { sessionId } = data as { sessionId: string }
  store.finishSession(sessionId)
  const current = useSessionStore.getState()
  if (sessionId === current.activeSessionId) {
    current.loadTasks(sessionId)
    // Auto-send queued message
    const next = current.dequeueMessage()
    if (next) {
      setTimeout(() => {
        window.electronAPI?.invoke('query:send', { sessionId, text: next })
        useSessionStore.getState().markStreaming(sessionId, true)
      }, 100)
    }
  }
}) || (() => {})
```

- [ ] **Step 3: Modify PromptInput for dual SEND/STOP**

In `packages/ui/src/components/PromptInput.tsx`, change the button logic:

Replace the current streaming/non-streaming button block:
```typescript
{isStreaming ? (
  <button onClick={onAbort} ...>[ABORT]</button>
) : (
  <button onClick={...} ...>[SEND]</button>
)}
```

With:
```typescript
{isStreaming ? (
  text.trim() ? (
    <button onClick={() => { onEnqueue(text.trim()); setText(''); setImages([]) }} className="border border-[#4AF626] text-[#4AF626] px-4 py-2 text-[10px] uppercase tracking-[0.05em] hover:bg-[#4AF626] hover:text-[#0A0A0A] transition-colors">[QUEUE]</button>
  ) : (
    <button onClick={onAbort} className="border border-[#E61919] text-[#E61919] px-4 py-2 text-[10px] uppercase tracking-[0.05em] hover:bg-[#E61919] hover:text-[#EAEAEA] transition-colors">[STOP]</button>
  )
) : (
  <button onClick={() => { if (text.trim() || images.length > 0) { onSend(text.trim(), images.length > 0 ? images : undefined); setText(''); setImages([]) } }} className="border border-[#EAEAEA] text-[#EAEAEA] px-4 py-2 text-[10px] uppercase tracking-[0.05em] hover:bg-[#EAEAEA] hover:text-[#0A0A0A] transition-colors">[SEND]</button>
)}
```

Add `onEnqueue` to Props:
```typescript
onEnqueue: (text: string) => void
```

Also allow Enter to enqueue during streaming — modify `handleKeyDown`:
```typescript
if (e.key === 'Enter' && !e.shiftKey) {
  e.preventDefault()
  if (text.startsWith('/') && !text.includes(' ')) {
    onSlashCommand?.(text)
    setText('')
    setShowSlashMenu(false)
    return
  }
  if (text.trim() || images.length > 0) {
    if (isStreaming) {
      onEnqueue(text.trim())
      setText('')
      setImages([])
    } else {
      onSend(text.trim(), images.length > 0 ? images : undefined)
      setText('')
      setImages([])
    }
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }
}
```

- [ ] **Step 4: Create QueueIndicator**

```typescript
// packages/ui/src/components/QueueIndicator.tsx
import { useSessionStore } from '../stores/session-store'

export function QueueIndicator() {
  const queue = useSessionStore((s) => s.messageQueue)
  if (queue.length === 0) return null

  return (
    <div className="border-t border-[#333] px-6 py-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
      <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
      <span className="text-yellow-400">QUEUED</span>
      <span className="text-[#666]">{queue.length} message{queue.length > 1 ? 's' : ''} waiting</span>
    </div>
  )
}
```

- [ ] **Step 5: Wire in ChatView**

In `packages/ui/src/components/ChatView.tsx`:

Import:
```typescript
import { QueueIndicator } from './QueueIndicator'
```

Pass `onEnqueue` to PromptInput:
```typescript
const enqueueMessage = useSessionStore((s) => s.enqueueMessage)

<PromptInput
  ...
  onEnqueue={enqueueMessage}
/>
```

Mount QueueIndicator before TaskPanel:
```typescript
<QueueIndicator />
<TaskPanel />
```

- [ ] **Step 6: Build and test**

Run: `node packages/electron/build.mjs`
Expected: Success

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/stores/session-store.ts packages/ui/src/hooks/useSession.ts packages/ui/src/components/PromptInput.tsx packages/ui/src/components/QueueIndicator.tsx packages/ui/src/components/ChatView.tsx
git commit -m "feat: message queuing with auto-send and queue indicator"
```
