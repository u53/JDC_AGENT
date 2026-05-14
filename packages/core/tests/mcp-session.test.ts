import { describe, it, expect, vi } from 'vitest'
import { Session } from '../src/session.js'
import type { McpManager } from '../src/mcp/manager.js'

describe('Session with MCP', () => {
  it('registers MCP tools when mcpManager provided', () => {
    const mockManager = {
      getTools: () => [
        { name: 'mcp__test__hello', description: 'Hello tool', inputSchema: { type: 'object', properties: {} } }
      ],
      callTool: vi.fn(async () => ({ content: 'ok' })),
      getServerStates: () => [{ name: 'test', status: 'connected', tools: [{ name: 'hello' }], config: { transport: 'stdio', command: 'x', args: [] } }],
      listResources: vi.fn(async () => []),
      readResource: vi.fn(async () => ({ content: '' })),
    } as unknown as McpManager

    const mockProvider = { chat: vi.fn(), stream: vi.fn() } as any
    const mockHistory = {
      getMessages: () => [],
      addMessage: vi.fn(),
      createSession: vi.fn(),
      getTasks: () => [],
      getActiveTasks: () => [],
    } as any

    const session = new Session(
      { id: 'test', projectName: 'test', cwd: '/tmp', modelConfig: { model: 'test', maxTokens: 4096 } },
      mockProvider,
      mockHistory,
      undefined,
      mockManager
    )

    const defs = (session as any).toolRegistry.getDefinitions()
    expect(defs.some((d: any) => d.name === 'mcp__test__hello')).toBe(true)
    expect(defs.some((d: any) => d.name === 'list_mcp_resources')).toBe(true)
    expect(defs.some((d: any) => d.name === 'read_mcp_resource')).toBe(true)
  })

  it('does not register MCP tools when no mcpManager', () => {
    const mockProvider = { chat: vi.fn(), stream: vi.fn() } as any
    const mockHistory = {
      getMessages: () => [],
      addMessage: vi.fn(),
      createSession: vi.fn(),
      getTasks: () => [],
      getActiveTasks: () => [],
    } as any

    const session = new Session(
      { id: 'test', projectName: 'test', cwd: '/tmp', modelConfig: { model: 'test', maxTokens: 4096 } },
      mockProvider,
      mockHistory
    )

    const defs = (session as any).toolRegistry.getDefinitions()
    expect(defs.some((d: any) => d.name === 'list_mcp_resources')).toBe(false)
  })
})
