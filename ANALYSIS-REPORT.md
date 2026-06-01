# JDCAGNET 技术架构深度分析报告

> 基于源码的全面技术分析，适用于项目分享与技术讲解。

---

## 第一章：项目架构总览

### 1.1 Monorepo 结构

JDCAGNET 采用 **pnpm workspace** 管理的 monorepo 架构，包含 5 个子包：

```
jdcagnet/
├── packages/
│   ├── core/                 # 核心引擎（TypeScript）
│   ├── ui/                   # React 前端（Vite）
│   ├── electron/             # Electron 桌面端（esbuild）
│   ├── vscode-extension/     # VS Code 扩展（esbuild）
│   └── jetbrains-plugin/     # JetBrains 插件（Gradle + Kotlin）
├── scripts/                  # 自动化脚本（dev/fetch-codegraph/notarize）
├── .github/workflows/        # CI/CD（GitHub Actions）
├── pnpm-workspace.yaml
└── package.json              # 根配置
```

### 1.2 技术栈选型

| 层级 | 技术 | 选型理由 |
|------|------|----------|
| 核心引擎 | TypeScript (strict) | 类型安全 + 生态丰富 |
| 前端框架 | React 19 + Zustand v5 | 细粒度订阅 + 零 Provider |
| 构建工具 | Vite (UI) / esbuild (Electron/VSCode) | 极速 HMR + 快速打包 |
| 桌面框架 | Electron 33 | 跨平台 + 原生能力 |
| 终端模拟 | node-pty | 真实 PTY 支持 |
| 数据库 | sql.js (WASM) | 无需原生编译，跨平台一致 |
| IDE 通信 | JSON-RPC 2.0 over WebSocket | 标准协议 + 双向通信 |
| 包管理 | pnpm 10 | 高效磁盘利用 + workspace 原生支持 |
| AI Provider | Anthropic / OpenAI Chat / OpenAI Responses | 多模型适配 |
| 测试 | Vitest | 与 Vite 生态一致 |

### 1.3 架构分层

```
┌─────────────────────────────────────────────────────────┐
│                    IDE 插件层                             │
│         VS Code Extension  /  JetBrains Plugin          │
│              (JSON-RPC 2.0 WebSocket)                    │
└────────────────────────┬────────────────────────────────┘
                         │ lockfile 发现 + WS 连接
┌────────────────────────▼────────────────────────────────┐
│                   Electron 桌面端                         │
│    Main Process (SessionManager / IPC / Services)        │
│              94 IPC 频道 ↕ contextBridge                 │
│    Renderer (React UI / Zustand / CSS Variables)         │
└────────────────────────┬────────────────────────────────┘
                         │ 直接源码引用 (esbuild alias)
┌────────────────────────▼────────────────────────────────┐
│                    Core 核心引擎                          │
│  Session → Provider → ToolRunner → ParallelExecutor     │
│  Team Mode / Agent / MCP / Memory / Hooks / Skills      │
└─────────────────────────────────────────────────────────┘
```

---

## 第二章：核心引擎深度剖析

核心引擎位于 `packages/core/src/`，是整个系统的大脑，负责会话管理、模型调用、工具执行、多智能体协作等全部核心逻辑。

### 2.1 Session 会话管理

**文件**: `packages/core/src/session.ts`

Session 类是 JDCAGNET 的中央协调器，管理从用户输入到模型响应再到工具执行的完整生命周期。

**核心属性（约30个）**:

| 属性 | 职责 |
|------|------|
| `provider` | 多模型抽象接口 |
| `toolRunner` | 工具执行器（权限+钩子） |
| `parallelExecutor` | 工具并行调度 |
| `toolRegistry` | 工具注册表（60+工具） |
| `permissionChecker` | 三级权限控制 |
| `mcpManager` | MCP 协议集成 |
| `hookEngine` | 钩子引擎 |
| `backgroundTasks` | 后台任务管理 |
| `teamRegistry` | 团队注册表 |

**核心流程**:

```
sendMessage() → 组装系统提示词 → 注入上下文 → runLoop()
    ↓
runLoop(): 流式接收模型响应 → 解析 thinking/text/tool_use
    → 有工具调用 → parallelExecutor 并行执行
    → 工具结果注入 → 循环直到无 tool_use
```

**渐进式压缩策略**:
- **microCompact**: 每轮间运行，Phase 1 (50%+) 清除旧 tool results，Phase 2 (40%+) 截断大结果
- **compact**: LLM 驱动的结构化摘要生成（8段格式）

### 2.2 Agent/Sub-Agent 调度

**文件**: `packages/core/src/agent-types.ts`, `sub-session.ts`, `parallel-executor.ts`

#### 6 种预定义代理类型

| 类型 | 工具权限 | 最大轮数 | 设计哲学 |
|------|---------|---------|---------|
| explore | Read/Glob/Grep/LS/Tree/WebSearch/LSP | 25 | 代码考古学家 |
| plan | Read/Glob/Grep/LS/Tree/Write(.jdcagnet/plans/) | 20 | 架构师 |
| refactor | Read/Edit/Write/Grep/Glob/LS | 30 | 重构专家 |
| security-auditor | Read/Grep/Glob/LS/Tree/Bash(只读) | 20 | 安全工程师 |
| frontend-designer | Read/Write/Edit/Glob/LS/WebFetch | 30 | 前端专家 |
| general | 全部工具 | 150 | 通用 |

#### 子会话执行 (runSubSession)

