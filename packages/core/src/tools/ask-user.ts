import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export type AskUserCallback = (
  question: string,
  options?: { label: string; description?: string }[],
  multiSelect?: boolean
) => Promise<string>

export function createAskUserTool(onAskUser: AskUserCallback): ToolHandler {
  return {
    definition: {
      name: 'ask_user',
      description:
        'Ask the user a question. Can provide options for single or multi-select.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' },
              },
            },
            description: 'Options for the user to choose from',
          },
          multiSelect: {
            type: 'boolean',
            description: 'Allow multiple selections',
          },
        },
        required: ['question'],
      },
    },
    async execute(
      input: Record<string, unknown>,
      _context: ToolContext
    ): Promise<ToolResult> {
      const question = input.question as string
      const options = input.options as
        | { label: string; description?: string }[]
        | undefined
      const multiSelect = input.multiSelect as boolean | undefined
      try {
        const answer = await onAskUser(question, options, multiSelect)
        return { content: answer }
      } catch (err: any) {
        return { content: `User did not respond: ${err.message}`, isError: true }
      }
    },
  }
}
