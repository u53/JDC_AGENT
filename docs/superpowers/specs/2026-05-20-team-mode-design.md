# Team Mode Design Spec

## Date: 2026-05-20

## Summary

Team Mode 是 JDCAGNET 的多 Agent 协作运行时。由项目经理 PM 统一指挥最多 10 个 worker subagent，支持自动或手动组建团队，通过 task graph、mailbox、shared context 和 event log 协调成员工作。主会话和用户可以随时查询、催促、重定向或要求收尾。PM 负责吸收干预、管理成员通信、控制风险，并最终汇总交付。

## Goals

1. 支持任意类型任务的多 agent 协作（调研、实现、审计、测试等）
2. PM 中心化指挥，成员不自由 mesh 通信
3. 最多 10 个 worker，按风险分类控制并发
4. 主会话/用户可随时干预团队（催促、收尾、重定向、状态查询）
5. 实时可观测（事件流、成员状态、任务进度）
6. 非中断式 mailbox 通信，turn boundary 生效
7. 写操作严格受控，避免多 writer 冲突

## Non-Goals

- 成员完全自由 mesh 通信（hub-and-spoke 优先）
- 递归创建 Team/Agent（禁止）
- 强制中断成员当前执行（cooperative only）
- 跨 session 持久化团队记忆（后续考虑）

---

## Architecture Overview

```
Main Session / User
        │
        │ background_send / background_status / background_events
        ▼
┌────────────────────────────────────────────────┐
│                  TeamRuntime                    │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │         ProjectManager Agent              │  │
│  │  - plan team                             │  │
│  │  - create/assign/cancel tasks            │  │
│  │  - monitor members                       │  │
│  │  - receive & execute interventions       │  │
│  │  - coordinate member communication       │  │
│  │  - synthesize final result               │  │
│  └──────────────────────────────────────────┘  │
│                    │                           │
│                    ▼                           │
│  ┌──────────────────────────────────────────┐  │
│  │            Team Members (≤10)             │  │
│  │  - execute assigned tasks                │  │
│  │  - report findings to PM                 │  │
│  │  - receive PM messages at turn boundary  │  │
│  └──────────────────────────────────────────┘  │
│                    │                           │
│                    ▼                           │
│  Shared Context / Task Graph / Event Log       │
└────────────────────────────────────────────────┘
```

Team 是 background task 的第三种类型：

```ts
type TaskType = 'shell' | 'agent' | 'team'
```

---

## Data Model

### TeamRuntime

```ts
interface TeamRuntime {
  id: string
  objective: string
  status: 'planning' | 'running' | 'waiting' | 'synthesizing' | 'completed' | 'failed' | 'stopped'
  maxWorkers: number // hard cap 10
  manager: TeamManagerRuntime
  members: TeamMemberRuntime[]
  tasks: TeamTask[]
  sharedContext: TeamSharedContext
  mailbox: TeamMailbox
  events: RingBuffer<TeamEvent>
  constraints: string[]
  createdAt: number
  updatedAt: number
  completedAt?: number
}
```

### TeamManagerRuntime

```ts
interface TeamManagerRuntime {
  id: string
  role: 'project-manager'
  name: string
  status: 'planning' | 'assigning' | 'waiting_for_members' | 'reviewing_results' | 'handling_intervention' | 'synthesizing' | 'completed' | 'failed'
  modelId?: string
  mailbox: MailboxMessage[]
  currentDecision?: string
  lastActivityAt: number
}
```

### TeamMemberRuntime

```ts
interface TeamMemberRuntime {
  id: string
  name: string
  role: string
  agentType: string // maps to existing: explore, plan, general, etc.
  modelId?: string
  status: 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'stopped'
  capabilities: TeamCapability[]
  currentTaskId?: string
  mailbox: MailboxMessage[]
  lastActivityAt: number
  toolCount: number
  result?: TeamTaskResult
}
```

### TeamTask

