import { v4 as uuid } from 'uuid'
import path from 'node:path'
import type { Message, ModelConfig, SessionConfig, StreamChunk } from './types.js'
import type { ModelProvider } from './model-provider.js'
import { ToolRegistry } from './tool-registry.js'
import { ToolRunner, type ToolExecutionEvent, type PermissionCallback } from './tool-runner.js'
import { registerBuiltinTools } from './tools/index.js'
import { ConversationHistory } from './history.js'
import { assembleSystemPrompt, getMemoryDir } from './context.js'
import { loadAppConfig, getConfigDir } from './config.js'
import { PermissionChecker } from './permissions.js'
import { TaskStore } from './task-store.js'
import { estimateTokens } from './token-estimation.js'
import { compactMessages } from './compact.js'
import { parseMemories, saveMemories } from './memory-extractor.js'
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
import { createEnterPlanModeTool, isPlanModeToolAllowed } from './tools/enter-plan-mode.js'
import { createExitPlanModeTool } from './tools/exit-plan-mode.js'
import { createAgentTool } from './tools/agent.js'
import { classifyError, getMaxRetries, getRetryDelay } from './retry.js'
import { UsageTracker, type UsageSnapshot } from './usage-tracker.js'
import { FileTracker } from './file-tracker.js'
import { ParallelExecutor } from './parallel-executor.js'
import { BackgroundTaskManager } from './background-tasks.js'
import { createTaskOutputTool } from './tools/task-output.js'
import { monitorTool } from './tools/monitor.js'

export interface SessionEvents {
  onStreamChunk: (chunk: StreamChunk) => void
  onToolEvent: (event: ToolExecutionEvent) => void
  onMessageComplete: (message: Message) => void
  onError: (error: Error) => void
  onRetrying?: (attempt: number, error: Error, delayMs: number, category: string) => void
  onUsage?: (snapshot: UsageSnapshot) => void
  onAgentProgress?: (agentToolUseId: string, event: { toolName: string; toolStatus: 'start' | 'complete' | 'error'; toolInput?: Record<string, unknown>; toolResult?: { content: string; isError?: boolean }; toolCount: number }) => void
  onAgentText?: (agentToolUseId: string, text: string) => void
  onAgentComplete?: (agentToolUseId: string, result: { content: string; turns: number; toolsUsed: string[] }) => void
}

export class Session {
  readonly id: string
  readonly config: SessionConfig
  private messages: Message[] = []
  private provider: ModelProvider
  private toolRunner: ToolRunner
  private parallelExecutor: ParallelExecutor
  private toolRegistry: ToolRegistry
  private history: ConversationHistory
  private taskStore!: TaskStore
  private abortController: AbortController | null = null
  private mcpManager?: McpManager
  private hookEngine?: HookEngine
  private hooksReady: Promise<void>
  private skillLoader: SkillLoader
  private skillsReady: Promise<void>
  private permissionChecker: PermissionChecker
  private agentAbortControllers = new Map<string, AbortController>()
  private currentEvents?: SessionEvents
  private usageTracker: UsageTracker
  private fileTracker: FileTracker
  private backgroundTasks: BackgroundTaskManager
  private turnIndex = 0
  private planMode: 'normal' | 'planning' | 'awaiting_approval' = 'normal'
  private onPlanReview?: (planFile: string, content: string) => Promise<{ approved: boolean; feedback?: string }>
  resolveModel?: (modelId: string) => { provider: ModelProvider; modelConfig: ModelConfig } | null
  ideContext?: { filePath?: string; text?: string; selection?: { start: { line: number }; end: { line: number } } | null }

