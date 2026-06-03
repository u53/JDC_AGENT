# IDE Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VS Code extension and JetBrains plugin that communicate bidirectionally with JDC CODE via WebSocket, enabling diff viewing in IDE, code selection context, @file references, and diagnostics.

**Architecture:** IDE extensions run WebSocket servers on localhost, write lockfiles for discovery. JDC CODE's Electron main process scans lockfiles, connects as WebSocket client, and bridges events to the React renderer via IPC. Communication uses JSON-RPC 2.0.

**Tech Stack:** TypeScript (core + VS Code extension), Kotlin + Ktor (JetBrains plugin), `ws` (WebSocket), esbuild (bundling), Gradle IntelliJ Plugin (JetBrains build)

---

## File Structure

### New Files

```
packages/core/src/ide/
  types.ts              - All IDE-related interfaces and types
  protocol.ts           - JSON-RPC 2.0 encode/decode + request correlation
  lockfile.ts           - Read, validate, cleanup lockfiles
  ide-client.ts         - Single WebSocket connection wrapper
  ide-manager.ts        - Multi-connection manager + lockfile discovery
  index.ts              - Public exports

packages/vscode-extension/
  package.json          - Extension manifest
  tsconfig.json         - TypeScript config
  esbuild.mjs           - Build script
  README.md             - Installation and usage guide
  src/
    extension.ts        - Activation/deactivation entry point
    server.ts           - WebSocket server lifecycle
    lockfile.ts         - Write/delete lockfile
    rpc-handler.ts      - JSON-RPC method dispatch
    diff-provider.ts    - TextDocumentContentProvider for diff
    selection.ts        - Selection change tracking + throttle
    at-mention.ts       - Right-click "Send to JDC Code" command

packages/jetbrains-plugin/
  build.gradle.kts      - Gradle build config
  settings.gradle.kts   - Project settings
  gradle.properties     - IntelliJ platform version
  README.md             - Installation and usage guide
  src/main/kotlin/com/jdcagnet/ide/
    JdcagnetPlugin.kt          - Plugin lifecycle (start/stop server)
    server/WebSocketServer.kt  - Ktor embedded WS server
    server/RpcHandler.kt       - JSON-RPC dispatch
    server/LockfileManager.kt  - Write/delete lockfile
    handlers/OpenFileHandler.kt
    handlers/OpenDiffHandler.kt
    handlers/DiagnosticsHandler.kt
    notifications/SelectionTracker.kt
    notifications/AtMentionAction.kt
  src/main/resources/META-INF/plugin.xml

packages/ui/src/stores/ide-store.ts    - Zustand store for IDE state
```

### Modified Files

```
packages/core/package.json                    - Add `ws` dependency
packages/core/src/index.ts                    - Export IDE module
packages/core/src/tool-registry.ts            - Add ideManager to ToolContext
packages/electron/src/ipc-channels.ts         - Add IDE channels
packages/electron/src/ipc-handlers.ts         - Register IDE handlers
packages/electron/src/session-manager.ts      - Create/manage IdeManager
packages/electron/src/preload.ts              - Expose IDE APIs
packages/electron/package.json                - Add ws dependency
packages/ui/src/components/Topbar.tsx          - IDE connection indicator
packages/ui/src/components/Composer.tsx        - Selection chip + @mention
.github/workflows/vscode-extension.yml        - CI/CD for VS Code
.github/workflows/jetbrains-plugin.yml        - CI/CD for JetBrains
```

---

### Task 1: Core IDE Types

**Files:**
- Create: `packages/core/src/ide/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// packages/core/src/ide/types.ts

export interface IdeLockfile {
  workspaceFolders: string[]
  pid: number
  ideName: string
  authToken: string
  version: string
  timestamp: number
}

export interface IdeConnection {
  port: number
  ideName: string
  workspaceFolders: string[]
  status: IdeConnectionStatus
}

export type IdeConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SelectionData {
  filePath?: string
  text?: string
  selection?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  } | null
}

export interface AtMentionData {
  filePath: string
  lineStart?: number
  lineEnd?: number
}

export interface OpenDiffParams {
  filePath: string
  originalContent: string
  proposedContent: string
  tabName: string
}

export interface OpenDiffResult {
  action: 'saved' | 'closed' | 'rejected'
  content?: string
}

export interface Diagnostic {
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  source?: string
  code?: string
}

export interface DiagnosticFile {
  filePath: string
  diagnostics: Diagnostic[]
}

export interface IdeCallbacks {
  onConnectionChanged: (connections: IdeConnection[]) => void
  onSelectionChanged: (data: SelectionData) => void
  onAtMentioned: (data: AtMentionData) => void
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit src/ide/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/ide/types.ts
git commit -m "feat(ide): add core IDE types"
```

---

### Task 2: JSON-RPC 2.0 Protocol Layer

**Files:**
- Create: `packages/core/src/ide/protocol.ts`
- Create: `packages/core/tests/ide-protocol.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/core/tests/ide-protocol.test.ts
import { describe, it, expect } from 'vitest'
import { JsonRpcProtocol } from '../src/ide/protocol.js'

describe('JsonRpcProtocol', () => {
  it('encodes a request', () => {
    const proto = new JsonRpcProtocol()
    const { message, id } = proto.createRequest('openFile', { filePath: '/test.ts', line: 1 })
    const parsed = JSON.parse(message)
    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.id).toBe(id)
    expect(parsed.method).toBe('openFile')
    expect(parsed.params.filePath).toBe('/test.ts')
  })

  it('encodes a notification (no id)', () => {
    const proto = new JsonRpcProtocol()
    const message = proto.createNotification('selection_changed', { text: 'hello' })
    const parsed = JSON.parse(message)
    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.method).toBe('selection_changed')
    expect(parsed.id).toBeUndefined()
  })

  it('parses a response and resolves pending request', () => {
    const proto = new JsonRpcProtocol()
    const { id } = proto.createRequest('openFile', { filePath: '/test.ts' })
    const promise = proto.waitForResponse(id)
    proto.handleMessage(JSON.stringify({ jsonrpc: '2.0', id, result: { success: true } }))
    return expect(promise).resolves.toEqual({ success: true })
  })

  it('parses an error response and rejects', () => {
    const proto = new JsonRpcProtocol()
    const { id } = proto.createRequest('openFile', { filePath: '/test.ts' })
    const promise = proto.waitForResponse(id)
    proto.handleMessage(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -1, message: 'fail' } }))
    return expect(promise).rejects.toThrow('fail')
  })

  it('parses a notification and calls handler', () => {
    const proto = new JsonRpcProtocol()
    const received: any[] = []
    proto.onNotification('selection_changed', (params) => received.push(params))
    proto.handleMessage(JSON.stringify({ jsonrpc: '2.0', method: 'selection_changed', params: { text: 'hi' } }))
    expect(received).toEqual([{ text: 'hi' }])
  })

  it('times out pending requests', async () => {
    const proto = new JsonRpcProtocol()
    const { id } = proto.createRequest('openFile', { filePath: '/test.ts' })
    const promise = proto.waitForResponse(id, 50)
    await expect(promise).rejects.toThrow('timeout')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx vitest run tests/ide-protocol.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement protocol.ts**

```typescript
// packages/core/src/ide/protocol.ts

type NotificationHandler = (params: any) => void

interface PendingRequest {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

export class JsonRpcProtocol {
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private notificationHandlers = new Map<string, NotificationHandler[]>()

  createRequest(method: string, params: Record<string, unknown>): { message: string; id: number } {
    const id = this.nextId++
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return { message, id }
  }

  createNotification(method: string, params: Record<string, unknown>): string {
    return JSON.stringify({ jsonrpc: '2.0', method, params })
  }