```ts
interface TeamTask {
  id: string
  title: string
  description: string
  status: 'todo' | 'assigned' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled'
  assigneeId?: string
  dependsOn?: string[]
  priority: 'low' | 'normal' | 'high' | 'urgent'
  riskLevel: 'low' | 'medium' | 'high'
  createdBy: 'manager' | 'user' | 'main_session' | 'system'
  createdAt: number
  updatedAt: number
  result?: TeamTaskResult
}
```

### TeamTaskResult

```ts
interface TeamTaskResult {
  summary: string
  findings: TeamFinding[]
  artifacts?: TeamArtifact[]
  blockers?: string[]
  suggestedFollowUps?: string[]
}
```

### TeamFinding

```ts
interface TeamFinding {
  id: string
  memberId: string
  taskId?: string
  summary: string
  details?: string
  evidence?: Array<{ file?: string; line?: number; symbol?: string; note: string }>
  confidence: 'low' | 'medium' | 'high'
  createdAt: number
}
```

### TeamSharedContext

```ts
interface TeamSharedContext {
  objective: string
  constraints: string[]
  findings: TeamFinding[]
  decisions: TeamDecision[]
  artifacts: TeamArtifact[]
  openQuestions: TeamQuestion[]
  risks: TeamRisk[]
}

interface TeamDecision {
  id: string
  summary: string
  madeBy: 'manager' | 'user'
  reason: string
  createdAt: number
}

interface TeamArtifact {
  id: string
  type: 'file' | 'plan' | 'report' | 'diff' | 'other'
  path?: string
  content?: string
  createdBy: string
  createdAt: number
}

interface TeamQuestion {
  id: string
  askedBy: string
  question: string
  answeredBy?: string
  answer?: string
  status: 'open' | 'answered'
  createdAt: number
}

interface TeamRisk {
  id: string
  description: string
  severity: 'low' | 'medium' | 'high'
  identifiedBy: string
  mitigation?: string
  createdAt: number
}

type TeamCapability = 'read' | 'write' | 'shell' | 'web' | 'lsp'
```

### TeamMailbox & MailboxMessage

```ts
interface TeamMailbox {
  messages: TeamMessage[]
  push(msg: TeamMessage): void
  drain(): TeamMessage[]
  peek(): TeamMessage[]
}

interface MailboxMessage {
  id: string
  from: string
  content: string
  intent?: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  createdAt: number
}
```

### TeamMessage

```ts
interface TeamMessage {
  id: string
  from: 'user' | 'main_session' | 'manager' | 'member' | 'system'
  fromMemberId?: string
  to: 'team' | 'manager' | `member:${string}`
  intent: TeamMessageIntent
  content: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  createdAt: number
  deliveredAt?: number
  readAt?: number
}

type TeamMessageIntent =
  | 'message'
  | 'hurry'
  | 'wrap_up'
  | 'request_status'
  | 'reprioritize'
  | 'narrow_scope'
  | 'expand_scope'
  | 'block'
  | 'unblock'
  | 'question'
  | 'answer'
  | 'finding'
  | 'handoff'
```

### TeamEvent

```ts
type TeamEvent =
  | { type: 'team_started'; teamId: string; timestamp: number }
  | { type: 'manager_decision'; text: string; timestamp: number }
  | { type: 'member_created'; memberId: string; role: string; timestamp: number }
  | { type: 'task_created'; taskId: string; title: string; timestamp: number }
  | { type: 'task_assigned'; taskId: string; memberId: string; timestamp: number }
  | { type: 'task_completed'; taskId: string; memberId: string; timestamp: number }
  | { type: 'task_cancelled'; taskId: string; reason: string; timestamp: number }
  | { type: 'member_progress'; memberId: string; text: string; timestamp: number }
  | { type: 'tool_start'; memberId: string; toolName: string; timestamp: number }
  | { type: 'tool_complete'; memberId: string; toolName: string; timestamp: number }
  | { type: 'finding_added'; memberId: string; findingId: string; summary: string; timestamp: number }
  | { type: 'message_sent'; from: string; to: string; intent: string; timestamp: number }
  | { type: 'intervention_received'; from: 'user' | 'main_session'; intent: string; timestamp: number }
  | { type: 'team_synthesizing'; timestamp: number }
  | { type: 'team_completed'; summary: string; timestamp: number }
  | { type: 'team_failed'; error: string; timestamp: number }
```

