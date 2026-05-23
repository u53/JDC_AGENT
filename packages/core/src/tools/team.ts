import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { TeamRuntime, type TeamRuntimePlan } from '../team/team-runtime.js'
import { TeamRegistry } from '../team/team-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'
import type { TeamMemberSpec, TeamEvent } from '../team/team-types.js'
import type { SubSessionOptions } from '../sub-session.js'
import type { ModelProvider } from '../model-provider.js'
import type { ModelConfig } from '../types.js'
import { routeSkills } from '../team/skill-router.js'
import { renderSkill, type SkillLoader } from '../skills/index.js'

export interface TeamToolDeps {
  teamRegistry: TeamRegistry
  backgroundTasks: BackgroundTaskManager
  buildSubSessionDeps: () => Omit<SubSessionOptions, 'prompt' | 'agentType' | 'signal' | 'onAgentProgress' | 'onAgentText' | 'mailbox' | 'onToolEvent'>
  provider?: ModelProvider
  modelConfig?: ModelConfig
  resolveModel?: (modelId: string) => { provider: ModelProvider; modelConfig: ModelConfig } | null
  /**
   * Lazy accessor for the skill loader. The team tool is registered before
   * the loader is ready, so the deps object holds a thunk that resolves the
   * current loader at the moment a team is created.
   */
  getSkillLoader?: () => SkillLoader | undefined
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
            description:
              'Member specifications. Each member MUST have a distinct role AND a distinct one-sentence responsibility — ' +
              'do NOT submit clones (e.g. three "Code Explorer"s). The responsibility is injected into that member\'s system prompt ' +
              'and shown in the UI, so use it to make each worker focus on a different angle of the objective ' +
              '(different files, different layer, different question, different verification path). ' +
              'If omitted, a small generic team is auto-generated, but you should almost always specify members yourself.',
            items: {
              type: 'object',
              properties: {
                role: {
                  type: 'string',
                  description:
                    'Display role name. Make it specific to what THIS member does, not a generic title. ' +
                    'Good: "Build Config Investigator", "Frontend Layout Owner", "Auth Flow QA". ' +
                    'Bad: "Code Explorer", "Researcher", "Worker 1".',
                },
                responsibility: {
                  type: 'string',
                  description:
                    'One sentence describing what THIS member is responsible for and how they differ from peers. ' +
                    'Mention the specific files/area/question they own. ' +
                    'Example: "排查 packages/electron/build.mjs 的 asar 配置以及 electron-builder 输出, 不碰 UI 层".',
                },
                agentType: { type: 'string', enum: ['explore', 'plan', 'refactor', 'security-auditor', 'frontend-designer', 'general'] },
                modelId: {
                  type: 'string',
                  description: 'Optional model override for this member. Use a configured model ID. If omitted, the member uses the main session model. Useful when you want a specific worker on a stronger or cheaper model.',
                },
              },
              required: ['role', 'responsibility'],
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
            {
              role: 'Lead Investigator',
              responsibility: `Lead the investigation into the objective end-to-end and produce a single coherent report. Objective: ${objective}`,
              agentType: 'explore',
            },
          ]

      const tasks = requestedTasks.length > 0
        ? requestedTasks
        : [{ title: 'Investigate', description: objective }]

      const plan: TeamRuntimePlan = {
        members: members.slice(0, maxWorkers),
        tasks,
      }

      const bgTask = deps.backgroundTasks.registerTeam(objective, plan.members)

      // Route skills (best-effort, fails open). Two slots, at most one skill each:
      //   - pmContent → injected into PM system prompt (dialogue/process methodology)
      //   - workerContent → injected into each worker's task description (execution methodology)
      let pmSkillContent: string | undefined
      let workerSkillContent: string | undefined
      let routerNote: string | undefined
      const skillLoader = deps.getSkillLoader?.()
      if (skillLoader && deps.provider && deps.modelConfig) {
        const skills = skillLoader.getAll()
        if (skills.length > 0) {
          const decision = await routeSkills(objective, skills, {
            provider: deps.provider,
            modelConfig: deps.modelConfig,
          })
          if (decision.pmSkill) {
            const skill = skillLoader.get(decision.pmSkill)
            if (skill) pmSkillContent = renderSkill(skill)
          }
          if (decision.workerSkill) {
            const skill = skillLoader.get(decision.workerSkill)
            if (skill) workerSkillContent = renderSkill(skill)
          }
          if (decision.pmSkill || decision.workerSkill) {
            routerNote = `Skill router: pm=${decision.pmSkill ?? '∅'}, workers=${decision.workerSkill ?? '∅'}${decision.reasoning ? ` — ${decision.reasoning}` : ''}`
          }
        }
      }

      const team = new TeamRuntime({
        id: bgTask.id,
        objective,
        plan,
        archivePath: input.archive_path as string | undefined,
        teamTimeoutMs: typeof timeoutMinutes === 'number' && timeoutMinutes > 0 ? timeoutMinutes * 60_000 : undefined,
        subSessionDeps: deps.buildSubSessionDeps(),
        resolveModel: deps.resolveModel,
        aiPM: deps.provider && deps.modelConfig ? { provider: deps.provider, modelConfig: deps.modelConfig } : undefined,
        skillInjection: { pmContent: pmSkillContent, workerContent: workerSkillContent },
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
          routerNote ? `\n${routerNote}` : '',
          ``,
          `The team runs in the background. The session will push team_progress notifications for major events and a final team_complete notification when it finishes.`,
          `DO NOT poll background_status / background_events on this team id — wait for the notifications. Only query if the user explicitly asks for current state.`,
          `Use background_send <id> to message the team (e.g., wrap_up, hurry, or any text intent).`,
        ].filter(Boolean).join('\n'),
      }
    },
  }
}
