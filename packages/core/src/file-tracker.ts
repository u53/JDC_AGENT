import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { v4 as uuid } from 'uuid'
import type { ConversationHistory } from './history.js'

export interface FileSnapshot {
  id: string
  filePath: string
  contentBefore: string | null
  contentAfter: string
  toolUseId: string
  turnIndex: number
  timestamp: number
}

export interface FileChange {
  filePath: string
  changeType: 'created' | 'modified'
  snapshotCount: number
  lastModified: number
}

export class FileTracker {
  private history: ConversationHistory
  private sessionId: string

  constructor(history: ConversationHistory, sessionId: string) {
    this.history = history
    this.sessionId = sessionId
  }

  async captureBeforeState(filePath: string): Promise<string | null> {
    try {
      if (!existsSync(filePath)) return null
      return await readFile(filePath, 'utf-8')
    } catch {
      return null
    }
  }

  async recordChange(filePath: string, contentBefore: string | null, contentAfter: string, toolUseId: string, turnIndex: number): Promise<void> {
    this.history.addFileSnapshot({
      id: uuid(),
      sessionId: this.sessionId,
      filePath,
      contentBefore,
      contentAfter,
      toolUseId,
      turnIndex,
      timestamp: Date.now(),
    })
  }

  getChangedFiles(): FileChange[] {
    return this.history.getChangedFiles(this.sessionId) as FileChange[]
  }

  getFileHistory(filePath: string): FileSnapshot[] {
    return this.history.getFileHistory(this.sessionId, filePath) as FileSnapshot[]
  }

  getAllSnapshots(): FileSnapshot[] {
    return this.history.getFileSnapshots(this.sessionId) as FileSnapshot[]
  }

  getTurnDiffs(turnIndex: number): FileSnapshot[] {
    return this.history.getTurnSnapshots(this.sessionId, turnIndex) as FileSnapshot[]
  }

  async rewindFile(snapshotId: string): Promise<{ filePath: string; restoredTo: string }> {
    const snapshots = this.history.getFileSnapshots(this.sessionId)
    const snapshot = snapshots.find(s => s.id === snapshotId)
    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`)

    const content = snapshot.contentBefore
    if (content === null) {
      throw new Error('Cannot rewind: file did not exist before this change')
    }
    await writeFile(snapshot.filePath, content, 'utf-8')
    this.history.deleteFileSnapshot(snapshotId)
    return { filePath: snapshot.filePath, restoredTo: 'before this change' }
  }

  async rewindToTurn(turnIndex: number): Promise<string[]> {
    const allSnapshots = this.history.getFileSnapshots(this.sessionId)
    const fileFirstSnapshot = new Map<string, FileSnapshot>()

    for (const s of allSnapshots) {
      if (s.turnIndex > turnIndex) {
        if (!fileFirstSnapshot.has(s.filePath)) {
          fileFirstSnapshot.set(s.filePath, s as FileSnapshot)
        }
      }
    }

    const restored: string[] = []
    for (const [filePath, snapshot] of fileFirstSnapshot) {
      if (snapshot.contentBefore === null) {
        // File was created after this turn — could delete, but safer to skip
        continue
      }
      await writeFile(filePath, snapshot.contentBefore, 'utf-8')
      restored.push(filePath)
    }
    this.history.deleteFileSnapshotsAfterTurn(this.sessionId, turnIndex)
    return restored
  }

  acceptFile(filePath: string): void {
    this.history.acceptFile(this.sessionId, filePath)
  }

  acceptAllFiles(): void {
    this.history.acceptAllFiles(this.sessionId)
  }
}