---

## Tool Design

### Team Tool

新增一等公民工具 `Team`：

```ts
Team({
  objective: string,
  members?: TeamMemberSpec[],
  maxWorkers?: number,
  modelId?: string,
  run_in_background?: boolean
})
```

参数：

```ts
interface TeamMemberSpec {
  role: string
  count?: number
  agentType?: string
  modelId?: string
}
```

规则：
- `maxWorkers` 硬上限 10，默认由 PM 自动决定（通常 3-6）
- `run_in_background` 默认 true（Team 天然是后台任务）
- 如果用户指定 `members`，PM 按指定创建；否则 PM 自动规划
- PM 不计入 worker 数量，但计入模型调用预算

返回：

```txt
Team started.
Team ID: team_8f31
Objective: ...
Members:
- PM (project-manager)
- Core Engineer (explore)
- UI Engineer (frontend-designer)
- ...

Use background_status/background_events/background_send to interact.
```

### background_send

统一消息发送工具（适用于 shell/agent/team）：

```ts
background_send({
  task_id: string,
  target?: 'team' | 'manager' | `member:${string}`,
  intent?: TeamMessageIntent,
  message: string,
  priority?: 'low' | 'normal' | 'high' | 'urgent'
})
```

对 team 类型 task：
- 默认 target 是 `manager`
- `target: 'team'` 广播给 PM 和所有成员
- `target: 'member:xxx'` 发给具体成员，PM 收到 copy

对 agent 类型 task：
- 消息进入 agent mailbox，下一 turn 生效

对 shell 类型 task：
- 不支持消息（shell 不能接收指令）

### background_status

```ts
background_status(task_id: string)
```

Team 返回：

```json
{
  "type": "team",
  "status": "running",
  "objective": "...",
  "elapsed": 245,
  "manager": {
    "status": "waiting_for_members",
    "currentDecision": "Waiting for IPC Engineer result"
  },
  "members": [
    { "id": "core-eng", "role": "Core Engineer", "status": "completed", "currentTask": null, "lastActivity": "12s ago" },
    { "id": "ui-eng", "role": "UI Engineer", "status": "running", "currentTask": "Design event panel", "lastActivity": "3s ago" }
  ],
  "tasks": { "total": 7, "completed": 3, "running": 2, "blocked": 1, "queued": 1 }
}
```

### background_events

```ts
background_events(task_id: string, { tail?: number })
```

返回结构化事件列表。

---

## Main Session Intervention

主会话/用户可以随时干预团队。这是 Team Mode 的核心能力。

### 干预类型

| 用户说 | intent | 行为 |
|--------|--------|------|
| 催一下他们 | `hurry` | PM 要求活跃成员缩短路径、给状态、少发散 |
| 让他们收尾 | `wrap_up` | PM 不再启动新任务，要求成员给当前结论，汇总 |
| 让 PM 报进度 | `request_status` | PM 收集成员状态并汇报 |
| 让安全审计重点看权限 | `reprioritize` | PM 转发给目标成员，更新约束 |
| 缩小范围，只看 core | `narrow_scope` | PM 取消无关任务，约束成员范围 |
| 扩大范围，也看测试 | `expand_scope` | PM 追加任务或成员 |
| 停止 | abort | TeamRuntime 停止所有成员，PM 汇总已有结果 |

### 干预流程

```
主会话/用户发干预
  ↓
Team mailbox
  ↓
PM 下一个调度 tick 读取
  ↓
PM 解释并执行：
  - 更新 constraints
  - 给成员发消息
  - 取消/降级任务
  - 请求成员状态
  - 开始汇总
  ↓
成员在各自下一 turn boundary 读取 mailbox
  ↓
调整策略
```

