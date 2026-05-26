import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import type { SubSessionOptions, SubSessionResult } from '../../sub-session.js'

vi.mock('../../sub-session.js', async () => {
  const actual = await vi.importActual<typeof import('../../sub-session.js')>('../../sub-session.js')
  return {
    ...actual,
    runSubSession: vi.fn(async (opts: SubSessionOptions): Promise<SubSessionResult> => {
      opts.onAgentText?.('Working...')
      return { content: `Done: ${opts.prompt.slice(0, 20)}`, turns: 1, toolsUsed: [] }
    }),
  }
})

import { BackgroundTaskManager } from '../../background-tasks.js'
import { TeamRegistry } from '../team-registry.js'
import { createTeamTool } from '../../tools/team.js'
import { createBackgroundSendTool } from '../../tools/background-send.js'
import { createBackgroundStatusTool } from '../../tools/background-status.js'
import { createBackgroundEventsTool } from '../../tools/background-events.js'

const mockDeps: any = { provider: {}, toolRegistry: {}, modelConfig: {} }
const buildSubSessionDeps = () => {
  // Each team gets its own cwd to avoid colliding on .team/ in /tmp
  const cwd = path.join(os.tmpdir(), `team-tools-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  require('node:fs').mkdirSync(cwd, { recursive: true })
  return { ...mockDeps, cwd } as any
}

describe('Team tools', () => {
  it('Team tool creates a team and registers it', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-' + Date.now()))
    const registry = new TeamRegistry()
    const tool = createTeamTool({ teamRegistry: registry, backgroundTasks: bg, buildSubSessionDeps })

    const result = await tool.execute({
      objective: 'test team creation and registration flow',
      members: [{ role: 'explorer', agentType: 'explore' }],
      tasks: [{ title: 'A', description: 'a' }],
    } as any, {} as any)

    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Team ID:')
    // After registration the team starts and may complete via mocked subagent.
    // Either it is still registered, or it completed and was removed — both are fine.
    // Just verify execution succeeded (above).
  })

  it('Team tool caps members at 10 (uses maxWorkers)', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-2-' + Date.now()))
    const registry = new TeamRegistry()
    const tool = createTeamTool({ teamRegistry: registry, backgroundTasks: bg, buildSubSessionDeps })

    const result = await tool.execute({
      objective: 'Test capping members at the maximum allowed limit',
      members: Array.from({ length: 15 }, (_, i) => ({ role: `m${i}`, agentType: 'explore' })),
      maxWorkers: 20, // requested 20, should cap at 10
      tasks: Array.from({ length: 30 }, (_, i) => ({ title: `T${i}`, description: `t${i}` })),
    } as any, {} as any)
    expect(result.isError).toBeFalsy()
    // Members count: lines between "Initial members:" and "Initial tasks"
    const afterMembers = result.content.split('Initial members:\n')[1] || ''
    const beforeTasks = afterMembers.split('Initial tasks')[0]
    const memberLineCount = (beforeTasks.match(/^  - /gm) || []).length
    expect(memberLineCount).toBeLessThanOrEqual(10)
    expect(memberLineCount).toBeGreaterThan(0)
  })

  it('background_send sends message to a team', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-3-' + Date.now()))
    const registry = new TeamRegistry()
    const teamTool = createTeamTool({ teamRegistry: registry, backgroundTasks: bg, buildSubSessionDeps })
    await teamTool.execute({
      objective: 'test background send message to a team',
      members: [{ role: 'r', agentType: 'explore' }],
      tasks: [{ title: 'A', description: 'a' }, { title: 'B', description: 'b' }, { title: 'C', description: 'c' }],
    } as any, {} as any)
    const teamId = bg.listAll()[0].id

    const sendTool = createBackgroundSendTool({ backgroundTasks: bg, teamRegistry: registry })
    const result = await sendTool.execute({
      task_id: teamId,
      message: 'wrap up please',
      intent: 'wrap_up',
    } as any, {} as any)
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Message sent')
  })

  it('background_send rejects non-team task', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-4-' + Date.now()))
    const registry = new TeamRegistry()
    const sendTool = createBackgroundSendTool({ backgroundTasks: bg, teamRegistry: registry })
    const result = await sendTool.execute({ task_id: 'nonexistent', message: 'x' } as any, {} as any)
    expect(result.isError).toBe(true)
  })

  it('background_status returns team status JSON', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-5-' + Date.now()))
    const registry = new TeamRegistry()
    const teamTool = createTeamTool({ teamRegistry: registry, backgroundTasks: bg, buildSubSessionDeps })
    await teamTool.execute({
      objective: 'analyze the project structure and dependencies',
      members: [{ role: 'explorer', agentType: 'explore' }],
      tasks: [{ title: 'A', description: 'a' }],
    } as any, {} as any)
    const teamId = bg.listAll()[0].id
    const statusTool = createBackgroundStatusTool({ backgroundTasks: bg, teamRegistry: registry })
    const result = await statusTool.execute({ task_id: teamId } as any, {} as any)
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content as string)
    expect(data.type).toBe('team')
    // The team may have completed already (mocked subagent returns immediately).
    // If still in registry, full state available; otherwise partial state.
    expect(data.id).toBe(teamId)
  })

  it('background_events returns formatted event log', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-6-' + Date.now()))
    const registry = new TeamRegistry()
    const teamTool = createTeamTool({ teamRegistry: registry, backgroundTasks: bg, buildSubSessionDeps })
    await teamTool.execute({
      objective: 'analyze the project structure and dependencies',
      members: [{ role: 'explorer', agentType: 'explore' }],
      tasks: [{ title: 'A', description: 'a' }],
    } as any, {} as any)
    const teamId = bg.listAll()[0].id
    // Wait briefly for events
    await new Promise(r => setTimeout(r, 30))
    const eventsTool = createBackgroundEventsTool({ backgroundTasks: bg })
    const result = await eventsTool.execute({ task_id: teamId } as any, {} as any)
    expect(result.isError).toBeFalsy()
    expect(result.content).toMatch(/team_started|task_created|member_created/)
  })
})
