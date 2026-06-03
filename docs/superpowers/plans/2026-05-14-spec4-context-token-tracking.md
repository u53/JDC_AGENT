# Spec 4: 上下文管理 + Token/Cost 追踪 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 JDCAGNET 中实现真实 token usage 追踪、上下文使用百分比、缓存命中率的实时 HUD 展示，以及 micro-compaction 上下文管理。

**Architecture:** Provider 层提取真实 usage → Session 层 UsageTracker 累计 → IPC 推送 → UI HUD 渲染。Micro-compaction 在 runLoop 开头截断旧 tool_result 内容。

**Tech Stack:** TypeScript, Zustand, Electron IPC, Anthropic SDK, OpenAI SDK

---

### Task 1: 扩展 StreamChunk 类型 + ModelConfig

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: 扩展 StreamChunk.usage 类型**

```typescript
// packages/core/src/types.ts — StreamChunk interface
export interface StreamChunk {
  type: 'text_delta' | 'thinking_delta' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'message_end'
  text?: string
  toolUse?: { id: string; name: string; input: string }
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
}
```

- [ ] **Step 2: 添加 contextWindow 到 ModelConfig**

```typescript
export interface ModelConfig {
  model: string
  maxTokens: number
  temperature?: number
  systemPrompt?: string
  thinking?: boolean
  thinkingBudget?: number
  contextWindow?: number
}
```

- [ ] **Step 3: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): extend StreamChunk.usage with cache fields and add contextWindow to ModelConfig"
```

---

### Task 2: 创建 UsageTracker

**Files:**
- Create: `packages/core/src/usage-tracker.ts`
- Modify: `packages/core/src/index.ts` (export)

- [ ] **Step 1: 创建 UsageTracker 类**

```typescript
// packages/core/src/usage-tracker.ts

export interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  cacheHitRate: number
  contextUsedPercent: number
  turnCount: number
}

export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

export class UsageTracker {
  private contextWindow: number
  private cumInput = 0
  private cumOutput = 0
  private cumCacheCreation = 0
  private cumCacheRead = 0
  private turnCount = 0
  private lastInputTokens = 0

  constructor(contextWindow: number) {
    this.contextWindow = contextWindow || 200000
  }

  addTurn(usage: TurnUsage): void {
    this.cumInput += usage.inputTokens
    this.cumOutput += usage.outputTokens
    this.cumCacheCreation += usage.cacheCreationInputTokens || 0
    this.cumCacheRead += usage.cacheReadInputTokens || 0
    this.lastInputTokens = usage.inputTokens
    this.turnCount++
  }

  getSnapshot(): UsageSnapshot {
    const totalTokens = this.cumInput + this.cumOutput
    const cacheTotal = this.cumInput + this.cumCacheCreation + this.cumCacheRead
    const cacheHitRate = cacheTotal > 0 ? (this.cumCacheRead / cacheTotal) * 100 : 0
    const contextUsedPercent = this.contextWindow > 0
      ? Math.round((this.lastInputTokens / this.contextWindow) * 100)
      : 0

    return {
      inputTokens: this.cumInput,
      outputTokens: this.cumOutput,
      cacheCreationTokens: this.cumCacheCreation,
      cacheReadTokens: this.cumCacheRead,
      totalTokens,
      cacheHitRate: Math.round(cacheHitRate * 10) / 10,
      contextUsedPercent: Math.min(contextUsedPercent, 100),
      turnCount: this.turnCount,
    }
  }

  setContextWindow(contextWindow: number): void {
    this.contextWindow = contextWindow
  }

  reset(): void {
    this.cumInput = 0
    this.cumOutput = 0
    this.cumCacheCreation = 0
    this.cumCacheRead = 0
    this.turnCount = 0
    this.lastInputTokens = 0
  }
}
```

- [ ] **Step 2: 导出 UsageTracker**

在 `packages/core/src/index.ts` 中添加：
```typescript
export { UsageTracker, type UsageSnapshot, type TurnUsage } from './usage-tracker.js'
```

- [ ] **Step 3: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/usage-tracker.ts packages/core/src/index.ts
git commit -m "feat(core): add UsageTracker for per-session token accumulation"
```

