export interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  cacheHitRate: number
  contextUsedPercent: number
  turnCount: number
  // Sub-agent / team / skill-router consumption. Counted toward billing
  // total but NOT toward contextUsedPercent (those run in their own
  // contexts).
  subAgentInputTokens: number
  subAgentOutputTokens: number
  subAgentCacheCreationTokens: number
  subAgentCacheReadTokens: number
  subAgentTotalTokens: number
  subAgentTurnCount: number
  // Grand totals (main + sub-agent)
  grandInputTokens: number
  grandOutputTokens: number
  grandTotalTokens: number
}

export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

export class UsageTracker {
  private contextWindow: number
  private cumInput = 0
  private cumOutput = 0
  private cumCacheCreation = 0
  private cumCacheRead = 0
  private turnCount = 0
  private lastInputTokens = 0
  private lastOutputTokens = 0
  // Aggregated cost from sub-agents (Agent tool), team workers, PM,
  // skill router, etc. These run in their own context windows so we don't
  // mix their input tokens into contextUsedPercent — but we DO count them
  // toward total billing/usage display.
  private subInput = 0
  private subOutput = 0
  private subCacheCreation = 0
  private subCacheRead = 0
  private subTurnCount = 0

  constructor(contextWindow: number) {
    this.contextWindow = contextWindow || 200000
  }

  addTurn(usage: TurnUsage): void {
    this.cumInput += usage.inputTokens
    this.cumOutput += usage.outputTokens
    this.cumCacheCreation += usage.cacheCreationInputTokens || 0
    this.cumCacheRead += usage.cacheReadInputTokens || 0
    this.lastInputTokens = usage.inputTokens + (usage.cacheCreationInputTokens || 0) + (usage.cacheReadInputTokens || 0)
    this.lastOutputTokens = usage.outputTokens
    this.turnCount++
  }

  addSubAgentTurn(usage: TurnUsage): void {
    this.subInput += usage.inputTokens
    this.subOutput += usage.outputTokens
    this.subCacheCreation += usage.cacheCreationInputTokens || 0
    this.subCacheRead += usage.cacheReadInputTokens || 0
    this.subTurnCount++
  }

  getSnapshot(): UsageSnapshot {
    const totalTokens = this.cumInput + this.cumOutput
    const cacheTotal = this.cumInput + this.cumCacheCreation + this.cumCacheRead
    const cacheHitRate = cacheTotal > 0 ? (this.cumCacheRead / cacheTotal) * 100 : 0
    const contextUsed = this.lastInputTokens + this.lastOutputTokens
    const contextUsedPercent = this.contextWindow > 0
      ? Math.round((contextUsed / this.contextWindow) * 100)
      : 0
    const subAgentTotalTokens = this.subInput + this.subOutput

    return {
      inputTokens: this.cumInput,
      outputTokens: this.cumOutput,
      cacheCreationTokens: this.cumCacheCreation,
      cacheReadTokens: this.cumCacheRead,
      totalTokens,
      cacheHitRate: Math.round(cacheHitRate * 10) / 10,
      contextUsedPercent: Math.min(contextUsedPercent, 100),
      turnCount: this.turnCount,
      subAgentInputTokens: this.subInput,
      subAgentOutputTokens: this.subOutput,
      subAgentCacheCreationTokens: this.subCacheCreation,
      subAgentCacheReadTokens: this.subCacheRead,
      subAgentTotalTokens,
      subAgentTurnCount: this.subTurnCount,
      grandInputTokens: this.cumInput + this.subInput,
      grandOutputTokens: this.cumOutput + this.subOutput,
      grandTotalTokens: totalTokens + subAgentTotalTokens,
    }
  }

  setContextWindow(contextWindow: number): void {
    this.contextWindow = contextWindow
  }

  resetLastTurn(estimatedInputTokens: number): void {
    this.lastInputTokens = estimatedInputTokens
    this.lastOutputTokens = 0
  }

  shouldCompact(compressAt: number): boolean {
    if (this.turnCount === 0) return false
    const contextUsed = this.lastInputTokens + this.lastOutputTokens
    return contextUsed > this.contextWindow * compressAt
  }

  reset(): void {
    this.cumInput = 0
    this.cumOutput = 0
    this.cumCacheCreation = 0
    this.cumCacheRead = 0
    this.turnCount = 0
    this.lastInputTokens = 0
    this.lastOutputTokens = 0
    this.subInput = 0
    this.subOutput = 0
    this.subCacheCreation = 0
    this.subCacheRead = 0
    this.subTurnCount = 0
  }

  serialize(): string {
    return JSON.stringify({
      cumInput: this.cumInput,
      cumOutput: this.cumOutput,
      cumCacheCreation: this.cumCacheCreation,
      cumCacheRead: this.cumCacheRead,
      turnCount: this.turnCount,
      lastInputTokens: this.lastInputTokens,
      lastOutputTokens: this.lastOutputTokens,
      contextWindow: this.contextWindow,
      subInput: this.subInput,
      subOutput: this.subOutput,
      subCacheCreation: this.subCacheCreation,
      subCacheRead: this.subCacheRead,
      subTurnCount: this.subTurnCount,
    })
  }

  restore(data: string): void {
    try {
      const parsed = JSON.parse(data)
      this.cumInput = parsed.cumInput || 0
      this.cumOutput = parsed.cumOutput || 0
      this.cumCacheCreation = parsed.cumCacheCreation || 0
      this.cumCacheRead = parsed.cumCacheRead || 0
      this.turnCount = parsed.turnCount || 0
      this.lastInputTokens = parsed.lastInputTokens || 0
      this.lastOutputTokens = parsed.lastOutputTokens || 0
      this.subInput = parsed.subInput || 0
      this.subOutput = parsed.subOutput || 0
      this.subCacheCreation = parsed.subCacheCreation || 0
      this.subCacheRead = parsed.subCacheRead || 0
      this.subTurnCount = parsed.subTurnCount || 0
      // Don't restore contextWindow — always use current model config
    } catch {
      // Invalid data, keep defaults
    }
  }
}