  constructor(
    config: SessionConfig,
    provider: ModelProvider,
    history: ConversationHistory,
    onPermissionRequest?: PermissionCallback,
    mcpManager?: McpManager,
    onPlanReview?: (planFile: string, content: string) => Promise<{ approved: boolean; feedback?: string }>
  ) {
    this.id = config.id
    this.config = config
    this.provider = provider
    this.history = history
    this.usageTracker = new UsageTracker(config.modelConfig.contextWindow || 200000)
    this.fileTracker = new FileTracker(history, config.id)
    this.taskStore = new TaskStore(history, config.id)
    this.backgroundTasks = new BackgroundTaskManager(path.join(getConfigDir(), 'tasks'))
    this.onPlanReview = onPlanReview
    this.toolRegistry = new ToolRegistry()
    registerBuiltinTools(this.toolRegistry)
    this.toolRegistry.register(createTaskCreateTool(this.taskStore))
    this.toolRegistry.register(createTaskGetTool(this.taskStore))
    this.toolRegistry.register(createTaskListTool(this.taskStore))
    this.toolRegistry.register(createTaskUpdateTool(this.taskStore))
    this.toolRegistry.register(createTaskStopTool(this.taskStore))
    this.toolRegistry.register(createTodoWriteTool(this.taskStore))
    this.toolRegistry.register(createTaskOutputTool(this.backgroundTasks))
    this.toolRegistry.register(monitorTool)
    this.toolRegistry.register(createEnterPlanModeTool(() => {
      this.planMode = 'planning'
      this.toolRunner.planMode = 'planning'
    }))
    this.toolRegistry.register(createExitPlanModeTool(async (planFile, content) => {
      this.planMode = 'awaiting_approval'
      this.toolRunner.planMode = 'awaiting_approval'
      if (!this.onPlanReview) {
        this.planMode = 'normal'
        this.toolRunner.planMode = 'normal'
        return { approved: true }
      }
      const result = await this.onPlanReview(planFile, content)
      this.planMode = result.approved ? 'normal' : 'planning'
      this.toolRunner.planMode = this.planMode
      return result
    }))
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
    this.permissionChecker = new PermissionChecker('standard', config.cwd)
    this.toolRunner = new ToolRunner(this.toolRegistry, config.cwd, this.permissionChecker, onPermissionRequest)
    this.toolRunner.fileTracker = this.fileTracker
    this.toolRunner.backgroundTasks = this.backgroundTasks
    this.toolRunner.planModeCwd = this.config.cwd
    this.parallelExecutor = new ParallelExecutor(this.toolRunner)

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
      resolveModel: (modelId: string) => this.resolveModel?.(modelId) ?? null,
      onAgentProgress: (agentToolUseId, event) => {
        this.currentEvents?.onAgentProgress?.(agentToolUseId, event)
      },
      onAgentText: (agentToolUseId, text) => {
        this.currentEvents?.onAgentText?.(agentToolUseId, text)
      },
      onAgentComplete: (agentToolUseId, result) => {
        this.currentEvents?.onAgentComplete?.(agentToolUseId, result)
      },
      agentAbortControllers: this.agentAbortControllers,
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
      this.toolRunner.fileTracker = this.fileTracker
      this.toolRunner.backgroundTasks = this.backgroundTasks
      this.toolRunner.planModeCwd = this.config.cwd
      this.parallelExecutor = new ParallelExecutor(this.toolRunner)
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
    if (modelConfig.contextWindow) {
      this.usageTracker.setContextWindow(modelConfig.contextWindow)
    }
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
    this.abortController = new AbortController()
    try {
      await this.compact(events)
    } finally {
      this.abortController = null
    }
  }

