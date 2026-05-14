# Spec 11a: Agent 类型系统 + Plan Mode

## 概述

为 JDCAGNET 添加专门化 Agent 类型系统和 Plan Mode，对齐 Claude Code 的核心能力。

- **Agent 类型系统**：6 种专门化 agent，每种有独立的工具白名单和 system prompt
- **Plan Mode**：结构化的"先规划后执行"流程，模型主动或用户触发

## 1. Agent 类型系统

### 1.1 数据结构

```typescript
// packages/core/src/agent-types.ts
export interface AgentTypeDefinition {
  name: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  maxTurns: number
}
```

### 1.2 六种 Agent 类型

| Type | 工具白名单 | maxTurns | 用途 |
|------|-----------|----------|------|
| `explore` | file_read, glob, grep, ls, tree, web_search, web_fetch, lsp | 10 | 快速只读搜索定位代码 |
| `plan` | file_read, glob, grep, ls, tree, file_write(限plan目录) | 20 | 设计方案，输出 plan 文件 |
| `refactor` | file_read, file_edit, file_write, grep, glob, ls | 30 | 代码重构，不能跑 bash |
| `security-auditor` | file_read, grep, glob, ls, tree, bash(只读) | 20 | 安全审计，输出报告 |
| `frontend-designer` | file_read, file_write, file_edit, glob, ls, web_fetch | 30 | 前端设计转代码 |
| `general` | 全部工具（除 Agent 本身） | 150 | 复杂多步任务 |

### 1.3 Agent Tool 改造

Agent tool 的 input schema 增加 `type` 参数：

```typescript
{
  prompt: string,
  type?: 'explore' | 'plan' | 'refactor' | 'security-auditor' | 'frontend-designer' | 'general',
  maxTurns?: number
}
```

不指定 type 时默认 `general`（向后兼容）。

### 1.4 Sub-session 改造

`sub-session.ts` 的 `runSubSession` 接收新参数 `agentType?: string`：

1. 根据 type 查找 `AgentTypeDefinition`
2. 用 `allowedTools` 过滤 `toolRegistry.getDefinitions()`，只传白名单内的工具
3. 用专用 `systemPrompt` 替换通用的 `SUB_AGENT_SYSTEM`
4. 用定义的 `maxTurns` 作为默认值（input 中的 maxTurns 可覆盖）

### 1.5 工具限制实现

- **plan agent 的 file_write 限制**：通过 wrapper 实现，只允许写入 `{cwd}/.jdcagnet/plans/` 目录。写其他路径返回错误 `"Plan agent can only write to .jdcagnet/plans/ directory"`
- **security-auditor 的 bash 限制**：通过 wrapper 实现，命令必须以白名单前缀开头：`grep`, `find`, `cat`, `head`, `tail`, `ls`, `file`, `wc`, `git log`, `git diff`, `git show`, `git blame`, `npm audit`, `npx depcheck`。其他命令返回错误 `"Security auditor bash is restricted to read-only commands"`。

### 1.6 专用 System Prompt

每种 agent 有针对性的 system prompt，核心差异：

- **explore**: "You are a code search agent. Find the requested information quickly. Do NOT modify any files. Report what you find concisely."
- **plan**: "You are a planning agent. Analyze the codebase and write a detailed implementation plan. Save your plan to a file. Do NOT implement anything."
- **refactor**: "You are a refactoring agent. Improve code structure without changing behavior. No shell commands — only file operations."
- **security-auditor**: "You are a security auditor. Analyze code for vulnerabilities (OWASP Top 10, injection, auth issues). Output a structured report."
- **frontend-designer**: "You are a frontend design agent. Convert designs into component architecture and implementation code."
- **general**: "You are a sub-agent executing a specific task. You have access to all tools. Focus on completing the task efficiently."

### 1.7 模型选择

所有 agent 类型默认继承主 session 的当前模型。不做 model override 机制（用户如需切换模型，在主 session 设置里切换）。

## 2. Plan Mode

### 2.1 状态机

```
normal → (enter_plan_mode) → planning → (exit_plan_mode) → awaiting_approval
awaiting_approval → (user approves) → normal
awaiting_approval → (user rejects) → planning
```

Session 新增字段：`planMode: 'normal' | 'planning' | 'awaiting_approval'`

### 2.2 新增 Tool

**enter_plan_mode:**

```typescript
{
  name: 'enter_plan_mode',
  description: 'Enter plan mode to design an implementation approach before writing code. In plan mode, you can only read files and write a plan. Use this for non-trivial tasks.',
  inputSchema: { type: 'object', properties: {}, required: [] }
}
```

执行逻辑：设置 `session.planMode = 'planning'`，返回确认文本。

**exit_plan_mode:**

```typescript
{
  name: 'exit_plan_mode',
  description: 'Submit your plan for user approval. The plan file will be shown to the user.',
  inputSchema: {
    type: 'object',
    properties: {
      planFile: { type: 'string', description: 'Path to the plan file' }
    },
    required: ['planFile']
  }
}
```

执行逻辑：
1. 设置 `session.planMode = 'awaiting_approval'`
2. 通过回调通知前端（类似 permission request）
3. 等待用户响应
4. Approve → 设置 `planMode = 'normal'`，返回 "Plan approved. Proceed with implementation."
5. Reject → 设置 `planMode = 'planning'`，返回 "Plan rejected. User feedback: {reason}. Please revise."

