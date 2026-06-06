export type VerificationKind = 'build' | 'test' | 'typecheck' | 'lint'
export type VerificationCommandStatus = 'passed' | 'failed'
export type ChangedFileVerificationStatus = 'pending' | 'verified' | 'failed'

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

export class VerificationLedger {
  private changedFiles = new Map<string, ChangedFileRecord>()
  private commands: VerificationCommandRecord[] = []
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
    return record
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
}
