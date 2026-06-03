# JDCAGNET Phase 2C: Subagent + Skills + Hooks

## Goal

为 JDCAGNET 添加三个高级功能：子代理派发、技能系统、工具钩子。使其具备 Claude Code 级别的可扩展性和自动化能力。

## Architecture Overview

```
Session (主会话)
├── ToolRunner
│   ├── HookEngine (PreToolUse / PostToolUse)
│   └── execute() → hooks → tool → hooks
├── SkillLoader (加载 .md 技能文件)
│   └── SkillTool (模型调用) + SlashCommand (用户调用)
└── AgentTool (派发子代理)
    └── Sub-Session (独立 messages, 共享 tools)
```

## Tech Stack

- TypeScript, Node.js
- Zod (schema validation)
- child_process (hook command execution)
- gray-matter (markdown frontmatter parsing)
- 现有 Session / ToolRegistry / ToolRunner 架构

---

## Feature 1: Subagent (子代理)

### 概述

主 session 中的模型可以通过 `Agent` tool 派发子代理执行独立任务。子代理拥有独立的对话历史，但共享工具注册表和 MCP 连接。

### 接口设计

```typescript
// AgentTool input schema
interface AgentToolInput {
  prompt: string           // 任务描述
  model?: string           // 可选模型覆盖 (默认继承主 session)
  allowedTools?: string[]  // 可选工具白名单 (默认全部)
  maxTurns?: number        // 最大轮次 (默认 10)
}

// AgentTool output
interface AgentToolResult {
  content: string          // 子代理最终文本回复
  totalTurns: number
  toolsUsed: string[]
}
```

### 执行流程

1. 主 session 模型调用 `Agent` tool，传入 prompt
2. 创建子 Session：
   - 独立 id、独立 messages 数组
   - 继承主 session 的 provider、toolRegistry、mcpManager
   - 系统提示精简版（不含 git status 等动态信息，加入子代理指令）
3. 子代理循环执行（query → tool_use → tool_result → query...）直到：
   - 模型回复纯文本（无 tool_use）→ 完成
   - 达到 maxTurns → 强制结束
   - 被 abort → 中止
4. 提取最终 assistant 文本作为结果返回主 session

### 子代理系统提示

```
You are a sub-agent executing a specific task. Focus on completing the task efficiently.
You have access to the same tools as the main session.
When done, respond with your final answer as plain text.
Do not ask questions — work with what you have.
```

### 限制

- 子代理不能再派发子代理（防止递归）
- 子代理不能调用 `Agent` tool
- 子代理共享 abort signal（主 session abort 时子代理也停止）
- 子代理的 tool events 通过 progress callback 冒泡到主 session

### 文件结构

- `packages/core/src/tools/agent.ts` — AgentTool 实现
- `packages/core/src/sub-session.ts` — 子代理 session 运行逻辑

---

## Feature 2: Skills (技能系统)

### 概述

Skills 是 markdown 文件，定义了可复用的指令/工作流。用户通过 `/` 命令调用，模型也可通过 `Skill` tool 主动调用。

### 技能文件格式

```markdown
---
name: refactor
description: 重构指定文件的代码结构
user-invocable: true
arguments:
  - file-path
argument-hint: "<file-path>"
allowed-tools:
  - FileRead
  - FileEdit
  - Bash
---

请重构 ${1} 文件：
1. 分析当前代码结构
2. 识别可改进的模式
3. 执行重构，保持功能不变
4. 运行测试确认无回归
```

### Frontmatter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 技能名称（用于调用） |
| description | string | 简短描述（显示在菜单中） |
| user-invocable | boolean | 是否在 / 菜单中显示 |
| arguments | string[] | 参数名列表 |
| argument-hint | string | 参数提示文本 |
| allowed-tools | string[] | 执行期间允许的工具（可选） |

### 存储位置

按优先级（后者覆盖前者）：
1. `~/.jdcagnet/skills/` — 全局技能
2. `<project>/.jdcagnet/skills/` — 项目技能

每个技能可以是：
- 单文件：`skill-name.md`
- 目录：`skill-name/SKILL.md`（支持附带文件）

### 加载流程

```typescript
interface SkillDefinition {
  name: string
  description: string
  content: string           // markdown body (模板)
  userInvocable: boolean
  arguments: string[]
  argumentHint?: string
  allowedTools?: string[]
  source: 'global' | 'project'
  filePath: string
}

// SkillLoader
class SkillLoader {
  loadAll(cwd: string): Promise<SkillDefinition[]>
  get(name: string): SkillDefinition | undefined
  getInvocable(): SkillDefinition[]  // user-invocable skills
}
```

### 调用方式

**用户调用（/ 命令）：**
1. 用户输入 `/skill-name arg1 arg2`
2. 查找对应 skill definition
3. 替换模板中的 `${1}`, `${2}` 等占位符
4. 将渲染后的内容作为 user message 注入对话
5. 模型按指令执行

**模型调用（Skill tool）：**
```typescript
interface SkillToolInput {
  skill: string    // 技能名称
  args?: string   // 可选参数
}
```
1. 模型调用 `Skill({ skill: "refactor", args: "src/utils.ts" })`
2. 加载 skill，替换参数
3. 将内容作为新 user message 注入
4. 返回确认信息，模型继续执行

