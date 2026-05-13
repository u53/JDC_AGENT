import { describe, it, expect } from 'vitest'
import { PermissionChecker } from '../src/permissions.js'

describe('PermissionChecker', () => {
  it('allows read-only tools by default', () => {
    const checker = new PermissionChecker()
    expect(checker.check('file_read', {})).toBe('allow')
    expect(checker.check('glob', {})).toBe('allow')
    expect(checker.check('grep', {})).toBe('allow')
    expect(checker.check('ls', {})).toBe('allow')
    expect(checker.check('tree', {})).toBe('allow')
    expect(checker.check('lsp', {})).toBe('allow')
  })

  it('requires confirmation for write tools', () => {
    const checker = new PermissionChecker()
    expect(checker.check('bash', { command: 'ls' })).toBe('ask')
    expect(checker.check('file_write', {})).toBe('ask')
    expect(checker.check('file_edit', {})).toBe('ask')
  })

  it('remembers session-level allows', () => {
    const checker = new PermissionChecker()
    expect(checker.check('bash', { command: 'ls' })).toBe('ask')
    checker.allowForSession('bash')
    expect(checker.check('bash', { command: 'ls' })).toBe('allow')
  })

  it('relaxed mode only asks for dangerous commands', () => {
    const checker = new PermissionChecker('relaxed')
    expect(checker.check('bash', { command: 'ls' })).toBe('allow')
    expect(checker.check('bash', { command: 'rm -rf /' })).toBe('ask')
    expect(checker.check('file_write', {})).toBe('allow')
  })

  it('strict mode asks for all non-readonly', () => {
    const checker = new PermissionChecker('strict')
    expect(checker.check('file_read', {})).toBe('allow')
    expect(checker.check('bash', { command: 'echo hi' })).toBe('ask')
  })

  it('detects dangerous commands', () => {
    const checker = new PermissionChecker()
    expect(checker.isDangerousCommand({ command: 'rm -rf /' })).toBe(true)
    expect(checker.isDangerousCommand({ command: 'git push --force' })).toBe(true)
    expect(checker.isDangerousCommand({ command: 'git reset --hard' })).toBe(true)
    expect(checker.isDangerousCommand({ command: 'ls -la' })).toBe(false)
    expect(checker.isDangerousCommand({ command: 'echo hello' })).toBe(false)
  })

  it('unknown tools default to ask in standard mode', () => {
    const checker = new PermissionChecker()
    expect(checker.check('some_unknown_tool', {})).toBe('ask')
  })

  it('session allows work in strict mode', () => {
    const checker = new PermissionChecker('strict')
    expect(checker.check('bash', { command: 'echo hi' })).toBe('ask')
    checker.allowForSession('bash')
    expect(checker.check('bash', { command: 'echo hi' })).toBe('allow')
  })
})
