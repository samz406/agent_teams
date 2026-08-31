import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppDatabase } from '../src/main/database'
import { LeaderEngine } from '../src/runtime/leader-engine'
import type { Run } from '../src/shared/contracts'

const paths: string[] = []
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }) })

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'moxt-leader-')); paths.push(directory)
  const db = new AppDatabase(join(directory, 'db.sqlite')); const initial = db.snapshot([]); const agent = initial.agents[0]
  const workspace = db.addWorkspace({ name: 'repo', path: directory, repoRoot: directory, branch: 'main', baseCommit: 'base' })
  const change = db.createChange({ title: 'Change', description: 'Test evidence state machine', workflowType: 'cross-project', priority: 'P1', workspaceIds: [workspace.id], agentIds: [agent.id], agentBindings: [{ agentId: agent.id, workspaceId: workspace.id, permissions: agent.permissions }], tags: [] })
  return { db, agent, change, leader: new LeaderEngine(db, () => undefined) }
}

describe('evidence-driven leader state machine', () => {
  it('accepts a discovery task with runtime evidence and advances an AUTO phase', () => {
    const { db, agent, change, leader } = setup(); const task = leader.createTask(change, agent, 'Inspect repository')
    const run = createRun(change.id, agent.id, task.id); db.createRun(run); db.updateRun(run.id, { status: 'COMPLETED', exitCode: 0, finalResponse: 'Discovery complete' })
    db.addEvidence(run.id, { type: 'RUNTIME', title: 'Runtime exit', status: 'PASS', detail: 'exit 0' })
    expect(leader.onRunFinished(db.getRun(run.id)!)).toEqual({ accepted: true, reason: 'Evidence 满足当前阶段要求' })
    expect(db.getTask(task.id)?.status).toBe('ACCEPTED')
    expect(db.getChange(change.id)?.currentPhase).toBe(1)
  })

  it('rejects coding completion without diff and test evidence and creates a blocking issue', () => {
    const { db, agent, change, leader } = setup(); db.updateChangeState(change.id, 'RUNNING', 3)
    const current = db.getChange(change.id)!; const task = leader.createTask(current, agent, 'Implement change')
    const run = createRun(change.id, agent.id, task.id); db.createRun(run); db.updateRun(run.id, { status: 'COMPLETED', exitCode: 0, finalResponse: 'Done' })
    db.addEvidence(run.id, { type: 'RUNTIME', title: 'Runtime exit', status: 'PASS', detail: 'exit 0' })
    const result = leader.onRunFinished(db.getRun(run.id)!)
    expect(result.accepted).toBe(false)
    expect(db.getTask(task.id)?.status).toBe('REWORK')
    expect(db.snapshot([]).issues.some(issue => issue.severity === 'BLOCKING' && issue.status === 'OPEN')).toBe(true)
  })
})

function createRun(changeId: string, agentId: string, taskId: string): Run {
  return { id: crypto.randomUUID(), changeId, agentId, taskId, agentSessionId: null, parentRunId: null, status: 'QUEUED', prompt: 'task', runtime: 'claude', executable: 'claude', workspacePath: '/tmp', startedAt: null, endedAt: null, exitCode: null, sessionId: null, stdout: '', stderr: '', finalResponse: null, baseCommit: null, retryReason: null, evidence: [] }
}
