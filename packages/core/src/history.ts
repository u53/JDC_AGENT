import Database from 'better-sqlite3'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Message } from './types.js'

export class ConversationHistory {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
    `)
  }

  createSession(id: string, projectName: string, cwd: string): void {
    const now = Date.now()
    this.db.prepare(
      'INSERT INTO sessions (id, project_name, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, projectName, cwd, now, now)
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), sessionId)
  }

  listSessions(cwd?: string): Array<{ id: string; projectName: string; cwd: string; title: string | null; createdAt: number; updatedAt: number }> {
    const query = cwd
      ? this.db.prepare('SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC')
      : this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
    const rows = cwd ? query.all(cwd) : query.all()
    return (rows as any[]).map(r => ({
      id: r.id, projectName: r.project_name, cwd: r.cwd,
      title: r.title, createdAt: r.created_at, updatedAt: r.updated_at,
    }))
  }

  addMessage(sessionId: string, message: Message): void {
    this.db.prepare(
      'INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(message.id, sessionId, message.role, JSON.stringify(message.content), message.timestamp)
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId)
  }

  getMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId) as any[]
    return rows.map(r => ({
      id: r.id, role: r.role, content: JSON.parse(r.content), timestamp: r.timestamp,
    }))
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }

  close(): void {
    this.db.close()
  }
}
