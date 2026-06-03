# Spec 2: Agent 分屏视图 + 子代理管理

## 目标

实现右侧分屏面板展示 Agent 完整对话流，支持实时查看子 agent 的工具调用进度、中止运行中的 agent、以及多 agent 并行时的面板切换。

## 当前状态

- `AgentToolCard` 已实现（Spec 1），显示任务描述和 abort 按钮占位
- `sub-session.ts` 的 `onToolEvent` 回调已存在但 session 创建 agent 时传入 `undefined`
- 子 agent 的工具调用事件不会到达前端
- 没有子 agent 的消息历史追踪

## 架构

### 数据流

```
Sub-session (core)
  → onToolEvent callback (per sub-agent tool call)
  → Session.onToolEvent → SessionManager
  → IPC: 'agent:progress' event
  → Frontend store (agentStates Map)
  → AgentToolCard (inline progress)
  → AgentDetailPanel (right split-view)
```

### 新增 IPC 事件

```typescript
// agent:progress — 子 agent 每次工具调用时触发
interface AgentProgressEvent {
  sessionId: string
  agentToolUseId: string    // 父 agent 的 tool_use_id（用于关联到哪个 AgentToolCard）
  toolName: string          // 子 agent 正在执行的工具名
  toolStatus: 'start' | 'complete' | 'error'
  toolInput?: Record<string, unknown>
  toolResult?: { content: string; isError?: boolean }
  toolCount: number         // 累计工具调用数
}

// agent:message — 子 agent 产生文本消息时触发
interface AgentMessageEvent {
  sessionId: string
  agentToolUseId: string
  text: string              // 子 agent 的文本输出（增量）
}

// agent:complete — 子 agent 完成时触发
interface AgentCompleteEvent {
  sessionId: string
  agentToolUseId: string
  result: string
  toolsUsed: string[]
  turns: number
}
```

### 前端状态

```typescript
// 新增到 session-store.ts 或独立 agent-store.ts
interface AgentState {
  agentToolUseId: string
  prompt: string
  status: 'running' | 'done' | 'error'
  toolEvents: Array<{
    toolName: string
    status: 'start' | 'complete' | 'error'
    input?: Record<string, unknown>
    result?: { content: string; isError?: boolean }
  }>
  textOutput: string
  toolCount: number
  startTime: number
  result?: string
}

interface AgentStore {
  agents: Record<string, AgentState>  // keyed by agentToolUseId
  activeAgentId: string | null        // 当前在右侧面板展示的 agent
  addAgent: (id: string, prompt: string) => void
  updateAgentTool: (id: string, event: AgentProgressEvent) => void
  appendAgentText: (id: string, text: string) => void
  completeAgent: (id: string, result: string) => void
  setActiveAgent: (id: string | null) => void
}
```

## UI 组件

### AgentDetailPanel（右侧分屏面板）

```
┌──────────────────────────────────────────┐
│ ◆ AGENT: "Fix auth middleware"   [ABORT] │
│ Running for 23s | 5 tools                │
├──────────────────────────────────────────┤
│                                          │
│ ● READ src/auth.ts              [DONE]   │
│ ● EDIT src/auth.ts (+3 -1)      [DONE]   │
│ ● BASH npm test                 [DONE]   │
│ ● READ src/middleware.ts        [RUNNING] │
│                                          │
│ ─── Agent Output ───                     │
│ I've fixed the authentication...         │
│                                          │
└──────────────────────────────────────────┘
```

- 固定在右侧，宽度约 40% 的视口
- 头部：agent 任务描述 + abort 按钮 + 运行时间
- 中部：子 agent 的工具调用列表（使用 ToolCardRouter 渲染每个工具）
- 底部：子 agent 的文本输出

### 布局变更

```
┌─────────────────────────────────────────────────────────┐
│ Header                                                   │
├────────────────────────────┬────────────────────────────┤
│                            │                            │
│   Main Chat Area           │   Agent Detail Panel       │
│   (existing ChatView)      │   (new, conditional)       │
│                            │                            │
├────────────────────────────┴────────────────────────────┤
│ Prompt Input                                             │
└─────────────────────────────────────────────────────────┘
```

- 当没有 active agent 时，主聊天区占满宽度
- 当用户点击 AgentToolCard 时，右侧面板滑出
- 面板有关闭按钮

### AgentToolCard 增强

在 Spec 1 的基础上增加：
- 显示最近 3 个子 agent 工具调用（从 agentStore 读取）
- 显示工具计数和运行时间
- 点击卡片打开右侧面板（设置 activeAgentId）
- Abort 按钮实际发送中止信号

## 后端变更

### 1. Sub-session 进度回调

`packages/core/src/sub-session.ts` 的 `SubSessionOptions` 新增：

```typescript
onAgentProgress?: (event: {
  toolName: string
  toolStatus: 'start' | 'complete' | 'error'
  toolInput?: Record<string, unknown>
  toolResult?: { content: string; isError?: boolean }
  toolCount: number
}) => void

onAgentText?: (text: string) => void
```

在 `runSubSession` 的工具执行循环中，每次工具执行前后调用 `onAgentProgress`。
在文本输出时调用 `onAgentText`。

### 2. Agent tool 传递回调

`packages/core/src/tools/agent.ts` 的 `AgentToolDeps` 新增：

```typescript
onAgentProgress?: (agentToolUseId: string, event: AgentProgressEvent) => void
onAgentText?: (agentToolUseId: string, text: string) => void
onAgentComplete?: (agentToolUseId: string, result: SubSessionResult) => void
```

在 `execute` 中将这些回调传给 `runSubSession`。

### 3. Session 注册回调

`packages/core/src/session.ts` 创建 agent tool 时传入实际的回调（而非 `undefined`），回调通过 `SessionEvents` 转发到 session-manager。

### 4. Session-manager IPC 转发

`packages/electron/src/session-manager.ts` 在 events 中新增 agent 相关事件的 IPC 发送。

### 5. Agent 中止

`packages/core/src/tools/agent.ts` 的 `execute` 方法已经接收 `context.signal`（AbortSignal）。需要在前端提供一种方式来中止特定 agent：

- 方案：每个 agent 有自己的 AbortController
- 前端发送 `agent:abort` IPC 事件，带 `agentToolUseId`
- Session-manager 维护一个 `agentAbortControllers` Map
- Agent tool 创建时注册自己的 controller

## 文件结构

```
packages/core/src/sub-session.ts              — 新增 onAgentProgress/onAgentText 回调
packages/core/src/tools/agent.ts              — 传递回调，注册 abort controller
packages/core/src/session.ts                  — 创建 agent tool 时传入回调

packages/electron/src/session-manager.ts      — 转发 agent IPC 事件
packages/electron/src/ipc-channels.ts         — 新增 agent 相关 channel
packages/electron/src/preload.ts              — 暴露 agent IPC 方法

packages/ui/src/stores/agent-store.ts         — Agent 状态管理（Zustand）
packages/ui/src/hooks/useAgentEvents.ts       — 监听 agent IPC 事件
packages/ui/src/components/AgentDetailPanel.tsx — 右侧分屏面板
packages/ui/src/components/tool-cards/AgentToolCard.tsx — 增强（读取 agent store）
packages/ui/src/components/ChatView.tsx       — 布局变更（条件分屏）
```

## 不在此 Spec 范围内

- Agent 之间的消息传递（coordinator 模式）
- 多 agent 并行执行
- Agent 独立对话历史持久化
- Remote agent
