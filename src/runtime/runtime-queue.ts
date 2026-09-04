export type QueueState = "QUEUED" | "RUNNING" | "DONE" | "CANCELLED";
export type QueuePriority = "INTERACTIVE" | "SCHEDULED" | "BACKGROUND";

interface QueueEntry {
  id: string;
  run: () => Promise<void>;
  state: QueueState;
  priority: QueuePriority;
  enqueuedAt: number;
  done(): void;
}

export class RuntimeQueue {
  private pending: QueueEntry[] = [];
  private active = new Map<string, QueueEntry>();
  private idleWaiters: Array<() => void> = [];
  constructor(readonly concurrency: number) {
    if (concurrency < 1) throw new Error("concurrency 必须大于 0");
  }

  enqueue(
    id: string,
    run: () => Promise<void>,
    priority: QueuePriority = "INTERACTIVE",
  ): Promise<void> {
    return new Promise((resolve) => {
      this.pending.push({
        id,
        run,
        state: "QUEUED",
        priority,
        enqueuedAt: Date.now(),
        done: resolve,
      });
      this.drain();
    });
  }
  cancel(id: string): boolean {
    const index = this.pending.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const [entry] = this.pending.splice(index, 1);
    entry.state = "CANCELLED";
    entry.done();
    this.resolveIdle();
    return true;
  }
  stats(): { active: number; queued: number; concurrency: number } {
    return {
      active: this.active.size,
      queued: this.pending.length,
      concurrency: this.concurrency,
    };
  }
  onIdle(): Promise<void> {
    if (!this.active.size && !this.pending.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private drain(): void {
    while (this.active.size < this.concurrency && this.pending.length) {
      const index = this.nextIndex();
      if (index < 0) break;
      const [entry] = this.pending.splice(index, 1);
      entry.state = "RUNNING";
      this.active.set(entry.id, entry);
      void entry
        .run()
        .catch(() => undefined)
        .finally(() => {
          entry.state = "DONE";
          this.active.delete(entry.id);
          entry.done();
          this.drain();
          this.resolveIdle();
        });
    }
  }

  private nextIndex(): number {
    const rank: Record<QueuePriority, number> = {
      INTERACTIVE: 0,
      SCHEDULED: 1,
      BACKGROUND: 2,
    };
    const now = Date.now();
    const scored = this.pending
      .map((entry, index) => ({
        entry,
        index,
        effective: Math.max(
          0,
          rank[entry.priority] - Math.floor((now - entry.enqueuedAt) / 30_000),
        ),
      }))
      .sort(
        (a, b) =>
          a.effective - b.effective || a.entry.enqueuedAt - b.entry.enqueuedAt,
      );
    const candidate = scored[0];
    if (!candidate) return -1;
    const nonInteractiveActive = [...this.active.values()].filter(
      (item) => item.priority !== "INTERACTIVE",
    ).length;
    if (
      candidate.effective > 0 &&
      this.concurrency > 1 &&
      nonInteractiveActive >= this.concurrency - 1
    )
      return -1;
    return candidate.index;
  }

  private resolveIdle(): void {
    if (!this.active.size && !this.pending.length)
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
}
