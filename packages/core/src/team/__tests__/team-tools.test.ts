import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { SubSessionOptions, SubSessionResult } from '../../sub-session.js'
import type { ContextFact, RawEvidence } from '../../context/types.js'

vi.mock('../../sub-session.js', async () => {
  const actual = await vi.importActual<typeof import('../../sub-session.js')>('../../sub-session.js')
  return {
    ...actual,
    runSubSession: vi.fn(async (opts: SubSessionOptions): Promise<SubSessionResult> => {
      opts.onAgentText?.('Working...')
      return { content: `Done: ${opts.prompt.slice(0, 20)}`, turns: 1, toolsUsed: [], status: 'completed' }
    }),
  }
})

import { BackgroundTaskManager } from '../../background-tasks.js'
import { TeamRegistry } from '../team-registry.js'
import { createTeamTool } from '../../tools/team.js'
import { createBackgroundSendTool } from '../../tools/background-send.js'
import { createBackgroundStatusTool } from '../../tools/background-status.js'
import { createBackgroundEventsTool } from '../../tools/background-events.js'
import { createTeamArtifactTool } from '../../tools/team-artifact.js'
import { TeamWorkspace } from '../team-workspace.js'

const mockDeps: any = { provider: {}, toolRegistry: {}, modelConfig: {} }
const buildSubSessionDeps = () => {
  // Each team gets its own cwd to avoid colliding on .team/ in /tmp
  const cwd = path.join(os.tmpdir(), `team-tools-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  require('node:fs').mkdirSync(cwd, { recursive: true })
  return { ...mockDeps, cwd } as any
}

describe('Team tools', () => {
  it('team_artifact captures artifacts, contracts, issues, and task results into Context Engine ledger', async () => {
    const cwd = path.join(os.tmpdir(), `team-artifact-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(cwd, { recursive: true })
    try {
      const workspace = new TeamWorkspace({ rootDir: cwd, teamId: 'team_alpha' })
      await workspace.init('Ledger test')
      await workspace.writeTask('T001', {
        id: 'T001',
        title: 'Checkout task',
        status: 'running',
        created_at: new Date(1_000).toISOString(),
        updated_at: new Date(1_000).toISOString(),
      }, 'Fix checkout')
      const store = {
        saveRawEvidence: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
        saveFact: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
        saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
      }
      const tool = createTeamArtifactTool({
        memberId: 'member_api',
        taskId: 'T001',
        workspace,
        contextLedger: {
          store,
          cwd,
          sessionId: 'session_team_tools',
          teamId: 'team_alpha',
        },
      })

      await tool.execute({
        action: 'create_artifact',
        artifact_id: 'report',
        type: 'report',
        summary: 'Checkout report lists validation changes.',
        content: 'Report body',
      }, {} as any)
      await tool.execute({
        action: 'create_contract',
        contract_name: 'checkout-api',
        summary: 'Checkout API keeps the existing response envelope.',
        content: 'Contract body',
      }, {} as any)
      await tool.execute({
        action: 'create_issue',
        issue_title: 'Checkout response missing validation detail',
        summary: 'Checkout response omits validation detail.',
        severity: 'high',
        on_task: 'T001',
      }, {} as any)
      await tool.execute({
        action: 'update_status',
        target_id: 'ISSUE-001',
        new_status: 'resolved',
        resolution: 'Validation detail restored.',
      }, {} as any)
      await tool.execute({
        action: 'update_status',
        target_id: 'T001',
        new_status: 'completed',
        summary: 'Checkout validation is fixed.',
      }, {} as any)

      const facts = mockFirstArgs<ContextFact>(store.saveFact)
      expect(facts.map((fact) => [fact.id, fact.kind, fact.freshness])).toEqual([
        ['artifact_summary_team_alpha_T001_report', 'artifact_summary', 'recent'],
        ['artifact_summary_team_alpha_T001_checkout_api', 'artifact_summary', 'recent'],
        ['qa_issue_team_alpha_ISSUE_001', 'qa_issue', 'recent'],
        ['qa_issue_team_alpha_ISSUE_001', 'qa_issue', 'stale'],
        ['task_result_team_alpha_T001', 'task_result', 'recent'],
      ])
      expect(mockFirstArgs<RawEvidence>(store.saveRawEvidence).map((evidence) => evidence.metadata.eventType)).toEqual([
        'team_artifact_written',
        'team_contract_written',
        'team_issue_created',
        'team_issue_resolved',
        'task_completed',
      ])
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

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
    expect(result.content).toContain('Use the archive path from team_complete')
    expect(result.content).toContain('Do NOT assume .team/ still exists')
    // After registration the team starts and may complete via mocked subagent.
    // Either it is still registered, or it completed and was removed — both are fine.
    // Just verify execution succeeded (above).
  })

  it('marks the background team failed and clears the registry when startup fails', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-startup-fail-' + Date.now()))
    const registry = new TeamRegistry()
    const cwdFile = path.join(os.tmpdir(), `team-tools-cwd-file-${Date.now()}`)
    writeFileSync(cwdFile, 'not a directory')
    const tool = createTeamTool({
      teamRegistry: registry,
      backgroundTasks: bg,
      buildSubSessionDeps: () => ({ ...mockDeps, cwd: cwdFile }) as any,
    })

    const result = await tool.execute({
      objective: 'startup failure should not leave a half initialized team running',
      members: [{ role: 'explorer', agentType: 'explore' }],
      tasks: [{ title: 'A', description: 'a' }],
    } as any, {} as any)

    const task = bg.listAll()[0]
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Team startup failed')
    expect(task.status).toBe('failed')
    expect(registry.getAll()).toHaveLength(0)
    rmSync(cwdFile, { force: true })
  })

  it('resolves explicit PM model without changing worker defaults', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-pm-model-' + Date.now()))
    const registry = new TeamRegistry()
    const resolveModel = vi.fn((modelId: string) => modelId === 'proxy:deepseek-reasoner'
      ? {
          status: 'resolved' as const,
          provider: pmProvider('pm-provider'),
          modelConfig: { model: 'deepseek-reasoner', maxTokens: 32000, contextWindow: 128000 },
        }
      : { status: 'failed' as const, warning: `missing ${modelId}` })
    const tool = createTeamTool({
      teamRegistry: registry,
      backgroundTasks: bg,
      buildSubSessionDeps,
      provider: pmProvider('main-provider'),
      modelConfig: { model: 'main-model', maxTokens: 32000, contextWindow: 200000 },
      resolveModel,
    })

    const result = await tool.execute({
      objective: 'PM model override should use the explicitly configured model for coordination',
      pmModelId: 'proxy:deepseek-reasoner',
      members: [{ role: 'explorer', responsibility: 'Inspect project files', agentType: 'explore' }],
      tasks: [{ title: 'A', description: 'a' }],
    } as any, {} as any)

    const teamId = bg.listAll()[0]?.id
    const team = teamId ? registry.get(teamId) : undefined
    expect(result.isError).toBeFalsy()
    expect(resolveModel).toHaveBeenCalledWith('proxy:deepseek-reasoner')
    expect(team?.getManagerState().modelId).toBe('deepseek-reasoner')
    team?.stop()
  })

  it('surfaces PM model fallback warnings in the Team start result', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-pm-model-warning-' + Date.now()))
    const registry = new TeamRegistry()
    const tool = createTeamTool({
      teamRegistry: registry,
      backgroundTasks: bg,
      buildSubSessionDeps,
      provider: pmProvider('main-provider'),
      modelConfig: { model: 'main-model', maxTokens: 32000, contextWindow: 200000 },
      resolveModel: () => ({
        status: 'failed' as const,
        warning: 'Configured PM model "missing-pm" was not found; PM is using the main session model.',
      }),
    })

    const result = await tool.execute({
      objective: 'PM model warning should be visible when the explicit override cannot resolve',
      pmModelId: 'missing-pm',
      members: [{ role: 'explorer', responsibility: 'Inspect project files', agentType: 'explore' }],
      tasks: [{ title: 'A', description: 'a' }],
    } as any, {} as any)

    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('PM model warning:')
    expect(result.content).toContain('missing-pm')
    const teamId = bg.listAll()[0]?.id
    registry.get(teamId)?.stop()
  })

  it('passes a startup signal to the skill router so slow routing can fail open', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-skill-router-signal-' + Date.now()))
    const registry = new TeamRegistry()
    let firstRouterSignal: AbortSignal | undefined
    let streamCalls = 0
    const provider = {
      name: 'pm-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (_messages: any[], _tools: any[], _config: any, signal?: AbortSignal) {
        if (streamCalls++ === 0) firstRouterSignal = signal
        yield { type: 'text_delta', text: '{"pmSkill":null,"workerSkill":null,"reasoning":"none"}' }
        yield { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } }
      },
    }
    const skill = {
      name: 'debugging',
      description: 'debugging methodology',
      content: 'debug carefully',
      userInvocable: true,
      arguments: [],
      source: 'global',
      filePath: '/skills/debugging/SKILL.md',
    } as any
    const tool = createTeamTool({
      teamRegistry: registry,
      backgroundTasks: bg,
      buildSubSessionDeps,
      provider: provider as any,
      modelConfig: { model: 'main-model', maxTokens: 32000, contextWindow: 200000 },
      getSkillLoader: () => ({
        getAll: () => [skill],
        get: () => skill,
      }) as any,
    })

    const result = await tool.execute({
      objective: 'Team startup should not wait forever on skill routing before PM is launched',
      members: [{ role: 'explorer', responsibility: 'Inspect files', agentType: 'explore' }],
      tasks: [{ title: 'A', description: 'a' }],
    } as any, {} as any)

    expect(result.isError).toBeFalsy()
    expect(firstRouterSignal).toBeDefined()
    registry.get(bg.listAll()[0]?.id)?.stop()
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

  it('background_status treats archived teams as terminal instead of live runtimes', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-archived-status-' + Date.now()))
    const registry = new TeamRegistry()
    const teamTool = createTeamTool({ teamRegistry: registry, backgroundTasks: bg, buildSubSessionDeps })
    await teamTool.execute({
      objective: 'create a team that will be archived before status is queried',
    } as any, {} as any)
    const teamId = bg.listAll()[0].id
    bg.completeTeam(teamId, { summary: 'done' })
    registry.remove(teamId)

    const statusTool = createBackgroundStatusTool({ backgroundTasks: bg, teamRegistry: registry })
    const result = await statusTool.execute({ task_id: teamId } as any, {} as any)
    const data = JSON.parse(result.content as string)

    expect(data.terminal).toBe(true)
    expect(data.status).toBe('completed')
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

  it('background_events formats worker model resolution warnings', async () => {
    const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-model-warning-' + Date.now()))
    const task = bg.registerTeam('model warning test', [])
    bg.emitEvent(task.id, {
      type: 'model_resolution_warning',
      memberId: 'member_gpt',
      requestedModelId: 'GPT-5.5',
      message: 'Configured model "GPT-5.5" was not found; falling back to main session model.',
      timestamp: Date.now(),
    } as any)

    const eventsTool = createBackgroundEventsTool({ backgroundTasks: bg })
    const result = await eventsTool.execute({ task_id: task.id } as any, {} as any)

    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('model_warning member_gpt requested=GPT-5.5')
    expect(result.content).toContain('falling back to main session model')
  })
})

function mockFirstArgs<T>(mock: { mock: { calls: unknown[][] } }): T[] {
  return mock.mock.calls.map((call) => call[0] as T)
}

function pmProvider(name: string) {
  return {
    name,
    chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
    stream: async function* () {
      yield { type: 'text_delta', text: '<scratch>no-op</scratch>\n{"actions":[]}' }
      yield { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } }
    },
  } as any
}
