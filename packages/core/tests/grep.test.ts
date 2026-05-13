import { describe, it, expect } from 'vitest'
import { grepTool } from '../src/tools/grep.js'
import path from 'node:path'

describe('grepTool', () => {
  it('has correct definition', () => {
    expect(grepTool.definition.name).toBe('grep')
    expect(grepTool.definition.inputSchema.properties).toHaveProperty('pattern')
  })

  it('finds content matching regex', async () => {
    const result = await grepTool.execute(
      { pattern: 'ModelProvider', path: 'src/model-provider.ts' },
      { cwd: path.resolve(__dirname, '..') }
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('ModelProvider')
  })

  it('searches directory recursively', async () => {
    const result = await grepTool.execute(
      { pattern: 'ToolHandler' },
      { cwd: path.resolve(__dirname, '../src') }
    )
    expect(result.content).toContain('tool-registry.ts')
  })

  it('returns no matches message', async () => {
    const result = await grepTool.execute(
      { pattern: 'xyznonexistentpattern123' },
      { cwd: path.resolve(__dirname, '../src') }
    )
    expect(result.content).toContain('No matches')
  })

  it('returns error for empty pattern', async () => {
    const result = await grepTool.execute(
      { pattern: '' },
      { cwd: '/tmp' }
    )
    expect(result.isError).toBe(true)
  })
})
