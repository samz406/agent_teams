import { describe, expect, it } from 'vitest'
import { RuntimeQueue } from '../src/runtime/runtime-queue'

describe('runtime concurrency queue', () => {
  it('never runs more than the configured concurrency and drains pending work', async () => {
    const queue = new RuntimeQueue(2)
    let active = 0; let peak = 0; const completed: number[] = []
    const done = new Promise<void>(resolve => {
      for (let index = 0; index < 5; index++) queue.enqueue(String(index), async () => {
        active++; peak = Math.max(peak, active)
        await new Promise(next => setTimeout(next, 8))
        completed.push(index); active--
        if (completed.length === 5) resolve()
      })
    })
    await done; await queue.onIdle()
    expect(peak).toBe(2)
    expect(completed).toHaveLength(5)
    expect(queue.stats()).toEqual({ active: 0, queued: 0, concurrency: 2 })
  })

  it('can cancel work before it starts', async () => {
    const queue = new RuntimeQueue(1); let secondRan = false
    let release!: () => void
    queue.enqueue('first', () => new Promise<void>(resolve => { release = resolve }))
    queue.enqueue('second', async () => { secondRan = true })
    expect(queue.cancel('second')).toBe(true)
    release(); await new Promise(resolve => setTimeout(resolve, 1))
    expect(secondRan).toBe(false)
  })
})
