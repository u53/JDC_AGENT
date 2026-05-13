import { describe, it, expect } from 'vitest'
import { globTool } from '../src/tools/glob.js'
import path from 'node:path'

describe('globTool', () => {
  it('has correct definition', () => {
    expect(globTool.definition.name).toBe('glob')
    expect(globTool.definition.inputSchema.properties).toHaveProperty('pattern')
  })

  it('finds files matching pattern', async () => {
    const result = await globTool.execute(
      { pattern: '*.ts' },
      { cwd: path.resolve(__dirname, '../src') }
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('types.ts')
  })

  it('respects path parameter', async () => {
    const result = await globTool.execute(
      { pattern: '*.ts', path: path.resolve(__dirname, '../src/providers') },
      { cwd: path.resolve(__dirname, '..') }
    )
    expect(result.content).toContain('anthropic.ts')
  })

  it('returns message for no matches', async () => {
    const result = await globTool.execute(
      { pattern: '*.xyz_nonexistent' },
      { cwd: path.resolve(__dirname, '../src') }
    )
    expect(result.content).toContain('No files found')
  })

  it('returns error for empty pattern', async () => {
    const result = await globTool.execute(
      { pattern: '' },
      { cwd: '/tmp' }
    )
    expect(result.isError).toBe(true)
  })
})
