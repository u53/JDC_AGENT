import path from 'node:path'
import type { TeamConcurrencyPolicy } from './team-types.js'

const READ_ONLY_TYPES = new Set(['explore', 'plan'])
const SHELL_TYPES = new Set(['security-auditor'])
const WRITE_TYPES = new Set(['general', 'refactor', 'frontend-designer'])

export interface FileLock {
  memberId: string
  filePath: string
  acquiredAt: number
}

export class TeamConcurrencyController {
  private policy: TeamConcurrencyPolicy
  private running = new Map<string, string>() // memberId -> agentType
  private fileLocks = new Map<string, FileLock>() // normalized path -> lock

  constructor(policy: TeamConcurrencyPolicy) {
    this.policy = policy
  }

  canStart(agentType: string): boolean {
    const activeCount = this.running.size
    if (activeCount >= this.policy.maxActiveWorkers) return false

    if (READ_ONLY_TYPES.has(agentType)) {
      const readCount = [...this.running.values()].filter(t => READ_ONLY_TYPES.has(t)).length
      if (readCount >= this.policy.maxReadOnlyWorkers) return false
    } else if (SHELL_TYPES.has(agentType)) {
      const shellCount = [...this.running.values()].filter(t => SHELL_TYPES.has(t)).length
      if (shellCount >= this.policy.maxShellWorkers) return false
    } else if (WRITE_TYPES.has(agentType)) {
      const writeCount = [...this.running.values()].filter(t => WRITE_TYPES.has(t)).length
      if (writeCount >= this.policy.maxWriteWorkers) return false
    }

    return true
  }

  markRunning(memberId: string, agentType: string): void {
    this.running.set(memberId, agentType)
  }

  markDone(memberId: string): void {
    this.running.delete(memberId)
    this.releaseAllLocks(memberId)
  }

  getActiveCount(): number {
    return this.running.size
  }

  isRunning(memberId: string): boolean {
    return this.running.has(memberId)
  }

  /**
   * Try to acquire a write lock on a file for a member.
   * Returns true if the lock was acquired, false if another member holds it.
   */
  acquireFileLock(memberId: string, filePath: string, cwd?: string): boolean {
    const normalized = cwd ? path.resolve(cwd, filePath) : filePath
    const existing = this.fileLocks.get(normalized)
    if (existing && existing.memberId !== memberId) {
      return false
    }
    this.fileLocks.set(normalized, { memberId, filePath: normalized, acquiredAt: Date.now() })
    return true
  }

  /**
   * Release a specific file lock held by a member.
   */
  releaseFileLock(memberId: string, filePath: string, cwd?: string): void {
    const normalized = cwd ? path.resolve(cwd, filePath) : filePath
    const existing = this.fileLocks.get(normalized)
    if (existing && existing.memberId === memberId) {
      this.fileLocks.delete(normalized)
    }
  }

  /**
   * Release all file locks held by a member (called on task completion).
   */
  releaseAllLocks(memberId: string): void {
    for (const [path, lock] of this.fileLocks) {
      if (lock.memberId === memberId) {
        this.fileLocks.delete(path)
      }
    }
  }

  /**
   * Check if a file is locked by another member.
   */
  isFileLocked(filePath: string, excludeMemberId?: string, cwd?: string): boolean {
    const normalized = cwd ? path.resolve(cwd, filePath) : filePath
    const lock = this.fileLocks.get(normalized)
    if (!lock) return false
    if (excludeMemberId && lock.memberId === excludeMemberId) return false
    return true
  }

  /**
   * Get all current file locks (for debugging/status).
   */
  getFileLocks(): FileLock[] {
    return [...this.fileLocks.values()]
  }
}