---

### Task 3: Anthropic Provider — 提取真实 Usage

**Files:**
- Modify: `packages/core/src/providers/anthropic.ts`

- [ ] **Step 1: 从 stream 事件中提取 usage**

Anthropic SDK 的 stream 在 `message_start` 事件中有 `message.usage`，在 `message_delta` 事件中有 `usage`（output_tokens）。需要在 stream 方法中追踪并在 `message_stop` 时 yield 真实数据。

修改 `stream()` 方法：

```typescript
async *stream(
  messages: Message[],
  tools: ToolDefinition[],
  config: ModelConfig,
  signal?: AbortSignal
): AsyncIterable<StreamChunk> {
  // ...existing params setup...

  const stream = this.client.messages.stream(params, { signal })

  let usage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }

  for await (const event of stream) {
    if (event.type === 'message_start') {
      const msg = (event as any).message
      if (msg?.usage) {
        usage.inputTokens = msg.usage.input_tokens || 0
        usage.outputTokens = msg.usage.output_tokens || 0
        usage.cacheCreationInputTokens = msg.usage.cache_creation_input_tokens || 0
        usage.cacheReadInputTokens = msg.usage.cache_read_input_tokens || 0
      }
    } else if (event.type === 'message_delta') {
      const delta = (event as any).usage
      if (delta) {
        usage.outputTokens = delta.output_tokens || usage.outputTokens
      }
    } else if (event.type === 'content_block_delta') {
      // ...existing content_block_delta handling...
    } else if (event.type === 'content_block_start') {
      // ...existing...
    } else if (event.type === 'content_block_stop') {
      yield { type: 'tool_use_end' }
    } else if (event.type === 'message_stop') {
      yield { type: 'message_end', usage }
    }
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/providers/anthropic.ts
git commit -m "feat(anthropic): extract real usage data from stream events"
```

---

### Task 4: OpenAI Chat Provider — 提取真实 Usage

**Files:**
- Modify: `packages/core/src/providers/openai-chat.ts`

- [ ] **Step 1: 在请求中启用 stream usage 并提取**

OpenAI Chat Completions API 需要 `stream_options: { include_usage: true }` 才能在最后一个 chunk 中返回 usage。

在 stream 方法中：
1. 添加 `stream_options: { include_usage: true }` 到请求参数
2. 在最后的 chunk（`choices` 为空或 `usage` 字段存在时）提取 usage
3. yield `message_end` 时带上真实 usage

```typescript
// 在 stream 请求参数中添加:
stream_options: { include_usage: true }

// 在处理 chunks 时:
if (chunk.usage) {
  usage = {
    inputTokens: chunk.usage.prompt_tokens || 0,
    outputTokens: chunk.usage.completion_tokens || 0,
  }
}

// 最后 yield:
yield { type: 'message_end', usage }
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/providers/openai-chat.ts
git commit -m "feat(openai-chat): extract real usage from stream with include_usage"
```

---

### Task 5: OpenAI Responses Provider — 提取真实 Usage

**Files:**
- Modify: `packages/core/src/providers/openai-responses.ts`

- [ ] **Step 1: 从 response completed 事件提取 usage**

OpenAI Responses API 在 `response.completed` 事件中包含 `response.usage`：

```typescript
// 在 stream 处理中追踪 usage:
if (event.type === 'response.completed') {
  const respUsage = event.response?.usage
  if (respUsage) {
    usage = {
      inputTokens: respUsage.input_tokens || 0,
      outputTokens: respUsage.output_tokens || 0,
    }
  }
}

// 最后 yield:
yield { type: 'message_end', usage }
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/providers/openai-responses.ts
git commit -m "feat(openai-responses): extract real usage from response.completed event"
```

---

### Task 6: Session 集成 UsageTracker + onUsage 事件

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: 添加 onUsage 到 SessionEvents**

