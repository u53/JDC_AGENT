import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { v4 as uuid } from 'uuid'
import path from 'node:path'

export interface BackgroundTask {
  id: string
  command: string
  pid: number
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  logFile: string
  startedAt: number
}

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>()
  private processes = new Map<string, ChildProcess>()
  private logDir: string

  constructor(logDir: string) {
    this.logDir = logDir
    mkdirSync(logDir, { recursive: true })
  }

  spawn(command: string, cwd: string): BackgroundTask {
    const id = uuid().slice(0, 8)
    const logFile = path.join(this.logDir, `${id}.log`)
    writeFileSync(logFile, '')

    const proc = spawn('sh', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    const task: BackgroundTask = {
      id,
      command,
      pid: proc.pid || 0,
      status: 'running',
      logFile,
      startedAt: Date.now(),
    }

    proc.stdout?.on('data', (data) => { appendFileSync(logFile, data.toString()) })
    proc.stderr?.on('data', (data) => { appendFileSync(logFile, data.toString()) })
    proc.on('close', (code) => {
      task.status = code === 0 ? 'completed' : 'failed'
      task.exitCode = code ?? 1
      this.processes.delete(id)
    })

    this.tasks.set(id, task)
    this.processes.set(id, proc)
    return task
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  getOutput(id: string, tail?: number): string {
    const task = this.tasks.get(id)
    if (!task) return ''
    try {
      const content = readFileSync(task.logFile, 'utf-8')
      if (tail) {
        const lines = content.split('\n')
        return lines.slice(-tail).join('\n')
      }
      return content
    } catch { return '' }
  }

  stop(id: string): void {
    const proc = this.processes.get(id)
    if (proc) {
      proc.kill('SIGTERM')
      setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 3000)
    }
  }

  stopAll(): void {
    for (const id of this.processes.keys()) { this.stop(id) }
  }

  listRunning(): BackgroundTask[] {
    return [...this.tasks.values()].filter(t => t.status === 'running')
  }
}
