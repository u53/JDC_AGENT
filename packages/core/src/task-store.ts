import type { ConversationHistory } from './history.js'

export interface Task {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: number
  updatedAt: number
}

export class TaskStore {
  private history: ConversationHistory
  private sessionId: string
  private nextId: number

  constructor(history: ConversationHistory, sessionId: string) {
    this.history = history
    this.sessionId = sessionId
    const existing = history.getTasks(sessionId)
    this.nextId = existing.length > 0
      ? Math.max(...existing.map(t => parseInt(t.id, 10) || 0)) + 1
      : 1
  }

  create(subject: string, description: string): Task {
    const id = String(this.nextId++)
    this.history.createTask(this.sessionId, id, subject, description)
    return { id, subject, description, status: 'pending', createdAt: Date.now(), updatedAt: Date.now() }
  }

  get(id: string): Task | undefined {
    const tasks = this.history.getTasks(this.sessionId)
    const t = tasks.find(t => t.id === id)
    if (!t) return undefined
    return { ...t, status: t.status as Task['status'] }
  }

  list(): Task[] {
    return this.history.getTasks(this.sessionId).map(t => ({ ...t, status: t.status as Task['status'] }))
  }

  update(id: string, updates: Partial<Pick<Task, 'status' | 'subject' | 'description'>>): Task | undefined {
    const task = this.get(id)
    if (!task) return undefined
    this.history.updateTask(this.sessionId, id, updates)
    return { ...task, ...updates, updatedAt: Date.now() }
  }

  delete(id: string): boolean {
    const task = this.get(id)
    if (!task) return false
    this.history.deleteTask(this.sessionId, id)
    return true
  }
}
