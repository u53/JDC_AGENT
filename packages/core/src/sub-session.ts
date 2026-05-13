import { v4 as uuid } from 'uuid'
import type { Message, StreamChunk, ModelConfig, ContentBlock, ToolDefinition } from './types.js'
import type { ModelProvider } from './model-provider.js'
import type { ToolRegistry } from './tool-registry.js'
import { ToolRunner } from './tool-runner.js'
import { PermissionChecker } from './permissions.js'
import type { ToolExecutionEvent, PermissionCallback } from './tool-runner.js'

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
  signal?: AbortSignal
  onToolEvent?: (event: ToolExecutionEvent) => void
  onPermissionRequest?: PermissionCallback
  permissionMode?: 'standard' | 'relaxed' | 'strict'
}

export interface SubSessionResult {
  content: string
  turns: number
  toolsUsed: string[]
}

export async function runSubSession(opts: SubSessionOptions): Promise<SubSessionResult> {
  const {
    prompt,
    provider,
    toolRegistry,
    modelConfig,
    cwd,
    maxTurns = 25,
    signal,
    onToolEvent,
    onPermissionRequest,
  } = opts

  const permChecker = new PermissionChecker(opts.permissionMode || 'relaxed')
  const toolRunner = new ToolRunner(toolRegistry, cwd, permChecker, onPermissionRequest)

  // Filter out Agent tool to prevent recursion
  const toolDefs = toolRegistry.getDefinitions().filter(t => t.name !== 'Agent')

  const messages: Message[] = [
    { id: uuid(), role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() },
  ]
  const toolsUsed: string[] = []
  let turns = 0

  while (turns < maxTurns) {
    if (signal?.aborted) break
    turns++

    let textContent = ''
    const toolUses: { id: string; name: string; input: string }[] = []
    let currentToolUse: { id: string; name: string; input: string } | null = null

    const config: ModelConfig = { ...modelConfig, systemPrompt: SUB_AGENT_SYSTEM }
    const stream = provider.stream(messages, toolDefs, config, signal)

    for await (const chunk of stream) {
      if (chunk.type === 'text_delta') textContent += chunk.text || ''
      if (chunk.type === 'tool_use_start' && chunk.toolUse) {
        currentToolUse = { id: chunk.toolUse.id, name: chunk.toolUse.name, input: '' }
      }
      if (chunk.type === 'tool_use_delta' && currentToolUse) {
        currentToolUse.input += chunk.text || ''
      }
      if (chunk.type === 'tool_use_end' && currentToolUse) {
        toolUses.push(currentToolUse)
        currentToolUse = null
      }
    }

    // Build assistant message
    const contentBlocks: ContentBlock[] = []
    if (textContent) contentBlocks.push({ type: 'text', text: textContent })
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
      const noopEvent = (event: ToolExecutionEvent) => { onToolEvent?.(event) }
      const result = await toolRunner.execute(tu.name, tu.id, parsedInput, noopEvent, signal)
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
