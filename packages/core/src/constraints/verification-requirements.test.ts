import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveVerificationRequirements } from './verification-requirements.js'

function tempProject(): string {
  return mkdtempSync(path.join(tmpdir(), 'jdc-phase5-verify-'))
}

describe('deriveVerificationRequirements', () => {
  it('requires test and build for TypeScript source changes when scripts exist', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
      scripts: {
        build: 'tsc',
        test: 'vitest run',
      },
    }))

    const plan = await deriveVerificationRequirements({
      cwd,
      changedFiles: ['packages/core/src/session.ts'],
      userMessage: '修复 session',
    })

    expect(plan.requirements).toEqual([
      expect.objectContaining({
        id: 'verify_test',
        kind: 'test',
        command: 'pnpm test',
        status: 'pending',
        files: ['packages/core/src/session.ts'],
      }),
      expect.objectContaining({
        id: 'verify_build',
        kind: 'build',
        command: 'pnpm build',
        status: 'pending',
      }),
    ])
  })

  it('requires git diff check for docs-only changes', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }))

    const plan = await deriveVerificationRequirements({
      cwd,
      changedFiles: ['docs/superpowers/plans/phase5.md'],
      userMessage: '写计划',
    })

    expect(plan.requirements).toEqual([
      expect.objectContaining({
        id: 'verify_diff_check',
        kind: 'diff_check',
        command: 'git diff --check',
        status: 'pending',
      }),
    ])
  })

  it('marks unavailable script-backed requirements when no matching script exists', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: {} }))

    const plan = await deriveVerificationRequirements({
      cwd,
      changedFiles: ['src/app.ts'],
      userMessage: '修复 app',
    })

    expect(plan.requirements).toContainEqual(expect.objectContaining({
      id: 'verify_test',
      kind: 'test',
      status: 'unavailable',
      reason: 'No test script found in package.json.',
    }))
    expect(plan.requirements).toContainEqual(expect.objectContaining({
      id: 'verify_build',
      kind: 'build',
      status: 'unavailable',
      reason: 'No build script found in package.json.',
    }))
  })

  it('uses npm run for non-special npm scripts', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
      scripts: {
        build: 'tsc',
        test: 'vitest run',
      },
    }))

    const plan = await deriveVerificationRequirements({
      cwd,
      changedFiles: ['src/app.ts'],
      userMessage: '修复 app',
    })

    expect(plan.requirements).toContainEqual(expect.objectContaining({
      id: 'verify_test',
      command: 'npm test',
    }))
    expect(plan.requirements).toContainEqual(expect.objectContaining({
      id: 'verify_build',
      command: 'npm run build',
    }))
  })
})
