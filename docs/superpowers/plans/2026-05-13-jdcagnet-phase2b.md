# JDCAGNET Phase 2B: MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full MCP client support (stdio + SSE transports, dynamic tools, resources, config UI)

**Architecture:** McpManager in core handles server lifecycle; MCP tools registered dynamically into ToolRegistry; config in JSON files; UI panel for management

**Tech Stack:** @modelcontextprotocol/sdk, Electron IPC, existing ToolRegistry/ToolHandler

---

### Task 1: MCP Types & Configuration

**Files:**
- Create: `packages/core/src/mcp/types.ts`
- Create: `packages/core/src/mcp/config.ts`
- Test: `packages/core/tests/mcp-config.test.ts`

- [ ] **Step 1: Install MCP SDK dependency**

```bash
cd /Users/chenmingxu/Documents/jdcagnet
pnpm --filter @jdcagnet/core add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Write failing test for config loading**

```typescript
// packages/core/tests/mcp-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadMcpConfig, saveMcpConfig, mergeConfigs } from '../src/mcp/config.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TEST_DIR = path.join(os.tmpdir(), 'jdcagnet-mcp-test-' + Date.now())
const TEST_CWD = path.join(TEST_DIR, 'project')

beforeEach(() => {
  mkdirSync(path.join(TEST_CWD, '.jdcagnet'), { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('loadMcpConfig', () => {
  it('returns empty when no config files exist', () => {
    const config = loadMcpConfig('/nonexistent', '/nonexistent-global')
    expect(config).toEqual({})
  })

  it('loads global config', () => {
    const globalPath = path.join(TEST_DIR, 'global-mcp-servers.json')
    writeFileSync(globalPath, JSON.stringify({
      mcpServers: {
        filesystem: { transport: 'stdio', command: 'npx', args: ['server-fs'] }
      }
    }))
    const config = loadMcpConfig('/nonexistent', globalPath)
    expect(config.filesystem).toBeDefined()
    expect(config.filesystem.transport).toBe('stdio')
  })

  it('merges project config over global', () => {
    const globalPath = path.join(TEST_DIR, 'global-mcp-servers.json')
    writeFileSync(globalPath, JSON.stringify({
      mcpServers: {
        filesystem: { transport: 'stdio', command: 'npx', args: ['server-fs'] },
        other: { transport: 'sse', url: 'http://example.com/sse' }
      }
    }))
    const projectPath = path.join(TEST_CWD, '.jdcagnet', 'mcp-servers.json')
    writeFileSync(projectPath, JSON.stringify({
      mcpServers: {
        filesystem: { transport: 'stdio', command: 'node', args: ['custom.js'] }
      }
    }))
    const config = loadMcpConfig(TEST_CWD, globalPath)
    expect(config.filesystem.command).toBe('node')
    expect(config.other).toBeDefined()
  })
})

describe('mergeConfigs', () => {
  it('project overrides global for same server name', () => {
    const merged = mergeConfigs(
      { a: { transport: 'stdio', command: 'x', args: [] } },
      { a: { transport: 'stdio', command: 'y', args: [] } }
    )
    expect(merged.a.command).toBe('y')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @jdcagnet/core test -- mcp-config
```

Expected: FAIL (module not found)

- [ ] **Step 4: Create MCP types**

```typescript
// packages/core/src/mcp/types.ts
export type McpTransportType = 'stdio' | 'sse'

export interface McpStdioConfig {
  transport: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
  disabled?: boolean
}

export interface McpSseConfig {
  transport: 'sse'
  url: string
  headers?: Record<string, string>
  disabled?: boolean
}

export type McpServerConfig = McpStdioConfig | McpSseConfig

export type McpConnectionStatus = 'connected' | 'connecting' | 'failed' | 'disconnected' | 'disabled'

export interface McpServerState {
  name: string
  config: McpServerConfig
  status: McpConnectionStatus
  error?: string
  tools: McpToolInfo[]
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>
}
```

- [ ] **Step 5: Create config loader**

```typescript
// packages/core/src/mcp/config.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { McpServerConfig, McpConfigFile } from './types.js'

const CONFIG_DIR = path.join(os.homedir(), '.jdcagnet')
const GLOBAL_CONFIG_PATH = path.join(CONFIG_DIR, 'mcp-servers.json')

export function loadMcpConfig(cwd: string, globalPath: string = GLOBAL_CONFIG_PATH): Record<string, McpServerConfig> {
  const globalServers = loadConfigFile(globalPath)
  const projectPath = path.join(cwd, '.jdcagnet', 'mcp-servers.json')
  const projectServers = loadConfigFile(projectPath)
  return mergeConfigs(globalServers, projectServers)
}

export function saveMcpConfig(servers: Record<string, McpServerConfig>, scope: 'global' | 'project', cwd?: string): void {
  const configFile: McpConfigFile = { mcpServers: servers }
  let filePath: string
  if (scope === 'global') {
    mkdirSync(CONFIG_DIR, { recursive: true })
    filePath = GLOBAL_CONFIG_PATH
  } else {
    if (!cwd) throw new Error('cwd required for project scope')
    const dir = path.join(cwd, '.jdcagnet')
    mkdirSync(dir, { recursive: true })
    filePath = path.join(dir, 'mcp-servers.json')
  }
  writeFileSync(filePath, JSON.stringify(configFile, null, 2), 'utf-8')
}

export function mergeConfigs(
  global: Record<string, McpServerConfig>,
  project: Record<string, McpServerConfig>
): Record<string, McpServerConfig> {
  return { ...global, ...project }
}

function loadConfigFile(filePath: string): Record<string, McpServerConfig> {
  if (!existsSync(filePath)) return {}
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as McpConfigFile
    return raw.mcpServers || {}
  } catch {
    return {}
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @jdcagnet/core test -- mcp-config
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/mcp/ packages/core/tests/mcp-config.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(mcp): add MCP types and configuration loader"
```

---

### Task 2: MCP Manager — Server Lifecycle

**Files:**
- Create: `packages/core/src/mcp/manager.ts`
- Test: `packages/core/tests/mcp-manager.test.ts`

- [ ] **Step 1: Write failing test for McpManager**

```typescript
// packages/core/tests/mcp-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpManager } from '../src/mcp/manager.js'

describe('McpManager', () => {
  it('initializes with empty state', () => {
    const manager = new McpManager()
    expect(manager.getServerStates()).toEqual([])
  })

  it('reports disabled servers', async () => {
    const manager = new McpManager()
    await manager.loadConfig({
      disabled: { transport: 'stdio', command: 'echo', args: [], disabled: true }
    })
    const states = manager.getServerStates()
    expect(states).toHaveLength(1)
    expect(states[0].status).toBe('disabled')
  })

  it('getTools returns empty when no servers connected', () => {
    const manager = new McpManager()
    expect(manager.getTools()).toEqual([])
  })

  it('close is safe to call multiple times', async () => {
    const manager = new McpManager()
    await manager.close()
    await manager.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @jdcagnet/core test -- mcp-manager
```

- [ ] **Step 3: Implement McpManager**

```typescript
// packages/core/src/mcp/manager.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpServerConfig, McpServerState, McpToolInfo, McpConnectionStatus } from './types.js'

interface ConnectedServer {
  name: string
  config: McpServerConfig
  client: Client
  transport: StdioClientTransport | SSEClientTransport
  tools: McpToolInfo[]
  status: McpConnectionStatus
  error?: string
}

export class McpManager {
  private servers = new Map<string, ConnectedServer>()
  private onStateChange?: () => void

  constructor(onStateChange?: () => void) {
    this.onStateChange = onStateChange
  }

  async loadConfig(configs: Record<string, McpServerConfig>): Promise<void> {
    for (const [name, config] of Object.entries(configs)) {
      if (config.disabled) {
        this.servers.set(name, {
          name, config, client: null as any, transport: null as any,
          tools: [], status: 'disabled',
        })
        continue
      }
      await this.connectServer(name, config)
    }
  }

  async connectServer(name: string, config: McpServerConfig): Promise<void> {
    const existing = this.servers.get(name)
    if (existing?.status === 'connected') {
      await this.disconnectServer(name)
    }

    this.servers.set(name, {
      name, config, client: null as any, transport: null as any,
      tools: [], status: 'connecting',
    })
    this.onStateChange?.()

    try {
      const transport = this.createTransport(config)
      const client = new Client({ name: 'jdcagnet', version: '0.0.1' }, { capabilities: {} })
      await client.connect(transport)

      const toolsResult = await client.listTools()
      const tools: McpToolInfo[] = (toolsResult.tools || []).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }))

      this.servers.set(name, { name, config, client, transport, tools, status: 'connected' })
      this.onStateChange?.()
    } catch (err: any) {
      this.servers.set(name, {
        name, config, client: null as any, transport: null as any,
        tools: [], status: 'failed', error: err.message,
      })
      this.onStateChange?.()
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server || !server.client) return
    try { await server.client.close() } catch {}
    server.status = 'disconnected'
    server.tools = []
    this.onStateChange?.()
  }

  async reconnectServer(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) return
    await this.connectServer(name, server.config)
  }

  getServerStates(): McpServerState[] {
    return Array.from(this.servers.values()).map(s => ({
      name: s.name,
      config: s.config,
      status: s.status,
      error: s.error,
      tools: s.tools,
    }))
  }

  getTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = []
    for (const server of this.servers.values()) {
      if (server.status === 'connected') {
        for (const tool of server.tools) {
          tools.push({ ...tool, name: `mcp__${server.name}__${tool.name}` })
        }
      }
    }
    return tools
  }

  async callTool(fullName: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
    const parts = fullName.split('__')
    if (parts.length < 3 || parts[0] !== 'mcp') {
      return { content: `Invalid MCP tool name: ${fullName}`, isError: true }
    }
    const serverName = parts[1]
    const toolName = parts.slice(2).join('__')
    const server = this.servers.get(serverName)
    if (!server || server.status !== 'connected') {
      return { content: `MCP server "${serverName}" is not connected`, isError: true }
    }
    try {
      const result = await server.client.callTool({ name: toolName, arguments: args })
      const text = (result.content as any[])
        ?.map((c: any) => c.type === 'text' ? c.text : JSON.stringify(c))
        .join('\n') || ''
      return { content: text, isError: result.isError as boolean | undefined }
    } catch (err: any) {
      return { content: `MCP tool error: ${err.message}`, isError: true }
    }
  }

  async listResources(serverName?: string): Promise<{ uri: string; name: string; description?: string; mimeType?: string; server: string }[]> {
    const results: any[] = []
    const targets = serverName
      ? [this.servers.get(serverName)].filter(Boolean)
      : Array.from(this.servers.values()).filter(s => s.status === 'connected')

    for (const server of targets) {
      if (!server || server.status !== 'connected') continue
      try {
        const res = await server.client.listResources()
        for (const r of res.resources || []) {
          results.push({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType, server: server.name })
        }
      } catch {}
    }
    return results
  }

  async readResource(serverName: string, uri: string): Promise<{ content: string; mimeType?: string }> {
    const server = this.servers.get(serverName)
    if (!server || server.status !== 'connected') {
      throw new Error(`MCP server "${serverName}" is not connected`)
    }
    const result = await server.client.readResource({ uri })
    const content = (result.contents || [])
      .map((c: any) => c.text || '')
      .join('\n')
    return { content, mimeType: (result.contents?.[0] as any)?.mimeType }
  }

  async close(): Promise<void> {
    for (const [name] of this.servers) {
      await this.disconnectServer(name)
    }
    this.servers.clear()
  }

  private createTransport(config: McpServerConfig): StdioClientTransport | SSEClientTransport {
    if (config.transport === 'stdio') {
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
      })
    } else {
      return new SSEClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      } as any)
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @jdcagnet/core test -- mcp-manager
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/manager.ts packages/core/tests/mcp-manager.test.ts
git commit -m "feat(mcp): implement McpManager with server lifecycle"
```

---

### Task 3: MCP Tool Handler & Resource Tools

**Files:**
- Create: `packages/core/src/mcp/mcp-tool-handler.ts`
- Create: `packages/core/src/tools/list-mcp-resources.ts`
- Create: `packages/core/src/tools/read-mcp-resource.ts`
- Test: `packages/core/tests/mcp-tools.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/tests/mcp-tools.test.ts
import { describe, it, expect } from 'vitest'
import { createMcpToolHandler } from '../src/mcp/mcp-tool-handler.js'
import { createListMcpResourcesTool } from '../src/tools/list-mcp-resources.js'
import { createReadMcpResourceTool } from '../src/tools/read-mcp-resource.js'

describe('createMcpToolHandler', () => {
  it('creates a ToolHandler with mcp__ prefixed name', () => {
    const mockManager = { callTool: async () => ({ content: 'ok' }) } as any
    const handler = createMcpToolHandler('server1', {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
    }, mockManager)
    expect(handler.definition.name).toBe('mcp__server1__read_file')
    expect(handler.definition.description).toContain('Read a file')
  })

  it('execute calls mcpManager.callTool', async () => {
    const mockManager = { callTool: async (name: string, args: any) => ({ content: `called ${name}` }) } as any
    const handler = createMcpToolHandler('srv', { name: 'tool1', description: 'desc' }, mockManager)
    const result = await handler.execute({ foo: 'bar' }, { cwd: '/tmp' })
    expect(result.content).toBe('called mcp__srv__tool1')
  })
})

describe('listMcpResources tool', () => {
  it('has correct definition', () => {
    const mockManager = { listResources: async () => [] } as any
    const tool = createListMcpResourcesTool(mockManager)
    expect(tool.definition.name).toBe('list_mcp_resources')
  })
})

describe('readMcpResource tool', () => {
  it('has correct definition', () => {
    const mockManager = { readResource: async () => ({ content: '' }) } as any
    const tool = createReadMcpResourceTool(mockManager)
    expect(tool.definition.name).toBe('read_mcp_resource')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @jdcagnet/core test -- mcp-tools
```

- [ ] **Step 3: Implement MCP tool handler factory**

```typescript
// packages/core/src/mcp/mcp-tool-handler.ts
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { McpToolInfo } from './types.js'
import type { McpManager } from './manager.js'

export function createMcpToolHandler(
  serverName: string,
  tool: McpToolInfo,
  manager: McpManager
): ToolHandler {
  const fullName = `mcp__${serverName}__${tool.name}`
  return {
    definition: {
      name: fullName,
      description: `[MCP: ${serverName}] ${tool.description || tool.name}`,
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const result = await manager.callTool(fullName, input)
      return { content: result.content, isError: result.isError }
    },
  }
}
```

- [ ] **Step 4: Implement list_mcp_resources tool**

```typescript
// packages/core/src/tools/list-mcp-resources.ts
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { McpManager } from '../mcp/manager.js'

export function createListMcpResourcesTool(manager: McpManager): ToolHandler {
  return {
    definition: {
      name: 'list_mcp_resources',
      description: 'List available resources from connected MCP servers. Optionally filter by server name.',
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Optional server name to filter by' },
        },
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const serverName = input.server as string | undefined
      const resources = await manager.listResources(serverName)
      return { content: JSON.stringify(resources, null, 2) }
    },
  }
}
```

- [ ] **Step 5: Implement read_mcp_resource tool**

```typescript
// packages/core/src/tools/read-mcp-resource.ts
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { McpManager } from '../mcp/manager.js'

export function createReadMcpResourceTool(manager: McpManager): ToolHandler {
  return {
    definition: {
      name: 'read_mcp_resource',
      description: 'Read a specific resource from an MCP server by URI.',
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'The MCP server name' },
          uri: { type: 'string', description: 'The resource URI to read' },
        },
        required: ['server', 'uri'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const server = input.server as string
      const uri = input.uri as string
      if (!server || !uri) {
        return { content: 'Both server and uri are required', isError: true }
      }
      try {
        const result = await manager.readResource(server, uri)
        return { content: result.content }
      } catch (err: any) {
        return { content: err.message, isError: true }
      }
    },
  }
}
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @jdcagnet/core test -- mcp-tools
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/mcp/mcp-tool-handler.ts packages/core/src/tools/list-mcp-resources.ts packages/core/src/tools/read-mcp-resource.ts packages/core/tests/mcp-tools.test.ts
git commit -m "feat(mcp): add MCP tool handler factory and resource tools"
```

---

### Task 4: MCP Index & Core Exports

**Files:**
- Create: `packages/core/src/mcp/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create MCP module index**

```typescript
// packages/core/src/mcp/index.ts
export * from './types.js'
export { loadMcpConfig, saveMcpConfig, mergeConfigs } from './config.js'
export { McpManager } from './manager.js'
export { createMcpToolHandler } from './mcp-tool-handler.js'
```

- [ ] **Step 2: Add MCP exports to core index**

Add to `packages/core/src/index.ts`:

```typescript
export { McpManager, loadMcpConfig, saveMcpConfig, createMcpToolHandler } from './mcp/index.js'
export type { McpServerConfig, McpServerState, McpToolInfo, McpConnectionStatus, McpConfigFile } from './mcp/index.js'
export { createListMcpResourcesTool } from './tools/list-mcp-resources.js'
export { createReadMcpResourceTool } from './tools/read-mcp-resource.js'
```

- [ ] **Step 3: Verify build**

```bash
pnpm --filter @jdcagnet/core build
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/mcp/index.ts packages/core/src/index.ts
git commit -m "feat(mcp): export MCP module from core package"
```

---

### Task 5: Session Integration — Register MCP Tools

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/context.ts`
- Test: `packages/core/tests/mcp-session.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/tests/mcp-session.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Session } from '../src/session.js'
import type { McpManager } from '../src/mcp/manager.js'

describe('Session with MCP', () => {
  it('registers MCP tools when mcpManager provided', () => {
    const mockManager = {
      getTools: () => [
        { name: 'mcp__test__hello', description: 'Hello tool', inputSchema: { type: 'object' } }
      ],
      callTool: vi.fn(async () => ({ content: 'ok' })),
      getServerStates: () => [],
    } as unknown as McpManager

    const mockProvider = { chat: vi.fn(), stream: vi.fn() } as any
    const mockHistory = {
      getMessages: () => [],
      addMessage: vi.fn(),
      createSession: vi.fn(),
    } as any

    const session = new Session(
      { id: 'test', projectName: 'test', cwd: '/tmp', modelConfig: { model: 'test', maxTokens: 4096 } },
      mockProvider,
      mockHistory,
      undefined,
      mockManager
    )

    // The session should have the MCP tool registered
    // We can verify by checking tool definitions include mcp__test__hello
    const defs = (session as any).toolRegistry.getDefinitions()
    expect(defs.some((d: any) => d.name === 'mcp__test__hello')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @jdcagnet/core test -- mcp-session
```

- [ ] **Step 3: Modify Session to accept McpManager**

In `packages/core/src/session.ts`, update the constructor to accept an optional `McpManager` and register MCP tools:

```typescript
// Add import at top:
import { McpManager } from './mcp/manager.js'
import { createMcpToolHandler } from './mcp/mcp-tool-handler.js'
import { createListMcpResourcesTool } from './tools/list-mcp-resources.js'
import { createReadMcpResourceTool } from './tools/read-mcp-resource.js'

// Update constructor signature:
constructor(
  config: SessionConfig,
  provider: ModelProvider,
  history: ConversationHistory,
  onPermissionRequest?: PermissionCallback,
  mcpManager?: McpManager
) {
  // ... existing code ...

  // After registering built-in tools, register MCP tools:
  if (mcpManager) {
    const mcpTools = mcpManager.getTools()
    for (const tool of mcpTools) {
      this.toolRegistry.register(createMcpToolHandler(
        tool.name.split('__')[1], // extract server name
        { name: tool.name.split('__').slice(2).join('__'), description: tool.description, inputSchema: tool.inputSchema },
        mcpManager
      ))
    }
    this.toolRegistry.register(createListMcpResourcesTool(mcpManager))
    this.toolRegistry.register(createReadMcpResourceTool(mcpManager))
  }
}
```

- [ ] **Step 4: Update context.ts to include MCP server info in system prompt**

In `assembleSystemPrompt`, add MCP server info section when MCP tools are present:

```typescript
// Add to ContextOptions:
export interface ContextOptions {
  cwd: string
  toolNames: string[]
  mcpServers?: { name: string; toolCount: number }[]
}

// In assembleSystemPrompt, after git status section:
if (opts.mcpServers && opts.mcpServers.length > 0) {
  const mcpInfo = opts.mcpServers.map(s => `- ${s.name}: ${s.toolCount} tools`).join('\n')
  parts.push(`# MCP Servers\n${mcpInfo}`)
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @jdcagnet/core test -- mcp-session
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/context.ts packages/core/tests/mcp-session.test.ts
git commit -m "feat(mcp): integrate MCP tools into Session"
```

---

### Task 6: Electron MCP Integration

**Files:**
- Create: `packages/electron/src/mcp-ipc.ts`
- Modify: `packages/electron/src/session-manager.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`
- Modify: `packages/electron/src/ipc-channels.ts`
- Modify: `packages/electron/src/preload.ts`

- [ ] **Step 1: Add MCP IPC channels**

Add to `packages/electron/src/ipc-channels.ts`:

```typescript
export const IPC_CHANNELS = {
  // ... existing channels ...
  MCP_LIST_SERVERS: 'mcp:list-servers',
  MCP_RECONNECT: 'mcp:reconnect',
  MCP_TOGGLE: 'mcp:toggle',
  MCP_SAVE_CONFIG: 'mcp:save-config',
} as const
```

- [ ] **Step 2: Create MCP IPC handlers**

```typescript
// packages/electron/src/mcp-ipc.ts
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from './ipc-channels.js'
import type { SessionManager } from './session-manager.js'

export function registerMcpIpcHandlers(sessionManager: SessionManager): void {
  ipcMain.handle(IPC_CHANNELS.MCP_LIST_SERVERS, async () => {
    return sessionManager.getMcpServerStates()
  })

  ipcMain.handle(IPC_CHANNELS.MCP_RECONNECT, async (_event, { serverName }) => {
    await sessionManager.reconnectMcpServer(serverName)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_TOGGLE, async (_event, { serverName, enabled }) => {
    await sessionManager.toggleMcpServer(serverName, enabled)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_SAVE_CONFIG, async (_event, { servers, scope, cwd }) => {
    sessionManager.saveMcpServers(servers, scope, cwd)
    return { success: true }
  })
}
```

- [ ] **Step 3: Update SessionManager to own McpManager**

In `packages/electron/src/session-manager.ts`:

```typescript
// Add imports:
import { McpManager, loadMcpConfig, saveMcpConfig, type McpServerConfig, type McpServerState } from '@jdcagnet/core'

// Add to class:
private mcpManager: McpManager

// In constructor:
this.mcpManager = new McpManager(() => {
  this.window?.webContents.send('mcp:state-changed', this.mcpManager.getServerStates())
})

// Add method to initialize MCP on app start:
async initMcp(cwd: string): Promise<void> {
  const configs = loadMcpConfig(cwd)
  await this.mcpManager.loadConfig(configs)
}

// Update activateSession to pass mcpManager to Session:
// In the Session constructor call, add mcpManager as 5th argument

// Add MCP management methods:
getMcpServerStates(): McpServerState[] {
  return this.mcpManager.getServerStates()
}

async reconnectMcpServer(name: string): Promise<void> {
  await this.mcpManager.reconnectServer(name)
}

async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
  // Toggle disabled flag and reconnect/disconnect
  if (enabled) {
    await this.mcpManager.reconnectServer(name)
  } else {
    await this.mcpManager.disconnectServer(name)
  }
}

saveMcpServers(servers: Record<string, McpServerConfig>, scope: 'global' | 'project', cwd?: string): void {
  saveMcpConfig(servers, scope, cwd)
}

// Update close():
async close(): Promise<void> {
  await this.mcpManager.close()
  this.history.close()
}
```

- [ ] **Step 4: Update preload to expose MCP APIs**

Add to `packages/electron/src/preload.ts` electronAPI:

```typescript
mcpListServers: () => ipcRenderer.invoke('mcp:list-servers'),
mcpReconnect: (serverName: string) => ipcRenderer.invoke('mcp:reconnect', { serverName }),
mcpToggle: (serverName: string, enabled: boolean) => ipcRenderer.invoke('mcp:toggle', { serverName, enabled }),
mcpSaveConfig: (servers: any, scope: string, cwd?: string) => ipcRenderer.invoke('mcp:save-config', { servers, scope, cwd }),
onMcpStateChanged: (callback: (states: any[]) => void) => {
  ipcRenderer.on('mcp:state-changed', (_event, states) => callback(states))
},
```

- [ ] **Step 5: Register MCP IPC handlers in main.ts**

In `packages/electron/src/main.ts`, add:

```typescript
import { registerMcpIpcHandlers } from './mcp-ipc.js'
// After registerIpcHandlers:
registerMcpIpcHandlers(sessionManager)
```

- [ ] **Step 6: Build and verify**

```bash
pnpm --filter @jdcagnet/electron build
```

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/electron/src/mcp-ipc.ts packages/electron/src/session-manager.ts packages/electron/src/ipc-handlers.ts packages/electron/src/ipc-channels.ts packages/electron/src/preload.ts packages/electron/src/main.ts
git commit -m "feat(mcp): add Electron MCP IPC layer and SessionManager integration"
```

---

### Task 7: UI — MCP Settings Panel

**Files:**
- Create: `packages/ui/src/components/McpSettings.tsx`
- Modify: `packages/ui/src/components/Settings.tsx` (or equivalent settings component)

- [ ] **Step 1: Create McpSettings component**

```tsx
// packages/ui/src/components/McpSettings.tsx
import { useState, useEffect } from 'react'

interface McpServerState {
  name: string
  config: { transport: string; command?: string; url?: string; disabled?: boolean }
  status: 'connected' | 'connecting' | 'failed' | 'disconnected' | 'disabled'
  error?: string
  tools: { name: string; description?: string }[]
}

export function McpSettings() {
  const [servers, setServers] = useState<McpServerState[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.mcpListServers().then(setServers)
    window.electronAPI.onMcpStateChanged(setServers)
  }, [])

  const statusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'text-green-400'
      case 'connecting': return 'text-yellow-400'
      case 'failed': return 'text-red-400'
      case 'disabled': return 'text-neutral-500'
      default: return 'text-neutral-400'
    }
  }

  return (
    <div className="font-mono text-xs">
      <div className="border border-neutral-700 p-3 mb-4">
        <div className="text-neutral-400 uppercase tracking-wider mb-2">MCP SERVERS</div>
        {servers.length === 0 && (
          <div className="text-neutral-500">No MCP servers configured. Add servers to ~/.jdcagnet/mcp-servers.json</div>
        )}
        {servers.map(server => (
          <div key={server.name} className="border border-neutral-800 mb-2">
            <div
              className="flex items-center justify-between p-2 cursor-pointer hover:bg-neutral-800/50"
              onClick={() => setExpanded(expanded === server.name ? null : server.name)}
            >
              <div className="flex items-center gap-2">
                <span className={statusColor(server.status)}>●</span>
                <span className="text-neutral-200 uppercase">{server.name}</span>
                <span className="text-neutral-500">[{server.config.transport}]</span>
                <span className="text-neutral-600">{server.tools.length} tools</span>
              </div>
              <div className="flex items-center gap-2">
                {server.status === 'failed' && (
                  <button
                    className="text-yellow-400 hover:text-yellow-300 uppercase text-[10px]"
                    onClick={(e) => { e.stopPropagation(); window.electronAPI.mcpReconnect(server.name) }}
                  >
                    [RECONNECT]
                  </button>
                )}
                <span className="text-neutral-600">{expanded === server.name ? '▼' : '▶'}</span>
              </div>
            </div>
            {expanded === server.name && (
              <div className="border-t border-neutral-800 p-2">
                {server.error && (
                  <div className="text-red-400 mb-2">ERROR: {server.error}</div>
                )}
                <div className="text-neutral-500 mb-1">TOOLS:</div>
                {server.tools.map(tool => (
                  <div key={tool.name} className="pl-2 text-neutral-400">
                    • {tool.name} {tool.description && <span className="text-neutral-600">— {tool.description}</span>}
                  </div>
                ))}
                {server.tools.length === 0 && <div className="pl-2 text-neutral-600">No tools available</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Integrate into settings panel**

Add `<McpSettings />` as a new section in the existing settings component.

- [ ] **Step 3: Add type declarations for electronAPI MCP methods**

Update the window.electronAPI type declaration to include MCP methods.

- [ ] **Step 4: Build and verify UI renders**

```bash
pnpm --filter @jdcagnet/ui build
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/McpSettings.tsx packages/ui/src/
git commit -m "feat(mcp): add MCP settings panel UI"
```

---

### Task 8: End-to-End Integration & Testing

**Files:**
- Modify: `packages/electron/src/main.ts` (init MCP on app ready)
- Test: Manual verification with a real MCP server

- [ ] **Step 1: Initialize MCP on app start**

In `packages/electron/src/main.ts`, after window creation:

```typescript
// Initialize MCP with default cwd (home directory initially)
sessionManager.initMcp(process.env.HOME || '/')
```

- [ ] **Step 2: Verify full build**

```bash
cd /Users/chenmingxu/Documents/jdcagnet && pnpm build
```

- [ ] **Step 3: Test with filesystem MCP server**

Create test config at `~/.jdcagnet/mcp-servers.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
```

- [ ] **Step 4: Run app and verify**

```bash
pnpm --filter @jdcagnet/electron dev
```

Verify:
- MCP server connects (check console logs)
- MCP tools appear in tool list
- Settings panel shows server status
- Model can use MCP tools in conversation

- [ ] **Step 5: Commit final integration**

```bash
git add -A
git commit -m "feat(mcp): complete Phase 2B MCP integration"
```