### 2.3 Plan Mode 下的工具限制

Planning 状态下允许的工具：
- file_read, glob, grep, ls, tree（读取）
- file_write（仅 `.jdcagnet/plans/` 目录）
- Agent（仅 `explore` 类型）
- exit_plan_mode
- task_create, task_get, task_list, task_update（规划用）
- lsp（代码导航）

其他工具调用返回：`"Cannot use {tool} in plan mode. Only read operations and writing plan files are allowed."`

### 2.4 ToolRunner 集成

`tool-runner.ts` 在执行前检查 plan mode 状态：

```typescript
if (session.planMode === 'planning') {
  if (!PLAN_MODE_ALLOWED_TOOLS.includes(toolName)) {
    return { content: `Cannot use ${toolName} in plan mode.`, isError: true }
  }
  if (toolName === 'file_write' && !isInPlanDir(input.file_path)) {
    return { content: 'In plan mode, file_write is restricted to .jdcagnet/plans/', isError: true }
  }
  if (toolName === 'Agent' && input.type !== 'explore') {
    return { content: 'In plan mode, only explore agents can be dispatched.', isError: true }
  }
}
```

### 2.5 /plan Slash Command

用户输入 `/plan` 时，前端发送特殊消息：

```
Please enter plan mode and design an implementation approach for the task we've been discussing. Analyze the relevant code first, then write a plan file.
```

模型收到后自然调用 `enter_plan_mode`。

### 2.6 前端 UI

**Plan Mode 状态条：**
- planning 状态时，输入框上方显示：`PLAN MODE — 规划中...`
- 样式：border-top + 紫色文字（区别于正常绿色）

**Plan 审批对话框：**
- exit_plan_mode 触发后，显示 plan 文件内容（markdown 渲染）
- 底部两个按钮：Approve / Reject
- Reject 时弹出文本输入框让用户填写反馈
- 复用 PermissionDialog 的 pending promise 模式

**IPC 事件：**
- `plan:review` — backend → frontend，携带 { id, sessionId, planFile, content }
- `plan:respond` — frontend → backend，携带 { id, approved, feedback? }

## 3. 集成点

### 3.1 Plan Mode + Agent 类型

- Plan Mode 是主 session 状态，不影响 sub-agent
- Planning 状态下可以 dispatch `explore` agent 搜索代码
- `plan` 类型 agent 是独立的 sub-agent，不触发主 session 的 plan mode

### 3.2 System Prompt 引导

在 `base-prompt.ts` 加入 plan mode 指导：

```
## Plan Mode

You have access to a plan mode for designing implementation approaches before writing code.

**When to enter plan mode:**
- Non-trivial tasks requiring 3+ file changes
- Architectural decisions with multiple valid approaches
- Tasks where the user's intent is unclear and you need to explore first
- Multi-step implementations where getting alignment prevents wasted effort

**When NOT to enter plan mode:**
- Simple bug fixes or typo corrections
- Single-file changes with clear requirements
- Tasks where the user gave very specific instructions

**In plan mode:**
- Read and explore the codebase freely
- Write your plan to .jdcagnet/plans/
- Dispatch explore agents for code search
- Call exit_plan_mode when your plan is ready for review
```

### 3.3 Agent 类型在 System Prompt 中的描述

在 base prompt 的 tool descriptions 中，Agent tool 的 description 列出所有可用类型及其用途，让模型知道何时用哪种。

## 4. 文件变更清单

### 新建文件
- `packages/core/src/agent-types.ts` — AgentTypeDefinition + 6 种类型定义 + 专用 prompts
- `packages/core/src/tools/enter-plan-mode.ts` — enter_plan_mode tool
- `packages/core/src/tools/exit-plan-mode.ts` — exit_plan_mode tool
- `packages/ui/src/components/PlanReviewDialog.tsx` — Plan 审批 UI

### 修改文件
- `packages/core/src/tools/agent.ts` — input schema 加 type 参数
- `packages/core/src/sub-session.ts` — 接收 agentType，过滤工具，注入专用 prompt
- `packages/core/src/session.ts` — planMode 状态 + plan tools 注册 + plan mode 回调
- `packages/core/src/tool-runner.ts` — plan mode 工具限制检查
- `packages/core/src/base-prompt.ts` — Agent 类型描述 + Plan Mode 指导
- `packages/core/src/tools/index.ts` — 注册新 tools
- `packages/electron/src/session-manager.ts` — plan review IPC 处理
- `packages/electron/src/preload.ts` — 暴露 plan review API
- `packages/electron/src/main.ts` — plan IPC handlers
- `packages/ui/src/hooks/useSession.ts` — plan mode 状态
- `packages/ui/src/components/ChatView.tsx` — plan mode 状态条 + /plan command
- `packages/ui/src/components/SlashCommandMenu.tsx` — 加 /plan

## 5. 测试策略

- `agent-types.test.ts` — 验证工具过滤逻辑、plan agent 路径限制、security-auditor bash 限制
- `plan-mode.test.ts` — 状态机转换、工具限制、approve/reject 流程
- 手动测试：dispatch explore agent 搜索代码、进入 plan mode 写 plan、审批流程
