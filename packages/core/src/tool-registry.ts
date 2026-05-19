import type { ToolDefinition } from './types.js'

export interface ToolHandler {
  definition: ToolDefinition
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
}

export interface ToolContext {
  cwd: string
  signal?: AbortSignal
  onProgress?: (message: string) => void
  toolUseId?: string
  fileTracker?: import('./file-tracker.js').FileTracker
  fileReadState?: import('./file-read-state.js').FileReadStateCache
  turnIndex?: number
  backgroundTasks?: import('./background-tasks.js').BackgroundTaskManager
  ideManager?: import('./ide/ide-manager.js').IdeManager
}

export interface ToolResult {
  content: string
  isError?: boolean
}

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>()

  register(handler: ToolHandler): void {
    this.tools.set(handler.definition.name, handler)
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name)
  }

  getAll(): ToolHandler[] {
    return Array.from(this.tools.values())
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map(h => h.definition)
  }
}