  registerTool(handler: import('./tool-registry.js').ToolHandler): void {
    this.toolRegistry.register(handler)
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getUsageSnapshot(): UsageSnapshot | null {
    const snapshot = this.usageTracker.getSnapshot()
    return snapshot.turnCount > 0 ? snapshot : null
  }

  getFileTracker(): FileTracker {
    return this.fileTracker
  }

  getPlanMode(): string {
    return this.planMode
  }

  setPlanMode(mode: 'normal' | 'planning'): void {
    this.planMode = mode
    this.toolRunner.planMode = mode
  }

  loadHistory(): void {
    this.messages = this.history.getMessages(this.id)
    const usageData = this.history.getUsage(this.id)
    if (usageData) {
      this.usageTracker.restore(usageData)
    }
  }

  async sendMessage(text: string, events: SessionEvents, extraContent?: import('./types.js').ContentBlock[]): Promise<void> {
    await this.ensureHooksReady()
    await this.ensureSkillsReady()

    // Assemble system prompt with current tool list
    const toolDefs = this.toolRegistry.getDefinitions()
    const toolNames = toolDefs.map(d => d.name)
    const mcpServers = this.mcpManager?.getServerStates()
      .filter(s => s.status === 'connected')
      .map(s => ({ name: s.name, toolCount: s.tools.length, tools: s.tools.map(t => t.name), instructions: s.instructions }))

    const appConfig = loadAppConfig()
    this.config.modelConfig.systemPrompt = await assembleSystemPrompt({
      cwd: this.config.cwd,
      toolDefs,
      toolNames,
      mcpServers,
      skills: this.skillLoader.getAll().map(s => ({ name: s.name, description: s.description, argumentHint: s.argumentHint })),
      language: appConfig.language,
      customInstructions: appConfig.customInstructions,
    })

    // Inject active tasks into context
    const activeTasks = this.history.getActiveTasks(this.id)
    if (activeTasks.length > 0 && Array.isArray(this.config.modelConfig.systemPrompt)) {
      const taskLines = activeTasks.map(t => `- [${t.status}] #${t.id}: ${t.subject}`).join('\n')
      this.config.modelConfig.systemPrompt.push({
        content: `<tasks>\nCurrent tasks for this session:\n${taskLines}\n</tasks>`,
        cacheable: false,
      })
    }

    // Inject available models for sub-agent dispatch
    const modelGroups = appConfig.modelGroups
    if (modelGroups?.groups && Array.isArray(this.config.modelConfig.systemPrompt)) {
      const modelLines: string[] = []
      for (const group of modelGroups.groups) {
        if (group.models?.length) {
          for (const m of group.models) {
            const active = m.id === modelGroups.activeModelId ? ' (current)' : ''
            modelLines.push(`- ${m.name} [modelId: "${m.modelId}"]${active}`)
          }
        }
      }
      if (modelLines.length > 0) {
        this.config.modelConfig.systemPrompt.push({
          content: `<available-models>\nWhen dispatching sub-agents via the Agent tool, you can specify a modelId to use a different model. Available models:\n${modelLines.join('\n')}\nIf the user asks to use a specific model for a sub-agent, pass its modelId value.\n</available-models>`,
          cacheable: false,
        })
      }
    }

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
    this.history.addMessage(this.id, userMessage)

    // Inject IDE context into the live message only (not saved to history)
    if (this.ideContext) {
      let ideInfo = ''
      if (this.ideContext.text && this.ideContext.selection) {
        ideInfo = `<ide-context>\nThe user has the following code selected in their IDE (${this.ideContext.filePath}, lines ${this.ideContext.selection.start.line}-${this.ideContext.selection.end.line}):\n\`\`\`\n${this.ideContext.text}\n\`\`\`\n</ide-context>`
      } else if (this.ideContext.filePath) {
        ideInfo = `<ide-context>\nThe user's IDE currently has this file open: ${this.ideContext.filePath}\n</ide-context>`
      }
      if (ideInfo) {
        userMessage.content = [...content, { type: 'text', text: ideInfo }]
      }
      this.ideContext = undefined
    }

    this.messages.push(userMessage)
    await this.runLoop(events)
  }

  private shouldCompact(): boolean {
    const compressAt = this.config.modelConfig.compressAt || 0.9
    if (this.usageTracker.shouldCompact(compressAt)) return true
    // Fallback: character-based estimate for first turn (no API data yet)
    const contextWindow = this.config.modelConfig.contextWindow || 200000
    const tokenEstimate = estimateTokens(this.messages)
    return tokenEstimate > contextWindow * compressAt
  }

  private microCompact(): void {
    const snapshot = this.usageTracker.getSnapshot()
    if (snapshot.contextUsedPercent < 60) return

    const cutoff = this.messages.length - 10
    for (let i = 0; i < cutoff; i++) {
      const msg = this.messages[i]
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j]
        if (block.type === 'tool_result' && !block.is_error && block.content.length > 500) {
          const removed = block.content.length - 200
          msg.content[j] = { ...block, content: block.content.slice(0, 200) + `\n[...truncated, ${removed} chars]` }
        }
      }
    }
  }

  private async compact(events: SessionEvents): Promise<void> {
    events.onStreamChunk({ type: 'text_delta', text: '\n[Compressing context...]\n' })
    const result = await compactMessages(this.messages, this.provider, this.config.modelConfig, events.onStreamChunk, this.abortController?.signal)
    if (this.abortController?.signal.aborted) return
    this.messages = result.messages
    this.history.replaceMessages(this.id, this.messages)

    // Extract and save memories
    let memoriesExtracted = 0
    if (result.rawOutput) {
      const memories = parseMemories(result.rawOutput)
      if (memories.length > 0) {
        const memDir = getMemoryDir(this.config.cwd)
        memoriesExtracted = await saveMemories(memories, memDir, this.id)
      }
    }

    // Emit compact_complete
    events.onStreamChunk({
      type: 'compact_complete',
      compactInfo: {
        originalCount: result.originalCount,
        keptCount: result.keptCount,
        memoriesExtracted,
      },
    })
  }

  private async runLoop(events: SessionEvents): Promise<void> {
    this.abortController = new AbortController()
    this.currentEvents = events

    this.microCompact()

    if (this.shouldCompact()) {
      await this.compact(events)
    }

    while (true) {
      this.turnIndex++
      this.toolRunner.turnIndex = this.turnIndex
      const assistantContent: any[] = []
      let hasToolUse = false

      let streamSuccess = false
      let retryCount = 0
      let compactedOnError = false

      while (!streamSuccess) {
        if (this.abortController?.signal.aborted) break

        try {
          const stream = this.provider.stream(
            this.messages,
            this.toolRegistry.getDefinitions(),
            this.config.modelConfig,
            this.abortController!.signal
          )
          for await (const chunk of stream) {
            events.onStreamChunk(chunk)

            if (chunk.type === 'thinking_delta' && chunk.text) {
              const last = assistantContent[assistantContent.length - 1]
              if (last?.type === 'thinking') {
                last.thinking += chunk.text
              } else {
                assistantContent.push({ type: 'thinking', thinking: chunk.text })
              }
            } else if (chunk.type === 'thinking_end' && chunk.signature) {
              const last = assistantContent[assistantContent.length - 1]
              if (last?.type === 'thinking') {
                last.signature = chunk.signature
              }
            } else if (chunk.type === 'text_delta' && chunk.text) {
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
            } else if (chunk.type === 'message_end' && chunk.usage) {
              this.usageTracker.addTurn(chunk.usage)
              this.history.saveUsage(this.id, this.usageTracker.serialize())
              events.onUsage?.(this.usageTracker.getSnapshot())
            }
          }
          streamSuccess = true
        } catch (streamErr: any) {
          if (this.abortController?.signal.aborted) break

          const category = classifyError(streamErr)

          if (category === 'prompt_too_long') {
            await this.compactNow(events)
            streamSuccess = true // will re-enter outer while loop with compacted messages
            break
          }

          const maxForCategory = getMaxRetries(category)
          if (category === 'non_retryable' || retryCount >= maxForCategory) {
            if (!compactedOnError && (category === 'gateway' || category === 'overloaded') && this.messages.length > 20) {
              console.log('[RUNLOOP] Gateway error after retries, attempting compact')
              await this.compact(events)
              retryCount = 0
              compactedOnError = true
              continue
            }
            console.error('[STREAM ERROR]', streamErr.message)
            events.onError(streamErr)
            return
          }

          const delay = getRetryDelay(retryCount, category, streamErr)
          events.onRetrying?.(retryCount + 1, streamErr, delay, category)
          retryCount++

          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, delay)
            const onAbort = () => { clearTimeout(timer); reject(new Error('Aborted')) }
            this.abortController?.signal.addEventListener('abort', onAbort, { once: true })
          }).catch(() => { /* aborted during wait */ })
        }
      }

      const assistantMessage: Message = {
        id: uuid(),
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
      }

      if (assistantContent.length === 0) {
        console.warn('[SESSION] Empty assistant response')
      }
      this.messages.push(assistantMessage)
      this.history.addMessage(this.id, assistantMessage)
      events.onMessageComplete(assistantMessage)

      if (!hasToolUse) break

      const toolUseBlocks = assistantContent.filter((b: any) => b.type === 'tool_use')
      const batchResults = await this.parallelExecutor.executeBatch(
        toolUseBlocks,
        events.onToolEvent,
        this.abortController!.signal
      )
      const reminder = this.getSystemReminder()
      const toolResults = batchResults.map(r => ({
        type: 'tool_result' as const,
        tool_use_id: r.tool_use_id,
        content: r.content + (reminder || ''),
        is_error: r.is_error,
      }))

      const toolMessage: Message = {
        id: uuid(),
        role: 'user',
        content: toolResults,
        timestamp: Date.now(),
      }
      this.messages.push(toolMessage)
      this.history.addMessage(this.id, toolMessage)
      events.onMessageComplete(toolMessage)
    }

    // Ensure usage is reported at end of runLoop (fallback for APIs that don't report token counts)
    const finalSnapshot = this.usageTracker.getSnapshot()
    if (finalSnapshot.contextUsedPercent === 0 && this.messages.length > 0) {
      const contextWindow = this.config.modelConfig.contextWindow || 200000
      const estimated = estimateTokens(this.messages)
      const percent = Math.min(Math.round((estimated / contextWindow) * 100), 100)
      finalSnapshot.contextUsedPercent = percent
    }
    events.onUsage?.(finalSnapshot)

    this.abortController = null
    this.currentEvents = undefined
  }

  private getSystemReminder(): string | null {
    const appConfig = loadAppConfig()
    const parts: string[] = []
    const date = new Date().toISOString().split('T')[0]
    parts.push(`当前日期: ${date}`)
    if (appConfig.language) {
      const labels: Record<string, string> = { 'zh-CN': '中文', 'en': 'English', 'ja': '日本語', 'ko': '한국어' }
      parts.push(`语言: ${labels[appConfig.language] || appConfig.language}`)
    }
    if (appConfig.customInstructions) {
      parts.push(appConfig.customInstructions)
    }
    if (parts.length <= 1) return null  // only date, no user config — skip
    return `\n\n<system-reminder>\n${parts.join('\n')}\n</system-reminder>`
  }

  abort(): void {
    this.abortController?.abort()
  }

  abortAgent(agentToolUseId: string): void {
    const controller = this.agentAbortControllers.get(agentToolUseId)
    if (controller) {
      controller.abort()
    }
  }
}
