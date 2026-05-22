import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { TeamWorkspace } from '../team/team-workspace.js'

describe('TeamWorkspace init/archive', () => {
  let tmpDir: string
  let ws: TeamWorkspace

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `team-ws-test-${Date.now()}-${Math.random()}`)
    mkdirSync(tmpDir, { recursive: true })
    ws = new TeamWorkspace({ rootDir: tmpDir, teamId: 'team_abc' })
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('init creates the .team/ skeleton with objective.md, README.md, log.md', async () => {
    await ws.init('Build a chat app')
    expect(existsSync(path.join(tmpDir, '.team'))).toBe(true)
    expect(existsSync(path.join(tmpDir, '.team/contracts'))).toBe(true)
    expect(existsSync(path.join(tmpDir, '.team/issues'))).toBe(true)
    expect(existsSync(path.join(tmpDir, '.team/tasks'))).toBe(true)
    const objective = readFileSync(path.join(tmpDir, '.team/objective.md'), 'utf8')
    expect(objective).toContain('Build a chat app')
    expect(existsSync(path.join(tmpDir, '.team/README.md'))).toBe(true)
    expect(existsSync(path.join(tmpDir, '.team/log.md'))).toBe(true)
  })

  it('init archives a stale .team/ from a previous run before initializing', async () => {
    mkdirSync(path.join(tmpDir, '.team/tasks/T999'), { recursive: true })
    writeFileSync(path.join(tmpDir, '.team/tasks/T999/task.md'), 'stale')
    await ws.init('New objective')
    expect(existsSync(path.join(tmpDir, '.team/tasks/T999'))).toBe(false)
    const archives = readdirSync(path.join(tmpDir, '.team-archive'))
    expect(archives.length).toBe(1)
    expect(existsSync(path.join(tmpDir, '.team-archive', archives[0], 'tasks/T999/task.md'))).toBe(true)
  })

  it('archive moves .team/ to .team-archive/<teamId>-<ts>/', async () => {
    await ws.init('obj')
    const archivePath = await ws.archive()
    expect(archivePath).toMatch(/\.team-archive\/team_abc-/)
    expect(existsSync(path.join(tmpDir, '.team'))).toBe(false)
    expect(existsSync(archivePath)).toBe(true)
    expect(existsSync(path.join(archivePath, 'objective.md'))).toBe(true)
  })

  it('archive returns empty string when .team/ does not exist', async () => {
    const archivePath = await ws.archive()
    expect(archivePath).toBe('')
  })
})

