import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_ENGINE_CONFIG } from './config.js'
import { collectWorkflowContext } from './providers/workflow-provider.js'
import { ContextProviderIdSchema } from './schemas.js'
import type { ContextRequest } from './types.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('WorkflowSignalProvider', () => {
  it('registers workflow as a first-class context provider id', () => {
    expect(ContextProviderIdSchema.safeParse('workflow').success).toBe(true)
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.providerToggles.workflow).toBe(true)
  })

  it('collects release, build, test, and package signals from bounded workflow files', async () => {
    const cwd = tempProject()
    writeProjectFile(cwd, '.github/workflows/release.yml', [
      'name: Release',
      'jobs:',
      '  release:',
      '    steps:',
      '      - run: pnpm install',
      '      - run: pnpm build',
      '      - name: Package',
      '        run: |',
      '          pnpm package',
      '          pnpm --filter @jdcagnet/core test',
    ].join('\n'))
    writeProjectFile(cwd, 'package.json', JSON.stringify({
      scripts: {
        build: 'pnpm -r build',
        test: 'pnpm --filter @jdcagnet/core test',
        package: 'pnpm build && electron-builder --publish never',
      },
    }, null, 2))
    writeProjectFile(cwd, 'packages/vscode-extension/package.json', JSON.stringify({
      scripts: {
        build: 'tsc -p .',
        package: 'vsce package --no-dependencies',
      },
    }, null, 2))
    writeProjectFile(cwd, 'packages/deep/nested/package.json', JSON.stringify({
      scripts: {
        release: 'echo should-not-read',
      },
    }, null, 2))

    const result = await collectWorkflowContext(request({ cwd }))
    const content = result.sections.map((section) => section.content).join('\n')
    const refs = result.evidence.map((item) => item.metadata.file)

    expect(result.health.status).toBe('enabled')
    expect(content).toContain('pnpm build')
    expect(content).toContain('pnpm package')
    expect(content).toContain('pnpm --filter @jdcagnet/core test')
    expect(content).toContain('vsce package --no-dependencies')
    expect(content).toContain('.github/workflows/release.yml')
    expect(content).not.toContain('should-not-read')
    expect(refs).toEqual(expect.arrayContaining([
      '.github/workflows/release.yml',
      'package.json',
      'packages/vscode-extension/package.json',
    ]))
    expect(result.sections[0]?.citations.every((citation) => typeof citation.hash === 'string' && citation.hash.length > 0)).toBe(true)
  })
})

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'jdc-workflow-provider-'))
  dirs.push(dir)
  return dir
}

function writeProjectFile(cwd: string, relativePath: string, content: string): void {
  const filePath = path.join(cwd, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function request(overrides: Partial<ContextRequest>): ContextRequest {
  return {
    sessionId: 'session_workflow',
    cwd: '/repo',
    userMessage: '我们的发布流程是咋样的',
    recentMessages: [],
    mode: 'chat',
    model: 'test-model',
    runtime: {},
    createdAt: 1_000,
    ...overrides,
  }
}
