import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { v4 as uuid } from 'uuid'
import path from 'node:path'
import { RingBuffer } from './team/team-mailbox.js'
import type { TeamEvent, TeamMemberSpec, TeamMessage } from './team/team-types.js'
import { findGitBash } from './utils/shell-detection.js'

export type TaskType = 'shell' | 'agent' | 'team'

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
  private maxConcurrentAgents = 3
  private agentQueue: Array<{ resolve: () => void }> = []
  private mailboxes = new Map<string, TeamMessage[]>()
  private eventBuffers = new Map<string, RingBuffer<TeamEvent>>()

  constructor(logDir: string) {
    this.logDir = logDir
    mkdirSync(logDir, { recursive: true })
  }

  setOnComplete(cb: ((task: BackgroundTask) => void) | undefined): void {
    this.onComplete = cb
  }

  setMaxConcurrentAgents(max: number): void {
    this.maxConcurrentAgents = max
  }

  async acquireAgentSlot(): Promise<void> {
    const runningAgents = [...this.tasks.values()].filter(t => t.type === 'agent' && t.status === 'running').length
    if (runningAgents < this.maxConcurrentAgents) return
    return new Promise(resolve => {
      this.agentQueue.push({ resolve })
    })
  }

  private releaseAgentSlot(): void {
    const next = this.agentQueue.shift()
    if (next) next.resolve()
  }

  spawn(command: string, cwd: string, env?: Record<string, string>): BackgroundTask {
    const id = uuid().slice(0, 8)
    const logFile = path.join(this.logDir, `${id}.log`)
    writeFileSync(logFile, '')

    const isWindows = process.platform === 'win32'
    let shellCmd: string
    let shellArgs: string[]

    if (isWindows) {
      const gitBashPath = findGitBash()
      if (gitBashPath) {
        shellCmd = gitBashPath
        shellArgs = ['--login', '-c', command]
      } else {
        // Fall back to PowerShell if no Git Bash
        shellCmd = 'powershell.exe'
        shellArgs = ['-NoProfile', '-NonInteractive', '-Command', command]
      }
    } else {
      const userShell = process.env.SHELL || '/bin/bash'
      shellCmd = userShell
      shellArgs = ['-l', '-c', command]
    }

    const proc = spawn(shellCmd, shellArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWindows,
      windowsHide: true,
      env: env || process.env as Record<string, string>,
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
    this.releaseAgentSlot()
  }

  failAgent(id: string, error: string): void {
    const task = this.tasks.get(id)
    if (!task || task.type !== 'agent') return
    task.status = 'failed'
    task.completedAt = Date.now()
    task.result = error
    this.onComplete?.(task)
    this.releaseAgentSlot()
  }

  registerTeam(objective: string, members: TeamMemberSpec[]): BackgroundTask {
    const id = uuid().slice(0, 8)
    const logFile = path.join(this.logDir, `${id}.log`)
    writeFileSync(logFile, '')
    const task: BackgroundTask = {
      id,
      type: 'team',
      prompt: objective,
      pid: 0,
      status: 'running',
      logFile,
      startedAt: Date.now(),
    }
    this.tasks.set(id, task)
    this.mailboxes.set(id, [])
    this.eventBuffers.set(id, new RingBuffer<TeamEvent>(500))
    return task
  }

  completeTeam(id: string, result: { summary: string }): void {
    const task = this.tasks.get(id)
    if (!task || task.type !== 'team') return
    task.status = 'completed'
    task.completedAt = Date.now()
    task.result = result.summary
    this.onComplete?.(task)
  }

  failTeam(id: string, error: string): void {
    const task = this.tasks.get(id)
    if (!task || task.type !== 'team') return
    task.status = 'failed'
    task.completedAt = Date.now()
    task.result = error
    this.onComplete?.(task)
  }

  sendMessage(id: string, msg: TeamMessage): void {
    const mailbox = this.mailboxes.get(id)
    if (mailbox) mailbox.push(msg)
  }

  getMailbox(id: string): TeamMessage[] {
    return [...(this.mailboxes.get(id) || [])]
  }

  drainMailbox(id: string): TeamMessage[] {
    const mailbox = this.mailboxes.get(id)
    if (!mailbox) return []
    return mailbox.splice(0)
  }

  emitEvent(id: string, event: TeamEvent): void {
    const buffer = this.eventBuffers.get(id)
    if (buffer) buffer.push(event)
  }

  getEvents(id: string, tail?: number): TeamEvent[] {
    const buffer = this.eventBuffers.get(id)
    if (!buffer) return []
    if (tail) return buffer.tail(tail)
    return buffer.getAll()
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
      if (process.platform === 'win32') {
        try { spawn('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }) } catch {}
      } else {
        proc.kill('SIGTERM')
        setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 3000)
      }
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