  createResponse(id: number, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result })
  }

  createErrorResponse(id: number, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
  }

  waitForResponse(id: number, timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC request ${id} timeout`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  onNotification(method: string, handler: NotificationHandler): void {
    const handlers = this.notificationHandlers.get(method) || []
    handlers.push(handler)
    this.notificationHandlers.set(method, handlers)
  }

  handleMessage(raw: string): void {
    let msg: any
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (pending.timer) clearTimeout(pending.timer)
      if (msg.error) {
        pending.reject(new Error(msg.error.message || 'RPC error'))
      } else {
        pending.resolve(msg.result)
      }
    } else if (msg.method && msg.id === undefined) {
      const handlers = this.notificationHandlers.get(msg.method)
      if (handlers) {
        for (const h of handlers) h(msg.params)
      }
    }
  }

  clearPending(): void {
    for (const [id, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new Error('Connection closed'))
    }
    this.pending.clear()
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx vitest run tests/ide-protocol.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ide/protocol.ts packages/core/tests/ide-protocol.test.ts
git commit -m "feat(ide): add JSON-RPC 2.0 protocol layer with tests"
```

---

### Task 3: Lockfile Reader

**Files:**
- Create: `packages/core/src/ide/lockfile.ts`
- Create: `packages/core/tests/ide-lockfile.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/core/tests/ide-lockfile.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanLockfiles, isLockfileValid, removeStaleLockfile } from '../src/ide/lockfile.js'

const TEST_DIR = join(tmpdir(), 'jdcagnet-ide-test-' + process.pid)

beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }) })
afterEach(() => { rmSync(TEST_DIR, { recursive: true, force: true }) })

describe('scanLockfiles', () => {
  it('reads valid lockfiles', () => {
    writeFileSync(join(TEST_DIR, '9000.lock'), JSON.stringify({
      workspaceFolders: ['/project'],
      pid: process.pid,
      ideName: 'VS Code',
      authToken: 'abc',
      version: '0.1.0',
      timestamp: Date.now(),
    }))
    const results = scanLockfiles(TEST_DIR)
    expect(results).toHaveLength(1)
    expect(results[0].port).toBe(9000)
    expect(results[0].lockfile.ideName).toBe('VS Code')
  })

  it('skips malformed lockfiles', () => {
    writeFileSync(join(TEST_DIR, '9001.lock'), 'not json')
    const results = scanLockfiles(TEST_DIR)
    expect(results).toHaveLength(0)
  })

  it('extracts port from filename', () => {
    writeFileSync(join(TEST_DIR, '12345.lock'), JSON.stringify({
      workspaceFolders: ['/project'],
      pid: process.pid,
      ideName: 'IDEA',
      authToken: 'xyz',
      version: '0.1.0',
      timestamp: Date.now(),
    }))
    const results = scanLockfiles(TEST_DIR)
    expect(results[0].port).toBe(12345)
  })
})

describe('isLockfileValid', () => {
  it('returns true for current process pid', () => {
    expect(isLockfileValid({ pid: process.pid, workspaceFolders: ['/p'] } as any)).toBe(true)
  })

  it('returns false for dead pid', () => {
    expect(isLockfileValid({ pid: 999999999, workspaceFolders: ['/p'] } as any)).toBe(false)
  })
})

describe('removeStaleLockfile', () => {
  it('deletes the file', () => {
    const f = join(TEST_DIR, '8000.lock')
    writeFileSync(f, '{}')
    removeStaleLockfile(f)
    expect(existsSync(f)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx vitest run tests/ide-lockfile.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement lockfile.ts**

```typescript
// packages/core/src/ide/lockfile.ts
import { readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { IdeLockfile } from './types.js'

export interface ScannedLockfile {
  port: number
  path: string
  lockfile: IdeLockfile
}

export function scanLockfiles(dir: string): ScannedLockfile[] {
  let files: string[]
  try { files = readdirSync(dir) } catch { return [] }

  const results: ScannedLockfile[] = []
  for (const file of files) {
    if (!file.endsWith('.lock')) continue
    const port = parseInt(file.replace('.lock', ''), 10)
    if (isNaN(port)) continue

    const filePath = join(dir, file)
    try {
      const content = readFileSync(filePath, 'utf-8')
      const lockfile = JSON.parse(content) as IdeLockfile
      if (!lockfile.workspaceFolders || !lockfile.pid || !lockfile.authToken) continue
      results.push({ port, path: filePath, lockfile })
    } catch {
      continue
    }
  }
  return results
}

export function isLockfileValid(lockfile: IdeLockfile): boolean {
  try {
    process.kill(lockfile.pid, 0)
    return true
  } catch {
    return false
  }
}

export function matchesWorkspace(lockfile: IdeLockfile, cwd: string): boolean {
  const normalizedCwd = cwd.replace(/\/+$/, '')
  return lockfile.workspaceFolders.some(folder => {
    const normalizedFolder = folder.replace(/\/+$/, '')
    return normalizedCwd === normalizedFolder || normalizedCwd.startsWith(normalizedFolder + '/')
  })
}

export function removeStaleLockfile(filePath: string): void {
  try { unlinkSync(filePath) } catch {}
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx vitest run tests/ide-lockfile.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ide/lockfile.ts packages/core/tests/ide-lockfile.test.ts
git commit -m "feat(ide): add lockfile scanner with tests"
```

---

### Task 4: IDE Client (WebSocket Connection Wrapper)

**Files:**
- Create: `packages/core/src/ide/ide-client.ts`
- Modify: `packages/core/package.json` — add `ws` dependency

- [ ] **Step 1: Add ws dependency**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npm install ws && npm install -D @types/ws`

- [ ] **Step 2: Create ide-client.ts**

```typescript
// packages/core/src/ide/ide-client.ts
import WebSocket from 'ws'
import { JsonRpcProtocol } from './protocol.js'
import type { IdeConnectionStatus, SelectionData, AtMentionData } from './types.js'

interface IdeClientCallbacks {
  onStatusChanged: (status: IdeConnectionStatus) => void
  onSelectionChanged: (data: SelectionData) => void
  onAtMentioned: (data: AtMentionData) => void
}

export class IdeClient {
  private ws: WebSocket | null = null
  private protocol = new JsonRpcProtocol()
  private status: IdeConnectionStatus = 'disconnected'
  private pingInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private port: number,
    private authToken: string,
    private callbacks: IdeClientCallbacks
  ) {
    this.protocol.onNotification('selection_changed', (params) => {
      this.callbacks.onSelectionChanged(params as SelectionData)
    })
    this.protocol.onNotification('at_mentioned', (params) => {
      this.callbacks.onAtMentioned(params as AtMentionData)
    })
  }

  get connectionStatus(): IdeConnectionStatus { return this.status }

  async connect(): Promise<void> {
    if (this.ws) return
    this.setStatus('connecting')

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`)

      const timeout = setTimeout(() => {
        ws.terminate()
        this.setStatus('error')
        reject(new Error('Connection timeout'))
      }, 5000)

      ws.on('open', async () => {
        clearTimeout(timeout)
        this.ws = ws
        try {
          await this.initialize()
          this.setStatus('connected')
          this.startPing()
          resolve()
        } catch (err) {
          this.ws = null
          ws.close()
          this.setStatus('error')
          reject(err)
        }
      })

      ws.on('message', (data) => {
        this.protocol.handleMessage(data.toString())
      })

      ws.on('close', () => {
        this.cleanup()
        this.setStatus('disconnected')
      })

      ws.on('error', (err) => {
        clearTimeout(timeout)
        this.cleanup()
        this.setStatus('error')
        reject(err)
      })
    })
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.cleanup()
    }
    this.setStatus('disconnected')
  }

  async call(method: string, params: Record<string, unknown>): Promise<any> {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('IDE not connected')
    }
    const { message, id } = this.protocol.createRequest(method, params)
    this.ws.send(message)
    return this.protocol.waitForResponse(id)
  }

  private async initialize(): Promise<void> {
    const { message, id } = this.protocol.createRequest('initialize', {
      clientName: 'jdcagnet',
      clientVersion: '1.0.0',
      authToken: this.authToken,
    })
    this.ws!.send(message)
    await this.protocol.waitForResponse(id, 5000)
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping()
      }
    }, 30000)
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    this.protocol.clearPending()
    this.ws = null
  }

  private setStatus(status: IdeConnectionStatus): void {
    this.status = status
    this.callbacks.onStatusChanged(status)
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/ide/ide-client.ts packages/core/package.json packages/core/package-lock.json
git commit -m "feat(ide): add WebSocket client wrapper"
```

---

### Task 5: IDE Manager (Discovery + Lifecycle)

**Files:**
- Create: `packages/core/src/ide/ide-manager.ts`

- [ ] **Step 1: Create ide-manager.ts**

```typescript
// packages/core/src/ide/ide-manager.ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { IdeClient } from './ide-client.js'
import { scanLockfiles, isLockfileValid, matchesWorkspace, removeStaleLockfile } from './lockfile.js'
import type { IdeConnection, IdeCallbacks, OpenDiffParams, OpenDiffResult, DiagnosticFile } from './types.js'

const IDE_DIR = join(homedir(), '.jdcagnet', 'ide')
const SCAN_INTERVAL = 5000
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]

