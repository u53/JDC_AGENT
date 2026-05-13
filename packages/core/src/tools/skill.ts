import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { SkillLoader } from '../skills/loader.js'
import { renderSkill } from '../skills/loader.js'

export function createSkillTool(loader: SkillLoader): ToolHandler {
  return {
    definition: {
      name: 'Skill',
      description: 'Invoke a skill by name. Skills are reusable instruction templates loaded from .jdcagnet/skills/. Use this to activate specialized workflows.',
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
