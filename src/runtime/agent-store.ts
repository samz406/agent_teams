import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Agent, UpdateAgentInput } from '../shared/contracts'

const json = (value: unknown): string => JSON.stringify(value)
const now = (): string => new Date().toISOString()

export function updateAgentRecord(databasePath: string, input: UpdateAgentInput): Agent {
  const db = new Database(databasePath)
  db.pragma('busy_timeout = 5000')
  try {
    const current = db.prepare('SELECT * FROM t_agent WHERE id=?').get(input.id) as Record<string, unknown> | undefined
    if (!current) throw new Error('Agent 不存在')
    if (!input.name.trim() || !input.responsibility.trim()) throw new Error('Agent 名称和责任边界不能为空')
    db.prepare(`UPDATE t_agent SET
      name=@name, icon=@icon, description=@description, responsibility=@responsibility,
      quality_bar=@qualityBar, runtime=@runtime, command=@command, args_template=@argsTemplate,
      workspace_ids=@workspaceIds, permissions=@permissions
      WHERE id=@id`).run({
      ...input,
      qualityBar: json(input.qualityBar),
      workspaceIds: json(input.workspaceIds),
      permissions: json(input.permissions)
    })
    db.prepare('INSERT INTO t_event VALUES (?,?,?,?,?,?)').run(randomUUID(), 'agent', input.id, 'AGENT_UPDATED', json(input), now())
    return {
      ...input,
      status: current.status as Agent['status'],
      currentRunId: current.current_run_id === null ? null : String(current.current_run_id),
      createdAt: String(current.created_at)
    }
  } finally {
    db.close()
  }
}
