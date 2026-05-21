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
        'The team has a PM that assigns tasks, coordinates members, and synthesizes results. ' +
        'Use background_send to message the team, background_status to check progress, ' +
        'background_events to view detailed events. The team runs as a background task.',
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
        },
        required: ['objective'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const objective = input.objective as string
      const requestedMembers = (input.members as TeamMemberSpec[] | undefined) ?? []
      const requestedTasks = (input.tasks as any[] | undefined) ?? []
      const maxWorkers = Math.min((input.maxWorkers as number | undefined) ?? 5, 10)

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
      team.start()

      const memberLines = team.getMembers().map(m => `  - ${m.role} (${m.agentType})`).join('\n')
      return {
        content: [
          `Team created and started.`,
          `Team ID: ${bgTask.id}`,
          `Objective: ${objective}`,
          `Members:`,
          memberLines,
          ``,
          `Use background_status, background_events, or background_send with this team ID to interact.`,
        ].join('\n'),
      }
    },
  }
}
