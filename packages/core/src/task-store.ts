export interface Task {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: number
}

export class TaskStore {
  private tasks = new Map<string, Task>()
  private nextId = 1

  create(subject: string, description: string): Task {
    const id = String(this.nextId++)
    const task: Task = {
      id,
      subject,
      description,
      status: 'pending',
      createdAt: Date.now(),
    }
    this.tasks.set(id, task)
    return task
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  list(): Task[] {
    return Array.from(this.tasks.values())
  }

  update(id: string, updates: Partial<Pick<Task, 'status' | 'subject' | 'description'>>): Task | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined
    if (updates.status !== undefined) task.status = updates.status
    if (updates.subject !== undefined) task.subject = updates.subject
    if (updates.description !== undefined) task.description = updates.description
    return task
  }

  delete(id: string): boolean {
    return this.tasks.delete(id)
  }
}
