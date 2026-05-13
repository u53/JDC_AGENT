import type { ToolContext, ToolRegistry, ToolResult } from './tool-registry.js'

export interface ToolExecutionEvent {
  type: 'start' | 'progress' | 'complete' | 'error'
  toolName: string
  toolUseId: string
  message?: string
  result?: ToolResult
}

export class ToolRunner {
  constructor(
    private registry: ToolRegistry,
    private cwd: string
  ) {}

  async execute(
    toolName: string,
    toolUseId: string,
    input: Record<string, unknown>,
    onEvent: (event: ToolExecutionEvent) => void,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    const handler = this.registry.get(toolName)
    if (!handler) {
      const result: ToolResult = { content: `Unknown tool: ${toolName}`, isError: true }
      onEvent({ type: 'error', toolName, toolUseId, result })
      return result
    }

    onEvent({ type: 'start', toolName, toolUseId })

    const context: ToolContext = {
      cwd: this.cwd,
      signal,
      onProgress: (message) => {
        onEvent({ type: 'progress', toolName, toolUseId, message })
      },
    }

    try {
      const result = await handler.execute(input, context)
      onEvent({ type: 'complete', toolName, toolUseId, result })
      return result
    } catch (error) {
      const result: ToolResult = {
        content: error instanceof Error ? error.message : String(error),
        isError: true,
      }
      onEvent({ type: 'error', toolName, toolUseId, result })
      return result
    }
  }
}
