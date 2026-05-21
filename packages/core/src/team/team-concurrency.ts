import type { TeamConcurrencyPolicy } from './team-types.js'

const READ_ONLY_TYPES = new Set(['explore', 'plan', 'security-auditor'])
const WRITE_TYPES = new Set(['general', 'refactor', 'frontend-designer'])
const SHELL_TYPES = new Set(['general', 'security-auditor'])

export class TeamConcurrencyController {
  private policy: TeamConcurrencyPolicy
  private running = new Map<string, string>() // memberId -> agentType

  constructor(policy: TeamConcurrencyPolicy) {
    this.policy = policy
  }

  canStart(agentType: string): boolean {
    const activeCount = this.running.size
    if (activeCount >= this.policy.maxActiveWorkers) return false

    if (READ_ONLY_TYPES.has(agentType)) {
      const readCount = [...this.running.values()].filter(t => READ_ONLY_TYPES.has(t)).length
      if (readCount >= this.policy.maxReadOnlyWorkers) return false
    }

    if (WRITE_TYPES.has(agentType)) {
      const writeCount = [...this.running.values()].filter(t => WRITE_TYPES.has(t)).length
      if (writeCount >= this.policy.maxWriteWorkers) return false
    }

    if (SHELL_TYPES.has(agentType)) {
      const shellCount = [...this.running.values()].filter(t => SHELL_TYPES.has(t)).length
      if (shellCount >= this.policy.maxShellWorkers) return false
    }

    return true
  }

  markRunning(memberId: string, agentType: string): void {
    this.running.set(memberId, agentType)
  }

  markDone(memberId: string): void {
    this.running.delete(memberId)
  }

  getActiveCount(): number {
    return this.running.size
  }

  isRunning(memberId: string): boolean {
    return this.running.has(memberId)
  }
}
