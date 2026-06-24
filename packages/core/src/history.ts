import initSqlJs, { type Database } from 'sql.js'
import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Message } from './types.js'
import type { PermissionMode } from './permissions.js'

const EXTERNAL_EVENT_STALE_MS = 10 * 60 * 1000

export interface ExternalConversationInput {
  channel: string
  bindingId: string
  tenantKey?: string
  chatId: string
  threadKey: string
  userKey?: string
  cwd: string
  sessionId: string
}

export interface ExternalConversationRecord extends ExternalConversationInput {
  id: string
  state: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}

export interface ExternalConversationLookup {
  channel: string
  bindingId: string
  tenantKey?: string
  chatId: string
  threadKey: string
  userKey?: string
}

export interface ExternalEventInput {
  channel: string
  eventId: string
  messageId?: string
  bindingId: string
}

export interface ExternalMessageMappingInput {
  channel: string
  bindingId: string
  sessionId: string
  feishuMessageId: string
  jdcMessageId?: string
  replyMessageId?: string
}

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

    // Migration: add model_id column (per-session model binding)
    try {
      this.db!.run(`ALTER TABLE sessions ADD COLUMN model_id TEXT`)
    } catch {
      // Column already exists
    }

    // Migration: add permission_mode column (per-session permission binding)
    try {
      this.db!.run(`ALTER TABLE sessions ADD COLUMN permission_mode TEXT`)
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

    // External conversations table
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS external_conversations (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        binding_id TEXT NOT NULL,
        tenant_key TEXT,
        chat_id TEXT NOT NULL,
        thread_key TEXT NOT NULL,
        user_key TEXT,
        cwd TEXT NOT NULL,
        session_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)
    this.db!.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_external_conversation_lookup
      ON external_conversations(channel, binding_id, COALESCE(tenant_key, ''), chat_id, thread_key, COALESCE(user_key, ''))
    `)

    // External events table (for deduplication)
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS external_events (
        channel TEXT NOT NULL,
        event_id TEXT NOT NULL,
        message_id TEXT,
        binding_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        processed_at INTEGER,
        status TEXT NOT NULL,
        PRIMARY KEY (channel, event_id)
      )
    `)

    // External messages table (correlation mapping)
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS external_messages (
        channel TEXT NOT NULL,
        binding_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        feishu_message_id TEXT NOT NULL,
        jdc_message_id TEXT,
        reply_message_id TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (channel, feishu_message_id)
      )
    `)

    this.save()
  }

  private save(): void {
    const data = this.db!.export()
    writeFileSync(this.dbPath, Buffer.from(data))
  }

  async ensureReady(): Promise<void> {
    await this.ready
  }

  createSession(id: string, projectName: string, cwd: string, options: { permissionMode?: PermissionMode } = {}): void {
    const now = Date.now()
    this.db!.run(
      'INSERT INTO sessions (id, project_name, cwd, permission_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, projectName, cwd, options.permissionMode ?? null, now, now]
    )
    this.save()
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.db!.run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', [title, Date.now(), sessionId])
    this.save()
  }

  listSessions(cwd?: string): Array<{ id: string; projectName: string; cwd: string; title: string | null; createdAt: number; updatedAt: number; permissionMode?: PermissionMode; externalChannel?: string }> {
    const stmt = cwd
      ? this.db!.prepare(`
        SELECT sessions.*, MIN(external_conversations.channel) AS external_channel
        FROM sessions
        LEFT JOIN external_conversations ON external_conversations.session_id = sessions.id AND external_conversations.state = 'active'
        WHERE sessions.cwd = ?
        GROUP BY sessions.id
        ORDER BY sessions.updated_at DESC
      `)
      : this.db!.prepare(`
        SELECT sessions.*, MIN(external_conversations.channel) AS external_channel
        FROM sessions
        LEFT JOIN external_conversations ON external_conversations.session_id = sessions.id AND external_conversations.state = 'active'
        GROUP BY sessions.id
        ORDER BY sessions.updated_at DESC
      `)
    if (cwd) stmt.bind([cwd])
    const results: any[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({
        id: row.id, projectName: row.project_name, cwd: row.cwd,
        title: row.title, createdAt: row.created_at, updatedAt: row.updated_at,
        ...((row.permission_mode as string | null) ? { permissionMode: row.permission_mode as PermissionMode } : {}),
        ...((row.external_channel as string | null) ? { externalChannel: row.external_channel as string } : {}),
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
    this.db!.run('DELETE FROM external_messages WHERE session_id = ?', [sessionId])
    this.db!.run('DELETE FROM external_conversations WHERE session_id = ?', [sessionId])
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

  setSessionModel(sessionId: string, modelId: string): void {
    this.db!.run('UPDATE sessions SET model_id = ?, updated_at = ? WHERE id = ?', [modelId, Date.now(), sessionId])
    this.save()
  }

  getSessionModel(sessionId: string): string | null {
    const stmt = this.db!.prepare('SELECT model_id FROM sessions WHERE id = ?')
    stmt.bind([sessionId])
    let result: string | null = null
    if (stmt.step()) {
      const row = stmt.getAsObject()
      result = (row.model_id as string) || null
    }
    stmt.free()
    return result
  }

  setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
    this.db!.run('UPDATE sessions SET permission_mode = ?, updated_at = ? WHERE id = ?', [mode, Date.now(), sessionId])
    this.save()
  }

  getSessionPermissionMode(sessionId: string): PermissionMode | null {
    const stmt = this.db!.prepare('SELECT permission_mode FROM sessions WHERE id = ?')
    stmt.bind([sessionId])
    let result: PermissionMode | null = null
    if (stmt.step()) {
      const row = stmt.getAsObject()
      const mode = row.permission_mode as string | null
      result = mode === 'strict' || mode === 'standard' || mode === 'relaxed' ? mode : null
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

  private externalConversationFromRow(row: any): ExternalConversationRecord {
    return {
      id: row.id as string,
      channel: row.channel as string,
      bindingId: row.binding_id as string,
      tenantKey: (row.tenant_key as string | null) ?? undefined,
      chatId: row.chat_id as string,
      threadKey: row.thread_key as string,
      userKey: (row.user_key as string | null) ?? undefined,
      cwd: row.cwd as string,
      sessionId: row.session_id as string,
      state: row.state as 'active' | 'archived',
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }
  }

  upsertExternalConversation(input: ExternalConversationInput): ExternalConversationRecord {
    const existing = this.findExternalConversation(input)
    const now = Date.now()

    if (existing) {
      this.db!.run(
        `UPDATE external_conversations
         SET cwd = ?, session_id = ?, state = ?, updated_at = ?
         WHERE id = ?`,
        [input.cwd, input.sessionId, 'active', now, existing.id]
      )
      this.save()
      return this.findExternalConversation(input)!
    }

    const id = randomUUID()
    this.db!.run(
      `INSERT INTO external_conversations (
        id, channel, binding_id, tenant_key, chat_id, thread_key, user_key,
        cwd, session_id, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.channel,
        input.bindingId,
        input.tenantKey ?? null,
        input.chatId,
        input.threadKey,
        input.userKey ?? null,
        input.cwd,
        input.sessionId,
        'active',
        now,
        now,
      ]
    )
    this.save()
    return this.findExternalConversation(input)!
  }

  findExternalConversation(input: ExternalConversationLookup): ExternalConversationRecord | null {
    const stmt = this.db!.prepare(`
      SELECT * FROM external_conversations
      WHERE channel = ?
        AND binding_id = ?
        AND COALESCE(tenant_key, '') = ?
        AND chat_id = ?
        AND thread_key = ?
        AND COALESCE(user_key, '') = ?
      LIMIT 1
    `)
    stmt.bind([
      input.channel,
      input.bindingId,
      input.tenantKey ?? '',
      input.chatId,
      input.threadKey,
      input.userKey ?? '',
    ])
    let result: ExternalConversationRecord | null = null
    if (stmt.step()) {
      result = this.externalConversationFromRow(stmt.getAsObject())
    }
    stmt.free()
    return result
  }

  beginExternalEvent(input: ExternalEventInput): { status: 'accepted' | 'duplicate' } {
    const now = Date.now()
    const stmt = this.db!.prepare('SELECT received_at, status FROM external_events WHERE channel = ? AND event_id = ? LIMIT 1')
    stmt.bind([input.channel, input.eventId])
    const exists = stmt.step()
    const row = exists ? stmt.getAsObject() : null
    stmt.free()

    if (row) {
      const status = row.status as string
      const receivedAt = Number(row.received_at) || 0
      const retryable = status === 'failed' || (status === 'accepted' && now - receivedAt > EXTERNAL_EVENT_STALE_MS)
      if (!retryable) {
        return { status: 'duplicate' }
      }

      this.db!.run(
        `UPDATE external_events
         SET message_id = ?, binding_id = ?, received_at = ?, processed_at = NULL, status = ?
         WHERE channel = ? AND event_id = ?`,
        [input.messageId ?? null, input.bindingId, now, 'accepted', input.channel, input.eventId]
      )
      this.save()
      return { status: 'accepted' }
    }

    this.db!.run(
      `INSERT INTO external_events (channel, event_id, message_id, binding_id, received_at, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.channel, input.eventId, input.messageId ?? null, input.bindingId, now, 'accepted']
    )
    this.save()
    return { status: 'accepted' }
  }

  completeExternalEvent(channel: string, eventId: string, status: 'processed' | 'failed'): void {
    this.db!.run(
      'UPDATE external_events SET processed_at = ?, status = ? WHERE channel = ? AND event_id = ?',
      [Date.now(), status, channel, eventId]
    )
    this.save()
  }

  addExternalMessageMapping(input: ExternalMessageMappingInput): void {
    this.db!.run(
      `INSERT OR REPLACE INTO external_messages (
        channel, binding_id, session_id, feishu_message_id, jdc_message_id, reply_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.channel,
        input.bindingId,
        input.sessionId,
        input.feishuMessageId,
        input.jdcMessageId ?? null,
        input.replyMessageId ?? null,
        Date.now(),
      ]
    )
    this.save()
  }

  listExternalMessageMappings(channel: string, sessionId: string): Array<ExternalMessageMappingInput & { createdAt: number }> {
    const stmt = this.db!.prepare(`
      SELECT * FROM external_messages
      WHERE channel = ? AND session_id = ?
      ORDER BY created_at ASC
    `)
    stmt.bind([channel, sessionId])
    const results: Array<ExternalMessageMappingInput & { createdAt: number }> = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push({
        channel: row.channel as string,
        bindingId: row.binding_id as string,
        sessionId: row.session_id as string,
        feishuMessageId: row.feishu_message_id as string,
        jdcMessageId: (row.jdc_message_id as string | null) ?? undefined,
        replyMessageId: (row.reply_message_id as string | null) ?? undefined,
        createdAt: row.created_at as number,
      })
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