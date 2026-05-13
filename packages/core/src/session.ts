import { v4 as uuid } from 'uuid'
import type { Message, SessionConfig, StreamChunk } from './types.js'
import type { ModelProvider } from './model-provider.js'
import { ToolRegistry } from './tool-registry.js'
import { ToolRunner, type ToolExecutionEvent, type PermissionCallback } from './tool-runner.js'
import { registerBuiltinTools } from './tools/index.js'
import { ConversationHistory } from './history.js'
import { assembleSystemPrompt } from './context.js'
import { PermissionChecker } from './permissions.js'
import { TaskStore } from './task-store.js'
import { createTaskCreateTool } from './tools/task-create.js'
import { createTaskGetTool } from './tools/task-get.js'
import { createTaskListTool } from './tools/task-list.js'
import { createTaskUpdateTool } from './tools/task-update.js'
import { createTaskStopTool } from './tools/task-stop.js'
import { createTodoWriteTool } from './tools/todo-write.js'

export interface SessionEvents {
  onStreamChunk: (chunk: StreamChunk) => void
  onToolEvent: (event: ToolExecutionEvent) => void
  onMessageComplete: (message: Message) => void
  onError: (error: Error) => void
}

export class Session {
  readonly id: string
  readonly config: SessionConfig
  private messages: Message[] = []
  private provider: ModelProvider
  private toolRunner: ToolRunner
  private toolRegistry: ToolRegistry
  private history: ConversationHistory
  private taskStore = new TaskStore()
  private abortController: AbortController | null = null

  constructor(config: SessionConfig, provider: ModelProvider, history: ConversationHistory, onPermissionRequest?: PermissionCallback) {
    this.id = config.id
    this.config = config
    this.provider = provider
    this.history = history
    this.toolRegistry = new ToolRegistry()
    registerBuiltinTools(this.toolRegistry)
    this.toolRegistry.register(createTaskCreateTool(this.taskStore))
    this.toolRegistry.register(createTaskGetTool(this.taskStore))
    this.toolRegistry.register(createTaskListTool(this.taskStore))
    this.toolRegistry.register(createTaskUpdateTool(this.taskStore))
    this.toolRegistry.register(createTaskStopTool(this.taskStore))
    this.toolRegistry.register(createTodoWriteTool(this.taskStore))
    this.toolRunner = new ToolRunner(this.toolRegistry, config.cwd, new PermissionChecker(), onPermissionRequest)
  }

  registerTool(handler: import('./tool-registry.js').ToolHandler): void {
    this.toolRegistry.register(handler)
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  loadHistory(): void {
    this.messages = this.history.getMessages(this.id)
  }

  async sendMessage(text: string, events: SessionEvents, extraContent?: import('./types.js').ContentBlock[]): Promise<void> {
    // Assemble system prompt with current tool list
    const toolNames = this.toolRegistry.getDefinitions().map(d => d.name)
    this.config.modelConfig.systemPrompt = await assembleSystemPrompt({
      cwd: this.config.cwd,
      toolNames,
    })

    const content: import('./types.js').ContentBlock[] = [{ type: 'text', text }]
    if (extraContent && extraContent.length > 0) {
      content.push(...extraContent)
    }

    const userMessage: Message = {
      id: uuid(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    this.messages.push(userMessage)
    this.history.addMessage(this.id, userMessage)

    await this.runLoop(events)
  }

  private async runLoop(events: SessionEvents): Promise<void> {
    this.abortController = new AbortController()

    while (true) {
      const assistantContent: any[] = []
      let hasToolUse = false

      for await (const chunk of this.provider.stream(
        this.messages,
        this.toolRegistry.getDefinitions(),
        this.config.modelConfig,
        this.abortController.signal
      )) {
        events.onStreamChunk(chunk)

        if (chunk.type === 'text_delta' && chunk.text) {
          const last = assistantContent[assistantContent.length - 1]
          if (last?.type === 'text') {
            last.text += chunk.text
          } else {
            assistantContent.push({ type: 'text', text: chunk.text })
          }
        } else if (chunk.type === 'tool_use_start' && chunk.toolUse) {
          hasToolUse = true
          assistantContent.push({ type: 'tool_use', id: chunk.toolUse.id, name: chunk.toolUse.name, input: {} })
        } else if (chunk.type === 'tool_use_delta' && chunk.toolUse) {
          const last = assistantContent[assistantContent.length - 1]
          if (last?.type === 'tool_use') {
            last._rawInput = (last._rawInput || '') + chunk.toolUse.input
          }
        } else if (chunk.type === 'tool_use_end') {
          const last = assistantContent[assistantContent.length - 1]
          if (last?.type === 'tool_use' && last._rawInput) {
            try { last.input = JSON.parse(last._rawInput) } catch { last.input = {} }
            delete last._rawInput
          }
        }
      }

      const assistantMessage: Message = {
        id: uuid(),
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
      }
      this.messages.push(assistantMessage)
      this.history.addMessage(this.id, assistantMessage)
      events.onMessageComplete(assistantMessage)

      if (!hasToolUse) break

      const toolResults: any[] = []
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          const result = await this.toolRunner.execute(
            block.name, block.id, block.input, events.onToolEvent, this.abortController!.signal
          )
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.content, is_error: result.isError })
        }
      }

      const toolMessage: Message = {
        id: uuid(),
        role: 'user',
        content: toolResults,
        timestamp: Date.now(),
      }
      this.messages.push(toolMessage)
      this.history.addMessage(this.id, toolMessage)
    }

    this.abortController = null
  }

  abort(): void {
    this.abortController?.abort()
  }
}
