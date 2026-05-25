import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { SkillLoader } from '../skills/loader.js'
import { renderSkill } from '../skills/loader.js'

export function createSkillTool(loader: SkillLoader): ToolHandler {
  return {
    definition: {
      name: 'Skill',
      description:
        'Execute a skill within the current conversation. Skills provide specialized workflows and domain knowledge.\n\n' +
        'Rules:\n' +
        '- Only invoke skills listed in the "Available Skills" system prompt section\n' +
        '- Never guess or invent a skill name — if unsure, the error message will list available skills\n' +
        '- When a user types /<name> or their request clearly matches a skill\'s purpose, invoke it BEFORE generating other responses\n' +
        '- Do not re-invoke a skill that is already active in this turn\n' +
        '- Set args to pass user-provided arguments after the skill name',
      inputSchema: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'The skill name to invoke' },
          args: { type: 'string', description: 'Optional arguments for the skill' },
        },
        required: ['skill'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const name = input.skill as string
      const args = input.args as string | undefined
      const skill = loader.get(name)
      if (!skill) {
        const available = loader.getAll().map(s => s.name).join(', ')
        return { content: `Unknown skill: "${name}". Available skills: ${available || 'none'}`, isError: true }
      }
      const rendered = renderSkill(skill, args)
      return { content: `[Skill: ${name}]\n\n${rendered}` }
    },
  }
}
