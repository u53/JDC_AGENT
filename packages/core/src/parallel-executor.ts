import type { ToolRunner, ToolExecutionEvent } from './tool-runner.js'

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolBatchResult {
  tool_use_id: string
  content: string
  is_error: boolean
}

const READ_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'Tree',
  'WebFetch', 'WebSearch', 'LSP',
  'TaskGet', 'TaskList', 'TaskStop',
  'ListMcpResources', 'ReadMcpResource', 'skill',
])

const JDC_READ_TOOLS = new Set([
  'JdcContext',
  'JdcSearch',
  'JdcNode',
  'JdcCallers',
  'JdcCallees',
  'JdcImpact',
  'JdcTrace',
  'JdcExplore',
  'JdcFiles',
])

const LONG_RUNNING_TOOLS = new Set(['Agent', 'Bash', 'Monitor'])

const MAX_CONCURRENCY = 5

function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name) || JDC_READ_TOOLS.has(name) || name.startsWith('Jdc')
}

function isJdcReadTool(name: string): boolean {
  return JDC_READ_TOOLS.has(name) || name.startsWith('Jdc')
}

class Semaphore {
  private queue: Array<() => void> = []
  private running = 0

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++
      return
    }
    await new Promise<void>(resolve => this.queue.push(resolve))
  }

  release(): void {
    this.running--
    const next = this.queue.shift()
    if (next) {
      this.running++
      next()
    }
  }
}

export class ParallelExecutor {
  constructor(private toolRunner: ToolRunner) {}

  /**
   * Execute a single tool, but abandon the promise if the signal aborts
   * before the tool returns. The underlying tool keeps running (so it can
   * shut down its own resources cleanly — e.g. bash kills its child) but
   * the runloop is unblocked immediately so the user's Stop click is
   * honored without waiting for slow tools (web_fetch, agent, etc.) to
   * finish naturally.
   */
  private async raceWithAbort(
    name: string,
    id: string,
    input: Record<string, unknown>,
    onEvent: (event: ToolExecutionEvent) => void,
    signal: AbortSignal,
  ): Promise<{ tool_use_id: string; content: string; is_error: boolean; aborted?: boolean }> {
    const tool = this.toolRunner.execute(name, id, input, onEvent, signal).then(r => ({
      tool_use_id: id,
      content: r.content,
      is_error: r.isError || false,
    }))
    if (signal.aborted) {
      return { tool_use_id: id, content: 'Cancelled by user (abort)', is_error: true, aborted: true }
    }
    const aborted = new Promise<{ tool_use_id: string; content: string; is_error: boolean; aborted: true }>((resolve) => {
      signal.addEventListener('abort', () => {
        resolve({ tool_use_id: id, content: 'Cancelled by user (abort)', is_error: true, aborted: true })
      }, { once: true })
    })
    return Promise.race([tool, aborted])
  }

  async executeBatch(
    blocks: ToolUseBlock[],
    onEvent: (event: ToolExecutionEvent) => void,
    signal?: AbortSignal
  ): Promise<ToolBatchResult[]> {
    const results = new Array<ToolBatchResult>(blocks.length)
    const batchAbort = new AbortController()

    const combinedSignal = signal
      ? AbortSignal.any([signal, batchAbort.signal])
      : batchAbort.signal

    const readIndices: number[] = []
    const writeIndices: number[] = []

    for (let i = 0; i < blocks.length; i++) {
      if (isReadTool(blocks[i].name)) {
        readIndices.push(i)
      } else {
        writeIndices.push(i)
      }
    }

    // Execute reads in parallel
    let readHadError = false
    if (readIndices.length > 0) {
      const semaphore = new Semaphore(MAX_CONCURRENCY)
      const readPromises = readIndices.map(async (idx) => {
        if (batchAbort.signal.aborted) {
          results[idx] = { tool_use_id: blocks[idx].id, content: 'Cancelled: sibling tool failed', is_error: true }
          return
        }
        await semaphore.acquire()
        try {
          if (batchAbort.signal.aborted) {
            results[idx] = { tool_use_id: blocks[idx].id, content: 'Cancelled: sibling tool failed', is_error: true }
            return
          }
          const toolSignal = LONG_RUNNING_TOOLS.has(blocks[idx].name)
            ? combinedSignal
            : AbortSignal.any([combinedSignal, AbortSignal.timeout(120_000)])
          const raced = await this.raceWithAbort(
            blocks[idx].name, blocks[idx].id, blocks[idx].input, onEvent, toolSignal
          )
          results[idx] = { tool_use_id: raced.tool_use_id, content: raced.content, is_error: raced.is_error }
          if (raced.is_error && !raced.aborted && !isJdcReadTool(blocks[idx].name)) {
            readHadError = true
          }
        } finally {
          semaphore.release()
        }
      })
      await Promise.all(readPromises)
    }

    if (readHadError) {
      batchAbort.abort()
    }

    // Execute writes serially
    for (const idx of writeIndices) {
      if (batchAbort.signal.aborted) {
        results[idx] = { tool_use_id: blocks[idx].id, content: 'Cancelled: sibling tool failed', is_error: true }
        continue
      }
      const toolSignal = LONG_RUNNING_TOOLS.has(blocks[idx].name)
        ? combinedSignal
        : AbortSignal.any([combinedSignal, AbortSignal.timeout(120_000)])
      const raced = await this.raceWithAbort(
        blocks[idx].name, blocks[idx].id, blocks[idx].input, onEvent, toolSignal
      )
      results[idx] = { tool_use_id: raced.tool_use_id, content: raced.content, is_error: raced.is_error }
      if (raced.is_error && !raced.aborted) {
        batchAbort.abort()
      }
    }

    // Fill any remaining nulls (safety)
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        results[i] = { tool_use_id: blocks[i].id, content: 'Cancelled: sibling tool failed', is_error: true }
      }
    }

    return results
  }
}