1. 解析 agentType → 获取 systemPrompt 和 maxTurns
2. 创建独立 PermissionChecker（relaxed 模式）
3. 过滤工具列表（去掉 Agent 防止递归）
4. 组装系统提示词（继承主会话前缀 + 角色覆盖层）
5. 流式循环（支持 mailbox 外部消息注入）

#### 并行执行器 (ParallelExecutor)

```
执行策略：
  读工具 → 并行执行（Semaphore 最大 5 并发）
  写工具 → 串行执行（防止竞态条件）
  失败 → batchAbort.abort() 取消其余
  非长时间运行工具 → 120 秒超时
```

### 2.3 Team Mode 多智能体协作

**文件**: `packages/core/src/team/`（15 个文件）

#### 三层架构

```
Main Session → Team tool → TeamRuntime
                              ├── TeamManager / TeamManagerAI (PM)
                              ├── TeamMember[] (最多 10 个 Worker)
                              ├── TeamConcurrencyController
                              └── TeamWorkspace (.team/)
```

#### 状态机

- **TeamStatus**: planning → running → waiting → synthesizing → completed/failed/stopped
- **MemberStatus**: queued → running → waiting → blocked → completed/failed
- **TaskStatus**: todo → assigned → running → blocked → completed/failed/cancelled/reopened

#### AI PM 决策系统 (TeamManagerAI)

使用 LLM 进行智能决策，分层提示词：
- `PM_IDENTITY` — 使命、心智模型
- `PM_TOOLBOX` — 严格的 Action Schema（15 种 Action）
- `PM_OUTPUT_PROTOCOL` — 输出格式（scratch + JSON tail）

**15 种 PM Action**: assign_task, cancel_task, send_member_message, broadcast, add_member, remove_member, add_task, reopen_task, kick_member, wrap_up, complete, reply, escalate_to_user, add_constraint, request_member_status

#### 并发控制策略

```
maxWorkersPerTeam: 10
maxActiveWorkers: 8
maxWriteWorkers: 5
maxShellWorkers: 2
```

#### 工作空间文件系统

```
.team/
├── objective.md          # 团队目标
├── log.md                # 追加式活动日志
├── tasks/T001/           # 任务（task.md + result.md + artifacts/）
├── contracts/            # 共享契约
└── issues/               # QA 问题追踪
```

### 2.4 Tool 系统

**文件**: `packages/core/src/tools/`, `tool-registry.ts`, `tool-runner.ts`

#### 架构

```
ToolRegistry (Map<string, ToolHandler>)
    └── ToolRunner 执行管道:
        1. codegraph 自动注入 projectPath
        2. 工具查找
        3. 权限链检查 → deny/ask/allow
        4. Plan Mode 检查
        5. PreToolUse Hooks → 可 block
        6. 工具执行
        7. PostToolUse Hooks
```

#### 内置工具（40+）

| 分类 | 工具 |
|------|------|
| 文件操作 | Bash, Read, Write, Edit, MultiEdit, Glob, Grep, LS, Tree |
| 网络 | WebFetch, WebSearch |
| 代码智能 | LSP, NotebookEdit |
| 任务管理 | TaskCreate/Get/List/Update/Stop, TodoWrite |
| Agent | Agent, EnterPlanMode, ExitPlanMode |
| Team | Team, TeamList, TeamAddTask, team_report, team_artifact |
| 后台 | BackgroundSend/Status/Events, Monitor, TaskOutput |
| 其他 | SaveMemory, Skill, Notify, AskUser |

### 2.5 MCP 协议集成

**文件**: `packages/core/src/mcp/`

#### McpManager

```
McpManager
├── Map<string, ConnectedServer>
├── loadConfig() — 全局 + 项目配置合并（项目覆盖全局）
├── connectServer() — transport 连接 → listTools → 提取 instructions
├── callTool("mcp__<server>__<tool>", args)
├── listResources / readResource
└── getTools() → 统一前缀格式
```

**传输层**: StdioClientTransport（本地进程）/ SSEClientTransport（远程 HTTP）

### 2.6 Provider 多模型适配

**文件**: `packages/core/src/providers/`

#### ModelProvider 接口

```typescript
interface ModelProvider {
  name: string
  chat(messages, tools, config, signal?) → { content, usage }
  stream(messages, tools, config, signal?) → AsyncIterable<StreamChunk>
}
```

#### 三种 Provider 实现

| Provider | 特性 |
|----------|------|
| Anthropic | Prompt Caching（cache_control 断点）、ThinkTagStreamParser |
| OpenAI Chat | prompt_cache_key 路由、模型特征自动检测（reasoning/temperature） |
| OpenAI Responses | Responses API、reasoning_text_delta 流式 |

#### 模型特征检测 (model-traits.ts)

自动检测推理模型（gpt-5, o1-o9, deepseek-r, *-reasoner, *-thinking 等），适配 `max_completion_tokens` 和 `temperature` 参数。

### 2.7 Permission 权限控制

**文件**: `packages/core/src/permissions.ts`

#### 三级模式

| 模式 | 行为 |
|------|------|
| strict | 只允许 read-only 工具，其他都 ask |
| standard | 按规则链判断 + 默认策略 |
| relaxed | 除 critical 命令外全部 allow |

#### 规则链匹配

1. 项目规则 (`.jdcagnet/permissions.json`) — 第一条匹配生效
2. 全局规则 (`~/.jdcagnet/permissions.json`)
3. 内置默认值
4. 最终回退 → ask

#### 命令危险等级

