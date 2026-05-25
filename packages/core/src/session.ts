import { v4 as uuid } from 'uuid'
import path from 'node:path'
import type { Message, ModelConfig, SessionConfig, StreamChunk } from './types.js'
import type { ModelProvider } from './model-provider.js'
import { ToolRegistry } from './tool-registry.js'
import { ToolRunner, type ToolExecutionEvent, type PermissionCallback } from './tool-runner.js'
import { registerBuiltinTools } from './tools/index.js'
import { ConversationHistory } from './history.js'
import { assembleSystemPrompt, getMemoryDir } from './context.js'
import { getCodegraphPromptSegment } from './codegraph/index.js'
import { loadAppConfig, getConfigDir } from './config.js'
import { PermissionChecker } from './permissions.js'
import { TaskStore } from './task-store.js'
import { estimateTokens } from './token-estimation.js'
import { compactMessages, MIN_COMPACT_LENGTH } from './compact.js'
import { parseMemories, saveMemories } from './memory-extractor.js'
import { createTaskCreateTool } from './tools/task-create.js'
import { createTaskGetTool } from './tools/task-get.js'
import { createTaskListTool } from './tools/task-list.js'
import { createTaskUpdateTool } from './tools/task-update.js'
import { createTaskStopTool } from './tools/task-stop.js'
import { createTodoWriteTool } from './tools/todo-write.js'
import { saveMemoryTool } from './tools/save-memory.js'
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
import { FileReadStateCache } from './file-read-state.js'
import { ParallelExecutor } from './parallel-executor.js'
import { BackgroundTaskManager } from './background-tasks.js'
import { createTaskOutputTool } from './tools/task-output.js'
import { monitorTool } from './tools/monitor.js'
import { TeamRegistry } from './team/team-registry.js'
import { createTeamTool } from './tools/team.js'
import { createBackgroundSendTool } from './tools/background-send.js'
import { createBackgroundStatusTool } from './tools/background-status.js'
import { createBackgroundEventsTool } from './tools/background-events.js'
import { createTeamListTool } from './tools/team-list.js'
import { createTeamAddTaskTool } from './tools/team-add-task.js'

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
  private isCompacting = false
  private mcpManager?: McpManager
  private hookEngine?: HookEngine
  private hooksReady: Promise<void>
  private skillLoader: SkillLoader
  private skillsReady: Promise<void>
  private permissionChecker: PermissionChecker
  private agentAbortControllers = new Map<string, AbortController>()
  private backgroundTriggers = new Map<string, () => void>()
  private currentEvents?: SessionEvents
  private usageTracker: UsageTracker
  private fileTracker: FileTracker
  private fileReadState: FileReadStateCache
  private backgroundTasks: BackgroundTaskManager
  private teamRegistry: TeamRegistry
  /**
   * Final-state snapshots of teams keyed by taskId. Captured the moment a team
   * transitions to completed/failed (when team is still in registry, all member
   * and task data still resolvable). Read by getTeamStatus after the runtime
   * has been removed from the registry, so the UI can still render the final
   * frame instead of getting an empty placeholder. Process-only — not persisted.
   */
  private teamFinalSnapshots = new Map<string, any>()
  private turnIndex = 0
  private turnsSinceTaskTool = 0
  private planMode: 'normal' | 'planning' | 'awaiting_approval' = 'normal'
  private onPlanReview?: (planFile: string, content: string) => Promise<{ approved: boolean; feedback?: string }>
  resolveModel?: (modelId: string) => { provider: ModelProvider; modelConfig: ModelConfig } | null
  ideContext?: { filePath?: string; text?: string; selection?: { start: { line: number }; end: { line: number } } | null }
  private pendingNotifications: Array<{
    type: 'shell_complete' | 'agent_complete' | 'team_progress' | 'team_complete'
    taskId: string
    status: 'completed' | 'failed' | 'running'
    command?: string
    prompt?: string
    output?: string
    exitCode?: number
    result?: string
    turns?: number
    toolsUsed?: string[]
    teamEvent?: string
  }> = []
  onNotificationReady?: () => void

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
    this.fileReadState = new FileReadStateCache()
    this.taskStore = new TaskStore(history, config.id)
    this.backgroundTasks = new BackgroundTaskManager(path.join(getConfigDir(), 'tasks'))
    this.teamRegistry = new TeamRegistry()
    this.backgroundTasks.setOnComplete((task) => {
      if (task.type === 'shell') {
        this.pendingNotifications.push({
          type: 'shell_complete',
          taskId: task.id,
          status: task.status as 'completed' | 'failed',
          command: task.command,
          output: this.backgroundTasks.getOutput(task.id, 50),
          exitCode: task.exitCode,
        })
      } else {
        this.pendingNotifications.push({
          type: 'agent_complete',
          taskId: task.id,
          status: task.status as 'completed' | 'failed',
          prompt: task.prompt,
          result: task.result,
          turns: task.turns,
          toolsUsed: task.toolsUsed,
        })
      }
      this.onNotificationReady?.()
    })
    this.onPlanReview = onPlanReview
    this.toolRegistry = new ToolRegistry()
    registerBuiltinTools(this.toolRegistry)
    this.toolRegistry.register(createTaskCreateTool(this.taskStore))
    this.toolRegistry.register(createTaskGetTool(this.taskStore))
    this.toolRegistry.register(createTaskListTool(this.taskStore))
    this.toolRegistry.register(createTaskUpdateTool(this.taskStore))
    this.toolRegistry.register(createTaskStopTool(this.taskStore))
    this.toolRegistry.register(createTodoWriteTool(this.taskStore))
    this.toolRegistry.register(saveMemoryTool)
    this.toolRegistry.register(createTaskOutputTool(this.backgroundTasks))
    this.toolRegistry.register(monitorTool)
    // Team Mode tools
    const onSubAgentUsage = (u: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number }) => {
      this.usageTracker.addSubAgentTurn(u)
      this.history.saveUsage(this.id, this.usageTracker.serialize())
    }
    const buildTeamSubSessionDeps = () => ({
      provider: this.provider,
      toolRegistry: this.toolRegistry,
      modelConfig: this.config.modelConfig,
      cwd: this.config.cwd,
      onUsage: onSubAgentUsage,
    })
    this.toolRegistry.register(createTeamTool({
      teamRegistry: this.teamRegistry,
      backgroundTasks: this.backgroundTasks,
      buildSubSessionDeps: buildTeamSubSessionDeps as any,
      provider: this.provider,
      modelConfig: this.config.modelConfig,
      resolveModel: (modelId: string) => this.resolveModel?.(modelId) ?? null,
      getSkillLoader: () => this.skillLoader,
      onUsage: onSubAgentUsage,
      onTeamEvent: (teamId, event) => {
        // Only notify the main session on terminal events (team_completed / team_failed)
        // and explicit PM replies. Intermediate events (task_completed, manager_decision,
        // etc.) fire before completeTeam() and would cause the main session to think
        // the team is done prematurely — suppress them.
        if (event.type === 'team_completed') {
          this.captureTeamFinalSnapshot(teamId)
          this.pendingNotifications.push({
            type: 'team_complete',
            taskId: teamId,
            status: 'completed',
            teamEvent: `Team finished. Final summary:\n${(event as any).summary ?? ''}\n\nDo NOT call background_status / background_events on this team again — it is done.`,
          })
        } else if (event.type === 'team_failed') {
          this.captureTeamFinalSnapshot(teamId)
          this.pendingNotifications.push({
            type: 'team_complete',
            taskId: teamId,
            status: 'failed',
            teamEvent: `Team failed: ${(event as any).error ?? 'unknown error'}\n\nDo NOT call background_status / background_events on this team again — it is done.`,
          })
        } else if (event.type === 'manager_reply') {
          this.pendingNotifications.push({
            type: 'team_progress',
            taskId: teamId,
            status: 'running',
            teamEvent: `PM (reply): ${(event as any).text}`,
          })
        }
      },
    }))
    this.toolRegistry.register(createBackgroundSendTool({
      backgroundTasks: this.backgroundTasks,
      teamRegistry: this.teamRegistry,
    }))
    this.toolRegistry.register(createBackgroundStatusTool({
      backgroundTasks: this.backgroundTasks,
      teamRegistry: this.teamRegistry,
    }))
    this.toolRegistry.register(createBackgroundEventsTool({
      backgroundTasks: this.backgroundTasks,
    }))
    this.toolRegistry.register(createTeamListTool({
      backgroundTasks: this.backgroundTasks,
      teamRegistry: this.teamRegistry,
    }))
    this.toolRegistry.register(createTeamAddTaskTool({
      backgroundTasks: this.backgroundTasks,
      teamRegistry: this.teamRegistry,
    }))
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
    this.toolRunner.fileReadState = this.fileReadState
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
      backgroundTasks: this.backgroundTasks,
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
      registerBackgroundTrigger: (toolUseId: string, resolve: () => void) => {
        this.backgroundTriggers.set(toolUseId, resolve)
      },
      onUsage: onSubAgentUsage,
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
      this.toolRunner.fileReadState = this.fileReadState
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

  async reloadSkills(): Promise<void> {
    await this.skillLoader.loadAll(this.config.cwd)
  }

  getSkillLoader(): SkillLoader {
    return this.skillLoader
  }

  setPermissionMode(mode: import('./permissions.js').PermissionMode): void {
    this.permissionChecker.setMode(mode)
  }

  getProvider(): ModelProvider {
    return this.provider
  }

  updateProvider(provider: ModelProvider, modelConfig: ModelConfig): void {
    this.provider = provider
    this.config.modelConfig = { ...this.config.modelConfig, ...modelConfig }
    if (modelConfig.contextWindow) {
      this.usageTracker.setContextWindow(modelConfig.contextWindow)
      // Bridge lastInputTokens to a model-aware estimate so swapping context
      // windows does not flip the gauge to 100% (large→small) or 0%
      // (small→large) until the next API turn arrives.
      this.usageTracker.resetLastTurn(estimateTokens(this.messages))
    }
  }

  setEffort(effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'): void {
    this.config.modelConfig.effort = effort
  }

  clearMessages(): void {
    this.messages = []
  }

  async compactNow(events: SessionEvents): Promise<void> {
    if (this.messages.length < MIN_COMPACT_LENGTH) {
      events.onStreamChunk({
        type: 'compact_skipped',
        compactSkipped: { reason: 'too_short', messageCount: this.messages.length },
      })
      return
    }
    if (this.isCompacting) {
      events.onStreamChunk({
        type: 'compact_skipped',
        compactSkipped: { reason: 'in_progress', messageCount: this.messages.length },
      })
      return
    }
    const ownAbort = new AbortController()
    const previousAbort = this.abortController
    this.abortController = ownAbort
    this.isCompacting = true
    try {
      await this.compact(events)
    } finally {
      this.isCompacting = false
      // Only restore previous controller if no new runLoop replaced it.
      if (this.abortController === ownAbort) {
        this.abortController = previousAbort
      }
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

    // Inject codegraph prompt segment when project has .codegraph/
    const codegraphSegment = getCodegraphPromptSegment(this.config.cwd)
    if (codegraphSegment.segment && Array.isArray(this.config.modelConfig.systemPrompt)) {
      this.config.modelConfig.systemPrompt.push({
        content: codegraphSegment.segment,
        cacheable: codegraphSegment.cacheable,
      })
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
    let mutated = false

    // Phase 1: At 50%+ context, clear old tool results entirely (keep last 8)
    // This is the most impactful optimization — old grep/read results are rarely needed
    if (snapshot.contextUsedPercent >= 50) {
      const keepRecent = 8
      let toolResultCount = 0
      // Count total tool results
      for (const msg of this.messages) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') toolResultCount++
        }
      }

      if (toolResultCount > keepRecent) {
        let cleared = 0
        const toClear = toolResultCount - keepRecent
        for (const msg of this.messages) {
          for (let j = 0; j < msg.content.length; j++) {
            const block = msg.content[j]
            if (block.type === 'tool_result' && !block.is_error && cleared < toClear) {
              const originalLength = block.content.length
              if (originalLength > 200) {
                msg.content[j] = { ...block, content: `[Tool result cleared — ${originalLength} chars. Recent results are kept.]` }
                cleared++
                mutated = true
              }
            }
          }
        }
      }
      if (mutated) this.history.replaceMessages(this.id, this.messages)
      return
    }

    // Phase 2: At 40%+ context, truncate large tool results (keep first 200 chars)
    if (snapshot.contextUsedPercent >= 40) {
      const cutoff = this.messages.length - 10
      for (let i = 0; i < cutoff; i++) {
        const msg = this.messages[i]
        for (let j = 0; j < msg.content.length; j++) {
          const block = msg.content[j]
          if (block.type === 'tool_result' && !block.is_error && block.content.length > 500) {
            const removed = block.content.length - 200
            msg.content[j] = { ...block, content: block.content.slice(0, 200) + `\n[...truncated, ${removed} chars removed]` }
            mutated = true
          }
        }
      }
      if (mutated) this.history.replaceMessages(this.id, this.messages)
    }
  }

  private async compact(events: SessionEvents): Promise<void> {
    events.onStreamChunk({ type: 'compact_start' })
    const result = await compactMessages(
      this.messages,
      this.provider,
      this.config.modelConfig,
      events.onStreamChunk,
      this.abortController?.signal
    )

    if (result.status === 'skipped') {
      events.onStreamChunk({
        type: 'compact_skipped',
        compactSkipped: { reason: 'too_short', messageCount: result.originalCount },
      })
      return
    }

    if (result.status === 'failed') {
      events.onStreamChunk({
        type: 'compact_failed',
        compactFailed: {
          reason: result.failReason || 'stream_error',
          message: result.errorMessage,
        },
      })
      return
    }

    // status === 'compacted' — actually replace messages
    this.messages = result.messages
    this.history.replaceMessages(this.id, this.messages)

    let memoriesExtracted = 0
    if (result.rawOutput) {
      const memories = parseMemories(result.rawOutput)
      if (memories.length > 0) {
        const memDir = getMemoryDir(this.config.cwd)
        memoriesExtracted = await saveMemories(memories, memDir, this.id)
      }
    }

    // Bridge usage to a realistic estimate so the gauge does not flash to 0%.
    const estimated = estimateTokens(this.messages)
    this.usageTracker.resetLastTurn(estimated)
    events.onUsage?.(this.usageTracker.getSnapshot())

    events.onStreamChunk({
      type: 'compact_complete',
      compactInfo: {
        originalCount: result.originalCount,
        keptCount: result.keptCount,
        summarizedCount: result.summarizedCount,
        memoriesExtracted,
      },
    })
  }

  private drainNotifications(): Message | null {
    if (this.pendingNotifications.length === 0) return null
    const items = this.pendingNotifications.splice(0)
    const parts = items.map(n => {
      if (n.type === 'shell_complete') {
        return `<task-notification>\n<task-id>${n.taskId}</task-id>\n<type>shell_complete</type>\n<status>${n.status}</status>\n<command>${n.command || ''}</command>\n<exit-code>${n.exitCode ?? 'N/A'}</exit-code>\n<output>\n${n.output || '(no output)'}\n</output>\n</task-notification>`
      }
      if (n.type === 'team_progress') {
        return `<task-notification>\n<task-id>${n.taskId}</task-id>\n<type>team_progress</type>\n<status>${n.status}</status>\n<event>${n.teamEvent || ''}</event>\n</task-notification>`
      }
      if (n.type === 'team_complete') {
        return `<task-notification>\n<task-id>${n.taskId}</task-id>\n<type>team_complete</type>\n<status>${n.status}</status>\n<event>${n.teamEvent || ''}</event>\n</task-notification>`
      }
      return `<task-notification>\n<task-id>${n.taskId}</task-id>\n<type>agent_complete</type>\n<status>${n.status}</status>\n<agent-prompt>${n.prompt || ''}</agent-prompt>\n<result>${n.result || '(no result)'}</result>\n<turns>${n.turns ?? 0}</turns>\n<tools-used>${(n.toolsUsed || []).join(', ')}</tools-used>\n</task-notification>`
    })
    return {
      id: uuid(),
      role: 'user',
      content: [{ type: 'text', text: parts.join('\n\n') }],
      timestamp: Date.now(),
    }
  }

  private async runLoop(events: SessionEvents): Promise<void> {
    this.abortController = new AbortController()
    this.currentEvents = events

    const notificationMsg = this.drainNotifications()
    if (notificationMsg) {
      this.messages.push(notificationMsg)
    }

    this.microCompact()

    if (this.shouldCompact()) {
      await this.compact(events)
    }

    let justCompacted = false
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
          const cfgWithCache: ModelConfig = {
            ...this.config.modelConfig,
            cacheKey: this.config.modelConfig.cacheKey ?? `main:${this.id}`,
            cacheUser: this.config.modelConfig.cacheUser ?? this.id,
          }
          const stream = this.provider.stream(
            this.messages,
            this.toolRegistry.getDefinitions(),
            cfgWithCache,
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
            if (this.abortController?.signal.aborted) break
            // Re-run this turn against the compacted message list.
            // Drop any partial chunks accumulated before the error so we don't
            // duplicate content into the final assistantMessage.
            assistantContent.length = 0
            hasToolUse = false
            retryCount = 0
            continue
          }

          const maxForCategory = getMaxRetries(category)
          if (category === 'non_retryable' || retryCount >= maxForCategory) {
            if (!compactedOnError && (category === 'gateway' || category === 'overloaded') && this.messages.length > 20) {
              console.log('[RUNLOOP] Gateway error after retries, attempting compact')
              await this.compact(events)
              assistantContent.length = 0
              hasToolUse = false
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
          // Drop partial chunks before retrying — provider will replay from the
          // start of the assistant turn.
          assistantContent.length = 0
          hasToolUse = false

          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, delay)
            const onAbort = () => { clearTimeout(timer); reject(new Error('Aborted')) }
            this.abortController?.signal.addEventListener('abort', onAbort, { once: true })
          }).catch(() => { /* aborted during wait */ })
        }
      }

      // If the inner loop exited without producing any content (abort or
      // unrecoverable error already reported), don't persist an empty
      // assistant turn — it pollutes history and the UI.
      if (assistantContent.length === 0) {
        if (this.abortController?.signal.aborted) break
        // Stream ended cleanly with zero content: log and bail without push.
        console.warn('[SESSION] Empty assistant response — skipping persistence')
        break
      }

      // Reorder content blocks: thinking → merged text → tool_uses
      // OpenAI Responses API often interleaves text/function_call within one response,
      // which renders as text being split by tool cards. Group them into a clean structure.
      const reorderedContent = reorderAssistantContent(assistantContent)

      const assistantMessage: Message = {
        id: uuid(),
        role: 'assistant',
        content: reorderedContent,
        timestamp: Date.now(),
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
      if (this.abortController?.signal.aborted) break

      const TASK_TOOL_NAMES = new Set(['task_create', 'task_update', 'task_list', 'task_get', 'task_stop', 'todo_write'])
      const usedTaskTool = toolUseBlocks.some((b: any) => TASK_TOOL_NAMES.has(b.name))
      if (usedTaskTool) {
        this.turnsSinceTaskTool = 0
      } else {
        this.turnsSinceTaskTool++
      }

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

      // Check if compaction is needed between runloop iterations
      if (!justCompacted) {
        this.microCompact()
        if (this.shouldCompact()) {
          await this.compact(events)
          justCompacted = true
        }
      } else {
        justCompacted = false
      }
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

    const taskReminder = this.getTaskReminder()
    if (taskReminder) parts.push(taskReminder)

    if (parts.length <= 1) return null  // only date, no user config — skip
    return `\n\n<system-reminder>\n${parts.join('\n')}\n</system-reminder>`
  }

  private getTaskReminder(): string | null {
    if (this.turnsSinceTaskTool < 3) return null
    const tasks = this.taskStore.list()
    const openTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress')
    if (openTasks.length === 0 && tasks.length === 0) return null

    const lines: string[] = []
    lines.push(
      'The task tools haven\'t been used recently. If you\'re working on tasks that would benefit ' +
      'from tracking progress, consider using task_create to add new tasks and task_update to ' +
      'update task status (set to in_progress when starting, completed when done). Also consider ' +
      'cleaning up the task list if it has become stale. Only use these if relevant to the current ' +
      'work. This is just a gentle reminder - ignore if not applicable.'
    )

    if (tasks.length > 0) {
      lines.push('')
      lines.push('Here are the existing tasks:')
      for (const t of tasks) {
        lines.push(`#${t.id}. [${t.status}] ${t.subject}`)
      }
    }

    return lines.join('\n')
  }

  async processNotifications(events: SessionEvents): Promise<void> {
    if (this.pendingNotifications.length === 0) return
    if (this.abortController) return
    await this.runLoop(events)
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

  backgroundAgent(agentToolUseId: string): void {
    const trigger = this.backgroundTriggers.get(agentToolUseId)
    if (trigger) {
      trigger()
      this.backgroundTriggers.delete(agentToolUseId)
    }
  }

  getTeamStatus(taskId: string): any {
    const task = this.backgroundTasks.getTask(taskId)
    if (!task || task.type !== 'team') return null
    const team = this.teamRegistry.get(taskId)
    if (!team) {
      // Team is no longer in registry (completed/failed and removed). Try the
      // final snapshot we captured the moment it terminated — that way the UI
      // still renders members/tasks/manager instead of going blank.
      const snapshot = this.teamFinalSnapshots.get(taskId)
      if (snapshot) {
        return { ...snapshot, finished: true }
      }
      return {
        type: 'team',
        id: task.id,
        status: task.status,
        finished: true,
      }
    }
    const tasks = team.getTasks()
    return {
      type: 'team',
      id: team.id,
      objective: team.objective,
      status: team.getStatus(),
      manager: team.getManagerState(),
      members: team.getMembers(),
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        assigneeId: t.assigneeId,
        priority: t.priority,
      })),
      taskStats: {
        total: tasks.length,
        completed: tasks.filter(t => t.status === 'completed').length,
        running: tasks.filter(t => t.status === 'running' || t.status === 'assigned').length,
        blocked: tasks.filter(t => t.status === 'blocked').length,
        cancelled: tasks.filter(t => t.status === 'cancelled').length,
        todo: tasks.filter(t => t.status === 'todo').length,
        failed: tasks.filter(t => t.status === 'failed').length,
      },
    }
  }

  /**
   * Snapshot a team's full state so getTeamStatus can keep returning meaningful
   * data after the runtime is removed from the registry. Called from onTeamEvent
   * on team_completed / team_failed — at that point the runtime is still alive
   * and getMembers/getTasks/getManagerState are still resolvable.
   */
  private captureTeamFinalSnapshot(taskId: string): void {
    const team = this.teamRegistry.get(taskId)
    if (!team) return
    const tasks = team.getTasks()
    this.teamFinalSnapshots.set(taskId, {
      type: 'team',
      id: team.id,
      objective: team.objective,
      status: team.getStatus(),
      manager: team.getManagerState(),
      members: team.getMembers(),
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        assigneeId: t.assigneeId,
        priority: t.priority,
      })),
      taskStats: {
        total: tasks.length,
        completed: tasks.filter(t => t.status === 'completed').length,
        running: tasks.filter(t => t.status === 'running' || t.status === 'assigned').length,
        blocked: tasks.filter(t => t.status === 'blocked').length,
        cancelled: tasks.filter(t => t.status === 'cancelled').length,
        todo: tasks.filter(t => t.status === 'todo').length,
        failed: tasks.filter(t => t.status === 'failed').length,
      },
    })
  }

  getTeamEvents(taskId: string, tail?: number): any[] {
    const task = this.backgroundTasks.getTask(taskId)
    if (!task || task.type !== 'team') return []
    return this.backgroundTasks.getEvents(taskId, tail)
  }

  sendTeamMessage(taskId: string, payload: { message: string; target?: string; intent?: string; priority?: string }): void {
    const task = this.backgroundTasks.getTask(taskId)
    if (!task || task.type !== 'team') return
    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from: 'user' as const,
      to: payload.target ?? 'manager',
      intent: (payload.intent ?? 'message') as any,
      content: payload.message,
      priority: (payload.priority ?? 'normal') as any,
      createdAt: Date.now(),
    }
    this.backgroundTasks.sendMessage(taskId, msg)
    const team = this.teamRegistry.get(taskId)
    if (team) team.sendMessage(msg)
  }
}

function reorderAssistantContent(content: any[]): any[] {
  if (content.length === 0) return content

  const thinkingBlocks: any[] = []
  const textParts: string[] = []
  const toolBlocks: any[] = []

  for (const block of content) {
    if (block.type === 'thinking') {
      thinkingBlocks.push(block)
    } else if (block.type === 'text') {
      if (block.text) textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolBlocks.push(block)
    }
  }

  const result: any[] = [...thinkingBlocks]
  if (textParts.length > 0) {
    result.push({ type: 'text', text: textParts.join('\n\n') })
  }
  result.push(...toolBlocks)
  return result
}
