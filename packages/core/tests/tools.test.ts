import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../src/tool-registry.js'
import { ToolRunner } from '../src/tool-runner.js'
import { PermissionChecker } from '../src/permissions.js'
import { registerBuiltinTools } from '../src/tools/index.js'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

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
  })

  it('file_write + file_read: round trip', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'test.txt')
    await runner.execute('Write', 'id-2', { file_path: testFile, content: 'line1\nline2\nline3' }, () => {})
    const result = await runner.execute('Read', 'id-3', { file_path: testFile }, () => {})
    expect(result.content).toContain('line1')
    expect(result.content).toContain('1\t')
  })

  it('file_edit: should replace string', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'edit.txt')
    await writeFile(testFile, 'hello world', 'utf-8')
    const result = await runner.execute('Edit', 'id-4', { file_path: testFile, old_string: 'hello', new_string: 'goodbye' }, () => {})
    expect(result.content).toContain('Successfully')
  })

  it('file_edit: should error on non-unique string', async () => {
    const runner = await setup()
    const testFile = path.join(tmpDir, 'dup.txt')
    await writeFile(testFile, 'aaa bbb aaa', 'utf-8')
    const result = await runner.execute('Edit', 'id-5', { file_path: testFile, old_string: 'aaa', new_string: 'ccc' }, () => {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('2 times')
  })
})
