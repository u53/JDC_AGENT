import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleSystemPrompt, loadInstructionSources } from './context.js'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('system prompt carried context', () => {
  it('returns refs for project instructions loaded into the system prompt', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-system-carried-'))
    tmpDirs.push(cwd)
    writeFileSync(path.join(cwd, 'JDCAGNET.md'), 'Project instruction.')
    mkdirSync(path.join(cwd, '.jdcagnet', 'rules'), { recursive: true })
    writeFileSync(path.join(cwd, '.jdcagnet', 'rules', 'style.md'), 'Use local style.')

    const sources = (await loadInstructionSources(cwd)).filter((source) => source.scope !== 'global')

    expect(sources.map((source) => source.ref)).toEqual(['JDCAGNET.md', '.jdcagnet/rules/style.md'])
    expect(sources.map((source) => source.scope)).toEqual(['project', 'rule'])
  })

  it('keeps current date but does not inject detailed git status in the generic system prompt', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-system-git-'))
    tmpDirs.push(cwd)

    const text = (await assembleSystemPrompt({ cwd, toolDefs: [], toolNames: [] }))
      .map((segment) => segment.content)
      .join('\n')

    expect(text).toContain('# Current Date')
    expect(text).not.toContain('# Git Status')
  })
})