export class IdeManager {
  private clients = new Map<number, IdeClient>()
  private connections = new Map<number, IdeConnection>()
  private scanTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private reconnectAttempts = new Map<number, number>()
  private cwd = ''

  constructor(private callbacks: IdeCallbacks) {
    mkdirSync(IDE_DIR, { recursive: true })
  }

  startDiscovery(cwd: string): void {
    this.cwd = cwd
    this.scan()
    this.scanTimer = setInterval(() => this.scan(), SCAN_INTERVAL)
  }

  stopDiscovery(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer)
      this.scanTimer = null
    }
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
  }

  getConnections(): IdeConnection[] {
    return Array.from(this.connections.values())
  }

  isConnected(): boolean {
    return Array.from(this.connections.values()).some(c => c.status === 'connected')
  }

  async openFile(filePath: string, line?: number, column?: number): Promise<void> {
    const client = this.getActiveClient()
    if (!client) throw new Error('No IDE connected')
    await client.call('openFile', { filePath, line, column })
  }

  async openDiff(params: OpenDiffParams): Promise<OpenDiffResult> {
    const client = this.getActiveClient()
    if (!client) throw new Error('No IDE connected')
    return client.call('openDiff', params) as Promise<OpenDiffResult>
  }

  async closeAllDiffTabs(): Promise<void> {
    const client = this.getActiveClient()
    if (!client) return
    await client.call('closeAllDiffTabs', {})
  }

  async getDiagnostics(filePaths: string[]): Promise<DiagnosticFile[]> {
    const client = this.getActiveClient()
    if (!client) throw new Error('No IDE connected')
    const result = await client.call('getDiagnostics', { filePaths })
    return result.files || []
  }

  shutdown(): void {
    this.stopDiscovery()
    for (const client of this.clients.values()) client.disconnect()
    this.clients.clear()
    this.connections.clear()
  }

  private scan(): void {
    const lockfiles = scanLockfiles(IDE_DIR)

    for (const { port, path: filePath, lockfile } of lockfiles) {
      if (!isLockfileValid(lockfile)) {
        removeStaleLockfile(filePath)
        this.removeConnection(port)
        continue
      }
      if (!matchesWorkspace(lockfile, this.cwd)) continue
      if (this.clients.has(port)) continue

      this.connectToIde(port, lockfile.authToken, lockfile.ideName, lockfile.workspaceFolders)
    }

    // Remove connections whose lockfiles disappeared
    for (const port of this.clients.keys()) {
      if (!lockfiles.some(l => l.port === port)) {
        this.removeConnection(port)
      }
    }
  }

  private async connectToIde(port: number, authToken: string, ideName: string, workspaceFolders: string[]): Promise<void> {
    const client = new IdeClient(port, authToken, {
      onStatusChanged: (status) => {
        this.connections.set(port, { port, ideName, workspaceFolders, status })
        this.callbacks.onConnectionChanged(this.getConnections())

        if (status === 'disconnected' || status === 'error') {
          this.scheduleReconnect(port, authToken, ideName, workspaceFolders)
        }
        if (status === 'connected') {
          this.reconnectAttempts.delete(port)
        }
      },
      onSelectionChanged: (data) => this.callbacks.onSelectionChanged(data),
      onAtMentioned: (data) => this.callbacks.onAtMentioned(data),
    })

    this.clients.set(port, client)
    this.connections.set(port, { port, ideName, workspaceFolders, status: 'connecting' })
    this.callbacks.onConnectionChanged(this.getConnections())

    try {
      await client.connect()
    } catch {
      // Connection failed — will retry via scheduleReconnect
    }
  }

  private scheduleReconnect(port: number, authToken: string, ideName: string, workspaceFolders: string[]): void {
    const attempts = this.reconnectAttempts.get(port) || 0
    if (attempts >= RECONNECT_DELAYS.length) return

    const delay = RECONNECT_DELAYS[attempts]
    this.reconnectAttempts.set(port, attempts + 1)

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(port)
      const client = this.clients.get(port)
      if (!client) return
      try {
        await client.connect()
      } catch {
        // Will retry again via onStatusChanged callback
      }
    }, delay)
    this.reconnectTimers.set(port, timer)
  }

  private removeConnection(port: number): void {
    const client = this.clients.get(port)
    if (client) client.disconnect()
    this.clients.delete(port)
    this.connections.delete(port)
    const timer = this.reconnectTimers.get(port)
    if (timer) clearTimeout(timer)
    this.reconnectTimers.delete(port)
    this.reconnectAttempts.delete(port)
    this.callbacks.onConnectionChanged(this.getConnections())
  }

  private getActiveClient(): IdeClient | null {
    for (const client of this.clients.values()) {
      if (client.connectionStatus === 'connected') return client
    }
    return null
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/ide/ide-manager.ts
git commit -m "feat(ide): add IDE manager with discovery and reconnection"
```

---

### Task 6: Core IDE Module Exports

**Files:**
- Create: `packages/core/src/ide/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/tool-registry.ts`

- [ ] **Step 1: Create index.ts**

```typescript
// packages/core/src/ide/index.ts
export { IdeManager } from './ide-manager.js'
export { IdeClient } from './ide-client.js'
export { JsonRpcProtocol } from './protocol.js'
export { scanLockfiles, isLockfileValid, matchesWorkspace, removeStaleLockfile } from './lockfile.js'
export type {
  IdeLockfile, IdeConnection, IdeConnectionStatus,
  SelectionData, AtMentionData, OpenDiffParams, OpenDiffResult,
  Diagnostic, DiagnosticFile, IdeCallbacks,
} from './types.js'
```

- [ ] **Step 2: Add IDE export to core index.ts**

Add to the end of `packages/core/src/index.ts`:

```typescript
export { IdeManager } from './ide/index.js'
export type { IdeConnection, IdeConnectionStatus, SelectionData, AtMentionData, OpenDiffParams, OpenDiffResult, DiagnosticFile, IdeCallbacks } from './ide/index.js'
```

- [ ] **Step 3: Add ideManager to ToolContext**

In `packages/core/src/tool-registry.ts`, add to the `ToolContext` interface:

```typescript
export interface ToolContext {
  cwd: string
  signal?: AbortSignal
  onProgress?: (message: string) => void
  toolUseId?: string
  fileTracker?: import('./file-tracker.js').FileTracker
  turnIndex?: number
  backgroundTasks?: import('./background-tasks.js').BackgroundTaskManager
  ideManager?: import('./ide/ide-manager.js').IdeManager
}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ide/index.ts packages/core/src/index.ts packages/core/src/tool-registry.ts
git commit -m "feat(ide): export IDE module and add ideManager to ToolContext"
```

---

### Task 7: Electron IPC Channels + Handlers

**Files:**
- Modify: `packages/electron/src/ipc-channels.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`

- [ ] **Step 1: Add IDE channels to ipc-channels.ts**

Add after the `APPS_OPEN` line in `packages/electron/src/ipc-channels.ts`:

```typescript
  // IDE Integration
  IDE_GET_STATE: 'ide:get-state',
  IDE_OPEN_FILE: 'ide:open-file',
  IDE_OPEN_DIFF: 'ide:open-diff',
  IDE_CLOSE_DIFF_TABS: 'ide:close-diff-tabs',
  IDE_GET_DIAGNOSTICS: 'ide:get-diagnostics',
```

- [ ] **Step 2: Add IDE handlers in ipc-handlers.ts**

Add at the end of `registerIpcHandlers` function in `packages/electron/src/ipc-handlers.ts`:

```typescript
  // IDE Integration
  ipcMain.handle(IPC_CHANNELS.IDE_GET_STATE, async () => {
    return sessionManager.getIdeConnections()
  })

  ipcMain.handle(IPC_CHANNELS.IDE_OPEN_FILE, async (_event, { filePath, line, column }) => {
    await sessionManager.ideOpenFile(filePath, line, column)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.IDE_OPEN_DIFF, async (_event, params) => {
    return sessionManager.ideOpenDiff(params)
  })

  ipcMain.handle(IPC_CHANNELS.IDE_CLOSE_DIFF_TABS, async () => {
    await sessionManager.ideCloseAllDiffTabs()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.IDE_GET_DIAGNOSTICS, async (_event, { filePaths }) => {
    return sessionManager.ideGetDiagnostics(filePaths)
  })
```

- [ ] **Step 3: Commit**

```bash
git add packages/electron/src/ipc-channels.ts packages/electron/src/ipc-handlers.ts
git commit -m "feat(ide): add Electron IPC channels and handlers"
```

---

### Task 8: SessionManager IDE Integration

**Files:**
- Modify: `packages/electron/src/session-manager.ts`

- [ ] **Step 1: Add IdeManager to SessionManager**

Add import at top of `packages/electron/src/session-manager.ts`:

```typescript
import { IdeManager, type IdeConnection, type OpenDiffParams, type OpenDiffResult, type DiagnosticFile } from '@jdcagnet/core'
```

Add field after `private mcpManager`:

```typescript
  private ideManager: IdeManager
```

In the constructor, after `this.mcpManager = new McpManager(...)`:

```typescript
    this.ideManager = new IdeManager({
      onConnectionChanged: (connections) => {
        this.window?.webContents.send('ide:state-changed', connections)
      },
      onSelectionChanged: (data) => {
        this.window?.webContents.send('ide:selection-changed', data)
      },
      onAtMentioned: (data) => {
        this.window?.webContents.send('ide:at-mentioned', data)
      },
    })
```

- [ ] **Step 2: Add IDE methods to SessionManager**

Add these methods to the `SessionManager` class:

```typescript
  startIdeDiscovery(cwd: string): void {
    this.ideManager.startDiscovery(cwd)
  }

  getIdeConnections(): IdeConnection[] {
    return this.ideManager.getConnections()
  }

  async ideOpenFile(filePath: string, line?: number, column?: number): Promise<void> {
    await this.ideManager.openFile(filePath, line, column)
  }

  async ideOpenDiff(params: OpenDiffParams): Promise<OpenDiffResult> {
    return this.ideManager.openDiff(params)
  }

  async ideCloseAllDiffTabs(): Promise<void> {
    await this.ideManager.closeAllDiffTabs()
  }

  async ideGetDiagnostics(filePaths: string[]): Promise<DiagnosticFile[]> {
    return this.ideManager.getDiagnostics(filePaths)
  }
```

- [ ] **Step 3: Start discovery when session activates**

In `activateSession`, after `session.resolveModel = ...` block, add:

```typescript
    this.ideManager.startDiscovery(meta.cwd)
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/electron && node build.mjs`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/electron/src/session-manager.ts
git commit -m "feat(ide): integrate IdeManager into SessionManager"
```

---

### Task 9: Preload API

**Files:**
- Modify: `packages/electron/src/preload.ts`

- [ ] **Step 1: Add IDE methods to preload API**

Add after the `appsOpen` line in `packages/electron/src/preload.ts`:

```typescript
  // IDE Integration
  ideGetState: () => ipcRenderer.invoke('ide:get-state'),
  ideOpenFile: (filePath: string, line?: number, column?: number) =>
    ipcRenderer.invoke('ide:open-file', { filePath, line, column }),
  ideOpenDiff: (params: any) => ipcRenderer.invoke('ide:open-diff', params),
  ideCloseDiffTabs: () => ipcRenderer.invoke('ide:close-diff-tabs'),
  ideGetDiagnostics: (filePaths: string[]) =>
    ipcRenderer.invoke('ide:get-diagnostics', { filePaths }),
  onIdeStateChanged: (callback: (connections: any[]) => void) => {
    const listener = (_event: unknown, connections: any[]) => callback(connections)
    ipcRenderer.on('ide:state-changed', listener)
    return () => { ipcRenderer.removeListener('ide:state-changed', listener) }
  },
  onIdeSelectionChanged: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data)
    ipcRenderer.on('ide:selection-changed', listener)
    return () => { ipcRenderer.removeListener('ide:selection-changed', listener) }
  },
  onIdeAtMentioned: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data)
    ipcRenderer.on('ide:at-mentioned', listener)
    return () => { ipcRenderer.removeListener('ide:at-mentioned', listener) }
  },
```

- [ ] **Step 2: Commit**

```bash
git add packages/electron/src/preload.ts
git commit -m "feat(ide): expose IDE APIs in preload"
```

---

### Task 10: UI — IDE Store

**Files:**
- Create: `packages/ui/src/stores/ide-store.ts`

- [ ] **Step 1: Create the Zustand store**

```typescript
// packages/ui/src/stores/ide-store.ts
import { create } from 'zustand'

interface IdeConnection {
  port: number
  ideName: string
  workspaceFolders: string[]
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
}

interface SelectionData {
  filePath?: string
  text?: string
  selection?: { start: { line: number; character: number }; end: { line: number; character: number } } | null
}

interface AtMentionData {
  filePath: string
  lineStart?: number
  lineEnd?: number
}

interface IdeState {
  connections: IdeConnection[]
  selection: SelectionData | null
  atMentions: AtMentionData[]
  bannerDismissed: boolean
  setConnections: (connections: IdeConnection[]) => void
  setSelection: (data: SelectionData | null) => void
  addAtMention: (data: AtMentionData) => void
  removeAtMention: (index: number) => void
  clearAtMentions: () => void
  dismissBanner: () => void
}

export const useIdeStore = create<IdeState>((set) => ({
  connections: [],
  selection: null,
  atMentions: [],
  bannerDismissed: false,
  setConnections: (connections) => set({ connections }),
  setSelection: (selection) => set({ selection }),
  addAtMention: (data) => set((s) => ({ atMentions: [...s.atMentions, data] })),
  removeAtMention: (index) => set((s) => ({ atMentions: s.atMentions.filter((_, i) => i !== index) })),
  clearAtMentions: () => set({ atMentions: [] }),
  dismissBanner: () => set({ bannerDismissed: true }),
}))

export function initIdeListeners(): () => void {
  const api = (window as any).electronAPI
  if (!api?.onIdeStateChanged) return () => {}

  const unsub1 = api.onIdeStateChanged((connections: IdeConnection[]) => {
    useIdeStore.getState().setConnections(connections)
  })
  const unsub2 = api.onIdeSelectionChanged((data: SelectionData) => {
    useIdeStore.getState().setSelection(data)
  })
  const unsub3 = api.onIdeAtMentioned((data: AtMentionData) => {
    useIdeStore.getState().addAtMention(data)
  })

  return () => { unsub1?.(); unsub2?.(); unsub3?.() }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/ide-store.ts
git commit -m "feat(ide): add UI Zustand store for IDE state"
```

---

### Task 11: UI — Topbar Connection Indicator

**Files:**
- Modify: `packages/ui/src/components/Topbar.tsx`

- [ ] **Step 1: Add IDE indicator to Topbar**

In `packages/ui/src/components/Topbar.tsx`, add import:

```typescript
import { useIdeStore } from '../stores/ide-store'
```

Inside the `Topbar` component, add:

```typescript
  const ideConnections = useIdeStore((s) => s.connections)
  const connectedIde = ideConnections.find((c) => c.status === 'connected')
```

Add the indicator in the JSX, before the ThemeSegmented:

```tsx
        {connectedIde && (
          <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-[var(--muted)]">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span>{connectedIde.ideName}</span>
          </div>
        )}
```

- [ ] **Step 2: Verify UI renders**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/electron && npm run dev`
Expected: App starts, no errors. When no IDE connected, no indicator shown.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/Topbar.tsx
git commit -m "feat(ide): add connection indicator to Topbar"
```

---

### Task 12: VS Code Extension — Scaffold

**Files:**
- Create: `packages/vscode-extension/package.json`
- Create: `packages/vscode-extension/tsconfig.json`
- Create: `packages/vscode-extension/esbuild.mjs`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "jdcagnet-ide",
  "displayName": "JDC Code IDE",
  "description": "Bidirectional communication between JDC Code and VS Code",
  "version": "0.1.0",
  "publisher": "jdcagnet",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "jdcagnet.sendToChat", "title": "Send to JDC Code (@)" }
    ],
    "menus": {
      "editor/context": [
        { "command": "jdcagnet.sendToChat", "group": "jdcagnet@1" }
      ]
    }
  },
  "scripts": {
    "build": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "package": "npx @vscode/vsce package --no-dependencies"
  },
  "dependencies": {
    "ws": "^8.16.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/ws": "^8.5.10",
    "@types/uuid": "^11.0.0",
    "@vscode/vsce": "^3.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create esbuild.mjs**

```javascript
import { build } from 'esbuild'

const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
}

if (watch) {
  const ctx = await (await import('esbuild')).context(options)
  await ctx.watch()
  console.log('Watching...')
} else {
  await build(options)
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/vscode-extension && npm install`

- [ ] **Step 5: Commit**

```bash
git add packages/vscode-extension/package.json packages/vscode-extension/tsconfig.json packages/vscode-extension/esbuild.mjs
git commit -m "feat(vscode): scaffold VS Code extension"
```

---

### Task 13: VS Code Extension — Server + Lockfile

**Files:**
- Create: `packages/vscode-extension/src/server.ts`
- Create: `packages/vscode-extension/src/lockfile.ts`

- [ ] **Step 1: Create server.ts**

```typescript
// packages/vscode-extension/src/server.ts
import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'node:net'

export interface ServerCallbacks {
  onInitialize: (ws: WebSocket, params: any) => any
  onRequest: (ws: WebSocket, method: string, params: any) => Promise<any>
}

export class IdeServer {
  private wss: WebSocketServer | null = null
  private clients = new Set<WebSocket>()
  port = 0

  async start(callbacks: ServerCallbacks): Promise<number> {
    this.port = await this.findFreePort()
    this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' })

    this.wss.on('connection', (ws) => {
      this.clients.add(ws)
      ws.on('message', async (raw) => {
        let msg: any
        try { msg = JSON.parse(raw.toString()) } catch { return }

        if (msg.method && msg.id !== undefined) {
          try {
            let result: any
            if (msg.method === 'initialize') {
              result = callbacks.onInitialize(ws, msg.params)
            } else {
              result = await callbacks.onRequest(ws, msg.method, msg.params)
            }
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
          } catch (err: any) {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -1, message: err.message } }))
          }
        }
      })
      ws.on('close', () => { this.clients.delete(ws) })
    })

    return this.port
  }

  sendNotification(method: string, params: any): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params })
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg)
    }
  }

  stop(): void {
    for (const ws of this.clients) ws.close()
    this.clients.clear()
    this.wss?.close()
    this.wss = null
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer()
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as any
        srv.close(() => resolve(addr.port))
      })
      srv.on('error', reject)
    })
  }
}
```

- [ ] **Step 2: Create lockfile.ts**

```typescript
// packages/vscode-extension/src/lockfile.ts
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { v4 as uuid } from 'uuid'

const IDE_DIR = join(homedir(), '.jdcagnet', 'ide')

export class LockfileManager {
  private filePath: string | null = null
  readonly authToken = uuid()

  write(port: number, workspaceFolders: string[]): void {
    mkdirSync(IDE_DIR, { recursive: true })
    this.filePath = join(IDE_DIR, `${port}.lock`)
    const content = JSON.stringify({
      workspaceFolders,
      pid: process.pid,
      ideName: 'VS Code',
      authToken: this.authToken,
      version: '0.1.0',
      timestamp: Date.now(),
    }, null, 2)
    writeFileSync(this.filePath, content)
  }

  remove(): void {
    if (this.filePath) {
      try { unlinkSync(this.filePath) } catch {}
      this.filePath = null
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/vscode-extension/src/server.ts packages/vscode-extension/src/lockfile.ts
git commit -m "feat(vscode): add WebSocket server and lockfile manager"
```

---

### Task 14: VS Code Extension — RPC Handlers + Entry Point

**Files:**
- Create: `packages/vscode-extension/src/rpc-handler.ts`
- Create: `packages/vscode-extension/src/diff-provider.ts`
- Create: `packages/vscode-extension/src/selection.ts`
- Create: `packages/vscode-extension/src/at-mention.ts`
- Create: `packages/vscode-extension/src/extension.ts`

- [ ] **Step 1: Create diff-provider.ts**

```typescript
// packages/vscode-extension/src/diff-provider.ts
import * as vscode from 'vscode'

const SCHEME = 'jdcagnet-diff'
const contents = new Map<string, string>()

export const diffContentProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return contents.get(uri.path) || ''
  },
}

export function setDiffContent(key: string, content: string): vscode.Uri {
  contents.set(key, content)
  return vscode.Uri.parse(`${SCHEME}:${key}`)
}

export function clearDiffContent(key: string): void {
  contents.delete(key)
}

export const DIFF_SCHEME = SCHEME
```

- [ ] **Step 2: Create rpc-handler.ts**

```typescript
// packages/vscode-extension/src/rpc-handler.ts
import * as vscode from 'vscode'
import { setDiffContent, clearDiffContent } from './diff-provider.js'

const openDiffTabs = new Map<string, { resolve: (result: any) => void }>()

export async function handleOpenFile(params: any): Promise<any> {
  const uri = vscode.Uri.file(params.filePath)
  const doc = await vscode.workspace.openTextDocument(uri)
  const editor = await vscode.window.showTextDocument(doc)
  if (params.line) {
    const pos = new vscode.Position((params.line || 1) - 1, (params.column || 1) - 1)
    editor.selection = new vscode.Selection(pos, pos)
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
  }
  return { success: true }
}

export function handleOpenDiff(params: any): Promise<any> {
  return new Promise(async (resolve) => {
    const tabName = params.tabName || `[JDC Code] diff`
    const originalUri = setDiffContent(`original-${tabName}`, params.originalContent)
    const proposedUri = setDiffContent(`proposed-${tabName}`, params.proposedContent)

    openDiffTabs.set(tabName, { resolve })

    await vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, tabName)
  })
}

export function handleCloseTab(params: any): any {
  const tabName = params.tabName
  const pending = openDiffTabs.get(tabName)
  if (pending) {
    pending.resolve({ action: 'closed' })
    openDiffTabs.delete(tabName)
  }
  clearDiffContent(`original-${tabName}`)
  clearDiffContent(`proposed-${tabName}`)
  return { success: true }
}

export function handleCloseAllDiffTabs(): any {
  let closed = 0
  for (const [tabName, pending] of openDiffTabs) {
    pending.resolve({ action: 'closed' })
    clearDiffContent(`original-${tabName}`)
    clearDiffContent(`proposed-${tabName}`)
    closed++
  }
  openDiffTabs.clear()
  return { closed }
}

export function handleGetDiagnostics(params: any): any {
  const files = (params.filePaths || []).map((filePath: string) => {
    const uri = vscode.Uri.file(filePath)
    const diagnostics = vscode.languages.getDiagnostics(uri)
    return {
      filePath,
      diagnostics: diagnostics.map(d => ({
        message: d.message,
        severity: d.severity === 0 ? 'error' : d.severity === 1 ? 'warning' : d.severity === 2 ? 'info' : 'hint',
        range: {
          start: { line: d.range.start.line, character: d.range.start.character },
          end: { line: d.range.end.line, character: d.range.end.character },
        },
        source: d.source,
        code: typeof d.code === 'object' ? String(d.code.value) : d.code ? String(d.code) : undefined,
      })),
    }
  })
  return { files }
}

export function resolveDiffTab(tabName: string, action: string, content?: string): void {
  const pending = openDiffTabs.get(tabName)
  if (pending) {
    pending.resolve({ action, content })
    openDiffTabs.delete(tabName)
  }
}
```

- [ ] **Step 3: Create selection.ts**

```typescript
// packages/vscode-extension/src/selection.ts
import * as vscode from 'vscode'

export function createSelectionTracker(onSelection: (data: any) => void): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined

  return vscode.window.onDidChangeTextEditorSelection((e) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const editor = e.textEditor
      const selection = editor.selection
      if (selection.isEmpty) {
        onSelection({ filePath: editor.document.uri.fsPath, text: undefined, selection: null })
        return
      }
      const text = editor.document.getText(selection)
      onSelection({
        filePath: editor.document.uri.fsPath,
        text,
        selection: {
          start: { line: selection.start.line, character: selection.start.character },
          end: { line: selection.end.line, character: selection.end.character },
        },
      })
    }, 500)
  })
}
```

- [ ] **Step 4: Create at-mention.ts**

```typescript
// packages/vscode-extension/src/at-mention.ts
import * as vscode from 'vscode'

export function registerAtMentionCommand(onMention: (data: any) => void): vscode.Disposable {
  return vscode.commands.registerCommand('jdcagnet.sendToChat', () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return

    const selection = editor.selection
    const filePath = editor.document.uri.fsPath
    onMention({
      filePath,
      lineStart: selection.start.line + 1,
      lineEnd: selection.end.line + 1,
    })
    vscode.window.showInformationMessage(`Sent to JDC Code: ${filePath.split('/').pop()}`)
  })
}
```

- [ ] **Step 5: Create extension.ts (entry point)**

```typescript
// packages/vscode-extension/src/extension.ts
import * as vscode from 'vscode'
import { IdeServer } from './server'
import { LockfileManager } from './lockfile'
import { diffContentProvider, DIFF_SCHEME } from './diff-provider'
import { handleOpenFile, handleOpenDiff, handleCloseTab, handleCloseAllDiffTabs, handleGetDiagnostics } from './rpc-handler'
import { createSelectionTracker } from './selection'
import { registerAtMentionCommand } from './at-mention'

let server: IdeServer | null = null
let lockfile: LockfileManager | null = null

export async function activate(context: vscode.ExtensionContext) {
  server = new IdeServer()
  lockfile = new LockfileManager()

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffContentProvider)
  )

  const workspaceFolders = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath)

  const port = await server.start({
    onInitialize: (_ws, params) => {
      if (params.authToken !== lockfile!.authToken) {
        throw new Error('Invalid auth token')
      }
      return {
        ideName: 'VS Code',
        ideVersion: vscode.version,
        capabilities: ['openFile', 'openDiff', 'getDiagnostics', 'selection', 'atMention'],
      }
    },
    onRequest: async (_ws, method, params) => {
      switch (method) {
        case 'openFile': return handleOpenFile(params)
        case 'openDiff': return handleOpenDiff(params)
        case 'closeTab': return handleCloseTab(params)
        case 'closeAllDiffTabs': return handleCloseAllDiffTabs()
        case 'getDiagnostics': return handleGetDiagnostics(params)
        default: throw new Error(`Unknown method: ${method}`)
      }
    },
  })

  lockfile.write(port, workspaceFolders)

  context.subscriptions.push(
    createSelectionTracker((data) => server?.sendNotification('selection_changed', data))
  )
  context.subscriptions.push(
    registerAtMentionCommand((data) => server?.sendNotification('at_mentioned', data))
  )

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.text = '$(plug) JDC Code'
  statusBar.tooltip = `JDC Code IDE server running on port ${port}`
  statusBar.show()
  context.subscriptions.push(statusBar)
}

export function deactivate() {
  server?.stop()
  lockfile?.remove()
}
```

- [ ] **Step 6: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/vscode-extension && npm run build`
Expected: `dist/extension.js` created without errors

- [ ] **Step 7: Commit**

```bash
git add packages/vscode-extension/src/
git commit -m "feat(vscode): implement full VS Code extension with RPC handlers"
```

---

### Task 15: JetBrains Plugin — Scaffold

**Files:**
- Create: `packages/jetbrains-plugin/build.gradle.kts`
- Create: `packages/jetbrains-plugin/settings.gradle.kts`
- Create: `packages/jetbrains-plugin/gradle.properties`
- Create: `packages/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`

- [ ] **Step 1: Create settings.gradle.kts**

```kotlin
// packages/jetbrains-plugin/settings.gradle.kts
rootProject.name = "jdcagnet-ide"
```

- [ ] **Step 2: Create gradle.properties**

```properties
# packages/jetbrains-plugin/gradle.properties
pluginVersion=0.1.0
platformVersion=2023.3
kotlinVersion=1.9.22
```

- [ ] **Step 3: Create build.gradle.kts**

```kotlin
// packages/jetbrains-plugin/build.gradle.kts
plugins {
    id("org.jetbrains.intellij") version "1.17.0"
    kotlin("jvm") version "1.9.22"
}

group = "com.jdcagnet.ide"
version = property("pluginVersion") as String

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.ktor:ktor-server-netty:2.3.7")
    implementation("io.ktor:ktor-server-websockets:2.3.7")
    implementation("com.google.code.gson:gson:2.10.1")
}