### 干预不是中断

- 不打断当前模型 stream
- 不强制终止当前 tool call
- 不破坏 message ordering
- 只在 turn boundary / PM tick 生效
- 唯一例外：`abort` 会触发 AbortController

---

## Member Communication

### 成员到 PM

成员可以通过受限工具向 PM 发消息：

```ts
notify_manager({
  type: 'finding' | 'question' | 'blocker' | 'handoff' | 'status',
  content: string,
  targetRole?: string
})
```

例如：
```
UI Engineer -> PM: I need the IPC event schema from IPC Engineer.
```

### PM 到成员

PM 通过 TeamRuntime 给成员发消息：

```ts
send_member_message(memberId, {
  intent: 'message' | 'hurry' | 'wrap_up' | 'reprioritize' | 'request_status',
  content: string
})
```

### 成员到成员

允许，但必须经 PM 或抄送 PM。

默认路径：`member -> PM -> member`

如果实现直接成员消息，PM 必须收到 copy，event log 必须记录。不允许不可见私聊。

---

## PM Scheduling Loop

TeamRuntime 的核心是 PM 调度循环：

```
start team
  ↓
PM analyzes objective
  ↓
PM creates team plan (members + tasks + dependencies)
  ↓
TeamRuntime creates members (≤10)
  ↓
PM assigns runnable tasks (respecting dependencies)
  ↓
members execute concurrently
  ↓
events/results/messages enter shared context
  ↓
PM tick (triggered by: member complete, message received, timeout):
  - drain mailbox
  - inspect task/member status
  - handle user/main intervention
  - handle member blockers/questions
  - assign follow-up tasks
  - cancel/deprioritize tasks
  - request status if needed
  - synthesize if all done or wrap_up requested
  ↓
loop until: all tasks done OR wrap_up OR abort
  ↓
PM final synthesis
  ↓
team completed
```

PM tick 触发条件：
- 成员完成任务
- 成员发送 blocker/question
- 用户/主会话发消息
- 超时心跳（如 30s 无活动）
- 所有 runnable tasks 完成

---

## Member Execution Model

成员使用扩展版 `runSubSession()`：

### Mailbox injection

在每个 turn 开始前：

```ts
const incoming = mailbox.drain()
if (incoming.length > 0) {
  messages.push({
    role: 'user',
    content: formatExternalMessages(incoming)
  })
}
```

### Member prompt structure

```
[system] role prompt + team collaboration rules
[user] task description from PM
[user] (injected) external messages from PM/user
... normal tool loop ...
[assistant] final result
```

### Member completion

成员完成后提交结构化结果：

```ts
TeamTaskResult {
  summary: string
  findings: TeamFinding[]
  artifacts?: TeamArtifact[]
  blockers?: string[]
  suggestedFollowUps?: string[]
}
```

结果进入 shared context，由 PM 处理。

---

## Concurrency Policy

```ts
interface TeamConcurrencyPolicy {
  maxWorkersPerTeam: 10        // hard cap
  maxActiveWorkers: 8          // simultaneously running
  maxReadOnlyWorkers: 8        // explore, plan, security-auditor
  maxWriteWorkers: 1           // general, refactor, frontend-designer doing writes
  maxShellWorkers: 2           // agents with bash access
}
```

规则：
- 可以创建最多 10 个 worker
- 不一定 10 个同时活跃（PM 可以排队）
- read-only agent 可以高并发
- writer 严格限制为 1
- shell-capable agent 限制为 2
- PM 不占 worker slot，但消耗模型请求

### Write Safety

- 同一时间最多一个 write-capable member 执行写操作
- PM 必须明确指定 writer
- 如果多个成员都提出修改建议，由 PM 合并成单一实施任务
- 高风险操作仍走现有 permission system
- destructive 操作必须用户确认

写任务流程：
```
Explorer 查明问题
  ↓
PM 形成修改策略
  ↓
Implementer 执行修改（唯一 writer）
  ↓
Reviewer 审查 diff（read-only）
  ↓
Test Engineer 验证（shell-capable）
  ↓
PM 汇总
```

