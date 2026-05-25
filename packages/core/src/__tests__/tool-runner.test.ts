import { describe, it, expect } from 'vitest'
import { ToolRunner } from '../tool-runner.js'
import { ToolRegistry } from '../tool-registry.js'
import { PermissionChecker } from '../permissions.js'

function makeRunner(cwd: string) {
  const registry = new ToolRegistry()
  const captured: Record<string, unknown>[] = []
  registry.register({
    definition: {
      name: 'mcp__codegraph__codegraph_search',
      description: '',
      inputSchema: { type: 'object', properties: {} },
    },
    async execute(input) {
      captured.push(input)
      return { content: 'ok' }
    },
  })
  registry.register({
    definition: {
      name: 'mcp__other__thing',
      description: '',
      inputSchema: { type: 'object', properties: {} },
    },
    async execute(input) {
      captured.push(input)
      return { content: 'ok' }
    },
  })
  const runner = new ToolRunner(registry, cwd, new PermissionChecker('relaxed'))
  return { runner, captured }
}

describe('ToolRunner — codegraph projectPath auto-injection', () => {
  it('injects projectPath when missing', async () => {
    const cwd = '/tmp/proj-A'
    const { runner, captured } = makeRunner(cwd)
    await runner.execute('mcp__codegraph__codegraph_search', 'tu1', { query: 'foo' }, () => {})
    expect(captured[0]).toEqual({ query: 'foo', projectPath: cwd })
  })

  it('keeps explicit projectPath when caller provides it', async () => {
    const cwd = '/tmp/proj-A'
    const { runner, captured } = makeRunner(cwd)
    await runner.execute('mcp__codegraph__codegraph_search', 'tu1', { query: 'foo', projectPath: '/other' }, () => {})
    expect(captured[0]).toEqual({ query: 'foo', projectPath: '/other' })
  })

  it('does not inject for non-codegraph MCP tools', async () => {
    const cwd = '/tmp/proj-A'
    const { runner, captured } = makeRunner(cwd)
    await runner.execute('mcp__other__thing', 'tu1', { x: 1 }, () => {})
    expect(captured[0]).toEqual({ x: 1 })
  })
})
