# DevTools Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add git branch management, "Open in..." app launcher, and integrated terminal to JDCAGNET desktop app.

**Architecture:** Three independent features sharing the same IPC pattern (electron service → ipc-handlers → preload → UI component). Each feature is a self-contained service in the electron layer with a corresponding UI component in the React layer.

**Tech Stack:** Electron IPC, child_process (git/app-launcher), node-pty + xterm.js (terminal), React + Zustand, Tailwind CSS

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/electron/src/git-service.ts` | Execute git commands via child_process |
| `packages/electron/src/app-launcher.ts` | Detect installed apps, launch them |
| `packages/electron/src/terminal-service.ts` | Manage node-pty instances |
| `packages/ui/src/components/BranchSwitcher.tsx` | Branch dropdown UI |
| `packages/ui/src/components/AppLauncher.tsx` | "Open in..." dropdown UI |
| `packages/ui/src/components/TerminalPanel.tsx` | xterm.js terminal panel |
| `packages/ui/src/stores/terminal-store.ts` | Terminal visibility/height state |

### Modified Files

| File | Change |
|------|--------|
| `packages/electron/src/ipc-channels.ts` | Add git/apps/terminal channel constants |
| `packages/electron/src/ipc-handlers.ts` | Register new handlers |
| `packages/electron/src/preload.ts` | Expose new APIs to renderer |
| `packages/electron/package.json` | Add node-pty dependency |
| `packages/electron/build.mjs` | Mark node-pty as external |
| `packages/ui/package.json` | Add xterm, @xterm/addon-fit |
| `packages/ui/src/components/SessionHeader.tsx` | Add branch/open/terminal buttons |
| `packages/ui/src/App.tsx` | Layout change for terminal panel |
| `electron-builder.yml` | node-pty native rebuild config |
| `package.json` | Add node-pty to onlyBuiltDependencies |

---

## Task 1: IPC Channels & Dependencies Setup

**Files:**
- Modify: `packages/electron/src/ipc-channels.ts`
- Modify: `packages/electron/package.json`
- Modify: `packages/ui/package.json`
- Modify: `package.json`
- Modify: `electron-builder.yml`

- [ ] **Step 1: Add new IPC channel constants**

```typescript
// Add to packages/electron/src/ipc-channels.ts, inside the IPC_CHANNELS object:

  // Git
  GIT_BRANCH_LIST: 'git:branch-list',
  GIT_BRANCH_SWITCH: 'git:branch-switch',
  GIT_BRANCH_CREATE: 'git:branch-create',
  GIT_BRANCH_DELETE: 'git:branch-delete',
  GIT_STATUS: 'git:status',

  // App Launcher
  APPS_DETECT: 'apps:detect',
  APPS_OPEN: 'apps:open',

  // Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_DESTROY: 'terminal:destroy',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',
```

- [ ] **Step 2: Add dependencies**

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter jdcagnet add -D node-pty
pnpm --filter @jdcagnet/ui add xterm @xterm/addon-fit
```

- [ ] **Step 3: Update root package.json onlyBuiltDependencies**

Add `"node-pty"` to `pnpm.onlyBuiltDependencies` array in root `package.json`.

- [ ] **Step 4: Update electron-builder.yml**

Add after `npmRebuild: false`:

```yaml
npmRebuild: true
afterPack: null
extraResources:
  - from: "../../node_modules/.pnpm/node-pty*/node_modules/node-pty/build/Release"
    to: "node-pty"
    filter:
      - "*.node"
```

Actually, simpler approach — since esbuild bundles everything and node-pty is external, we need to include its native binary. Change `npmRebuild: false` to `true` and add:

```yaml
npmRebuild: true
files:
  - dist/**/*
  - ui/**/*
  - package.json
  - node_modules/node-pty/**/*
```

- [ ] **Step 5: Update build.mjs to mark node-pty as external**

Add `'node-pty'` to the `external` array in the main process esbuild config:

```javascript
external: ['electron', 'node-pty'],
```

- [ ] **Step 6: Commit**

