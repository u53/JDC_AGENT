# Tool Differentiated Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unified ToolCard/HistoryToolCard with specialized per-tool renderers that show contextual information (commands, diffs, file paths) instead of raw JSON.

**Architecture:** Registry-based router dispatches to specialized card components by toolName. A shared `ToolCardShell` handles common chrome (border, header, expand/collapse). The `ToolExecutionEvent` type is extended with an `input` field so cards can access tool-specific parameters during streaming.

**Tech Stack:** React 19, TailwindCSS 4, TypeScript, Vitest

---

## File Structure

```
packages/core/src/tool-runner.ts              — Add `input` to ToolExecutionEvent
packages/core/tests/tool-runner.test.ts       — Verify input is passed in events

packages/ui/src/components/tool-cards/
├── index.ts                                  — Re-exports
├── ToolCardRouter.tsx                        — Route by toolName
├── ToolCardShell.tsx                         — Shared card chrome (border, header, collapse)
├── shared.ts                                 — StatusDot, computeLineDiff, utility fns
├── BashToolCard.tsx                          — Command + output + exit code
├── EditToolCard.tsx                          — File path + unified diff
├── WriteToolCard.tsx                         — File path + new content preview
├── ReadToolCard.tsx                          — Collapsed file path
├── AgentToolCard.tsx                         — Task description + progress + abort
├── SkillToolCard.tsx                         — Skill name + content
├── McpToolCard.tsx                           — server::tool + params
└── GenericToolCard.tsx                       — Fallback (current behavior)

packages/ui/src/components/ChatView.tsx       — Replace <ToolCard> with <ToolCardRouter>, add Read grouping
packages/ui/src/components/MessageBubble.tsx  — Replace <HistoryToolCard> with <ToolCardRouter>
```

---

## Task 1: Extend ToolExecutionEvent with input field

**Files:**
- Modify: `packages/core/src/tool-runner.ts:5-11`
- Modify: `packages/core/src/tool-runner.ts:74`
- Modify: `packages/core/tests/tool-runner.test.ts`

- [ ] **Step 1: Update ToolExecutionEvent interface**

In `packages/core/src/tool-runner.ts`, add `input` to the interface:

```typescript
export interface ToolExecutionEvent {
  type: 'start' | 'progress' | 'complete' | 'error'
  toolName: string
  toolUseId: string
  input?: Record<string, unknown>
  message?: string
  result?: ToolResult
}
```

- [ ] **Step 2: Pass input in the start event**

In `packages/core/src/tool-runner.ts`, change the `onEvent` call at line ~74 from:

```typescript
onEvent({ type: 'start', toolName, toolUseId })
```

to:

```typescript
onEvent({ type: 'start', toolName, toolUseId, input })
```

- [ ] **Step 3: Update existing test to verify input is passed**

In `packages/core/tests/tool-runner.test.ts`, update the first test:

```typescript
it('should execute a registered tool', async () => {
  const registry = new ToolRegistry()
  registry.register({
    definition: { name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    execute: async (input) => ({ content: String(input.text) }),
  })

  const runner = new ToolRunner(registry, '/tmp', new PermissionChecker('relaxed'))
  const events: any[] = []
  const result = await runner.execute('echo', 'id-1', { text: 'hello' }, (e) => events.push(e))

  expect(result.content).toBe('hello')
  expect(events[0].type).toBe('start')
  expect(events[0].input).toEqual({ text: 'hello' })
  expect(events[1].type).toBe('complete')
})
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && pnpm test -- --run tool-runner`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tool-runner.ts packages/core/tests/tool-runner.test.ts
git commit -m "feat(core): add input field to ToolExecutionEvent start event"
```

---

## Task 2: Shared utilities and ToolCardShell

**Files:**
- Create: `packages/ui/src/components/tool-cards/shared.ts`
- Create: `packages/ui/src/components/tool-cards/ToolCardShell.tsx`

- [ ] **Step 1: Create shared.ts with utilities**

Create `packages/ui/src/components/tool-cards/shared.ts`:

```typescript
export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
}

