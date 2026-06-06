import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../src/tool-registry.js'
import { ToolRunner } from '../src/tool-runner.js'
import { PermissionChecker } from '../src/permissions.js'
import { registerBuiltinTools } from '../src/tools/index.js'
import { writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileReadTool } from '../src/tools/file-read.js'
import { fileWriteTool } from '../src/tools/file-write.js'

describe('Built-in Tools', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdcagnet-test-' + Date.now())

  const setup = async () => {
    await mkdir(tmpDir, { recursive: true })
    const registry = new ToolRegistry()
    registerBuiltinTools(registry)
    return new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))
  }

  it('bash: should execute a command', async () => {
    const runner = await setup()
    const result = await runner.execute('Bash', 'id-1', { command: 'echo hello' }, () => {})
    expect(result.content.trim()).toContain('hello')
  }, 15000)

  it('file_write + file_read: round trip', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'test.txt')
    await runner.execute('Write', 'id-2', { file_path: testFile, content: 'line1\nline2\nline3' }, () => {})
    const result = await runner.execute('Read', 'id-3', { file_path: testFile }, () => {})
    expect(result.content).toContain('line1')
    expect(result.content).toContain('1\t')
  })

  it('file_read: returns structured metadata for policy post-processing', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'jdc-read-metadata-'))
    const file = path.join(tmp, 'sample.ts')
    await writeFile(file, 'const alpha = 1\nconst beta = 2\n', 'utf-8')

    const result = await fileReadTool.execute({ file_path: file }, { cwd: tmp })

    expect(result.isError).not.toBe(true)
    expect(result.metadata).toEqual({
      fileRead: {
        filePath: file,
        offset: 0,
        limit: 2000,
        totalLines: 3,
        content: 'const alpha = 1\nconst beta = 2\n',
      },
    })
  })

  it('file_write: returns structured mutation metadata', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'jdc-write-metadata-'))
    const file = path.join(tmp, 'created.ts')

    const result = await fileWriteTool.execute({ file_path: file, content: 'export const value = 1\n' }, { cwd: tmp })

    expect(result.isError).not.toBe(true)
    expect(result.metadata).toEqual({
      mutations: [{ filePath: file, kind: 'write' }],
    })
  })

  it('file_read: reports how to continue when the requested range is partial', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'partial.txt')
    await writeFile(testFile, 'one\ntwo\nthree\nfour', 'utf-8')
    const result = await runner.execute('Read', 'id-partial', { file_path: testFile, limit: 2 }, () => {})

    expect(result.content).toContain('1\tone')
    expect(result.content).toContain('2\ttwo')
    expect(result.content).toContain('[Showing lines 1-2 of 4. Use offset=2 to continue.]')
  })

  it('file_edit: should replace string', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'edit.txt')
    await writeFile(testFile, 'hello world', 'utf-8')
    await runner.execute('Read', 'id-4-read', { file_path: testFile }, () => {})
    const result = await runner.execute('Edit', 'id-4', { file_path: testFile, old_string: 'hello', new_string: 'goodbye' }, () => {})
    expect(result.content).toContain('Successfully')
  })

  it('file_edit: should error on non-unique string', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'dup.txt')
    await writeFile(testFile, 'aaa bbb aaa', 'utf-8')
    await runner.execute('Read', 'id-5-read', { file_path: testFile }, () => {})
    const result = await runner.execute('Edit', 'id-5', { file_path: testFile, old_string: 'aaa', new_string: 'ccc' }, () => {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('2 times')
  })
})
