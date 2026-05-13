import { describe, it, expect } from 'vitest'
import { lsTool } from '../src/tools/ls.js'
import { treeTool } from '../src/tools/tree.js'
import path from 'node:path'

describe('lsTool', () => {
  it('lists directory contents', async () => {
    const result = await lsTool.execute(
      { path: 'src' },
      { cwd: path.resolve(__dirname, '..') }
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('types.ts')
    expect(result.content).toContain('providers/')
  })

  it('returns error for nonexistent directory', async () => {
    const result = await lsTool.execute(
      { path: '/nonexistent_xyz_dir' },
      { cwd: '/tmp' }
    )
    expect(result.isError).toBe(true)
  })
})

describe('treeTool', () => {
  it('shows recursive directory structure', async () => {
    const result = await treeTool.execute(
      { path: 'src/providers' },
      { cwd: path.resolve(__dirname, '..') }
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('anthropic.ts')
  })

  it('respects depth limit', async () => {
    const result = await treeTool.execute(
      { path: 'src', depth: 1 },
      { cwd: path.resolve(__dirname, '..') }
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('providers/')
  })
})
