import type { ToolContext, ToolRegistry, ToolResult } from './tool-registry.js'
import { PermissionChecker } from './permissions.js'
import type { HookEngine } from './hooks/engine.js'
import type { FileTracker } from './file-tracker.js'
import { isPlanModeToolAllowed } from './tools/enter-plan-mode.js'

export interface ToolExecutionEvent {
  type: 'start' | 'progress' | 'complete' | 'error'
  toolName: string
  toolUseId: string
  input?: Record<string, unknown>
  message?: string
  result?: ToolResult
}

export type PermissionCallback = (request: { toolName: string; input: Record<string, unknown> }) => Promise<boolean>

export class ToolRunner {
  private registry: ToolRegistry
  private cwd: string
  private permissionChecker: PermissionChecker
  private onPermissionRequest?: PermissionCallback
  private hookEngine?: HookEngine
  private sessionId?: string
  fileTracker?: FileTracker
  fileReadState?: import('./file-read-state.js').FileReadStateCache
  backgroundTasks?: import('./background-tasks.js').BackgroundTaskManager
  turnIndex = 0
  planMode: 'normal' | 'planning' | 'awaiting_approval' = 'normal'
  planModeCwd?: string

  constructor(
    registry: ToolRegistry,
    cwd: string,
    permissionChecker?: PermissionChecker,
    onPermissionRequest?: PermissionCallback,
    hookEngine?: HookEngine,
    sessionId?: string
  ) {
    this.registry = registry
    this.cwd = cwd
    this.permissionChecker = permissionChecker ?? new PermissionChecker()
    this.onPermissionRequest = onPermissionRequest
    this.hookEngine = hookEngine
    this.sessionId = sessionId
  }

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

    // Permission check
    const decision = this.permissionChecker.check(toolName, input)
    if (decision === 'deny') {
      const result: ToolResult = { content: `Permission denied: ${toolName}`, isError: true }
      onEvent({ type: 'error', toolName, toolUseId, result })
      return result
    }
    if (decision === 'ask') {
      if (!this.onPermissionRequest) {
        const result: ToolResult = { content: `Permission required but no callback provided: ${toolName}`, isError: true }
        onEvent({ type: 'error', toolName, toolUseId, result })
        return result
      }
      const allowed = await this.onPermissionRequest({ toolName, input })
      if (!allowed) {
        this.permissionChecker.recordDenial(toolName, input)
        const result: ToolResult = { content: `Permission denied by user: ${toolName}`, isError: true }
        onEvent({ type: 'error', toolName, toolUseId, result })
        return result
      }
    }

    // Plan mode restriction check
    if (this.planMode === 'planning' && toolName !== 'EnterPlanMode') {
      if (!isPlanModeToolAllowed(toolName, input, this.planModeCwd || this.cwd)) {
        const result: ToolResult = {
          content: `Cannot use ${toolName} in plan mode. Only read operations and writing plan files are allowed.`,
          isError: true,
        }
        onEvent({ type: 'error', toolName, toolUseId, result })
        return result
      }
    }

    onEvent({ type: 'start', toolName, toolUseId, input })

    // PreToolUse hooks
    if (this.hookEngine) {
      const hookOutput = await this.hookEngine.runPreToolUse({
        session_id: this.sessionId || '',
        cwd: this.cwd,
        tool_name: toolName,
        tool_input: input,
      })
      if (hookOutput.decision === 'block') {
        const reason = hookOutput.reason || hookOutput.message || 'no reason given'
        const result: ToolResult = { content: `Blocked by hook: ${reason}`, isError: true }
        onEvent({ type: 'error', toolName, toolUseId, result })
        return result
      }
    }

    const context: ToolContext = {
      cwd: this.cwd,
      signal,
      toolUseId,
      fileTracker: this.fileTracker,
      fileReadState: this.fileReadState,
      turnIndex: this.turnIndex,
      backgroundTasks: this.backgroundTasks,
      onProgress: (message) => {
        onEvent({ type: 'progress', toolName, toolUseId, message })
      },
    }

    try {
      const result = await handler.execute(input, context)

      // PostToolUse hooks
      if (this.hookEngine) {
        await this.hookEngine.runPostToolUse({
          session_id: this.sessionId || '',
          cwd: this.cwd,
          tool_name: toolName,
          tool_input: input,
          tool_result: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
        })
      }

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