intellij {
    version.set(property("platformVersion") as String)
    type.set("IC")
}

tasks {
    patchPluginXml {
        sinceBuild.set("233")
        untilBuild.set("252.*")
    }
}

kotlin {
    jvmToolchain(17)
}
```

- [ ] **Step 4: Create plugin.xml**

```xml
<!-- packages/jetbrains-plugin/src/main/resources/META-INF/plugin.xml -->
<idea-plugin>
    <id>com.jdcagnet.ide</id>
    <name>JDC Code IDE</name>
    <vendor>JDCAGNET</vendor>
    <description>Bidirectional communication between JDC Code and JetBrains IDEs</description>

    <depends>com.intellij.modules.platform</depends>

    <applicationListeners>
        <listener class="com.jdcagnet.ide.JdcagnetPlugin"
                  topic="com.intellij.ide.AppLifecycleListener"/>
    </applicationListeners>

    <actions>
        <action id="jdcagnet.sendToChat"
                class="com.jdcagnet.ide.notifications.AtMentionAction"
                text="Send to JDC Code (@)"
                description="Send selected code to JDC Code">
            <add-to-group group-id="EditorPopupMenu" anchor="last"/>
        </action>
    </actions>
</idea-plugin>
```

- [ ] **Step 5: Commit**

```bash
git add packages/jetbrains-plugin/
git commit -m "feat(jetbrains): scaffold JetBrains plugin with Gradle"
```

---

### Task 16: JetBrains Plugin — WebSocket Server + Lockfile

**Files:**
- Create: `packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/server/WebSocketServer.kt`
- Create: `packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/server/LockfileManager.kt`
- Create: `packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/server/RpcHandler.kt`

- [ ] **Step 1: Create WebSocketServer.kt**

```kotlin
// packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/server/WebSocketServer.kt
package com.jdcagnet.ide.server

