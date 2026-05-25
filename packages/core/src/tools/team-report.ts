import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { Mailbox } from '../team/team-mailbox.js'

export interface TeamReportDeps {
  memberId: string
  teamMailbox: { push(msg: any): void }
  onReport?: (memberId: string, report: { type: string; content: string }) => void
}

export function createTeamReportTool(deps: TeamReportDeps): ToolHandler {
  return {
    definition: {
      name: 'team_report',
      description:
        'Send a real-time message to the PM (findings, questions, blockers, progress). ' +
        'Use for ephemeral communication that needs PM attention NOW. ' +
        'For persistent deliverables, use team_artifact instead. ' +
        'For bugs found during QA, use team_artifact create_issue (not this tool).',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['finding', 'question', 'blocker', 'progress', 'handoff'],
            description: 'Type of report',
          },
          content: { type: 'string', description: 'Report content' },
          severity: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'Severity (for findings/blockers)',
          },
        },
        required: ['type', 'content'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const type = input.type as string
      const content = input.content as string
      const severity = (input.severity as string) ?? 'medium'

      deps.teamMailbox.push({
        id: `report_${Date.now().toString(36)}`,
        from: 'member',
        fromMemberId: deps.memberId,
        to: 'manager',
        intent: type === 'question' ? 'question' : 'finding',
        content: `[${type.toUpperCase()}${severity !== 'medium' ? ` severity:${severity}` : ''}] ${content}`,
        priority: severity === 'critical' ? 'urgent' : severity === 'high' ? 'high' : 'normal',
        createdAt: Date.now(),
      })

      deps.onReport?.(deps.memberId, { type, content })
      return { content: `Report sent to PM: [${type}] ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}` }
    },
  }
}