---

## Auto-Trigger Rules

### 显式触发（必须创建 Team）

用户使用以下表达：
- 创建一个团队 / 开个 team
- 找几个人一起 / 让多个 agent 干
- 组一个团队 / 找 PM 带人做

### 自动触发（主 AI 判断）

满足以下条件时可自动使用 Team：
- 任务涉及多个子系统（core + electron + ui）
- 需要 3 个以上独立调查方向
- 用户要求"深度分析 / 全面评估 / 多角度"
- 任务包含设计、实现、测试、审查多个阶段
- 单个 agent 预计会超过大量工具调用

自动触发时必须简短说明：
```
这个任务适合 Team Mode。我会创建一个 5 人团队，由 PM 协调 core、UI、IPC、review 和 testing 方向。
```

### 不应自动触发

- 单文件小改动
- 简单问答
- 用户明确说"你自己看"
- 高风险写操作但用户没有授权
- 需要严格顺序执行

---

## Prompt Design

### PM System Prompt

```
You are the project manager of an AI agent team.

Your responsibilities:
- Understand the user's objective.
- Build an efficient team with at most 10 workers.
- Break the objective into tasks with dependencies.
- Assign tasks to suitable members.
- Track progress, blockers, and findings.
- Handle messages from the user or main session.
- If asked to hurry: reduce optional exploration, request concise status from active members.
- If asked to wrap up: stop starting new tasks, synthesize from available evidence.
- Coordinate member-to-member communication. Keep all communication visible.
- Avoid multiple writers. Prefer one implementer and separate reviewers.
- Produce a final result that is concise, evidence-based, and honest about unverified parts.

You do not do all work yourself. You coordinate the team.
You cannot create another Team or spawn sub-agents beyond your team members.
```

### Member System Prompt

```
You are a member of an AI team.

Your responsibilities:
- Complete the assigned task efficiently.
- Stay within your role and capabilities.
- Report findings with evidence (file paths, line numbers, code snippets).
- Ask the project manager if blocked or need clarification.
- Check incoming manager messages at turn boundaries.
- If asked to hurry: stop optional exploration, report current findings.
- If asked to wrap up: return a concise result with confidence level and missing verification.
- Do not spawn sub-agents or teams.
- Do not communicate invisibly with other members.
- Submit structured results when done.
```

---

## UI Design

### Background Task List

```
Background Tasks

● Team: Design Team Mode
  status: running | members: 5 active / 6 total
  manager: waiting for IPC Engineer
  [Open] [Message] [Stop]

● Agent: Explore core background manager
  status: running
  [Open] [Message] [Stop]

● Shell: npm test
  status: running
  [Open] [Stop]
```

### Team Detail Panel

```
Team: Design Team Mode
Objective: Design a PM-led multi-agent team runtime

Status: Running | Elapsed: 4m 12s
Members: 6 | Tasks: 3 done / 2 running / 1 blocked / 1 queued

Manager
  status: waiting_for_members
  current: Waiting for IPC Engineer before synthesis

Members
  ✓ Core Runtime Engineer — completed: inspected background task manager
  ● UI Engineer — current: designing team detail panel
  ● IPC Engineer — current: checking preload/ipc handlers
  ! Test Engineer — blocked: waiting for implementation boundaries
  ○ Reviewer — queued

Tasks
  ✓ Inspect background runtime
  ● Design message bus
  ● Define UI event stream
  ! Define test strategy (blocked by: Design message bus)
  ○ Synthesize final design

Events
  [PM] Created 7 tasks
  [PM] Assigned inspect background runtime to Core Runtime Engineer
  [Core Runtime Engineer] Found maxConcurrentAgents = 3
  [UI Engineer] Requested IPC event schema
  [main_session] Intervention: hurry
  [PM] Asked active members for concise status

Message
  [ _________________________________ ] [Send]

Quick Actions
  [催一下] [阶段总结] [收尾] [缩小范围] [停止]
```

