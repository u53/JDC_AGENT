# CodeGraph 集成设计

- **日期**: 2026-05-25
- **作者**: cmx
- **状态**: 待实施

## 背景

[CodeGraph](https://github.com/colbymchenry/codegraph) 是一个本地优先的代码知识图谱工具，通过 tree-sitter 解析源码，将符号、调用关系、引用等存入 SQLite + FTS5 索引，并以 MCP server 的形式暴露给 AI agent。官方基准测试显示，在大型代码库上能为 AI 探索任务节省约 57% token 和 71% 工具调用。

当前 JDC Code 的 AI agent 在探索代码库时主要依赖 grep / glob / Read 等工具，对大型项目效率不佳。我们计划将 CodeGraph 内置到 JDC，让所有用户开箱获得这项能力，特别是为国内用户避免 GitHub Release / npm 镜像问题。

## 目标

1. JDC 安装包内置 CodeGraph binary，国内用户零额外网络依赖即可使用
2. 项目级索引由用户主动选择是否建立（带顶部横条引导）
3. AI 主会话、子代理（explore/plan/refactor/security-auditor/general）、Team worker 都能使用 CodeGraph 工具
4. 会话切换时正确路由到对应项目的索引
5. 任何环节失败都不影响 JDC 主流程

## 非目标

- 不为每个项目启动独立 CodeGraph MCP 进程（CodeGraph 本身支持多项目，单进程即可）
- 不自动初始化项目索引（用户主动同意，避免大型项目首次打开卡顿）
- 不打 Linux 安装包（JDC 现有 release 也未覆盖 Linux）
- 不替换现有 grep / Read 流程（CodeGraph 是增强而非替代）

## 关键事实

通过对 codegraph 仓库与 npm 包的调研：

1. **npm 包是 stub**：`@colbymchenry/codegraph` 包本体仅 37.8KB，真正运行时打包在 GitHub Release 的平台 tarball 中
2. **平台 binary 大小**：mac-arm64 46.6MB / mac-x64 47.8MB / win-x64 42.5MB / win-arm64 38.6MB（gz 压缩）
3. **MCP 工具支持 `projectPath` 参数**：`tools.ts:295` 起每个工具都有可选 `projectPath`，server 内部 `projectCache` 缓存多项目实例
4. **不传 `projectPath` 时**：回退到 `process.cwd()`，多项目场景下不可靠
5. **JDC 现有 `McpManager` 是全局单例**（`session-manager.ts:39`），所有 session 共享

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  Release CI (.github/workflows/release.yml)                  │
│  ─ 每平台 runner 在 build 之前执行                           │
│    scripts/fetch-codegraph.ts → 拉对应 tarball/zip → 解压到  │
│    packages/electron/resources/codegraph/<platform-arch>/    │
│    冒烟测试: codegraph --version  必须 0 退出                │
└──────────────────────────────────────────────────────────────┘
                              ↓ 打包进 .dmg / .exe
┌──────────────────────────────────────────────────────────────┐
│  JDC 客户端 (Electron)                                       │
│                                                              │
│  packages/core/src/codegraph/  (新模块)                      │
│   ├ binary.ts       定位 binary（dev / packaged 路径解析）   │
│   ├ project.ts      isInitialized / init / forceReindex      │
│   ├ mcp-default.ts  生成默认 MCP server 配置                 │
│   ├ prompt.ts       项目有 .codegraph/ 时返回 prompt 片段    │
│   └ index.ts        桶状导出                                 │
│                                                              │
│  集成点：                                                    │
│   ① mcp/manager.ts       启动时自动注入 codegraph MCP 配置   │
│   ② session.ts           构造 system prompt 时调 prompt 模块 │
│   ③ agent-types.ts       新增 allowedMcpServers 字段         │
│                          explore/plan/refactor/auditor 放行  │
│   ④ session-manager.ts   activate 时推送项目索引状态给 UI    │
│   ⑤ tool-runner.ts       拦截器：缺 projectPath 时自动注入   │
│   ⑥ ui                   顶部横条 + Settings 详情页          │
└──────────────────────────────────────────────────────────────┘
```

## 设计原则

1. **codegraph 视作被托管的 stdio MCP 服务**，沿用现有 `McpManager` 全套生命周期
2. **所有新逻辑集中在 `packages/core/src/codegraph/` 目录** + 6 个集成点；删除即完整回滚
3. **CodeGraph 失败不影响 JDC 主流程**：找不到 binary、连接失败、子进程崩溃都有兜底
4. **多项目共享一个 codegraph 子进程**：每次工具调用显式传 `projectPath`，由 server 内部缓存多个 graph 实例

## 文件改动清单

### 新增文件

```
scripts/fetch-codegraph.ts                      拉取并解压 codegraph binary
packages/core/src/codegraph/binary.ts           定位 binary 路径（dev / packaged）
packages/core/src/codegraph/project.ts          init / status / forceReindex
packages/core/src/codegraph/mcp-default.ts      默认 MCP server 配置生成
packages/core/src/codegraph/prompt.ts           system prompt 片段
packages/core/src/codegraph/index.ts            桶状导出
packages/core/src/codegraph/__tests__/*.test.ts 单元测试
```

### 修改文件

```
.github/workflows/release.yml                   macOS/Windows runner 加 fetch 步骤
electron-builder.yml                            extraResources 包含 resources/codegraph/
packages/core/src/mcp/manager.ts                启动时合并默认 codegraph 配置
packages/core/src/agent-types.ts                新增 allowedMcpServers + 过滤逻辑
packages/core/src/session.ts                    拼 system prompt 时调 codegraph/prompt
packages/core/src/tool-runner.ts                MCP 工具拦截器自动注入 projectPath
packages/electron/src/session-manager.ts        activateSession 推送项目状态给 UI
packages/ui/<新增/修改>                         顶部横条 + MCP 详情页
```

## 核心接口

### `packages/core/src/codegraph/binary.ts`

```typescript
// dev: packages/electron/resources/codegraph/<host>/bin/codegraph
//      若不存在则尝试 PATH / npx
// packaged: process.resourcesPath/codegraph/<platform-arch>/bin/codegraph
export function resolveCodegraphBinary(): string | null
export function isCodegraphAvailable(): boolean
```

### `packages/core/src/codegraph/mcp-default.ts`

```typescript
// 启动时调用：用户的全局 mcp-servers.json 没有 'codegraph' 键时合并这一条
// 用户能在 UI 里禁用、删除，我们不强行覆盖
export function getDefaultCodegraphMcpConfig(): McpStdioConfig | null
//  → { transport: 'stdio', command: <resolved binary>, args: ['serve', '--mcp'] }
//  → 解析不到 binary 时返回 null
```

### `packages/core/src/codegraph/project.ts`

```typescript
export function isInitialized(cwd: string): boolean
export function getStatus(cwd: string): Promise<{
  symbols: number
  lastIndexed: number
} | null>
export function init(cwd: string, onProgress?: (line: string) => void): Promise<void>
export function forceReindex(cwd: string, onProgress?: (line: string) => void): Promise<void>
```

### `packages/core/src/codegraph/prompt.ts`

```typescript
// 项目有 .codegraph/ 时返回引导片段；没有时返回空串
// cwd 嵌入引导文本中，要求模型调用 codegraph 工具时显式传 projectPath
export function getCodegraphPromptSegment(cwd: string): {
  segment: string
  cacheable: false   // cwd 变化频繁，不进缓存前缀
}
```

引导内容（约 200 tokens）：

> 本项目已有 CodeGraph 索引（`.codegraph/`）。回答「X 怎么实现」「X 调用了什么」「改 X 影响哪些代码」这类架构、调用链、影响面问题时，**优先调用 `mcp__codegraph__codegraph_*` 工具**，不要委派 Explore 子代理去 grep/Read 重做这件事。返回的源码是权威来源，无需再次 Read。
>
> 调用 `mcp__codegraph__codegraph_*` 工具时，**必须传 `projectPath: "<cwd>"`**。本会话项目路径：`{cwd}`。不要省略此参数，多项目同时打开时省略会查到错的项目。

### `packages/core/src/agent-types.ts` 改动

```typescript
export interface AgentTypeDefinition {
  // 现有字段保持不变
  allowedMcpServers?: string[]   // 新增；undefined/[] = 一律不放行；'*' = 全部放行
}
```

各 agent 类型默认值：

| Agent | allowedMcpServers | 理由 |
|---|---|---|
| `explore` | `['codegraph']` | 找代码最需要，codegraph 全是只读 |
| `plan` | `['codegraph']` | 写 plan 前要分析架构 |
| `refactor` | `['codegraph']` | 改之前要看影响面（impact） |
| `security-auditor` | `['codegraph']` | 看调用链找污染源 |
| `frontend-designer` | `[]` | 不需要 |
| `general` | `['*']` | 已有 `allowedTools: ['*']`，全部放行 MCP |

`filterToolsForAgent` 修改：

```typescript
export function filterToolsForAgent(agentType, allTools): ToolDefinition[] {
  // 现有 FORBIDDEN_FOR_SUBAGENT 逻辑保持
  // 现有 typeDef.allowedTools 白名单逻辑保持
  // 新增：MCP 工具按 server 名 opt-in
  // mcp 工具命名格式: mcp__<server>__<tool>
  const mcpAllow = typeDef?.allowedMcpServers ?? []
  // 对名字以 mcp__ 开头的工具，提取 server 部分，按 mcpAllow 决定保留
}
```

### MCP 工具拦截器（`tool-runner.ts` 或对应模块）

```typescript
// 调 mcp__codegraph__* 工具时
if (toolName.startsWith('mcp__codegraph__') && !input.projectPath) {
  input = { ...input, projectPath: session.cwd }
}
```

模型忘了传，自动补上；模型显式传了别的 path（如跨项目查询），尊重模型决定。

## 数据流

### 启动时

```
JDC 启动
  → mcp/manager.ts 加载用户的 mcp-servers.json
  → codegraph/mcp-default.ts 检查：没有 'codegraph' 键？
      → 是 → 注入默认配置（in-memory，不写盘 — 用户禁用后我们尊重）
  → 启动所有 MCP 服务器（包括 codegraph 的 stdio 子进程）
  → codegraph 子进程启动 watcher，开始增量同步
```

### 项目打开时

```
用户切换 / 打开 session
  → session-manager.ts:activateSession
  → 检查 .codegraph/codegraph.db 是否存在
  → 检查 settings.json 中 dismissedCodegraphForCwds 列表
  → IPC 推 codegraph:project-state {cwd, initialized, dismissed}
  → UI store 更新 → 顶部横条按状态渲染

横条「开始」点击
  → IPC 调 codegraph/project.init(cwd)
  → 子进程: codegraph index <cwd>，stdout 转进度事件推 UI
  → 完成后再次推 codegraph:project-state（initialized: true）
  → 横条变绿色 5 秒后消失

横条「不再提示」点击
  → 写入 settings.json 的 dismissedCodegraphForCwds 列表
```

### 会话内提问时

```
session.ts 拼 system prompt
  → 调 codegraph/prompt.getCodegraphPromptSegment(cwd)
  → 项目有 .codegraph/ → 拼上引导片段（含 cwd）；没有 → 不拼
  → 引导段放在 inherited 段末尾（可缓存稳定段之后），避免破坏前缀缓存

模型调 mcp__codegraph__* 工具
  → tool-runner 拦截器：缺 projectPath → 自动注入 session.cwd
  → 转发给 McpManager → codegraph 子进程
  → server 内 projectCache 按 path 命中或加载对应 graph
  → 返回结果

子代理 / Team worker 派发
  → sub-session.ts 沿用主 session 的 systemPrompt（已含引导）
  → filterToolsForAgent 按 allowedMcpServers 放行 codegraph 工具
  → TOOL_WHITELIST_OVERRIDE 自动包含放行的 codegraph 工具名
  → cwd 引导和 projectPath 自动注入对子代理同样生效
```

## CI 改动

### `.github/workflows/release.yml`

**macOS runner**（`pnpm package` 之前）：

```yaml
- name: Fetch CodeGraph binaries (latest)
  run: pnpm tsx scripts/fetch-codegraph.ts --platforms=darwin-arm64,darwin-x64
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Windows runner**：

```yaml
- name: Fetch CodeGraph binaries (latest)
  run: pnpm tsx scripts/fetch-codegraph.ts --platforms=win32-x64,win32-arm64
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

每个 runner 只拉自己平台的 binary。

### `scripts/fetch-codegraph.ts` 行为

1. 调 GitHub API 取 codegraph 最新 release tag
2. 按 `--platforms` 列表，下载每个 tarball/zip 到 `tmp/`
3. 校验 SHA256SUMS（release 自带）
4. 解压到 `packages/electron/resources/codegraph/<platform-arch>/`
5. 冒烟测试：跑 `./bin/codegraph --version`，必须 0 退出
   - 跑不通 → 退出码 1，整个 release 失败
6. 在 `packages/electron/resources/codegraph/VERSION` 写入版本号

冒烟测试只在 runner 自己平台的 binary 上跑（Windows runner 跑不了 darwin binary），其他平台 tarball 解压成功 + sha 校验通过即视作可用。

### `electron-builder.yml`

```yaml
extraResources:
  - from: packages/electron/resources/codegraph
    to: codegraph
    filter:
      - "**/*"
```

- **dev**: `pnpm tsx scripts/fetch-codegraph.ts --platforms=$(host)` 后 binary 在 `packages/electron/resources/codegraph/<host>/bin/codegraph`
- **packaged**: `process.resourcesPath/codegraph/<platform-arch>/bin/codegraph`

`binary.ts` 用 `app.isPackaged` 切换路径来源。

## 安装包大小

每个用户下载的安装包**只含本平台 binary**，不会装四份。预估增量：

| 平台 | tarball 压缩 | 解压后 | 实际安装包增量 |
|---|---|---|---|
| darwin-arm64 | 46.6 MB | ~120 MB | +30~40 MB |
| darwin-x64 | 47.8 MB | ~120 MB | +30~40 MB |
| win32-x64 | 42.5 MB | ~110 MB | +30~40 MB |
| win32-arm64 | 38.6 MB | ~95 MB | +25~35 MB |

JDC 当前安装包约 100~150 MB，加完 codegraph 约 130~190 MB。

## Linux 与 dev 模式

- 不出 Linux 安装包（JDC 现有 release 也无 Linux）
- Linux dev：`binary.ts` 解析失败 → 回退尝试 PATH 上的 `codegraph` → 仍失败则 `getDefaultCodegraphMcpConfig()` 返回 `null`，相当于自动禁用，日志提示开发者运行 `pnpm fetch-codegraph` 或全局 `npm i -g @colbymchenry/codegraph`

## 错误处理

| 失败点 | 兜底 |
|---|---|
| 找不到 binary（dev） | 默认配置返回 null，不注入服务 |
| MCP server 启动失败 | 沿用 McpManager 失败状态，不影响其他服务 |
| `codegraph init` 退出码非 0 | 横条变红 + 「查看日志」按钮；不重试 |
| `codegraph init` 卡死 | UI 提供「取消」按钮 SIGTERM 子进程 |
| watcher 子进程崩溃 | McpManager 自动重连 |
| 项目未初始化时调工具 | server 自身报错，模型回退到 grep/Read |
| 模型传错 projectPath | 尊重模型；只在「未传」时拦截器注入 |

**核心原则**：codegraph 是增强项，任何环节失败 JDC 都正常运行，只是没有索引加速。

## 测试

### 单元测试（vitest）

```
packages/core/src/codegraph/__tests__/
 ├ binary.test.ts         路径解析 dev/packaged
 ├ project.test.ts        isInitialized 真假；status 解析输出
 ├ mcp-default.test.ts    binary 不存在 → null；存在 → 配置形状
 └ prompt.test.ts         有/无 .codegraph/；cwd 嵌入正确

packages/core/src/__tests__/
 └ agent-types.test.ts (扩充)
   - allowedMcpServers: ['codegraph'] → mcp__codegraph__* 放行
   - allowedMcpServers: [] → mcp__* 全过滤
   - allowedMcpServers: ['*'] → 所有 mcp__* 放行
   - FORBIDDEN_FOR_SUBAGENT 仍生效
```

### 手动验收

PR 描述中列出，发版前 reviewer 跑一遍：

1. 全新装 JDC → Settings → MCP 看到 codegraph 服务为 `connected`
2. 打开未初始化项目 → 顶部横条出现 → 点开始 → 进度可见 → 完成横条变绿消失
3. 打开已初始化项目 → 不弹横条
4. 切换两个不同项目 → 横条按各自 `.codegraph/` 状态正确显示/隐藏
5. 切到项目 A 提问 → 模型调 `mcp__codegraph__codegraph_context` 且 `projectPath` 是 A 的路径
6. 派 explore 子代理 → 子代理能调 codegraph 工具
7. Team 模式派 worker → worker 能调 codegraph 工具
8. 禁用 codegraph 服务 → 重启 → 服务不再启动
9. 删 `.codegraph/` 后再提问 → 回退到 grep/Read，无致命错
10. 「不再提示」点击 → 同项目不弹横条；切到别的未初始化项目仍弹

CI 不跑端到端 Electron 测试，以上靠人工。

## 回滚策略

按代价排序：

1. **用户级**：Settings → MCP → 禁用 codegraph 服务 → 重启 JDC。文档中说明此路径，用户可自救
2. **配置级**：补丁版中将 `mcp-default.ts` 默认改为 `disabled: true`。用户更新后服务自动停止
3. **代码级**：`packages/core/src/codegraph/` 目录 + 6 个集成点全部 revert。所有逻辑集中在一个目录，单 PR revert 即可完整下线

`fetch-codegraph.ts` 永远拉最新 codegraph，回滚 JDC 不回滚 codegraph 版本。如 codegraph 某版本本身有问题，临时方案：在 `fetch-codegraph.ts` 加 `--version` 参数固定到上一稳定版（默认 latest，需要时 override）。

## 监控

不引入新遥测，沿用现有日志：

- codegraph MCP 服务连接/断开/失败 → 走 `McpManager` 现有事件路径
- `codegraph init` 子进程的 stdout/stderr → 写到 JDC 日志文件
- Settings 中显示 binary 路径与 codegraph 版本号，便于报 bug

## 开放问题

- **横条位置与样式**：实现阶段确定，遵循 JDC 现有顶部通知组件的设计语言
- **Settings 详情页布局**：是否单独开 CodeGraph 标签页，还是在 MCP 详情中扩展。倾向后者（统一入口）
- **dev 模式自动 fetch**：是否在 `pnpm dev` 启动时自动调一次 `fetch-codegraph.ts`（仅本平台），避免开发者手动操作。倾向是

这些不影响整体架构，留给实施阶段决策。
