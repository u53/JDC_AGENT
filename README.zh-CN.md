# JDCAGNET

多模型支持的桌面端 AI 编程助手。

## 功能特性

- **多模型支持** — Claude、GPT、Gemini、Ollama，以及任何 OpenAI 兼容 API
- **工具执行** — 文件读写编辑、Bash 命令、网页搜索、MCP 服务器
- **Git 集成** — 应用内切换、创建、删除分支
- **打开 IDE** — 自动检测并启动 VS Code、JetBrains 全家桶、Xcode 等
- **内置终端** — 集成终端面板（xterm.js + node-pty）
- **任务管理** — 实时追踪 AI 任务进度
- **文件快照** — 查看和回退 AI 所做的文件修改
- **子代理** — 并行启动多个 AI 代理处理复杂任务
- **规划模式** — AI 先提出方案再执行
- **自动更新** — 从 GitHub Releases 检查并安装更新

## 技术栈

- **Electron 33** — 桌面运行时
- **React 19** — UI 框架
- **Zustand 5** — 状态管理
- **Tailwind CSS 4** — 样式
- **esbuild** — 打包构建
- **node-pty + xterm.js** — 终端模拟
- **sql.js** — 本地 SQLite 存储对话历史

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式运行
pnpm dev

# 构建所有包
pnpm build

# 打包分发
pnpm package
```

## 项目结构

```
packages/
  core/       — AI 会话引擎、工具、模型提供者、MCP
  electron/   — Electron 主进程、IPC、服务
  ui/         — React 前端（Vite）
```

## 发布

推送版本 tag 触发 GitHub Actions 自动构建发布：

```bash
# 修改 packages/electron/package.json 中的 version
git tag v0.0.2
git push && git push --tags
```

工作流会自动构建 macOS（.dmg）和 Windows（.exe）安装包，发布到 GitHub Releases。

## 许可证

MIT
