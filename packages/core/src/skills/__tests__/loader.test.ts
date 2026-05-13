import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { SkillLoader, renderSkill } from '../loader.js'

describe('SkillLoader', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-test-'))
    const skillsDir = path.join(tmpDir, '.jdcagnet', 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(path.join(skillsDir, 'refactor.md'), `---
name: refactor
description: Refactor a file
user-invocable: true
arguments:
  - file-path
argument-hint: "<file-path>"
allowed-tools:
  - FileRead
  - FileEdit
---

Please refactor \${1} for better readability.
`)
    await writeFile(path.join(skillsDir, 'internal.md'), `---
name: internal
description: Internal skill
user-invocable: false
---

Internal content.
`)
    // Directory-based skill
    const dirSkill = path.join(skillsDir, 'deploy')
    await mkdir(dirSkill)
    await writeFile(path.join(dirSkill, 'SKILL.md'), `---
name: deploy
description: Deploy the app
---

Deploy steps here.
`)
  })

  afterEach(async () => { await rm(tmpDir, { recursive: true }) })

  it('loads skills from project directory', async () => {
    const loader = new SkillLoader()
    await loader.loadAll(tmpDir)
    expect(loader.getAll()).toHaveLength(3)
  })

  it('filters user-invocable skills', async () => {
    const loader = new SkillLoader()
    await loader.loadAll(tmpDir)
    const invocable = loader.getInvocable()
    expect(invocable).toHaveLength(2)
    expect(invocable.map(s => s.name).sort()).toEqual(['deploy', 'refactor'])
  })

  it('gets skill by name', async () => {
    const loader = new SkillLoader()
    await loader.loadAll(tmpDir)
    const skill = loader.get('refactor')
    expect(skill?.description).toBe('Refactor a file')
    expect(skill?.arguments).toEqual(['file-path'])
    expect(skill?.allowedTools).toEqual(['FileRead', 'FileEdit'])
  })

  it('loads directory-based skills', async () => {
    const loader = new SkillLoader()
    await loader.loadAll(tmpDir)
    const skill = loader.get('deploy')
    expect(skill?.content).toBe('Deploy steps here.')
  })

  it('returns undefined for unknown skill', async () => {
    const loader = new SkillLoader()
    await loader.loadAll(tmpDir)
    expect(loader.get('nonexistent')).toBeUndefined()
  })
})

describe('renderSkill', () => {
  it('substitutes arguments', () => {
    const skill = { name: 'test', description: '', content: 'Fix ${1} and ${2}', userInvocable: true, arguments: ['a', 'b'], source: 'project' as const, filePath: '' }
    const result = renderSkill(skill, 'foo.ts bar.ts')
    expect(result).toBe('Fix foo.ts and bar.ts')
  })

  it('returns content unchanged without args', () => {
    const skill = { name: 'test', description: '', content: 'Do something', userInvocable: true, arguments: [], source: 'project' as const, filePath: '' }
    const result = renderSkill(skill)
    expect(result).toBe('Do something')
  })
})
