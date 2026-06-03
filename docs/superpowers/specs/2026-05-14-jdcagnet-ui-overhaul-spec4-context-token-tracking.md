# Spec 4: 上下文管理 + Token/Cost 追踪

## 目标

在 JDCAGNET 中实现会话级别的 token 使用追踪和上下文管理，参考 `~/.claude/scripts/omc-hud.js` 的数据模型，在 UI 中实时展示上下文使用情况。

## 参考数据模型

来自 omc-hud.js，目标对齐的展示格式：

```
Opus | 42.0k | Cache: 50.0% | ctx:21%
```

核心数据字段：
- `total_input_tokens` / `total_output_tokens` — 累计 token
- `cache_creation_input_tokens` / `cache_read_input_tokens` — 缓存指标
- `used_percentage` — 上下文窗口使用百分比

**不包含费用计算**（用户的代理服务不按标准定价）。

## 架构

```
Provider (stream)
  → 提取真实 usage (message_end chunk)
    → Session.UsageTracker 累计
      → IPC event: query:usage
        → UI session-store → UsageHUD 渲染
```

## 1. StreamChunk.usage 扩展

```typescript
// types.ts
interface StreamChunk {
  // ...existing
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
}
```

## 2. Provider 层：提取真实 Usage

### Anthropic

SDK stream 的 `message` 事件（或 `message_stop`）包含完整 usage：

```typescript
// message event 中:
// response.usage.input_tokens
// response.usage.output_tokens
// response.usage.cache_creation_input_tokens
// response.usage.cache_read_input_tokens
```

当前代码在 `message_stop` 时 yield `{ inputTokens: 0, outputTokens: 0 }` — 需要改为从 stream 的 finalMessage 中提取真实值。

### OpenAI Chat

completion chunk 的最后一个 chunk 带 `usage` 字段（需要在请求中设置 `stream_options: { include_usage: true }`）：

```typescript
// chunk.usage.prompt_tokens
// chunk.usage.completion_tokens
```

### OpenAI Responses

response stream 的 `response.completed` 事件包含 usage：

```typescript
// response.usage.input_tokens
// response.usage.output_tokens
```

## 3. UsageTracker（packages/core）

新文件 `packages/core/src/usage-tracker.ts`：

```typescript
export interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number        // input + output
  cacheHitRate: number       // cacheRead / (input + cacheCreation + cacheRead)
  contextUsedPercent: number // 基于最近一次 inputTokens / contextWindow
  turnCount: number
}

export class UsageTracker {
  private contextWindow: number
  private cumulative = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
  private turnCount = 0
  private lastInputTokens = 0

  constructor(contextWindow: number)

  addTurn(usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number }): void

  getSnapshot(): UsageSnapshot

  reset(): void
}
```

`contextUsedPercent` 计算：用最近一次请求的 `inputTokens` 除以 `contextWindow`（因为 inputTokens 就是当前上下文实际占用）。

## 4. Session 集成

`Session` 类持有 `UsageTracker` 实例。在 `runLoop` 中，当收到 `message_end` chunk 且带 usage 时：

1. 调用 `usageTracker.addTurn(usage)`
2. 通过 `events.onUsage?.(usageTracker.getSnapshot())` 推送到上层

新增 SessionEvents 字段：

```typescript
interface SessionEvents {
  // ...existing
  onUsage?: (snapshot: UsageSnapshot) => void
}
```

## 5. IPC 层

`session-manager.ts` 在 events 中添加 onUsage 回调，通过 `window.webContents.send('query:usage', { sessionId, usage })` 推送。

## 6. UI 层

### session-store 扩展

```typescript
interface SessionStreamState {
  // ...existing
  usage?: UsageSnapshot
}
```

新增 `updateUsage(sessionId, usage)` 方法。

### useSession.ts

监听 `query:usage` IPC 事件，调用 `store.updateUsage(sessionId, usage)`。

### UsageHUD 组件

位置：PromptInput 上方，作为一行紧凑状态栏。

布局：
```
Opus | 42.0k | Cache: 50% | ctx:21%
```

样式：
- 高度约 24px，`text-[10px] uppercase tracking-[0.1em]`
- 背景 `bg-[#0A0A0A]`，边框 `border-t border-[#333]`
- 数值用 `text-[#EAEAEA]`，标签用 `text-[#666]`
- ctx > 80% 时数值变红色警示

格式化规则（同 omc-hud.js）：
- tokens < 1000 → 原值
- tokens < 1M → `12.3k`
- tokens >= 1M → `1.23M`

## 7. Micro-Compaction

在 `shouldCompact()` 之前增加一层轻量压缩：

**触发条件**：contextUsedPercent > 60%

**策略**：
- 遍历消息（排除最近 10 条）
- 对 `tool_result` 类型的 content block：
  - 如果 content 长度 > 500 字符且 `is_error` 不为 true
  - 截断为前 200 字符 + `\n[...truncated, ${removed} chars]`
- 不改变消息结构，只缩减内容体积

**时机**：在 `runLoop` 开头，`shouldCompact()` 检查之前执行。

```typescript
private microCompact(): boolean {
  // returns true if any truncation happened
}
```

## 8. ModelConfig 扩展

添加 `contextWindow` 字段表示模型的上下文窗口大小：

```typescript
interface ModelConfig {
  // ...existing
  contextWindow?: number  // e.g. 200000 for claude-opus-4
}
```

在 model-store 的模型配置中已有 `contextWindow` 字段，在 `session-manager.ts` 创建 session 时传入。

## 文件清单

**新建：**
- `packages/core/src/usage-tracker.ts`
- `packages/ui/src/components/UsageHUD.tsx`

**修改：**
- `packages/core/src/types.ts` — StreamChunk.usage 扩展 + ModelConfig.contextWindow
- `packages/core/src/providers/anthropic.ts` — 提取真实 usage
- `packages/core/src/providers/openai-chat.ts` — 提取真实 usage
- `packages/core/src/providers/openai-responses.ts` — 提取真实 usage
- `packages/core/src/session.ts` — 集成 UsageTracker + micro-compaction + onUsage 事件
- `packages/electron/src/session-manager.ts` — 转发 query:usage 事件
- `packages/ui/src/stores/session-store.ts` — 添加 usage 状态
- `packages/ui/src/hooks/useSession.ts` — 监听 usage 事件
- `packages/ui/src/components/ChatView.tsx` — 渲染 UsageHUD

## 非目标

- 费用计算（用户使用代理服务，不按标准定价）
- 动态 prompt 分段构建（Spec 9）
- 模型上下文窗口自动检测（使用配置值）