### Member Detail View

点击任意成员可以展开/进入该成员的实时执行详情。

每个成员的详情应该和现有 `AgentDetailPanel` 体验一致，但嵌入在 Team 面板内。

```
┌─────────────────────────────────────────────────────────┐
│ Team: Design Team Mode                                  │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Members (click to expand)                           │ │
│ │                                                     │ │
│ │ ✓ Core Runtime Engineer                    [收起]   │ │
│ │   task: Inspect background runtime                  │ │
│ │   status: completed                                 │ │
│ │   tools: 9 | elapsed: 1m 12s                        │ │
│ │   result: Found maxConcurrentAgents = 3, ...        │ │
│ │                                                     │ │
│ │ ▼ UI Engineer                              [展开]   │ │
│ │   task: Design team detail panel                    │ │
│ │   status: running | tools: 4 | elapsed: 2m 03s     │ │
│ │                                                     │ │
│ │   Tool Timeline:                                    │ │
│ │   ✓ file_read AgentDetailPanel.tsx                  │ │
│ │   ✓ grep "background" packages/ui/src              │ │
│ │   ✓ file_read background-task-store.ts             │ │
│ │   ● file_read useAgentEvents.ts                    │ │
│ │                                                     │ │
│ │   Latest Text Output:                               │ │
│ │   "I found the existing agent detail panel uses..." │ │
│ │                                                     │ │
│ │   [Message this member] [催一下] [Abort]            │ │
│ │                                                     │ │
│ │ ● IPC Engineer                             [展开]   │ │
│ │   task: Check preload/ipc handlers                  │ │
│ │   status: running | tools: 6 | elapsed: 1m 45s     │ │
│ │   current tool: grep "background:" ipc-handlers.ts  │ │
│ │                                                     │ │
│ │ ! Test Engineer                            [展开]   │ │
│ │   status: blocked                                   │ │
│ │   reason: waiting for implementation boundaries     │ │
│ │                                                     │ │
│ │ ○ Reviewer                                          │ │
│ │   status: queued                                    │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Member Detail — Expanded View

当用户点击展开某个成员时，显示完整的实时执行内容：

```
UI Engineer
  Role: Frontend Designer
  Agent Type: frontend-designer
  Model: claude-opus-4-7
  Task: Design team detail panel
  Status: running
  Elapsed: 2m 03s
  Tools used: 4

  ┌─ Tool Timeline ──────────────────────────────────────┐
  │                                                      │
  │ [0:02] ✓ file_read                                   │
  │        path: packages/ui/src/components/             │
  │              AgentDetailPanel.tsx                     │
  │        result: 112 lines read                        │
  │                                                      │
  │ [0:15] ✓ grep                                        │
  │        pattern: "background"                         │
  │        path: packages/ui/src                         │
  │        result: 3 matches                             │
  │                                                      │
  │ [0:28] ✓ file_read                                   │
  │        path: packages/ui/src/stores/                 │
  │              background-task-store.ts                 │
  │        result: 35 lines read                         │
  │                                                      │
  │ [1:45] ● file_read                                   │
  │        path: packages/ui/src/hooks/                  │
  │              useAgentEvents.ts                        │
  │        status: executing...                          │
  │                                                      │
  └──────────────────────────────────────────────────────┘

  ┌─ Text Output ────────────────────────────────────────┐
  │ I found the existing agent detail panel. It uses     │
  │ zustand store with tool events and text output.      │
  │ The team panel should follow the same pattern but    │
  │ add member-level grouping and task assignment view.  │
  └──────────────────────────────────────────────────────┘

  ┌─ Messages ───────────────────────────────────────────┐
  │ [PM -> UI Engineer] Focus on event stream display    │
  │ [UI Engineer -> PM] Need IPC event schema first      │
  └──────────────────────────────────────────────────────┘

  Actions:
  [ Message this member...                    ] [Send]
  [催一下] [Abort]
