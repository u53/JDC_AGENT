import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadPermissionRules, type PermissionRule } from '../src/permission-rules.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('loadPermissionRules', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdcagnet-perm-test-' + Date.now())
  const projectDir = path.join(tmpDir, 'project')
  const globalDir = path.join(tmpDir, 'global')

  beforeEach(() => {
    mkdirSync(path.join(projectDir, '.jdcagnet'), { recursive: true })
    mkdirSync(globalDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should load project and global rules from JSON files', () => {
    const projectRules: PermissionRule[] = [
      { tool: 'file_read', path: 'src/**', decision: 'allow' },
    ]
    const globalRules: PermissionRule[] = [
      { tool: 'bash', command: 'npm *', decision: 'allow' },
    ]

    writeFileSync(
      path.join(projectDir, '.jdcagnet', 'permissions.json'),
      JSON.stringify({ rules: projectRules })
    )
    writeFileSync(
      path.join(globalDir, 'permissions.json'),
      JSON.stringify({ rules: globalRules })
    )

    const result = loadPermissionRules(projectDir, globalDir)
    expect(result.projectRules).toEqual(projectRules)
    expect(result.globalRules).toEqual(globalRules)
  })

  it('should return empty arrays when files do not exist', () => {
    const result = loadPermissionRules('/nonexistent', '/also-nonexistent')
    expect(result.projectRules).toEqual([])
    expect(result.globalRules).toEqual([])
  })
})
