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
  'file_read', 'glob', 'grep', 'ls', 'tree',
  'web_fetch', 'web_search', 'lsp',
  'task_get', 'task_list', 'task_stop',
  'list_mcp_resources', 'read_mcp_resource', 'skill',
])

const LONG_RUNNING_TOOLS = new Set(['Agent', 'bash', 'monitor'])

const MAX_CONCURRENCY = 5

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
      if (READ_TOOLS.has(blocks[i].name)) {
        readIndices.push(i)
      } else {
        writeIndices.push(i)
      }
    }

    // Execute reads in parallel
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
          const result = await this.toolRunner.execute(
            blocks[idx].name, blocks[idx].id, blocks[idx].input, onEvent, toolSignal
          )
          results[idx] = { tool_use_id: blocks[idx].id, content: result.content, is_error: result.isError || false }
          if (result.isError) {
            batchAbort.abort()
          }
        } finally {
          semaphore.release()
        }
      })
      await Promise.all(readPromises)
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
      const result = await this.toolRunner.execute(
        blocks[idx].name, blocks[idx].id, blocks[idx].input, onEvent, toolSignal
      )
      results[idx] = { tool_use_id: blocks[idx].id, content: result.content, is_error: result.isError || false }
      if (result.isError) {
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
