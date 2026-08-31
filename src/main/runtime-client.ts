import { utilityProcess, type UtilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { RuntimeEvent, RuntimeProcessMessage, RuntimeRequest, RuntimeResponseEnvelope } from '../shared/contracts'

export class RuntimeClient {
  private child: UtilityProcess | null = null
  private pending = new Map<string, { resolve(value: unknown): void; reject(reason: Error): void }>()
  constructor(private dataDirectory: string, private onEvent: (event: RuntimeEvent) => void) {}

  request<T>(request: RuntimeRequest): Promise<T> {
    const child = this.ensureProcess(); const id = randomUUID()
    return new Promise<T>((resolve, reject) => { this.pending.set(id, { resolve: value => resolve(value as T), reject }); child.postMessage({ id, request }) })
  }
  close(): void { this.child?.kill(); this.child = null }

  private ensureProcess(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(join(__dirname, 'runtime.js'), [], { serviceName: 'Moxt Agent Runtime', env: { ...process.env, MOXT_DATA_DIR: this.dataDirectory }, stdio: 'pipe' })
    child.on('message', message => this.handleMessage(message as RuntimeProcessMessage))
    child.on('exit', code => {
      const error = new Error(`Agent Runtime Process 已退出（code=${code}）`)
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear(); this.child = null; this.onEvent({ type: 'runtime.notice', level: 'error', message: error.message })
    })
    child.stdout?.on('data', value => console.info(`[runtime] ${String(value).trimEnd()}`))
    child.stderr?.on('data', value => console.error(`[runtime] ${String(value).trimEnd()}`))
    this.child = child; return child
  }

  private handleMessage(message: RuntimeProcessMessage): void {
    if ('event' in message) { this.onEvent(message.event); return }
    const response = message as RuntimeResponseEnvelope; const pending = this.pending.get(response.id); if (!pending) return
    this.pending.delete(response.id); if (response.ok) pending.resolve(response.result); else pending.reject(new Error(response.error))
  }
}