```bash
git add packages/electron/src/ipc-channels.ts packages/electron/package.json packages/ui/package.json package.json electron-builder.yml packages/electron/build.mjs pnpm-lock.yaml
git commit -m "feat: add IPC channels and dependencies for devtools integration"
```

---

## Task 2: Git Service (Electron Backend)

**Files:**
- Create: `packages/electron/src/git-service.ts`

- [ ] **Step 1: Create git-service.ts**

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export class GitService {
  private async git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await exec('git', args, { cwd, timeout: 10000 })
    return stdout.trim()
  }

  async listBranches(cwd: string): Promise<{ branches: string[]; current: string }> {
    const output = await this.git(['branch', '--no-color'], cwd)
    const branches: string[] = []
    let current = ''
    for (const line of output.split('\n')) {
      const name = line.replace(/^\*?\s+/, '').trim()
      if (!name) continue
      branches.push(name)
      if (line.startsWith('*')) current = name
    }
    return { branches, current }
  }

  async switchBranch(cwd: string, branch: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git(['checkout', branch], cwd)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr || err.message }
    }
  }

  async createBranch(cwd: string, branch: string, from?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ['checkout', '-b', branch]
      if (from) args.push(from)
      await this.git(args, cwd)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr || err.message }
    }
  }

  async deleteBranch(cwd: string, branch: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git(['branch', '-d', branch], cwd)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr || err.message }
    }
  }

  async getStatus(cwd: string): Promise<{ dirty: boolean; changes: number }> {
    const output = await this.git(['status', '--porcelain'], cwd)
    const lines = output ? output.split('\n').filter(Boolean) : []
    return { dirty: lines.length > 0, changes: lines.length }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/electron/src/git-service.ts
git commit -m "feat: add git service for branch operations"
```

---

## Task 3: App Launcher Service (Electron Backend)

**Files:**
- Create: `packages/electron/src/app-launcher.ts`

- [ ] **Step 1: Create app-launcher.ts**

```typescript
import { existsSync } from 'node:fs'
import { exec } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

interface AppDef {
  id: string
  name: string
  bundleNames: string[]
  openCommand: (cwd: string) => string
  alwaysAvailable?: boolean
}

const APP_DEFS: AppDef[] = [
  { id: 'vscode', name: 'VS Code', bundleNames: ['Visual Studio Code.app'], openCommand: (cwd) => `code "${cwd}"` },
  { id: 'cursor', name: 'Cursor', bundleNames: ['Cursor.app'], openCommand: (cwd) => `cursor "${cwd}"` },
  { id: 'windsurf', name: 'Windsurf', bundleNames: ['Windsurf.app'], openCommand: (cwd) => `open -a Windsurf "${cwd}"` },
  { id: 'zed', name: 'Zed', bundleNames: ['Zed.app'], openCommand: (cwd) => `zed "${cwd}"` },
  { id: 'intellij', name: 'IntelliJ IDEA', bundleNames: ['IntelliJ IDEA.app', 'IntelliJ IDEA CE.app'], openCommand: (cwd) => `idea "${cwd}"` },
  { id: 'webstorm', name: 'WebStorm', bundleNames: ['WebStorm.app'], openCommand: (cwd) => `webstorm "${cwd}"` },
  { id: 'pycharm', name: 'PyCharm', bundleNames: ['PyCharm.app', 'PyCharm CE.app'], openCommand: (cwd) => `pycharm "${cwd}"` },
  { id: 'goland', name: 'GoLand', bundleNames: ['GoLand.app'], openCommand: (cwd) => `goland "${cwd}"` },
  { id: 'clion', name: 'CLion', bundleNames: ['CLion.app'], openCommand: (cwd) => `clion "${cwd}"` },
  { id: 'xcode', name: 'Xcode', bundleNames: ['Xcode.app'], openCommand: (cwd) => `open -a Xcode "${cwd}"` },
  { id: 'iterm', name: 'iTerm2', bundleNames: ['iTerm.app'], openCommand: (cwd) => `open -a iTerm "${cwd}"` },
  { id: 'terminal', name: 'Terminal', bundleNames: [], openCommand: (cwd) => `open -a Terminal "${cwd}"`, alwaysAvailable: true },
  { id: 'finder', name: 'Finder', bundleNames: [], openCommand: (cwd) => `open "${cwd}"`, alwaysAvailable: true },
]

export class AppLauncher {
  private cache: Array<{ id: string; name: string; available: boolean }> | null = null

  detect(): Array<{ id: string; name: string; available: boolean }> {
    if (this.cache) return this.cache

    const searchDirs = ['/Applications', path.join(homedir(), 'Applications')]

    this.cache = APP_DEFS.map((app) => {
      if (app.alwaysAvailable) return { id: app.id, name: app.name, available: true }
      const found = app.bundleNames.some((bundle) =>
        searchDirs.some((dir) => existsSync(path.join(dir, bundle)))
      )
      return { id: app.id, name: app.name, available: found }
    }).filter((a) => a.available)

    return this.cache
  }

  open(appId: string, cwd: string): Promise<{ success: boolean; error?: string }> {
    const app = APP_DEFS.find((a) => a.id === appId)
    if (!app) return Promise.resolve({ success: false, error: 'Unknown app' })

    return new Promise((resolve) => {
      exec(app.openCommand(cwd), (err) => {
        if (err) resolve({ success: false, error: err.message })
        else resolve({ success: true })
      })
    })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/electron/src/app-launcher.ts
git commit -m "feat: add app launcher service with macOS app detection"
```

---

## Task 4: Terminal Service (Electron Backend)

**Files:**
- Create: `packages/electron/src/terminal-service.ts`

- [ ] **Step 1: Create terminal-service.ts**

```typescript
import type { BrowserWindow } from 'electron'

// node-pty is external (native addon), require at runtime
const pty = require('node-pty')

interface PtyInstance {
  id: string
  process: any
  cwd: string
}

export class TerminalService {
  private instances = new Map<string, PtyInstance>()
  private window: BrowserWindow | null = null
  private nextId = 1

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  create(cwd: string): { id: string } {
    const id = `term-${this.nextId++}`
    const shell = process.env.SHELL || '/bin/zsh'

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    })

    ptyProcess.onData((data: string) => {
      this.window?.webContents.send('terminal:data', { id, data })
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.window?.webContents.send('terminal:exit', { id, code: exitCode })
      this.instances.delete(id)
    })

    this.instances.set(id, { id, process: ptyProcess, cwd })
    return { id }
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id)
    if (instance) instance.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (instance) instance.process.resize(cols, rows)
  }

  destroy(id: string): { success: boolean } {
    const instance = this.instances.get(id)
    if (instance) {
      instance.process.kill()
      this.instances.delete(id)
      return { success: true }
    }
    return { success: false }
  }

  destroyAll(): void {
    for (const [id] of this.instances) {
      this.destroy(id)
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/electron/src/terminal-service.ts
git commit -m "feat: add terminal service with node-pty management"
```

---

## Task 5: Register IPC Handlers & Preload

**Files:**
- Modify: `packages/electron/src/ipc-handlers.ts`
- Modify: `packages/electron/src/preload.ts`
- Modify: `packages/electron/src/main.ts`

- [ ] **Step 1: Instantiate services in main.ts**

Add after `const sessionManager = new SessionManager()`:

```typescript
import { GitService } from './git-service.js'
import { AppLauncher } from './app-launcher.js'
import { TerminalService } from './terminal-service.js'

const gitService = new GitService()
const appLauncher = new AppLauncher()
const terminalService = new TerminalService()
```

Pass them to `registerIpcHandlers`:

```typescript
registerIpcHandlers(sessionManager, { gitService, appLauncher, terminalService })
```

Set terminal window after `createMainWindow()`:

```typescript
terminalService.setWindow(win)
```

Add cleanup in `before-quit`:

```typescript
app.on('before-quit', () => {
  terminalService.destroyAll()
  sessionManager.close()
})
```

- [ ] **Step 2: Add handlers in ipc-handlers.ts**

Update function signature:

```typescript
interface Services {
  gitService: GitService
  appLauncher: AppLauncher
  terminalService: TerminalService
}

export function registerIpcHandlers(sessionManager: SessionManager, services: Services): void {
```

Add at the end of the function:

```typescript
  const { gitService, appLauncher, terminalService } = services

  // Git
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_LIST, async (_event, { cwd }) => {
    return gitService.listBranches(cwd)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_SWITCH, async (_event, { cwd, branch }) => {
    return gitService.switchBranch(cwd, branch)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_CREATE, async (_event, { cwd, branch, from }) => {
    return gitService.createBranch(cwd, branch, from)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCH_DELETE, async (_event, { cwd, branch }) => {
    return gitService.deleteBranch(cwd, branch)
  })
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_event, { cwd }) => {
    return gitService.getStatus(cwd)
  })

  // Apps
  ipcMain.handle(IPC_CHANNELS.APPS_DETECT, async () => {
    return { apps: appLauncher.detect() }
  })
  ipcMain.handle(IPC_CHANNELS.APPS_OPEN, async (_event, { appId, cwd }) => {
    return appLauncher.open(appId, cwd)
  })

  // Terminal
  ipcMain.handle(IPC_CHANNELS.TERMINAL_CREATE, async (_event, { cwd }) => {
    return terminalService.create(cwd)
  })
  ipcMain.on(IPC_CHANNELS.TERMINAL_WRITE, (_event, { id, data }) => {
    terminalService.write(id, data)
  })
  ipcMain.on(IPC_CHANNELS.TERMINAL_RESIZE, (_event, { id, cols, rows }) => {
    terminalService.resize(id, cols, rows)
  })
  ipcMain.handle(IPC_CHANNELS.TERMINAL_DESTROY, async (_event, { id }) => {
    return terminalService.destroy(id)
  })
```

- [ ] **Step 3: Update preload.ts**

Add to the `api` object:

```typescript
  // Git
  gitBranchList: (cwd: string) => ipcRenderer.invoke('git:branch-list', { cwd }),
  gitBranchSwitch: (cwd: string, branch: string) => ipcRenderer.invoke('git:branch-switch', { cwd, branch }),
  gitBranchCreate: (cwd: string, branch: string, from?: string) => ipcRenderer.invoke('git:branch-create', { cwd, branch, from }),
  gitBranchDelete: (cwd: string, branch: string) => ipcRenderer.invoke('git:branch-delete', { cwd, branch }),
  gitStatus: (cwd: string) => ipcRenderer.invoke('git:status', { cwd }),

  // Apps
  appsDetect: () => ipcRenderer.invoke('apps:detect'),
  appsOpen: (appId: string, cwd: string) => ipcRenderer.invoke('apps:open', { appId, cwd }),

  // Terminal
  terminalCreate: (cwd: string) => ipcRenderer.invoke('terminal:create', { cwd }),
  terminalWrite: (id: string, data: string) => ipcRenderer.send('terminal:write', { id, data }),
  terminalResize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  terminalDestroy: (id: string) => ipcRenderer.invoke('terminal:destroy', { id }),
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => {
    const listener = (_event: unknown, payload: { id: string; data: string }) => callback(payload)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (callback: (data: { id: string; code: number }) => void) => {
    const listener = (_event: unknown, payload: { id: string; code: number }) => callback(payload)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
```

- [ ] **Step 4: Commit**

```bash
git add packages/electron/src/ipc-handlers.ts packages/electron/src/preload.ts packages/electron/src/main.ts
git commit -m "feat: register git/apps/terminal IPC handlers and preload APIs"
```

---

## Task 6: BranchSwitcher UI Component

**Files:**
- Create: `packages/ui/src/components/BranchSwitcher.tsx`

- [ ] **Step 1: Create BranchSwitcher.tsx**

```tsx
import { useState, useEffect, useRef } from 'react'
import { IconGitBranch, IconCheck, IconX, IconPlus } from './icons'

interface Props {
  cwd: string
}

export function BranchSwitcher({ cwd }: Props) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [current, setCurrent] = useState('')
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const load = async () => {
    const result = await window.electronAPI?.gitBranchList(cwd)
    if (result) {
      setBranches(result.branches)
      setCurrent(result.current)
    }
  }

  useEffect(() => {
    load()
  }, [cwd])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const switchTo = async (branch: string) => {
    setError(null)
    const status = await window.electronAPI?.gitStatus(cwd)
    if (status?.dirty) {
      setError(`${status.changes} 个未提交更改，请先提交或 stash`)
      return
    }
    const result = await window.electronAPI?.gitBranchSwitch(cwd, branch)
    if (result?.success) {
      setCurrent(branch)
      setOpen(false)
    } else {
      setError(result?.error || '切换失败')
    }
  }

  const createBranch = async () => {
    if (!newName.trim()) return
    setError(null)
    const result = await window.electronAPI?.gitBranchCreate(cwd, newName.trim())
    if (result?.success) {
      setCreating(false)
      setNewName('')
      await load()
    } else {
      setError(result?.error || '创建失败')
    }
  }

  const deleteBranch = async (branch: string) => {
    setError(null)
    const result = await window.electronAPI?.gitBranchDelete(cwd, branch)
    if (result?.success) {
      setBranches((b) => b.filter((x) => x !== branch))
    } else {
      setError(result?.error || '删除失败')
    }
  }

  const filtered = branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); if (!open) load() }}
        className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
      >
        <IconGitBranch size={14} />
        <span className="font-mono truncate max-w-[120px]">{current || '—'}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[240px] bg-[var(--surface)] border border-[var(--border)] rounded-[8px] shadow-lg z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-[var(--border)]">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索分支..."
              className="w-full px-2 py-1 text-[12px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[4px] text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)]"
              autoFocus
            />
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--bad)] bg-[var(--bad)]/10 border-b border-[var(--border)]">
              {error}
            </div>
          )}

          {/* Branch list */}
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.map((branch) => (
              <div
                key={branch}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] group cursor-pointer"
                onClick={() => branch !== current && switchTo(branch)}
              >
                <span className="w-4 flex-shrink-0">
                  {branch === current && <IconCheck size={12} className="text-[var(--good)]" />}
                </span>
                <span className={`font-mono truncate flex-1 ${branch === current ? 'text-[var(--good)]' : 'text-[var(--text)]'}`}>
                  {branch}
                </span>
                {branch !== current && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteBranch(branch) }}
                    className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--bad)]"
                  >
                    <IconX size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Create new */}
          <div className="border-t border-[var(--border)] p-2">
            {creating ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createBranch()}
                  placeholder="新分支名..."
                  className="flex-1 px-2 py-1 text-[12px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[4px] text-[var(--text)] outline-none"
                  autoFocus
                />
                <button onClick={createBranch} className="p-1 text-[var(--good)] hover:bg-[var(--surface-2)] rounded">
                  <IconCheck size={12} />
                </button>
                <button onClick={() => { setCreating(false); setNewName('') }} className="p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] rounded">
                  <IconX size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 w-full px-2 py-1 text-[12px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-[4px]"
              >
                <IconPlus size={12} />
                创建新分支
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add IconGitBranch to icons.tsx**

```tsx
export function IconGitBranch({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/BranchSwitcher.tsx packages/ui/src/components/icons.tsx
git commit -m "feat: add BranchSwitcher UI component"
```

---

## Task 7: AppLauncher UI Component

**Files:**
- Create: `packages/ui/src/components/AppLauncher.tsx`

- [ ] **Step 1: Create AppLauncher.tsx**

```tsx
import { useState, useEffect, useRef } from 'react'
import { IconExternalLink } from './icons'

interface DetectedApp {
  id: string
  name: string
  available: boolean
}

interface Props {
  cwd: string
}

export function AppLauncher({ cwd }: Props) {
  const [open, setOpen] = useState(false)
  const [apps, setApps] = useState<DetectedApp[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI?.appsDetect().then((result: { apps: DetectedApp[] }) => {
      setApps(result.apps)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const openApp = async (appId: string) => {
    await window.electronAPI?.appsOpen(appId, cwd)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-[6px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        aria-label="Open in..."
      >
        <IconExternalLink size={14} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[180px] bg-[var(--surface)] border border-[var(--border)] rounded-[8px] shadow-lg z-50 overflow-hidden py-1">
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => openApp(app.id)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] text-left"
            >
              {app.name}
            </button>
          ))}
          {apps.length === 0 && (
            <span className="px-3 py-1.5 text-[12px] text-[var(--muted)]">未检测到应用</span>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add IconExternalLink to icons.tsx**

```tsx
export function IconExternalLink({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/AppLauncher.tsx packages/ui/src/components/icons.tsx
git commit -m "feat: add AppLauncher UI component with app detection"
```

---

## Task 8: Terminal Store & Panel UI

**Files:**
- Create: `packages/ui/src/stores/terminal-store.ts`
- Create: `packages/ui/src/components/TerminalPanel.tsx`

- [ ] **Step 1: Create terminal-store.ts**

```typescript
import { create } from 'zustand'

interface TerminalState {
  visible: boolean
  height: number
  terminalId: string | null
  toggle: () => void
  show: () => void
  hide: () => void
  setHeight: (h: number) => void
  setTerminalId: (id: string | null) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  visible: false,
  height: 200,
  terminalId: null,
  toggle: () => set((s) => ({ visible: !s.visible })),
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
  setHeight: (height) => set({ height: Math.max(100, Math.min(height, window.innerHeight * 0.6)) }),
  setTerminalId: (terminalId) => set({ terminalId }),
}))
```

- [ ] **Step 2: Create TerminalPanel.tsx**

```tsx
import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useTerminalStore } from '../stores/terminal-store'
import { IconX } from './icons'
import 'xterm/css/xterm.css'

