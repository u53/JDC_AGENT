import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export type NotifyCallback = (message: string) => void

export function createNotifyTool(onNotify: NotifyCallback): ToolHandler {
  return {
    definition: {
      name: 'notify',
      description:
        'Send a desktop notification to get the user\'s attention. ' +
        'Do NOT notify for routine progress or when the user is clearly watching the conversation. ' +
        'Notify only when: (1) a long task completes while they may be away, (2) they explicitly asked to be notified. ' +
        'Keep message under 200 chars, no markdown. Lead with what they would act on — ' +
        '"build failed: 2 auth tests" is better than "task done".',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Notification body (max 200 chars)' },
        },
        required: ['message'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const message = (input.message as string || '').slice(0, 200)
      if (!message) {
        return { content: 'Error: message is required', isError: true }
      }
      onNotify(message)
      return { content: 'Notification sent.' }
    },
  }
}