```

### UI Data Flow

每个成员的实时数据通过以下链路到达 UI：

```
Member runSubSession
  ↓ onAgentProgress callback
  ↓ onAgentText callback
TeamRuntime
  ↓ emit TeamEvent
  ↓ update member status
BackgroundTaskManager
  ↓ IPC push
Electron main process
  ↓ webContents.send('team:member-progress', { teamId, memberId, event })
  ↓ webContents.send('team:member-text', { teamId, memberId, text })
UI renderer
  ↓ team-store update
  ↓ TeamDetailPanel re-render
  ↓ Member detail view update
```

### IPC Events for Member Observability

```ts
// Real-time member events pushed to UI
'team:member-progress': {
  teamId: string
  memberId: string
  toolName: string
  toolStatus: 'start' | 'complete' | 'error'
  toolInput?: Record<string, unknown>
  toolResult?: { content: string; isError?: boolean }
  toolCount: number
}

'team:member-text': {
  teamId: string
  memberId: string
  text: string
}

'team:member-status': {
  teamId: string
  memberId: string
  status: MemberStatus
  currentTaskId?: string
}

'team:event': {
  teamId: string
  event: TeamEvent
}

'team:state-changed': {
  teamId: string
}
```

### UI Store: team-store.ts

```ts
interface TeamStoreState {
  teams: Record<string, TeamUIState>
  activeTeamId: string | null
  expandedMemberId: string | null

  // Actions
  setTeams: (teams: TeamUIState[]) => void
  updateMemberProgress: (teamId: string, memberId: string, event: MemberToolEvent) => void
  appendMemberText: (teamId: string, memberId: string, text: string) => void
  updateMemberStatus: (teamId: string, memberId: string, status: MemberStatus) => void
  addTeamEvent: (teamId: string, event: TeamEvent) => void
  setActiveTeam: (teamId: string | null) => void
  setExpandedMember: (memberId: string | null) => void
}

interface TeamUIState {
  id: string
  objective: string
  status: string
  manager: { status: string; currentDecision?: string }
  members: TeamMemberUIState[]
  tasks: TeamTaskUIState[]
  events: TeamEvent[]
}

interface TeamMemberUIState {
  id: string
  name: string
  role: string
  status: string
  currentTask?: string
  toolEvents: MemberToolEvent[]
  textOutput: string
  toolCount: number
  elapsed: number
  messages: TeamMessage[]
}
```

### Interaction Patterns

| 用户操作 | 效果 |
|----------|------|
| 点击 Team 列表项 | 打开 Team Detail Panel |
| 点击成员名 | 展开该成员实时详情 |
| 点击成员的 tool event | 展开 tool input/output |
| 在成员详情输入消息 | 发送给该成员 mailbox |
| 点击成员 [催一下] | 发送 hurry intent 给该成员 |
| 点击成员 [Abort] | abort 该成员的 AbortController |
| 在 Team 底部输入消息 | 发送给 PM |
| 点击 Team [催一下] | 发送 hurry intent 给 PM |
| 点击 Team [收尾] | 发送 wrap_up intent 给 PM |
| 点击 Team [停止] | abort 整个 team |

### Member Status Indicators

```
✓  completed (green)
●  running (blue, animated pulse)
!  blocked (yellow/orange)
○  queued (gray)
✕  failed (red)
⊘  stopped (gray, strikethrough)
```

### Real-time Updates

- 成员 tool timeline 实时追加新条目
- 成员 text output 实时追加
- 成员 status 变化时自动更新图标和标签
- Team events 列表实时追加
- Task 状态变化时自动更新
- 不需要用户手动刷新

---

## Integration with Existing Architecture

### Changes to BackgroundTaskManager

```ts
// Extend TaskType
type TaskType = 'shell' | 'agent' | 'team'