interface Props {
  cwd: string
}

export function TerminalPanel({ cwd }: Props) {
  const visible = useTerminalStore((s) => s.visible)
  const height = useTerminalStore((s) => s.height)
  const terminalId = useTerminalStore((s) => s.terminalId)
  const hide = useTerminalStore((s) => s.hide)
  const setHeight = useTerminalStore((s) => s.setHeight)
  const setTerminalId = useTerminalStore((s) => s.setTerminalId)

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  useEffect(() => {
    if (!visible || !containerRef.current) return
    if (termRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'var(--font-mono), Menlo, monospace',
      theme: {
        background: 'var(--bg)',
        foreground: 'var(--text)',
        cursor: 'var(--accent)',
      },
      cursorBlink: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    // Create pty
    window.electronAPI?.terminalCreate(cwd).then((result: { id: string }) => {
      setTerminalId(result.id)

      term.onData((data) => {
        window.electronAPI?.terminalWrite(result.id, data)
      })
    })

    // Listen for pty output
    const unsub = window.electronAPI?.onTerminalData((payload: { id: string; data: string }) => {
      term.write(payload.data)
    })

    const unsubExit = window.electronAPI?.onTerminalExit(() => {
      term.write('\r\n[进程已退出]\r\n')
      setTerminalId(null)
    })

    return () => {
      unsub?.()
      unsubExit?.()
    }
  }, [visible, cwd])

  // Fit on resize or height change
  useEffect(() => {
    if (!visible || !fitRef.current || !termRef.current) return
    fitRef.current.fit()
    const id = terminalId
    if (id) {
      const { cols, rows } = termRef.current
      window.electronAPI?.terminalResize(id, cols, rows)
    }
  }, [visible, height, terminalId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (terminalId) window.electronAPI?.terminalDestroy(terminalId)
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: height }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - ev.clientY
      setHeight(dragRef.current.startH + delta)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [height, setHeight])

  if (!visible) return null

  return (
    <div className="flex flex-col border-t border-[var(--border)]" style={{ height }}>
      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        className="h-1 cursor-row-resize hover:bg-[var(--accent)]/30 transition-colors"
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--border)] bg-[var(--surface)]">
        <span className="text-[11px] text-[var(--muted)] font-mono">Terminal</span>
        <button
          onClick={hide}
          className="p-0.5 rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
        >
          <IconX size={12} />
        </button>
      </div>
      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/terminal-store.ts packages/ui/src/components/TerminalPanel.tsx
git commit -m "feat: add TerminalPanel UI with xterm.js and drag-to-resize"
```

---

## Task 9: Integrate into SessionHeader & App Layout

**Files:**
- Modify: `packages/ui/src/components/SessionHeader.tsx`
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/hooks/useHotkeys.ts` (or hotkey map in App.tsx)

- [ ] **Step 1: Update SessionHeader to include new controls**

Add imports at top:

```typescript
import { BranchSwitcher } from './BranchSwitcher'
import { AppLauncher } from './AppLauncher'
import { IconTerminal } from './icons'
import { useTerminalStore } from '../stores/terminal-store'
```

Add terminal toggle selector:

```typescript
const toggleTerminal = useTerminalStore((s) => s.toggle)
```

Get `cwd` from the active project:

```typescript
const cwd = activeProject?.cwd || ''
```

In the JSX, add between left section and right status indicators — a middle section with the three controls:

```tsx
{/* Center: devtools */}
{cwd && (
  <div className="flex items-center gap-1">
    <BranchSwitcher cwd={cwd} />
    <AppLauncher cwd={cwd} />
    <button
      onClick={toggleTerminal}
      className="p-1.5 rounded-[6px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
      aria-label="Toggle terminal"
    >
      <IconTerminal size={14} />
    </button>
  </div>
)}
```

- [ ] **Step 2: Add IconTerminal to icons.tsx**

```tsx
export function IconTerminal({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}
```

- [ ] **Step 3: Update App.tsx layout to include TerminalPanel**

Add import:

```typescript
import { TerminalPanel } from './components/TerminalPanel'
```

Change the main content area from:

```tsx
<div className="flex-1 flex flex-col overflow-hidden border-l border-[var(--border)]">
  {activeSessionId ? (
    <ChatView onOpenMcp={() => openSettings('mcp')} />
  ) : (
    <ProjectPage />
  )}
</div>
```

To:

```tsx
<div className="flex-1 flex flex-col overflow-hidden border-l border-[var(--border)]">
  {activeSessionId ? (
    <>
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatView onOpenMcp={() => openSettings('mcp')} />
      </div>
      <TerminalPanel cwd={activeProject?.cwd || ''} />
    </>
  ) : (
    <ProjectPage />
  )}
</div>
```

Where `activeProject` is derived:

```typescript
const activeProject = projects.find((p) =>
  p.sessions.some((s) => s.id === activeSessionId)
)
```

- [ ] **Step 4: Add Cmd+` hotkey for terminal toggle**

In the `hotkeyMap` in App.tsx, add:

```typescript
'mod+`': () => {
  const { toggle } = useTerminalStore.getState()
  toggle()
},
```

- [ ] **Step 5: Verify the project field `cwd` exists on project objects**

Check `session-store.ts` to confirm projects have a `cwd` field. If the project type uses `path` instead of `cwd`, adjust accordingly in SessionHeader and App.tsx.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/SessionHeader.tsx packages/ui/src/components/icons.tsx packages/ui/src/App.tsx
git commit -m "feat: integrate branch switcher, app launcher, and terminal into layout"
```

---

## Task 10: Build & Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Build the electron app**

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm build
```

Fix any TypeScript or build errors.

- [ ] **Step 2: Run in dev mode**

```bash
pnpm dev
```

- [ ] **Step 3: Verify git branch switcher**

- Open a project session
- Confirm current branch name shows in SessionHeader
- Click to open dropdown, verify branch list loads
- Test creating a new branch
- Test switching branches (with clean working tree)
- Test the dirty-state warning

- [ ] **Step 4: Verify app launcher**

- Click the external link icon
- Confirm detected apps appear in dropdown
- Click one (e.g., Finder) to verify it opens the project directory

- [ ] **Step 5: Verify terminal**

- Click terminal icon or press Cmd+`
- Confirm terminal panel appears at bottom
- Type commands, verify output renders
- Drag the resize handle, confirm height changes
- Click close button, confirm panel hides
- Press Cmd+` again to re-show

- [ ] **Step 6: Package**

```bash
HTTPS_PROXY=http://127.0.0.1:7890 pnpm package
cp -r out/mac-arm64/JDCAGNET.app /Applications/
```

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues from devtools integration"
```









