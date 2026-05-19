# Background Tasks System Design

## Overview

为 JDCAGNET 添加完整的后台任务系统，支持后台 AI Agent 会话、Shell 命令完成通知、前台转后台、以及 UI 管理面板。

**核心价值：** 用户不再被长时间运行的 AI 任务阻塞，可以在 Agent 工作时继续对话。

## Architecture

### 进程模型

单进程 + 状态隔离。后台 Agent 在同一个 Electron 主进程内运行，通过独立的 messages 数组、AbortController、和 tool 执行上下文实现隔离。不同会话（Session）之间天然隔离（独立实例）。

### 通知机制

后台任务完成后，结果以 `<task-notification>` XML 格式注入主对话的 messages 流。AI 自然看到通知并响应。

### 实现分 4 个 Phase

```
Phase 1: Shell 通知        → BackgroundTaskManager 加 onComplete 回调
Phase 2: 后台 Agent        → Agent tool 加 run_in_background 参数
Phase 3: 前台转后台        → 正在跑的子 Agent 可被分离到后台
Phase 4: UI 管理面板       → Inspector Tasks tab 扩展
```

---

## Phase 1: Background Shell Notification

### 目标

后台 shell 命令（`bash` tool 的 `run_in_background: true`）跑完后自动通知 AI，无需轮询 `task_output`。

### 改动

#### `packages/core/src/background-tasks.ts`

扩展 `BackgroundTaskManager`：

```typescript
export type TaskType = 'shell' | 'agent'

export interface BackgroundTask {
  id: string
  type: TaskType
  command?: string       // shell task
  prompt?: string        // agent task
  agentType?: string     // agent task
  pid?: number
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  logFile: string
  startedAt: number
  completedAt?: number
  result?: string        // agent final output
}

export class BackgroundTaskManager {
  private onTaskComplete?: (task: BackgroundTask) => void

  setOnComplete(cb: (task: BackgroundTask) => void): void
  registerAgent(prompt: string, agentType: string): BackgroundTask
  completeAgent(id: string, result: SubSessionResult): void
  failAgent(id: string, error: Error): void
  listAll(): BackgroundTask[]
}
```

#### `packages/core/src/session.ts`

加 `pendingNotifications` 队列和 drain 逻辑：

```typescript
interface TaskNotification {
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
}

class Session {
  private pendingNotifications: TaskNotification[] = []
  private onNotificationReady?: () => void  // 通知 Electron 层触发 AI 响应

  // 在 constructor 中注册回调
  // backgroundTasks.setOnComplete → push to pendingNotifications → call onNotificationReady

  // runLoop 开始时 drain
  private drainNotifications(): Message | null {
    if (this.pendingNotifications.length === 0) return null
    const items = this.pendingNotifications.splice(0)
    const xml = items.map(formatNotificationXml).join('\n')
    return { id: uuid(), role: 'user', content: [{ type: 'text', text: xml }], timestamp: Date.now() }
  }
}
```

#### 通知 XML 格式

```xml
<task-notification>
  <task-id>abc123</task-id>
  <type>shell_complete</type>
  <status>completed</status>
  <command>npm run build</command>
  <exit-code>0</exit-code>
  <output>
Build completed successfully.
dist/index.js  45.2 kB
  </output>
</task-notification>
```

#### Idle 触发机制

当主对话处于 idle 状态（等待用户输入）时，通知到达需要自动触发一轮 AI 响应：

1. `Session` 暴露 `onNotificationReady` 回调
2. `SessionManager`（Electron 层）监听此回调
3. 收到回调后，调用 `session.processNotifications(events)` 触发一轮 runLoop
4. Renderer 收到 IPC 事件，显示 AI 正在响应

---

## Phase 2: Background Agent Sessions

### 目标

AI 可以通过 `Agent` tool 的 `run_in_background: true` 参数派发后台子 Agent。子 Agent 独立运行，完成后通知注入主对话。

### 改动

#### `packages/core/src/tools/agent.ts`

Agent tool inputSchema 加参数：

```typescript
run_in_background: {
  type: 'boolean',
  description: 'Run this agent in the background. Returns immediately with a task_id. You will receive a <task-notification> when it completes.'
}
```

执行逻辑：

```typescript
if (input.run_in_background) {
  const task = backgroundTasks.registerAgent(prompt, agentType)

  // 启动但不 await — fire and forget
  runSubSession(opts)
    .then(result => {
      backgroundTasks.completeAgent(task.id, result)
      // onComplete 回调会把通知推入 pendingNotifications
    })
    .catch(err => {
      backgroundTasks.failAgent(task.id, err)
    })

  deps.onAgentProgress?.(toolUseId, {
    toolName: 'Agent',
    toolStatus: 'start',
    toolInput: { prompt, type: agentType, background: true },
    toolCount: 0,
  })

  return {
    content: `Background agent started.\nTask ID: ${task.id}\nPrompt: ${prompt}\nYou will receive a <task-notification> when it completes.`
  }
}
```

#### Agent 通知格式

```xml
<task-notification>
  <task-id>def456</task-id>
  <type>agent_complete</type>
  <status>completed</status>
  <agent-prompt>Fix the login bug in auth.ts</agent-prompt>
  <result>Fixed null check in validateToken(). Added test in auth.test.ts. All tests pass.</result>
  <turns>5</turns>
  <tools-used>file_read, file_edit, bash</tools-used>
</task-notification>
```