import com.google.gson.Gson
import com.google.gson.JsonObject
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import java.net.ServerSocket
import java.util.concurrent.ConcurrentHashMap

class IdeWebSocketServer(private val rpcHandler: RpcHandler) {
    private var server: ApplicationEngine? = null
    private val clients = ConcurrentHashMap.newKeySet<DefaultWebSocketServerSession>()
    private val gson = Gson()
    var port: Int = 0
        private set

    fun start(): Int {
        port = findFreePort()
        server = embeddedServer(Netty, port = port, host = "127.0.0.1") {
            install(WebSockets)
            routing {
                webSocket("/") {
                    clients.add(this)
                    try {
                        for (frame in incoming) {
                            if (frame is Frame.Text) {
                                val response = handleMessage(frame.readText())
                                if (response != null) send(Frame.Text(response))
                            }
                        }
                    } finally {
                        clients.remove(this)
                    }
                }
            }
        }.start(wait = false)
        return port
    }

    fun sendNotification(method: String, params: Any) {
        val msg = gson.toJson(mapOf("jsonrpc" to "2.0", "method" to method, "params" to params))
        runBlocking {
            clients.forEach { session ->
                try { session.send(Frame.Text(msg)) } catch (_: Exception) {}
            }
        }
    }

    fun stop() {
        server?.stop(500, 1000)
        server = null
        clients.clear()
    }

