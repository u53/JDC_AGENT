import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TeamWorkspace } from '../team/team-workspace.js'
import type {
  ArtifactFrontmatter,
  ResultFrontmatter,
  ContractFrontmatter,
  IssueFrontmatter,
  IssueSeverity,
  IssueStatus,
  TaskStatus,
} from '../team/team-types.js'

export interface TeamArtifactDeps {
  memberId: string
  taskId?: string
  workspace: TeamWorkspace
  /** Optional team mailbox; if set, create_issue will notify the PM. */
  teamMailbox?: { push(msg: any): void }
  /**
   * Called when update_status declares THIS member's own task completed.
   * The runtime uses it to wake the manager state machine, abort the worker's
   * sub-session (so it doesn't keep streaming filler text after declaring done),
   * and pass the summary forward to onComplete without the runtime double-marking
   * the task.
   */
  onSelfComplete?: (summary: string) => void
  /** Same as onSelfComplete but for new_status=failed on the worker's own task. */
  onSelfFail?: (reason: string) => void
}

export function createTeamArtifactTool(deps: TeamArtifactDeps): ToolHandler {
  return {
    definition: {
      name: 'team_artifact',
      description:
        'Persist your work to the team workspace (.team/). ' +
        'create_artifact saves a finding/report/code snippet (summary REQUIRED — one sentence). ' +
        'update_status marks your task completed and writes the final result.md, OR resolves an ISSUE. ' +
        'create_contract locks a shared contract (API schema, data shape, design spec) — once written, ' +
        'downstream tasks see it injected as full text. Use SPARINGLY, only when multiple tasks must align. ' +
        'create_issue files a QA-found bug against another task; PM is auto-notified.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create_artifact', 'update_status', 'create_contract', 'create_issue'],
          },
          // create_artifact
          artifact_id: { type: 'string', description: 'Optional, defaults to <memberId>-<timestamp>' },
          type: {
            type: 'string',
            enum: ['report', 'code', 'design', 'decision', 'data'],
            description: 'Artifact category (default: report)',
          },
          summary: {
            type: 'string',
            description: 'One-sentence summary (REQUIRED for create_artifact / create_contract / create_issue)',
          },
          content: { type: 'string', description: 'Markdown body' },
          // update_status (task or issue)
          target_id: { type: 'string', description: 'e.g. T001 (task) or ISSUE-001 (issue)' },
          new_status: {
            type: 'string',
            enum: [
              'todo', 'assigned', 'running', 'completed', 'failed', 'blocked', 'cancelled', 'reopened',
              'open', 'in_progress', 'resolved', 'wontfix',
            ],
          },
          resolution: { type: 'string', description: 'Resolution note (when resolving an issue)' },
          // create_contract
          contract_name: {
            type: 'string',
            description: 'Short kebab-case name, e.g. api-v1, ui-spec, data-shape',
          },
          related_tasks: { type: 'array', items: { type: 'string' } },
          // create_issue
          issue_title: { type: 'string' },
          on_task: { type: 'string', description: 'taskId where the issue applies (defaults to current task)' },
          related_contract: { type: 'string' },
          severity: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
          },
          // shared
          task_id: { type: 'string', description: 'Override default task scope' },
        },
        required: ['action'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const action = input.action as string
      const taskId = (input.task_id as string) ?? deps.taskId

      try {
        switch (action) {
          case 'create_artifact': {
            if (!taskId) {
              return {
                content: 'Error: no task_id available (worker not assigned to a task)',
                isError: true,
              }
            }
            const summary = ((input.summary as string) ?? '').trim()
            if (!summary) {
              return {
                content: "Error: 'summary' is required for create_artifact (one sentence)",
                isError: true,
              }
            }
            const type = (input.type as ArtifactFrontmatter['type']) ?? 'report'
            const aid =
              (input.artifact_id as string) ??
              `${deps.memberId}-${Date.now().toString(36)}`
            const fm: ArtifactFrontmatter = {
              id: aid,
              type,
              created_by: deps.memberId,
              on_task: taskId,
              summary,
              created_at: new Date().toISOString(),
            }
            await deps.workspace.writeArtifact(taskId, aid, fm, (input.content as string) ?? '')
            await deps.workspace.appendLog(
              `artifact ${aid} by ${deps.memberId} on ${taskId}: ${summary}`,
            )
            return { content: `Artifact saved: tasks/${taskId}/artifacts/${aid}.md` }
          }

          case 'update_status': {
            const target = (input.target_id as string) ?? taskId
            const newStatus = input.new_status as string
            if (!target || !newStatus) {
              return {
                content: 'Error: update_status requires target_id and new_status',
                isError: true,
              }
            }

            // Branch: ISSUE-* targets go to issue updater
            if (target.startsWith('ISSUE-')) {
              const issueStatus = newStatus as IssueStatus
              if (!['open', 'in_progress', 'resolved', 'wontfix'].includes(issueStatus)) {
                return {
                  content: `Error: invalid issue status '${newStatus}'`,
                  isError: true,
                }
              }
              await deps.workspace.updateIssueStatus(
                target,
                issueStatus,
                (input.resolution as string) ?? undefined,
              )
              await deps.workspace.appendLog(
                `issue ${target} -> ${issueStatus} by ${deps.memberId}`,
              )
              return { content: `Issue updated: ${target} -> ${issueStatus}` }
            }

            // Otherwise: task status update
            const taskStatus = newStatus as TaskStatus
            await deps.workspace.updateTaskStatus(target, taskStatus)
            if (taskStatus === 'completed') {
              const summary =
                ((input.summary as string) ?? '').trim() || 'Task completed.'
              const summaries = await deps.workspace.readArtifactSummaries(target)
              const resultFm: ResultFrontmatter = {
                task_id: target,
                completed_by: deps.memberId,
                completed_at: new Date().toISOString(),
                summary,
                artifacts: summaries.map((s) => s.id),
              }
              await deps.workspace.writeResult(
                target,
                resultFm,
                `## Result\n\n${summary}\n`,
              )
              // If the worker is declaring its OWN task done, signal the runtime so
              // it can mark the manager state, abort the sub-session, and stop the
              // model from streaming filler text after the work is logically done.
              if (target === deps.taskId && deps.onSelfComplete) {
                deps.onSelfComplete(summary)
              }
            } else if (taskStatus === 'failed' && target === deps.taskId && deps.onSelfFail) {
              const reason = ((input.summary as string) ?? '').trim() || 'Task self-reported as failed.'
              deps.onSelfFail(reason)
            }
            await deps.workspace.appendLog(
              `status ${target} -> ${taskStatus} by ${deps.memberId}`,
            )
            return { content: `Status updated: ${target} -> ${taskStatus}` }
          }

          case 'create_contract': {
            const name = (input.contract_name as string ?? '').trim()
            if (!name) {
              return { content: "Error: 'contract_name' is required", isError: true }
            }
            if (!taskId) {
              return { content: 'Error: contracts must be created from within a task', isError: true }
            }
            const summary = ((input.summary as string) ?? '').trim()
            if (!summary) {
              return {
                content: "Error: 'summary' is required for create_contract",
                isError: true,
              }
            }
            const existing = await deps.workspace.readContract(name)
            const version = existing ? (existing.frontmatter.version ?? 1) + 1 : 1
            const now = new Date().toISOString()
            const fm: ContractFrontmatter = {
              name,
              version,
              locked_by_task: taskId,
              related_tasks: (input.related_tasks as string[]) ?? [],
              created_at: existing?.frontmatter.created_at ?? now,
              updated_at: now,
            }
            // Prepend an H1 with the contract summary so readers see purpose immediately
            const body = `# Contract: ${name} (v${version})\n\n_${summary}_\n\n${(input.content as string) ?? ''}`
            await deps.workspace.writeContract(name, fm, body)
            await deps.workspace.appendLog(
              `contract ${name} v${version} locked by ${taskId} (${deps.memberId}): ${summary}`,
            )
            return {
              content: `Contract locked: contracts/${name}.md (v${version}). Downstream tasks must comply.`,
            }
          }

          case 'create_issue': {
            const title = ((input.issue_title as string) ?? '').trim()
            if (!title) {
              return { content: "Error: 'issue_title' is required", isError: true }
            }
            const summary = ((input.summary as string) ?? '').trim() || title
            const onTask = (input.on_task as string) ?? taskId
            if (!onTask) {
              return { content: "Error: 'on_task' is required (which task does this issue apply to?)", isError: true }
            }
            const severity = (input.severity as IssueSeverity) ?? 'medium'
            const issueId = await deps.workspace.nextIssueId()
            const now = new Date().toISOString()
            const fm: IssueFrontmatter = {
              id: issueId,
              title,
              status: 'open',
              severity,
              opened_by: deps.memberId,
              on_task: onTask,
              related_contract: (input.related_contract as string) ?? undefined,
              assigned_to: null,
              opened_at: now,
              resolved_at: null,
            }
            const body =
              `## Summary\n\n${summary}\n\n` +
              `## Reproduction / Evidence\n\n${(input.content as string) ?? '(see details)'}\n`
            await deps.workspace.writeIssue(issueId, fm, body)
            await deps.workspace.appendLog(
              `issue ${issueId} opened by ${deps.memberId} on ${onTask} (${severity}): ${title}`,
            )
            // Notify PM via mailbox so it can decide on rework
            if (deps.teamMailbox) {
              deps.teamMailbox.push({
                id: `report_${Date.now().toString(36)}`,
                from: 'member',
                fromMemberId: deps.memberId,
                to: 'manager',
                intent: 'finding',
                content:
                  `[ISSUE ${issueId} severity:${severity}] ${title}\n` +
                  `On task: ${onTask}\n` +
                  `Path: .team/issues/${issueId}.md\n` +
                  `Decide: reopen ${onTask} (assign original author), reassign to a new worker, or mark wontfix.`,
                priority: severity === 'critical' ? 'urgent' : severity === 'high' ? 'high' : 'normal',
                createdAt: Date.now(),
              })
            }
            return {
              content: `Issue filed: ${issueId} (${severity}) on ${onTask}. PM notified.`,
            }
          }

          default:
            return { content: `Error: unknown action '${action}'`, isError: true }
        }
      } catch (err) {
        return {
          content: `team_artifact error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    },
  }
}
