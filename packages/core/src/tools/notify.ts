import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export type NotifyCallback = (message: string) => void

export function createNotifyTool(onNotify: NotifyCallback): ToolHandler {
  return {
    definition: {
      name: 'notify',
      description: 'Send a desktop notification to get the user\'s attention. Use sparingly — only when a long task completes or you need user input while they may be away.',
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
