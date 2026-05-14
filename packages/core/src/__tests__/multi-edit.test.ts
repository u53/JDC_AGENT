import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { multiEditTool } from '../tools/multi-edit.js'

describe('multi_edit tool', () => {
  const tmpDir = path.join(os.tmpdir(), 'multi-edit-test')
  const testFile = path.join(tmpDir, 'test.ts')

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(testFile, 'const a = 1\nconst b = 2\nconst c = 3\n')
  })

  afterEach(async () => {
    try { await unlink(testFile) } catch {}
  })

  it('applies multiple edits in order', async () => {
    const result = await multiEditTool.execute({
      file_path: testFile,
      edits: [
        { old_string: 'const a = 1', new_string: 'const a = 10' },
        { old_string: 'const b = 2', new_string: 'const b = 20' },
      ],
    }, { cwd: tmpDir })
    expect(result.isError).toBeFalsy()
    const content = await readFile(testFile, 'utf-8')
    expect(content).toContain('const a = 10')
    expect(content).toContain('const b = 20')
    expect(content).toContain('const c = 3')
  })

  it('fails if old_string not found (no partial apply)', async () => {
    const result = await multiEditTool.execute({
      file_path: testFile,
      edits: [
        { old_string: 'const a = 1', new_string: 'const a = 10' },
        { old_string: 'NONEXISTENT', new_string: 'whatever' },
      ],
    }, { cwd: tmpDir })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('edit 2')
  })

  it('fails if old_string is not unique', async () => {
    await writeFile(testFile, 'aaa\naaa\nbbb\n')
    const result = await multiEditTool.execute({
      file_path: testFile,
      edits: [{ old_string: 'aaa', new_string: 'ccc' }],
    }, { cwd: tmpDir })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('appears 2 times')
  })
})
