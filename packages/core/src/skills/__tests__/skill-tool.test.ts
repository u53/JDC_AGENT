import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { SkillLoader } from '../loader.js'
import { createSkillTool } from '../../tools/skill.js'

describe('SkillTool', () => {
  let tmpDir: string
  let loader: SkillLoader

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-tool-test-'))
    const skillsDir = path.join(tmpDir, '.jdcagnet', 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(path.join(skillsDir, 'greet.md'), `---
name: greet
description: Greet someone
arguments:
  - name
---

Hello \${1}! Welcome aboard.
`)
    loader = new SkillLoader()
    await loader.loadAll(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it('returns error for unknown skill', async () => {
    const tool = createSkillTool(loader)
    const result = await tool.execute({ skill: 'nonexistent' }, { cwd: '/tmp' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown skill')
    expect(result.content).toContain('greet')
  })

  it('returns rendered skill content with args', async () => {
    const tool = createSkillTool(loader)
    const result = await tool.execute({ skill: 'greet', args: 'World' }, { cwd: '/tmp' })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('[Skill: greet]')
    expect(result.content).toContain('Hello World! Welcome aboard.')
  })

  it('returns skill content without args (placeholders remain)', async () => {
    const tool = createSkillTool(loader)
    const result = await tool.execute({ skill: 'greet' }, { cwd: '/tmp' })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Hello ${1}')
  })

  it('lists available skills in error message', async () => {
    const tool = createSkillTool(loader)
    const result = await tool.execute({ skill: 'missing' }, { cwd: '/tmp' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('greet')
  })
})
