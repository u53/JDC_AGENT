# JDC Code

[English](./README.md) | [简体中文](./README.zh-CN.md)

Your AI pair programmer — a desktop app that writes code, runs commands, and manages your project alongside you.

JDC Code connects to any LLM (Claude, GPT, Gemini, Ollama, or any OpenAI-compatible endpoint) and gives it full access to your codebase through 30+ built-in tools. It reads, writes, searches, executes, and iterates — all within a permission system you control.

## What Makes It Different

### Use Multiple Models, Each for What It's Best At

Configure model groups with different providers and assign them to different roles. Your main conversation can run on Claude Opus while sub-agents use Sonnet for speed. Switch models mid-session without losing context.

### Sub-Agents That Work in Parallel

Dispatch specialized agents to handle independent tasks simultaneously:

- **Explore** — Fast read-only codebase search (10 turns max)
- **Refactor** — Restructure code without bash access
- **Security Auditor** — Vulnerability scanning with restricted commands
- **Frontend Designer** — UI component generation
- **General** — Full tool access for complex multi-step work

Run up to 3 agents concurrently. They report back when done.

### Skills: Reusable AI Instructions

Drop a markdown file in `.jdcagnet/skills/` and it becomes a slash command. Skills support argument substitution, tool restrictions, and can be scoped globally or per-project.

```yaml
---
name: review
description: Code review with security focus
user-invocable: true
argument-hint: "<file-path>"
allowed-tools: [file_read, grep, glob]
---
Review ${1} for security vulnerabilities, focusing on...
```

### Plan Mode: Think Before Acting

AI enters a restricted read-only mode to analyze your codebase and write a plan. You review and approve before any changes are made. Plans are stored as markdown in `.jdcagnet/plans/`.

### Persistent Memory Across Sessions

The AI remembers your preferences, project context, and past decisions. Memory is extracted automatically during context compaction and stored as structured markdown files — no database, fully inspectable.

### MCP Server Integration

Connect external tools via Model Context Protocol. Configure stdio or SSE servers globally or per-project. The AI discovers available tools automatically and can use them alongside built-in tools.

### Hooks: Automate Around Tool Calls

Run shell commands before or after any tool execution. Block dangerous operations, enforce policies, or trigger side effects — all configurable via JSON.

## Core Capabilities

### File Operations
- Read, write, edit, multi-edit with diff tracking
- File snapshots with before/after state for every modification
- Rewind changes through IDE diff view
- Smart path suggestions when files aren't found
- Read deduplication (skips re-reading unchanged files)

### Code Execution
- Non-interactive bash with automatic environment isolation
- Built-in terminal panel (xterm.js + node-pty) for interactive use
- Background command execution with notifications
- Long-running process monitoring

### Search & Navigation
- Glob, grep, directory listing, tree view
- LSP integration for go-to-definition, find references, hover info
- Web search and URL fetching

### IDE Integration
- Auto-detects VS Code, JetBrains, Xcode
- Open files at specific line/column
- Show diff views with accept/reject actions
- Pull LSP diagnostics from your editor
- Selection tracking and @-mention support

### Git
- Branch detection, status, recent commits in context
- Safety checks block dangerous operations (force push, reset --hard)
- Git user detection for commit attribution

### Context Management
- Configurable context window (up to 1M+ tokens)
- Auto-compaction with structured 8-section summaries
- Micro-compaction: clears old tool results before full compression
- Memory extraction during compaction
- Real-time context usage indicator

### Permission System
Three modes to match your trust level:
- **Strict** — Approve every write operation
- **Standard** — Reads auto-approved, writes need confirmation
- **Relaxed** — Most operations auto-approved, only critical commands blocked

### Custom Instructions
- `JDCAGNET.md` at project root or `.jdcagnet/JDCAGNET.md`
- `.jdcagnet/rules/*.md` for modular rule files
- `~/.jdcagnet/JDCAGNET.md` for global instructions

## Quick Start

```bash
pnpm install
pnpm dev
```

Configure your first model group in Settings → Models, then start a conversation.

## Installation

Download the latest release from [GitHub Releases](https://github.com/u53/jdc_agent/releases).

### macOS

The app is not code-signed. If macOS blocks it:

```bash
xattr -cr "/Applications/JDC Code.app"
```

### Windows

Click "More info" → "Run anyway" on the SmartScreen warning.

## Development

```bash
pnpm install       # Install dependencies
pnpm dev           # Development mode (Vite + Electron)
pnpm build         # Build all packages
pnpm package       # Package for distribution
```

## Architecture

```
packages/
  core/       — Session engine, 30+ tools, providers, MCP, IDE, hooks, skills
  electron/   — Main process, IPC handlers, terminal service, git service
  ui/         — React 19 + Zustand + Tailwind CSS 4 (Vite)
```

## Tech Stack

Electron 33 · React 19 · Zustand 5 · Tailwind CSS 4 · esbuild · node-pty · xterm.js · sql.js

## License

For learning and personal use only. Commercial use prohibited. See [LICENSE](./LICENSE).
