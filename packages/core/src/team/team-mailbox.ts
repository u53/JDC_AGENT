export interface MailboxMessage {
  id: string
  from: string
  content: string
  intent?: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  createdAt: number
}

export class Mailbox {
  private messages: MailboxMessage[] = []

  push(msg: MailboxMessage): void {
    this.messages.push(msg)
  }

  drain(): MailboxMessage[] {
    const all = this.messages
    this.messages = []
    return all
  }

  peek(): MailboxMessage[] {
    return [...this.messages]
  }

  get length(): number {
    return this.messages.length
  }
}

export class RingBuffer<T> {
  private buffer: T[] = []
  private capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  push(item: T): void {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift()
    }
    this.buffer.push(item)
  }

  getAll(): T[] {
    return [...this.buffer]
  }

  tail(n: number): T[] {
    return this.buffer.slice(-n)
  }

  get length(): number {
    return this.buffer.length
  }
}
