import type { VerificationRequirement } from './verification-requirements.js'

export type VerificationKind = 'build' | 'test' | 'typecheck' | 'lint' | 'diff_check'
export type VerificationCommandStatus = 'passed' | 'failed'
export type ChangedFileVerificationStatus = 'pending' | 'verified' | 'failed'
export type VerificationRequirementStatus = VerificationRequirement['status']

export interface ChangedFileRecord {
  filePath: string
  changedByToolUseId: string
  changedAt: number
  status: ChangedFileVerificationStatus
  verifiedByToolUseId?: string
  verificationFailure?: string
  updatedAt: number
}

export interface VerificationCommandRecord {
  toolUseId: string
  command: string
  kind: VerificationKind
  status: VerificationCommandStatus
  output: string
  createdAt: number
}

export interface VerificationRequirementRecord extends VerificationRequirement {
  kind: VerificationKind
  coveredChangedAt: number
  satisfiedByToolUseId?: string
  failure?: string
  updatedAt?: number
}

export class VerificationLedger {
  private changedFiles = new Map<string, ChangedFileRecord>()
  private commands: VerificationCommandRecord[] = []
  private requirements = new Map<string, VerificationRequirementRecord>()
  private now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }

  recordMutation(input: { filePath: string; toolUseId: string }): ChangedFileRecord {
    const timestamp = this.now()
    const record: ChangedFileRecord = {
      filePath: input.filePath,
      changedByToolUseId: input.toolUseId,
      changedAt: timestamp,
      status: 'pending',
      updatedAt: timestamp,
    }
    this.changedFiles.set(input.filePath, record)
    return record
  }

  recordCommand(input: {
    toolUseId: string
    command: string
    kind: VerificationKind
    status: VerificationCommandStatus
    output: string
  }): VerificationCommandRecord {
    const record: VerificationCommandRecord = {
      toolUseId: input.toolUseId,
      command: input.command,
      kind: input.kind,
      status: input.status,
      output: input.output,
      createdAt: this.now(),
    }
    this.commands.push(record)
    this.applyCommandToPendingChanges(record)
    this.applyCommandToRequirements(record)
    return record
  }

  setRequirements(requirements: VerificationRequirement[]): void {
    const nextIds = new Set(requirements.map((requirement) => requirement.id))
    for (const existingId of this.requirements.keys()) {
      if (!nextIds.has(existingId)) this.requirements.delete(existingId)
    }

    for (const requirement of requirements) {
      const coveredChangedAt = this.requirementChangedAt(requirement)
      const existing = this.requirements.get(requirement.id)
      if (existing && existing.status === 'passed' && sameRequirementWork(existing, requirement, coveredChangedAt)) continue
      this.requirements.set(requirement.id, {
        ...requirement,
        kind: requirement.kind,
        coveredChangedAt,
        updatedAt: this.now(),
      })
      for (const command of this.commands) {
        if (command.createdAt >= coveredChangedAt) {
          this.applyCommandToRequirement(this.requirements.get(requirement.id)!, command)
        }
      }
    }
  }

  getRequirements(): VerificationRequirementRecord[] {
    return [...this.requirements.values()]
  }

  getPendingRequirements(): VerificationRequirementRecord[] {
    return this.getRequirements().filter((requirement) => requirement.status === 'pending')
  }

  getUnavailableRequirements(): VerificationRequirementRecord[] {
    return this.getRequirements().filter((requirement) => requirement.status === 'unavailable')
  }

  getChangedFiles(): ChangedFileRecord[] {
    return [...this.changedFiles.values()]
  }

  getCommands(): VerificationCommandRecord[] {
    return [...this.commands]
  }

  clear(): void {
    this.changedFiles.clear()
    this.commands = []
    this.requirements.clear()
  }

  private applyCommandToPendingChanges(command: VerificationCommandRecord): void {
    for (const record of this.changedFiles.values()) {
      if (record.changedAt > command.createdAt) continue

      record.updatedAt = this.now()
      if (command.status === 'passed') {
        record.status = 'verified'
        record.verifiedByToolUseId = command.toolUseId
        delete record.verificationFailure
      } else {
        record.status = 'failed'
        record.verificationFailure = command.output.slice(0, 500)
      }
    }
  }

  private applyCommandToRequirements(command: VerificationCommandRecord): void {
    for (const requirement of this.requirements.values()) {
      this.applyCommandToRequirement(requirement, command)
    }
  }

  private applyCommandToRequirement(requirement: VerificationRequirementRecord, command: VerificationCommandRecord): void {
    if (requirement.kind !== command.kind || !commandsCoverSameScript(requirement.command, command.command, requirement.files)) return

    requirement.updatedAt = this.now()
    requirement.satisfiedByToolUseId = command.toolUseId
    if (command.status === 'passed') {
      requirement.status = 'passed'
      delete requirement.failure
    } else {
      requirement.status = 'failed'
      requirement.failure = command.output.slice(0, 500)
    }
  }

  private requirementChangedAt(requirement: VerificationRequirement): number {
    const changedAtValues = requirement.files
      .map(filePath => this.changedFiles.get(filePath)?.changedAt)
      .filter((changedAt): changedAt is number => typeof changedAt === 'number')
    if (changedAtValues.length === 0) return Number.NEGATIVE_INFINITY
    return Math.max(...changedAtValues)
  }
}

