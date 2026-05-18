export interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  cacheHitRate: number
  contextUsedPercent: number
  turnCount: number
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

  getSnapshot(): UsageSnapshot {
    const totalTokens = this.cumInput + this.cumOutput
    const cacheTotal = this.cumInput + this.cumCacheCreation + this.cumCacheRead
    const cacheHitRate = cacheTotal > 0 ? (this.cumCacheRead / cacheTotal) * 100 : 0
    const contextUsed = this.lastInputTokens + this.lastOutputTokens
    const contextUsedPercent = this.contextWindow > 0
      ? Math.round((contextUsed / this.contextWindow) * 100)
      : 0

    return {
      inputTokens: this.cumInput,
      outputTokens: this.cumOutput,
      cacheCreationTokens: this.cumCacheCreation,
      cacheReadTokens: this.cumCacheRead,
      totalTokens,
      cacheHitRate: Math.round(cacheHitRate * 10) / 10,
      contextUsedPercent: Math.min(contextUsedPercent, 100),
      turnCount: this.turnCount,
    }
  }

  setContextWindow(contextWindow: number): void {
    this.contextWindow = contextWindow
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
      // Don't restore contextWindow — always use current model config
    } catch {
      // Invalid data, keep defaults
    }
  }
}
