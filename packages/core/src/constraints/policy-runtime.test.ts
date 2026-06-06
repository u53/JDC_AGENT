import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileReadStateCache } from '../file-read-state.js'
import { ConstraintPolicyRuntime } from './policy-runtime.js'

describe('ConstraintPolicyRuntime', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdc-policy-runtime-test')
  const filePath = path.join(tmpDir, 'target.ts')

  beforeEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })
    await writeFile(filePath, 'const value = 1\n', 'utf-8')
  })

  it('blocks unread edits in the product pre gate and records the event', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 10 })
    const fileReadState = new FileReadStateCache()

    const decision = runtime.preToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: filePath, old_string: 'const value = 1', new_string: 'const value = 2' },
      cwd: tmpDir,
      fileReadState,
    })

    expect(decision).toMatchObject({ decision: 'block' })
    expect(runtime.policyEvents.list()).toEqual([
      expect.objectContaining({
        phase: 'pre_tool_use',
        source: 'FileMutationPolicy',
        decision: 'block',
        toolName: 'Edit',
        toolUseId: 'edit_1',
      }),
    ])
  })

  it('records read metadata in the post gate', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 10 })
    const fileReadState = new FileReadStateCache()

    runtime.postToolUse({
      toolName: 'Read',
      toolUseId: 'read_1',
      input: { file_path: filePath },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'read ok',
        metadata: {
          fileRead: {
            filePath,
            offset: 0,
            limit: 2000,
            totalLines: 2,
            content: 'const value = 1\n',
          },
        },
      },
    })

    expect(fileReadState.checkFreshRead(filePath, { requiredText: 'const value = 1' }).ok).toBe(true)
    expect(runtime.policyEvents.list()[0]).toMatchObject({
      phase: 'post_tool_use',
      source: 'ToolResultMetadata',
      decision: 'record',
      toolName: 'Read',
    })
  })

  it('records successful mutations as pending verification', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 10 })
    const fileReadState = new FileReadStateCache()
    fileReadState.recordRead(filePath, 0, 2000, 2, 'const value = 1\n')

    runtime.postToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: filePath },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'Successfully edited',
        metadata: { mutations: [{ filePath, kind: 'edit' }] },
      },
    })

    expect(runtime.verificationLedger.getChangedFiles()).toEqual([
      expect.objectContaining({
        filePath,
        status: 'pending',
        changedByToolUseId: 'edit_1',
      }),
    ])
  })

  it('marks pending changed files verified after a successful verification command', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 10 })
    const fileReadState = new FileReadStateCache()

    runtime.postToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: filePath },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'Successfully edited',
        metadata: { mutations: [{ filePath, kind: 'edit' }] },
      },
    })

    runtime.postToolUse({
      toolName: 'Bash',
      toolUseId: 'bash_1',
      input: { command: 'pnpm --filter @jdcagnet/core build' },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'build ok',
        metadata: { command: { shell: 'bash', command: 'pnpm --filter @jdcagnet/core build', exitCode: 0 } },
      },
    })

    expect(runtime.verificationLedger.getChangedFiles()[0]).toMatchObject({
      status: 'verified',
      verifiedByToolUseId: 'bash_1',
    })
  })

  it('records failed verification commands even when tool result is an error', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 10 })
    const fileReadState = new FileReadStateCache()

    runtime.postToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: filePath },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'Successfully edited',
        metadata: { mutations: [{ filePath, kind: 'edit' }] },
      },
    })

    runtime.postToolUse({
      toolName: 'Bash',
      toolUseId: 'bash_1',
      input: { command: 'pnpm test' },
      cwd: tmpDir,
      fileReadState,
      result: {
        content: 'test failed',
        isError: true,
        metadata: { command: { shell: 'bash', command: 'pnpm test', exitCode: 1 } },
      },
    })

    expect(runtime.verificationLedger.getCommands()[0]).toMatchObject({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'failed',
      output: 'test failed',
    })
    expect(runtime.verificationLedger.getChangedFiles()[0]).toMatchObject({
      status: 'failed',
      verificationFailure: 'test failed',
    })
  })
})
