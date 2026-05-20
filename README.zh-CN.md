<p align="center">
  <img src="assets/icon.png" width="120" height="120" alt="JDC Code">
</p>

<h1 align="center">JDC Code</h1>

<p align="center">
  <strong>你的 AI 编程搭档 — 用对话写代码</strong>
</p>

<p align="center">
  <a href="https://github.com/u53/jdc_agent/releases"><img src="https://img.shields.io/github/v/release/u53/jdc_agent?style=flat-square&color=blue" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/electron-33-47848F?style=flat-square&logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="React">
  <img src="https://img.shields.io/badge/license-personal%20use-green?style=flat-square" alt="License">
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

---

JDC Code 可以连接任意大模型（Claude、GPT、Gemini、Ollama 或任何 OpenAI 兼容接口），通过 **30+ 内置工具**让 AI 完整操控你的代码库。它能读、写、搜索、执行、迭代 — 一切都在你可控的权限体系下进行。

## ✨ 核心特色

<table>
<tr>
<td width="50%">

### 🧠 多模型协作

配置多个模型分组，为不同角色分配不同模型。主对话用 Claude Opus 保证质量，子代理用 Sonnet 提升速度。会话中途切换模型不丢失上下文。

</td>
<td width="50%">

### 🚀 子代理并行

派遣专业化代理 — Explore、Refactor、Security Auditor、Frontend Designer — 同时处理独立任务。最多 3 个并发，完成后自动汇报。

</td>
</tr>
<tr>
<td width="50%">

### 📜 Skills 即斜杠命令

在 `.jdcagnet/skills/` 放一个 markdown 文件，它就变成了 `/命令`。支持参数替换、工具限制、全局或项目级别。

</td>
<td width="50%">

### 🎯 规划模式

AI 进入受限只读模式分析代码并撰写方案。你审阅通过后才执行修改。方案以 markdown 形式持久化。

</td>
</tr>
<tr>
<td width="50%">

### 💾 跨会话持久记忆

AI 记住你的偏好、项目背景和历史决策。压缩时自动提取记忆，存为可检视的 markdown 文件。

</td>
<td width="50%">

### 🔌 MCP & Hooks

通过 Model Context Protocol 接入外部工具（stdio 或 SSE）。在工具调用前后运行 shell 命令执行策略检查或触发副作用。

</td>
</tr>
</table>

## 🛠️ 完整能力

<details>
<summary><b>📁 文件操作</b></summary>

- 读、写、编辑、批量编辑，每次修改都有 diff 追踪
- 文件快照：每次修改的前后状态完整记录
- 通过 IDE diff 视图回退变更
- 文件未找到时智能路径建议
- 读取去重 — 跳过未变更文件的重复读取

</details>

<details>
<summary><b>⚡ 代码执行</b></summary>

- 非交互式 bash，自动环境隔离（`CI=true`、`GIT_TERMINAL_PROMPT=0` 等）
- 内置终端面板（xterm.js + node-pty）支持交互操作
- 后台命令执行，完成后自动通知
- 长时间进程监控

</details>

<details>
<summary><b>🔍 搜索与导航</b></summary>

- Glob、grep、目录列表、树形视图
- LSP 集成：跳转定义、查找引用、悬停信息
- 网页搜索和 URL 抓取

</details>

<details>
<summary><b>🖥️ IDE 集成</b></summary>

- 自动检测 VS Code、JetBrains、Xcode
- 打开文件并定位到指定行列
- 展示 diff 视图，支持接受/拒绝操作
- 从编辑器拉取 LSP 诊断信息
- 选区追踪和 `@`提及 支持

</details>

<details>
<summary><b>🌿 Git 集成</b></summary>

- 自动检测分支、状态、最近提交
- 安全检查拦截危险操作（force push、reset --hard）
- 检测 git 用户用于提交署名

</details>

<details>
<summary><b>🔐 权限系统</b></summary>

三种模式匹配你的信任级别：

| 模式 | 行为 |
|------|------|
| **严格** | 所有写操作都需要审批 |
| **标准** | 读操作自动通过，写操作需确认 |
| **宽松** | 大部分操作自动通过，仅拦截关键命令 |

</details>

<details>
<summary><b>🗜️ 上下文管理</b></summary>

- 可配置上下文窗口（支持 1M+ tokens）
- 自动压缩，生成结构化 8 段式摘要
- 微压缩：在全量压缩前清理旧工具结果
- 压缩时自动提取记忆
- 实时上下文使用率指示器

</details>

<details>
<summary><b>📝 自定义指令</b></summary>

- 项目根目录 `JDCAGNET.md` 或 `.jdcagnet/JDCAGNET.md`
- `.jdcagnet/rules/*.md` 模块化规则文件
- `~/.jdcagnet/JDCAGNET.md` 全局指令

</details>

## 🚀 快速开始

```bash
pnpm install
pnpm dev
```

在 **设置 → 模型** 中配置你的第一个模型分组，然后开始对话。

## 📦 安装

从 [GitHub Releases](https://github.com/u53/jdc_agent/releases) 下载最新版本。

<details>
<summary><b>macOS</b></summary>

应用未代码签名。如果 macOS 阻止打开：

```bash
xattr -cr "/Applications/JDC Code.app"
```

</details>

<details>
<summary><b>Windows</b></summary>

SmartScreen 警告点击「更多信息」→「仍要运行」。

</details>

## 🧑‍💻 开发

```bash
pnpm install       # 安装依赖
pnpm dev           # 开发模式（Vite + Electron）
pnpm build         # 构建所有包
pnpm package       # 打包分发
```

## 🏗️ 架构

```
packages/
├── core/       # 会话引擎、30+ 工具、模型提供者、MCP、IDE、Hooks、Skills
├── electron/   # 主进程、IPC 处理、终端服务、Git 服务
└── ui/         # React 19 + Zustand + Tailwind CSS 4（Vite）
```

## 🧰 技术栈

`Electron 33` · `React 19` · `Zustand 5` · `Tailwind CSS 4` · `esbuild` · `node-pty` · `xterm.js` · `sql.js`

## 📄 许可证

本项目仅供学习和个人使用，禁止商业用途。详见 [LICENSE](./LICENSE)。

---

<p align="center">
  <sub>为思考即代码的开发者打造 ❤️</sub>
</p>
