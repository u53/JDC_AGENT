# Agent Split-View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real-time visibility into sub-agent execution via a right-side split panel, with progress tracking, tool call history, and abort capability.

**Architecture:** Backend sub-session emits progress callbacks → agent tool forwards them with its toolUseId → session-manager sends IPC events → frontend agent-store tracks state → AgentDetailPanel renders in split view.

**Tech Stack:** TypeScript, React 19, Zustand, Electron IPC, TailwindCSS 4

---

## File Structure

```
packages/core/src/sub-session.ts              — Add onAgentProgress/onAgentText callbacks
packages/core/src/tools/agent.ts              — Forward callbacks, per-agent AbortController
packages/core/src/session.ts                  — Pass real callbacks when creating agent tool

packages/electron/src/ipc-channels.ts         — Add AGENT_PROGRESS, AGENT_TEXT, AGENT_COMPLETE, AGENT_ABORT
packages/electron/src/session-manager.ts      — Forward agent events via IPC, handle abort
packages/electron/src/preload.ts              — Expose agentAbort method

packages/ui/src/stores/agent-store.ts         — Zustand store for agent states
packages/ui/src/hooks/useAgentEvents.ts       — IPC listener for agent events
packages/ui/src/lib/ipc-client.ts             — Add agent IPC methods
packages/ui/src/components/AgentDetailPanel.tsx — Right-side split panel
packages/ui/src/components/tool-cards/AgentToolCard.tsx — Enhanced with live progress
packages/ui/src/components/ChatView.tsx        — Split layout when agent panel is open
```

---

## Task 1: Sub-session progress callbacks

**Files:**
- Modify: `packages/core/src/sub-session.ts`

- [ ] **Step 1: Add callback types to SubSessionOptions**

In `packages/core/src/sub-session.ts`, add to the `SubSessionOptions` interface (after `onPermissionRequest`):

```typescript
export interface SubSessionOptions {
  prompt: string
  provider: ModelProvider
  toolRegistry: ToolRegistry
  modelConfig: ModelConfig
  cwd: string
  maxTurns?: number
  signal?: AbortSignal
  onToolEvent?: (event: ToolExecutionEvent) => void
  onPermissionRequest?: PermissionCallback
  permissionMode?: 'standard' | 'relaxed' | 'strict'
  onAgentProgress?: (event: { toolName: string; toolStatus: 'start' | 'complete' | 'error'; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void
  onAgentText?: (text: string) => void
}
```

- [ ] **Step 2: Destructure new options and track tool count**

In the `runSubSession` function, add to the destructuring:

```typescript
const {
  prompt,
  provider,
  toolRegistry,
  modelConfig,
  cwd,
  maxTurns = 150,
  signal,
  onToolEvent,
  onPermissionRequest,
  onAgentProgress,
  onAgentText,
} = opts
```

Add a tool count tracker after `const toolsUsed: string[] = []`:

```typescript
let totalToolCount = 0
```

- [ ] **Step 3: Emit progress events in the tool execution loop**

In the tool execution loop (around line 102-108), wrap the tool execution with progress callbacks:

```typescript
for (const tu of toolUses) {
  let parsedInput: Record<string, unknown> = {}
  try { parsedInput = JSON.parse(tu.input) } catch { /* empty */ }
  toolsUsed.push(tu.name)
  totalToolCount++

  onAgentProgress?.({ toolName: tu.name, toolStatus: 'start', toolInput: parsedInput, toolCount: totalToolCount })

  const noopEvent = (event: ToolExecutionEvent) => { onToolEvent?.(event) }
  const result = await toolRunner.execute(tu.name, tu.id, parsedInput, noopEvent, signal)

  onAgentProgress?.({
    toolName: tu.name,
    toolStatus: result.isError ? 'error' : 'complete',
    toolInput: parsedInput,
    toolResult: result.isError ? { content: result.content, isError: true } : { content: result.content },
    toolCount: totalToolCount,
  })

  toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.isError })
}
```

- [ ] **Step 4: Emit text events when sub-agent produces text**