    private suspend fun handleMessage(raw: String): String? {
        val msg = gson.fromJson(raw, JsonObject::class.java) ?: return null
        val method = msg.get("method")?.asString ?: return null
        val id = msg.get("id")

        if (id == null) return null // notification from client, ignore for now

        val params = msg.getAsJsonObject("params") ?: JsonObject()
        return try {
            val result = rpcHandler.handle(method, params)
            gson.toJson(mapOf("jsonrpc" to "2.0", "id" to id.asInt, "result" to result))
        } catch (e: Exception) {
            gson.toJson(mapOf("jsonrpc" to "2.0", "id" to id.asInt, "error" to mapOf("code" to -1, "message" to e.message)))
        }
    }

    private fun findFreePort(): Int {
        ServerSocket(0).use { return it.localPort }
    }
}
```

- [ ] **Step 2: Create LockfileManager.kt**

```kotlin
// packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/server/LockfileManager.kt
package com.jdcagnet.ide.server

import com.google.gson.Gson
import java.io.File
import java.util.UUID

class LockfileManager {
    private var lockfile: File? = null
    val authToken: String = UUID.randomUUID().toString()
    private val gson = Gson()

    fun write(port: Int, workspaceFolders: List<String>) {
        val dir = File(System.getProperty("user.home"), ".jdcagnet/ide")
        dir.mkdirs()
        lockfile = File(dir, "$port.lock")
        val content = gson.toJson(mapOf(
            "workspaceFolders" to workspaceFolders,
            "pid" to ProcessHandle.current().pid(),
            "ideName" to "IntelliJ IDEA",
            "authToken" to authToken,
            "version" to "0.1.0",
            "timestamp" to System.currentTimeMillis()
        ))
        lockfile!!.writeText(content)
    }

