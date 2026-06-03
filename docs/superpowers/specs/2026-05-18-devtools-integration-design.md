# DevTools Integration Design Spec

## 概述

为 JDCAGNET 添加三个开发者工具集成功能：Git 分支管理、"Open in..." 外部应用菜单、集成终端面板。

## Feature 1: Git 分支管理

### 位置

SessionHeader 栏（`packages/ui/src/components/SessionHeader.tsx`），项目名右侧显示当前分支名，点击弹出下拉菜单。

### UI 交互

- 分支名显示为一个可点击的 chip，带 git 分支图标
- 点击弹出下拉菜单，包含：
  - 搜索框（过滤分支列表）
  - 本地分支列表，当前分支带 checkmark
  - 分隔线
  - "创建新分支" 按钮（点击后显示输入框，基于当前分支创建）
  - 每个非当前分支右侧有删除按钮（hover 显示）
- 切换分支时如果有未提交更改，显示确认提示（内联 toast，不用 native dialog）

### 后端 IPC

新增 channels：

```typescript
GIT_BRANCH_LIST: 'git:branch-list'      // 返回 { branches: string[], current: string }
GIT_BRANCH_SWITCH: 'git:branch-switch'  // 参数 { cwd, branch } → { success, error? }
GIT_BRANCH_CREATE: 'git:branch-create'  // 参数 { cwd, branch, from? } → { success, error? }
GIT_BRANCH_DELETE: 'git:branch-delete'  // 参数 { cwd, branch } → { success, error? }
GIT_STATUS: 'git:status'               // 返回 { dirty: boolean, changes: number }
```

### 实现

- Electron 主进程新建 `packages/electron/src/git-service.ts`
- 使用 `child_process.execFile('git', [...args], { cwd })` 执行 git 命令
- UI 组件：`packages/ui/src/components/BranchSwitcher.tsx`
- 打开菜单时拉取分支列表，切换前检查 dirty 状态

---

## Feature 2: "Open in..." 外部应用菜单

### 位置

SessionHeader 栏，分支切换器右侧，一个文件夹/外部链接图标按钮。

### UI 交互

- 点击图标弹出下拉菜单
- 菜单项：检测到的已安装应用列表，每项带应用图标和名称
- 点击即打开当前项目目录

### 应用检测

在 macOS 上检测以下应用（检查 `/Applications` 和 `~/Applications`）：

| 应用 | 检测路径 | 打开命令 |
|------|----------|----------|
| VS Code | Visual Studio Code.app | `code <path>` |
| Cursor | Cursor.app | `cursor <path>` |
| Windsurf | Windsurf.app | `open -a Windsurf <path>` |
| Zed | Zed.app | `zed <path>` |
| IntelliJ IDEA | IntelliJ IDEA.app / IntelliJ IDEA CE.app | `idea <path>` |
| WebStorm | WebStorm.app | `webstorm <path>` |
| PyCharm | PyCharm.app / PyCharm CE.app | `pycharm <path>` |
| GoLand | GoLand.app | `goland <path>` |
| CLion | CLion.app | `clion <path>` |
| Xcode | Xcode.app | `open -a Xcode <path>` |
| iTerm2 | iTerm.app | `open -a iTerm <path>` |
| Terminal | (always available) | `open -a Terminal <path>` |
| Finder | (always available) | `open <path>` |

### 后端 IPC

```typescript
APPS_DETECT: 'apps:detect'    // 返回 { apps: Array<{ id, name, available }> }
APPS_OPEN: 'apps:open'        // 参数 { appId, cwd } → { success, error? }
```

### 实现

- Electron 主进程新建 `packages/electron/src/app-launcher.ts`
- 使用 `fs.existsSync` 检测应用是否安装
- 使用 `child_process.exec` 执行打开命令
- 应用列表在启动时检测一次，缓存结果
- UI 组件：`packages/ui/src/components/AppLauncher.tsx`

---

## Feature 3: 集成终端

### 位置

主内容区底部（ChatView 下方），可收起/展开。

### UI 交互

