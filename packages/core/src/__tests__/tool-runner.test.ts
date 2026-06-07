import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { HookEngine } from '../hooks/engine.js'
import { FileReadStateCache } from '../file-read-state.js'
import { PermissionChecker } from '../permissions.js'
import { fileEditTool } from '../tools/file-edit.js'
import { fileReadTool } from '../tools/file-read.js'
import { fileWriteTool } from '../tools/file-write.js'
import { multiEditTool } from '../tools/multi-edit.js'
import { ToolRegistry } from '../tool-registry.js'
import { ToolRunner } from '../tool-runner.js'

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

describe('ToolRunner file mutation constraints', () => {
  const tmpDir = path.join(tmpdir(), 'jdc-tool-runner-constraints-test')
  const targetPath = path.join(tmpDir, 'target.ts')

  beforeEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })
    await writeFile(targetPath, 'const value = 1\n', 'utf-8')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  function makeConstraintRunner() {
    const registry = new ToolRegistry()
    registry.register(fileReadTool)
    registry.register(fileEditTool)
    registry.register(fileWriteTool)
    registry.register(multiEditTool)

    const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))
    runner.fileReadState = new FileReadStateCache()
    return runner
  }

  it('runs product pre gate before project hooks', async () => {
    const registry = new ToolRegistry()
    registry.register(fileEditTool)
    const hookEngine = {
      runPreToolUse: vi.fn(async () => ({})),
      runPostToolUse: vi.fn(async () => ({})),
    }
    const runner = new ToolRunner(
      registry,
      tmpDir,
      new PermissionChecker('relaxed'),
      undefined,
      hookEngine as unknown as HookEngine
    )

    const result = await runner.execute(
      'Edit',
      'edit_1',
      { file_path: targetPath, old_string: 'const value = 1\n', new_string: 'const value = 2\n' },
      () => {}
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Blocked by JDC Agent Constraint Engine')
    expect(hookEngine.runPreToolUse).not.toHaveBeenCalled()
  })

  it('records file reads through the product post gate', async () => {
    const registry = new ToolRegistry()
    registry.register(fileReadTool)
    registry.register(fileEditTool)
    const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))

    const readResult = await runner.execute('Read', 'read_1', { file_path: targetPath }, () => {})
    expect(readResult.isError).not.toBe(true)

    const editResult = await runner.execute(
      'Edit',
      'edit_1',
      { file_path: targetPath, old_string: 'const value = 1\n', new_string: 'const value = 2\n' },
      () => {}
    )

    expect(editResult.isError).not.toBe(true)
    expect(runner.constraintRuntime.verificationLedger.getChangedFiles()).toEqual([
      expect.objectContaining({
        filePath: targetPath,
        status: 'pending',
        changedByToolUseId: 'edit_1',
      }),
    ])
  })

  it('records background shell verification completion in the product ledger', async () => {
    const registry = new ToolRegistry()
    const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))
    runner.constraintRuntime.postToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: targetPath },
      cwd: tmpDir,
      fileReadState: runner.fileReadState,
      result: {
        content: 'Successfully edited',
        metadata: { mutations: [{ filePath: targetPath, kind: 'edit' }] },
      },
    })

    runner.recordBackgroundShellCompletion({
      shell: 'bash',
      taskId: 'task_1',
      command: 'pnpm --filter @jdcagnet/core build',
      exitCode: 0,
      output: 'build ok',
    })

    expect(runner.constraintRuntime.verificationLedger.getChangedFiles()).toEqual([
      expect.objectContaining({
        filePath: targetPath,
        status: 'verified',
        changedByToolUseId: 'edit_1',
        verifiedByToolUseId: 'task_1',
      }),
    ])
  })

  it('blocks Edit by default when callers do not inject fresh-read state', async () => {
    const fs = await import('fs/promises')
    const targetFile = path.join(tmpDir, 'target.ts')
    await fs.writeFile(targetFile, 'const value = 1\n')
    const registry = new ToolRegistry()
    registry.register(fileEditTool)
    const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))

    const result = await runner.execute('Edit', 'tool_use_default_state', {
      file_path: targetFile,
      old_string: 'const value = 1',
      new_string: 'const value = 2',
    }, () => {})

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Blocked by JDC Agent Constraint Engine')
    await expect(fs.readFile(targetFile, 'utf-8')).resolves.toBe('const value = 1\n')
  })

  it('blocks Edit before file has been read', async () => {
    const runner = makeConstraintRunner()

    const result = await runner.execute(
      'Edit',
      'tu-edit-before-read',
      { file_path: 'target.ts', old_string: 'const value = 1\n', new_string: 'const value = 2\n' },
      () => {}
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Blocked by JDC Agent Constraint Engine')
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('const value = 1\n')
  })

  it('allows Edit after Read tool freshly reads file', async () => {
    const runner = makeConstraintRunner()

    const readResult = await runner.execute('Read', 'tu-read', { file_path: 'target.ts' }, () => {})
    expect(readResult.isError).not.toBe(true)

    const editResult = await runner.execute(
      'Edit',
      'tu-edit-after-read',
      { file_path: 'target.ts', old_string: 'const value = 1\n', new_string: 'const value = 2\n' },
      () => {}
    )

    expect(editResult.isError).not.toBe(true)
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('const value = 2\n')
  })

  it('blocks Write when overwriting existing unread file', async () => {
    const runner = makeConstraintRunner()

    const result = await runner.execute(
      'Write',
      'tu-write-unread',
      { file_path: 'target.ts', content: 'const value = 2\n' },
      () => {}
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Blocked by JDC Agent Constraint Engine')
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('const value = 1\n')
  })

  it('allows Edit after MultiEdit records a mutation snapshot without re-reading', async () => {
    const runner = makeConstraintRunner()

    const readResult = await runner.execute('Read', 'tu-read-before-multiedit', { file_path: 'target.ts' }, () => {})
    expect(readResult.isError).not.toBe(true)

    const multiEditResult = await runner.execute(
      'MultiEdit',
      'tu-multiedit',
      {
        file_path: 'target.ts',
        edits: [{ old_string: 'const value = 1\n', new_string: 'const value = 2\n' }],
      },
      () => {}
    )
    expect(multiEditResult.isError).not.toBe(true)

    const editResult = await runner.execute(
      'Edit',
      'tu-edit-after-multiedit-without-reread',
      { file_path: 'target.ts', old_string: 'const value = 2\n', new_string: 'const value = 3\n' },
      () => {}
    )

    expect(editResult.isError).not.toBe(true)
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('const value = 3\n')
  })
})