- **Critical**（总是 ask）: `rm -rf /`, `dd if=`, `mkfs.`, `fork bomb`
- **Dangerous**（standard 下 ask）: `rm -rf`, `git push --force`, `chmod -R 777`, `DROP TABLE`

### 2.8 Memory 记忆系统

**文件**: `packages/core/src/memory-extractor.ts`

#### 存储结构

```
~/.jdcagnet/projects/<sanitized-cwd>/memory/
├── MEMORY.md        # 索引文件（注入系统提示词）
├── <name>.md        # 每个记忆一个文件（YAML frontmatter）
```

#### 记忆类型

- **feedback**: 用户反馈（工作风格偏好）
- **project**: 项目决策、约束（不可从代码推导）

#### 覆盖策略 (shouldOverwrite)

- 相同内容 → 跳过
- 新内容长度 > 旧的 1.2 倍 → 覆盖
- 新内容有 >30% 全新行 → 覆盖

### 2.9 Context Compaction 上下文压缩

**文件**: `packages/core/src/compact.ts`

#### 两级压缩策略

**Micro Compact**（每轮间运行）:
- Phase 1 (50%+ 上下文): 清除旧 tool_result（保留最近 8 个）
- Phase 2 (40%+ 上下文): 截断大 tool_result（限制 200 字符）

**Full Compact**（LLM 驱动）:
- 触发条件: `contextUsedPercent > 0.9`
- 输出格式: 8 段结构化摘要 + 记忆提取
- 保留最近 6 条消息不压缩

### 2.10 CodeGraph 集成

**文件**: `packages/core/src/codegraph/`

- `project.ts`: 检测 `.codegraph/codegraph.db` → init/reindex/status
- `prompt.ts`: 索引存在时自动注入提示词段（优先使用 codegraph 工具）
- `mcp-default.ts`: 自动生成 CodeGraph MCP 服务器默认配置

### 2.11 Hooks 钩子系统

**文件**: `packages/core/src/hooks/`

#### 四种事件

| 事件 | 时机 | 能力 |
|------|------|------|
| PreToolUse | 工具执行前 | 可 block |
| PostToolUse | 工具执行后 | 仅通知 |
| SessionStart | 会话启动 | 初始化 |
| SessionEnd | 会话结束 | 清理 |

#### 执行机制

- 通过 `child_process.exec` 执行外部命令
- stdin 传入 JSON 格式的 HookInput
- stdout 解析 JSON → `{ decision: 'block' }` 可拦截
- 匹配规则: `"*"` / `"Bash*"` / `"Write"`

### 2.12 Skills 技能系统

**文件**: `packages/core/src/skills/`

#### SkillDefinition

```typescript
interface SkillDefinition {
  name: string
  description: string
  content: string           // 技能指令内容
  userInvocable: boolean
  arguments: string[]       // 参数列表
  allowedTools?: string[]   // 限制的工具
  source: 'global' | 'project'
}
```

#### 加载与渲染

- 来源: `~/.jdcagnet/skills/`（全局）+ `<cwd>/.jdcagnet/skills/`（项目）
- 格式: 目录 (`<dir>/SKILL.md`) 或文件 (`<name>.md`)
- 渲染: 替换 `${1}`, `${2}` 占位符

#### 与 Team Mode 集成

SkillRouter 在 Team 创建时自动选择 PM/Worker skills，通过 LLM 调用智能匹配。

---

## 第三章：前端 UI 架构

前端位于 `packages/ui/`，基于 React 19 + Zustand v5 + CSS Variables 构建。

### 3.1 React 组件结构（44 个组件）

#### 根布局（三栏）

```
App
├── Topbar (macOS 无边框拖拽 + 主题切换 + 新建/设置)
├── Sidebar (项目树 + 会话列表，240px)
├── [ChatView | ProjectPage]
│   └── ChatView
│       ├── ConversationTurn[] (消息分组渲染)
│       │   ├── MarkdownRenderer (react-markdown + remark-gfm + rehype-highlight)
│       │   ├── ToolCardRouter → *ToolCard (Bash/Edit/Write/Read/Agent/Mcp/Generic)
│       │   └── ThinkingBlock (可折叠思考过程)
│       ├── PermissionDialog / PlanReviewDialog
│       └── Composer (智能 textarea + 斜杠命令 + 图片粘贴)
├── TerminalPanel (内嵌终端)
├── Inspector (右侧面板: Session/Usage/Tasks/Team/Queue/Files)
├── SettingsOverlay / AskUserDialog / ToastContainer
└── GlobalTeamPoller
```

#### ToolCard 系统

`ToolCardShell` 提供统一外观：左侧 3px 渐变轨道条 + 扫描动画（running 状态），三种状态配色：
- running → `var(--warn)` 黄色 + 扫描光带动画
- done → `var(--good)` 绿色
- error → `var(--bad)` 红色

