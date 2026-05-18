import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { ToolRegistry } from '../tool-registry.js'
import type { ModelProvider } from '../model-provider.js'
import type { ModelConfig } from '../types.js'
import type { ToolExecutionEvent, PermissionCallback } from '../tool-runner.js'
import { runSubSession } from '../sub-session.js'

export interface AgentToolDeps {
  provider: ModelProvider
  toolRegistry: ToolRegistry
  modelConfig: ModelConfig
  cwd: string
  onToolEvent?: (event: ToolExecutionEvent) => void
  onPermissionRequest?: PermissionCallback
  isSubAgent?: boolean
  resolveModel?: (modelId: string) => { provider: ModelProvider; modelConfig: ModelConfig } | null
  onAgentProgress?: (agentToolUseId: string, event: { toolName: string; toolStatus: 'start' | 'complete' | 'error'; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void
  onAgentText?: (agentToolUseId: string, text: string) => void
  onAgentComplete?: (agentToolUseId: string, result: { content: string; turns: number; toolsUsed: string[] }) => void
  agentAbortControllers?: Map<string, AbortController>
}

export function createAgentTool(deps: AgentToolDeps): ToolHandler {
  return {
    definition: {
      name: 'Agent',
      description:
        'Dispatch a sub-agent to handle a task independently. Available types:\n' +
        '- explore: Fast read-only search for locating code (no modifications)\n' +
        '- plan: Analyze code and write implementation plans\n' +
        '- refactor: Improve code structure without changing behavior (no bash)\n' +
        '- security-auditor: Analyze code for vulnerabilities\n' +
        '- frontend-designer: Convert designs into components\n' +
        '- general: Full tool access for complex multi-step tasks (default)',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The task description for the sub-agent' },
          type: {
            type: 'string',
            enum: ['explore', 'plan', 'refactor', 'security-auditor', 'frontend-designer', 'general'],
            description: 'The type of specialized agent to use (default: general)',
          },
          modelId: { type: 'string', description: 'Model ID to use for this sub-agent (from configured models). Defaults to current session model.' },
          maxTurns: { type: 'number', description: 'Maximum conversation turns (default: 1000)' },
        },
        required: ['prompt'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      if (deps.isSubAgent) {
        return { content: 'Sub-agents cannot dispatch further sub-agents.', isError: true }
      }

      const prompt = input.prompt as string
      const maxTurns = (input.maxTurns as number) || 1000
      const agentType = (input.type as string) || 'general'
      const requestedModelId = input.modelId as string | undefined
      const toolUseId = context.toolUseId || 'unknown'

      let effectiveProvider = deps.provider
      let effectiveModelConfig = deps.modelConfig

      if (requestedModelId && deps.resolveModel) {
        const resolved = deps.resolveModel(requestedModelId)
        if (resolved) {
          effectiveProvider = resolved.provider
          effectiveModelConfig = resolved.modelConfig
        }
      }

      const agentAbort = new AbortController()
      deps.agentAbortControllers?.set(toolUseId, agentAbort)

      const onParentAbort = () => agentAbort.abort()
      context.signal?.addEventListener('abort', onParentAbort)
      if (context.signal?.aborted) {
        agentAbort.abort()
      }

      try {
        const result = await runSubSession({
          prompt,
          provider: effectiveProvider,
          toolRegistry: deps.toolRegistry,
          modelConfig: effectiveModelConfig,
          cwd: deps.cwd,
          maxTurns,
          agentType,
          signal: agentAbort.signal,
          onToolEvent: deps.onToolEvent,
          onPermissionRequest: deps.onPermissionRequest,
          onAgentProgress: (event) => deps.onAgentProgress?.(toolUseId, event),
          onAgentText: (text) => deps.onAgentText?.(toolUseId, text),
        })

        deps.onAgentComplete?.(toolUseId, result)
        return { content: result.content }
      } catch (error) {
        return {
          content: `Sub-agent error: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        }
      } finally {
        deps.agentAbortControllers?.delete(toolUseId)
        context.signal?.removeEventListener('abort', onParentAbort)
      }
    },
  }
}