After the streaming loop where `textContent` is accumulated (around line 85), add:

```typescript
if (textContent) {
  contentBlocks.push({ type: 'text', text: textContent })
  onAgentText?.(textContent)
}
```

Replace the existing `if (textContent) contentBlocks.push(...)` line.

- [ ] **Step 5: Run tests**

Run: `cd packages/core && pnpm test -- --run agent`
Expected: Existing agent tests pass (callbacks are optional)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sub-session.ts
git commit -m "feat(core): add progress and text callbacks to sub-session"
```

---

## Task 2: Agent tool forwards callbacks + per-agent abort

**Files:**
- Modify: `packages/core/src/tools/agent.ts`

- [ ] **Step 1: Extend AgentToolDeps with new callbacks**

```typescript
export interface AgentToolDeps {
  provider: ModelProvider
  toolRegistry: ToolRegistry
  modelConfig: ModelConfig
  cwd: string
  onToolEvent?: (event: ToolExecutionEvent) => void
  onPermissionRequest?: PermissionCallback
  isSubAgent?: boolean
  onAgentProgress?: (agentToolUseId: string, event: { toolName: string; toolStatus: 'start' | 'complete' | 'error'; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void
  onAgentText?: (agentToolUseId: string, text: string) => void
  onAgentComplete?: (agentToolUseId: string, result: { content: string; turns: number; toolsUsed: string[] }) => void
  agentAbortControllers?: Map<string, AbortController>
}
```

- [ ] **Step 2: Update execute to use callbacks and per-agent abort**

Replace the `execute` method body:

```typescript
async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  if (deps.isSubAgent) {
    return { content: 'Sub-agents cannot dispatch further sub-agents.', isError: true }
  }

  const prompt = input.prompt as string
  const maxTurns = (input.maxTurns as number) || 150
  const toolUseId = context.toolUseId || 'unknown'

  // Create per-agent AbortController linked to parent signal
  const agentAbort = new AbortController()
  deps.agentAbortControllers?.set(toolUseId, agentAbort)

  // Abort agent if parent is aborted
  const onParentAbort = () => agentAbort.abort()
  context.signal?.addEventListener('abort', onParentAbort)

  try {
    const result = await runSubSession({
      prompt,
      provider: deps.provider,
      toolRegistry: deps.toolRegistry,
      modelConfig: deps.modelConfig,
      cwd: deps.cwd,
      maxTurns,
      signal: agentAbort.signal,
      onToolEvent: deps.onToolEvent,
      onPermissionRequest: deps.onPermissionRequest,
      onAgentProgress: (event) => deps.onAgentProgress?.(toolUseId, event),
      onAgentText: (text) => deps.onAgentText?.(toolUseId, text),
    })

    deps.onAgentComplete?.(toolUseId, result)
    return { content: result.content }
  } catch (error) {
    return {
      content: `Sub-agent error: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  } finally {
    deps.agentAbortControllers?.delete(toolUseId)
    context.signal?.removeEventListener('abort', onParentAbort)
  }
}
```

- [ ] **Step 3: Update ToolContext to include toolUseId**

In `packages/core/src/tool-registry.ts`, add `toolUseId` to `ToolContext`:

```typescript
export interface ToolContext {
  cwd: string
  signal?: AbortSignal
  onProgress?: (message: string) => void
  toolUseId?: string
}
```

- [ ] **Step 4: Pass toolUseId in ToolRunner.execute**

In `packages/core/src/tool-runner.ts`, update the context creation (around line 92-98):

```typescript
const context: ToolContext = {
  cwd: this.cwd,
  signal,
  toolUseId,
  onProgress: (message) => {
    onEvent({ type: 'progress', toolName, toolUseId, message })
  },
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && pnpm test -- --run agent`
Expected: All agent tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/agent.ts packages/core/src/tool-registry.ts packages/core/src/tool-runner.ts
git commit -m "feat(core): agent tool forwards progress callbacks and supports per-agent abort"
```

---

## Task 3: Session wires agent callbacks to events

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: Add agent event types to SessionEvents**

```typescript
export interface SessionEvents {
  onStreamChunk: (chunk: StreamChunk) => void
  onToolEvent: (event: ToolExecutionEvent) => void
  onMessageComplete: (message: Message) => void
  onError: (error: Error) => void
  onAgentProgress?: (agentToolUseId: string, event: { toolName: string; toolStatus: 'start' | 'complete' | 'error'; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void
  onAgentText?: (agentToolUseId: string, text: string) => void
  onAgentComplete?: (agentToolUseId: string, result: { content: string; turns: number; toolsUsed: string[] }) => void
}
```

- [ ] **Step 2: Store agentAbortControllers and current events on the session**

Add class properties:

```typescript
private agentAbortControllers = new Map<string, AbortController>()
private currentEvents?: SessionEvents
```

- [ ] **Step 3: Update agent tool registration to pass callbacks**

Replace the `createAgentTool` call (around line 92-100):

```typescript
this.toolRegistry.register(createAgentTool({
  provider: this.provider,
  toolRegistry: this.toolRegistry,
  modelConfig: this.config.modelConfig,
  cwd: this.config.cwd,
  onToolEvent: undefined,
  onPermissionRequest,
  isSubAgent: false,
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

- [ ] **Step 4: Set currentEvents in sendMessage**

At the start of the `sendMessage` method (or `runLoop`), store the events reference:

```typescript
this.currentEvents = events
```

And clear it at the end:

```typescript
this.currentEvents = undefined
```

- [ ] **Step 5: Add abortAgent method**

```typescript
abortAgent(agentToolUseId: string): void {
  const controller = this.agentAbortControllers.get(agentToolUseId)
  if (controller) {
    controller.abort()
  }
}
```

- [ ] **Step 6: Run tests**

Run: `cd packages/core && pnpm test -- --run agent`
Expected: Pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/session.ts
git commit -m "feat(core): session wires agent callbacks to SessionEvents"
```

---

## Task 4: IPC channels and session-manager forwarding

**Files:**
- Modify: `packages/electron/src/ipc-channels.ts`
- Modify: `packages/electron/src/session-manager.ts`
- Modify: `packages/electron/src/preload.ts`

- [ ] **Step 1: Add IPC channels**

In `packages/electron/src/ipc-channels.ts`, add:

```typescript
AGENT_PROGRESS: 'agent:progress',
AGENT_TEXT: 'agent:text',
AGENT_COMPLETE: 'agent:complete',
AGENT_ABORT: 'agent:abort',
```

- [ ] **Step 2: Add agent event forwarding in session-manager**

In `packages/electron/src/session-manager.ts`, in the `events` object inside `sendMessage` (after `onError`):

```typescript
onAgentProgress: (agentToolUseId: string, event: any) => {
  this.window?.webContents.send('agent:progress', { sessionId, agentToolUseId, ...event })
},
onAgentText: (agentToolUseId: string, text: string) => {
  this.window?.webContents.send('agent:text', { sessionId, agentToolUseId, text })
},
onAgentComplete: (agentToolUseId: string, result: any) => {
  this.window?.webContents.send('agent:complete', { sessionId, agentToolUseId, ...result })
},
```

- [ ] **Step 3: Add agent abort handler**

In `packages/electron/src/session-manager.ts`, add a method:

```typescript
abortAgent(sessionId: string, agentToolUseId: string): void {
  this.sessions.get(sessionId)?.abortAgent(agentToolUseId)
}
```

And register the IPC handler in the main process setup (wherever other handlers are registered):

```typescript
ipcMain.handle('agent:abort', (_event, { sessionId, agentToolUseId }) => {
  this.abortAgent(sessionId, agentToolUseId)
  return { success: true }
})
```

- [ ] **Step 4: Expose in preload**

In `packages/electron/src/preload.ts`, add to the `api` object:

```typescript
agentAbort: (sessionId: string, agentToolUseId: string) =>
  ipcRenderer.invoke('agent:abort', { sessionId, agentToolUseId }),
```

- [ ] **Step 5: Build and verify**

Run: `cd packages/core && pnpm build && cd ../electron && pnpm build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/electron/src/ipc-channels.ts packages/electron/src/session-manager.ts packages/electron/src/preload.ts
git commit -m "feat(electron): add agent progress/text/complete/abort IPC channels"
```

---

## Task 5: Frontend agent-store and IPC listeners

**Files:**
- Create: `packages/ui/src/stores/agent-store.ts`
- Create: `packages/ui/src/hooks/useAgentEvents.ts`
- Modify: `packages/ui/src/lib/ipc-client.ts`

- [ ] **Step 1: Add agent IPC methods to ipc-client.ts**

In `packages/ui/src/lib/ipc-client.ts`, add to the `Window.electronAPI` interface:

```typescript
agentAbort?: (sessionId: string, agentToolUseId: string) => Promise<void>
```

Add to the `ipc` export object (after `dialog`):

```typescript
agent: {
  abort: (sessionId: string, agentToolUseId: string) =>
    invoke('agent:abort', { sessionId, agentToolUseId }),
  onProgress: (cb: (data: { sessionId: string; agentToolUseId: string; toolName: string; toolStatus: string; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void) =>
    on('agent:progress', (_e, data) => cb(data as any)),
  onText: (cb: (data: { sessionId: string; agentToolUseId: string; text: string }) => void) =>
    on('agent:text', (_e, data) => cb(data as any)),
  onComplete: (cb: (data: { sessionId: string; agentToolUseId: string; content: string; turns: number; toolsUsed: string[] }) => void) =>
    on('agent:complete', (_e, data) => cb(data as any)),
},
```

- [ ] **Step 2: Create agent-store.ts**

Create `packages/ui/src/stores/agent-store.ts`:

```typescript
import { create } from 'zustand'

export interface AgentToolEvent {
  toolName: string
  status: 'start' | 'complete' | 'error'
  input?: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}

export interface AgentState {
  agentToolUseId: string
  prompt: string
  status: 'running' | 'done' | 'error'
  toolEvents: AgentToolEvent[]
  textOutput: string
  toolCount: number
  startTime: number
  result?: string
}

interface AgentStoreState {
  agents: Record<string, AgentState>
  activeAgentId: string | null
  addAgent: (id: string, prompt: string) => void
  updateAgentTool: (id: string, toolName: string, toolStatus: 'start' | 'complete' | 'error', toolInput?: Record<string, unknown>, toolResult?: { content: string; isError?: boolean }, toolCount?: number) => void
  appendAgentText: (id: string, text: string) => void
  completeAgent: (id: string, result: string) => void
  errorAgent: (id: string) => void
  setActiveAgent: (id: string | null) => void
  removeAgent: (id: string) => void
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  agents: {},
  activeAgentId: null,

  addAgent: (id, prompt) => set((s) => ({
    agents: {
      ...s.agents,
      [id]: { agentToolUseId: id, prompt, status: 'running', toolEvents: [], textOutput: '', toolCount: 0, startTime: Date.now() },
    },
  })),

  updateAgentTool: (id, toolName, toolStatus, toolInput, toolResult, toolCount) => set((s) => {
    const agent = s.agents[id]
    if (!agent) return s
    const newEvents = [...agent.toolEvents]
    if (toolStatus === 'start') {
      newEvents.push({ toolName, status: 'start', input: toolInput })
    } else {
      const last = newEvents.findLast(e => e.toolName === toolName && e.status === 'start')
      if (last) {
        last.status = toolStatus
        last.result = toolResult
      } else {
        newEvents.push({ toolName, status: toolStatus, input: toolInput, result: toolResult })
      }
    }
    return {
      agents: {
        ...s.agents,
        [id]: { ...agent, toolEvents: newEvents, toolCount: toolCount ?? agent.toolCount },
      },
    }
  }),

  appendAgentText: (id, text) => set((s) => {
    const agent = s.agents[id]
    if (!agent) return s
    return {
      agents: { ...s.agents, [id]: { ...agent, textOutput: agent.textOutput + text } },
    }
  }),

  completeAgent: (id, result) => set((s) => {
    const agent = s.agents[id]
    if (!agent) return s
    return {
      agents: { ...s.agents, [id]: { ...agent, status: 'done', result } },
    }
  }),

  errorAgent: (id) => set((s) => {
    const agent = s.agents[id]
    if (!agent) return s
    return {
      agents: { ...s.agents, [id]: { ...agent, status: 'error' } },
    }
  }),

  setActiveAgent: (id) => set({ activeAgentId: id }),

  removeAgent: (id) => set((s) => {
    const { [id]: _, ...rest } = s.agents
    return { agents: rest, activeAgentId: s.activeAgentId === id ? null : s.activeAgentId }
  }),
}))
```

- [ ] **Step 3: Create useAgentEvents.ts**

Create `packages/ui/src/hooks/useAgentEvents.ts`:

```typescript
import { useEffect } from 'react'
import { ipc } from '../lib/ipc-client'
import { useAgentStore } from '../stores/agent-store'

export function useAgentEvents() {
  useEffect(() => {
    const store = useAgentStore.getState()

    const unsubProgress = ipc.agent.onProgress((data) => {
      if (!useAgentStore.getState().agents[data.agentToolUseId]) {
        return
      }
      store.updateAgentTool(
        data.agentToolUseId,
        data.toolName,
        data.toolStatus as 'start' | 'complete' | 'error',
        data.toolInput,
        data.toolResult,
        data.toolCount
      )
    })

    const unsubText = ipc.agent.onText((data) => {
      store.appendAgentText(data.agentToolUseId, data.text)
    })

    const unsubComplete = ipc.agent.onComplete((data) => {
      store.completeAgent(data.agentToolUseId, data.content)
    })

    return () => {
      unsubProgress()
      unsubText()
      unsubComplete()
    }
  }, [])
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/stores/agent-store.ts packages/ui/src/hooks/useAgentEvents.ts packages/ui/src/lib/ipc-client.ts
git commit -m "feat(ui): add agent store and IPC event listeners"
```

---

## Task 6: AgentDetailPanel component

**Files:**
- Create: `packages/ui/src/components/AgentDetailPanel.tsx`

- [ ] **Step 1: Create AgentDetailPanel.tsx**

Create `packages/ui/src/components/AgentDetailPanel.tsx`:

```typescript
import { useAgentStore } from '../stores/agent-store'
import { useSessionStore } from '../stores/session-store'
import { ipc } from '../lib/ipc-client'
import { ToolCardRouter } from './tool-cards'

export function AgentDetailPanel() {
  const activeAgentId = useAgentStore((s) => s.activeAgentId)
  const agent = useAgentStore((s) => activeAgentId ? s.agents[activeAgentId] : null)
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  if (!agent) return null

  const elapsed = Math.round((Date.now() - agent.startTime) / 1000)

  const handleAbort = () => {
    if (activeSessionId && activeAgentId) {
      ipc.agent.abort(activeSessionId, activeAgentId)
    }
  }

  const handleClose = () => {
    setActiveAgent(null)
  }

  return (
    <div className="flex flex-col h-full border-l border-[#333] bg-[#0A0A0A]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#333]">
        <div className="flex items-center gap-2">
          <span className="text-purple-400">◆</span>
          <span className="text-[10px] uppercase tracking-[0.1em] text-purple-300">AGENT</span>
          <span className="text-[11px] text-[#EAEAEA] truncate max-w-[200px]">
            {agent.prompt.slice(0, 40)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {agent.status === 'running' && (
            <button
              onClick={handleAbort}
              className="text-[10px] uppercase tracking-[0.05em] text-red-500 hover:text-red-400 transition-colors"
            >
              [ABORT]
            </button>
          )}
          <button
            onClick={handleClose}
            className="text-[#666] hover:text-[#EAEAEA] text-xs transition-colors"
          >
            [X]
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#333] text-[10px] text-[#666]">
        {agent.status === 'running' && (
          <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
        )}
        <span>{agent.status === 'running' ? `Running ${elapsed}s` : agent.status.toUpperCase()}</span>
        <span>|</span>
        <span>{agent.toolCount} tools</span>
      </div>

      {/* Tool events list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {agent.toolEvents.map((te, i) => (
          <ToolCardRouter
            key={i}
            name={te.toolName}
            input={te.input}
            result={te.result ? { content: te.result.content, is_error: te.result.isError } : undefined}
          />
        ))}
        {agent.status === 'running' && agent.toolEvents.length === 0 && (
          <div className="text-[10px] text-[#666] uppercase tracking-[0.1em]">
            Initializing...
          </div>
        )}
      </div>

      {/* Text output */}
      {agent.textOutput && (
        <div className="border-t border-[#333] px-4 py-3 max-h-[200px] overflow-y-auto">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[#666] mb-1">Output</div>
          <pre className="text-xs text-[#EAEAEA] whitespace-pre-wrap">{agent.textOutput}</pre>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/AgentDetailPanel.tsx
git commit -m "feat(ui): add AgentDetailPanel component for split-view"
```

---

## Task 7: Enhance AgentToolCard with live progress

**Files:**
- Modify: `packages/ui/src/components/tool-cards/AgentToolCard.tsx`

- [ ] **Step 1: Rewrite AgentToolCard to use agent-store**

Replace the full content of `packages/ui/src/components/tool-cards/AgentToolCard.tsx`:

```typescript
import { useEffect } from 'react'
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { truncateText } from './shared'
import { useAgentStore } from '../../stores/agent-store'
import { useSessionStore } from '../../stores/session-store'
import { ipc } from '../../lib/ipc-client'

export function AgentToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const prompt = (toolInput.prompt || '') as string
  const taskDescription = truncateText(prompt, 50)
  const resultContent = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error
  const toolUseId = event?.toolUseId || ''

  const agentState = useAgentStore((s) => toolUseId ? s.agents[toolUseId] : null)
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent)
  const addAgent = useAgentStore((s) => s.addAgent)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  useEffect(() => {
    if (toolUseId && status === 'running' && !agentState) {
      addAgent(toolUseId, prompt)
    }
  }, [toolUseId, status])

  const recentTools = agentState?.toolEvents.slice(-3) || []
  const toolCount = agentState?.toolCount || 0

  const handleClick = () => {
    if (toolUseId) {
      setActiveAgent(toolUseId)
    }
  }

  const handleAbort = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (activeSessionId && toolUseId) {
      ipc.agent.abort(activeSessionId, toolUseId)
    }
  }

  return (
    <div onClick={handleClick} className="cursor-pointer">
      <ToolCardShell
        label="AGENT"
        labelColor="text-purple-300"
        detail={taskDescription}
        status={status}
        borderColor="border-purple-800/50"
        defaultExpanded={status === 'running'}
        collapsible={status !== 'running'}
        actions={
          status === 'running' ? (
            <button
              className="text-[10px] uppercase tracking-[0.05em] text-red-500 hover:text-red-400 transition-colors ml-2"
              onClick={handleAbort}
            >
              [ABORT]
            </button>
          ) : undefined
        }
      >
        {status === 'running' && recentTools.length > 0 && (
          <div className="text-xs font-mono text-[#666] mb-2">
            {recentTools.map((te, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-[#666]">{i === recentTools.length - 1 ? '└─' : '├─'}</span>
                <span className={te.status === 'error' ? 'text-[#E61919]' : te.status === 'complete' ? 'text-[#4AF626]' : 'text-[#EAEAEA]'}>
                  {te.toolName}
                </span>
                {te.status === 'start' && <span className="text-[#666] animate-pulse">...</span>}
              </div>
            ))}
          </div>
        )}
        {status === 'running' && recentTools.length === 0 && (
          <div className="text-[10px] text-purple-400 uppercase tracking-[0.1em]">
            <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse mr-2" />
            Initializing...
          </div>
        )}
        {status === 'running' && toolCount > 0 && (
          <div className="text-[10px] text-[#666] mt-1">{toolCount} tools executed</div>
        )}
        {status !== 'running' && resultContent && (
          <pre className={`max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap ${isError ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
            {truncateText(resultContent, 500)}
          </pre>
        )}
      </ToolCardShell>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/tool-cards/AgentToolCard.tsx
git commit -m "feat(ui): enhance AgentToolCard with live progress from agent-store"
```

---

## Task 8: ChatView split layout integration

**Files:**
- Modify: `packages/ui/src/components/ChatView.tsx`

- [ ] **Step 1: Import and wire up agent components**

At the top of `packages/ui/src/components/ChatView.tsx`, add imports:

```typescript
import { AgentDetailPanel } from './AgentDetailPanel'
import { useAgentStore } from '../stores/agent-store'
import { useAgentEvents } from '../hooks/useAgentEvents'
```

- [ ] **Step 2: Add hooks inside the component**

Inside the `ChatView` function, add:

```typescript
useAgentEvents()
const activeAgentId = useAgentStore((s) => s.activeAgentId)
```

- [ ] **Step 3: Update the layout JSX**

Wrap the main content area and add the split panel. The current return structure is:

```tsx
<div className="flex flex-1 flex-col overflow-hidden relative">
  {/* header */}
  <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
    {/* messages */}
  </div>
  {/* toast */}
  <PromptInput ... />
</div>
```

Change to:

```tsx
<div className="flex flex-1 overflow-hidden relative">
  {/* Left: main chat */}
  <div className={`flex flex-col overflow-hidden ${activeAgentId ? 'w-[60%]' : 'w-full'} transition-all`}>
    {/* header */}
    <div className="flex items-center justify-center border-b border-[#333] px-4 py-2" style={{ WebkitAppRegion: 'drag' } as any}>
      <span className="text-[10px] uppercase tracking-[0.1em] text-[#666]">
        SESSION // {activeSessionId ? activeSessionId.slice(0, 8).toUpperCase() : '---'}
      </span>
    </div>
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[760px]">
        {/* existing message rendering */}
      </div>
    </div>
    {toast && (
      <div className="absolute top-14 left-1/2 -translate-x-1/2 border border-[#333] bg-[#111] px-4 py-2 text-[11px] text-[#EAEAEA] z-50">
        {toast}
      </div>
    )}
    <PromptInput ... />
  </div>

  {/* Right: agent detail panel */}
  {activeAgentId && (
    <div className="w-[40%] border-l border-[#333]">
      <AgentDetailPanel />
    </div>
  )}
</div>
```

The key change: the outermost div changes from `flex-col` to `flex` (horizontal), and the main chat area gets a conditional width class.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Build and verify**

Run: `cd packages/ui && npx vite build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/ChatView.tsx
git commit -m "feat(ui): add split layout for AgentDetailPanel in ChatView"
```

---

## Task 9: Integration test

**Files:** None (manual testing)

- [ ] **Step 1: Build all packages**

```bash
cd packages/core && pnpm build
cd ../electron && pnpm build
```

- [ ] **Step 2: Start the app**

```bash
cd packages/ui && npx vite --port 5173 &
cd ../electron && NODE_ENV=development npx electron dist/main.js
```

- [ ] **Step 3: Test agent execution**

Send a message that triggers the Agent tool (e.g., "use the agent tool to read the current directory and list files"). Verify:

1. AgentToolCard shows with purple theme and task description
2. While running: shows tree of recent tool calls updating in real-time
3. Shows tool count
4. Abort button is visible and clickable
5. Clicking the card opens the right-side AgentDetailPanel

- [ ] **Step 4: Test AgentDetailPanel**

With the panel open, verify:
1. Panel shows full list of sub-agent tool calls (using ToolCardRouter)
2. Text output section shows agent's text responses
3. Close button [X] hides the panel
4. Main chat area resizes to 60% width

- [ ] **Step 5: Test abort**

Click [ABORT] while agent is running. Verify:
1. Agent stops executing
2. Card shows error or done state
3. Panel updates accordingly

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(ui): address agent split-view issues found in integration testing"
```
