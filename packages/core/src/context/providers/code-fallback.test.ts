import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectFallbackCodeEvidence } from './code-fallback.js'
import type { ContextEvidenceRequirement } from '../types.js'

const requirement: ContextEvidenceRequirement = {
  id: 'req_relevant_code',
  kind: 'relevant_code',
  reason: 'Need code.',
  query: '修复 backgroundTasks completion',
  priority: 'must',
  relatedFiles: ['packages/core/src/session.ts'],
  relatedSymbols: ['backgroundTasks'],
  docRefs: [],
  languageHints: ['typescript'],
}

describe('collectFallbackCodeEvidence', () => {
  it('returns matching explicit files and snippets while the index warms', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-code-fallback-'))
    mkdirSync(path.join(cwd, 'packages/core/src'), { recursive: true })
    writeFileSync(path.join(cwd, 'packages/core/src/session.ts'), 'export const backgroundTasks = new Map()\n')

    const result = await collectFallbackCodeEvidence({ cwd, requirements: [requirement], now: () => 1_000 })

    expect(result.matches).toEqual([expect.objectContaining({
      file: 'packages/core/src/session.ts',
      reason: 'requirement_file_match',
      line: 1,
    })])
    expect(result.content).toContain('backgroundTasks')
  })

  it('only reads explicit paths safely under cwd', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-code-fallback-safe-'))
    mkdirSync(path.join(cwd, 'packages/core/src'), { recursive: true })
    writeFileSync(path.join(cwd, 'packages/core/src/session.ts'), 'export const backgroundTasks = new Map()\n')
    writeFileSync(path.join(cwd, 'packages/core/src/unrelated.ts'), 'export const unrelatedFeature = true\n')

    const result = await collectFallbackCodeEvidence({
      cwd,
      requirements: [{ ...requirement, relatedFiles: ['../outside.ts', 'packages/core/src/session.ts'] }],
    })

    expect(result.matches.map((match) => match.file)).toEqual(['packages/core/src/session.ts'])
    expect(result.content).not.toContain('unrelatedFeature')
  })
})
