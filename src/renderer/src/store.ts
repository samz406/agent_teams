import { create } from 'zustand'
import type { AppSnapshot, RuntimeEvent } from '../../shared/contracts'

interface AppState {
  snapshot: AppSnapshot
  ready: boolean
  live: Record<string, string>
  notice: { type: 'success' | 'error'; text: string } | null
  load(): Promise<void>
  apply(event: RuntimeEvent): void
  notify(type: 'success' | 'error', text: string): void
}

const empty: AppSnapshot = { changes: [], agents: [], workspaces: [], runtimes: [], messages: [], runs: [], artifacts: [] }

export const useAppStore = create<AppState>((set) => ({
  snapshot: empty,
  ready: false,
  live: {},
  notice: null,
  load: async () => set({ snapshot: await window.moxt.getSnapshot(), ready: true }),
  apply: event => {
    if (event.type === 'snapshot.changed') set({ snapshot: event.snapshot })
    if (event.type === 'run.activity') set(state => ({ live: { ...state.live, [event.runId]: (state.live[event.runId] || '') + event.chunk } }))
    if (event.type === 'runtime.notice') set({ notice: { type: event.level === 'error' ? 'error' : 'success', text: event.message } })
  },
  notify: (type, text) => { set({ notice: { type, text } }); window.setTimeout(() => set({ notice: null }), 3500) }
}))

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error).replace(/^Error invoking remote method '[^']+': Error: /, '')
}