#### 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| Escape | 中止当前生成 |
| Cmd+N | 新会话 |
| Cmd+W | 删除当前会话 |
| Cmd+K | 清空当前会话 |
| Cmd+, | 打开设置 |
| Cmd+\` | 切换终端 |
| Cmd+1~9 | 切换到第 N 个会话 |

### 3.2 状态管理：9 个 Zustand Store

| Store | 职责 | 关键数据 |
|-------|------|----------|
| session-store | 会话核心（最大） | projects, messages, sessionStates, drafts |
| settings-store | 全局设置 | theme, config, activeTab |
| model-store | 模型配置 | groups(多 Provider), activeModelId |
| agent-store | Sub-Agent 状态 | agents(toolEvents, textOutput) |
| team-store | Team Mode | teams, events, conversations |
| ide-store | IDE 集成 | connections, selection, atMentions |
| background-task-store | 后台任务 | tasks(shell/agent/team) |
| terminal-store | 终端面板 | visible, height, terminalId |
| toast-store | Toast 通知 | toasts(success/error/info) |

**数据流模式**:
```
Core (main process) → IPC events → ipc-client.ts → useSession.ts → Zustand Store → React 组件
```

**跨 Store 协同**: 切换会话时 session-store 重置 team-store、background-task-store、ide-store。

### 3.3 主题系统

#### 三层控制

```
CSS 变量层 (index.css) ← HTML data 属性 (dataset.theme) ← Zustand Store (settings-store)
```

#### 语义化色彩变量

| 变量 | Light | Dark |
|------|-------|------|
| `--bg` | `#f7f5ef` | `#111215` |
| `--surface` | `#ffffff` | `#17191d` |
| `--text` | `#1e1d1a` | `#f4f0e8` |
| `--accent` | `#1f1d1a` | `#f4f0e8` |
| `--good` | `#7e9f7a` | `#9bb693` |
| `--warn` | `#a07c37` | `#d0b57d` |
| `--bad` | `#a35b53` | `#d29b94` |

#### 三种模式

- **Light**: `:root` 默认
- **Dark**: `[data-theme="dark"]` 选择器覆盖
- **System**: `@media (prefers-color-scheme: dark)` + JS 监听 matchMedia

#### 字体体系

```css
--font-serif: "Iowan Old Style", "Baskerville", "Georgia", serif
--font-sans: "SF Pro Display", "Geist Sans", "Helvetica Neue", sans-serif
--font-mono: "Geist Mono", "SF Mono", "JetBrains Mono", monospace
```

### 3.4 流式渲染机制

#### 端到端数据流

```
Provider.stream() (core)
  → AsyncGenerator<StreamChunk>
    → runLoop (Electron main)
      → webContents.send('query:stream', { sessionId, chunk })
        → preload.ts → ipc-client.ts → useSession.ts
          → session-store 增量更新
            → ConversationTurn.tsx 实时渲染
```

#### StreamChunk 类型处理

| chunk.type | 处理 |
|------------|------|
| `thinking_delta` | 追加思考文本，标记 isThinking=true |
| `text_delta` | 追加正文文本，清除 isThinking |
| `compact_start/complete/failed` | 压缩状态管理 |

#### Agentic Loop 渲染

```
1. Provider 生成 assistant message（含 tool_use）
2. onComplete → 清空流式状态
3. Tool 执行 → toolEvents 实时更新 ToolCard
4. Tool 结果注入 → 新一轮 runLoop
5. 循环直到最终 text 响应
```

#### 消息队列

streaming 期间用户新消息自动入队，完成后通过 `dequeueMessage()` 自动发送下一条。

---

## 第四章：Electron 桌面端

桌面端位于 `packages/electron/`，基于 Electron 33 构建，负责进程管理、IPC 通信、系统集成。

### 4.1 主进程架构

#### 启动流程

1. `setupFileLogger()` — 日志重定向到 `~/Library/Logs/JDC Code/main.log`
2. 全局异常捕获 — `process.on('uncaughtException')`
3. 服务实例化 — SessionManager、GitService、AppLauncher、TerminalService（单例）
4. Auto-Updater 配置 — `autoDownload: false`, 5 秒首次检查，30 分钟轮询
5. `app.whenReady()` → Dock 图标 → SessionManager 就绪 → 注册 IPC → 创建窗口 → 初始化 MCP

#### 窗口配置

```typescript
{
  titleBarStyle: 'hiddenInset',        // macOS 无边框 + 交通灯
  contextIsolation: true,              // 安全隔离
  nodeIntegration: false,              // 禁止渲染进程直接访问 Node
  sandbox: false,                      // 关闭沙箱（node-pty 需要）
}
```

### 4.2 IPC 通信设计（94 个频道）

#### 三种通信模式

| 模式 | 方向 | 示例 |
|------|------|------|
| `ipcMain.handle` | 渲染→主（请求/响应） | `session:create`, `query:send` |
| `ipcMain.on` | 渲染→主（单向） | `permission:response`, `terminal:write` |
| `webContents.send` | 主→渲染（推送） | `query:stream`, `terminal:data` |

#### 频道分组（10 个功能域）

| 域 | 频道数 | 核心功能 |
|----|--------|----------|
| Session | 12 | create/list/switch/delete/rename/model/permission/compact |
| Query | 5 | send/abort/stream/tool-event/complete/error/retrying |
| Agent | 4 | progress/text/complete/abort |
| File | 6 | get-changes/history/rewind/accept |
| Git | 11 | branch CRUD/status/stash/watch |
| Terminal | 6 | create/write/resize/destroy/data/exit |
| MCP | 4 | list/reconnect/toggle/save-config |
| CodeGraph | 4 | init/reindex/dismiss/state |
| IDE | 5 | get-state/open-file/open-diff/diagnostics |
| Background/Team | 8 | list/stop/output/events/send |

### 4.3 系统集成服务

#### SessionManager — 核心桥接层

连接 `@jdcagnet/core` 与 Electron IPC：
- 多会话生命周期管理
- Provider 实例化（Anthropic/OpenAI Chat/OpenAI Responses）
- 权限请求/AskUser/PlanReview 的异步回调（Promise + Map）
- SQLite (sql.js) 持久化会话历史

#### TerminalService — 真实终端

