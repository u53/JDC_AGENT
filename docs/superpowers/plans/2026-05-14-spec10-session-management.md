# Spec 10: Session Management Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add /stats command with stats card, improve /compact feedback with completion card, and auto-extract memories during compaction.

**Architecture:** /stats renders a local UI card (no AI call). Compact enhanced with completion notification via new StreamChunk type. Memory extraction piggybacks on compact's model call by extending the prompt.

**Tech Stack:** TypeScript, React, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/core/src/memory-extractor.ts` (CREATE) | Parse memories from model output, write to files |
| `packages/core/src/compact.ts` (MODIFY) | Add memory extraction prompt, return stats |
| `packages/core/src/session.ts` (MODIFY) | Call memory extractor after compact, emit compact_complete |
| `packages/core/src/types.ts` (MODIFY) | Add compact_complete to StreamChunk |
| `packages/ui/src/components/StatsCard.tsx` (CREATE) | Stats display card |
| `packages/ui/src/components/ChatView.tsx` (MODIFY) | /stats handler + compact card rendering |
| `packages/ui/src/components/SlashCommandMenu.tsx` (MODIFY) | Add /stats command |

---

### Task 1: Memory Extractor Module

**Files:**
- Create: `packages/core/src/memory-extractor.ts`
- Create: `packages/core/tests/memory-extractor.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/tests/memory-extractor.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseMemories, saveMemories } from '../src/memory-extractor.js'
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('parseMemories', () => {
  it('should parse memories from model output', () => {
    const output = `Here is the summary...
<memories>[{"name":"no-native-dialogs","type":"feedback","description":"Never use native dialogs","content":"Always use Radix UI components instead of native confirm/alert."}]</memories>`

    const memories = parseMemories(output)
    expect(memories).toHaveLength(1)
    expect(memories[0].name).toBe('no-native-dialogs')
    expect(memories[0].type).toBe('feedback')
  })

  it('should return empty array when no memories tag', () => {
    expect(parseMemories('just a summary')).toEqual([])
  })

  it('should return empty array for empty memories', () => {
    expect(parseMemories('<memories>[]</memories>')).toEqual([])
  })
})

