import { describe, it, expect } from 'vitest'
import { ToolRunner } from '../tool-runner.js'
import { ToolRegistry } from '../tool-registry.js'
import { PermissionChecker } from '../permissions.js'

function makeRunner(cwd: string) {
  const registry = new ToolRegistry()
  const captured: Record<string, unknown>[] = []
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

describe('ToolRunner — input passthrough', () => {
  it('passes tool input through unchanged (no implicit injection)', async () => {
    const cwd = '/tmp/proj-A'
    const { runner, captured } = makeRunner(cwd)
    await runner.execute('mcp__other__thing', 'tu1', { x: 1 }, () => {})
    expect(captured[0]).toEqual({ x: 1 })
  })
})