- 基于 `node-pty` 实现
- 跨平台 shell 检测：macOS 用 `$SHELL`/`/bin/zsh`，Windows 用 `%COMSPEC%`/`cmd.exe`
- Windows 自动 `chcp 65001` 设置 UTF-8

#### GitService — Git 操作

- 分支管理：list/switch/create/delete
- 实时分支监听：`fs.watch` 监听 `.git/HEAD`、`.git/refs/heads/`，200ms 防抖

#### AppLauncher — IDE 检测

检测 13 种本地 IDE/终端（VS Code、Cursor、Windsurf、Zed、IntelliJ 系列、Xcode、iTerm2 等），结果缓存。

### 4.4 构建与分发

#### esbuild 双入口构建

```
main.ts → dist/main.js (CJS, bundled, minified)
  - external: electron, node-pty, sharp
  - alias: @jdcagnet/core → 源码直接引用

preload.ts → dist/preload.js (CJS, bundled, minified)
  - external: electron
```

#### electron-builder 三平台打包

| 平台 | 格式 | 签名 |
|------|------|------|
| macOS | DMG + ZIP | hardenedRuntime + notarytool 公证 |
| Windows | NSIS | 无签名（SmartScreen 警告） |
| Linux | AppImage + deb | 无签名 |

#### macOS 代码签名流程

1. Base64 解码证书 → `cert.p12`
2. 创建临时 Keychain `build.keychain`
3. 导入证书 + 设置 partition list
4. 禁用 OCSP/CRL 检查（CI 环境）
5. afterSign hook → `@electron/notarize` notarytool 公证

---

## 第五章：IDE 插件架构

JDCAGNET 通过 IDE 插件实现与编辑器的双向通信，支持 VS Code 和 JetBrains 两大平台。

### 5.1 统一通信协议

两个插件共享相同的通信协议：
- **协议**: JSON-RPC 2.0 over WebSocket
- **发现机制**: `~/.jdcagnet/ide/<port>.lock` 锁文件
- **绑定地址**: `127.0.0.1`（仅本地）
- **端口**: 动态分配

### 5.2 VS Code 扩展

**路径**: `packages/vscode-extension/`（TypeScript, 9 个源文件）

#### 激活流程 (extension.ts)

```typescript
activate(context) {
  1. 注册 diff 虚拟文档 provider (jdcagnet-diff scheme)
  2. 检测 IDE 产品 (Cursor/Windsurf/VSCodium/Code-OSS/VS Code)
  3. 启动 WebSocket 服务器（ws 库，随机端口）
  4. 写入锁文件（含 authToken）
  5. 启动选择追踪（300ms 防抖）
  6. 注册 @mention 右键命令
}
```

#### RPC 方法

| 方法 | 功能 |
|------|------|
| `initialize` | 验证 authToken，返回能力列表 |
| `openFile` | 打开文件并跳转到指定行列 |
| `openDiff` | 显示 diff 视图（虚拟文档） |
| `closeTab` / `closeAllDiffTabs` | 关闭 diff Tab |
| `getDiagnostics` | 获取文件诊断信息 |

#### 通知（插件 → CLI）

- `selection_changed`: 用户选择文本变化
- `at_mentioned`: 右键菜单触发 @mention

#### 能力声明

```typescript
capabilities: ['openFile', 'openDiff', 'getDiagnostics', 'selection', 'atMention']
```

### 5.3 JetBrains 插件

**路径**: `packages/jetbrains-plugin/`（Kotlin, 9 个源文件）

#### 技术栈

- IntelliJ Platform (Community Edition, build >= 231)
- Kotlin 1.9.22 + Java 17
- Ktor 2.3.7 (Netty engine) — WebSocket 服务器
- Gson 2.10.1 — JSON 序列化

#### 生命周期 (AppLifecycleListener)

```kotlin
appFrameCreated() {
  1. 检测 IDE 产品信息 (ApplicationNamesInfo API)
  2. 创建锁文件管理器（生成 authToken）
  3. 组装 RPC 处理器
  4. 启动 Ktor WebSocket 服务器
  5. 延迟 2s 写锁文件（等待项目加载）
  6. 监听项目打开/关闭事件
  7. 启动选择追踪 (SelectionListener + FileEditorManagerListener)
  8. 注册 @mention 回调 (AnAction)
}
```

#### 线程模型

| 操作 | 线程 | 机制 |
|------|------|------|
| WebSocket 消息接收 | Ktor Netty 线程 | 协程 |
| 文件打开 | EDT | `ApplicationManager.invokeLater` |
| 文档读取 | Read Action | `ReadAction.run` |
| 选择事件 | EDT | SelectionListener 回调 |

### 5.4 两平台对比

| 维度 | VS Code | JetBrains |
|------|---------|-----------|
| 语言 | TypeScript | Kotlin |
| WebSocket | ws (npm) | Ktor Netty |
| 并发模型 | 单线程事件循环 | 协程 + ConcurrentHashMap |
| 生命周期 | activate/deactivate | AppLifecycleListener |
| Diff 支持 | ✅ 完整（虚拟文档） | ❌ stub |
| Diagnostics | ✅ 完整 | ❌ stub（返回空列表） |
| IDE 检测 | 关键词匹配 | API 查询 |
| 构建 | esbuild → CJS | Gradle → JAR/ZIP |
| 产物 | .vsix | .zip (distributions) |

### 5.5 与 Core 的接口契约

共享类型定义在 `packages/core/src/ide/types.ts`：
- `IdeLockfile` — 锁文件结构
- `SelectionData` / `AtMentionData` — 编辑器事件数据
- `OpenDiffParams` / `Diagnostic` — RPC 参数

