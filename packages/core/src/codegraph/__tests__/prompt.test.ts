import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getCodegraphPromptSegment } from '../prompt.js'

describe('getCodegraphPromptSegment', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cg-prompt-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns empty segment when project has no .codegraph/', () => {
    const out = getCodegraphPromptSegment(tmp)
    expect(out.segment).toBe('')
    expect(out.cacheable).toBe(false)
  })

  it('returns guidance segment containing cwd when .codegraph/codegraph.db exists', () => {
    const cgDir = path.join(tmp, '.codegraph')
    mkdirSync(cgDir, { recursive: true })
    writeFileSync(path.join(cgDir, 'codegraph.db'), '')
    const out = getCodegraphPromptSegment(tmp)
    expect(out.cacheable).toBe(false)
    expect(out.segment).toContain('mcp__codegraph__codegraph_')
    expect(out.segment).toContain(tmp)
    expect(out.segment).toContain('projectPath')
  })
})
