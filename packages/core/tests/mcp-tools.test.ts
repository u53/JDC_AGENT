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

  it('execute calls mcpManager.callTool with full name', async () => {
    const mockManager = { callTool: async (name: string, _args: any) => ({ content: `called ${name}` }) } as any
    const handler = createMcpToolHandler('srv', { name: 'tool1', description: 'desc' }, mockManager)
    const result = await handler.execute({ foo: 'bar' }, { cwd: '/tmp' })
    expect(result.content).toBe('called mcp__srv__tool1')
  })

  it('passes isError through from manager', async () => {
    const mockManager = { callTool: async () => ({ content: 'err', isError: true }) } as any
    const handler = createMcpToolHandler('s', { name: 't' }, mockManager)
    const result = await handler.execute({}, { cwd: '/tmp' })
    expect(result.isError).toBe(true)
  })
})

describe('createListMcpResourcesTool', () => {
  it('has correct definition', () => {
    const mockManager = { listResources: async () => [] } as any
    const tool = createListMcpResourcesTool(mockManager)
    expect(tool.definition.name).toBe('list_mcp_resources')
  })

  it('returns JSON array of resources', async () => {
    const mockManager = {
      listResources: async () => [{ uri: 'file:///a', name: 'a', server: 'fs' }]
    } as any
    const tool = createListMcpResourcesTool(mockManager)
    const result = await tool.execute({}, { cwd: '/tmp' })
    const parsed = JSON.parse(result.content)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].uri).toBe('file:///a')
  })

  it('passes server filter', async () => {
    let passedServer: string | undefined
    const mockManager = {
      listResources: async (s?: string) => { passedServer = s; return [] }
    } as any
    const tool = createListMcpResourcesTool(mockManager)
    await tool.execute({ server: 'myserver' }, { cwd: '/tmp' })
    expect(passedServer).toBe('myserver')
  })
})

describe('createReadMcpResourceTool', () => {
  it('has correct definition', () => {
    const mockManager = { readResource: async () => ({ content: '' }) } as any
    const tool = createReadMcpResourceTool(mockManager)
    expect(tool.definition.name).toBe('read_mcp_resource')
  })

  it('returns resource content', async () => {
    const mockManager = { readResource: async () => ({ content: 'hello world' }) } as any
    const tool = createReadMcpResourceTool(mockManager)
    const result = await tool.execute({ server: 'fs', uri: 'file:///a' }, { cwd: '/tmp' })
    expect(result.content).toBe('hello world')
  })

  it('returns error when server/uri missing', async () => {
    const mockManager = { readResource: async () => ({ content: '' }) } as any
    const tool = createReadMcpResourceTool(mockManager)
    const result = await tool.execute({}, { cwd: '/tmp' })
    expect(result.isError).toBe(true)
  })

  it('returns error on exception', async () => {
    const mockManager = { readResource: async () => { throw new Error('not connected') } } as any
    const tool = createReadMcpResourceTool(mockManager)
    const result = await tool.execute({ server: 'x', uri: 'y' }, { cwd: '/tmp' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('not connected')
  })
})