### 与 SlashCommandMenu 集成

- SkillLoader 在 session 初始化时加载所有 skills
- user-invocable 的 skills 注册到 slash command 列表
- UI 的 SlashCommandMenu 显示这些 skills（带 description）

### 文件结构

- `packages/core/src/skills/loader.ts` — 技能发现和加载
- `packages/core/src/skills/types.ts` — 类型定义
- `packages/core/src/tools/skill.ts` — SkillTool 实现

---

## Feature 3: Hooks (钩子系统)

### 概述

Hooks 允许在工具执行前后运行 shell 命令，实现自动化检查、日志记录、权限控制等。

### 配置格式

```json
// ~/.jdcagnet/hooks.json 或 <project>/.jdcagnet/hooks.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node ./scripts/check-command.js"
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Tool: $TOOL_NAME' >> /tmp/jdcagnet.log"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "FileEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx eslint --fix $FILE_PATH"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Session started' >> /tmp/jdcagnet.log"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Session ended' >> /tmp/jdcagnet.log"
          }
        ]
      }
    ]
  }
}
```

### 支持的事件

| 事件 | 触发时机 | 输入数据 |
|------|----------|----------|
| PreToolUse | 工具执行前（权限检查后） | tool_name, tool_input, session_id, cwd |
| PostToolUse | 工具执行成功后 | tool_name, tool_input, tool_result, session_id, cwd |
| SessionStart | Session 创建时 | session_id, cwd, project_name |
| SessionEnd | Session 结束时 | session_id, cwd, message_count |

### Hook 类型

Phase 2C 只实现 `command` 类型：

```typescript
interface CommandHook {
  type: 'command'
  command: string       // shell 命令
  timeout?: number      // 超时 ms (默认 10000)
}
```

### 执行机制

1. Hook 通过 `child_process.exec` 执行
2. 输入数据通过 **stdin** 以 JSON 传入
3. 环境变量注入：`TOOL_NAME`, `SESSION_ID`, `CWD`, `FILE_PATH`（如适用）
4. Hook 的 stdout 解析为 JSON 输出

### Hook 输出格式

```typescript
interface HookOutput {
  // PreToolUse 专用
  decision?: 'allow' | 'block'  // block 则阻止工具执行
  reason?: string               // block 原因（显示给模型）

  // 通用
  message?: string              // 附加信息（注入到 tool result）
}
```

如果 stdout 为空或非 JSON，视为 `{ decision: 'allow' }`。

### Matcher 规则

- `"*"` — 匹配所有工具
- `"ToolName"` — 精确匹配工具名
- `"mcp__*"` — 前缀匹配（所有 MCP 工具）

### 配置加载

```typescript
interface HookConfig {
  hooks: {
    PreToolUse?: HookRule[]
    PostToolUse?: HookRule[]
    SessionStart?: HookRule[]
    SessionEnd?: HookRule[]
  }
}

interface HookRule {
  matcher?: string        // 工具名匹配 (PreToolUse/PostToolUse 必填)
  hooks: CommandHook[]
}
```

加载优先级：全局 + 项目合并（项目的追加到全局后面）。

### 集成到 ToolRunner

```typescript
// ToolRunner.execute() 修改后的流程：
async execute(toolName, toolUseId, input, onEvent, signal) {
  // 1. Permission check (existing)
  // 2. Run PreToolUse hooks
  const preResult = await this.hookEngine.runPreToolUse({ toolName, input, ... })
  if (preResult.blocked) return { content: preResult.reason, isError: true }
  // 3. Execute tool (existing)
  const result = await handler.execute(input, context)
  // 4. Run PostToolUse hooks
  await this.hookEngine.runPostToolUse({ toolName, input, result, ... })
  // 5. Return result (existing)
  return result
}
```

### 文件结构

- `packages/core/src/hooks/types.ts` — Hook 类型定义和 schema
- `packages/core/src/hooks/loader.ts` — 配置加载和合并
- `packages/core/src/hooks/engine.ts` — Hook 执行引擎
- `packages/core/src/hooks/index.ts` — 导出

---

## UI 变更

### SlashCommandMenu 扩展

- 动态加载 user-invocable skills 到命令列表
- Skills 显示在内置命令之后，带 `[SKILL]` 标签
- 支持参数输入（选择 skill 后提示输入参数）

### ChatView 变更

- 子代理执行时显示进度卡片（类似 tool card 但带 "AGENT" 标签）
- 显示子代理的 tool 调用进度

### 无需新增独立 UI 面板

Hooks 通过配置文件管理，不需要 UI。Skills 通过 / 菜单访问。

---

## 测试策略

- **Subagent**: 测试派发、maxTurns 限制、abort 传播、递归防护
- **Skills**: 测试加载、参数替换、user-invocable 过滤、SkillTool 调用
- **Hooks**: 测试配置加载、matcher 匹配、command 执行、block 行为、超时处理

---

## 依赖

- `gray-matter` — 解析 markdown frontmatter（已在项目中？需确认）
- 无其他新依赖
