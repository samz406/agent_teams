import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Sqlite from 'better-sqlite3'
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

  it('migrates existing conversations to sequenced incremental context without losing turns', () => {
    const directory = mkdtempSync(join(tmpdir(), 'moxt-conversation-migration-')); paths.push(directory)
    const databasePath = join(directory, 'moxt.db'); const legacy = new Sqlite(databasePath)
    legacy.exec(`
      CREATE TABLE t_conversation (id TEXT PRIMARY KEY,number INTEGER NOT NULL UNIQUE,title TEXT NOT NULL,topic TEXT NOT NULL,background TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,current_round INTEGER NOT NULL,max_rounds INTEGER NOT NULL,max_messages INTEGER NOT NULL,max_tokens INTEGER NOT NULL,message_count INTEGER NOT NULL,token_used INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE t_conversation_participant (id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,agent_id TEXT NOT NULL,role_name TEXT NOT NULL,role_prompt TEXT NOT NULL,speaking_order INTEGER NOT NULL,is_leader INTEGER NOT NULL,enabled INTEGER NOT NULL,native_session_id TEXT,created_at TEXT NOT NULL,UNIQUE(conversation_id,agent_id));
      CREATE TABLE t_conversation_turn (id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,round_id TEXT,participant_id TEXT,agent_id TEXT,speaker_type TEXT NOT NULL,speaker_name TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,error TEXT,created_at TEXT NOT NULL,completed_at TEXT);
      INSERT INTO t_conversation VALUES ('c',1,'title','topic','','roundtable','READY_TO_SUMMARIZE',1,1,200,1000000,1,30,'2026-01-01','2026-01-01');
      INSERT INTO t_conversation_participant VALUES ('p','c','a','顾问','',0,1,1,'native','2026-01-01');
      INSERT INTO t_conversation_turn VALUES ('t','c','r','p','a','leader','顾问','历史观点','COMPLETED',10,20,NULL,'2026-01-01','2026-01-01');
    `)
    legacy.close()
    const migrated = new AppDatabase(databasePath)
    const restored = migrated.snapshot([])
    expect(restored.conversations[0].stopReason).toBe('MAX_ROUNDS')
    expect(restored.conversationTurns[0]).toMatchObject({ sequence: 1, totalTokens: 30, content: '历史观点' })
    expect(restored.conversationParticipants[0]).toMatchObject({ lastSeenTurnSequence: 1, sessionGeneration: 1 })
    const executor = restored.agents[0]
    const hats = ['蓝帽主持人', '白帽·事实', '红帽·直觉', '黑帽·风险', '黄帽·价值', '绿帽·创意']
    const conversation = migrated.createConversation({ title: '六帽分析', topic: '是否进入新市场', background: '', mode: 'six-hats', maxRounds: 4, maxMessages: 100, maxTokens: 1000000, participants: hats.map((roleName, index) => ({ agentId: executor.id, roleName, rolePrompt: roleName, isLeader: index === 0 })) })
    expect(migrated.getConversationParticipants(conversation.id)).toHaveLength(6)
  })
})
