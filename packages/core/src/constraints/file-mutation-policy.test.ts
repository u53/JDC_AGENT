import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileReadStateCache } from '../file-read-state.js'
import { evaluateFileMutationPolicy } from './file-mutation-policy.js'

describe('evaluateFileMutationPolicy', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdc-file-mutation-policy-test')
  const existingFile = path.join(tmpDir, 'existing.ts')
  const newFile = path.join(tmpDir, 'new.ts')
  const existingContent = 'const alpha = 1\nconst beta = 2\n'

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(existingFile, existingContent)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('blocks Edit when the existing file was not read', () => {
    const decision = evaluateFileMutationPolicy({
      toolName: 'Edit',
      input: { file_path: existingFile, old_string: 'const alpha = 1', new_string: 'const alpha = 10' },
      cwd: tmpDir,
      fileReadState: new FileReadStateCache(),
    })

    expect(decision).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('has not been read'),
    })
  })

  it('allows Edit after a fresh read covering the edit anchor', () => {
    const fileReadState = new FileReadStateCache()
    fileReadState.recordRead(existingFile, 0, 2000, 2, existingContent)

    const decision = evaluateFileMutationPolicy({
      toolName: 'Edit',
      input: { file_path: existingFile, old_string: 'const beta = 2', new_string: 'const beta = 20' },
      cwd: tmpDir,
      fileReadState,
    })

    expect(decision).toEqual({ decision: 'allow' })
  })

  it('blocks MultiEdit when one edit anchor was not read', () => {
    const fileReadState = new FileReadStateCache()
    fileReadState.recordRead(existingFile, 0, 1, 2, 'const alpha = 1')

    const decision = evaluateFileMutationPolicy({
      toolName: 'MultiEdit',
      input: {
        file_path: existingFile,
        edits: [
          { old_string: 'const alpha = 1', new_string: 'const alpha = 10' },
          { old_string: 'const beta = 2', new_string: 'const beta = 20' },
        ],
      },
      cwd: tmpDir,
      fileReadState,
    })

    expect(decision).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('edit anchor'),
    })
  })

  it('allows Write for a new file', () => {
    const decision = evaluateFileMutationPolicy({
      toolName: 'Write',
      input: { file_path: newFile, content: 'const gamma = 3\n' },
      cwd: tmpDir,
      fileReadState: new FileReadStateCache(),
    })

    expect(decision).toEqual({ decision: 'allow' })
  })

  it('blocks Write over an existing file after only a range read', () => {
    const fileReadState = new FileReadStateCache()
    fileReadState.recordRead(existingFile, 0, 1, 2, 'const alpha = 1')

    const decision = evaluateFileMutationPolicy({
      toolName: 'Write',
      input: { file_path: existingFile, content: 'const alpha = 10\n' },
      cwd: tmpDir,
      fileReadState,
    })

    expect(decision).toMatchObject({
      decision: 'block',
      reason: expect.stringMatching(/entire file|full file/i),
    })
  })

  it('blocks Write when overwriting an unread existing file', () => {
    const decision = evaluateFileMutationPolicy({
      toolName: 'Write',
      input: { file_path: existingFile, content: 'const alpha = 10\n' },
      cwd: tmpDir,
      fileReadState: new FileReadStateCache(),
    })

    expect(decision).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('has not been read'),
    })
  })
})