    fun remove() {
        lockfile?.delete()
        lockfile = null
    }
}
```

- [ ] **Step 3: Create RpcHandler.kt**

```kotlin
// packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/server/RpcHandler.kt
package com.jdcagnet.ide.server

import com.google.gson.JsonObject
import com.jdcagnet.ide.handlers.OpenFileHandler
import com.jdcagnet.ide.handlers.DiagnosticsHandler

class RpcHandler(
    private val authToken: String,
    private val openFileHandler: OpenFileHandler,
    private val diagnosticsHandler: DiagnosticsHandler
) {
    suspend fun handle(method: String, params: JsonObject): Any {
        return when (method) {
            "initialize" -> handleInitialize(params)
            "openFile" -> openFileHandler.handle(params)
            "getDiagnostics" -> diagnosticsHandler.handle(params)
            "closeTab" -> mapOf("success" to true)
            "closeAllDiffTabs" -> mapOf("closed" to 0)
            else -> throw IllegalArgumentException("Unknown method: $method")
        }
    }

    private fun handleInitialize(params: JsonObject): Map<String, Any> {
        val token = params.get("authToken")?.asString
        if (token != authToken) throw SecurityException("Invalid auth token")
        return mapOf(
            "ideName" to "IntelliJ IDEA",
            "ideVersion" to "2024.1",
            "capabilities" to listOf("openFile", "getDiagnostics", "selection", "atMention")
        )
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/jetbrains-plugin/src/
git commit -m "feat(jetbrains): add WebSocket server, lockfile, and RPC handler"
```

---

### Task 17: JetBrains Plugin — Handlers + Entry Point

**Files:**
- Create: `packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/handlers/OpenFileHandler.kt`
- Create: `packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/handlers/DiagnosticsHandler.kt`
- Create: `packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/notifications/SelectionTracker.kt`
- Create: `packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/notifications/AtMentionAction.kt`
- Create: `packages/jetbrains-plugin/src/main/kotlin/com/jdcagnet/ide/JdcagnetPlugin.kt`

- [ ] **Step 1: Create OpenFileHandler.kt**

```kotlin
package com.jdcagnet.ide.handlers

import com.google.gson.JsonObject
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.vfs.LocalFileSystem

class OpenFileHandler {
    fun handle(params: JsonObject): Map<String, Any> {
        val filePath = params.get("filePath")?.asString ?: throw IllegalArgumentException("filePath required")
        val line = params.get("line")?.asInt ?: 0
        val column = params.get("column")?.asInt ?: 0

        ApplicationManager.getApplication().invokeLater {
            val vf = LocalFileSystem.getInstance().findFileByPath(filePath) ?: return@invokeLater
            val project = ProjectManager.getInstance().openProjects.firstOrNull() ?: return@invokeLater
            val descriptor = OpenFileDescriptor(project, vf, maxOf(0, line - 1), maxOf(0, column - 1))
            FileEditorManager.getInstance(project).openTextEditor(descriptor, true)
        }
        return mapOf("success" to true)
    }
}
```

- [ ] **Step 2: Create DiagnosticsHandler.kt**

```kotlin
package com.jdcagnet.ide.handlers

import com.google.gson.JsonObject
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.psi.PsiManager

class DiagnosticsHandler {
    fun handle(params: JsonObject): Map<String, Any> {
        val filePaths = params.getAsJsonArray("filePaths")?.map { it.asString } ?: emptyList()
        val project = ProjectManager.getInstance().openProjects.firstOrNull()
            ?: return mapOf("files" to emptyList<Any>())

        val files = filePaths.map { filePath ->
            mapOf("filePath" to filePath, "diagnostics" to emptyList<Any>())
        }
        return mapOf("files" to files)
    }
}
```

- [ ] **Step 3: Create SelectionTracker.kt**

```kotlin
package com.jdcagnet.ide.notifications

import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import java.util.Timer
import java.util.TimerTask

class SelectionTracker(private val onSelection: (Map<String, Any?>) -> Unit) : SelectionListener {
    private var timer: Timer? = null

    override fun selectionChanged(e: SelectionEvent) {
        timer?.cancel()
        timer = Timer()
        timer?.schedule(object : TimerTask() {
            override fun run() {
                val editor = e.editor
                val document = editor.document
                val vf = FileDocumentManager.getInstance().getFile(document)
                val selectionModel = editor.selectionModel
                val text = selectionModel.selectedText

                onSelection(mapOf(
                    "filePath" to vf?.path,
                    "text" to text,
                    "selection" to if (text != null) mapOf(
                        "start" to mapOf("line" to selectionModel.selectionStartPosition?.line, "character" to selectionModel.selectionStartPosition?.column),
                        "end" to mapOf("line" to selectionModel.selectionEndPosition?.line, "character" to selectionModel.selectionEndPosition?.column)
                    ) else null
                ))
            }
        }, 500)
    }
}
```

- [ ] **Step 4: Create AtMentionAction.kt**

```kotlin
package com.jdcagnet.ide.notifications

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.fileEditor.FileDocumentManager

class AtMentionAction : AnAction() {
    companion object {
        var onMention: ((Map<String, Any?>) -> Unit)? = null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val vf = FileDocumentManager.getInstance().getFile(editor.document) ?: return
        val selection = editor.selectionModel

        onMention?.invoke(mapOf(
            "filePath" to vf.path,
            "lineStart" to (selection.selectionStartPosition?.line?.plus(1)),
            "lineEnd" to (selection.selectionEndPosition?.line?.plus(1))
        ))
    }
}
```

- [ ] **Step 5: Create JdcagnetPlugin.kt**

```kotlin
package com.jdcagnet.ide

import com.intellij.ide.AppLifecycleListener
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.project.ProjectManager
import com.jdcagnet.ide.handlers.DiagnosticsHandler
import com.jdcagnet.ide.handlers.OpenFileHandler
import com.jdcagnet.ide.notifications.AtMentionAction
import com.jdcagnet.ide.notifications.SelectionTracker
import com.jdcagnet.ide.server.IdeWebSocketServer
import com.jdcagnet.ide.server.LockfileManager
import com.jdcagnet.ide.server.RpcHandler

class JdcagnetPlugin : AppLifecycleListener {
    private var server: IdeWebSocketServer? = null
    private var lockfile: LockfileManager? = null

    override fun appFrameCreated(commandLineArgs: MutableList<String>) {
        lockfile = LockfileManager()
        val rpcHandler = RpcHandler(lockfile!!.authToken, OpenFileHandler(), DiagnosticsHandler())
        server = IdeWebSocketServer(rpcHandler)

        val port = server!!.start()
        val workspaceFolders = ProjectManager.getInstance().openProjects.map { it.basePath ?: "" }.filter { it.isNotEmpty() }
        lockfile!!.write(port, workspaceFolders)

        val tracker = SelectionTracker { data -> server?.sendNotification("selection_changed", data) }
        EditorFactory.getInstance().eventMulticaster.addSelectionListener(tracker) {}

        AtMentionAction.onMention = { data -> server?.sendNotification("at_mentioned", data) }
    }

    override fun appWillBeClosed(isRestart: Boolean) {
        server?.stop()
        lockfile?.remove()
    }
}
```

- [ ] **Step 6: Verify Gradle build**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/jetbrains-plugin && ./gradlew buildPlugin`
Expected: Build succeeds, .zip created in `build/distributions/`

- [ ] **Step 7: Commit**

```bash
git add packages/jetbrains-plugin/src/
git commit -m "feat(jetbrains): implement handlers, selection tracker, and plugin entry"
```

---

### Task 18: CI/CD — GitHub Actions Workflows

**Files:**
- Create: `.github/workflows/vscode-extension.yml`
- Create: `.github/workflows/jetbrains-plugin.yml`

- [ ] **Step 1: Create VS Code workflow**

```yaml
# .github/workflows/vscode-extension.yml
name: VS Code Extension

on:
  push:
    tags: ['vscode-v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: cd packages/vscode-extension && npm ci
      - run: cd packages/vscode-extension && npm run build
      - run: cd packages/vscode-extension && npx @vscode/vsce package --no-dependencies
      - name: Upload to Release
        uses: softprops/action-gh-release@v1
        with:
          files: packages/vscode-extension/*.vsix
```

- [ ] **Step 2: Create JetBrains workflow**

```yaml
# .github/workflows/jetbrains-plugin.yml
name: JetBrains Plugin

on:
  push:
    tags: ['jetbrains-v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - run: cd packages/jetbrains-plugin && ./gradlew buildPlugin
      - name: Upload to Release
        uses: softprops/action-gh-release@v1
        with:
          files: packages/jetbrains-plugin/build/distributions/*.zip
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/vscode-extension.yml .github/workflows/jetbrains-plugin.yml
git commit -m "ci: add GitHub Actions for VS Code and JetBrains builds"
```

---

### Task 19: README Files

**Files:**
- Create: `packages/vscode-extension/README.md`
- Create: `packages/jetbrains-plugin/README.md`

- [ ] **Step 1: Create VS Code README**

```markdown
# JDC Code IDE — VS Code Extension

VS Code 与 JDC Code 桌面应用之间的双向通信扩展。

## 功能

- **Diff 预览** — AI 修改文件时可在 VS Code 中显示 diff，支持接受/拒绝/编辑
- **代码选中** — 在 VS Code 中选中代码自动传给 JDC Code 作为上下文
- **@引用** — 右键菜单 "Send to JDC Code (@)" 将文件/代码段发送给 AI
- **诊断信息** — JDC Code 可获取 VS Code 的 TypeScript/ESLint 等错误信息

## 安装

1. 从 [GitHub Releases](../../releases) 下载最新的 `.vsix` 文件
2. 在终端执行:

```bash
code --install-extension jdcagnet-ide-0.1.0.vsix
```

或在 VS Code 中: Extensions → ⋯ → Install from VSIX...

## 使用

1. 安装扩展后重启 VS Code
2. 打开项目文件夹（与 JDC Code 中的项目路径一致）
3. 启动 JDC Code 桌面应用并打开相同项目
4. 自动连接 — Topbar 显示绿色指示器 "VS Code"

### 右键菜单

在编辑器中选中代码 → 右键 → "Send to JDC Code (@)"

### 状态栏

底部状态栏显示 "$(plug) JDC Code" 表示服务运行中。

## 故障排查

**连接不上?**
- 确认 JDC Code 和 VS Code 打开的是同一个项目路径
- 检查 `~/.jdcagnet/ide/` 目录下是否有 `.lock` 文件
- 重启 VS Code 扩展: Cmd+Shift+P → "Developer: Restart Extension Host"

**残留 lockfile?**
- 如果 VS Code 异常退出，lockfile 可能残留
- JDC Code 会自动清理无效的 lockfile（检测 PID 存活）
- 手动清理: 删除 `~/.jdcagnet/ide/*.lock`
```

- [ ] **Step 2: Create JetBrains README**

```markdown
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

## 故障排查

**连接不上?**
- 确认 JDC Code 和 IDE 打开的是同一个项目路径
- 检查 `~/.jdcagnet/ide/` 目录下是否有 `.lock` 文件
- 重启 IDE

**残留 lockfile?**
- JDC Code 会自动清理无效的 lockfile
- 手动清理: 删除 `~/.jdcagnet/ide/*.lock`
```

- [ ] **Step 3: Commit**

```bash
git add packages/vscode-extension/README.md packages/jetbrains-plugin/README.md
git commit -m "docs: add README for VS Code extension and JetBrains plugin"
```

---

### Task 20: End-to-End Verification

- [ ] **Step 1: Build core package**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx tsc`
Expected: Compiles without errors

- [ ] **Step 2: Build electron package**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/electron && node build.mjs`
Expected: Builds without errors

- [ ] **Step 3: Build VS Code extension**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/vscode-extension && npm run build`
Expected: `dist/extension.js` created

- [ ] **Step 4: Package VS Code extension**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/vscode-extension && npm run package`
Expected: `.vsix` file created

- [ ] **Step 5: Run core tests**

Run: `cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npx vitest run tests/ide-protocol.test.ts tests/ide-lockfile.test.ts`
Expected: All tests pass

- [ ] **Step 6: Manual test — install VS Code extension and verify connection**

1. Install: `code --install-extension packages/vscode-extension/*.vsix`
2. Open project in VS Code
3. Start JDC Code electron app with same project
4. Verify: Topbar shows green dot + "VS Code"
5. Select code in VS Code → verify selection appears in JDC Code
6. Right-click "Send to JDC Code (@)" → verify @mention appears

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(ide): complete IDE extensions implementation"
```
