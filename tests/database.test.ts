import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppDatabase } from '../src/main/database'
import type { Run } from '../src/shared/contracts'

const paths: string[] = []
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('transactional local persistence', () => {
  it('persists changes, messages, artifacts and evidence lineage', () => {
    const directory = mkdtempSync(join(tmpdir(), 'moxt-test-'))
    paths.push(directory)
    const db = new AppDatabase(join(directory, 'moxt.db'))
    const snapshot = db.snapshot([])
    const workspace = db.addWorkspace({ name: 'repo', path: directory, repoRoot: null, branch: null, baseCommit: null })
    const agentId = snapshot.agents[0].id
    const change = db.createChange({ title: 'Fix issue', description: 'Reproduce and fix', workflowType: 'bug-fix', priority: 'P1', workspaceIds: [workspace.id], agentIds: [agentId], agentBindings: [{ agentId, workspaceId: workspace.id, permissions: snapshot.agents[0].permissions }], tags: ['test'] })
    const artifact = db.createArtifact(change.id, 'REPORT', 'Root Cause', '# Evidence')
    db.approveArtifact(artifact.id, true)
    const restored = db.snapshot([])
    expect(restored.changes[0].id).toBe(change.id)
    expect(restored.messages.some(message => message.changeId === change.id)).toBe(true)
    expect(restored.artifacts[0].status).toBe('APPROVED')
  })

  it('recovers an interrupted run, session, task and workstream as one transaction', () => {
    const directory = mkdtempSync(join(tmpdir(), 'moxt-recovery-'))
    paths.push(directory)
    const databasePath = join(directory, 'moxt.db')
    const db = new AppDatabase(databasePath)
    const initial = db.snapshot([])
    const agent = initial.agents[0]
    const workspace = db.addWorkspace({ name: 'repo', path: directory, repoRoot: directory, branch: 'main', baseCommit: 'base' })
    const change = db.createChange({ title: 'Recover', description: 'Recover active domain state', workflowType: 'bug-fix', priority: 'P1', workspaceIds: [workspace.id], agentIds: [agent.id], agentBindings: [{ agentId: agent.id, workspaceId: workspace.id, permissions: agent.permissions }], tags: [] })
    const workstream = db.getWorkstream(change.id, agent.id)!
    const task = db.createTask({ changeId: change.id, workstreamId: workstream.id, phaseId: 'reproduce', title: 'Reproduce', description: 'Run case', assignedAgentId: agent.id, verifierAgentId: null, status: 'RUNNING', requiredEvidence: ['RUNTIME'], currentRunId: null, parentTaskId: null })
    const session = db.ensureAgentSession(change.id, agent.id, workspace.id, agent.runtime)
    const run: Run = { id: crypto.randomUUID(), changeId: change.id, agentId: agent.id, taskId: task.id, agentSessionId: session.id, parentRunId: null, status: 'RUNNING', prompt: 'reproduce', runtime: agent.runtime, executable: 'agent', workspacePath: directory, startedAt: new Date().toISOString(), endedAt: null, exitCode: null, sessionId: null, stdout: '', stderr: '', finalResponse: null, baseCommit: workspace.baseCommit, retryReason: null, evidence: [] }
    db.createRun(run)

    const restored = new AppDatabase(databasePath).snapshot([])
    expect(restored.runs.find(item => item.id === run.id)?.status).toBe('INTERRUPTED')
    expect(restored.tasks.find(item => item.id === task.id)?.status).toBe('BLOCKED')
    expect(restored.agentSessions.find(item => item.id === session.id)?.status).toBe('INTERRUPTED')
    expect(restored.workstreams.find(item => item.id === workstream.id)?.status).toBe('BLOCKED')
  })
})
