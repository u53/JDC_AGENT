# JDCAGNET IDE Extensions Design Spec

## Overview

为 JDCAGNET 添加 VS Code 扩展和 JetBrains 插件，实现桌面应用与 IDE 之间的双向实时通信。AI 修改文件时可在 IDE 中显示 diff 供用户审查，IDE 中选中的代码可自动传给 AI 作为上下文，支持 @文件引用和诊断信息获取。

## Goals

1. 双向通信：JDC CODE 可调用 IDE 能力（打开文件、显示 diff、获取诊断），IDE 可向 JDC CODE 推送事件（选中代码、@引用）
2. 自动发现：用户打开 IDE 和 JDC CODE 后自动连接，无需手动配置
3. 独立于 MCP：不复用 MCP 配置体系，避免用户误删连接
4. 同时支持 VS Code 和 JetBrains 全家桶
5. GitHub Actions 自动构建，通过 Releases 分发

## Non-Goals

- 不上架 VS Code Marketplace 或 JetBrains Marketplace（后续可加）
- 不支持远程 IDE（仅 localhost）
- 不替代现有 file_edit 工具的直接写入行为（diff 审查是可选模式）

## Core Principles

1. **零侵入**: 用户未安装 IDE 扩展时，JDC CODE 所有功能正常运行，无报错、无降级
2. **项目级匹配**: 连接基于项目路径匹配 — JDC CODE 的工作空间 cwd 与 IDE 打开的 workspace folder 必须一致才建立连接
3. **主动提示**: 当检测到 IDE 打开了相同项目时，JDC CODE 在 UI 中显示连接状态提示，引导用户了解 IDE 集成功能

