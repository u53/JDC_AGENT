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
        'Ask the user a question when you genuinely cannot proceed without their input. Can provide options for single or multi-select.\n\n' +
        'Only use this when you cannot figure out the answer yourself using tools (file_read, grep, glob). ' +
        'Prefer discovering answers through code exploration over asking. ' +
        'Good uses: choosing between valid approaches, confirming destructive actions, getting preferences. ' +
        'Bad uses: asking what a file contains (just read it), asking where something is defined (just grep for it).\n' +
        'If you recommend a specific option, place it first in the list and append "(Recommended)" to its label.',
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