- 默认隐藏，通过 SessionHeader 栏的终端图标按钮或快捷键 `` Cmd+` `` 切换
- 展开时占据底部区域，默认高度 200px
- 顶部有拖拽条可调整高度（最小 100px，最大 60% 视口高度）
- 顶部栏显示：shell 名称 + 关闭按钮
- 终端 cwd 跟随当前 session 的项目目录
- 切换 session 时终端 cwd 不自动切换（保持当前终端状态）

### 技术方案

- **前端**: xterm.js + @xterm/addon-fit（自适应容器大小）
- **后端**: node-pty 创建伪终端进程
- 通过 IPC 双向通信：
  - 前端 → 后端：用户输入（keystroke data）
  - 后端 → 前端：终端输出（pty data）

### 后端 IPC

```typescript
TERMINAL_CREATE: 'terminal:create'    // 参数 { cwd } → { id }
TERMINAL_WRITE: 'terminal:write'      // 参数 { id, data } (send, 不需要返回)
TERMINAL_RESIZE: 'terminal:resize'    // 参数 { id, cols, rows } (send)
TERMINAL_DESTROY: 'terminal:destroy'  // 参数 { id } → { success }
// 后端 → 前端事件：
TERMINAL_DATA: 'terminal:data'        // 推送 { id, data }
TERMINAL_EXIT: 'terminal:exit'        // 推送 { id, code }
```

### 实现

- Electron 主进程新建 `packages/electron/src/terminal-service.ts`
- 管理 pty 实例的生命周期
- UI 组件：`packages/ui/src/components/TerminalPanel.tsx`
- 使用 zustand store 管理终端状态（visible, height）

### 依赖

新增 devDependencies（esbuild 会 bundle，但 node-pty 是 native addon 需要特殊处理）：

- `xterm` — 前端终端渲染
- `@xterm/addon-fit` — 自适应尺寸
- `node-pty` — 后端伪终端

node-pty 是 native module，需要：
- electron-builder 中设置 `npmRebuild: true`（仅对 node-pty）
- 或使用 `electron-rebuild` 在打包前重新编译
- esbuild 中将 `node-pty` 设为 external（不 bundle，运行时 require）

---

## 布局变更

当前 App.tsx 布局：

```
┌─────────────────────────────────────────────┐
│ Topbar (48px)                               │
├──────────┬────────────────────────┬─────────┤
│ Sidebar  │ SessionHeader          │Inspector│
│ (240px)  │ ChatView               │ (44px+) │
│          │                        │         │
└──────────┴────────────────────────┴─────────┘
```

变更后：

```
┌─────────────────────────────────────────────┐
│ Topbar (48px)                               │
├──────────┬────────────────────────┬─────────┤
│ Sidebar  │ SessionHeader          │Inspector│
│ (240px)  │ [branch] [open] [term] │ (44px+) │
│          ├────────────────────────┤         │
│          │ ChatView               │         │
│          ├────────────────────────┤         │
│          │ TerminalPanel (可收起)  │         │
└──────────┴────────────────────────┴─────────┘
```

SessionHeader 左侧保持项目名/session ID，右侧新增：分支切换器、Open in 按钮、终端切换按钮。

---

## 文件清单

### 新建文件

| 文件 | 职责 |
|------|------|
| `packages/electron/src/git-service.ts` | Git 命令执行服务 |
| `packages/electron/src/app-launcher.ts` | 应用检测与启动 |
| `packages/electron/src/terminal-service.ts` | node-pty 管理 |
| `packages/ui/src/components/BranchSwitcher.tsx` | 分支切换 UI |
| `packages/ui/src/components/AppLauncher.tsx` | Open in 菜单 UI |
| `packages/ui/src/components/TerminalPanel.tsx` | 终端面板 UI |
| `packages/ui/src/stores/terminal-store.ts` | 终端状态管理 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/electron/src/ipc-channels.ts` | 新增 git/apps/terminal channels |
| `packages/electron/src/ipc-handlers.ts` | 注册新 handlers |
| `packages/electron/src/preload.ts` | 暴露新 API |
| `packages/electron/package.json` | 添加 node-pty, xterm 依赖 |
| `packages/electron/build.mjs` | node-pty external 处理 |
| `packages/ui/package.json` | 添加 xterm, @xterm/addon-fit |
| `packages/ui/src/components/SessionHeader.tsx` | 集成三个新按钮 |
| `packages/ui/src/App.tsx` | 布局调整，加入 TerminalPanel |
| `packages/ui/src/hooks/useHotkeys.ts` | 添加 Cmd+` 快捷键 |
| `electron-builder.yml` | node-pty rebuild 配置 |