```typescript
export interface SessionEvents {
  // ...existing
  onUsage?: (snapshot: UsageSnapshot) => void
}
```

- [ ] **Step 2: 在 Session 中创建 UsageTracker 实例**

```typescript
import { UsageTracker, type UsageSnapshot } from './usage-tracker.js'

export class Session {
  // ...existing
  private usageTracker: UsageTracker

  constructor(...) {
    // ...existing
    this.usageTracker = new UsageTracker(config.modelConfig.contextWindow || 200000)
  }
}
```

- [ ] **Step 3: 在 runLoop 中处理 message_end 的 usage**

在 stream 循环中，当收到 `message_end` chunk 且带 usage 时：

```typescript
} else if (chunk.type === 'message_end' && chunk.usage) {
  this.usageTracker.addTurn(chunk.usage)
  events.onUsage?.(this.usageTracker.getSnapshot())
}
```

这段代码加在 `for await (const chunk of stream)` 循环内，现有的 chunk 处理逻辑之后。

- [ ] **Step 4: updateProvider 时更新 contextWindow**

```typescript
updateProvider(provider: ModelProvider, modelConfig: ModelConfig): void {
  this.provider = provider
  this.config.modelConfig = { ...this.config.modelConfig, ...modelConfig }
  if (modelConfig.contextWindow) {
    this.usageTracker.setContextWindow(modelConfig.contextWindow)
  }
}
```

- [ ] **Step 5: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts
git commit -m "feat(session): integrate UsageTracker and emit onUsage events"
```

---

### Task 7: Micro-Compaction

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: 添加 microCompact 方法**

```typescript
private microCompact(): boolean {
  const snapshot = this.usageTracker.getSnapshot()
  if (snapshot.contextUsedPercent < 60) return false

  let truncated = false
  const cutoff = this.messages.length - 10

  for (let i = 0; i < cutoff; i++) {
    const msg = this.messages[i]
    for (let j = 0; j < msg.content.length; j++) {
      const block = msg.content[j]
      if (block.type === 'tool_result' && !block.is_error && block.content.length > 500) {
        const removed = block.content.length - 200
        msg.content[j] = {
          ...block,
          content: block.content.slice(0, 200) + `\n[...truncated, ${removed} chars]`,
        }
        truncated = true
      }
    }
  }

  return truncated
}
```

- [ ] **Step 2: 在 runLoop 开头调用 microCompact**

在 `runLoop` 方法中，在 `shouldCompact()` 检查之前：

```typescript
private async runLoop(events: SessionEvents): Promise<void> {
  this.abortController = new AbortController()
  this.currentEvents = events

  // Micro-compaction: truncate old tool results when context > 60%
  this.microCompact()

  if (this.shouldCompact()) {
    await this.compact(events)
  }
  // ...rest of runLoop
}
```

- [ ] **Step 3: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/session.ts
git commit -m "feat(session): add micro-compaction to truncate old tool results at 60% context"
```

---

### Task 8: Electron IPC 转发 Usage 事件

**Files:**
- Modify: `packages/electron/src/session-manager.ts`

- [ ] **Step 1: 在 sendMessage 的 events 中添加 onUsage**

```typescript
const events: SessionEvents = {
  // ...existing callbacks
  onUsage: (usage) => {
    this.window?.webContents.send('query:usage', { sessionId, usage })
  },
}
```

- [ ] **Step 2: 传递 contextWindow 到 modelConfig**

在 `activateSession` 和 `sendMessage` 的 model config 构建中，确保 contextWindow 被传入：

```typescript
const modelConfig: ModelConfig = {
  model: active.model.modelId,
  maxTokens: active.model.contextWindow || 8192,
  contextWindow: active.model.contextWindow || 200000,
}
```

注意：这里 `maxTokens` 是输出 token 限制，`contextWindow` 是模型的上下文窗口大小。需要确认 model store 中的 `contextWindow` 字段含义。如果 model store 中没有单独的 contextWindow 字段，使用一个合理默认值（200000）。

