import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveCodegraphBinary } from './binary.js'

export function isInitialized(cwd: string): boolean {
  return existsSync(path.join(cwd, '.codegraph', 'codegraph.db'))
}

interface RunResult {
  child: ChildProcess
  done: Promise<void>
}

function runCodegraph(args: string[], onProgress?: (line: string) => void): RunResult {
  const bin = resolveCodegraphBinary()
  if (!bin) throw new Error('CodeGraph binary not available on this host')
  // On Windows, .cmd/.bat files cannot be spawned directly — must go through shell
  const isWindowsBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
  const child = isWindowsBatch
    ? spawn(`"${bin}" ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      })
    : spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const errChunks: Buffer[] = []
  const forwardLines = (buf: Buffer) => {
    if (!onProgress) return
    const text = buf.toString('utf-8')
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (t) onProgress(t)
    }
  }
  child.stdout?.on('data', forwardLines)
  child.stderr?.on('data', (b: Buffer) => {
    errChunks.push(b)
    forwardLines(b)
  })
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`codegraph ${args.join(' ')} exit code ${code}${signal ? ` signal ${signal}` : ''}: ${Buffer.concat(errChunks).toString('utf-8').trim()}`))
    })
  })
  return { child, done }
}

export function init(cwd: string, onProgress?: (line: string) => void): Promise<void> & { cancel: () => void } {
  const { child, done } = runCodegraph(['init', cwd, '--index'], onProgress)
  const promise = done as Promise<void> & { cancel: () => void }
  promise.cancel = () => { try { child.kill('SIGTERM') } catch { /* ignore */ } }
  return promise
}

export function forceReindex(cwd: string, onProgress?: (line: string) => void): Promise<void> & { cancel: () => void } {
  const { child, done } = runCodegraph(['index', cwd, '--force'], onProgress)
  const promise = done as Promise<void> & { cancel: () => void }
  promise.cancel = () => { try { child.kill('SIGTERM') } catch { /* ignore */ } }
  return promise
}

export interface CodegraphProjectStatus {
  symbols: number
  lastIndexed: number
}

export async function getStatus(cwd: string): Promise<CodegraphProjectStatus | null> {
  if (!isInitialized(cwd)) return null
  try {
    const lines: string[] = []
    const { done } = runCodegraph(['status', cwd, '--json'], l => lines.push(l))
    await done
    const joined = lines.join('\n')
    const start = joined.indexOf('{')
    const end = joined.lastIndexOf('}')
    if (start < 0 || end < 0) return null
    const parsed = JSON.parse(joined.slice(start, end + 1))
    return {
      symbols: typeof parsed.symbols === 'number' ? parsed.symbols : 0,
      lastIndexed: typeof parsed.lastIndexed === 'number' ? parsed.lastIndexed : 0,
    }
  } catch {
    return null
  }
}
