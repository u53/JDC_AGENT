# JDC Code IDE — JetBrains Plugin

JetBrains IDE 与 JDC Code 桌面应用之间的双向通信插件。

## 功能

- **代码选中** — 在 IDE 中选中代码自动传给 JDC Code 作为上下文
- **@引用** — 右键菜单 "Send to JDC Code (@)" 将文件/代码段发送给 AI
- **文件跳转** — JDC Code 可在 IDE 中打开文件并跳转到指定行

## 兼容性

支持所有基于 IntelliJ Platform 2023.3+ 的 IDE:

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

1. 从 [GitHub Releases](../../releases) 下载最新的 `.zip` 文件
2. 打开 IDE → Settings → Plugins → ⚙️ → Install Plugin from Disk...
3. 选择下载的 .zip 文件
4. 重启 IDE

## 使用

1. 安装插件后重启 IDE
2. 打开项目（与 JDC Code 中的项目路径一致）
3. 启动 JDC Code 桌面应用并打开相同项目
4. 自动连接 — JDC Code Topbar 显示绿色指示器

### 右键菜单

在编辑器中选中代码 → 右键 → "Send to JDC Code (@)"

## 工作原理

插件启动时在本地随机端口启动 WebSocket 服务器（基于 Ktor），并写入 lockfile 到 `~/.jdcagnet/ide/<port>.lock`。JDC Code 桌面应用扫描该目录，匹配项目路径后自动连接。

## 故障排查

**连接不上?**
- 确认 JDC Code 和 IDE 打开的是同一个项目路径
- 检查 `~/.jdcagnet/ide/` 目录下是否有 `.lock` 文件
- 重启 IDE

**残留 lockfile?**
- JDC Code 会自动清理无效的 lockfile
- 手动清理: `rm ~/.jdcagnet/ide/*.lock`

## 开发

```bash
cd packages/jetbrains-plugin
./gradlew buildPlugin          # 构建
./gradlew runIde               # 在沙盒 IDE 中运行
```
