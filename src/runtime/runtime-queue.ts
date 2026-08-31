export type QueueState = 'QUEUED' | 'RUNNING' | 'DONE' | 'CANCELLED'

interface QueueEntry { id: string; run: () => Promise<void>; state: QueueState }

export class RuntimeQueue {
  private pending: QueueEntry[] = []
  private active = new Map<string, QueueEntry>()
  private idleWaiters: Array<() => void> = []
  constructor(readonly concurrency: number) { if (concurrency < 1) throw new Error('concurrency 必须大于 0') }

  enqueue(id: string, run: () => Promise<void>): void { this.pending.push({ id, run, state: 'QUEUED' }); this.drain() }
  cancel(id: string): boolean { const index = this.pending.findIndex(item => item.id === id); if (index < 0) return false; this.pending[index].state = 'CANCELLED'; this.pending.splice(index, 1); return true }
  stats(): { active: number; queued: number; concurrency: number } { return { active: this.active.size, queued: this.pending.length, concurrency: this.concurrency } }
  onIdle(): Promise<void> { if (!this.active.size && !this.pending.length) return Promise.resolve(); return new Promise(resolve => this.idleWaiters.push(resolve)) }

  private drain(): void {
    while (this.active.size < this.concurrency && this.pending.length) {
      const entry = this.pending.shift()!; entry.state = 'RUNNING'; this.active.set(entry.id, entry)
      void entry.run().finally(() => { entry.state = 'DONE'; this.active.delete(entry.id); this.drain(); if (!this.active.size && !this.pending.length) this.idleWaiters.splice(0).forEach(resolve => resolve()) })
    }
  }
}
