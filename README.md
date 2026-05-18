# JDCAGNET

[English](./README.md) | [简体中文](./README.zh-CN.md)

AI-powered coding assistant desktop app.

## Features

- **Multi-model support** — Claude, GPT, Gemini, Ollama, any OpenAI-compatible API
- **Tool execution** — File read/write/edit, bash commands, web search, MCP servers
- **Git integration** — Branch switching, create, delete directly in the app
- **Open in IDE** — Detect and launch VS Code, JetBrains IDEs, Xcode, etc.
- **Integrated terminal** — Built-in terminal panel (xterm.js + node-pty)
- **Task management** — Track AI task progress in real-time
- **File snapshots** — View and rewind file changes made by AI
- **Sub-agents** — Spawn parallel AI agents for complex tasks
- **Plan mode** — AI proposes a plan before executing
- **Auto-update** — Check and install updates from GitHub Releases

## Tech Stack

- **Electron 33** — Desktop runtime
- **React 19** — UI framework
- **Zustand 5** — State management
- **Tailwind CSS 4** — Styling
- **esbuild** — Bundling
- **node-pty + xterm.js** — Terminal emulation
- **sql.js** — Local SQLite for conversation history

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build all packages
pnpm build

# Package for distribution
pnpm package
```

## Project Structure

```
packages/
  core/       — AI session engine, tools, providers, MCP
  electron/   — Electron main process, IPC, services
  ui/         — React frontend (Vite)
```

## Release

Push a version tag to trigger the GitHub Actions release workflow:

```bash
# Update version in packages/electron/package.json
git tag v0.0.2
git push && git push --tags
```

The workflow builds macOS (.dmg) and Windows (.exe) installers, then publishes them to GitHub Releases.

## License

本项目仅供学习和个人使用，禁止商业用途。详见 [LICENSE](./LICENSE)。