Core 通过 `scanLockfiles()` 扫描 `~/.jdcagnet/ide/*.lock` 发现 IDE 实例，验证进程存活和 authToken 后建立 WebSocket 连接。

---

## 第六章：DevOps 工程化

### 6.1 CI/CD 流水线

**文件**: `.github/workflows/release.yml`

#### 触发条件

```yaml
on:
  push:
    tags: ['v[0-9]*']    # tag 推送触发
  workflow_dispatch:       # 手动触发
```

#### 4 个并行 Job

| Job | Runner | 产物 |
|-----|--------|------|
| release-mac | macos-latest | .dmg, .zip, .blockmap, latest-mac.yml |
| release-windows | windows-latest | .exe, .blockmap, latest.yml |
| release-vscode | ubuntu-latest | .vsix |
| release-jetbrains | ubuntu-latest | .zip (Gradle distributions) |

#### Mac 签名流程

```
1. checkout → pnpm → node → python(setuptools)
2. pnpm install → pnpm build → fetch-codegraph
3. Import signing certificate (Base64 → cert.p12 → 临时 keychain)
4. pnpm package (electron-builder, timeout: 5min)
5. softprops/action-gh-release 上传产物
```

### 6.2 自动化脚本

#### scripts/dev.ts — 开发环境编排

```
1. 启动 Vite dev server (BROWSER=none)
2. 等待 5 秒
3. 构建 Electron 主进程 (node build.mjs)
4. 启动 Electron (npx electron ., NODE_ENV=development)
5. SIGINT/SIGTERM 统一清理子进程
```

#### scripts/fetch-codegraph.ts — CodeGraph 二进制获取

- 多平台支持: darwin-arm64, darwin-x64, win32-x64, win32-arm64
- 代理支持: `HTTPS_PROXY` + `undici.ProxyAgent`
- SHA256 校验: 硬编码每个平台的 hash 值
- Smoke test: 下载后执行 `codegraph --version` 验证

#### scripts/notarize.js — macOS 公证

- afterSign hook，使用 `@electron/notarize` notarytool
- 环境变量驱动: `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`
- 缺少环境变量时优雅跳过

### 6.3 构建流水线

```
pnpm build (递归)
  ├── @jdcagnet/core: tsc → dist/
  ├── @jdcagnet/ui: vite build → dist/
  └── jdcagnet (electron): node build.mjs
       ├── esbuild main.ts → dist/main.js
       ├── esbuild preload.ts → dist/preload.js
       ├── 复制 sql-wasm.wasm → dist/
       └── 复制 ui/dist/ → electron/ui/

electron-builder
  ├── 读取 electron-builder.yml
  ├── npmRebuild (node-pty)
  ├── extraResources (codegraph 二进制)
  ├── 平台打包 (dmg/nsis/AppImage)
  └── 发布到 GitHub Releases
```

### 6.4 发布流程

```
1. 修改 packages/electron/package.json 中的 version
2. git commit -m "release: vX.Y.Z"
3. git tag vX.Y.Z
4. git push origin main --tags（需要 HTTPS 代理）
5. GitHub Actions 自动触发 4 个并行 Job
6. 产物上传到 GitHub Release
7. 客户端 electron-updater 检测新版本并自动更新
```

### 6.5 安全策略

- Apple 证书通过 GitHub Secrets 注入（Base64 编码）
- 临时 keychain 隔离（`build.keychain`）
- CodeGraph 二进制 SHA256 完整性校验
- 120 秒超时防止挂起
- 无 Docker layer 缓存（直接在 runner 上构建）

### 6.6 当前限制

- macOS 仅构建当前 runner 架构（未使用 universal binary）
- Windows 无代码签名（SmartScreen 警告）
- Linux 目标在配置中定义但 workflow 无对应 Job
- VS Code 扩展使用 npm 而非 pnpm（独立于 monorepo）
- Release workflow 中无自动化测试步骤

---

## 第七章：讲解大纲

### 建议时间分配（总计 90 分钟）

| 章节 | 时间 | 重点 |
|------|------|------|
| 项目架构总览 | 10 min | monorepo 结构、技术栈选型理由 |
| 核心引擎 — Session & Agent | 15 min | ⭐ 会话生命周期、Agent 类型系统 |
| 核心引擎 — Team Mode | 15 min | ⭐⭐ 三层架构、AI PM、并发控制 |
| 核心引擎 — Tool/MCP/Provider | 10 min | 管道式执行、多模型适配 |
| 核心引擎 — Memory/Compact/Hooks/Skills | 10 min | 两级压缩、钩子拦截 |
| 前端 UI | 10 min | Zustand 状态管理、流式渲染链路 |
| Electron 桌面端 | 8 min | IPC 设计、系统集成 |
| IDE 插件 | 7 min | 双平台对比、通信协议 |
| DevOps | 5 min | CI/CD 流水线、签名公证 |

### 讲解要点

#### 开场（5 min）
- 项目定位：AI 驱动的桌面开发环境
- 核心价值：多模型适配 + 多智能体协作 + IDE 集成
- 技术亮点预告

#### 第一部分：架构全景（10 min）
- pnpm monorepo 5 包结构
- 分层架构图（IDE → Electron → Core）
- 技术栈选型决策（为什么选 Zustand 而非 Redux，为什么选 esbuild 而非 webpack）

#### 第二部分：核心引擎（50 min）⭐ 重点

**Session 会话管理（10 min）**
- 中央协调器角色
- sendMessage → runLoop 主循环
- 渐进式压缩策略（micro + full）