function sameRequirementWork(existing: VerificationRequirementRecord, next: VerificationRequirement, coveredChangedAt: number): boolean {
  return existing.kind === next.kind
    && commandsCoverSameScript(existing.command, next.command, next.files)
    && existing.coveredChangedAt === coveredChangedAt
    && sameStringArray(existing.files, next.files)
}

function commandsCoverSameScript(requirementCommand: string, actualCommand: string, files: string[]): boolean {
  if (requirementCommand === actualCommand) return true
  const requirement = parsePackageScriptCommand(requirementCommand)
  const actual = parsePackageScriptCommand(actualCommand)
  if (!requirement || !actual || requirement.script !== actual.script) return false
  return packageFiltersCoverFiles(actual.filters, files)
}

function parsePackageScriptCommand(command: string): { manager: string, script: string, filters: string[] } | undefined {
  const normalized = command.trim().replace(/\s+/g, ' ')
  const segment = normalized.split('&&').map(part => part.trim()).find(part => /^(pnpm|npm|yarn|bun)\b/.test(part))
  if (!segment) return undefined

  const tokens = segment.split(' ')
  const manager = tokens[0]
  const filters: string[] = []
  let script: string | undefined
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--filter' && tokens[index + 1]) {
      filters.push(tokens[index + 1])
      index += 1
      continue
    }
    if (token.startsWith('--filter=')) {
      filters.push(token.slice('--filter='.length))
      continue
    }
    if (token === 'run') continue
    if (!token.startsWith('-')) {
      script = token
      break
    }
  }
  if (!script || !['build', 'test', 'typecheck', 'lint'].includes(script)) return undefined
  return { manager, script, filters }
}

function packageFiltersCoverFiles(filters: string[], files: string[]): boolean {
  if (filters.length === 0) return true
  const requiredPackages = new Set(files.map(packageScopeForFile).filter((scope): scope is string => Boolean(scope)))
  if (requiredPackages.size === 0) return true
  for (const requiredPackage of requiredPackages) {
    if (!filters.some(filter => packageFilterMatchesScope(filter, requiredPackage))) return false
  }
  return true
}

function packageScopeForFile(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, '/')
  const match = normalized.match(/^packages\/([^/]+)\//)
  return match ? `@jdcagnet/${match[1]}` : undefined
}

function packageFilterMatchesScope(filter: string, scope: string): boolean {
  const normalized = filter.replace(/^['"]|['"]$/g, '')
  if (normalized === scope) return true
  const unscoped = scope.split('/').at(-1)
  return Boolean(unscoped && (normalized === unscoped || normalized === `./packages/${unscoped}` || normalized === `packages/${unscoped}`))
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}
