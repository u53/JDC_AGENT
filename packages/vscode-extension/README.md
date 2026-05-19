# JDC Code — VS Code Extension

VS Code 与 JDC Code 桌面应用之间的双向通信扩展。

## 功能

- **代码选中同步** — 在 VS Code 中选中代码，JDC Code 自动获取作为 AI 上下文（隐式注入，不显示在对话中）
- **活跃文件追踪** — JDC Code 始终知道你当前正在编辑的文件
- **@引用** — 右键菜单 "Send to JDC Code (@)" 将文件/代码段发送给 AI
- **Diff 预览** — AI 修改文件时可在 VS Code 中显示 diff，支持接受/拒绝/编辑
- **诊断信息** — JDC Code 可获取 VS Code 的 TypeScript/ESLint 等错误信息

## 安装

1. 从 [GitHub Releases](https://github.com/u53/JDC_AGENT/releases) 下载最新的 `.vsix` 文件
2. 在终端执行:

```bash
code --install-extension jdc-code-0.1.0.vsix
```

或在 VS Code 中: Extensions → ⋯ → Install from VSIX...

## 使用

1. 安装扩展后重启 VS Code（或 Cmd+Shift+P → "Developer: Reload Window"）
2. 打开项目文件夹（与 JDC Code 中的项目路径一致）
3. 启动 JDC Code 桌面应用并打开相同项目
4. 自动连接 — JDC Code Composer 底部状态栏显示绿色圆点 + "VS Code"

### 代码选中

在 VS Code 中选中代码后，JDC Code 底部状态栏会显示当前文件名和选中行范围。发送消息时，选中的代码会作为隐式上下文传给 AI（一次性，不保存到对话历史）。

### 右键菜单

在编辑器中选中代码 → 右键 → "Send to JDC Code (@)"

### 状态栏

VS Code 底部状态栏显示 "$(plug) JDC Code" 表示 WebSocket 服务运行中。

## 工作原理

扩展启动时在本地随机端口启动 WebSocket 服务器，并写入 lockfile 到 `~/.jdcagnet/ide/<port>.lock`。JDC Code 桌面应用每 5 秒扫描该目录，匹配项目路径后自动连接。通信使用 JSON-RPC 2.0 协议。

## 故障排查

**连接不上?**
- 确认 JDC Code 和 VS Code 打开的是**同一个项目路径**
- 检查 `~/.jdcagnet/ide/` 目录下是否有 `.lock` 文件
- 重启 VS Code 扩展: Cmd+Shift+P → "Developer: Reload Window"
- 在 JDC Code 中切换到对应项目的会话

**残留 lockfile?**
- 如果 VS Code 异常退出，lockfile 可能残留
- JDC Code 会自动清理无效的 lockfile（检测 PID 存活）
- 手动清理: `rm ~/.jdcagnet/ide/*.lock`

## 开发

```bash
cd packages/vscode-extension
npm install
npm run build    # 构建
npm run watch    # 开发模式
npm run package  # 打包 .vsix
```
