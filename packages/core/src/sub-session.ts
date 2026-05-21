import { v4 as uuid } from 'uuid'
import type { Message, StreamChunk, ModelConfig, ContentBlock, ToolDefinition } from './types.js'
import type { ModelProvider } from './model-provider.js'
import type { ToolRegistry } from './tool-registry.js'
import { ToolRunner } from './tool-runner.js'
import { PermissionChecker } from './permissions.js'
import type { ToolExecutionEvent, PermissionCallback } from './tool-runner.js'
import { getAgentType, filterToolsForAgent, isWriteAllowedForPlanAgent, isBashAllowedForAuditor } from './agent-types.js'

const SUB_AGENT_SYSTEM = `You are a sub-agent executing a specific task. Focus on completing the task efficiently.
You have access to the same tools as the main session.
When done, respond with your final answer as plain text.
Do not ask questions — work with what you have.`

export interface SubSessionOptions {
  prompt: string
  provider: ModelProvider
  toolRegistry: ToolRegistry
  modelConfig: ModelConfig
  cwd: string
  maxTurns?: number
  agentType?: string
  signal?: AbortSignal
  onToolEvent?: (event: ToolExecutionEvent) => void
  onPermissionRequest?: PermissionCallback
  permissionMode?: 'standard' | 'relaxed' | 'strict'
  onAgentProgress?: (event: { toolName: string; toolStatus: 'start' | 'complete' | 'error'; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void
  onAgentText?: (text: string) => void
  mailbox?: { drain(): Array<{ id: string; from: string; content: string; intent?: string; priority: string; createdAt: number }> }
  extraTools?: Array<{ definition: ToolDefinition; execute: (input: Record<string, unknown>, ctx: any) => Promise<{ content: string; isError?: boolean }> }>
}

export interface SubSessionResult {
  content: string
  turns: number
  toolsUsed: string[]
}

export function formatExternalMessages(msgs: Array<{ from: string; content: string; intent?: string; priority: string }>): string {
  return msgs.map(m => {
    const prefix = m.priority === 'urgent' ? '[URGENT] ' : ''
    const intentTag = m.intent ? ` (${m.intent})` : ''
    return `${prefix}[${m.from}]${intentTag}: ${m.content}`
  }).join('\n\n')
}

export async function runSubSession(opts: SubSessionOptions): Promise<SubSessionResult> {
  const {
    prompt,
    provider,
    toolRegistry,
    modelConfig,
    cwd,
    maxTurns = 1000,
    signal,
    onToolEvent,
    onPermissionRequest,
    onAgentProgress,
    onAgentText,
  } = opts

  const agentDef = opts.agentType ? getAgentType(opts.agentType) : undefined
  const effectiveMaxTurns = maxTurns || agentDef?.maxTurns || 1000
  const systemPrompt = agentDef?.systemPrompt || SUB_AGENT_SYSTEM

  const permChecker = new PermissionChecker(opts.permissionMode || 'relaxed')
  const toolRunner = new ToolRunner(toolRegistry, cwd, permChecker, onPermissionRequest)

  // Register extra tools (e.g., team_report for team workers)
  const extraToolMap = new Map<string, (input: Record<string, unknown>, ctx: any) => Promise<{ content: string; isError?: boolean }>>()
  if (opts.extraTools) {
    for (const et of opts.extraTools) {
      extraToolMap.set(et.definition.name, et.execute)
    }
  }

  // Filter out Agent tool to prevent recursion, then add extra tool definitions
  const allDefs = toolRegistry.getDefinitions().filter(t => t.name !== 'Agent')
  const baseDefs = opts.agentType ? filterToolsForAgent(opts.agentType, toolRegistry.getDefinitions()) : allDefs
  const extraDefs = opts.extraTools?.map(et => et.definition) ?? []
  const toolDefs = [...baseDefs, ...extraDefs]

  const messages: Message[] = [
    { id: uuid(), role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() },
  ]
  const toolsUsed: string[] = []
  let totalToolCount = 0
  let turns = 0

  while (turns < effectiveMaxTurns) {
    if (signal?.aborted) break
    turns++

    const incoming = opts.mailbox?.drain() ?? []
    if (incoming.length > 0) {
      const injectedText = formatExternalMessages(incoming)
      messages.push({
        id: uuid(),
        role: 'user',
        content: [{ type: 'text', text: `<external-messages>\n${injectedText}\n</external-messages>` }],
        timestamp: Date.now(),
      })
    }

    let textContent = ''
    let thinkingContent = ''
    const toolUses: { id: string; name: string; input: string }[] = []
    let currentToolUse: { id: string; name: string; input: string } | null = null

    const config: ModelConfig = { ...modelConfig, systemPrompt: systemPrompt }
    const stream = provider.stream(messages, toolDefs, config, signal)

    for await (const chunk of stream) {
      if (chunk.type === 'thinking_delta') thinkingContent += chunk.text || ''
      else if (chunk.type === 'text_delta') textContent += chunk.text || ''
      else if (chunk.type === 'tool_use_start' && chunk.toolUse) {
        currentToolUse = { id: chunk.toolUse.id, name: chunk.toolUse.name, input: '' }
      } else if (chunk.type === 'tool_use_delta' && currentToolUse) {
        currentToolUse.input += chunk.toolUse?.input || chunk.text || ''
      } else if (chunk.type === 'tool_use_end' && currentToolUse) {
        toolUses.push(currentToolUse)
        currentToolUse = null
      }
    }

    // Build assistant message
    const contentBlocks: ContentBlock[] = []
    if (thinkingContent) {
      contentBlocks.push({ type: 'thinking', thinking: thinkingContent } as any)
    }
    if (textContent) {
      contentBlocks.push({ type: 'text', text: textContent })
      onAgentText?.(textContent)
    }
    for (const tu of toolUses) {
      let parsedInput: Record<string, unknown> = {}
      try { parsedInput = JSON.parse(tu.input) } catch { /* empty */ }
      contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: parsedInput })
    }
    if (contentBlocks.length > 0) {
      messages.push({ id: uuid(), role: 'assistant', content: contentBlocks, timestamp: Date.now() })
    }

    // If no tool uses, we're done
    if (toolUses.length === 0) {
      return { content: textContent, turns, toolsUsed: [...new Set(toolsUsed)] }
    }

    // Execute tools and collect results
    const toolResults: ContentBlock[] = []
    for (const tu of toolUses) {
      let parsedInput: Record<string, unknown> = {}
      try { parsedInput = JSON.parse(tu.input) } catch { /* empty */ }
      toolsUsed.push(tu.name)
      totalToolCount++

      onAgentProgress?.({ toolName: tu.name, toolStatus: 'start', toolInput: parsedInput, toolCount: totalToolCount })

      // Handle extra tools (e.g., team_report) directly
      if (extraToolMap.has(tu.name)) {
        const handler = extraToolMap.get(tu.name)!
        const result = await handler(parsedInput, { cwd })
        onAgentProgress?.({
          toolName: tu.name,
          toolStatus: result.isError ? 'error' : 'complete',
          toolInput: parsedInput,
          toolResult: { content: result.content, isError: result.isError },
          toolCount: totalToolCount,
        })
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.isError })
        continue
      }

