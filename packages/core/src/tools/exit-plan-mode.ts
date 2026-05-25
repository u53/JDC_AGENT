import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export type PlanReviewCallback = (planFile: string, content: string) => Promise<{ approved: boolean; feedback?: string }>

export function createExitPlanModeTool(onExit: PlanReviewCallback): ToolHandler {
  return {
    definition: {
      name: 'exit_plan_mode',
      description:
        'Submit your plan for user approval. Only use when planning implementation steps that require writing code — ' +
        'NOT for research tasks. Do NOT use ask_user to ask "is this plan okay?" — that is what THIS tool does.',
      inputSchema: {
        type: 'object',
        properties: {
          planFile: { type: 'string', description: 'Path to the plan file you wrote' },
        },
        required: ['planFile'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const planFile = input.planFile as string
      if (!planFile) {
        return { content: 'Error: planFile is required', isError: true }
      }

      const resolved = path.resolve(context.cwd, planFile)
      let content: string
      try {
        content = await readFile(resolved, 'utf-8')
      } catch {
        return { content: `Error: cannot read plan file at ${resolved}`, isError: true }
      }

      const result = await onExit(resolved, content)
      if (result.approved) {
        return { content: 'Plan approved by user. Proceed with implementation.' }
      } else {
        const feedback = result.feedback ? `\nUser feedback: ${result.feedback}` : ''
        return { content: `Plan rejected by user. Please revise your plan.${feedback}` }
      }
    },
  }
}
