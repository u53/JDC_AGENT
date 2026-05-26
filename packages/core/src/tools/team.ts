import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { TeamRuntime, type TeamRuntimePlan } from '../team/team-runtime.js'
import { TeamRegistry } from '../team/team-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'
import type { TeamMemberSpec, TeamEvent } from '../team/team-types.js'
import { resolveExpertPrompt } from '../team/expert-prompts.js'
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
  /** Bubble all team-side LLM consumption (PM + workers + skill router) up to host. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number }) => void
}

export function createTeamTool(deps: TeamToolDeps): ToolHandler {
  return {
    definition: {
      name: 'Team',
      description:
        'IMPORTANT: Before calling this tool, you MUST have completed the Pre-Team Intake Protocol ' +
        '(clarify objective with user → get confirmation — or meet skip conditions). ' +
        'If you have not done this, STOP and go back to the user first. ' +
        'Create a multi-agent team to work on a complex objective collaboratively. ' +
        'Use this when the user says "开个团队", "team", "组个团队", "多人协作", or when a task benefits from multiple agents working in parallel with coordination. ' +
        'Prefer Team over multiple Agent calls when: (1) the user explicitly asks for a team, (2) the task has 3+ subtasks that benefit from parallel execution, or (3) the task needs coordination between workers. ' +
        'IMPORTANT: Only ONE running team is allowed per session. If a team is already active, this tool will return an error — wrap_up the existing team first (use background_send with intent="wrap_up"), then create a new one. ' +
        'The team has an AI PM that AUTONOMOUSLY decides staffing, task breakdown, and assignment. ' +
        'You only need to provide the objective — do NOT plan members or tasks yourself unless the user explicitly specifies them. ' +
        'The PM handles all coordination: hiring workers, decomposing work, assigning tasks, quality control, and synthesis. ' +
        'Use background_send to message the team, background_status to check progress, ' +
        'background_events to view detailed events, team_list to see all teams. The team runs as a background task. ' +
        'CRITICAL — DELEGATION CONTRACT: once you create the team, the team OWNS the objective. ' +
        'You MUST NOT silently redo the team\'s work yourself in parallel. ' +
        'After this tool returns: STOP working on the delegated objective. Wait for the team_complete notification, then USE the team\'s synthesized output as the source of truth. ' +
        'You may: (a) idle until team_complete arrives, (b) work on clearly-unrelated user requests, (c) relay PM messages / status to the user when asked. ' +
        'You may NOT: pre-emptively write files the team is supposed to produce, run your own version of the team\'s analysis, or "tick off" your own todos that map to the team\'s tasks. ' +
        'IMPORTANT: After creating the team, DO NOT poll background_status / background_events in a loop. ' +
        'The session pushes team_progress notifications for major events and a final team_complete notification when the team finishes — wait for those instead of polling. ' +
        'Only call background_status / background_events when the user explicitly asks for current state or when you have a concrete reason (e.g., user pressed wrap_up and asked you to confirm).',
      inputSchema: {
        type: 'object',
        properties: {
          objective: { type: 'string', description: 'The only required field. Describe the concrete deliverable in 1-3 sentences. The PM uses this to decide staffing and task breakdown autonomously.' },
          members: {
            type: 'array',
            description:
              'Optional member hints. If omitted or empty, the PM autonomously decides what roles to hire based on the objective. ' +
              'Only provide members when you have specific knowledge about what specialists are needed. ' +
              'If provided, each member MUST have a distinct role AND a distinct one-sentence responsibility. ' +
              'Set expertPrompt for each member to define their work patterns (use preset keys: backend, frontend, frontend-ui, qa, devops, database, security, architect, or custom text).',
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
                expertPrompt: {
                  type: 'string',
                  description:
                    'Domain expertise for this worker. Two options:\n' +
                    '1. Preset key (short): backend, frontend, frontend-ui, qa, devops, database, security, architect\n' +
                    '2. Custom text (PREFERRED for specific projects): write 2-3 sentences describing the worker\'s exact expertise, ' +
                    'tech stack, and quality standards for THIS project. Example: "React 18 + TypeScript specialist. ' +
                    'Uses functional components with hooks, Zustand for state, Tailwind for styling. ' +
                    'Tests with React Testing Library. Follows existing component patterns in src/components/."\n' +
                    'Custom text produces MUCH better results than preset keys because it\'s project-specific. ' +
                    'Use presets only when you don\'t know the project\'s tech stack yet.',
                },
                modelId: {
                  type: 'string',
                  description: 'Optional model override for this member. ONLY set this when the user explicitly asked for a different model. Omitting it (the default) makes the member inherit the main session model + reasoning effort — that is what the user configured. Do NOT guess a model name from training memory; if the ID is not configured locally the override is rejected and falls back anyway.',
                },
              },
              required: ['role', 'responsibility'],
            },
          },
          tasks: {
            type: 'array',
            description:
              'Optional task hints. If omitted or empty, the PM autonomously decomposes the objective into tasks. ' +
              'Only provide tasks when you have a clear breakdown the PM should follow. ' +
              'PARALLEL BY DEFAULT — only add dependsOn when task B literally needs the OUTPUT of task A. ' +
              'If two tasks work on DIFFERENT files/modules, they MUST be parallel (no dependsOn). ' +
              'NEVER let test tasks run in parallel with the code they test.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                dependsOn: { type: 'array', items: { type: 'string' }, description: 'Titles of tasks that must complete before this one starts. Use to enforce phase ordering.' },
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

      const objectiveText = (input.objective as string || '').trim()
      if (objectiveText.length < 15) {
        return {
          content: `Error: objective is too vague (${objectiveText.length} chars). The Pre-Team Intake Protocol requires you to clarify the objective with the user before calling this tool. A good objective is 1-2 sentences describing the concrete deliverable.`,
          isError: true,
        }
      }

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

      // Resolve expertPrompt for each member (preset key → full text, custom → pass through)
      // Smart auto-assign: scan responsibility/role for domain keywords if expertPrompt not provided
      const AGENT_TYPE_TO_EXPERT: Record<string, string> = {
        'general': 'backend',
        'explore': 'architect',
        'refactor': 'backend',
        'security-auditor': 'security',
        'frontend-designer': 'frontend-ui',
      }
      function inferExpertFromContext(role: string, responsibility?: string): string {
        const text = `${role} ${responsibility || ''}`.toLowerCase()
        if (/\b(test|qa|验证|测试|vitest|jest|testing)\b/.test(text)) return 'qa'
        if (/\b(frontend|前端|react|vue|ui|component|页面|css|tailwind)\b/.test(text)) return 'frontend'
        if (/\b(security|安全|audit|vulnerability|漏洞)\b/.test(text)) return 'security'
        if (/\b(database|数据库|sql|migration|schema|prisma|knex)\b/.test(text)) return 'database'
        if (/\b(devops|ci|cd|docker|deploy|部署|infrastructure)\b/.test(text)) return 'devops'
        if (/\b(architect|架构|design|设计文档)\b/.test(text)) return 'architect'
        if (/\b(backend|后端|api|express|server|endpoint|路由)\b/.test(text)) return 'backend'
        return 'backend'
      }
      const resolvedMembers: TeamMemberSpec[] = requestedMembers.map(m => {
        const prompt = m.expertPrompt || inferExpertFromContext(m.role, m.responsibility) || AGENT_TYPE_TO_EXPERT[m.agentType || 'general']
        return { ...m, expertPrompt: resolveExpertPrompt(prompt) }
      })

      const tasks = requestedTasks

      const plan: TeamRuntimePlan = {
        members: resolvedMembers.slice(0, maxWorkers),
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
            onUsage: deps.onUsage,
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
        onUsage: deps.onUsage,
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

      const members = team.getMembers()
      const memberLines = members.length > 0
        ? members.map(m => `  - ${m.role} (${m.agentType})`).join('\n')
        : '  (PM will hire workers autonomously)'
      const taskLines = (plan.tasks ?? []).length > 0
        ? (plan.tasks ?? []).map((t: any) => `  - ${t.title ?? t.description ?? '(unnamed task)'}`).join('\n')
        : ''
      return {
        content: [
          `Team created and started.`,
          `Team ID: ${bgTask.id}`,
          `Objective: ${objective}`,
          members.length > 0 ? `Initial members:\n${memberLines}` : `The PM is now planning staffing and task breakdown autonomously.`,
          taskLines ? `Initial tasks (hints):\n${taskLines}` : '',
          routerNote ? `\n${routerNote}` : '',
          ``,
          `HANDOFF CONTRACT — IMPORTANT:`,
          `  • The objective now belongs to the team. Do NOT analyze, draft, or write outputs in parallel.`,
          `  • Wait for the team_complete notification, then base your follow-up work on the team's synthesized result.`,
          `  • If the user pings you while the team is running, relay status / forward intents via background_send. Do not pre-empt the team.`,
          `  • You can still handle user requests that are clearly unrelated to the delegated objective.`,
          ``,
          `The team runs in the background. The session will push team_progress notifications for major events and a final team_complete notification when it finishes.`,
          `DO NOT poll background_status / background_events on this team id — wait for the notifications. Only query if the user explicitly asks for current state.`,
          `Use background_send <id> to message the team (e.g., wrap_up, hurry, or any text intent).`,
        ].filter(Boolean).join('\n'),
      }
    },
  }
}
