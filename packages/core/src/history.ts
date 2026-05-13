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
    this.db!.run('DELETE FROM messages WHERE session_id = ?', [sessionId])
    this.db!.run('DELETE FROM sessions WHERE id = ?', [sessionId])
    this.save()
  }

  close(): void {
    if (this.db) {
      this.save()
      this.db.close()
      this.db = null
    }
  }
}