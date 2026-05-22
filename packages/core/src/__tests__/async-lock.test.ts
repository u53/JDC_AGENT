import { describe, it, expect } from 'vitest'
import { AsyncLock } from '../team/async-lock.js'

describe('AsyncLock', () => {
  it('serializes operations on the same key', async () => {
    const lock = new AsyncLock()
    const order: number[] = []
    const op = (id: number, delay: number) =>
      lock.run('k', async () => {
        await new Promise((r) => setTimeout(r, delay))
        order.push(id)
      })
    await Promise.all([op(1, 30), op(2, 10), op(3, 5)])
    expect(order).toEqual([1, 2, 3])
  })

  it('runs different keys in parallel', async () => {
    const lock = new AsyncLock()
    const start = Date.now()
    await Promise.all([
      lock.run('a', () => new Promise<void>((r) => setTimeout(r, 30))),
      lock.run('b', () => new Promise<void>((r) => setTimeout(r, 30))),
    ])
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(55)
  })

  it('releases the lock when the function throws', async () => {
    const lock = new AsyncLock()
    await expect(
      lock.run('k', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    let ran = false
    await lock.run('k', async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })
})
