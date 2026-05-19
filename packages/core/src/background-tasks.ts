import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { v4 as uuid } from 'uuid'
import path from 'node:path'

export type TaskType = 'shell' | 'agent'

export interface BackgroundTask {
  id: string
  type: TaskType
  command?: string
  prompt?: string
  agentType?: string
  pid: number
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  logFile: string
  startedAt: number
  completedAt?: number
  result?: string
  turns?: number
  toolsUsed?: string[]
}

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>()
  private processes = new Map<string, ChildProcess>()
  private logDir: string
  private onComplete?: (task: BackgroundTask) => void

  constructor(logDir: string) {
    this.logDir = logDir
    mkdirSync(logDir, { recursive: true })
  }

  setOnComplete(cb: ((task: BackgroundTask) => void) | undefined): void {
    this.onComplete = cb
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
      type: 'shell',
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
      task.completedAt = Date.now()
      this.processes.delete(id)
      this.onComplete?.(task)
    })

    this.tasks.set(id, task)
    this.processes.set(id, proc)
    return task
  }

  registerAgent(prompt: string, agentType: string): BackgroundTask {
    const id = uuid().slice(0, 8)
    const logFile = path.join(this.logDir, `${id}.log`)
    writeFileSync(logFile, '')

    const task: BackgroundTask = {
      id,
      type: 'agent',
      prompt,
      agentType,
      pid: 0,
      status: 'running',
      logFile,
      startedAt: Date.now(),
    }

    this.tasks.set(id, task)
    return task
  }

  completeAgent(id: string, opts: { result?: string; turns?: number; toolsUsed?: string[] }): void {
    const task = this.tasks.get(id)
    if (!task || task.type !== 'agent') return
    task.status = 'completed'
    task.completedAt = Date.now()
    task.result = opts.result
    task.turns = opts.turns
    task.toolsUsed = opts.toolsUsed
    this.onComplete?.(task)
  }

  failAgent(id: string, error: string): void {
    const task = this.tasks.get(id)
    if (!task || task.type !== 'agent') return
    task.status = 'failed'
    task.completedAt = Date.now()
    task.result = error
    this.onComplete?.(task)
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
    } else {
      // Handle agent tasks that have no process
      const task = this.tasks.get(id)
      if (task && task.status === 'running') {
        task.status = 'failed'
        task.completedAt = Date.now()
      }
    }
  }

  stopAll(): void {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'running') {
        this.stop(id)
      }
    }
  }

  listRunning(): BackgroundTask[] {
    return [...this.tasks.values()].filter(t => t.status === 'running')
  }

  listAll(): BackgroundTask[] {
    return [...this.tasks.values()]
  }
}