export function computeLineDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const result: DiffLine[] = []

  let oi = 0
  let ni = 0

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      result.push({ type: 'add', content: newLines[ni]! })
      ni++
    } else if (ni >= newLines.length) {
      result.push({ type: 'remove', content: oldLines[oi]! })
      oi++
    } else if (oldLines[oi] === newLines[ni]) {
      result.push({ type: 'context', content: oldLines[oi]! })
      oi++
      ni++
    } else {
      result.push({ type: 'remove', content: oldLines[oi]! })
      oi++
      if (ni < newLines.length && (oi >= oldLines.length || oldLines[oi] !== newLines[ni])) {
        result.push({ type: 'add', content: newLines[ni]! })
        ni++
      }
    }
  }

  return result
}

export function extractFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const match = toolName.match(/^mcp__([^_]+)__(.+)$/)
  if (!match) return null
  return { server: match[1]!, tool: match[2]! }
}
```

- [ ] **Step 2: Create ToolCardShell.tsx**

Create `packages/ui/src/components/tool-cards/ToolCardShell.tsx`:

```typescript
import { useState, type ReactNode } from 'react'

interface Props {
  label: string
  labelColor?: string
  detail: string
  status: 'running' | 'done' | 'error'
  borderColor?: string
  defaultExpanded?: boolean
  collapsible?: boolean
  children?: ReactNode
  actions?: ReactNode
}

const statusConfig = {
  running: { text: 'RUNNING', color: 'text-[#EAEAEA]', dot: 'bg-[#4AF626] animate-pulse' },
  done: { text: 'DONE', color: 'text-[#4AF626]', dot: 'bg-[#4AF626]' },
  error: { text: 'ERROR', color: 'text-[#E61919]', dot: 'bg-[#E61919]' },
}

