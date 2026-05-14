import { describe, it, expect } from 'vitest'
import { TaskStore } from '../src/task-store.js'
import { createTaskCreateTool } from '../src/tools/task-create.js'
import { createTaskListTool } from '../src/tools/task-list.js'
import { createTaskUpdateTool } from '../src/tools/task-update.js'
import { createTaskGetTool } from '../src/tools/task-get.js'
import { createTaskStopTool } from '../src/tools/task-stop.js'
import { createTodoWriteTool } from '../src/tools/todo-write.js'
import type { ConversationHistory } from '../src/history.js'

function createMockHistory(): ConversationHistory {
  const tasks = new Map<string, any>()
  return {
    getTasks: (sessionId: string) => {
      const results: any[] = []
      for (const t of tasks.values()) {
        if (t.session_id === sessionId) {
          results.push({ id: t.id, subject: t.subject, description: t.description || '', status: t.status, createdAt: t.created_at, updatedAt: t.updated_at })
        }
      }
      return results.sort((a, b) => a.createdAt - b.createdAt)
    },
    createTask: (sessionId: string, id: string, subject: string, description: string) => {
      const now = Date.now()
      tasks.set(id, { id, session_id: sessionId, subject, description, status: 'pending', created_at: now, updated_at: now })
    },
    updateTask: (id: string, updates: any) => {
      const t = tasks.get(id)
      if (!t) return
      if (updates.status) t.status = updates.status
      if (updates.subject) t.subject = updates.subject
      if (updates.description) t.description = updates.description
      t.updated_at = Date.now()
    },
    deleteTask: (id: string) => { tasks.delete(id) },
    getActiveTasks: (sessionId: string) => {
      const results: any[] = []
      for (const t of tasks.values()) {
        if (t.session_id === sessionId && (t.status === 'pending' || t.status === 'in_progress')) {
          results.push({ id: t.id, subject: t.subject, description: t.description || '', status: t.status })
        }
      }
      return results.sort((a, b) => a.created_at - b.created_at)
    },
  } as unknown as ConversationHistory
}

describe('TaskStore and tools', () => {
  it('creates and lists tasks', async () => {
    const store = new TaskStore(createMockHistory(), 'sess1')
    const createTool = createTaskCreateTool(store)
    const listTool = createTaskListTool(store)
    await createTool.execute({ subject: 'Test task', description: 'Do something' }, { cwd: '/tmp' })
    const result = await listTool.execute({}, { cwd: '/tmp' })
    expect(result.content).toContain('Test task')
    expect(result.content).toContain('pending')
  })

  it('updates task status', async () => {
    const store = new TaskStore(createMockHistory(), 'sess1')
    store.create('Task 1', 'desc')
    const updateTool = createTaskUpdateTool(store)
    const result = await updateTool.execute({ taskId: '1', status: 'completed' }, { cwd: '/tmp' })
    expect(result.content).toContain('completed')
  })

  it('gets task details', async () => {
    const store = new TaskStore(createMockHistory(), 'sess1')
    store.create('My Task', 'detailed description')
    const getTool = createTaskGetTool(store)
    const result = await getTool.execute({ taskId: '1' }, { cwd: '/tmp' })
    expect(result.content).toContain('My Task')
    expect(result.content).toContain('detailed description')
  })

  it('stops (deletes) task', async () => {
    const store = new TaskStore(createMockHistory(), 'sess1')
    store.create('To delete', '')
    const stopTool = createTaskStopTool(store)
    const result = await stopTool.execute({ taskId: '1' }, { cwd: '/tmp' })
    expect(result.content).toContain('stopped')
    expect(store.list()).toHaveLength(0)
  })

  it('creates multiple tasks with todo_write', async () => {
    const store = new TaskStore(createMockHistory(), 'sess1')
    const todoTool = createTodoWriteTool(store)
    const result = await todoTool.execute({ todos: [{ subject: 'A' }, { subject: 'B', description: 'desc B' }] }, { cwd: '/tmp' })
    expect(result.content).toContain('Created 2 tasks')
    expect(store.list()).toHaveLength(2)
  })
})
