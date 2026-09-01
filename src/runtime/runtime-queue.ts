export type QueueState = 'QUEUED' | 'RUNNING' | 'DONE' | 'CANCELLED'

interface QueueEntry { id: string; run: () => Promise<void>; state: QueueState; done(): void }

export class RuntimeQueue {
  private pending: QueueEntry[] = []
  private active = new Map<string, QueueEntry>()
  private idleWaiters: Array<() => void> = []
  constructor(readonly concurrency: number) { if (concurrency < 1) throw new Error('concurrency 必须大于 0') }

  enqueue(id: string, run: () => Promise<void>): Promise<void> { return new Promise(resolve => { this.pending.push({ id, run, state: 'QUEUED', done: resolve }); this.drain() }) }
  cancel(id: string): boolean { const index = this.pending.findIndex(item => item.id === id); if (index < 0) return false; const [entry] = this.pending.splice(index, 1); entry.state = 'CANCELLED'; entry.done(); this.resolveIdle(); return true }
  stats(): { active: number; queued: number; concurrency: number } { return { active: this.active.size, queued: this.pending.length, concurrency: this.concurrency } }
  onIdle(): Promise<void> { if (!this.active.size && !this.pending.length) return Promise.resolve(); return new Promise(resolve => this.idleWaiters.push(resolve)) }

  private drain(): void {
    while (this.active.size < this.concurrency && this.pending.length) {
      const entry = this.pending.shift()!; entry.state = 'RUNNING'; this.active.set(entry.id, entry)
      void entry.run().catch(() => undefined).finally(() => { entry.state = 'DONE'; this.active.delete(entry.id); entry.done(); this.drain(); this.resolveIdle() })
    }
  }

  private resolveIdle(): void { if (!this.active.size && !this.pending.length) this.idleWaiters.splice(0).forEach(resolve => resolve()) }
}