#### UI 联动

后台 Agent 仍然通过 `onAgentProgress` / `onAgentText` / `onAgentComplete` 事件更新 `agent-store`。`AgentDetailPanel` 照常显示实时进度。唯一区别是主对话不被阻塞 — 用户可以继续发消息。

#### 并发控制

- 最多同时运行 3 个后台 Agent（可配置）
- 超出时排队等待
- 每个后台 Agent 有独立的 AbortController，可单独终止

---

## Phase 3: Foreground-to-Background Transition

### 目标

正在运行的子 Agent 可以被用户"丢到后台"继续跑。

### 简化范围

只支持把正在跑的**子 Agent** 转后台。不支持把主对话本身的 streaming 转后台（复杂度过高，收益有限）。

### 交互流程

1. 子 Agent 正在跑 → AgentDetailPanel 显示进度
2. 用户点击 `[BACKGROUND]` 按钮（或按快捷键）
3. Agent tool 的 await 被"释放"，立即返回占位结果
4. 子 Agent 继续在后台跑
5. 完成后通过 `pendingNotifications` 通知

### 实现

在 `agent.ts` 中，Agent tool 的执行使用 `backgroundSignal` Promise：

```typescript
// Agent tool execute:
const backgroundSignal = new Promise<void>(resolve => {
  deps.registerBackgroundTrigger?.(toolUseId, resolve)
})

const raceResult = await Promise.race([
  runSubSession(opts).then(r => ({ type: 'done' as const, result: r })),
  backgroundSignal.then(() => ({ type: 'backgrounded' as const })),
])

if (raceResult.type === 'backgrounded') {
  // Agent 被转入后台 — 注册到 BackgroundTaskManager
  const task = backgroundTasks.registerAgent(prompt, agentType)
  // runSubSession 继续跑（它的 Promise 还在），完成后通知
  return { content: `Agent moved to background. Task ID: ${task.id}\nYou will receive a notification when it completes.` }
}
// 正常完成
return { content: raceResult.result.content }
```

#### IPC

- Renderer 发送 `agent:background` IPC 事件
- SessionManager 调用 `session.backgroundAgent(toolUseId)`
- Session 触发对应的 `backgroundSignal` resolve

---

## Phase 4: UI Management Panel

### 目标

在 Inspector 的 Tasks tab 中完整展示所有后台任务。

### 改动

#### `packages/ui/src/components/Inspector.tsx` — TasksSection 扩展

当前 TasksSection 只显示 AI 的 TodoWrite 任务。扩展为两部分：

1. **Background Tasks** — 后台 shell + agent 任务列表
2. **AI Tasks** — 现有的 TodoWrite 任务

#### Background Tasks 列表项

每个任务显示：
- 类型图标（Shell / Agent）
- 状态指示灯（running=蓝色脉冲, completed=绿色, failed=红色）
- 描述（shell: 命令前 40 字符; agent: prompt 前 40 字符）
- 运行时间
- 操作按钮：[STOP]（运行中）、[VIEW]（查看详情）

#### 详情展开

点击 [VIEW] 时：
- Shell 任务：显示完整命令、exit code、最后 50 行输出
- Agent 任务：跳转到 AgentDetailPanel（已有）

#### 数据流

- Electron 主进程通过 IPC 推送后台任务状态变更
- Renderer 用新的 `background-task-store.ts` 管理状态
- 定期同步（每 2 秒）或事件驱动更新

#### IPC Channels

```typescript
// 新增
'background:list'        // 获取所有后台任务
'background:stop'        // 终止指定任务
'background:output'      // 获取任务输出
'background:state-changed'  // 主进程推送状态变更
```

---

## System Prompt Enhancement

在 `packages/core/src/context.ts` 的 `assembleSystemPrompt` 中加入：

```markdown
## Background Tasks

You can run tasks in the background:

**Background Agents:** Use the Agent tool with `run_in_background: true` to dispatch sub-agents that run independently. You can continue the conversation while they work.

**Background Shell:** Use the bash tool with `run_in_background: true` for long-running commands.

**Notifications:** When a background task completes, you will receive a `<task-notification>` message. Respond naturally — summarize what happened and suggest next steps if needed.

**When to use background:**
- Long-running tasks (builds, large refactors, multi-file changes)
- Independent subtasks that don't block the current conversation
- Parallel work (dispatch multiple agents for different parts)

**When NOT to use background:**
- Tasks where you need the result immediately to continue
- Simple, fast operations (< 30 seconds)

You can check running tasks with `task_output` tool, or wait for the notification.
```

---

## Phase 实现顺序

| Phase | 内容 | 依赖 |
|-------|------|------|
| 1 | Shell 通知 + pendingNotifications + idle 触发 | 无 |
| 2 | 后台 Agent + run_in_background + 通知注入 | Phase 1 |
| 3 | 前台转后台 + backgroundSignal | Phase 2 |
| 4 | UI 管理面板 + background-task-store | Phase 1-2 |

Phase 1 和 Phase 4 可以并行开发（UI 可以先用 mock 数据）。

---

## 不做的事情

- **多进程隔离** — 单进程足够，不同会话已天然隔离
- **Cron 调度** — 不在本次范围，未来可加
- **`/batch` 并行分解** — 不在本次范围
- **远程 Agent** — 不在本次范围
- **主对话本身转后台** — 复杂度过高，只支持子 Agent 转后台
