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
    ['pnpm lint', 'lint'],
  ])('classifies %s as %s', (command, kind) => {
    expect(classifyVerificationCommand(command)).toEqual({ kind })
  })

  it('ignores non-verification commands', () => {
    expect(classifyVerificationCommand('git status --short')).toBeUndefined()
    expect(classifyVerificationCommand('ls packages/core/src')).toBeUndefined()
  })
})
