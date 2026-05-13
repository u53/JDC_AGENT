import { describe, it, expect } from 'vitest'
import { lspTool } from '../src/tools/lsp.js'

describe('lspTool', () => {
  it('has correct definition', () => {
    expect(lspTool.definition.name).toBe('lsp')
    expect(lspTool.definition.inputSchema.properties).toHaveProperty('operation')
    expect(lspTool.definition.inputSchema.properties).toHaveProperty('filePath')
  })

  it('returns error when no server available', async () => {
    const result = await lspTool.execute(
      { operation: 'hover', filePath: '/tmp/test.unknown_ext', line: 1, character: 1 },
      { cwd: '/tmp' }
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('No language server')
  })
})
