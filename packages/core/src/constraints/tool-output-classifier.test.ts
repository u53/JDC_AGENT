import { describe, expect, it } from 'vitest'
import { classifyVerificationCommand } from './tool-output-classifier.js'

describe('classifyVerificationCommand', () => {
  it.each([
    ['pnpm --filter @jdcagnet/core build', 'build'],
    ['npm run typecheck', 'typecheck'],
    ['pnpm exec vitest run src/foo.test.ts', 'test'],
    ['pytest tests/test_api.py -q', 'test'],
    ['cargo test', 'test'],
    ['go test ./...', 'test'],
    ['cd packages/core && pnpm build', 'build'],
    ['pnpm lint', 'lint'],
  ])('classifies %s as %s', (command, kind) => {
    expect(classifyVerificationCommand(command)).toEqual({ kind })
  })

  it('classifies git diff check as diff_check verification', () => {
    expect(classifyVerificationCommand('git diff --check')).toEqual({ kind: 'diff_check' })
    expect(classifyVerificationCommand('cd packages/core && git diff --check')).toEqual({ kind: 'diff_check' })
  })

  it('ignores non-verification commands', () => {
    expect(classifyVerificationCommand('git status --short')).toBeUndefined()
    expect(classifyVerificationCommand('ls packages/core/src')).toBeUndefined()
    expect(classifyVerificationCommand('echo "pnpm test"')).toBeUndefined()
    expect(classifyVerificationCommand('echo ok # pnpm build')).toBeUndefined()
    expect(classifyVerificationCommand('printf "vitest"')).toBeUndefined()
  })
})
