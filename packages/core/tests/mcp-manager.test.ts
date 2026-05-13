import { describe, it, expect } from 'vitest'
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

  it('callTool returns error for invalid tool name', async () => {
    const manager = new McpManager()
    const result = await manager.callTool('invalid_name', {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Invalid MCP tool name')
  })

  it('callTool returns error for disconnected server', async () => {
    const manager = new McpManager()
    const result = await manager.callTool('mcp__nonexistent__tool', {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('not connected')
  })

  it('reports failed status when connection fails', async () => {
    const manager = new McpManager()
    await manager.connectServer('bad', { transport: 'stdio', command: 'nonexistent-command-xyz', args: [] })
    const states = manager.getServerStates()
    expect(states[0].status).toBe('failed')
    expect(states[0].error).toBeDefined()
  })
})
