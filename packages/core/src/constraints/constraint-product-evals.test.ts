import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PermissionChecker } from '../permissions.js'
import { ToolRegistry } from '../tool-registry.js'
import { ToolRunner } from '../tool-runner.js'
import { fileEditTool } from '../tools/file-edit.js'
import { fileReadTool } from '../tools/file-read.js'
import { buildConstraintObservabilitySnapshot } from './observability.js'

describe('JDC Agent Constraint Engine Phase 3 product evals', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdc-constraint-phase3-eval')
  const targetPath = path.join(tmpDir, 'target.ts')

  beforeEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })
    await writeFile(targetPath, 'export const value = 1\n', 'utf-8')
  })

  it('blocks unread mutation, records policy event, then records pending verification after read and edit', async () => {
    const registry = new ToolRegistry()
    registry.register(fileReadTool)
    registry.register(fileEditTool)
    const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))

    const blocked = await runner.execute('Edit', 'edit_blocked', {
      file_path: targetPath,
      old_string: 'export const value = 1\n',
      new_string: 'export const value = 2\n',
    }, () => {})

    expect(blocked.isError).toBe(true)
    expect(blocked.content).toContain('Blocked by JDC Agent Constraint Engine')
    expect(await readFile(targetPath, 'utf-8')).toBe('export const value = 1\n')
    expect(runner.constraintRuntime.policyEvents.list()).toEqual([
      expect.objectContaining({
        phase: 'pre_tool_use',
        decision: 'block',
        toolUseId: 'edit_blocked',
      }),
    ])

    await runner.execute('Read', 'read_1', { file_path: targetPath }, () => {})
    const edit = await runner.execute('Edit', 'edit_allowed', {
      file_path: targetPath,
      old_string: 'export const value = 1\n',
      new_string: 'export const value = 2\n',
    }, () => {})

    expect(edit.isError).not.toBe(true)
    expect(runner.constraintRuntime.verificationLedger.getChangedFiles()).toEqual([
      expect.objectContaining({
        filePath: targetPath,
        status: 'pending',
        changedByToolUseId: 'edit_allowed',
      }),
    ])
  })

  it('exposes non-operator observability for blocked actions and pending verification', async () => {
    const registry = new ToolRegistry()
    registry.register(fileReadTool)
    registry.register(fileEditTool)
    const runner = new ToolRunner(registry, tmpDir, new PermissionChecker('relaxed'))

    await runner.execute('Edit', 'edit_blocked', {
      file_path: targetPath,
      old_string: 'export const value = 1\n',
      new_string: 'export const value = 2\n',
    }, () => {})

    const blockedSnapshot = buildConstraintObservabilitySnapshot({
      runtime: runner.constraintRuntime,
      cwd: tmpDir,
      inspectedAt: 1_700_000_000_000,
    })

    expect(blockedSnapshot.status).toBe('blocked')
    expect(blockedSnapshot.summary.primary).toBe('有操作被约束拦截')
    expect(blockedSnapshot.blockedActions[0]).toMatchObject({ toolName: 'Edit', toolUseId: 'edit_blocked' })

    await runner.execute('Read', 'read_1', { file_path: targetPath }, () => {})
    await runner.execute('Edit', 'edit_allowed', {
      file_path: targetPath,
      old_string: 'export const value = 1\n',
      new_string: 'export const value = 2\n',
    }, () => {})

    const pendingSnapshot = buildConstraintObservabilitySnapshot({
      runtime: runner.constraintRuntime,
      cwd: tmpDir,
      inspectedAt: 1_700_000_000_500,
    })

    expect(pendingSnapshot.status).toBe('needs_verification')
    expect(pendingSnapshot.verification.status).toBe('pending')
    expect(pendingSnapshot.verification.changedFiles).toEqual([
      expect.objectContaining({ filePath: targetPath, status: 'pending', changedByToolUseId: 'edit_allowed' }),
    ])
  })
})