      // Agent-type-specific restrictions
      if (opts.agentType === 'plan' && tu.name === 'file_write') {
        const writePath = (parsedInput.file_path || parsedInput.path || '') as string
        if (!isWriteAllowedForPlanAgent(writePath, cwd)) {
          const restrictResult = { content: 'Plan agent can only write to .jdcagnet/plans/ directory', isError: true }
          onAgentProgress?.({ toolName: tu.name, toolStatus: 'error', toolInput: parsedInput, toolResult: restrictResult, toolCount: totalToolCount })
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: restrictResult.content, is_error: true })
          continue
        }
      }

      if (opts.agentType === 'security-auditor' && tu.name === 'bash') {
        const cmd = (parsedInput.command || '') as string
        if (!isBashAllowedForAuditor(cmd)) {
          const restrictResult = { content: 'Security auditor bash is restricted to read-only commands', isError: true }
          onAgentProgress?.({ toolName: tu.name, toolStatus: 'error', toolInput: parsedInput, toolResult: restrictResult, toolCount: totalToolCount })
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: restrictResult.content, is_error: true })
          continue
        }
      }

      const noopEvent = (event: ToolExecutionEvent) => { onToolEvent?.(event) }
      const result = await toolRunner.execute(tu.name, tu.id, parsedInput, noopEvent, signal)

      onAgentProgress?.({
        toolName: tu.name,
        toolStatus: result.isError ? 'error' : 'complete',
        toolInput: parsedInput,
        toolResult: { content: result.content, isError: result.isError },
        toolCount: totalToolCount,
      })

      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.isError })
    }
    messages.push({ id: uuid(), role: 'user', content: toolResults, timestamp: Date.now() })
  }

  // Max turns reached — return last assistant text
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const lastText = lastAssistant?.content.find(b => b.type === 'text') as { text: string } | undefined
  return {
    content: lastText?.text || '[Sub-agent reached max turns without final response]',
    turns,
    toolsUsed: [...new Set(toolsUsed)],
  }
}