describe('TeamWorkspace IO', () => {
  let tmpDir: string
  let ws: TeamWorkspace

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `team-ws-io-${Date.now()}-${Math.random()}`)
    mkdirSync(tmpDir, { recursive: true })
    ws = new TeamWorkspace({ rootDir: tmpDir, teamId: 'team_io' })
    await ws.init('Test objective')
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writeTask + readTask round-trip', async () => {
    const now = new Date().toISOString()
    await ws.writeTask(
      'T001',
      { id: 'T001', title: 'Investigate', status: 'todo', created_at: now, updated_at: now },
      'Look into the auth flow.',
    )
    const r = await ws.readTask('T001')
    expect(r.frontmatter.id).toBe('T001')
    expect(r.frontmatter.title).toBe('Investigate')
    expect(r.body.trim()).toBe('Look into the auth flow.')
  })

  it('writeArtifact + readArtifactSummaries returns frontmatter summary', async () => {
    const now = new Date().toISOString()
    await ws.writeTask(
      'T001',
      { id: 'T001', title: 't', status: 'running', created_at: now, updated_at: now },
      'desc',
    )
    await ws.writeArtifact(
      'T001',
      'M001-design',
      {
        id: 'M001-design',
        type: 'design',
        created_by: 'm1',
        on_task: 'T001',
        summary: 'Designed the user list response shape.',
        created_at: now,
      },
      '## Details\n...',
    )
    const summaries = await ws.readArtifactSummaries('T001')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].summary).toBe('Designed the user list response shape.')
    expect(summaries[0].filePath).toBe('tasks/T001/artifacts/M001-design.md')
  })

  it('writeArtifact rejects empty summary', async () => {
    const now = new Date().toISOString()
    await ws.writeTask(
      'T001',
      { id: 'T001', title: 't', status: 'running', created_at: now, updated_at: now },
      'desc',
    )
    await expect(
      ws.writeArtifact(
        'T001',
        'M001',
        { id: 'M001', type: 'report', created_by: 'm1', on_task: 'T001', summary: '   ', created_at: now },
        'body',
      ),
    ).rejects.toThrow(/summary/)
  })

  it('updateTaskStatus updates frontmatter in place', async () => {
    const now = new Date().toISOString()
    await ws.writeTask(
      'T001',
      { id: 'T001', title: 't', status: 'todo', created_at: now, updated_at: now },
      'desc',
    )
    await new Promise((r) => setTimeout(r, 5)) // ensure timestamp progresses
    await ws.updateTaskStatus('T001', 'completed')
    const r = await ws.readTask('T001')
    expect(r.frontmatter.status).toBe('completed')
    expect(r.frontmatter.updated_at).not.toBe(now)
  })

  it('writeResult writes result.md with frontmatter', async () => {
    const now = new Date().toISOString()
    await ws.writeTask(
      'T001',
      { id: 'T001', title: 't', status: 'completed', created_at: now, updated_at: now },
      'desc',
    )
    await ws.writeResult(
      'T001',
      {
        task_id: 'T001',
        completed_by: 'm1',
        completed_at: now,
        summary: 'Done.',
        artifacts: ['M001-design'],
      },
      '## Result\n\nAll good.',
    )
    const text = readFileSync(path.join(tmpDir, '.team/tasks/T001/result.md'), 'utf8')
    expect(text).toContain('summary: Done.')
    expect(text).toContain('All good.')
  })

  it('readArtifactSummaries returns [] when artifact dir does not exist', async () => {
    const now = new Date().toISOString()
    await ws.writeTask(
      'T999',
      { id: 'T999', title: 't', status: 'todo', created_at: now, updated_at: now },
      'desc',
    )
    const summaries = await ws.readArtifactSummaries('T999')
    expect(summaries).toEqual([])
  })

  it('appendLog serializes concurrent writes', async () => {
    await Promise.all([
      ws.appendLog('event A'),
      ws.appendLog('event B'),
      ws.appendLog('event C'),
    ])
    const log = readFileSync(path.join(tmpDir, '.team/log.md'), 'utf8')
    expect(log).toContain('event A')
    expect(log).toContain('event B')
    expect(log).toContain('event C')
    // All three events must be on distinct lines
    const lines = log.split('\n').filter((l) => l.includes('event '))
    expect(lines.length).toBe(3)
  })

  it('writeContract + readContract round-trip', async () => {
    const now = new Date().toISOString()
    await ws.writeContract(
      'api-v1',
      { name: 'api-v1', version: 1, locked_by_task: 'T001', created_at: now, updated_at: now },
      '## Schema\n- id: number\n- name: string',
    )
    const r = await ws.readContract('api-v1')
    expect(r).not.toBeNull()
    expect(r!.frontmatter.name).toBe('api-v1')
    expect(r!.frontmatter.version).toBe(1)
    expect(r!.body).toContain('Schema')
  })

  it('listContracts returns all contracts in dir', async () => {
    const now = new Date().toISOString()
    await ws.writeContract('api-v1', { name: 'api-v1', version: 1, locked_by_task: 'T001', created_at: now, updated_at: now }, 'a')
    await ws.writeContract('ui-spec', { name: 'ui-spec', version: 1, locked_by_task: 'T002', created_at: now, updated_at: now }, 'b')
    const list = await ws.listContracts()
    const names = list.map((c) => c.name).sort()
    expect(names).toEqual(['api-v1', 'ui-spec'])
  })

  it('writeIssue + listIssues + nextIssueId', async () => {
    const id1 = await ws.nextIssueId()
    expect(id1).toBe('ISSUE-001')
    await ws.writeIssue(id1, {
      id: id1, title: 'Bug 1', status: 'open', severity: 'high',
      opened_by: 'qa', on_task: 'T001', opened_at: new Date().toISOString(),
    }, '## Repro\n...')
    const id2 = await ws.nextIssueId()
    expect(id2).toBe('ISSUE-002')

    const open = await ws.listIssues({ status: 'open' })
    expect(open).toHaveLength(1)
    expect(open[0].title).toBe('Bug 1')
  })

  it('updateIssueStatus appends resolution and sets resolved_at', async () => {
    const now = new Date().toISOString()
    await ws.writeIssue('ISSUE-001', {
      id: 'ISSUE-001', title: 't', status: 'open', severity: 'medium',
      opened_by: 'qa', on_task: 'T001', opened_at: now,
    }, '## Repro\nx')
    await ws.updateIssueStatus('ISSUE-001', 'resolved', 'Fixed by adding column')
    const r = await ws.readIssue('ISSUE-001')
    expect(r!.frontmatter.status).toBe('resolved')
    expect(r!.frontmatter.resolved_at).toBeTruthy()
    expect(r!.body).toContain('Fixed by adding column')
  })
})
