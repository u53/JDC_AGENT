# Spec 12: 工作空间增强（Plan 持久化 + Task 持久化 + 消息排队 + Task UI）

## 概述

增强 JDCAGNET 的工作空间能力，让 plan、task 跨 session 持久化，支持消息排队，并在前端展示 task 进度。

## 1. Plan 持久化

### 1.1 存储

Plan 文件存储在 `{cwd}/.jdcagnet/plans/` 目录（已有）。文件名格式 `{timestamp}-{slug}.md`，由模型自由命名。

### 1.2 自动加载

每次 `sendMessage` 组装 system prompt 时：
1. 扫描 `{cwd}/.jdcagnet/plans/` 目录
2. 过滤掉已完成的 plan（文件开头包含 `<!-- COMPLETED -->`）
3. 按修改时间排序，取最新 1 个 plan 文件
4. 读取内容，注入到 system prompt 作为新 segment：

```
<plan>
Plan file: .jdcagnet/plans/2026-05-15-feature-x.md

{plan content}

If this plan is relevant to the current work and not already complete, continue working on it.
</plan>
```

5. 该 segment 标记为 `cacheable: true`

### 1.3 Plan 完成标记

模型完成 plan 执行后，在文件开头插入 `<!-- COMPLETED -->` 注释。加载时跳过带此标记的文件。

### 1.4 实现位置

在 `packages/core/src/context.ts` 中新增 `loadActivePlan(cwd: string)` 函数，在 `assembleSystemPrompt` 中调用并加入 segments。

## 2. Task 持久化

### 2.1 SQLite Schema

在 `history.db` 新增 `tasks` 表：

```sql
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
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, status)
```

### 2.2 TaskStore 改造

当前 `TaskStore` 是纯内存 Map。改造为：
- 构造函数接收 `ConversationHistory` 实例 + `sessionId`
- 所有 CRUD 操作直接读写 SQLite
- `list()` 返回当前 session 的 tasks
- 自增 ID 改为从 SQLite 查询 max(id) + 1

### 2.3 ConversationHistory 扩展

在 `history.ts` 中添加 task 相关方法：
- `createTask(sessionId, subject, description)` → Task
- `updateTask(id, updates)` → Task
- `deleteTask(id)` → void
- `getTasks(sessionId)` → Task[]
- `getActiveTasks(sessionId)` → Task[]（pending + in_progress）

### 2.4 Session 恢复时加载

`session.loadHistory()` 同时加载 tasks 到 TaskStore。

### 2.5 注入到 Context

未完成的 tasks 注入到 system prompt（动态 segment，不缓存）：

```
<tasks>
Current tasks for this session:
- [in_progress] #1: Implement login form
- [pending] #2: Add validation
</tasks>
```

只注入 pending 和 in_progress 的 tasks。如果没有活跃 tasks 则不注入。

## 3. 消息排队

### 3.1 前端队列

在 session store 中新增：
```typescript
messageQueue: string[]
enqueueMessage: (text: string) => void
dequeueMessage: () => string | undefined
```

### 3.2 发送逻辑改造

`sendMessage` 函数改造：
- `isStreaming === false` → 正常发送
- `isStreaming === true` → push 到 `messageQueue`，显示 toast "消息已排队 (N)"

### 3.3 自动发送

当 `query:finished` 事件到达时：
1. 检查 `messageQueue`
2. 如果非空，shift 出第一条，自动调用 `sendMessage`

### 3.4 输入框行为

Streaming 时输入框始终可用：
- 输入框有内容 + 点击按钮 → 排队发送，按钮显示 `[SEND]`
- 输入框为空 + 点击按钮 → 打断当前响应，按钮显示 `[STOP]`

即：按钮根据输入框是否有内容动态切换功能。

### 3.5 队列指示

输入框上方显示排队状态（当 queue 非空时）：
```
QUEUED — 2 messages waiting
```

## 4. Task UI

### 4.1 位置

输入框上方，可折叠卡片。仅在有 pending/in_progress tasks 时显示。

### 4.2 折叠态

一行摘要：
```
■ TASKS  2 pending · 1 in progress                [▶]
```

### 4.3 展开态

```
■ TASKS  2 pending · 1 in progress                [▼]
─────────────────────────────────────────────────────
● #1 Implement login form                [in_progress]
○ #2 Add validation                         [pending]
```

- `●` 绿色脉冲 = in_progress
- `○` 灰色 = pending
- Completed tasks 默认隐藏

### 4.4 数据获取

- 新增 IPC: `session:get-tasks` → 返回当前 session 的 tasks
- 前端在 `query:complete` 事件后重新拉取 tasks
- 或监听 `query:tool-event`，如果 toolName 是 task_create/task_update 则刷新

### 4.5 交互

- 纯展示，不可编辑（tasks 由模型管理）
- 点击折叠/展开
- 样式：CRT 风格，border-[#333]，text-[10px] uppercase

## 5. 文件变更清单

### 新建文件
- `packages/ui/src/components/TaskPanel.tsx` — Task UI 组件
- `packages/ui/src/components/QueueIndicator.tsx` — 排队指示器

### 修改文件
- `packages/core/src/context.ts` — 新增 loadActivePlan()
- `packages/core/src/history.ts` — 新增 tasks 表 + CRUD 方法
- `packages/core/src/task-store.ts` — 改为 SQLite 持久化
- `packages/core/src/session.ts` — TaskStore 构造改造 + loadHistory 加载 tasks + context 注入
- `packages/core/src/tools/task-create.ts` — 适配新 TaskStore 接口
- `packages/core/src/tools/task-update.ts` — 适配新 TaskStore 接口
- `packages/core/src/tools/task-get.ts` — 适配新 TaskStore 接口
- `packages/core/src/tools/task-list.ts` — 适配新 TaskStore 接口
- `packages/core/src/tools/task-stop.ts` — 适配新 TaskStore 接口
- `packages/core/src/tools/todo-write.ts` — 适配新 TaskStore 接口
- `packages/electron/src/session-manager.ts` — getTasks IPC
- `packages/electron/src/ipc-handlers.ts` — get-tasks handler
- `packages/electron/src/ipc-channels.ts` — 新增 channel
- `packages/ui/src/stores/session-store.ts` — messageQueue 状态
- `packages/ui/src/hooks/useSession.ts` — 排队逻辑 + auto-send
- `packages/ui/src/components/PromptInput.tsx` — 双功能按钮（SEND/STOP）
- `packages/ui/src/components/ChatView.tsx` — 挂载 TaskPanel + QueueIndicator

## 6. 测试策略

- `task-store.test.ts` — SQLite CRUD 测试
- `context.test.ts` — loadActivePlan 测试（有 plan / 无 plan / completed plan）
- 手动测试：创建 plan → 关闭 session → 重新打开 → 验证 plan 自动加载
- 手动测试：streaming 时输入消息 → 验证排队 → 完成后自动发送
- 手动测试：模型创建 tasks → TaskPanel 实时更新
