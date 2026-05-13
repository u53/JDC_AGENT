import { v4 as uuid } from 'uuid'
import type { Message, ModelConfig, SessionConfig, StreamChunk } from './types.js'
import type { ModelProvider } from './model-provider.js'
import { ToolRegistry } from './tool-registry.js'
import { ToolRunner, type ToolExecutionEvent, type PermissionCallback } from './tool-runner.js'
import { registerBuiltinTools } from './tools/index.js'
import { ConversationHistory } from './history.js'
import { assembleSystemPrompt } from './context.js'
import { PermissionChecker } from './permissions.js'
import { TaskStore } from './task-store.js'
import { estimateTokens } from './token-estimation.js'
import { compactMessages } from './compact.js'
import { createTaskCreateTool } from './tools/task-create.js'
import { createTaskGetTool } from './tools/task-get.js'
import { createTaskListTool } from './tools/task-list.js'
import { createTaskUpdateTool } from './tools/task-update.js'
import { createTaskStopTool } from './tools/task-stop.js'
import { createTodoWriteTool } from './tools/todo-write.js'
import { McpManager } from './mcp/manager.js'
import { createMcpToolHandler } from './mcp/mcp-tool-handler.js'
import { createListMcpResourcesTool } from './tools/list-mcp-resources.js'
import { createReadMcpResourceTool } from './tools/read-mcp-resource.js'
import { loadHookConfig, HookEngine } from './hooks/index.js'
import { SkillLoader } from './skills/loader.js'
import { createSkillTool } from './tools/skill.js'
import { createAgentTool } from './tools/agent.js'

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
  private mcpManager?: McpManager
  private hookEngine?: HookEngine
  private hooksReady: Promise<void>
  private skillLoader: SkillLoader
  private skillsReady: Promise<void>
  private permissionChecker: PermissionChecker

  constructor(config: SessionConfig, provider: ModelProvider, history: ConversationHistory, onPermissionRequest?: PermissionCallback, mcpManager?: McpManager) {
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
    this.mcpManager = mcpManager
    if (mcpManager) {
      const mcpTools = mcpManager.getTools()
      for (const tool of mcpTools) {
        const serverName = tool.name.split('__')[1]
        const toolName = tool.name.split('__').slice(2).join('__')
        this.toolRegistry.register(createMcpToolHandler(
          serverName,
          { name: toolName, description: tool.description, inputSchema: tool.inputSchema },
          mcpManager
        ))
      }
      this.toolRegistry.register(createListMcpResourcesTool(mcpManager))
      this.toolRegistry.register(createReadMcpResourceTool(mcpManager))
    }
    // Initialize ToolRunner without hooks first (will be updated once hooks load)
    this.permissionChecker = new PermissionChecker()
    this.toolRunner = new ToolRunner(this.toolRegistry, config.cwd, this.permissionChecker, onPermissionRequest)

    // Asynchronously load hooks and rebuild ToolRunner
    this.hooksReady = this.initHooks(onPermissionRequest)

    // Asynchronously load skills and register SkillTool
    this.skillLoader = new SkillLoader()
    this.skillsReady = this.initSkills()

    // Register AgentTool for sub-agent dispatch
    this.toolRegistry.register(createAgentTool({
      provider: this.provider,
      toolRegistry: this.toolRegistry,
      modelConfig: this.config.modelConfig,
      cwd: this.config.cwd,
      onToolEvent: undefined,
      onPermissionRequest,
      isSubAgent: false,
    }))
  }

  private async initHooks(onPermissionRequest?: PermissionCallback): Promise<void> {
    try {
      const hookConfig = await loadHookConfig(this.config.cwd)
      this.hookEngine = new HookEngine(hookConfig)
      this.toolRunner = new ToolRunner(
        this.toolRegistry,
        this.config.cwd,
        this.permissionChecker,
        onPermissionRequest,
        this.hookEngine,
        this.id
      )
    } catch {
      // Hooks are optional — if loading fails, continue without them
    }
  }

  async ensureHooksReady(): Promise<void> {
    await this.hooksReady
  }

  private async initSkills(): Promise<void> {
    try {
      await this.skillLoader.loadAll(this.config.cwd)
      this.toolRegistry.register(createSkillTool(this.skillLoader))
    } catch {
      // Skills are optional — if loading fails, continue without them
    }
  }

  async ensureSkillsReady(): Promise<void> {
    await this.skillsReady
  }

  getSkillLoader(): SkillLoader {
    return this.skillLoader
  }

  setPermissionMode(mode: import('./permissions.js').PermissionMode): void {
    this.permissionChecker.setMode(mode)
  }

  updateProvider(provider: ModelProvider, modelConfig: ModelConfig): void {
    this.provider = provider
    this.config.modelConfig = { ...this.config.modelConfig, ...modelConfig }
  }

  setThinking(enabled: boolean, budget?: number): void {
    this.config.modelConfig.thinking = enabled
    if (budget !== undefined) this.config.modelConfig.thinkingBudget = budget
  }

  clearMessages(): void {
    this.messages = []
  }

  async compactNow(events: SessionEvents): Promise<void> {
    if (this.messages.length < 4) return
    await this.compact(events)
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
    await this.ensureHooksReady()
    await this.ensureSkillsReady()

    // Assemble system prompt with current tool list
    const toolDefs = this.toolRegistry.getDefinitions()
    const toolNames = toolDefs.map(d => d.name)
    const mcpServers = this.mcpManager?.getServerStates()
      .filter(s => s.status === 'connected')
      .map(s => ({ name: s.name, toolCount: s.tools.length, tools: s.tools.map(t => t.name) }))

    this.config.modelConfig.systemPrompt = await assembleSystemPrompt({
      cwd: this.config.cwd,
      toolDefs,
      toolNames,
      mcpServers,
      skills: this.skillLoader.getAll().map(s => ({ name: s.name, description: s.description })),
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

  private shouldCompact(): boolean {
    const compressAt = this.config.modelConfig.maxTokens * 0.8
    return estimateTokens(this.messages) > compressAt
  }

  private async compact(events: SessionEvents): Promise<void> {
    events.onStreamChunk({ type: 'text_delta', text: '\n[Compressing context...]\n' })
    this.messages = await compactMessages(this.messages, this.provider, this.config.modelConfig, events.onStreamChunk)
  }

  private async runLoop(events: SessionEvents): Promise<void> {
    this.abortController = new AbortController()

    if (this.shouldCompact()) {
      await this.compact(events)
    }

    while (true) {
      const assistantContent: any[] = []
      let hasToolUse = false

      try {
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
      } catch (streamErr: any) {
        console.error('[STREAM ERROR]', streamErr.message, streamErr.stack)
        events.onError(streamErr)
        break
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
