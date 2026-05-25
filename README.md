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

## What is JDC Code

JDC Code is a desktop AI coding assistant that connects to your models and gives them full read/write/execute access to your codebase through **30+ built-in tools**. It works with Claude, GPT, Gemini, Ollama, or any OpenAI-compatible endpoint — speaking three protocols natively (`Anthropic Messages`, `OpenAI Chat Completions`, `OpenAI Responses`).

Think of it as an AI teammate that sits next to you: it reads your code, searches your project, runs commands, edits files, and even spins up **virtual AI teams** to tackle complex tasks in parallel — all within a permission system you control.

---

## Getting Started

### 1. Install

Download the latest release from [GitHub Releases](https://github.com/u53/jdc_agent/releases).

**macOS** — the app is not code-signed. If macOS blocks it:

```bash
xattr -cr "/Applications/JDC Code.app"
```

**Windows** — click "More info" → "Run anyway" on the SmartScreen warning.

### 2. Open a Project

Launch the app. You'll see the **Project Page** — click **"Open Folder"** (or press `⌘N` / `Ctrl+N`) and select your project directory. This creates your first session, which appears in the sidebar.

### 3. Configure Your Models

JDC Code ships with no built-in models — you bring your own API keys. Open **Settings** (`⌘,` / `Ctrl+,`) and go to the **Models** tab.

A **Model Group** bundles together a provider connection (protocol + base URL + API key) with one or more models. You can create multiple groups to mix providers.

#### Example: Anthropic (Claude)

Click **"+ New Group"** and fill in:

| Field | Value |
|-------|-------|
| Name | `Anthropic` |
| Protocol | `Anthropic (/v1/messages)` |
| Base URL | *(leave empty — defaults to `https://api.anthropic.com`)* |
| API Key | `sk-ant-...` |

Click **Confirm**, then expand the group and add a model:

| Field | Value |
|-------|-------|
| Display Name | `Claude Opus 4` |
| Model ID | `claude-opus-4-20250514` |
| Context Window | `200000` |
| Max Tokens | `32000` |
| Compress At | `90` |

Click the **test button** (▶) to verify the connection works.

#### Example: OpenAI (GPT-5, o4-mini)

| Field | Value |
|-------|-------|
| Name | `OpenAI` |
| Protocol | `OpenAI (/v1/chat/completions)` |
| Base URL | *(leave empty — defaults to `https://api.openai.com/v1`)* |
| API Key | `sk-...` |

Add a model: Model ID `gpt-5`, Context Window `200000`.

> **Tip**: reasoning models (like `o3`, `o4-mini`, `claude-opus-4`) are auto-detected. When you select one in the **Reasoning Effort** dropdown in the composer toolbar, the app sends `thinking` parameters and drops `temperature` for you.

#### Example: Ollama (local)

| Field | Value |
|-------|-------|
| Name | `Ollama` |
| Protocol | `OpenAI (/v1/chat/completions)` |
| Base URL | `http://localhost:11434/v1` |
| API Key | `ollama` (any non-empty value) |

Add a model: Model ID `llama4`, Context Window `131072`.

#### Example: OpenRouter

| Field | Value |
|-------|-------|
| Name | `OpenRouter` |
| Protocol | `OpenAI (/v1/chat/completions)` |
| Base URL | `https://openrouter.ai/api/v1` |
| API Key | `sk-or-...` |

Add a model: Model ID `anthropic/claude-opus-4`, Context Window `200000`.

#### Example: Google Gemini

| Field | Value |
|-------|-------|
| Name | `Gemini` |
| Protocol | `OpenAI (/v1/chat/completions)` |
| Base URL | `https://generativelanguage.googleapis.com/v1beta/openai` |
| API Key | Your Gemini API key |

#### Selecting the Active Model

After adding models, pick which one is active from the dropdown in the **composer toolbar** (bottom of the chat view). You can switch mid-session — context is preserved.

### 4. Start a Conversation

Type a message in the composer at the bottom and press Enter. The AI sees your project structure, git status, and open files, then takes action directly: reading files, searching code, running commands, editing code.

---

## Core Features

### 👥 Team Mode

Spin up a virtual AI software team. A **Project Manager AI** breaks down your goal into tasks, dispatches specialized **worker agents** in parallel, monitors their progress, intervenes on failure, and reports back.

To start a team, just tell the AI something like:

> "Create a team to build a user authentication system — one member for the database schema, one for the API routes, and one for the frontend components."

Each worker can use a different model — put a strong model on planning and a faster one on execution. You can chat with the PM mid-flight to redirect priorities, hurry things up, or wrap up early.

### 🚀 Sub-Agents

Dispatch specialized agents for independent tasks. Available types:

| Agent Type | Purpose |
|-----------|---------|
| **Explore** | Fast read-only search for locating code |
| **Plan** | Analyze code and write implementation plans |
| **Refactor** | Improve code structure without changing behavior |
| **Security Auditor** | Analyze code for vulnerabilities |
| **Frontend Designer** | Convert designs into components |
| **General** | Full tool access for complex multi-step tasks |

Sub-agents run in the background and notify you when done. Up to 3 can run concurrently.

### 📜 Skills

Skills are reusable prompt templates that become slash commands. Drop a markdown file into `.jdcagnet/skills/` and it's auto-discovered.

**Example** — create `.jdcagnet/skills/code-review.md`:

```markdown
---
name: code-review
description: Review code for bugs, style issues, and improvements
arguments:
  - file-path
argument-hint: "<file-path>"
allowed-tools:
  - Bash
  - file_read
  - grep
---

Review the file at ${1} for:
1. Bugs and logic errors
2. Style and naming issues
3. Performance concerns
4. Security vulnerabilities

Write your findings as a concise report.
```

Then type `/code-review src/auth.ts` in the composer.

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill name (used as the slash command) |
| `description` | No | Shown in the skill picker |
| `arguments` | No | Positional argument names |
| `argument-hint` | No | Placeholder shown in the composer |
| `allowed-tools` | No | Restrict which tools the skill can use |
| `user-invocable` | No | Set to `false` to hide from the slash menu (default: `true`) |

Skills can live in `~/.jdcagnet/skills/` (global) or `<project>/.jdcagnet/skills/` (project-specific). Project skills override global ones with the same name.

### 🎯 Plan Mode

AI enters a restricted read-only mode to analyze code and write an implementation plan before making changes. You review and approve the plan, then it executes.

Press `Shift+Tab` or click the plan toggle in the composer toolbar. Plans are saved as markdown in `.jdcagnet/plans/`.

### 🔌 MCP Servers

Connect external tools via [Model Context Protocol](https://modelcontextprotocol.io). Configure servers in `.jdcagnet/mcp-servers.json` (project) or `~/.jdcagnet/mcp-servers.json` (global). Project configs override global ones for servers with the same name.

**Stdio example** — filesystem access:

```json
{
  "filesystem": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
  }
}
```

**SSE example** — remote server:

```json
{
  "my-server": {
    "transport": "sse",
    "url": "http://localhost:3000/sse"
  }
}
```

Manage servers in **Settings → MCP**: view connection status, list available tools, enable/disable, reconnect.

### 🪝 Hooks

Run shell commands before or after tool calls to enforce policies or trigger side effects. Configure in `.jdcagnet/hooks.json`.

**Example** — block dangerous git commands:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "node -e \"const i=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(i.tool_input?.command?.includes('rm -rf /')) process.exit(1)\"",
          "timeout": 5000
        }]
      }
    ]
  }
}
```

Hooks receive input via stdin as JSON and can return `{"decision": "block", "reason": "..."}` to prevent execution.

Supported events: `PreToolUse`, `PostToolUse`. Matcher patterns: `"*"` (all tools), `"ToolName"` (exact), `"prefix*"` (prefix).

### 💾 Persistent Memory

The AI remembers your preferences, project context, and past decisions across sessions. Memory is automatically extracted during context compaction and stored as markdown files in `~/.jdcagnet/projects/<project-path>/memory/`.

**Memory types:**
- **User** — your role, preferences, expertise
- **Project** — ongoing work, deadlines, decisions
- **Feedback** — corrections, confirmed approaches
- **Reference** — pointers to external systems (Linear, Grafana, etc.)

You can inspect and edit memory files directly. The `MEMORY.md` index file lists all entries.

### 📝 Custom Instructions

**`JDCAGNET.md`** — place at the project root for project-specific guidance, or at `~/.jdcagnet/JDCAGNET.md` for global instructions. This is injected into the system prompt.

**`.jdcagnet/rules/*.md`** — modular rule files loaded alongside `JDCAGNET.md`. Use for separating concerns (e.g., `testing.md`, `style.md`, `deployment.md`).

Example `JDCAGNET.md`:

```markdown
# Project Context
- This is a Next.js 14 app with App Router
- Use server components by default, only add 'use client' when necessary
- All API routes use Zod for validation

# Build Commands
- `pnpm dev` — start dev server
- `pnpm build` — production build
- `pnpm test` — run vitest
```

### 🔐 Permission System

Three modes control what the AI can do without asking:

| Mode | Read | Write | Execute | Dangerous |
|------|------|-------|---------|-----------|
| **Relaxed** | Auto | Auto | Auto | Ask |
| **Standard** | Auto | Ask | Ask | Ask |
| **Strict** | Auto | Ask | Ask | Ask (all writes) |

Toggle from the composer toolbar. Standard is the default.

### 🖥️ IDE Integration

Auto-detects VS Code, JetBrains IDEs, and Xcode. Once connected, the AI can open files at specific lines, show diff views, and pull LSP diagnostics. The current file and selection are available to the AI as context.

> **JetBrains users**: install the companion plugin from `packages/jetbrains-plugin/`. The IDE connection status is shown in the composer toolbar.

### ⚡ Built-in Terminal

Toggle the terminal panel with `` ⌘` `` / `` Ctrl+` ``. It uses a real PTY (xterm.js + node-pty), so interactive commands like `npm init` and `git rebase` work as expected. The AI can also run non-interactive commands directly via the Bash tool.

---

## Configuration Reference

All config files live under `.jdcagnet/` in your project (project scope) or `~/.jdcagnet/` (global scope). Project settings override global ones.

```
.jdcagnet/
├── JDCAGNET.md          # Project instructions (loaded in system prompt)
├── hooks.json           # Pre/Post tool-use hooks
├── mcp-servers.json     # MCP server definitions
├── skills/              # Slash-command skill definitions
│   └── code-review.md
├── rules/               # Modular instruction files
│   ├── testing.md
│   └── conventions.md
└── plans/               # Plan mode output (auto-generated)
```

### Model Groups (Settings → Models)

Stored in `settings.json` (managed by the UI — no need to edit manually). Structure:

```json
{
  "modelGroups": {
    "groups": [
      {
        "id": "uuid",
        "name": "Anthropic",
        "protocol": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "apiKey": "sk-ant-...",
        "models": [
          {
            "id": "uuid",
            "modelId": "claude-sonnet-4-20250514",
            "name": "Claude Sonnet 4",
            "contextWindow": 200000,
            "maxTokens": 32000,
            "compressAt": 0.9
          }
        ]
      }
    ],
    "activeModelId": "uuid-of-model"
  }
}
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘N` / `Ctrl+N` | New session (open folder) |
| `⌘W` / `Ctrl+W` | Close current session |
| `⌘K` / `Ctrl+K` | Clear conversation |
| `⌘,` / `Ctrl+,` | Open Settings |
| `Escape` | Stop generation |
| `Shift+Tab` | Toggle Plan Mode |
| `` ⌘` `` / `` Ctrl+` `` | Toggle terminal |
| `⌘1`–`9` | Switch to session 1–9 |

---

## Development

```bash
pnpm install       # Install dependencies
pnpm dev           # Development mode (Vite + Electron)
pnpm build         # Build all packages
pnpm package       # Package for distribution
pnpm test          # Run core tests
```

Minimum: Node.js 20+, pnpm 9+.

---

## Architecture

```
packages/
├── core/            # Session engine, 30+ tools, providers, MCP, IDE, hooks, skills
├── electron/        # Main process, IPC handlers, terminal service, git service
├── ui/              # React 19 + Zustand 5 + Tailwind CSS 4 (Vite)
├── jetbrains-plugin/ # Companion plugin for JetBrains IDEs
└── vscode-extension/ # Companion extension for VS Code
```

**Tech Stack:** `Electron 33` · `React 19` · `Zustand 5` · `Tailwind CSS 4` · `esbuild` · `node-pty` · `xterm.js` · `sql.js`

---

## License

For learning and personal use only. Commercial use prohibited. See [LICENSE](./LICENSE).

---

<p align="center">
  <sub>Built with ❤️ for developers who think in code</sub>
</p>
