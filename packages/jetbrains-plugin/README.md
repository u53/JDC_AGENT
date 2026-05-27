# JDC Code — JetBrains Plugin

JetBrains IDE 与 JDC Code 桌面应用之间的双向通信插件。

## 功能

- **代码选中同步** — 在 IDE 中选中代码，JDC Code 自动获取作为 AI 上下文（隐式注入，不显示在对话中）
- **活跃文件追踪** — JDC Code 始终知道你当前正在编辑的文件
- **@引用** — 右键菜单 "Send to JDC Code (@)" 将文件/代码段发送给 AI
- **文件跳转** — JDC Code 可在 IDE 中打开文件并跳转到指定行

## 兼容性

支持所有基于 IntelliJ Platform 2023.1+ 的 IDE:

- IntelliJ IDEA (Community / Ultimate)
- WebStorm
- PyCharm
- GoLand
- CLion
- PhpStorm
- RubyMine
- Rider
- DataGrip
- Android Studio

## 安装

1. 从 [GitHub Releases](https://github.com/u53/JDC_AGENT/releases) 下载最新的 `jdc-code-x.x.x.zip` 文件
2. 打开 IDE → Settings → Plugins → ⚙️ → Install Plugin from Disk...
3. 选择下载的 .zip 文件
4. 重启 IDE

## 使用

1. 安装插件后重启 IDE
2. 打开项目（与 JDC Code 中的项目路径一致）
3. 启动 JDC Code 桌面应用并打开相同项目
4. 自动连接 — JDC Code Composer 底部状态栏显示绿色圆点 + 当前 IDE 名称

### 代码选中

在 IDE 中选中代码后，JDC Code 底部状态栏会显示当前文件名和选中行范围。发送消息时，选中的代码会作为隐式上下文传给 AI（一次性，不保存到对话历史）。

### 右键菜单

在编辑器中选中代码 → 右键 → "Send to JDC Code (@)"

## 工作原理

插件启动时在本地随机端口启动 WebSocket 服务器（基于 Ktor），并写入 lockfile 到 `~/.jdcagnet/ide/<port>.lock`。JDC Code 桌面应用每 5 秒扫描该目录，匹配项目路径后自动连接。通信使用 JSON-RPC 2.0 协议。

插件会监听项目打开/关闭事件，自动更新 lockfile 中的 workspaceFolders。

## 故障排查

**连接不上?**
- 确认 JDC Code 和 IDE 打开的是**同一个项目路径**
- 检查 `~/.jdcagnet/ide/` 目录下是否有 `.lock` 文件
- 在 JDC Code 中切换到对应项目的会话
- 重启 IDE

**残留 lockfile?**
- JDC Code 会自动清理无效的 lockfile（检测 PID 存活）
- 手动清理: `rm ~/.jdcagnet/ide/*.lock`

## 开发

需要 JDK 17：

```bash
cd packages/jetbrains-plugin
export JAVA_HOME=/opt/homebrew/opt/openjdk@17  # macOS
./gradlew buildPlugin    # 构建，输出在 build/distributions/
./gradlew runIde         # 在沙盒 IDE 中运行
```
