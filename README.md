<p align="center">
  <img src="assets/icon.png" width="120" height="120" alt="JDC Code">
</p>

<h1 align="center">JDC Code</h1>

<p align="center">
  <strong>Your AI Pair Programmer — Write Code Through Conversation</strong>
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

JDC Code connects to any LLM (Claude, GPT, Gemini, Ollama, or any OpenAI-compatible endpoint) and gives it full access to your codebase through **30+ built-in tools**. It reads, writes, searches, executes, and iterates — all within a permission system you control.

## ✨ What Makes It Different

<table>
<tr>
<td width="50%">

### 🧠 Multi-Model Collaboration

Configure model groups across providers and assign them to roles. Run main conversations on Claude Opus while sub-agents use Sonnet for speed. Switch models mid-session without losing context.

</td>
<td width="50%">

### 🚀 Parallel Sub-Agents

Dispatch specialized agents — Explore, Refactor, Security Auditor, Frontend Designer — to handle independent tasks simultaneously. Up to 3 concurrent agents that report back when done.

</td>
</tr>
<tr>
<td width="50%">

### 📜 Skills as Slash Commands

Drop a markdown file into `.jdcagnet/skills/` and it becomes a `/command`. Supports argument substitution, tool restrictions, and global or project scope.

</td>
<td width="50%">

### 🎯 Plan Mode

AI enters a restricted read-only mode to analyze your code and write a plan. You review and approve before any changes happen. Plans persist as markdown.

</td>
</tr>
<tr>
<td width="50%">

### 💾 Persistent Memory

The AI remembers your preferences, project context, and past decisions across sessions. Memory is extracted automatically during compaction and stored as inspectable markdown.

</td>
<td width="50%">

### 🔌 MCP & Hooks

Connect external tools via Model Context Protocol (stdio or SSE). Run shell commands before/after any tool call to enforce policies or trigger side effects.

</td>
</tr>
</table>

## 🛠️ Core Capabilities

<details>
<summary><b>📁 File Operations</b></summary>

- Read, write, edit, multi-edit with diff tracking
- File snapshots: before/after state for every modification
- Rewind changes through IDE diff view
- Smart path suggestions when files aren't found
- Read deduplication — skips re-reading unchanged files

</details>

<details>
<summary><b>⚡ Code Execution</b></summary>

- Non-interactive bash with automatic environment isolation (`CI=true`, `GIT_TERMINAL_PROMPT=0`, etc.)
- Built-in terminal panel (xterm.js + node-pty) for interactive use
- Background command execution with completion notifications
- Long-running process monitoring

</details>

<details>
<summary><b>🔍 Search & Navigation</b></summary>

- Glob, grep, directory listing, tree view
- LSP integration: go-to-definition, find references, hover info
- Web search and URL fetching

</details>

<details>
<summary><b>🖥️ IDE Integration</b></summary>

- Auto-detects VS Code, JetBrains, Xcode
- Open files at specific line/column
- Show diff views with accept/reject actions
- Pull LSP diagnostics from your editor
- Selection tracking and `@`-mention support

</details>

<details>
<summary><b>🌿 Git Integration</b></summary>

- Branch detection, status, recent commits in context
- Safety checks block dangerous operations (force push, reset --hard)
- Auto-detects git user for commit attribution

</details>

<details>
<summary><b>🔐 Permission System</b></summary>

Three modes to match your trust level:

| Mode | Behavior |
|------|----------|
| **Strict** | Approve every write operation |
| **Standard** | Reads auto-approved, writes need confirmation |
| **Relaxed** | Most operations auto-approved, only critical commands blocked |

</details>

<details>
<summary><b>🗜️ Context Management</b></summary>

- Configurable context window (1M+ tokens supported)
- Auto-compaction with structured 8-section summaries
- Micro-compaction: clears old tool results before full compression
- Memory extraction during compaction
- Real-time context usage indicator

</details>

<details>
<summary><b>📝 Custom Instructions</b></summary>

- `JDCAGNET.md` at project root or `.jdcagnet/JDCAGNET.md`
- `.jdcagnet/rules/*.md` for modular rule files
- `~/.jdcagnet/JDCAGNET.md` for global instructions

</details>

## 🚀 Quick Start

```bash
pnpm install
pnpm dev
```

Configure your first model group in **Settings → Models**, then start a conversation.

## 📦 Installation

Download the latest release from [GitHub Releases](https://github.com/u53/jdc_agent/releases).

<details>
<summary><b>macOS</b></summary>

The app is not code-signed. If macOS blocks it:

```bash
xattr -cr "/Applications/JDC Code.app"
```

</details>

<details>
<summary><b>Windows</b></summary>

Click "More info" → "Run anyway" on the SmartScreen warning.

</details>

## 🧑‍💻 Development

```bash
pnpm install       # Install dependencies
pnpm dev           # Development mode (Vite + Electron)
pnpm build         # Build all packages
pnpm package       # Package for distribution
```

## 🏗️ Architecture

```
packages/
├── core/       # Session engine, 30+ tools, providers, MCP, IDE, hooks, skills
├── electron/   # Main process, IPC handlers, terminal service, git service
└── ui/         # React 19 + Zustand + Tailwind CSS 4 (Vite)
```

## 🧰 Tech Stack

`Electron 33` · `React 19` · `Zustand 5` · `Tailwind CSS 4` · `esbuild` · `node-pty` · `xterm.js` · `sql.js`

## 📄 License

For learning and personal use only. Commercial use prohibited. See [LICENSE](./LICENSE).

---

<p align="center">
  <sub>Built with ❤️ for developers who think in code</sub>
</p>