**Agent 调度（5 min）**
- 6 种代理类型的设计哲学
- 工具白名单 + 递归防护
- 读并行 + 写串行策略

**Team Mode（15 min）⭐⭐ 核心亮点**
- 三层架构演示
- AI PM 决策流程（15 种 Action）
- 并发控制（文件锁 + 分类限制）
- kick_member 抢救机制
- 工作空间文件系统

**Tool/MCP/Provider（10 min）**
- 管道式工具执行（权限→钩子→执行）
- MCP 双传输层（stdio/sse）
- Provider 缓存路由策略

**Memory/Compact/Hooks/Skills（10 min）**
- 记忆提取与覆盖策略
- 8 段结构化摘要
- 钩子拦截机制
- SkillRouter 智能匹配

#### 第三部分：前端与桌面端（15 min）
- 9 个 Zustand Store 的职责划分
- 流式渲染端到端链路
- 94 个 IPC 频道的分组设计
- macOS 签名与公证流程

#### 第四部分：IDE 插件（7 min）
- JSON-RPC 2.0 + Lockfile 发现机制
- VS Code vs JetBrains 实现对比
- 功能差距分析

#### 收尾（3 min）
- 跨模块设计模式总结（失败开放、心跳超时、邮箱解耦）
- 未来改进方向

---

## 第八章：QA 样例及参考答案

### Q1: 为什么选择 pnpm monorepo 而非独立仓库？

**参考答案**: pnpm workspace 提供高效磁盘利用（硬链接）、原生 workspace 协议支持、以及 `pnpm -r build` 递归构建能力。monorepo 使得 `@jdcagnet/core` 可以通过 esbuild alias 直接源码引用，避免发布步骤。同时 IDE 插件的类型定义（`packages/core/src/ide/types.ts`）可以被多个包共享。

### Q2: Session 类为什么要管理这么多子系统（30+ 属性）？

**参考答案**: Session 是中央协调器模式（Mediator Pattern）。它协调 Provider、ToolRunner、ParallelExecutor、MCP、Hooks、Skills 等子系统的交互。这种设计的优势是：子系统之间不直接耦合，所有协调逻辑集中在一处。代价是 Session 类较大，但通过分层加载（Hooks/Skills 异步加载）和委托模式（ToolRunner 独立执行管道）保持了可维护性。

### Q3: Team Mode 为什么需要 AI PM 而非简单的任务队列？

**参考答案**: AI PM 提供了三个关键能力：(1) 智能任务分解 — 根据目标自动拆分子任务并识别依赖关系；(2) 动态调度 — 根据 worker 完成情况重新分配、reopen 或 kick_member；(3) 质量控制 — 综合所有 worker 产出生成最终摘要。简单队列无法处理任务间的依赖、worker 卡住的抢救、以及最终结果的综合。

### Q4: 为什么 ParallelExecutor 采用"读并行 + 写串行"策略？

**参考答案**: 读操作（Read/Glob/Grep）天然无副作用，并行执行可以显著提升性能（Semaphore 限制 5 并发）。写操作（Edit/Write/Bash）可能产生竞态条件（如两个 Edit 同时修改同一文件），串行执行保证一致性。这是性能与正确性的最佳平衡点。

### Q5: Context Compaction 的两级策略有什么优势？

**参考答案**: microCompact 是轻量级操作（清除旧 tool results），每轮间运行，延缓昂贵的 full compact 触发。full compact 需要一次完整的 LLM 调用生成结构化摘要，成本高但效果好。两级策略使得大部分情况下 microCompact 就够用，只有上下文真正接近极限时才触发 full compact，节省了 token 消耗。

### Q6: MCP 集成为什么采用"全局 + 项目"双层配置？

**参考答案**: 全局配置（`~/.jdcagnet/mcp-servers.json`）存放通用工具（如 codegraph），项目配置（`.jdcagnet/mcp-servers.json`）存放项目特定工具。项目配置覆盖全局配置，允许同名服务器在不同项目中有不同配置。这与 Git 的全局/项目配置模式一致。

### Q7: Provider 的 Prompt Caching 策略是如何工作的？

**参考答案**: Anthropic Provider 使用 `cache_control: { type: 'ephemeral' }` 标记缓存断点，最多 4 个断点（tools 1 个 + last user message 1 个 + system 2 个）。OpenAI Chat Provider 使用 `prompt_cache_key` 参数路由到同一缓存分片，同一角色（main/worker/PM）使用相同 cacheKey（如 `worker:explore`），确保同类型 worker 共享缓存。

### Q8: Permission 系统的"拒绝追踪"解决了什么问题？

**参考答案**: 当用户拒绝某个命令后，`recordDenial()` 记录该拒绝。后续相同命令通过 `isDenied()` 检查直接跳过，避免 AI 反复尝试同一被拒命令导致无限弹窗。这是用户体验优化 — 一次拒绝等于永久拒绝（本会话内）。

### Q9: Hooks 系统的 PreToolUse 如何实现工具拦截？

**参考答案**: PreToolUse 钩子通过 `child_process.exec` 执行外部命令，stdin 传入 JSON 格式的 HookInput（包含 toolName 和 input），stdout 解析 JSON。如果返回 `{ decision: 'block', reason: '...' }`，ToolRunner 立即中断执行并返回 block 原因。这允许用户通过外部脚本实现自定义安全策略。

### Q10: Electron 的 IPC 为什么采用"集中式频道定义 + 分模块注册"？