export function ToolCardShell({
  label,
  labelColor = 'text-[#EAEAEA]',
  detail,
  status,
  borderColor = 'border-[#333]',
  defaultExpanded = false,
  collapsible = true,
  children,
  actions,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const cfg = statusConfig[status]
  const hasContent = !!children
  const canToggle = collapsible && hasContent && status !== 'running'

  return (
    <div className={`mb-3 border ${borderColor}`}>
      <div
        className={`flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em] ${canToggle ? 'cursor-pointer hover:bg-[#111]' : ''}`}
        onClick={() => { if (canToggle) setExpanded(!expanded) }}
      >
        <span className={`inline-block h-2 w-2 rounded-full ${cfg.dot}`} />
        {canToggle && <span className="text-[#666]">{expanded ? '▼' : '▶'}</span>}
        <span className={labelColor}>{label}</span>
        <span className="text-[#666] truncate flex-1 text-left">{detail}</span>
        <span className={cfg.color}>[{cfg.text}]</span>
        {actions}
      </div>
      {(expanded || status === 'running') && hasContent && (
        <div className="border-t border-[#333] px-3 py-2">
          {children}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/tool-cards/shared.ts packages/ui/src/components/tool-cards/ToolCardShell.tsx
git commit -m "feat(ui): add ToolCardShell and shared utilities for tool cards"
```

---

## Task 3: GenericToolCard (fallback) and ToolCardRouter

**Files:**
- Create: `packages/ui/src/components/tool-cards/GenericToolCard.tsx`
- Create: `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`
- Create: `packages/ui/src/components/tool-cards/index.ts`

- [ ] **Step 1: Create GenericToolCard.tsx**

This is the fallback renderer — essentially the current ToolCard behavior wrapped in ToolCardShell.

Create `packages/ui/src/components/tool-cards/GenericToolCard.tsx`:

```typescript
import type { ToolExecutionEvent } from '@jdcagnet/core'
import { ToolCardShell } from './ToolCardShell'

interface Props {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}

export function GenericToolCard({ event, name, input, result }: Props) {
  const toolName = event?.toolName || name || 'unknown'
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')
  const content = event?.result?.content || event?.message || result?.content
  const isError = event?.result?.isError || result?.is_error
  const toolInput = event?.input || input

  return (
    <ToolCardShell
      label={`>>> ${toolName}`}
      detail=""
      status={status}
      defaultExpanded={status === 'running'}
    >
      {toolInput && Object.keys(toolInput).length > 0 && (
        <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#EAEAEA] mb-2">
          {JSON.stringify(toolInput, null, 2)}
        </pre>
      )}
      {content && (
        <pre className={`max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap ${isError ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
          {content}
        </pre>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 2: Create ToolCardRouter.tsx**

Create `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`:

```typescript
import type { ToolExecutionEvent } from '@jdcagnet/core'
import { GenericToolCard } from './GenericToolCard'
import { parseMcpToolName } from './shared'

export interface ToolCardRouterProps {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}

const TOOL_CARD_REGISTRY: Record<string, React.ComponentType<ToolCardRouterProps>> = {
  // Will be populated in subsequent tasks:
  // Bash: BashToolCard,
  // Edit: EditToolCard,
  // Write: WriteToolCard,
  // Read: ReadToolCard,
  // Agent: AgentToolCard,
  // Skill: SkillToolCard,
}

export function ToolCardRouter(props: ToolCardRouterProps) {
  const toolName = props.event?.toolName || props.name || ''

  // Check MCP tools first (mcp__server__tool pattern)
  const mcpParsed = parseMcpToolName(toolName)
  if (mcpParsed) {
    // McpToolCard will be added later, fallback for now
    return <GenericToolCard {...props} />
  }

  const Card = TOOL_CARD_REGISTRY[toolName]
  if (Card) {
    return <Card {...props} />
  }

  return <GenericToolCard {...props} />
}
```

- [ ] **Step 3: Create index.ts**

Create `packages/ui/src/components/tool-cards/index.ts`:

```typescript
export { ToolCardRouter } from './ToolCardRouter'
export type { ToolCardRouterProps } from './ToolCardRouter'
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/tool-cards/
git commit -m "feat(ui): add ToolCardRouter with GenericToolCard fallback"
```

---

## Task 4: BashToolCard

**Files:**
- Create: `packages/ui/src/components/tool-cards/BashToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`

- [ ] **Step 1: Create BashToolCard.tsx**

Create `packages/ui/src/components/tool-cards/BashToolCard.tsx`:

```typescript
import { useState } from 'react'
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { truncateText } from './shared'

export function BashToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const command = (event?.input?.command || input?.command || '') as string
  const output = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const displayCommand = truncateText(command, 60)

  return (
    <ToolCardShell
      label="BASH"
      detail={`$ ${displayCommand}`}
      status={status}
      defaultExpanded={status === 'running'}
    >
      {status === 'running' && !output && (
        <div className="text-[10px] text-[#666] uppercase tracking-[0.1em]">Running...</div>
      )}
      {output && (
        <pre className={`max-h-[300px] overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap font-mono ${isError ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
          {output}
        </pre>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 2: Register BashToolCard in router**

In `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`, add the import and registration:

```typescript
import type { ToolExecutionEvent } from '@jdcagnet/core'
import { GenericToolCard } from './GenericToolCard'
import { BashToolCard } from './BashToolCard'
import { parseMcpToolName } from './shared'

export interface ToolCardRouterProps {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}

const TOOL_CARD_REGISTRY: Record<string, React.ComponentType<ToolCardRouterProps>> = {
  Bash: BashToolCard,
}

export function ToolCardRouter(props: ToolCardRouterProps) {
  const toolName = props.event?.toolName || props.name || ''

  const mcpParsed = parseMcpToolName(toolName)
  if (mcpParsed) {
    return <GenericToolCard {...props} />
  }

  const Card = TOOL_CARD_REGISTRY[toolName]
  if (Card) {
    return <Card {...props} />
  }

  return <GenericToolCard {...props} />
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/tool-cards/BashToolCard.tsx packages/ui/src/components/tool-cards/ToolCardRouter.tsx
git commit -m "feat(ui): add BashToolCard with command display and output"
```

---

## Task 5: EditToolCard

**Files:**
- Create: `packages/ui/src/components/tool-cards/EditToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`

- [ ] **Step 1: Create EditToolCard.tsx**

Create `packages/ui/src/components/tool-cards/EditToolCard.tsx`:

```typescript
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { computeLineDiff, extractFileName } from './shared'

export function EditToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || '') as string
  const oldString = (toolInput.old_string || '') as string
  const newString = (toolInput.new_string || '') as string
  const errorContent = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const diffLines = oldString || newString ? computeLineDiff(oldString, newString) : []
  const addCount = diffLines.filter(l => l.type === 'add').length
  const removeCount = diffLines.filter(l => l.type === 'remove').length
  const summary = `+${addCount} -${removeCount}`

  const detail = filePath ? `${filePath} (${summary})` : ''

  return (
    <ToolCardShell
      label="EDIT"
      detail={detail}
      status={status}
      defaultExpanded={status === 'running'}
    >
      {isError && (
        <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#E61919]">
          {errorContent}
        </pre>
      )}
      {!isError && diffLines.length > 0 && (
        <div className="max-h-[300px] overflow-auto bg-[#050505] p-2 text-xs font-mono">
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={
                line.type === 'add'
                  ? 'bg-green-900/20 text-green-400'
                  : line.type === 'remove'
                  ? 'bg-red-900/20 text-red-400'
                  : 'text-[#666]'
              }
            >
              <span className="select-none inline-block w-4">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
              </span>
              {line.content}
            </div>
          ))}
        </div>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 2: Register EditToolCard in router**

In `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`, add import and registration:

```typescript
import { EditToolCard } from './EditToolCard'

const TOOL_CARD_REGISTRY: Record<string, React.ComponentType<ToolCardRouterProps>> = {
  Bash: BashToolCard,
  Edit: EditToolCard,
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/tool-cards/EditToolCard.tsx packages/ui/src/components/tool-cards/ToolCardRouter.tsx
git commit -m "feat(ui): add EditToolCard with unified diff rendering"
```

---

## Task 6: WriteToolCard and ReadToolCard

**Files:**
- Create: `packages/ui/src/components/tool-cards/WriteToolCard.tsx`
- Create: `packages/ui/src/components/tool-cards/ReadToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`

- [ ] **Step 1: Create WriteToolCard.tsx**

Create `packages/ui/src/components/tool-cards/WriteToolCard.tsx`:

```typescript
import { useState } from 'react'
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'

export function WriteToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || '') as string
  const content = (toolInput.content || '') as string
  const lines = content.split('\n')
  const isError = event?.result?.isError || result?.is_error
  const errorContent = event?.result?.content || result?.content || ''

  const [showAll, setShowAll] = useState(false)
  const displayLines = showAll ? lines : lines.slice(0, 5)
  const hasMore = lines.length > 10

  return (
    <ToolCardShell
      label="WRITE"
      detail={`${filePath} (${lines.length} lines)`}
      status={status}
      defaultExpanded={status === 'running'}
    >
      {isError && (
        <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#E61919]">
          {errorContent}
        </pre>
      )}
      {!isError && lines.length > 0 && (
        <div className="max-h-[300px] overflow-auto bg-[#050505] p-2 text-xs font-mono">
          {displayLines.map((line, i) => (
            <div key={i} className="bg-green-900/20 text-green-400">
              <span className="select-none inline-block w-4">+</span>
              {line}
            </div>
          ))}
          {hasMore && !showAll && (
            <div
              className="text-[#666] cursor-pointer hover:text-[#EAEAEA] mt-1"
              onClick={(e) => { e.stopPropagation(); setShowAll(true) }}
            >
              ... {lines.length - 5} more lines
            </div>
          )}
        </div>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 2: Create ReadToolCard.tsx**

Create `packages/ui/src/components/tool-cards/ReadToolCard.tsx`:

```typescript
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'

export function ReadToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || toolInput.path || '') as string
  const content = event?.result?.content || result?.content || ''
  const lineCount = content ? content.split('\n').length : 0
  const isError = event?.result?.isError || result?.is_error

  const detail = filePath + (lineCount > 0 ? ` (${lineCount} lines)` : '')

  return (
    <ToolCardShell
      label="READ"
      detail={detail}
      status={status}
      defaultExpanded={false}
    >
      {isError && (
        <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#E61919]">
          {content}
        </pre>
      )}
      {!isError && content && (
        <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#EAEAEA]">
          {content.split('\n').slice(0, 5).join('\n')}
          {lineCount > 5 && `\n... ${lineCount - 5} more lines`}
        </pre>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 3: Register both in router**

In `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`, add imports and registrations:

```typescript
import { WriteToolCard } from './WriteToolCard'
import { ReadToolCard } from './ReadToolCard'

const TOOL_CARD_REGISTRY: Record<string, React.ComponentType<ToolCardRouterProps>> = {
  Bash: BashToolCard,
  Edit: EditToolCard,
  Write: WriteToolCard,
  Read: ReadToolCard,
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/tool-cards/WriteToolCard.tsx packages/ui/src/components/tool-cards/ReadToolCard.tsx packages/ui/src/components/tool-cards/ToolCardRouter.tsx
git commit -m "feat(ui): add WriteToolCard and ReadToolCard"
```

---

## Task 7: AgentToolCard

**Files:**
- Create: `packages/ui/src/components/tool-cards/AgentToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`

- [ ] **Step 1: Create AgentToolCard.tsx**

Create `packages/ui/src/components/tool-cards/AgentToolCard.tsx`:

```typescript
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { truncateText } from './shared'

export function AgentToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const prompt = (toolInput.prompt || '') as string
  const taskDescription = truncateText(prompt, 50)
  const resultContent = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  return (
    <ToolCardShell
      label="AGENT"
      labelColor="text-purple-300"
      detail={taskDescription}
      status={status}
      borderColor="border-purple-800/50"
      defaultExpanded={status === 'running'}
      actions={
        status === 'running' ? (
          <button
            className="text-[10px] uppercase tracking-[0.05em] text-red-500 hover:text-red-400 transition-colors ml-2"
            onClick={(e) => { e.stopPropagation() }}
          >
            [ABORT]
          </button>
        ) : undefined
      }
    >
      {status === 'running' && (
        <div className="text-[10px] text-purple-400 uppercase tracking-[0.1em]">
          <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse mr-2" />
          Processing...
        </div>
      )}
      {status !== 'running' && resultContent && (
        <pre className={`max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap ${isError ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
          {truncateText(resultContent, 500)}
        </pre>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 2: Register AgentToolCard in router**

In `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`, add import and registration:

```typescript
import { AgentToolCard } from './AgentToolCard'

const TOOL_CARD_REGISTRY: Record<string, React.ComponentType<ToolCardRouterProps>> = {
  Bash: BashToolCard,
  Edit: EditToolCard,
  Write: WriteToolCard,
  Read: ReadToolCard,
  Agent: AgentToolCard,
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/tool-cards/AgentToolCard.tsx packages/ui/src/components/tool-cards/ToolCardRouter.tsx
git commit -m "feat(ui): add AgentToolCard with task description and abort button"
```

---

## Task 8: SkillToolCard and McpToolCard

**Files:**
- Create: `packages/ui/src/components/tool-cards/SkillToolCard.tsx`
- Create: `packages/ui/src/components/tool-cards/McpToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`

- [ ] **Step 1: Create SkillToolCard.tsx**

Create `packages/ui/src/components/tool-cards/SkillToolCard.tsx`:

```typescript
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'

export function SkillToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const skillName = (toolInput.skill || toolInput.name || '') as string
  const content = event?.result?.content || result?.content || ''

  return (
    <ToolCardShell
      label="SKILL"
      detail={skillName}
      status={status}
      defaultExpanded={false}
    >
      {content && (
        <pre className="max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap text-[#EAEAEA]">
          {content.slice(0, 200)}
          {content.length > 200 && '...'}
        </pre>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 2: Create McpToolCard.tsx**

Create `packages/ui/src/components/tool-cards/McpToolCard.tsx`:

```typescript
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { parseMcpToolName } from './shared'

interface McpProps extends ToolCardRouterProps {
  serverName?: string
  toolDisplayName?: string
}

export function McpToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolName = event?.toolName || name || ''
  const parsed = parseMcpToolName(toolName)
  const displayName = parsed ? `${parsed.server}::${parsed.tool}` : toolName

  const toolInput = event?.input || input || {}
  const content = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const inputEntries = Object.entries(toolInput).slice(0, 5)

  return (
    <ToolCardShell
      label="MCP"
      detail={displayName}
      status={status}
      defaultExpanded={status === 'running'}
    >
      {inputEntries.length > 0 && (
        <div className="text-xs text-[#666] mb-2">
          {inputEntries.map(([key, val]) => (
            <div key={key}>
              <span className="text-[#EAEAEA]">{key}</span>: {typeof val === 'string' ? val.slice(0, 80) : JSON.stringify(val).slice(0, 80)}
            </div>
          ))}
        </div>
      )}
      {content && (
        <pre className={`max-h-48 overflow-auto bg-[#050505] p-2 text-xs whitespace-pre-wrap ${isError ? 'text-[#E61919]' : 'text-[#EAEAEA]'}`}>
          {content.slice(0, 500)}
          {content.length > 500 && '\n...'}
        </pre>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 3: Register both and update MCP routing in ToolCardRouter.tsx**

Replace the full content of `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`:

```typescript
import type { ToolExecutionEvent } from '@jdcagnet/core'
import { GenericToolCard } from './GenericToolCard'
import { BashToolCard } from './BashToolCard'
import { EditToolCard } from './EditToolCard'
import { WriteToolCard } from './WriteToolCard'
import { ReadToolCard } from './ReadToolCard'
import { AgentToolCard } from './AgentToolCard'
import { SkillToolCard } from './SkillToolCard'
import { McpToolCard } from './McpToolCard'
import { parseMcpToolName } from './shared'

export interface ToolCardRouterProps {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}

const TOOL_CARD_REGISTRY: Record<string, React.ComponentType<ToolCardRouterProps>> = {
  Bash: BashToolCard,
  Edit: EditToolCard,
  Write: WriteToolCard,
  Read: ReadToolCard,
  Agent: AgentToolCard,
  Skill: SkillToolCard,
}

export function ToolCardRouter(props: ToolCardRouterProps) {
  const toolName = props.event?.toolName || props.name || ''

  const mcpParsed = parseMcpToolName(toolName)
  if (mcpParsed) {
    return <McpToolCard {...props} />
  }

  const Card = TOOL_CARD_REGISTRY[toolName]
  if (Card) {
    return <Card {...props} />
  }

  return <GenericToolCard {...props} />
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/tool-cards/SkillToolCard.tsx packages/ui/src/components/tool-cards/McpToolCard.tsx packages/ui/src/components/tool-cards/ToolCardRouter.tsx
git commit -m "feat(ui): add SkillToolCard and McpToolCard, complete router registry"
```

---

## Task 9: Integrate ToolCardRouter into ChatView and MessageBubble

**Files:**
- Modify: `packages/ui/src/components/ChatView.tsx`
- Modify: `packages/ui/src/components/MessageBubble.tsx`

- [ ] **Step 1: Replace ToolCard in ChatView.tsx**

In `packages/ui/src/components/ChatView.tsx`:

1. Remove the import of `ToolCard`:
```typescript
// Remove: import { ToolCard } from './ToolCard'
```

2. Add import of `ToolCardRouter`:
```typescript
import { ToolCardRouter } from './tool-cards'
```

3. Replace the toolEvents rendering section (around line 138):

From:
```typescript
{toolEvents.map((event, i) => (
  <ToolCard key={`${event.toolUseId}-${i}`} event={event} />
))}
```

To:
```typescript
{toolEvents.map((event, i) => (
  <ToolCardRouter key={`${event.toolUseId}-${i}`} event={event} />
))}
```

- [ ] **Step 2: Replace HistoryToolCard in MessageBubble.tsx**

In `packages/ui/src/components/MessageBubble.tsx`:

1. Remove the import of `HistoryToolCard`:
```typescript
// Remove: import { HistoryToolCard } from './HistoryToolCard'
```

2. Add import of `ToolCardRouter`:
```typescript
import { ToolCardRouter } from './tool-cards'
```

3. Replace the toolUseBlocks rendering section (around line 63-72):

From:
```typescript
{toolUseBlocks.map((block, i) => {
  if (block.type === 'tool_use') {
    return (
      <HistoryToolCard
        key={i}
        name={block.name}
        input={block.input}
        result={findToolResult(block.id)}
      />
    )
  }
  return null
})}
```

To:
```typescript
{toolUseBlocks.map((block, i) => {
  if (block.type === 'tool_use') {
    return (
      <ToolCardRouter
        key={i}
        name={block.name}
        input={block.input}
        result={findToolResult(block.id)}
      />
    )
  }
  return null
})}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Manual test**

Run: `cd packages/electron && NODE_ENV=development npx electron dist/main.js`

Test:
1. Send a message that triggers Bash tool → should see "BASH $ command [DONE]" card
2. Send a message that triggers Edit tool → should see "EDIT filepath (+N -M) [DONE]" card with diff
3. Send a message that triggers Read tool → should see "READ filepath [DONE]" collapsed card
4. Verify old messages still render correctly with the new cards

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ChatView.tsx packages/ui/src/components/MessageBubble.tsx
git commit -m "feat(ui): integrate ToolCardRouter into ChatView and MessageBubble"
```

---

## Task 10: Read grouping in ChatView

**Files:**
- Modify: `packages/ui/src/components/ChatView.tsx`

- [ ] **Step 1: Add Read grouping logic before rendering toolEvents**

In `packages/ui/src/components/ChatView.tsx`, add a grouping function and update the rendering:

Add this helper above the component or in a local scope:

```typescript
interface GroupedToolEvent {
  type: 'single'
  event: ToolExecutionEvent
} | {
  type: 'read-group'
  events: ToolExecutionEvent[]
}

function groupToolEvents(events: ToolExecutionEvent[]): GroupedToolEvent[] {
  const result: GroupedToolEvent[] = []
  let readBuffer: ToolExecutionEvent[] = []

  const flushReads = () => {
    if (readBuffer.length >= 2 && readBuffer.every(e => e.type === 'complete')) {
      result.push({ type: 'read-group', events: [...readBuffer] })
    } else {
      for (const e of readBuffer) {
        result.push({ type: 'single', event: e })
      }
    }
    readBuffer = []
  }

  for (const event of events) {
    if (event.toolName === 'Read' && event.type === 'complete') {
      readBuffer.push(event)
    } else {
      flushReads()
      result.push({ type: 'single', event })
    }
  }
  flushReads()

  return result
}
```

- [ ] **Step 2: Update the toolEvents rendering to use grouping**

Replace the toolEvents map in the JSX:

From:
```typescript
{toolEvents.map((event, i) => (
  <ToolCardRouter key={`${event.toolUseId}-${i}`} event={event} />
))}
```

To:
```typescript
{groupToolEvents(toolEvents).map((group, i) => {
  if (group.type === 'read-group') {
    const files = group.events.map(e => {
      const fp = (e.input?.file_path || e.input?.path || '') as string
      return fp.split('/').pop() || fp
    }).join(', ')
    return (
      <div key={`read-group-${i}`} className="mb-3 border border-[#333]">
        <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#4AF626]" />
          <span className="text-[#EAEAEA]">READ</span>
          <span className="text-[#666] truncate">{group.events.length} files: {files}</span>
          <span className="text-[#4AF626]">[DONE]</span>
        </div>
      </div>
    )
  }
  return <ToolCardRouter key={`${group.event.toolUseId}-${i}`} event={group.event} />
})}
```

- [ ] **Step 3: Add the ToolExecutionEvent import if not already present**

Ensure `ChatView.tsx` has:
```typescript
import type { ToolExecutionEvent } from '@jdcagnet/core'
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ChatView.tsx
git commit -m "feat(ui): add consecutive Read tool grouping in ChatView"
```

---

## Task 11: Cleanup — remove old ToolCard and HistoryToolCard

**Files:**
- Delete: `packages/ui/src/components/ToolCard.tsx`
- Delete: `packages/ui/src/components/HistoryToolCard.tsx`

- [ ] **Step 1: Verify no other imports of old components**

Run: `cd packages/ui && grep -r "ToolCard\|HistoryToolCard" src/ --include="*.tsx" --include="*.ts" | grep -v "tool-cards/" | grep -v "node_modules"`

Expected: No results (all references should have been replaced in Task 9)

- [ ] **Step 2: Delete old files**

```bash
rm packages/ui/src/components/ToolCard.tsx
rm packages/ui/src/components/HistoryToolCard.tsx
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Full build check**

Run: `cd packages/ui && npx vite build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ui): remove old ToolCard and HistoryToolCard, migration complete"
```

---

## Task 12: Final integration test

**Files:** None (manual testing only)

- [ ] **Step 1: Start the app**

Run: `cd packages/electron && NODE_ENV=development npx electron dist/main.js`

- [ ] **Step 2: Test each tool card type**

Send messages that trigger each tool type and verify rendering:

1. **Bash**: "run `ls` in the current directory" → Should show `BASH $ ls [DONE]` with output
2. **Edit**: "fix a typo in a file" → Should show `EDIT filepath (+1 -1) [DONE]` with diff
3. **Write**: "create a new file" → Should show `WRITE filepath (N lines) [DONE]` with green lines
4. **Read**: Ask something that requires reading files → Should show collapsed `READ filepath [DONE]`
5. **Agent**: Trigger a sub-agent task → Should show `AGENT "task..." [RUNNING]` with purple theme
6. **Skill**: Use a slash command that triggers skill → Should show `SKILL name [DONE]`
7. **MCP**: If MCP tools configured, trigger one → Should show `MCP server::tool [DONE]`

- [ ] **Step 3: Test Read grouping**

Trigger a task that reads multiple files consecutively → Should show "READ N files: file1, file2, ..." as a single line

- [ ] **Step 4: Test error states**

Trigger a tool error (e.g., edit a non-existent file) → Should show red error state with error message

- [ ] **Step 5: Test history rendering**

Switch to a session with existing messages → Old tool calls should render with the new specialized cards

- [ ] **Step 6: Commit any fixes**

If any issues found during testing, fix and commit:
```bash
git add -A
git commit -m "fix(ui): address tool card rendering issues found in integration testing"
```