// Add to BackgroundTaskManager:
registerTeam(objective: string, members: TeamMemberSpec[]): BackgroundTask
completeTeam(id: string, result: TeamResult): void
failTeam(id: string, error: string): void
sendMessage(id: string, message: TeamMessage): void
getEvents(id: string, tail?: number): TeamEvent[]
getTeamStatus(id: string): TeamStatus
```

### Changes to runSubSession

Add mailbox support:

```ts
interface SubSessionOptions {
  // ... existing fields ...
  mailbox?: { drain(): MailboxMessage[] }
}
```

In the turn loop, before calling the model:

```ts
const incoming = opts.mailbox?.drain() ?? []
if (incoming.length > 0) {
  messages.push({
    role: 'user',
    content: [{ type: 'text', text: formatExternalMessages(incoming) }]
  })
}
```

### New IPC Channels

```ts
// Add to ipc-channels.ts
TEAM_CREATE: 'team:create',
TEAM_STATUS: 'team:status',
TEAM_EVENTS: 'team:events',
TEAM_SEND: 'team:send',
TEAM_STOP: 'team:stop',
BACKGROUND_SEND: 'background:send',
BACKGROUND_STATUS: 'background:status',
BACKGROUND_EVENTS: 'background:events',
```

### New Files

```
packages/core/src/
  team/
    team-runtime.ts        — TeamRuntime class
    team-manager.ts        — PM agent loop
    team-member.ts         — Member lifecycle
    team-planner.ts        — Auto team planning
    team-types.ts          — All team interfaces
    team-concurrency.ts    — Concurrency policy
    index.ts
  tools/
    team.ts                — Team tool
    background-send.ts     — background_send tool
    background-status.ts   — background_status tool
    background-events.ts   — background_events tool

packages/ui/src/
  components/
    TeamDetailPanel.tsx    — Team detail view
  stores/
    team-store.ts          — Team state management
  hooks/
    useTeamEvents.ts       — Team event subscription
```

---

## Success Criteria

1. 用户能清楚看到团队结构和每个人在干嘛
2. 用户能中途催促/改方向，PM 能理解并执行
3. 成员结果能被 PM 有效汇总成结构化产出
4. 多 agent 没有互相踩文件
5. 最终结果比单 agent 更快、更全面、更有组织
6. 失败时能解释：谁失败了、为什么、PM 怎么处理、哪些结果仍可信
7. 10 个 worker 并发时系统稳定，不会 rate limit 爆炸或资源耗尽

---

## Key Design Decisions

### Why PM-centered (hub-and-spoke)?

完全 mesh 通信会导致消息爆炸、责任不清、成本不可控。PM 中心化保证：
- 责任链清晰
- 事件可追踪
- 成本可控
- 用户只需和 PM 交互

### Why cooperative mailbox (not interrupt)?

中断会破坏工具执行和 message ordering。Cooperative mailbox 保证：
- 不打断正在写文件的操作
- 不破坏 model stream
- 不导致半截 assistant message
- 唯一例外：abort 触发 AbortController

### Why single writer?

多个 agent 同时编辑文件会导致 diff 冲突、覆盖修改、验证困难。
Team 可以多人分析，但写代码必须受控。

### Why Team is a background task?

Team 可能运行很久，用户应该能继续主会话。
Team 复用 background task 的所有基础设施：list、status、events、send、stop、notification。

### How is PM implemented?

PM 是 LLM 驱动的 agent，不是硬编码规则引擎。

PM 通过一组受限工具与 TeamRuntime 交互：
- `create_task(title, description, priority, dependsOn?)`
- `assign_task(taskId, memberId)`
- `cancel_task(taskId, reason)`
- `send_member_message(memberId, intent, content)`
- `request_member_status(memberId)`
- `broadcast(intent, content)`
- `add_constraint(constraint)`
- `add_decision(summary, reason)`
- `submit_synthesis(summary, findings, risks)`

PM 不能直接 file_read/file_write/bash。PM 通过成员干活。

TeamRuntime 负责执行 PM 的 action，包括：
- 启动成员 subagent
- 把成员结果反馈给 PM
- 把外部消息反馈给 PM
- 控制并发策略
- 维护 event log
