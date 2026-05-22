import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { TeamWorkspace } from '../team/team-workspace.js'
import { createTeamArtifactTool } from '../tools/team-artifact.js'

describe('team_artifact tool', () => {
  let tmpDir: string
  let ws: TeamWorkspace
  let tool: ReturnType<typeof createTeamArtifactTool>

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `team-art-${Date.now()}-${Math.random()}`)
    mkdirSync(tmpDir, { recursive: true })
    ws = new TeamWorkspace({ rootDir: tmpDir, teamId: 'team_t' })
    await ws.init('obj')
    const now = new Date().toISOString()
    await ws.writeTask(
      'T001',
      { id: 'T001', title: 't', status: 'running', created_at: now, updated_at: now },
      'desc',
    )
    tool = createTeamArtifactTool({
      memberId: 'member_x',
      taskId: 'T001',
      workspace: ws,
    })
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('create_artifact writes a file with frontmatter', async () => {
    const result = await tool.execute(
      {
        action: 'create_artifact',
        type: 'report',
        summary: 'Found 3 issues with auth.',
        content: '## Findings\n- foo\n- bar',
      },
      {} as any,
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toMatch(/Artifact saved/)
    const summaries = await ws.readArtifactSummaries('T001')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].summary).toBe('Found 3 issues with auth.')
  })

  it('create_artifact rejects when summary is missing', async () => {
    const result = await tool.execute(
      { action: 'create_artifact', type: 'report', content: 'x' },
      {} as any,
    )
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/summary/i)
  })

  it('update_status changes task status and writes result.md when completed', async () => {
    const r = await tool.execute(
      {
        action: 'update_status',
        target_id: 'T001',
        new_status: 'completed',
        summary: 'All done.',
      },
      {} as any,
    )
    expect(r.isError).toBeFalsy()
    const t = await ws.readTask('T001')
    expect(t.frontmatter.status).toBe('completed')
    expect(existsSync(path.join(tmpDir, '.team/tasks/T001/result.md'))).toBe(true)
    const result = readFileSync(path.join(tmpDir, '.team/tasks/T001/result.md'), 'utf8')
    expect(result).toContain('summary: All done.')
  })

  it('update_status without new_status returns error', async () => {
    const r = await tool.execute({ action: 'update_status', target_id: 'T001' }, {} as any)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/new_status/)
  })

  it('rejects unknown actions', async () => {
    const r = await tool.execute({ action: 'launch_rocket' }, {} as any)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/unknown/i)
  })

  it('create_artifact uses default id when not provided', async () => {
    const r = await tool.execute(
      { action: 'create_artifact', summary: 'x', content: 'y' },
      {} as any,
    )
    expect(r.isError).toBeFalsy()
    expect(r.content).toMatch(/member_x-/)
  })

  it('create_contract writes contracts/<name>.md and bumps version on rewrite', async () => {
    const r1 = await tool.execute(
      {
        action: 'create_contract',
        contract_name: 'api-v1',
        summary: 'GET /users response shape',
        content: '## Schema\n- id: number\n- name: string',
      },
      {} as any,
    )
    expect(r1.isError).toBeFalsy()
    expect(r1.content).toMatch(/v1/)
    expect(existsSync(path.join(tmpDir, '.team/contracts/api-v1.md'))).toBe(true)

    const r2 = await tool.execute(
      {
        action: 'create_contract',
        contract_name: 'api-v1',
        summary: 'add created_at',
        content: '## Schema\n- id, name, created_at',
      },
      {} as any,
    )
    expect(r2.isError).toBeFalsy()
    expect(r2.content).toMatch(/v2/)
  })

  it('create_contract requires summary and contract_name', async () => {
    const r1 = await tool.execute({ action: 'create_contract' }, {} as any)
    expect(r1.isError).toBe(true)
    const r2 = await tool.execute(
      { action: 'create_contract', contract_name: 'x' },
      {} as any,
    )
    expect(r2.isError).toBe(true)
    expect(r2.content).toMatch(/summary/i)
  })

  it('create_issue files an ISSUE-N file and notifies mailbox when present', async () => {
    const mailboxMessages: any[] = []
    const toolWithMailbox = createTeamArtifactTool({
      memberId: 'qa_x',
      taskId: 'T001',
      workspace: ws,
      teamMailbox: { push: (m: any) => mailboxMessages.push(m) },
    })
    const r = await toolWithMailbox.execute(
      {
        action: 'create_issue',
        issue_title: 'Missing created_at field',
        severity: 'high',
        on_task: 'T001',
        content: '## Repro\nGET /users returns no created_at',
      },
      {} as any,
    )
    expect(r.isError).toBeFalsy()
    expect(r.content).toMatch(/ISSUE-001/)
    expect(existsSync(path.join(tmpDir, '.team/issues/ISSUE-001.md'))).toBe(true)
    // Mailbox notification
    expect(mailboxMessages.length).toBe(1)
    expect(mailboxMessages[0].to).toBe('manager')
    expect(mailboxMessages[0].content).toMatch(/ISSUE-001/)
    expect(mailboxMessages[0].priority).toBe('high')
  })

  it('create_issue auto-allocates incrementing ids', async () => {
    await tool.execute(
      { action: 'create_issue', issue_title: 'a', on_task: 'T001', content: 'x' },
      {} as any,
    )
    await tool.execute(
      { action: 'create_issue', issue_title: 'b', on_task: 'T001', content: 'y' },
      {} as any,
    )
    expect(existsSync(path.join(tmpDir, '.team/issues/ISSUE-001.md'))).toBe(true)
    expect(existsSync(path.join(tmpDir, '.team/issues/ISSUE-002.md'))).toBe(true)
  })

  it('update_status on ISSUE-N marks it resolved with resolution', async () => {
    await tool.execute(
      { action: 'create_issue', issue_title: 'x', on_task: 'T001', content: 'r' },
      {} as any,
    )
    const r = await tool.execute(
      {
        action: 'update_status',
        target_id: 'ISSUE-001',
        new_status: 'resolved',
        resolution: 'Added created_at column',
      },
      {} as any,
    )
    expect(r.isError).toBeFalsy()
    const text = readFileSync(path.join(tmpDir, '.team/issues/ISSUE-001.md'), 'utf8')
    expect(text).toContain('status: resolved')
    expect(text).toContain('Added created_at column')
  })
})