describe('saveMemories', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdcagnet-mem-test-' + Date.now())

  beforeEach(() => mkdirSync(tmpDir, { recursive: true }))
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  it('should write memory files and update index', async () => {
    const memories = [
      { name: 'test-pref', type: 'feedback', description: 'Test preference', content: 'Always use TypeScript' },
    ]

    const count = await saveMemories(memories, tmpDir, 'session-123')
    expect(count).toBe(1)

    const filePath = path.join(tmpDir, 'test-pref.md')
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('name: test-pref')
    expect(content).toContain('type: feedback')
    expect(content).toContain('Always use TypeScript')

    const index = readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8')
    expect(index).toContain('test-pref')
  })

  it('should skip existing memory files', async () => {
    mkdirSync(tmpDir, { recursive: true })
    const existing = path.join(tmpDir, 'existing.md')
    require('fs').writeFileSync(existing, 'old content')

    const memories = [
      { name: 'existing', type: 'feedback', description: 'Exists', content: 'new content' },
    ]

    const count = await saveMemories(memories, tmpDir, 'session-123')
    expect(count).toBe(0)
    expect(readFileSync(existing, 'utf-8')).toBe('old content')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/memory-extractor.test.ts`

- [ ] **Step 3: Implement memory-extractor.ts**

```typescript
// packages/core/src/memory-extractor.ts
import { writeFileSync, readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export interface ExtractedMemory {
  name: string
  type: string
  description: string
  content: string
}

export function parseMemories(modelOutput: string): ExtractedMemory[] {
  const match = modelOutput.match(/<memories>([\s\S]*?)<\/memories>/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1])
    if (!Array.isArray(parsed)) return []
    return parsed.filter(m => m && m.name && m.type && m.content)
  } catch {
    return []
  }
}

export async function saveMemories(
  memories: ExtractedMemory[],
  memDir: string,
  sessionId: string
): Promise<number> {
  if (memories.length === 0) return 0

  mkdirSync(memDir, { recursive: true })
  let saved = 0

  for (const mem of memories) {
    const filePath = path.join(memDir, `${mem.name}.md`)
    if (existsSync(filePath)) continue

    const date = new Date().toISOString()
    const fileContent = `---
name: ${mem.name}
description: ${mem.description}
metadata:
  type: ${mem.type}
  extractedAt: ${date}
  sessionId: ${sessionId}
---

${mem.content}
`
    writeFileSync(filePath, fileContent, 'utf-8')

    const indexPath = path.join(memDir, 'MEMORY.md')
    const indexLine = `- [${mem.description}](${mem.name}.md) — ${mem.description}\n`
    if (existsSync(indexPath)) {
      appendFileSync(indexPath, indexLine, 'utf-8')
    } else {
      writeFileSync(indexPath, indexLine, 'utf-8')
    }
    saved++
  }

  return saved
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && npx vitest run tests/memory-extractor.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/memory-extractor.ts packages/core/tests/memory-extractor.test.ts
git commit -m "feat(core): add memory-extractor module for auto memory extraction"
```

---

### Task 2: Enhance compact with memory extraction + stats

**Files:**
- Modify: `packages/core/src/compact.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add compact_complete to StreamChunk in types.ts**

Update the StreamChunk type union:

```typescript
export interface StreamChunk {
  type: 'text_delta' | 'thinking_delta' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'message_end' | 'compact_complete'
  text?: string
  toolUse?: { id: string; name: string; input: string }
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
  compactInfo?: {
    originalCount: number
    keptCount: number
    memoriesExtracted: number
  }
}
```

- [ ] **Step 2: Update compact.ts to include memory extraction prompt and return stats**

Change `compactMessages` to also return compact stats:

```typescript
export interface CompactResult {
  messages: Message[]
  originalCount: number
  keptCount: number
  rawOutput: string  // full model output for memory extraction
}

export async function compactMessages(
  messages: Message[],
  provider: ModelProvider,
  config: ModelConfig,
  onChunk?: (chunk: StreamChunk) => void
): Promise<CompactResult> {
  if (messages.length <= KEEP_RECENT) {
    return { messages, originalCount: messages.length, keptCount: messages.length, rawOutput: '' }
  }

  const originalCount = messages.length
  // ... existing logic ...
  // Add memory extraction to COMPACT_PROMPT
  // Return { messages: [summaryMessage, ...toKeep], originalCount, keptCount: KEEP_RECENT + 1, rawOutput: summaryText }
}
```

Update `COMPACT_PROMPT` to append memory extraction instructions:

```typescript
const COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far.
This summary should capture technical details, code patterns, and decisions essential for continuing work.

CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

Your summary should include:
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections (with snippets)
4. Errors and fixes
5. Problem Solving progress
6. Pending Tasks
7. Current Work
8. Next Step

Wrap your analysis in <analysis> tags, then provide the summary in <summary> tags.

Additionally, extract any persistent memories worth saving for future sessions.
Only extract:
- User preferences and feedback about how to work (type: "feedback")
- Project decisions and context not derivable from code (type: "project")

Output in <memories> tags as JSON array:
[{"name": "slug-name", "type": "feedback|project", "description": "one line summary", "content": "memory content"}]

If nothing worth saving, output <memories>[]</memories>`
```

- [ ] **Step 3: Update session.ts compact method**

In `session.ts`, the `compact` method currently does:
```typescript
private async compact(events: SessionEvents): Promise<void> {
  events.onStreamChunk({ type: 'text_delta', text: '\n[Compressing context...]\n' })
  this.messages = await compactMessages(this.messages, this.provider, this.config.modelConfig, events.onStreamChunk)
}
```

Change to:
```typescript
private async compact(events: SessionEvents): Promise<void> {
  events.onStreamChunk({ type: 'text_delta', text: '\n[Compressing context...]\n' })
  const result = await compactMessages(this.messages, this.provider, this.config.modelConfig, events.onStreamChunk)
  this.messages = result.messages

  // Extract and save memories
  let memoriesExtracted = 0
  if (result.rawOutput) {
    const memories = parseMemories(result.rawOutput)
    if (memories.length > 0) {
      const memDir = getMemoryDir(this.config.cwd)
      memoriesExtracted = await saveMemories(memories, memDir, this.id)
    }
  }

  // Emit compact_complete
  events.onStreamChunk({
    type: 'compact_complete',
    compactInfo: {
      originalCount: result.originalCount,
      keptCount: result.keptCount,
      memoriesExtracted,
    },
  })
}
```

Add imports: `import { parseMemories, saveMemories } from './memory-extractor.js'` and `import { getMemoryDir } from './context.js'`

- [ ] **Step 4: Export from index.ts**

```typescript
export { parseMemories, saveMemories, type ExtractedMemory } from './memory-extractor.js'
```

- [ ] **Step 5: Run tests and build**

Run: `cd packages/core && npx vitest run`
Run: `cd packages/electron && node build.mjs`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/compact.ts packages/core/src/types.ts packages/core/src/session.ts packages/core/src/index.ts
git commit -m "feat(core): enhance compact with memory extraction and completion event"
```

---

### Task 3: /stats command + UI cards

**Files:**
- Create: `packages/ui/src/components/StatsCard.tsx`
- Modify: `packages/ui/src/components/ChatView.tsx`
- Modify: `packages/ui/src/components/SlashCommandMenu.tsx`

- [ ] **Step 1: Add /stats to SlashCommandMenu**

In `packages/ui/src/components/SlashCommandMenu.tsx`, add to COMMANDS array:

```typescript
{ name: 'stats', description: '显示会话统计信息' },
```

- [ ] **Step 2: Create StatsCard component**

```typescript
// packages/ui/src/components/StatsCard.tsx
interface StatsData {
  turnCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheHitRate: number
  contextUsedPercent: number
  filesChanged: number
  duration: string
}

export function StatsCard({ data }: { data: StatsData }) {
  return (
    <div className="border border-[#333] bg-[#0A0A0A] px-4 py-3 my-2 text-xs">
      <div className="text-[10px] uppercase tracking-[0.1em] text-[#4AF626] mb-2">SESSION STATS</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[#EAEAEA]">
        <div>Turns: <span className="text-[#4AF626]">{data.turnCount}</span></div>
        <div>Duration: <span className="text-[#4AF626]">{data.duration}</span></div>
        <div>Input: <span className="text-[#4AF626]">{(data.inputTokens / 1000).toFixed(1)}k</span></div>
        <div>Output: <span className="text-[#4AF626]">{(data.outputTokens / 1000).toFixed(1)}k</span></div>
        <div>Total: <span className="text-[#4AF626]">{(data.totalTokens / 1000).toFixed(1)}k</span></div>
        <div>Cache: <span className="text-[#4AF626]">{data.cacheHitRate}%</span></div>
        <div>Context: <span className="text-[#4AF626]">{data.contextUsedPercent}%</span></div>
        <div>Files: <span className="text-[#4AF626]">{data.filesChanged}</span></div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Handle /stats in ChatView + render compact_complete**

In ChatView's `handleSlashCommand`, add `/stats` case:

```typescript
case '/stats': {
  const api = (window as any).electronAPI
  if (!activeSessionId) break
  const [usageData, filesData] = await Promise.all([
    api?.invoke('session:switch', { sessionId: activeSessionId }),
    api?.invoke('file:get-changes', { sessionId: activeSessionId }),
  ])
  const usage = usageData?.usage
  if (usage) {
    // Insert a local stats message into the UI
    const statsMsg = {
      id: 'stats-' + Date.now(),
      role: 'system' as const,
      content: [{ type: 'stats', data: { ...usage, filesChanged: filesData?.length || 0, duration: '—' } }],
      timestamp: Date.now(),
    }
    useSessionStore.setState(s => ({ messages: [...s.messages, statsMsg] }))
  }
  break
}
```

For compact_complete rendering, in the message/stream rendering logic, handle `compact_complete` chunks by showing a completion card:

```typescript
// When a compact_complete chunk arrives, show it as a system message
if (chunk.type === 'compact_complete' && chunk.compactInfo) {
  // Render: [Context compressed: X → summary + Y messages. N memories extracted.]
}
```

- [ ] **Step 4: Update /help text**

Remove `/clear` from help text, add `/stats`:

```typescript
case '/help':
  showToast('/compact /thinking /model /mcp /permission /commit /status /stats')
  break
```

- [ ] **Step 5: Build and verify**

Run: `cd packages/electron && node build.mjs`

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/StatsCard.tsx packages/ui/src/components/ChatView.tsx packages/ui/src/components/SlashCommandMenu.tsx
git commit -m "feat(ui): add /stats command + compact completion card"
```

---

### Task 4: End-to-End Verification

- [ ] **Step 1: Build and launch**

```bash
cd packages/electron && node build.mjs
cd packages/electron && NODE_ENV=development npx electron dist/main.js
```

- [ ] **Step 2: Test /stats**

Type `/stats` in a session with some history. Verify stats card appears with correct data.

- [ ] **Step 3: Test /compact feedback**

Type `/compact` in a session with enough messages (>6). Verify:
- "正在压缩上下文..." toast appears
- Compression runs (streaming visible)
- Completion card shows with stats (original count, kept count, memories extracted)

- [ ] **Step 4: Test memory extraction**

After compact, check if memory files were created in the project's memory directory.

- [ ] **Step 5: Commit if fixes needed**

```bash
git add -A && git commit -m "fix(core): address issues found in session management testing"
```