**参考答案**: `ipc-channels.ts` 使用 `as const` 对象集中定义所有 94 个频道名，提供编译时类型安全（拼写错误会被 TypeScript 捕获）。分模块注册（`ipc-handlers.ts` + `mcp-ipc.ts`）保持代码组织清晰。这比分散定义字符串常量更安全，比单文件注册所有 handler 更可维护。

### Q11: VS Code 和 JetBrains 插件为什么使用 Lockfile 发现机制？

**参考答案**: Lockfile 机制（`~/.jdcagnet/ide/<port>.lock`）解决了"CLI 如何发现正在运行的 IDE 实例"的问题。插件启动时写入锁文件（含端口、authToken、workspace 路径），CLI 扫描锁文件目录即可发现所有活跃 IDE。authToken 防止未授权连接，进程存活检查（pid）自动清理僵尸锁文件。

### Q12: Team Mode 的 kick_member 机制是如何工作的？

**参考答案**: 当 PM 检测到 worker 卡住时，可以执行 kick_member 操作：(1) 最多 kick 2 次/任务（防止无限循环）；(2) Abort 旧 sub-session；(3) 使用 queueMicrotask 确保异步拆卸完成；(4) 重新创建 TeamMember 实例；(5) 重新 assignTask。这是一种"抢救"机制，比直接 fail 任务更优雅。

### Q13: 为什么 Electron 构建选择 esbuild 而非 webpack？

**参考答案**: esbuild 提供极快的构建速度（毫秒级），适合开发迭代。Electron 主进程代码相对简单（无复杂 loader 需求），esbuild 的 bundle + minify 完全够用。通过 `alias` 配置直接引用 `@jdcagnet/core` 源码，避免了 workspace 依赖发布步骤。CJS 格式是 Electron 33 preload 的兼容性要求。

### Q14: 流式渲染如何处理 Agentic Loop（多轮工具调用）？

**参考答案**: 每轮 assistant message 完成时（onComplete），清空流式状态（streamingText/thinkingText/toolEvents）。Tool 执行期间通过 onToolEvent 实时更新 ToolCard 状态。Tool 结果注入后触发新一轮 runLoop，Provider 生成下一个 assistant message。UI 通过 SessionStreamState 的 isStreaming 标志区分"正在生成"和"等待工具执行"两种状态。

### Q15: Memory 系统的 shouldOverwrite 策略为什么不是简单覆盖？

**参考答案**: 简单覆盖会导致信息丢失（旧记忆可能包含仍然有效的内容）。shouldOverwrite 使用两个启发式规则：(1) 新内容长度 > 旧的 1.2 倍 → 说明有实质性扩展；(2) 新内容有 >30% 全新行 → 说明有实质新信息。相同内容直接跳过避免无意义写入。这在"保留有效信息"和"更新过时信息"之间取得平衡。

### Q16: Team Mode 的并发控制为什么按 agentType 分类限制？

**参考答案**: 不同类型的操作对系统资源的影响不同：读操作（explore/plan）无副作用，可以高并发（maxReadOnlyWorkers: 8）；写操作可能产生文件冲突（maxWriteWorkers: 5）；Shell 操作消耗系统资源且可能有副作用（maxShellWorkers: 2）。分类限制比统一限制更精细，既保证了读操作的高吞吐，又防止了写操作的竞态。

### Q17: 为什么 macOS 签名需要 hardenedRuntime 和特殊 entitlements？

**参考答案**: Apple Notarization 要求 hardenedRuntime。但 Electron 的 V8 引擎需要 JIT 编译（`allow-jit`），node-pty 需要无签名可执行内存（`allow-unsigned-executable-memory`），某些原生模块需要 DYLD 环境变量（`allow-dyld-environment-variables`）。这些 entitlements 是 Electron + node-pty 正常运行的最小权限集。

### Q18: Zustand 相比 Redux 在这个项目中的优势是什么？

**参考答案**: (1) 零 Provider 包裹 — 不需要在组件树顶层包裹 Provider；(2) 选择器模式 — 细粒度订阅避免不必要的重渲染（如 streamingText 变化只触发 ConversationTurn 重渲染）；(3) 简洁 API — 9 个 Store 各自独立，无 action/reducer 样板代码；(4) 跨 Store 通信简单 — 直接 `useXxxStore.getState()` 读取其他 Store。

### Q19: CodeGraph 集成的"自动检测 + 提示词注入"设计有什么好处？

**参考答案**: 当 `.codegraph/codegraph.db` 存在时，系统自动注入提示词段，引导 AI 优先使用 codegraph 工具而非 grep+Read。这是"零配置"设计 — 用户只需运行 `codegraph init`，后续所有会话自动获得代码图谱能力。同时 `mcp-default.ts` 自动生成 MCP 配置，无需手动编辑 `mcp-servers.json`。

### Q20: 跨模块的"失败开放"（Fail-Open）设计模式体现在哪些地方？

**参考答案**: 多个可选子系统失败时不影响核心功能：(1) Hooks 加载失败 → 无钩子继续运行；(2) Skills 加载失败 → 无 skills 继续；(3) SkillRouter 调用失败 → 返回 `{ pmSkill: null, workerSkill: null }`；(4) MCP 工具调用失败 → 返回 isError + 错误描述而非崩溃；(5) CodeGraph 未初始化 → 不注入提示词段。这确保了核心对话功能的高可用性。

---

*报告基于 JDCAGNET 项目源码分析生成，覆盖 packages/core、packages/ui、packages/electron、packages/vscode-extension、packages/jetbrains-plugin 全部子包。*
