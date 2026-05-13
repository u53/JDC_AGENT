# Spec 1: 工具差异化渲染 + 工具卡片重构

## 目标

将当前统一的 ToolCard/HistoryToolCard 替换为按工具类型分发的专属渲染器，提升信息密度和可读性。

## 架构

### 路由模式

采用注册表模式，`ToolCardRouter` 根据 `toolName` 分发到对应渲染组件：

```
ToolCardRouter
├── BashToolCard      — 命令 + 输出 + 退出码
├── EditToolCard      — 文件路径 + unified diff
├── WriteToolCard     — 文件路径 + 新建内容预览
├── ReadToolCard      — 折叠为文件路径
├── AgentToolCard     — 任务描述 + 进度线 + 工具计数
├── SkillToolCard     — Skill 名称 + 内容
├── McpToolCard       — 服务器名::工具名 + 摘要
└── GenericToolCard   — 通用 fallback
```

### 统一 Props 接口

当前存在两个入口：
- `ToolCard` — 实时事件流（streaming 期间）
- `HistoryToolCard` — 历史消息（已完成的工具调用）

统一为一个路由组件，接收两种数据源：

```typescript
interface ToolCardProps {
  // 实时模式（streaming 期间）
  event?: ToolExecutionEvent
  // 历史模式（消息回放）
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}
```

路由逻辑：`toolName = props.event?.toolName || props.name`

### 文件结构

```
packages/ui/src/components/tool-cards/
├── ToolCardRouter.tsx        — 路由分发
├── BashToolCard.tsx
├── EditToolCard.tsx
├── WriteToolCard.tsx
├── ReadToolCard.tsx
├── AgentToolCard.tsx
├── SkillToolCard.tsx
├── McpToolCard.tsx
├── GenericToolCard.tsx
└── shared.tsx                — 共享样式/工具函数
```

## 各工具卡片设计

### BashToolCard

**头部：** 状态圆点 + "BASH" 标签 + 命令文本（单行截断）+ 状态标签

**内容区：**
- 运行中：绿色脉冲圆点，显示 "Running..."（当前无流式输出，Spec 6 补充）
- 完成：显示 stdout 输出，底部显示 exit code
- 错误：红色圆点，显示 stderr

**交互：**
- 完成后默认折叠，只显示命令 + 状态
- 点击展开查看完整输出
- 输出区域 max-height: 300px，overflow-y: auto
- 命令文本使用 monospace 字体

**数据提取：**
- 命令：`input.command`
- 输出：`result.content`
- 是否错误：`result.is_error`

### EditToolCard

**头部：** 状态圆点 + "EDIT" 标签 + 文件路径:行号 + 状态标签

**内容区：**
- unified diff 格式渲染
- 删除行：红色背景 `bg-red-900/20` + 红色文字 + `-` 前缀
- 新增行：绿色背景 `bg-green-900/20` + 绿色文字 + `+` 前缀
- 上下文行：灰色文字（无背景）

**交互：**
- 完成后默认折叠，显示文件路径 + 变更摘要（"+N -M"）
- 点击展开查看 diff

**数据提取：**
- 文件路径：`input.file_path`
- old_string：`input.old_string`
- new_string：`input.new_string`
- diff 由前端从 old/new 计算（简单的行级 diff）

**错误态：**
- 显示错误信息（如 "old_string not unique in file"）

### WriteToolCard

**头部：** 状态圆点 + "WRITE" 标签 + 文件路径 + "(new)"/"(overwrite)" + 状态标签

**内容区：**
- 全部为绿色新增行（`+` 前缀）
- 超过 10 行：显示前 5 行 + "... N more lines"
- 展开后显示全部

**交互：**
- 完成后默认折叠
- 点击展开

**数据提取：**
- 文件路径：`input.file_path`
- 内容：`input.content`

### ReadToolCard

**头部：** 状态圆点 + "READ" 标签 + 文件路径 + 状态标签

**内容区：**
- 默认不显示内容（Read 是最频繁的工具，保持紧凑）
- 展开后显示前 5 行 + 总行数

**交互：**
- 默认折叠（只有头部一行）
- 点击可展开

**连续 Read 合并：**
- 当 toolEvents 数组中连续 2 个以上 Read 工具（中间无其他工具类型）且全部为 complete 状态时，合并为一行：
  "READ 3 files: App.tsx, utils.ts, types.ts"
- 合并逻辑在 ChatView 层处理（在传入 ToolCardRouter 之前分组）
- 运行中的 Read 不合并，单独显示