- [ ] **Step 3: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/electron && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/electron/src/session-manager.ts
git commit -m "feat(electron): forward query:usage IPC events to renderer"
```

---

### Task 9: Frontend Store + Hook — 接收 Usage 数据

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts`
- Modify: `packages/ui/src/hooks/useSession.ts`

- [ ] **Step 1: 扩展 SessionStreamState**

```typescript
export interface SessionStreamState {
  // ...existing
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    totalTokens: number
    cacheHitRate: number
    contextUsedPercent: number
    turnCount: number
  }
}
```

- [ ] **Step 2: 添加 updateUsage 方法到 store**

```typescript
updateUsage: (sessionId: string, usage: SessionStreamState['usage']) => {
  set((s) => {
    const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
    return {
      sessionStates: {
        ...s.sessionStates,
        [sessionId]: { ...current, usage },
      },
    }
  })
},
```

- [ ] **Step 3: 在 useSession.ts 中监听 query:usage**

```typescript
const unsubUsage = window.electronAPI?.on('query:usage', (_e: unknown, data: unknown) => {
  const { sessionId, usage } = data as { sessionId: string; usage: any }
  store.updateUsage(sessionId, usage)
}) || (() => {})
```

在 cleanup 中添加 `unsubUsage()`。

- [ ] **Step 4: 在 useSession 返回值中暴露 usage**

```typescript
return {
  // ...existing
  usage: currentState.usage,
}
```

- [ ] **Step 5: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/ui && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/stores/session-store.ts packages/ui/src/hooks/useSession.ts
git commit -m "feat(ui): add usage state tracking to session store and hook"
```

---

### Task 10: UsageHUD 组件 + ChatView 集成

**Files:**
- Create: `packages/ui/src/components/UsageHUD.tsx`
- Modify: `packages/ui/src/components/ChatView.tsx`

- [ ] **Step 1: 创建 UsageHUD 组件**

```typescript
// packages/ui/src/components/UsageHUD.tsx

interface UsageHUDProps {
  modelName?: string
  usage?: {
    totalTokens: number
    cacheHitRate: number
    contextUsedPercent: number
  }
}

function formatTokens(tokens: number): string {
  if (tokens === 0) return '0'
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1000000).toFixed(2)}M`
}

export function UsageHUD({ modelName, usage }: UsageHUDProps) {
  if (!usage) return null

  const ctxColor = usage.contextUsedPercent > 80 ? 'text-[#E61919]' : 'text-[#EAEAEA]'

  return (
    <div className="flex items-center gap-2 px-4 py-1 border-t border-[#333] text-[10px] uppercase tracking-[0.1em]">
      {modelName && <span className="text-[#EAEAEA]">{modelName}</span>}
      {modelName && <span className="text-[#333]">|</span>}
      <span className="text-[#EAEAEA]">{formatTokens(usage.totalTokens)}</span>
      <span className="text-[#333]">|</span>
      <span className="text-[#666]">Cache:</span>
      <span className="text-[#EAEAEA]">{usage.cacheHitRate}%</span>
      <span className="text-[#333]">|</span>
      <span className="text-[#666]">ctx:</span>
      <span className={ctxColor}>{usage.contextUsedPercent}%</span>
    </div>
  )
}
```

- [ ] **Step 2: 在 ChatView 中渲染 UsageHUD**

在 `PromptInput` 组件之前（即输入框上方）添加 UsageHUD：

```typescript
import { UsageHUD } from './UsageHUD'

// 在 return JSX 中，PromptInput 之前:
<UsageHUD modelName={activeModel?.model.name} usage={currentState.usage} />
<PromptInput ... />
```

需要从 useSession 中获取 usage，或直接从 sessionStates 中读取。

- [ ] **Step 3: 验证编译**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/ui && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 启动应用验证 HUD 显示**

Run: 启动 Electron 应用，发送一条消息，确认 HUD 出现并显示真实数据。

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/UsageHUD.tsx packages/ui/src/components/ChatView.tsx
git commit -m "feat(ui): add UsageHUD component showing token count, cache rate, context usage"
```