---

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────┐
│   IDE Extension         │         │   JDC CODE (Electron)    │
│   (WebSocket Server)    │◄───WS──►│   (WebSocket Client)     │
│                         │         │                          │
│  ┌───────────────────┐  │         │  ┌────────────────────┐  │
│  │ WS Server :port   │  │         │  │ IdeManager         │  │
│  │ RPC Handler       │  │         │  │  - discovery       │  │
│  │ Selection Tracker │  │         │  │  - connection      │  │
│  │ Lockfile Writer   │  │         │  │  - RPC calls       │  │
│  └───────────────────┘  │         │  └────────────────────┘  │
│                         │         │           │               │
│  Writes:                │         │           │ IPC           │
│  ~/.jdcagnet/ide/       │         │           ▼               │
│    <port>.lock          │         │  ┌────────────────────┐  │
│                         │         │  │ Renderer (React)   │  │
│                         │         │  │  - connection UI   │  │
│                         │         │  │  - selection chip  │  │
│                         │         │  │  - @mention insert │  │
│                         │         │  └────────────────────┘  │
└─────────────────────────┘         └──────────────────────────┘
```

### Communication Flow

1. IDE 扩展启动 → 选择随机可用端口 → 启动 WebSocket Server → 写 lockfile
2. JDC CODE 启动 → 扫描 `~/.jdcagnet/ide/*.lock` → 匹配 workspace → 连接
3. 连接建立 → 发送 `initialize` 握手 → 验证 authToken
4. 正常通信 → JDC CODE 发 RPC 请求，IDE 发通知
5. IDE 关闭 → 删除 lockfile → WebSocket 断开 → JDC CODE 清理连接

---

## Protocol Specification

### Transport

- WebSocket over `ws://127.0.0.1:<port>`
- 消息格式: JSON-RPC 2.0
- 心跳: 每 30s ping/pong，10s 无响应视为断开

### Lockfile

**路径**: `~/.jdcagnet/ide/<port>.lock`

```json
{
  "workspaceFolders": ["/Users/user/project"],
  "pid": 12345,
  "ideName": "VS Code",
  "authToken": "550e8400-e29b-41d4-a716-446655440000",
  "version": "0.1.0",
  "timestamp": 1716100000000
}
```

**生命周期**:
- 创建: 扩展激活时
- 更新: workspace 变化时更新 timestamp 和 workspaceFolders
- 删除: 扩展停用时（deactivate/dispose）
- 清理: JDC CODE 发现 PID 不存在或端口不可达时删除过期 lockfile

### Handshake

连接建立后 JDC CODE 发送:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "clientName": "jdcagnet",
    "clientVersion": "1.0.4",
    "authToken": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

IDE 验证 authToken 后响应:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "ideName": "VS Code",
    "ideVersion": "1.90.0",
    "capabilities": ["openFile", "openDiff", "getDiagnostics", "selection", "atMention"]
  }
}
```

Token 不匹配则返回错误并关闭连接。

### RPC Methods (JDC CODE → IDE)

#### `openFile`

在 IDE 中打开文件并跳转到指定位置。

```json
// Request
{ "method": "openFile", "params": { "filePath": "/abs/path/to/file.ts", "line": 42, "column": 10 } }

// Response
{ "result": { "success": true } }
```

#### `openDiff`

显示文件修改的 diff 视图。此方法阻塞直到用户操作（保存、关闭、拒绝）。

```json
// Request
{
  "method": "openDiff",
  "params": {
    "filePath": "/abs/path/to/file.ts",
    "originalContent": "原始文件内容...",
    "proposedContent": "修改后的内容...",
    "tabName": "[JDC Code] file.ts"
  }
}

// Response - 用户保存了修改（可能在 diff 中进一步编辑）
{ "result": { "action": "saved", "content": "用户最终保存的内容..." } }

// Response - 用户关闭了 diff 标签（视为接受原始提议）
{ "result": { "action": "closed" } }

// Response - 用户明确拒绝修改
{ "result": { "action": "rejected" } }
```

#### `closeTab`

关闭指定的 diff 标签页。

```json
{ "method": "closeTab", "params": { "tabName": "[JDC Code] file.ts" } }
{ "result": { "success": true } }
```

#### `closeAllDiffTabs`

关闭所有 JDC Code 打开的 diff 标签页。在用户发送新消息时调用，清理上一轮的 diff。

```json
{ "method": "closeAllDiffTabs", "params": {} }
{ "result": { "closed": 3 } }
```

#### `getDiagnostics`

获取指定文件的 LSP 诊断信息。

```json
// Request
{ "method": "getDiagnostics", "params": { "filePaths": ["/abs/path/file.ts"] } }

// Response
{
  "result": {
    "files": [{
      "filePath": "/abs/path/file.ts",
      "diagnostics": [{
        "message": "Type 'string' is not assignable to type 'number'",
        "severity": "error",
        "range": { "start": { "line": 10, "character": 5 }, "end": { "line": 10, "character": 15 } },
        "source": "typescript",
        "code": "2322"
      }]
    }]
  }
}
```

### Notifications (IDE → JDC CODE)

#### `selection_changed`

用户在编辑器中改变文本选择时推送。

```json
{
  "jsonrpc": "2.0",
  "method": "selection_changed",
  "params": {
    "filePath": "/abs/path/to/file.ts",
    "text": "选中的代码文本",
    "selection": {
      "start": { "line": 10, "character": 0 },
      "end": { "line": 25, "character": 42 }
    }
  }
}
```

节流: 最多每 500ms 发送一次，避免高频推送。

#### `at_mentioned`

用户通过右键菜单 "Send to JDC Code" 时推送。

```json
{
  "jsonrpc": "2.0",
  "method": "at_mentioned",
  "params": {
    "filePath": "/abs/path/to/file.ts",
    "lineStart": 10,
    "lineEnd": 25
  }
}
```

---

## Package Structure

### `packages/core/src/ide/`

Core 层提供协议实现和连接管理，不依赖 Electron。

| 文件 | 职责 |
|------|------|
| `types.ts` | 所有 IDE 相关类型定义 |
| `protocol.ts` | JSON-RPC 2.0 消息编解码、请求/响应关联 |
| `lockfile.ts` | 读取、验证、清理 lockfile |
| `ide-client.ts` | 单个 WebSocket 连接的封装（连接、断开、RPC 调用、通知接收） |
| `ide-manager.ts` | 多连接管理、lockfile 发现轮询、自动连接/重连 |
| `index.ts` | 公共导出 |

**IdeManager 接口**:

```typescript
class IdeManager {
  constructor(callbacks: IdeCallbacks)
  startDiscovery(cwd: string): void       // 开始扫描 lockfile
  stopDiscovery(): void                    // 停止扫描
  getConnections(): IdeConnection[]        // 获取所有连接
  isConnected(): boolean                   // 是否有活跃连接
  openFile(filePath: string, line?: number, column?: number): Promise<void>
  openDiff(params: OpenDiffParams): Promise<OpenDiffResult>
  closeAllDiffTabs(): Promise<void>
  getDiagnostics(filePaths: string[]): Promise<DiagnosticFile[]>
  shutdown(): void                         // 关闭所有连接
}
```

**IdeCallbacks**:

```typescript
interface IdeCallbacks {
  onConnectionChanged: (connections: IdeConnection[]) => void
  onSelectionChanged: (data: SelectionData) => void
  onAtMentioned: (data: AtMentionData) => void
}
```

### `packages/vscode-extension/`

VS Code 扩展，TypeScript 实现。

**关键依赖**: `ws`（WebSocket server）、`uuid`（authToken 生成）

**激活事件**: `onStartupFinished`（VS Code 启动完成后自动激活）

**贡献点**:
- 命令: `jdcagnet.sendToChat` — 右键菜单 "Send to JDC Code (@)"
- 命令: `jdcagnet.showStatus` — 状态栏点击显示连接信息

**openDiff 实现方案**:
- 使用 `vscode.workspace.registerTextDocumentContentProvider` 注册虚拟文档 scheme `jdcagnet-diff`
- 用 `vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, tabName)` 打开 diff
- 监听 `onDidCloseTextDocument` 和 `onDidSaveTextDocument` 检测用户操作
- 用户保存时读取最终内容返回给 RPC 调用方

**selection 实现**:
- 监听 `vscode.window.onDidChangeTextEditorSelection`
- 500ms 节流
- 发送 filePath + selectedText + range

### `packages/jetbrains-plugin/`

JetBrains 插件，Kotlin 实现。

**关键依赖**: Ktor（嵌入式 WebSocket server）、Gson（JSON 序列化）

**目标平台**: IntelliJ Platform 2023.3+（兼容所有 JetBrains IDE）

**openDiff 实现方案**:
- 使用 `DiffManager.getInstance().showDiff(project, SimpleDiffRequest(...))`
- 创建 `DocumentContent` 包装原始和提议内容
- 监听 `FileEditorManagerListener` 检测标签关闭
- 监听 `DocumentListener` 检测保存

**selection 实现**:
- 通过 `EditorFactory.getInstance().eventMulticaster.addSelectionListener` 监听
- 500ms 节流
- 发送 filePath + selectedText + range

---

## Electron Integration

### IPC Channels

```typescript
// 新增到 ipc-channels.ts
IDE_GET_STATE: 'ide:get-state',
IDE_OPEN_FILE: 'ide:open-file',
IDE_OPEN_DIFF: 'ide:open-diff',
IDE_CLOSE_DIFF_TABS: 'ide:close-diff-tabs',
IDE_GET_DIAGNOSTICS: 'ide:get-diagnostics',

// 事件推送 (main → renderer)
// ide:state-changed
// ide:selection-changed
// ide:at-mentioned
```

### SessionManager 集成

```typescript
// session-manager.ts 新增
private ideManager: IdeManager

// 在 app ready 后启动发现
this.ideManager = new IdeManager({
  onConnectionChanged: (conns) => this.window?.webContents.send('ide:state-changed', conns),
  onSelectionChanged: (data) => this.window?.webContents.send('ide:selection-changed', data),
  onAtMentioned: (data) => this.window?.webContents.send('ide:at-mentioned', data),
})
this.ideManager.startDiscovery(cwd)
```

### Preload API

```typescript
// preload.ts 新增
ideGetState: () => ipcRenderer.invoke('ide:get-state'),
ideOpenFile: (filePath, line?, column?) => ipcRenderer.invoke('ide:open-file', { filePath, line, column }),
onIdeStateChanged: (cb) => ipcRenderer.on('ide:state-changed', (_, data) => cb(data)),
onIdeSelectionChanged: (cb) => ipcRenderer.on('ide:selection-changed', (_, data) => cb(data)),
onIdeAtMentioned: (cb) => ipcRenderer.on('ide:at-mentioned', (_, data) => cb(data)),
```

---

## UI Changes

### Topbar 连接指示器

连接时在 Topbar 右侧显示:
- 绿色圆点 + IDE 名称（如 "VS Code"）
- 点击展开 popover 显示所有连接的 IDE 列表
- 未连接时不显示任何内容（保持 UI 干净）

### 项目级 IDE 连接提示

当 JDC CODE 检测到有 IDE 打开了相同项目（lockfile workspace 匹配当前 cwd）时：

**已安装扩展且已连接**:
- Topbar 显示绿色连接指示器 + IDE 名称
- 首次连接时在对话区域顶部显示一条轻量提示: "已连接到 VS Code — 文件修改可在 IDE 中预览"
- 提示可关闭，关闭后同一会话不再显示

**未安装扩展（无 lockfile 但检测到 IDE 进程）**:
- 不显示任何提示，不影响使用
- 仅当用户主动查看设置或帮助时，提及 IDE 扩展功能

**设计原则**:
- 扩展未安装 = 完全透明，用户感知不到 IDE 集成功能的存在
- 扩展已安装且项目匹配 = 自动连接 + 轻量提示
- 不弹窗、不打断工作流

### Composer 集成

**Selection 显示**:
- IDE 有活跃选中时，Composer 上方显示一个 chip: "15 lines in utils.ts"
- 点击 chip 展开预览选中代码
- 发送消息时自动将选中代码作为上下文附加
- 用户可点击 × 移除

**@mention 插入**:
- IDE 推送 at_mentioned 时，自动在 Composer 中插入 `@file.ts:10-25` 格式的引用
- 显示为可点击的 chip

### Tool Card 增强

file_edit / file_write 的 tool card 在 IDE 连接时显示 "在 IDE 中查看" 按钮，点击调用 `openDiff`。

---

## Diff-in-IDE Workflow (Optional)

可选配置 `ideReviewEdits`（默认 false）:
- 开启后，file_edit 工具执行时不直接写入文件
- 而是调用 `openDiff` 在 IDE 中显示 diff
- 用户在 IDE 中 accept/reject/edit
- 结果回传给 JDC CODE，再决定是否写入

此功能为高级用户设计，默认关闭不影响正常使用流程。

---

## CI/CD

### VS Code Extension Workflow

**文件**: `.github/workflows/vscode-extension.yml`
**触发**: push tag `vscode-v*`

```yaml
steps:
  - checkout
  - setup node 20
  - cd packages/vscode-extension && npm ci
  - npm run build
  - npx @vscode/vsce package --no-dependencies
  - upload .vsix to GitHub Release
```

### JetBrains Plugin Workflow

**文件**: `.github/workflows/jetbrains-plugin.yml`
**触发**: push tag `jetbrains-v*`

```yaml
steps:
  - checkout
  - setup java 17
  - cd packages/jetbrains-plugin
  - ./gradlew buildPlugin
  - upload build/distributions/*.zip to GitHub Release
```

---

## README Structure

每个扩展包含独立 README.md:

### VS Code Extension README

1. **功能介绍** — 截图展示 diff 视图、选中代码传递、@引用
2. **安装** — 从 Releases 下载 .vsix → `code --install-extension jdcagnet-ide-x.x.x.vsix`
3. **使用** — 自动连接说明、右键菜单、状态栏图标
4. **配置** — 可选设置项
5. **故障排查** — 常见问题（连接不上、lockfile 残留等）

### JetBrains Plugin README

1. **功能介绍** — 截图展示 diff 视图、选中代码传递、@引用
2. **安装** — 从 Releases 下载 .zip → Settings > Plugins > Install from Disk
3. **使用** — 自动连接说明、右键菜单
4. **兼容性** — 支持的 IDE 列表和最低版本
5. **故障排查** — 常见问题

---

## Error Handling

| 场景 | 处理 |
|------|------|
| IDE 崩溃 | WebSocket 断开 → 指数退避重连 → lockfile 消失后停止重连 |
| authToken 不匹配 | 拒绝连接，日志警告 |
| RPC 超时 (30s) | 返回错误，不阻塞 AI 流程 |
| 多个 IDE 打开同一项目 | 连接所有匹配的 IDE，RPC 发给第一个连接的 |
| lockfile 残留 | PID 检查 + 端口可达性检查，不通过则删除 |
| 扩展未安装 | JDC CODE 完全正常运行，所有功能不受影响，UI 无任何 IDE 相关元素 |
| 扩展已安装但项目不匹配 | 不连接，不提示（只有 workspace 路径匹配才触发连接） |
| openDiff 时 IDE 断开 | 回退到直接写入文件，返回成功 |

---

## Security

- 通信仅限 `127.0.0.1`，不暴露到网络
- authToken 为 UUID v4，存储在 lockfile 中
- lockfile 权限依赖文件系统（同用户可读）
- 不传输敏感数据到外部（所有通信本地完成）

---

## Dependencies

### Core Package (新增)
- `ws` — WebSocket client (Node.js)

### VS Code Extension
- `ws` — WebSocket server
- `uuid` — token 生成
- `@vscode/vsce` — 打包 (devDep)

### JetBrains Plugin
- `io.ktor:ktor-server-netty` — WebSocket server
- `io.ktor:ktor-server-websockets` — WebSocket 支持
- `com.google.code.gson:gson` — JSON 序列化