**数据提取：**
- 文件路径：`input.file_path` 或 `input.path`

### AgentToolCard

**头部：** 紫色菱形 ◆ + "AGENT" 标签 + 任务描述（截取 prompt 前 40 字符）+ 状态标签

**进度区（运行中）：**
```
├─ Read src/auth.ts
├─ Edit src/auth.ts
└─ Bash npm test              (latest)
```
- 树形显示子 agent 最近 3 个工具调用
- 数据来源：子 agent 的 tool events 通过 IPC 上报

**底部信息栏：**
- 工具调用计数
- Token 消耗（需要后端上报）
- [ABORT] 按钮（红色，点击发送中止信号）

**交互：**
- 运行中：默认展开显示进度
- 点击卡片主体：打开右侧分屏面板（Spec 2 实现，此处预留 `onOpenDetail` 回调）
- 完成后：折叠为一行，显示结果摘要

**数据提取：**
- 任务描述：`input.prompt`
- 子 agent 进度：需要新增 IPC 事件 `agent:progress`，包含子 agent 的工具调用列表

### SkillToolCard

**头部：** 状态圆点 + "SKILL" 标签 + skill 名称 + 状态标签

**内容区：**
- 默认折叠
- 展开显示 skill 返回的内容（markdown 渲染）

**数据提取：**
- Skill 名称：`input.skill` 或 `input.name`
- 内容：`result.content`

### McpToolCard

**头部：** 状态圆点 + "MCP" 标签 + `serverName::toolName` + 状态标签

**内容区：**
- 输入参数：key=value 格式，每行一个
- 结果：文本内容或 JSON 格式化

**交互：**
- 完成后默认折叠
- 点击展开

**数据提取：**
- 工具名中包含 `mcp__` 前缀时识别为 MCP 工具
- 服务器名从工具名解析：`mcp__<server>__<tool>`

### GenericToolCard

保持当前 ToolCard 的样式和行为，作为未匹配工具的 fallback。

## 共享组件和工具函数

### shared.tsx

```typescript
// 状态圆点组件
function StatusDot({ status, color }: { status: string; color?: string })

// 工具卡片外壳（统一边框、padding、折叠逻辑）
function ToolCardShell({ 
  label: string
  detail: string
  status: string
  statusColor: string
  borderColor?: string
  defaultExpanded?: boolean
  children: ReactNode
  actions?: ReactNode
})

// Diff 渲染组件
function DiffView({ oldText: string; newText: string })

// 简单行级 diff 算法
function computeLineDiff(oldStr: string, newStr: string): DiffLine[]
```

## 后端变更

### Agent 进度上报

当前 `ToolExecutionEvent` 只有 `start/progress/complete/error`。Agent 工具需要额外上报子 agent 的工具调用进度。

新增 IPC 事件：
```typescript
// packages/electron/src/ipc-channels.ts
AGENT_PROGRESS = 'agent:progress'

// 事件数据
interface AgentProgressEvent {
  sessionId: string
  agentToolUseId: string  // 父 agent 工具调用 ID
  subToolName: string     // 子 agent 正在执行的工具名
  subToolStatus: 'start' | 'complete' | 'error'
  toolCount: number       // 累计工具调用数
  tokenCount?: number     // 累计 token 数
}
```

### Sub-session 进度回调

`packages/core/src/sub-session.ts` 的 `runSubSession` 需要新增 `onAgentProgress` 回调，在每次子 agent 执行工具时触发。

### MCP 工具名解析

MCP 工具注册时使用 `mcp__<server>__<tool>` 命名约定。前端通过解析此格式识别 MCP 工具并提取服务器名。

## 迁移策略

1. 新建 `tool-cards/` 目录，逐个实现各渲染器
2. 实现 `ToolCardRouter`，先 fallback 到 `GenericToolCard`
3. 逐步替换 `ChatView.tsx` 中的 `<ToolCard>` 为 `<ToolCardRouter>`
4. 替换 `MessageBubble.tsx` 中的 `<HistoryToolCard>` 为 `<ToolCardRouter>`
5. 删除旧的 `ToolCard.tsx` 和 `HistoryToolCard.tsx`

## 不在此 Spec 范围内

- Bash 实时流式输出（Spec 6）
- Agent 右侧分屏面板（Spec 2）
- 工具执行前的权限确认 UI 改造（Spec 7）
- 并行工具执行的 UI 表现（Spec 6）
