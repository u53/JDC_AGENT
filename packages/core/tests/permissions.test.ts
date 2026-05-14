import { describe, it, expect } from 'vitest'
import { PermissionChecker } from '../src/permissions.js'

describe('PermissionChecker', () => {
  it('should match project rules with glob path patterns', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [
        { tool: 'file_read', path: 'src/**', decision: 'allow' },
        { tool: 'file_write', path: 'dist/**', decision: 'deny' },
      ],
      globalRules: [],
    })

    expect(checker.check('file_read', { file_path: 'src/index.ts' })).toBe('allow')
    expect(checker.check('file_read', { file_path: 'secret/key.pem' })).not.toBe('allow')
    expect(checker.check('file_write', { file_path: 'dist/bundle.js' })).toBe('deny')
  })

  it('should match bash command patterns', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [
        { tool: 'bash', command: 'npm *', decision: 'allow' },
        { tool: 'bash', command: 'rm *', decision: 'deny' },
      ],
      globalRules: [],
    })

    expect(checker.check('bash', { command: 'npm install' })).toBe('allow')
    expect(checker.check('bash', { command: 'rm -rf node_modules' })).toBe('deny')
  })

  it('should prioritize project rules over global rules', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [
        { tool: 'file_write', path: '**', decision: 'allow' },
      ],
      globalRules: [
        { tool: 'file_write', path: '**', decision: 'deny' },
      ],
    })

    expect(checker.check('file_write', { file_path: 'anything.ts' })).toBe('allow')
  })

  it('should fall back to built-in defaults when no rule matches', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [],
      globalRules: [],
    })

    // Built-in: read-only tools -> allow
    expect(checker.check('file_read', { file_path: 'foo.ts' })).toBe('allow')
    expect(checker.check('grep', {})).toBe('allow')
    // Built-in: write tools -> ask
    expect(checker.check('file_write', { file_path: 'foo.ts' })).toBe('ask')
    expect(checker.check('bash', { command: 'echo hi' })).toBe('ask')
    // Unknown tools -> ask
    expect(checker.check('unknown_tool', {})).toBe('ask')
  })

  it('should allow everything in relaxed mode (except critical)', () => {
    const checker = new PermissionChecker('relaxed', '/project', {
      projectRules: [{ tool: 'file_write', path: '**', decision: 'deny' }],
      globalRules: [],
    })

    expect(checker.check('file_write', { file_path: 'foo.ts' })).toBe('allow')
    expect(checker.check('bash', { command: 'echo hi' })).toBe('allow')
  })

  it('should downgrade allow to ask in strict mode (except read-only)', () => {
    const checker = new PermissionChecker('strict', '/project', {
      projectRules: [
        { tool: 'file_write', path: '**', decision: 'allow' },
      ],
      globalRules: [],
    })

    // file_write allow -> downgraded to ask in strict
    expect(checker.check('file_write', { file_path: 'foo.ts' })).toBe('ask')
    // read-only tools still allowed
    expect(checker.check('file_read', { file_path: 'foo.ts' })).toBe('allow')
  })

  it('should match rules without path/command against all invocations', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [
        { tool: 'web_fetch', decision: 'deny' },
      ],
      globalRules: [],
    })

    expect(checker.check('web_fetch', { url: 'https://example.com' })).toBe('deny')
  })

  it('allows read-only tools by default', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [],
      globalRules: [],
    })
    expect(checker.check('file_read', {})).toBe('allow')
    expect(checker.check('glob', {})).toBe('allow')
    expect(checker.check('grep', {})).toBe('allow')
    expect(checker.check('ls', {})).toBe('allow')
    expect(checker.check('tree', {})).toBe('allow')
    expect(checker.check('lsp', {})).toBe('allow')
  })

  it('remembers session-level allows', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [],
      globalRules: [],
    })
    expect(checker.check('bash', { command: 'ls' })).toBe('ask')
    checker.allowForSession('bash')
    expect(checker.check('bash', { command: 'ls' })).toBe('allow')
  })

  it('detects dangerous commands', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [],
      globalRules: [],
    })
    expect(checker.isDangerousCommand({ command: 'rm -rf /' })).toBe(true)
    expect(checker.isDangerousCommand({ command: 'git push --force' })).toBe(true)
    expect(checker.isDangerousCommand({ command: 'git reset --hard' })).toBe(true)
    expect(checker.isDangerousCommand({ command: 'ls -la' })).toBe(false)
    expect(checker.isDangerousCommand({ command: 'echo hello' })).toBe(false)
  })

  it('critical commands ask even in relaxed mode', () => {
    const checker = new PermissionChecker('relaxed', '/project', {
      projectRules: [],
      globalRules: [],
    })
    expect(checker.check('bash', { command: 'rm -rf /' })).toBe('ask')
    expect(checker.check('bash', { command: 'sudo rm -rf /' })).toBe('ask')
  })
})
