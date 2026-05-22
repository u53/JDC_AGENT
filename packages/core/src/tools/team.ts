import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { TeamRuntime, type TeamRuntimePlan } from '../team/team-runtime.js'
import { TeamRegistry } from '../team/team-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'
import type { TeamMemberSpec, TeamEvent } from '../team/team-types.js'
import type { SubSessionOptions } from '../sub-session.js'
import type { ModelProvider } from '../model-provider.js'
import type { ModelConfig } from '../types.js'

export interface TeamToolDeps {
  teamRegistry: TeamRegistry
  backgroundTasks: BackgroundTaskManager
  buildSubSessionDeps: () => Omit<SubSessionOptions, 'prompt' | 'agentType' | 'signal' | 'onAgentProgress' | 'onAgentText' | 'mailbox' | 'onToolEvent'>
  provider?: ModelProvider
  modelConfig?: ModelConfig
  onTeamEvent?: (teamId: string, event: TeamEvent) => void
}

export function createTeamTool(deps: TeamToolDeps): ToolHandler {
  return {
    definition: {
      name: 'Team',
      description:
        'Create a multi-agent team to work on a complex objective collaboratively. ' +
        'Use this when the user says "开个团队", "team", "组个团队", "多人协作", or when a task benefits from multiple agents working in parallel with coordination. ' +
        'Prefer Team over multiple Agent calls when: (1) the user explicitly asks for a team, (2) the task has 3+ subtasks that benefit from parallel execution, or (3) the task needs coordination between workers. ' +
        'IMPORTANT: Only ONE running team is allowed per session. If a team is already active, this tool will return an error — wrap_up the existing team first (use background_send with intent="wrap_up"), then create a new one. ' +
        'The team has a PM that assigns tasks, coordinates members, and synthesizes results. ' +
        'Use background_send to message the team, background_status to check progress, ' +
        'background_events to view detailed events, team_list to see all teams. The team runs as a background task. ' +
        'IMPORTANT: After creating the team, DO NOT poll background_status / background_events in a loop. ' +
        'The session pushes team_progress notifications for major events and a final team_complete notification when the team finishes — wait for those instead of polling. ' +
        'Only call background_status / background_events when the user explicitly asks for current state or when you have a concrete reason (e.g., user pressed wrap_up and asked you to confirm).',
      inputSchema: {
        type: 'object',
        properties: {
          objective: { type: 'string', description: 'High-level goal for the team' },
          members: {
            type: 'array',
            description: 'Member specifications. If omitted, default team is auto-generated.',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', description: 'Display role name (e.g., "Code Explorer")' },
                count: { type: 'number', description: 'Number of members with this role (default: 1)' },
                agentType: { type: 'string', enum: ['explore', 'plan', 'refactor', 'security-auditor', 'frontend-designer', 'general'] },
                modelId: { type: 'string' },
              },
              required: ['role'],
            },
          },
          tasks: {
            type: 'array',
            description: 'Initial tasks for the team. Each task has a title and description.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                dependsOn: { type: 'array', items: { type: 'string' } },
              },
              required: ['title', 'description'],
            },
          },
          maxWorkers: { type: 'number', description: 'Maximum worker count (hard cap: 10, default: 5)' },
          timeoutMinutes: {
            type: 'number',
            description: 'Idle timeout in minutes — team is killed if NO member has activity for this long. Heartbeat-based, so active teams are never killed. Default: 60.',
          },
          archive_path: {
            type: 'string',
            description: 'Optional: where to put archived workspaces (default: <cwd>/.team-archive)',
          },
        },
        required: ['objective'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const objective = input.objective as string

      // One running team per session: reject if there's already a running team.
      // Archived (completed/failed) teams don't count.
      const activeTeams = deps.teamRegistry.getAll().filter(t => {
        const status = t.getStatus()
        return status !== 'completed' && status !== 'failed' && status !== 'stopped'
      })
      if (activeTeams.length > 0) {
        const existing = activeTeams[0]
        return {
          content: [
            `Error: this session already has an active team.`,
            ``,
            `  Team ID: ${existing.id}`,
            `  Objective: ${existing.objective}`,
            `  Status: ${existing.getStatus()}`,
            ``,
            `Only one running team is allowed per session. Wrap up the existing team first:`,
            `  - background_send with intent="wrap_up" to finish gracefully`,
            `  - or wait for it to complete naturally`,
            `Then create a new team. Use team_list to see all teams (including archived).`,
          ].join('\n'),
          isError: true,
        }
      }

      const requestedMembers = (input.members as TeamMemberSpec[] | undefined) ?? []
      const requestedTasks = (input.tasks as any[] | undefined) ?? []
      const maxWorkers = Math.min((input.maxWorkers as number | undefined) ?? 5, 10)
      const timeoutMinutes = input.timeoutMinutes as number | undefined

      const members: TeamMemberSpec[] = requestedMembers.length > 0
        ? requestedMembers
        : [
            { role: 'Code Explorer', agentType: 'explore', count: 2 },
            { role: 'Architect', agentType: 'plan' },
            { role: 'Reviewer', agentType: 'security-auditor' },
          ]

      const tasks = requestedTasks.length > 0
        ? requestedTasks
        : [{ title: 'Investigate', description: objective }]

      const plan: TeamRuntimePlan = {
        members: members.slice(0, maxWorkers),
        tasks,
      }

      const bgTask = deps.backgroundTasks.registerTeam(objective, plan.members)

      const team = new TeamRuntime({
        id: bgTask.id,
        objective,
        plan,
        archivePath: input.archive_path as string | undefined,
        teamTimeoutMs: typeof timeoutMinutes === 'number' && timeoutMinutes > 0 ? timeoutMinutes * 60_000 : undefined,
        subSessionDeps: deps.buildSubSessionDeps(),
        aiPM: deps.provider && deps.modelConfig ? { provider: deps.provider, modelConfig: deps.modelConfig } : undefined,
        onEvent: (e) => {
          deps.backgroundTasks.emitEvent(bgTask.id, e)
          deps.onTeamEvent?.(bgTask.id, e)
        },
        onComplete: (summary) => {
          deps.backgroundTasks.completeTeam(bgTask.id, { summary })
          deps.teamRegistry.remove(bgTask.id)
        },
        onFail: (err) => {
          deps.backgroundTasks.failTeam(bgTask.id, err)
          deps.teamRegistry.remove(bgTask.id)
        },
      })

      deps.teamRegistry.register(team)
      await team.start()

      const memberLines = team.getMembers().map(m => `  - ${m.role} (${m.agentType})`).join('\n')
      return {
        content: [
          `Team created and started.`,
          `Team ID: ${bgTask.id}`,
          `Objective: ${objective}`,
          `Members:`,
          memberLines,
          ``,
          `The team runs in the background. The session will push team_progress notifications for major events and a final team_complete notification when it finishes.`,
          `DO NOT poll background_status / background_events on this team id — wait for the notifications. Only query if the user explicitly asks for current state.`,
          `Use background_send <id> to message the team (e.g., wrap_up, hurry, or any text intent).`,
        ].join('\n'),
      }
    },
  }
}
