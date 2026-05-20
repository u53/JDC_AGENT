# JDC Code

[English](./README.md) | [简体中文](./README.zh-CN.md)

你的 AI 编程搭档 — 一个能写代码、跑命令、管理项目的桌面应用。

JDC Code 可以连接任意大模型（Claude、GPT、Gemini、Ollama 或任何 OpenAI 兼容接口），通过 30+ 内置工具让 AI 完整操控你的代码库。它能读、写、搜索、执行、迭代 — 一切都在你可控的权限体系下进行。

## 核心特色

### 多模型协作，各司其职

配置多个模型分组，为不同角色分配不同模型。主对话用 Claude Opus 保证质量，子代理用 Sonnet 提升速度。会话中途切换模型不丢失上下文。

### 子代理并行工作

派遣专业化代理同时处理独立任务：

- **Explore** — 快速只读代码搜索（最多 10 轮）
- **Refactor** — 无 bash 权限的代码重构
- **Security Auditor** — 受限命令下的安全审计
- **Frontend Designer** — UI 组件生成
- **General** — 完整工具权限，处理复杂多步任务

最多 3 个代理并发执行，完成后自动汇报。

### Skills：可复用的 AI 指令

在 `.jdcagnet/skills/` 放一个 markdown 文件，它就变成了斜杠命令。支持参数替换、工具限制，可设为全局或项目级别。

```yaml
---
name: review
description: 带安全视角的代码审查
user-invocable: true
argument-hint: "<file-path>"
allowed-tools: [file_read, grep, glob]
---
审查 ${1} 的安全漏洞，重点关注...
```

### 规划模式：先想后做

AI 进入受限的只读模式分析代码库并撰写方案。你审阅通过后才会执行修改。方案以 markdown 形式存储在 `.jdcagnet/plans/`。

### 跨会话持久记忆

AI 会记住你的偏好、项目背景和历史决策。记忆在上下文压缩时自动提取，以结构化 markdown 文件存储 — 无数据库，完全可检视。

### MCP 服务器集成

通过 Model Context Protocol 接入外部工具。支持 stdio 和 SSE 两种传输方式，可全局或按项目配置。AI 自动发现可用工具，与内置工具无缝混用。

### Hooks：工具调用前后自动化

在任意工具执行前后运行 shell 命令。拦截危险操作、执行策略检查、触发副作用 — 全部通过 JSON 配置。

## 完整能力

### 文件操作
- 读、写、编辑、批量编辑，每次修改都有 diff 追踪
- 文件快照记录每次修改的前后状态
- 通过 IDE diff 视图回退变更
- 文件未找到时智能路径建议
- 读取去重（跳过未变更文件的重复读取）

### 代码执行
- 非交互式 bash，自动环境隔离（CI=true）
- 内置终端面板（xterm.js + node-pty）支持交互操作
- 后台命令执行，完成后通知
- 长时间进程监控

### 搜索与导航
- Glob、grep、目录列表、树形视图
- LSP 集成：跳转定义、查找引用、悬停信息
- 网页搜索和 URL 抓取

### IDE 集成
- 自动检测 VS Code、JetBrains、Xcode
- 打开文件并定位到指定行列
- 展示 diff 视图，支持接受/拒绝操作
- 从编辑器拉取 LSP 诊断信息
- 选区追踪和 @提及 支持

### Git
- 自动检测分支、状态、最近提交
- 安全检查拦截危险操作（force push、reset --hard）
- 检测 git 用户用于提交署名

### 上下文管理
- 可配置上下文窗口（支持 1M+ tokens）
- 自动压缩，生成结构化 8 段式摘要
- 微压缩：在全量压缩前清理旧工具结果
- 压缩时自动提取记忆
- 实时上下文使用率指示器

### 权限系统
三种模式匹配你的信任级别：
- **严格** — 所有写操作需要审批
- **标准** — 读操作自动通过，写操作需确认
- **宽松** — 大部分操作自动通过，仅拦截关键命令

### 自定义指令
- 项目根目录 `JDCAGNET.md` 或 `.jdcagnet/JDCAGNET.md`
- `.jdcagnet/rules/*.md` 模块化规则文件
- `~/.jdcagnet/JDCAGNET.md` 全局指令

## 快速开始

```bash
pnpm install
pnpm dev
```

在 设置 → 模型 中配置你的第一个模型分组，然后开始对话。

## 安装

从 [GitHub Releases](https://github.com/u53/jdc_agent/releases) 下载最新版本。

### macOS

应用未代码签名，如果 macOS 阻止打开：

```bash
xattr -cr "/Applications/JDC Code.app"
```

### Windows

SmartScreen 警告点击「更多信息」→「仍要运行」。

## 开发

```bash
pnpm install       # 安装依赖
pnpm dev           # 开发模式（Vite + Electron）
pnpm build         # 构建所有包
pnpm package       # 打包分发
```

## 架构

```
packages/
  core/       — 会话引擎、30+ 工具、模型提供者、MCP、IDE、Hooks、Skills
  electron/   — 主进程、IPC 处理、终端服务、Git 服务
  ui/         — React 19 + Zustand + Tailwind CSS 4（Vite）
```

## 技术栈

Electron 33 · React 19 · Zustand 5 · Tailwind CSS 4 · esbuild · node-pty · xterm.js · sql.js

## 许可证

本项目仅供学习和个人使用，禁止商业用途。详见 [LICENSE](./LICENSE)。
