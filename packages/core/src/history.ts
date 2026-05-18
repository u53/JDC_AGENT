import initSqlJs, { type Database } from 'sql.js'
import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { Message } from './types.js'

export class ConversationHistory {
  private db: Database | null = null
  private dbPath: string
  private ready: Promise<void>

  constructor(dbPath: string) {
    this.dbPath = dbPath
    mkdirSync(path.dirname(dbPath), { recursive: true })
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    const SQL = await initSqlJs()
    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath)
      this.db = new SQL.Database(buffer)
    } else {
      this.db = new SQL.Database()
    }
    this.migrate()
  }

  private migrate(): void {
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)
    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp)`)

    // Migration: add usage_data column
    try {
      this.db!.run(`ALTER TABLE sessions ADD COLUMN usage_data TEXT`)
    } catch {
      // Column already exists
    }

    // File snapshots table
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS file_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content_before TEXT,
        content_after TEXT NOT NULL,
        tool_use_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)
    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_session ON file_snapshots(session_id, timestamp)`)
    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_file ON file_snapshots(session_id, file_path)`)

    // Migration: add accepted column to file_snapshots
    try {
      this.db!.run(`ALTER TABLE file_snapshots ADD COLUMN accepted INTEGER DEFAULT 0`)
    } catch {
      // Column already exists
    }

    // Migration: recreate tasks table with composite primary key
    try {
      const tableInfo = this.db!.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'")
      if (tableInfo.length > 0 && tableInfo[0].values.length > 0) {
        const sql = tableInfo[0].values[0][0] as string
        if (sql.includes('id TEXT PRIMARY KEY')) {
          this.db!.run('DROP TABLE tasks')
        }
      }
    } catch {
      // Table doesn't exist yet, will be created below
    }

    // Tasks table
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (id, session_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)
    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, status)`)

    this.save()
  }

  private save(): void {
    const data = this.db!.export()
    writeFileSync(this.dbPath, Buffer.from(data))
  }

  async ensureReady(): Promise<void> {
    await this.ready
  }

  createSession(id: string, projectName: string, cwd: string): void {
    const now = Date.now()
    this.db!.run(
      'INSERT INTO sessions (id, project_name, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, projectName, cwd, now, now]
    )
    this.save()
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.db!.run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', [title, Date.now(), sessionId])
    this.save()
  }

  listSessions(cwd?: string): Array<{ id: string; projectName: string; cwd: string; title: string | null; createdAt: number; updatedAt: number }> {
    const stmt = cwd
      ? this.db!.prepare('SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC')
      : this.db!.prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
    if (cwd) stmt.bind([cwd])
    const results: any[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({
        id: row.id, projectName: row.project_name, cwd: row.cwd,
        title: row.title, createdAt: row.created_at, updatedAt: row.updated_at,
      })
    }
    stmt.free()
    return results
  }

  addMessage(sessionId: string, message: Message): void {
    this.db!.run(
      'INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
      [message.id, sessionId, message.role, JSON.stringify(message.content), message.timestamp]
    )
    this.db!.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [Date.now(), sessionId])
    this.save()
  }

  replaceMessages(sessionId: string, messages: Message[]): void {
    this.db!.run('DELETE FROM messages WHERE session_id = ?', [sessionId])
    for (const msg of messages) {
      this.db!.run(
        'INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
        [msg.id, sessionId, msg.role, JSON.stringify(msg.content), msg.timestamp]
      )
    }
    this.db!.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [Date.now(), sessionId])
    this.save()
  }

  getMessages(sessionId: string): Message[] {
    const stmt = this.db!.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC')
    stmt.bind([sessionId])
    const results: Message[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({
        id: row.id as string,
        role: row.role as any,
        content: JSON.parse(row.content as string),
        timestamp: row.timestamp as number,
      })
    }
    stmt.free()
    return results
  }

  deleteSession(sessionId: string): void {
    this.db!.run('DELETE FROM tasks WHERE session_id = ?', [sessionId])
    this.db!.run('DELETE FROM messages WHERE session_id = ?', [sessionId])
    this.db!.run('DELETE FROM sessions WHERE id = ?', [sessionId])
    this.save()
  }

  saveUsage(sessionId: string, usageData: string): void {
    this.db!.run('UPDATE sessions SET usage_data = ? WHERE id = ?', [usageData, sessionId])
    this.save()
  }

  getUsage(sessionId: string): string | null {
    const stmt = this.db!.prepare('SELECT usage_data FROM sessions WHERE id = ?')
    stmt.bind([sessionId])
    let result: string | null = null
    if (stmt.step()) {
      const row = stmt.getAsObject()
      result = (row.usage_data as string) || null
    }
    stmt.free()
    return result
  }

  addFileSnapshot(snapshot: { id: string; sessionId: string; filePath: string; contentBefore: string | null; contentAfter: string; toolUseId: string; turnIndex: number; timestamp: number }): void {
    this.db!.run(
      'INSERT INTO file_snapshots (id, session_id, file_path, content_before, content_after, tool_use_id, turn_index, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [snapshot.id, snapshot.sessionId, snapshot.filePath, snapshot.contentBefore, snapshot.contentAfter, snapshot.toolUseId, snapshot.turnIndex, snapshot.timestamp]
    )
    this.save()
  }

  getFileSnapshots(sessionId: string): Array<{ id: string; filePath: string; contentBefore: string | null; contentAfter: string; toolUseId: string; turnIndex: number; timestamp: number }> {
    const stmt = this.db!.prepare('SELECT * FROM file_snapshots WHERE session_id = ? ORDER BY timestamp ASC')
    stmt.bind([sessionId])
    const results: any[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({
        id: row.id, filePath: row.file_path, contentBefore: row.content_before,
        contentAfter: row.content_after, toolUseId: row.tool_use_id,
        turnIndex: row.turn_index, timestamp: row.timestamp,
      })
    }
    stmt.free()
    return results
  }

  getFileHistory(sessionId: string, filePath: string): Array<{ id: string; contentBefore: string | null; contentAfter: string; toolUseId: string; turnIndex: number; timestamp: number }> {
    const stmt = this.db!.prepare('SELECT * FROM file_snapshots WHERE session_id = ? AND file_path = ? ORDER BY timestamp ASC')
    stmt.bind([sessionId, filePath])
    const results: any[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({
        id: row.id, contentBefore: row.content_before, contentAfter: row.content_after,
        toolUseId: row.tool_use_id, turnIndex: row.turn_index, timestamp: row.timestamp,
      })
    }
    stmt.free()
    return results
  }

  getChangedFiles(sessionId: string): Array<{ filePath: string; changeType: string; snapshotCount: number; lastModified: number }> {
    const stmt = this.db!.prepare(`
      SELECT file_path, COUNT(*) as cnt, MAX(timestamp) as last_ts, MIN(content_before) as first_before
      FROM file_snapshots WHERE session_id = ? AND (accepted IS NULL OR accepted = 0) GROUP BY file_path ORDER BY last_ts DESC
    `)
    stmt.bind([sessionId])
    const results: any[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({
        filePath: row.file_path,
        changeType: row.first_before === null ? 'created' : 'modified',
        snapshotCount: row.cnt,
        lastModified: row.last_ts,
      })
    }
    stmt.free()
    return results
  }

  getTurnSnapshots(sessionId: string, turnIndex: number): Array<{ id: string; filePath: string; contentBefore: string | null; contentAfter: string; toolUseId: string; timestamp: number }> {
    const stmt = this.db!.prepare('SELECT * FROM file_snapshots WHERE session_id = ? AND turn_index = ? ORDER BY timestamp ASC')
    stmt.bind([sessionId, turnIndex])
    const results: any[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({
        id: row.id, filePath: row.file_path, contentBefore: row.content_before,
        contentAfter: row.content_after, toolUseId: row.tool_use_id, timestamp: row.timestamp,
      })
    }
    stmt.free()
    return results
  }

  deleteFileSnapshot(snapshotId: string): void {
    this.db!.run('DELETE FROM file_snapshots WHERE id = ?', [snapshotId])
    this.save()
  }

  deleteFileSnapshotsAfterTurn(sessionId: string, turnIndex: number): void {
    this.db!.run('DELETE FROM file_snapshots WHERE session_id = ? AND turn_index > ?', [sessionId, turnIndex])
    this.save()
  }

  acceptFile(sessionId: string, filePath: string): void {
    this.db!.run('UPDATE file_snapshots SET accepted = 1 WHERE session_id = ? AND file_path = ?', [sessionId, filePath])
    this.save()
  }

  acceptAllFiles(sessionId: string): void {
    this.db!.run('UPDATE file_snapshots SET accepted = 1 WHERE session_id = ?', [sessionId])
    this.save()
  }

  createTask(sessionId: string, id: string, subject: string, description: string): void {
    const now = Date.now()
    this.db!.run(
      'INSERT INTO tasks (id, session_id, subject, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, sessionId, subject, description, 'pending', now, now]
    )
    this.save()
  }

  updateTask(sessionId: string, id: string, updates: { status?: string; subject?: string; description?: string }): void {
    const parts: string[] = ['updated_at = ?']
    const values: any[] = [Date.now()]
    if (updates.status) { parts.push('status = ?'); values.push(updates.status) }
    if (updates.subject) { parts.push('subject = ?'); values.push(updates.subject) }
    if (updates.description) { parts.push('description = ?'); values.push(updates.description) }
    values.push(id, sessionId)
    this.db!.run(`UPDATE tasks SET ${parts.join(', ')} WHERE id = ? AND session_id = ?`, values)
    this.save()
  }

  deleteTask(sessionId: string, id: string): void {
    this.db!.run('DELETE FROM tasks WHERE id = ? AND session_id = ?', [id, sessionId])
    this.save()
  }

  getTasks(sessionId: string): Array<{ id: string; subject: string; description: string; status: string; createdAt: number; updatedAt: number }> {
    const stmt = this.db!.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC')
    stmt.bind([sessionId])
    const results: any[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({
        id: row.id, subject: row.subject, description: row.description || '',
        status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
      })
    }
    stmt.free()
    return results
  }

  getActiveTasks(sessionId: string): Array<{ id: string; subject: string; description: string; status: string }> {
    const stmt = this.db!.prepare("SELECT * FROM tasks WHERE session_id = ? AND status IN ('pending', 'in_progress') ORDER BY created_at ASC")
    stmt.bind([sessionId])
    const results: any[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({ id: row.id, subject: row.subject, description: row.description || '', status: row.status })
    }
    stmt.free()
    return results
  }

  close(): void {
    if (this.db) {
      this.save()
      this.db.close()
      this.db = null
    }
  }
}