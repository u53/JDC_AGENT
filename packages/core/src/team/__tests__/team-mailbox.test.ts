import { describe, it, expect } from 'vitest'
import { Mailbox, RingBuffer } from '../team-mailbox.js'
import type { MailboxMessage } from '../team-mailbox.js'

function makeMsg(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return {
    id: overrides.id ?? 'msg-1',
    from: overrides.from ?? 'agent-a',
    content: overrides.content ?? 'hello',
    priority: overrides.priority ?? 'normal',
    createdAt: overrides.createdAt ?? Date.now(),
    ...(overrides.intent !== undefined ? { intent: overrides.intent } : {}),
  }
}

describe('Mailbox', () => {
  it('push adds messages and length reflects count', () => {
    const mb = new Mailbox()
    expect(mb.length).toBe(0)
    mb.push(makeMsg({ id: 'a' }))
    mb.push(makeMsg({ id: 'b' }))
    expect(mb.length).toBe(2)
  })

  it('drain returns all messages in FIFO order and clears', () => {
    const mb = new Mailbox()
    mb.push(makeMsg({ id: '1' }))
    mb.push(makeMsg({ id: '2' }))
    mb.push(makeMsg({ id: '3' }))
    const drained = mb.drain()
    expect(drained.map((m) => m.id)).toEqual(['1', '2', '3'])
    expect(mb.length).toBe(0)
    expect(mb.drain()).toEqual([])
  })

  it('peek returns copy without clearing', () => {
    const mb = new Mailbox()
    mb.push(makeMsg({ id: 'x' }))
    mb.push(makeMsg({ id: 'y' }))
    const peeked = mb.peek()
    expect(peeked.map((m) => m.id)).toEqual(['x', 'y'])
    expect(mb.length).toBe(2)
    // mutating returned array does not affect mailbox
    peeked.pop()
    expect(mb.length).toBe(2)
  })
})

describe('RingBuffer', () => {
  it('stores items up to capacity', () => {
    const rb = new RingBuffer<number>(3)
    rb.push(1)
    rb.push(2)
    rb.push(3)
    expect(rb.length).toBe(3)
    expect(rb.getAll()).toEqual([1, 2, 3])
  })

  it('overwrites oldest when full', () => {
    const rb = new RingBuffer<string>(3)
    rb.push('a')
    rb.push('b')
    rb.push('c')
    rb.push('d')
    expect(rb.length).toBe(3)
    expect(rb.getAll()).toEqual(['b', 'c', 'd'])
  })

  it('tail returns last N items', () => {
    const rb = new RingBuffer<number>(5)
    rb.push(10)
    rb.push(20)
    rb.push(30)
    rb.push(40)
    expect(rb.tail(2)).toEqual([30, 40])
    expect(rb.tail(10)).toEqual([10, 20, 30, 40])
  })

  it('getAll returns a copy', () => {
    const rb = new RingBuffer<number>(3)
    rb.push(1)
    rb.push(2)
    const copy = rb.getAll()
    copy.push(99)
    expect(rb.length).toBe(2)
    expect(rb.getAll()).toEqual([1, 2])
  })

  it('length reflects current count', () => {
    const rb = new RingBuffer<number>(2)
    expect(rb.length).toBe(0)
    rb.push(1)
    expect(rb.length).toBe(1)
    rb.push(2)
    expect(rb.length).toBe(2)
    rb.push(3)
    expect(rb.length).toBe(2)
  })
})
