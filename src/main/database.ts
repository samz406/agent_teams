import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Agent, AgentSession, AgentWorkspaceBinding, AppSnapshot, Artifact, Change, Conversation, ConversationDeliverable, ConversationMemory, ConversationParticipant, ConversationRound, ConversationStatus, ConversationTurn, CreateAgentInput, CreateChangeInput, CreateConversationInput, Evidence, Handoff, HumanIntervention, Issue, IssueStatus, Message, Run, RuntimeInfo, Task, TaskStatus, Workspace, Workstream } from '../shared/contracts'

const now = (): string => new Date().toISOString()
const json = (value: unknown): string => JSON.stringify(value)
const parse = <T>(value: string | null | undefined, fallback: T): T => value ? JSON.parse(value) as T : fallback

export class AppDatabase {
  private db: Database.Database

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
    this.recoverInterruptedRuns()
    this.seedAgents()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS t_workspace (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        repo_root TEXT, branch TEXT, base_commit TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_agent (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, description TEXT NOT NULL,
        responsibility TEXT NOT NULL, quality_bar TEXT NOT NULL, runtime TEXT NOT NULL,
        command TEXT, args_template TEXT, workspace_ids TEXT NOT NULL, permissions TEXT NOT NULL,
        status TEXT NOT NULL, current_run_id TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_change (
        id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
        workflow_type TEXT NOT NULL, priority TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL,
        current_phase INTEGER NOT NULL, workspace_ids TEXT NOT NULL, agent_ids TEXT NOT NULL,
        tags TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_message (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, sender_type TEXT NOT NULL, sender_id TEXT,
        sender_name TEXT NOT NULL, content TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(change_id) REFERENCES t_change(id)
      );
      CREATE TABLE IF NOT EXISTS t_run (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, agent_id TEXT NOT NULL, parent_run_id TEXT,
        task_id TEXT, agent_session_id TEXT,
        status TEXT NOT NULL, prompt TEXT NOT NULL, runtime TEXT NOT NULL, executable TEXT NOT NULL,
        workspace_path TEXT NOT NULL, started_at TEXT, ended_at TEXT, exit_code INTEGER,
        session_id TEXT, stdout TEXT NOT NULL DEFAULT '', stderr TEXT NOT NULL DEFAULT '',
        final_response TEXT, base_commit TEXT, retry_reason TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(change_id) REFERENCES t_change(id), FOREIGN KEY(agent_id) REFERENCES t_agent(id)
      );
      CREATE TABLE IF NOT EXISTS t_evidence (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
        status TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES t_run(id)
      );
      CREATE TABLE IF NOT EXISTS t_artifact (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, content TEXT NOT NULL, supersedes TEXT,
        created_at TEXT NOT NULL, approved_at TEXT,
        FOREIGN KEY(change_id) REFERENCES t_change(id)
      );
      CREATE TABLE IF NOT EXISTS t_event (
        id TEXT PRIMARY KEY, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_agent_workspace (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, agent_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        permissions TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(change_id, agent_id, workspace_id)
      );
      CREATE TABLE IF NOT EXISTS t_workstream (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        name TEXT NOT NULL, status TEXT NOT NULL, worktree_path TEXT, branch TEXT, base_commit TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_task (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, workstream_id TEXT, phase_id TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL, assigned_agent_id TEXT NOT NULL,
        verifier_agent_id TEXT, status TEXT NOT NULL, required_evidence TEXT NOT NULL,
        current_run_id TEXT, parent_task_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_agent_session (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, agent_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        native_session_id TEXT, runtime TEXT NOT NULL, status TEXT NOT NULL, summary TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(change_id, agent_id, workspace_id)
      );
      CREATE TABLE IF NOT EXISTS t_handoff (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, from_task_id TEXT, from_agent_id TEXT,
        to_task_id TEXT, to_agent_id TEXT, deliverable TEXT NOT NULL, evidence_ids TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, accepted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS t_issue (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, task_id TEXT, owner_agent_id TEXT,
        title TEXT NOT NULL, description TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL,
        source_evidence_id TEXT, resolution TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_human_intervention (
        id TEXT PRIMARY KEY, change_id TEXT NOT NULL, target_agent_id TEXT, affected_run_id TEXT,
        reason TEXT NOT NULL, new_constraints TEXT NOT NULL, operator TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_conversation (
        id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, title TEXT NOT NULL, topic TEXT NOT NULL,
        background TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, current_round INTEGER NOT NULL,
        max_rounds INTEGER NOT NULL, max_messages INTEGER NOT NULL, max_tokens INTEGER NOT NULL,
        message_count INTEGER NOT NULL, token_used INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_conversation_participant (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL, role_name TEXT NOT NULL,
        role_prompt TEXT NOT NULL, speaking_order INTEGER NOT NULL, is_leader INTEGER NOT NULL,
        enabled INTEGER NOT NULL, native_session_id TEXT, created_at TEXT NOT NULL,
        UNIQUE(conversation_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS t_conversation_round (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, number INTEGER NOT NULL, focus TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
        UNIQUE(conversation_id, number)
      );
      CREATE TABLE IF NOT EXISTS t_conversation_turn (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, round_id TEXT, participant_id TEXT, agent_id TEXT,
        speaker_type TEXT NOT NULL, speaker_name TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, error TEXT,
        created_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS t_conversation_memory (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL, summary TEXT NOT NULL,
        consensus TEXT NOT NULL, disagreements TEXT NOT NULL, open_questions TEXT NOT NULL,
        user_preferences TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_conversation_deliverable (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
        content TEXT NOT NULL, status TEXT NOT NULL, converted_change_id TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_change ON t_message(change_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_run_change ON t_run(change_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_event_aggregate ON t_event(aggregate_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_task_change_phase ON t_task(change_id, phase_id, status);
      CREATE INDEX IF NOT EXISTS idx_issue_change ON t_issue(change_id, status, severity);
      CREATE INDEX IF NOT EXISTS idx_session_agent ON t_agent_session(change_id, agent_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_status ON t_conversation(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversation_turn ON t_conversation_turn(conversation_id, created_at);
    `)
    this.ensureColumn('t_run', 'task_id', 'TEXT')
    this.ensureColumn('t_run', 'agent_session_id', 'TEXT')
  }

  private ensureColumn(table: string, column: string, type: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some(item => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }

  private recoverInterruptedRuns(): void {
    const affected = this.db.prepare("SELECT id, task_id, agent_session_id FROM t_run WHERE status IN ('QUEUED','STARTING','RUNNING')").all() as Array<{ id: string; task_id: string | null; agent_session_id: string | null }>
    const recoveredAt = now()
    const tx = this.db.transaction(() => {
      for (const row of affected) {
        this.db.prepare("UPDATE t_run SET status='INTERRUPTED', ended_at=? WHERE id=?").run(recoveredAt, row.id)
        if (row.task_id) {
          this.db.prepare("UPDATE t_task SET status='BLOCKED', updated_at=? WHERE id=? AND status IN ('ASSIGNED','QUEUED','RUNNING','RUN_COMPLETED','VERIFYING')").run(recoveredAt, row.task_id)
          this.event('task', row.task_id, 'TASK_BLOCKED', { reason: 'Runtime process restarted while Task was active', runId: row.id })
        }
        if (row.agent_session_id) this.db.prepare("UPDATE t_agent_session SET status='INTERRUPTED', updated_at=? WHERE id=?").run(recoveredAt, row.agent_session_id)
        this.event('run', row.id, 'RUN_INTERRUPTED', { reason: 'Application restarted while run was active' })
      }
      this.db.prepare("UPDATE t_agent SET status='IDLE', current_run_id=NULL WHERE status='RUNNING'").run()
      this.db.prepare("UPDATE t_workstream SET status='BLOCKED', updated_at=? WHERE id IN (SELECT DISTINCT workstream_id FROM t_task WHERE status='BLOCKED' AND workstream_id IS NOT NULL)").run(recoveredAt)
      this.db.prepare("UPDATE t_conversation SET status='PAUSED', updated_at=? WHERE status='RUNNING'").run(recoveredAt)
      this.db.prepare("UPDATE t_conversation_round SET status='INTERRUPTED', completed_at=? WHERE status='RUNNING'").run(recoveredAt)
      this.db.prepare("UPDATE t_conversation_turn SET status='FAILED', error='Runtime process restarted', completed_at=? WHERE status IN ('QUEUED','RUNNING')").run(recoveredAt)
      this.db.prepare("UPDATE t_conversation SET current_round=COALESCE((SELECT MAX(number) FROM t_conversation_round WHERE conversation_id=t_conversation.id),current_round) WHERE status='PAUSED'").run()
    })
    tx()
  }

  private seedAgents(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM t_agent').get() as { count: number }).count
    if (count) return
    const defaults: CreateAgentInput[] = [
      { name: 'Leader', icon: 'L', description: '团队负责人', responsibility: '理解目标、分派任务、检查真实证据并推进 Workflow', qualityBar: ['不以 exit 0 直接判定任务完成', '重大取舍升级给用户'], runtime: 'claude', command: null, argsTemplate: null, workspaceIds: [], permissions: fullPermissions(true) },
      { name: 'Code Agent', icon: 'C', description: '实现与修复专家', responsibility: '阅读代码、完成最小范围实现并提供测试和 Diff 证据', qualityBar: ['保持兼容', '变更必须有验证'], runtime: 'codex', command: null, argsTemplate: null, workspaceIds: [], permissions: fullPermissions(true) },
      { name: 'Architect', icon: 'A', description: '架构与边界审查', responsibility: '分析系统边界、契约、风险与演进路径', qualityBar: ['结论必须关联源码或 Artifact'], runtime: 'claude', command: null, argsTemplate: null, workspaceIds: [], permissions: fullPermissions(false) },
      { name: 'QA Agent', icon: 'Q', description: '独立验证专家', responsibility: '构建复现、执行独立验证与回归检查', qualityBar: ['不接受实现者自验替代独立验证'], runtime: 'codex', command: null, argsTemplate: null, workspaceIds: [], permissions: fullPermissions(false) }
    ]
    for (const agent of defaults) this.createAgent(agent)
  }

  snapshot(runtimes: RuntimeInfo[]): AppSnapshot {
    return {
      changes: (this.db.prepare('SELECT * FROM t_change ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(mapChange),
      agents: (this.db.prepare('SELECT * FROM t_agent ORDER BY created_at').all() as Record<string, unknown>[]).map(mapAgent),
      workspaces: (this.db.prepare('SELECT * FROM t_workspace ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(mapWorkspace),
      runtimes,
      messages: (this.db.prepare('SELECT * FROM t_message ORDER BY created_at').all() as Record<string, unknown>[]).map(mapMessage),
      runs: (this.db.prepare('SELECT * FROM t_run ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(row => this.mapRun(row)),
      artifacts: (this.db.prepare('SELECT * FROM t_artifact ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(mapArtifact),
      bindings: (this.db.prepare('SELECT * FROM t_agent_workspace ORDER BY created_at').all() as Record<string, unknown>[]).map(mapBinding),
      workstreams: (this.db.prepare('SELECT * FROM t_workstream ORDER BY created_at').all() as Record<string, unknown>[]).map(mapWorkstream),
      tasks: (this.db.prepare('SELECT * FROM t_task ORDER BY created_at').all() as Record<string, unknown>[]).map(mapTask),
      agentSessions: (this.db.prepare('SELECT * FROM t_agent_session ORDER BY created_at').all() as Record<string, unknown>[]).map(mapAgentSession),
      handoffs: (this.db.prepare('SELECT * FROM t_handoff ORDER BY created_at').all() as Record<string, unknown>[]).map(mapHandoff),
      issues: (this.db.prepare('SELECT * FROM t_issue ORDER BY created_at').all() as Record<string, unknown>[]).map(mapIssue),
      interventions: (this.db.prepare('SELECT * FROM t_human_intervention ORDER BY created_at').all() as Record<string, unknown>[]).map(mapIntervention),
      conversations: (this.db.prepare('SELECT * FROM t_conversation ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(mapConversation),
      conversationParticipants: (this.db.prepare('SELECT * FROM t_conversation_participant ORDER BY speaking_order').all() as Record<string, unknown>[]).map(mapConversationParticipant),
      conversationRounds: (this.db.prepare('SELECT * FROM t_conversation_round ORDER BY conversation_id,number').all() as Record<string, unknown>[]).map(mapConversationRound),
      conversationTurns: (this.db.prepare('SELECT * FROM t_conversation_turn ORDER BY created_at').all() as Record<string, unknown>[]).map(mapConversationTurn),
      conversationMemories: (this.db.prepare('SELECT * FROM t_conversation_memory ORDER BY updated_at').all() as Record<string, unknown>[]).map(mapConversationMemory),
      conversationDeliverables: (this.db.prepare('SELECT * FROM t_conversation_deliverable ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(mapConversationDeliverable)
    }
  }

  addWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt'>): Workspace {
    const existing = this.db.prepare('SELECT * FROM t_workspace WHERE path=?').get(workspace.path) as Record<string, unknown> | undefined
    if (existing) return mapWorkspace(existing)
    const value: Workspace = { ...workspace, id: randomUUID(), createdAt: now() }
    this.db.prepare('INSERT INTO t_workspace VALUES (@id,@name,@path,@repoRoot,@branch,@baseCommit,@createdAt)').run(value)
    this.event('workspace', value.id, 'WORKSPACE_ADDED', value)
    return value
  }

  createAgent(input: CreateAgentInput): Agent {
    const value: Agent = { ...input, id: randomUUID(), status: 'IDLE', currentRunId: null, createdAt: now() }
    this.db.prepare(`INSERT INTO t_agent (id,name,icon,description,responsibility,quality_bar,runtime,command,args_template,workspace_ids,permissions,status,current_run_id,created_at)
      VALUES (@id,@name,@icon,@description,@responsibility,@qualityBar,@runtime,@command,@argsTemplate,@workspaceIds,@permissions,@status,@currentRunId,@createdAt)`)
      .run({ ...value, qualityBar: json(value.qualityBar), workspaceIds: json(value.workspaceIds), permissions: json(value.permissions) })
    this.event('agent', value.id, 'AGENT_CREATED', value)
    return value
  }

  createChange(input: CreateChangeInput): Change {
    const number = ((this.db.prepare('SELECT MAX(number) AS n FROM t_change').get() as { n: number | null }).n ?? 1023) + 1
    const time = now()
    const value: Change = { ...input, id: randomUUID(), number, dueDate: input.dueDate ?? null, status: 'RUNNING', currentPhase: 0, createdAt: time, updatedAt: time }
    const tx = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO t_change (id,number,title,description,workflow_type,priority,due_date,status,current_phase,workspace_ids,agent_ids,tags,created_at,updated_at)
        VALUES (@id,@number,@title,@description,@workflowType,@priority,@dueDate,@status,@currentPhase,@workspaceIds,@agentIds,@tags,@createdAt,@updatedAt)`)
        .run({ ...value, workspaceIds: json(value.workspaceIds), agentIds: json(value.agentIds), tags: json(value.tags) })
      for (const binding of input.agentBindings) {
        const id = randomUUID()
        this.db.prepare('INSERT INTO t_agent_workspace VALUES (?,?,?,?,?,?)').run(id, value.id, binding.agentId, binding.workspaceId, json(binding.permissions), time)
        const workspace = this.getWorkspace(binding.workspaceId)
        this.db.prepare('INSERT INTO t_workstream VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), value.id, binding.workspaceId, binding.agentId, `${workspace?.name ?? 'Workspace'} · ${binding.agentId.slice(0, 6)}`, 'READY', null, null, workspace?.baseCommit ?? null, time, time)
      }
      this.addMessage(value.id, 'system', null, 'System', `任务 #${number} 已创建。Workspace 与 Agent 已就绪，当前进入 Discovery。`, null)
      this.event('change', value.id, 'CHANGE_CREATED', value)
    })
    tx()
    return value
  }

  addMessage(changeId: string, senderType: Message['senderType'], senderId: string | null, senderName: string, content: string, runId: string | null): Message {
    const value: Message = { id: randomUUID(), changeId, senderType, senderId, senderName, content, runId, createdAt: now() }
    this.db.prepare('INSERT INTO t_message VALUES (@id,@changeId,@senderType,@senderId,@senderName,@content,@runId,@createdAt)').run(value)
    this.event('change', changeId, 'MESSAGE_CREATED', value)
    return value
  }

  getAgent(id: string): Agent | undefined {
    const row = this.db.prepare('SELECT * FROM t_agent WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? mapAgent(row) : undefined
  }

  getChange(id: string): Change | undefined {
    const row = this.db.prepare('SELECT * FROM t_change WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? mapChange(row) : undefined
  }

  getWorkspace(id: string): Workspace | undefined {
    const row = this.db.prepare('SELECT * FROM t_workspace WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? mapWorkspace(row) : undefined
  }

  createRun(value: Run): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO t_run (id,change_id,agent_id,parent_run_id,task_id,agent_session_id,status,prompt,runtime,executable,workspace_path,started_at,ended_at,exit_code,session_id,stdout,stderr,final_response,base_commit,retry_reason,created_at)
        VALUES (@id,@changeId,@agentId,@parentRunId,@taskId,@agentSessionId,@status,@prompt,@runtime,@executable,@workspacePath,@startedAt,@endedAt,@exitCode,@sessionId,@stdout,@stderr,@finalResponse,@baseCommit,@retryReason,@createdAt)`)
        .run({ ...value, createdAt: now() })
      this.db.prepare("UPDATE t_agent SET status='RUNNING', current_run_id=? WHERE id=?").run(value.id, value.agentId)
      this.event('run', value.id, 'RUN_QUEUED', { changeId: value.changeId, agentId: value.agentId })
    })
    tx()
  }

  updateRun(id: string, patch: Partial<Pick<Run, 'status' | 'startedAt' | 'endedAt' | 'exitCode' | 'sessionId' | 'stdout' | 'stderr' | 'finalResponse'>>): void {
    const fields: string[] = []
    const values: Record<string, unknown> = { id }
    const names: Record<string, string> = { startedAt: 'started_at', endedAt: 'ended_at', exitCode: 'exit_code', sessionId: 'session_id', finalResponse: 'final_response', status: 'status', stdout: 'stdout', stderr: 'stderr' }
    for (const [key, value] of Object.entries(patch)) { fields.push(`${names[key]}=@${key}`); values[key] = value }
    if (fields.length) this.db.prepare(`UPDATE t_run SET ${fields.join(',')} WHERE id=@id`).run(values)
    if (patch.status && ['COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED', 'INTERRUPTED'].includes(patch.status)) {
      this.db.prepare("UPDATE t_agent SET status=CASE WHEN ?='PAUSED' THEN 'PAUSED' WHEN ?='FAILED' THEN 'ERROR' ELSE 'IDLE' END, current_run_id=NULL WHERE current_run_id=?").run(patch.status, patch.status, id)
    }
    if (patch.status) this.event('run', id, `RUN_${patch.status}`, patch)
  }

  getRun(id: string): Run | undefined {
    const row = this.db.prepare('SELECT * FROM t_run WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? this.mapRun(row) : undefined
  }

  getBinding(changeId: string, agentId: string): AgentWorkspaceBinding | undefined {
    const row = this.db.prepare('SELECT * FROM t_agent_workspace WHERE change_id=? AND agent_id=? ORDER BY created_at LIMIT 1').get(changeId, agentId) as Record<string, unknown> | undefined
    return row ? mapBinding(row) : undefined
  }

  getWorkstream(changeId: string, agentId: string, workspaceId?: string): Workstream | undefined {
    const row = (workspaceId
      ? this.db.prepare('SELECT * FROM t_workstream WHERE change_id=? AND agent_id=? AND workspace_id=? LIMIT 1').get(changeId, agentId, workspaceId)
      : this.db.prepare('SELECT * FROM t_workstream WHERE change_id=? AND agent_id=? ORDER BY created_at LIMIT 1').get(changeId, agentId)) as Record<string, unknown> | undefined
    return row ? mapWorkstream(row) : undefined
  }

  updateWorkstream(id: string, patch: Partial<Pick<Workstream, 'status' | 'worktreePath' | 'branch' | 'baseCommit'>>): void {
    const map: Record<string, string> = { status: 'status', worktreePath: 'worktree_path', branch: 'branch', baseCommit: 'base_commit' }
    const fields: string[] = []; const values: Record<string, unknown> = { id, updatedAt: now() }
    for (const [key, value] of Object.entries(patch)) { fields.push(`${map[key]}=@${key}`); values[key] = value }
    if (fields.length) this.db.prepare(`UPDATE t_workstream SET ${fields.join(',')},updated_at=@updatedAt WHERE id=@id`).run(values)
  }

  createTask(input: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const time = now(); const value: Task = { ...input, id: randomUUID(), createdAt: time, updatedAt: time }
    this.db.prepare(`INSERT INTO t_task VALUES (@id,@changeId,@workstreamId,@phaseId,@title,@description,@assignedAgentId,@verifierAgentId,@status,@requiredEvidence,@currentRunId,@parentTaskId,@createdAt,@updatedAt)`)
      .run({ ...value, requiredEvidence: json(value.requiredEvidence) })
    this.event('task', value.id, 'TASK_CREATED', value)
    return value
  }

  getTask(id: string): Task | undefined { const row = this.db.prepare('SELECT * FROM t_task WHERE id=?').get(id) as Record<string, unknown> | undefined; return row ? mapTask(row) : undefined }

  getPhaseTasks(changeId: string, phaseId: string): Task[] { return (this.db.prepare('SELECT * FROM t_task WHERE change_id=? AND phase_id=? ORDER BY created_at').all(changeId, phaseId) as Record<string, unknown>[]).map(mapTask) }
  findReworkTask(changeId: string, phaseId: string, agentId: string): Task | undefined { const row = this.db.prepare("SELECT * FROM t_task WHERE change_id=? AND phase_id=? AND assigned_agent_id=? AND status IN ('REWORK','BLOCKED') ORDER BY updated_at DESC LIMIT 1").get(changeId, phaseId, agentId) as Record<string, unknown> | undefined; return row ? mapTask(row) : undefined }

  updateTask(id: string, status: TaskStatus, currentRunId?: string | null, verifierAgentId?: string | null): void {
    this.db.prepare('UPDATE t_task SET status=?, current_run_id=COALESCE(?,current_run_id), verifier_agent_id=COALESCE(?,verifier_agent_id), updated_at=? WHERE id=?').run(status, currentRunId ?? null, verifierAgentId ?? null, now(), id)
    this.event('task', id, `TASK_${status}`, { currentRunId, verifierAgentId })
  }

  ensureAgentSession(changeId: string, agentId: string, workspaceId: string, runtime: AgentSession['runtime']): AgentSession {
    const existing = this.db.prepare('SELECT * FROM t_agent_session WHERE change_id=? AND agent_id=? AND workspace_id=?').get(changeId, agentId, workspaceId) as Record<string, unknown> | undefined
    if (existing) return mapAgentSession(existing)
    const time = now(); const value: AgentSession = { id: randomUUID(), changeId, agentId, workspaceId, nativeSessionId: null, runtime, status: 'ACTIVE', summary: null, createdAt: time, updatedAt: time }
    this.db.prepare('INSERT INTO t_agent_session VALUES (@id,@changeId,@agentId,@workspaceId,@nativeSessionId,@runtime,@status,@summary,@createdAt,@updatedAt)').run(value)
    return value
  }

  updateAgentSession(id: string, nativeSessionId: string | null, status: AgentSession['status'], summary?: string | null): void {
    this.db.prepare('UPDATE t_agent_session SET native_session_id=COALESCE(?,native_session_id),status=?,summary=COALESCE(?,summary),updated_at=? WHERE id=?').run(nativeSessionId, status, summary ?? null, now(), id)
  }

  createHandoff(input: Omit<Handoff, 'id' | 'createdAt' | 'acceptedAt' | 'status'>): Handoff {
    const value: Handoff = { ...input, id: randomUUID(), status: 'CREATED', createdAt: now(), acceptedAt: null }
    this.db.prepare('INSERT INTO t_handoff VALUES (@id,@changeId,@fromTaskId,@fromAgentId,@toTaskId,@toAgentId,@deliverable,@evidenceIds,@status,@createdAt,@acceptedAt)').run({ ...value, evidenceIds: json(value.evidenceIds) })
    this.event('handoff', value.id, 'HANDOFF_CREATED', value); return value
  }

  createIssue(input: Omit<Issue, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'resolution'>): Issue {
    const time = now(); const value: Issue = { ...input, id: randomUUID(), status: 'OPEN', resolution: null, createdAt: time, updatedAt: time }
    this.db.prepare('INSERT INTO t_issue VALUES (@id,@changeId,@taskId,@ownerAgentId,@title,@description,@severity,@status,@sourceEvidenceId,@resolution,@createdAt,@updatedAt)').run(value)
    this.event('issue', value.id, 'ISSUE_CREATED', value); return value
  }

  updateIssue(id: string, status: IssueStatus, resolution?: string): void { this.db.prepare('UPDATE t_issue SET status=?,resolution=COALESCE(?,resolution),updated_at=? WHERE id=?').run(status, resolution ?? null, now(), id); this.event('issue', id, `ISSUE_${status}`, { resolution }) }
  resolveTaskIssues(taskId: string, resolution: string): void { this.db.prepare("UPDATE t_issue SET status='RESOLVED',resolution=?,updated_at=? WHERE task_id=? AND status IN ('OPEN','FIXING')").run(resolution, now(), taskId) }
  hasBlockingIssues(changeId: string): boolean { return Boolean(this.db.prepare("SELECT 1 FROM t_issue WHERE change_id=? AND severity='BLOCKING' AND status NOT IN ('RESOLVED','VERIFIED','WONT_FIX') LIMIT 1").get(changeId)) }

  addIntervention(input: Omit<HumanIntervention, 'id' | 'createdAt'>): HumanIntervention {
    const value: HumanIntervention = { ...input, id: randomUUID(), createdAt: now() }
    this.db.prepare('INSERT INTO t_human_intervention VALUES (@id,@changeId,@targetAgentId,@affectedRunId,@reason,@newConstraints,@operator,@createdAt)').run(value)
    this.event('change', value.changeId, 'HUMAN_INTERVENTION', value); return value
  }

  findActiveRun(changeId: string, agentId: string): Run | undefined { const row = this.db.prepare("SELECT * FROM t_run WHERE change_id=? AND agent_id=? AND status IN ('QUEUED','STARTING','RUNNING') ORDER BY created_at DESC LIMIT 1").get(changeId, agentId) as Record<string, unknown> | undefined; return row ? this.mapRun(row) : undefined }

  updateChangeState(changeId: string, status: Change['status'], phase?: number): void {
    this.db.prepare('UPDATE t_change SET status=?,current_phase=COALESCE(?,current_phase),updated_at=? WHERE id=?').run(status, phase ?? null, now(), changeId)
    this.event('change', changeId, `CHANGE_${status}`, { phase })
  }

  createConversation(input: CreateConversationInput): Conversation {
    const leaders = input.participants.filter(item => item.isLeader)
    if (input.participants.length < 2 || input.participants.length > 6) throw new Error('主题讨论需要 2～6 个参与角色')
    if (leaders.length !== 1) throw new Error('主题讨论必须且只能有一个 Leader')
    if (new Set(input.participants.map(item => item.agentId)).size !== input.participants.length) throw new Error('同一个 Agent 不能重复加入讨论')
    const number = ((this.db.prepare('SELECT MAX(number) AS n FROM t_conversation').get() as { n: number | null }).n ?? 0) + 1
    const time = now()
    const value: Conversation = { id: randomUUID(), number, title: input.title.trim(), topic: input.topic.trim(), background: input.background.trim(), mode: input.mode, status: 'DRAFT', currentRound: 0, maxRounds: clamp(input.maxRounds, 1, 50), maxMessages: clamp(input.maxMessages, input.participants.length, 1000), maxTokens: clamp(input.maxTokens, 1000, 1_000_000), messageCount: 0, tokenUsed: 0, createdAt: time, updatedAt: time }
    const tx = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO t_conversation VALUES (@id,@number,@title,@topic,@background,@mode,@status,@currentRound,@maxRounds,@maxMessages,@maxTokens,@messageCount,@tokenUsed,@createdAt,@updatedAt)`).run(value)
      input.participants.forEach((participant, index) => {
        const agent = this.getAgent(participant.agentId)
        if (!agent) throw new Error(`Agent ${participant.agentId} 不存在`)
        this.db.prepare('INSERT INTO t_conversation_participant VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), value.id, participant.agentId, participant.roleName.trim() || agent.name, participant.rolePrompt.trim(), index, participant.isLeader ? 1 : 0, 1, null, time)
      })
      this.db.prepare('INSERT INTO t_conversation_memory VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), value.id, 1, '', json([]), json([]), json([]), json([]), time)
      this.event('conversation', value.id, 'CONVERSATION_CREATED', input)
    })
    tx(); return value
  }

  getConversation(id: string): Conversation | undefined { const row = this.db.prepare('SELECT * FROM t_conversation WHERE id=?').get(id) as Record<string, unknown> | undefined; return row ? mapConversation(row) : undefined }
  getConversationParticipants(id: string): ConversationParticipant[] { return (this.db.prepare('SELECT * FROM t_conversation_participant WHERE conversation_id=? AND enabled=1 ORDER BY speaking_order').all(id) as Record<string, unknown>[]).map(mapConversationParticipant) }
  getConversationTurns(id: string, limit?: number): ConversationTurn[] {
    const rows = limit
      ? this.db.prepare('SELECT * FROM (SELECT * FROM t_conversation_turn WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at').all(id, limit)
      : this.db.prepare('SELECT * FROM t_conversation_turn WHERE conversation_id=? ORDER BY created_at').all(id)
    return (rows as Record<string, unknown>[]).map(mapConversationTurn)
  }
  getConversationMemory(id: string): ConversationMemory | undefined { const row = this.db.prepare('SELECT * FROM t_conversation_memory WHERE conversation_id=?').get(id) as Record<string, unknown> | undefined; return row ? mapConversationMemory(row) : undefined }
  getConversationDeliverables(id: string): ConversationDeliverable[] { return (this.db.prepare('SELECT * FROM t_conversation_deliverable WHERE conversation_id=? ORDER BY created_at DESC').all(id) as Record<string, unknown>[]).map(mapConversationDeliverable) }

  updateConversationStatus(id: string, status: ConversationStatus): void { this.db.prepare('UPDATE t_conversation SET status=?,updated_at=? WHERE id=?').run(status, now(), id); this.event('conversation', id, `CONVERSATION_${status}`, {}) }
  updateConversationProgress(id: string, round: number, addedMessages: number, addedTokens: number): void { this.db.prepare('UPDATE t_conversation SET current_round=?,message_count=message_count+?,token_used=token_used+?,updated_at=? WHERE id=?').run(round, addedMessages, addedTokens, now(), id) }

  createConversationRound(conversationId: string, number: number, focus: string): ConversationRound {
    const value: ConversationRound = { id: randomUUID(), conversationId, number, focus, status: 'RUNNING', createdAt: now(), completedAt: null }
    this.db.prepare('INSERT INTO t_conversation_round VALUES (@id,@conversationId,@number,@focus,@status,@createdAt,@completedAt)').run(value); return value
  }
  finishConversationRound(id: string, status: ConversationRound['status']): void { this.db.prepare('UPDATE t_conversation_round SET status=?,completed_at=? WHERE id=?').run(status, now(), id) }
  interruptActiveConversationRound(conversationId: string): void {
    const row = this.db.prepare("SELECT id,number FROM t_conversation_round WHERE conversation_id=? AND status='RUNNING' ORDER BY number DESC LIMIT 1").get(conversationId) as { id: string; number: number } | undefined
    if (!row) return
    this.finishConversationRound(row.id, 'INTERRUPTED'); this.updateConversationProgress(conversationId, row.number, 0, 0)
  }

  createConversationTurn(input: Omit<ConversationTurn, 'id' | 'createdAt' | 'completedAt' | 'inputTokens' | 'outputTokens' | 'error'>): ConversationTurn {
    const value: ConversationTurn = { ...input, id: randomUUID(), inputTokens: 0, outputTokens: 0, error: null, createdAt: now(), completedAt: input.status === 'COMPLETED' ? now() : null }
    this.db.prepare('INSERT INTO t_conversation_turn VALUES (@id,@conversationId,@roundId,@participantId,@agentId,@speakerType,@speakerName,@content,@status,@inputTokens,@outputTokens,@error,@createdAt,@completedAt)').run(value)
    return value
  }
  updateConversationTurn(id: string, patch: Partial<Pick<ConversationTurn, 'content' | 'status' | 'inputTokens' | 'outputTokens' | 'error'>>): void {
    const columns: Record<string, string> = { content: 'content', status: 'status', inputTokens: 'input_tokens', outputTokens: 'output_tokens', error: 'error' }
    const fields: string[] = []; const values: Record<string, unknown> = { id }
    for (const [key, value] of Object.entries(patch)) { fields.push(`${columns[key]}=@${key}`); values[key] = value }
    if (patch.status && ['COMPLETED','FAILED','CANCELLED'].includes(patch.status)) { fields.push('completed_at=@completedAt'); values.completedAt = now() }
    if (fields.length) this.db.prepare(`UPDATE t_conversation_turn SET ${fields.join(',')} WHERE id=@id`).run(values)
  }
  updateConversationParticipantSession(id: string, sessionId: string | null): void { if (sessionId) this.db.prepare('UPDATE t_conversation_participant SET native_session_id=? WHERE id=?').run(sessionId, id) }

  updateConversationMemory(conversationId: string, patch: Pick<ConversationMemory, 'summary' | 'consensus' | 'disagreements' | 'openQuestions' | 'userPreferences'>): void {
    this.db.prepare('UPDATE t_conversation_memory SET version=version+1,summary=?,consensus=?,disagreements=?,open_questions=?,user_preferences=?,updated_at=? WHERE conversation_id=?').run(patch.summary, json(patch.consensus), json(patch.disagreements), json(patch.openQuestions), json(patch.userPreferences), now(), conversationId)
  }

  createConversationDeliverable(conversationId: string, type: ConversationDeliverable['type'], title: string, content: string): ConversationDeliverable {
    const value: ConversationDeliverable = { id: randomUUID(), conversationId, type, title, content, status: 'FINAL', convertedChangeId: null, createdAt: now() }
    this.db.prepare('INSERT INTO t_conversation_deliverable VALUES (@id,@conversationId,@type,@title,@content,@status,@convertedChangeId,@createdAt)').run(value)
    this.event('conversation', conversationId, 'CONVERSATION_DELIVERABLE_CREATED', { id: value.id, type }); return value
  }
  markConversationConverted(deliverableId: string, changeId: string): void { this.db.prepare('UPDATE t_conversation_deliverable SET converted_change_id=? WHERE id=?').run(changeId, deliverableId) }

  addEvidence(runId: string, input: Omit<Evidence, 'id' | 'runId' | 'createdAt'>): Evidence {
    const value: Evidence = { ...input, id: randomUUID(), runId, createdAt: now() }
    this.db.prepare('INSERT INTO t_evidence VALUES (@id,@runId,@type,@title,@status,@detail,@createdAt)').run(value)
    this.event('run', runId, 'EVIDENCE_RECORDED', value)
    return value
  }

  createArtifact(changeId: string, type: string, title: string, content: string): Artifact {
    const previous = this.db.prepare('SELECT * FROM t_artifact WHERE change_id=? AND type=? ORDER BY version DESC LIMIT 1').get(changeId, type) as Record<string, unknown> | undefined
    const value: Artifact = { id: randomUUID(), changeId, type, title, version: previous ? Number(previous.version) + 1 : 1, status: 'DRAFT', content, supersedes: previous ? String(previous.id) : null, createdAt: now(), approvedAt: null }
    this.db.prepare('INSERT INTO t_artifact VALUES (@id,@changeId,@type,@title,@version,@status,@content,@supersedes,@createdAt,@approvedAt)').run(value)
    this.event('artifact', value.id, 'ARTIFACT_CREATED', value)
    return value
  }

  approveArtifact(id: string, approve: boolean, feedback?: string): void {
    const row = this.db.prepare('SELECT * FROM t_artifact WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error('Artifact 不存在')
    const status = approve ? 'APPROVED' : 'DRAFT'
    this.db.prepare('UPDATE t_artifact SET status=?, approved_at=? WHERE id=?').run(status, approve ? now() : null, id)
    if (approve && row.supersedes) this.db.prepare("UPDATE t_artifact SET status='DEPRECATED' WHERE id=?").run(row.supersedes)
    if (feedback) this.addMessage(String(row.change_id), 'human', null, 'You', `${approve ? '批准' : '退回'} Artifact：${String(row.title)}。${feedback}`, null)
    this.event('artifact', id, approve ? 'ARTIFACT_APPROVED' : 'ARTIFACT_CHANGES_REQUESTED', { feedback })
  }

  hasApprovedArtifact(changeId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM t_artifact WHERE change_id=? AND status='APPROVED' LIMIT 1").get(changeId))
  }

  advanceChange(changeId: string): void {
    this.db.prepare('UPDATE t_change SET current_phase=current_phase+1, updated_at=? WHERE id=?').run(now(), changeId)
    this.event('change', changeId, 'WORKFLOW_PHASE_ADVANCED', {})
  }

  private mapRun(row: Record<string, unknown>): Run {
    const evidence = (this.db.prepare('SELECT * FROM t_evidence WHERE run_id=? ORDER BY created_at').all(String(row.id)) as Record<string, unknown>[]).map(mapEvidence)
    return { id: String(row.id), changeId: String(row.change_id), agentId: String(row.agent_id), taskId: nullable(row.task_id), agentSessionId: nullable(row.agent_session_id), parentRunId: nullable(row.parent_run_id), status: row.status as Run['status'], prompt: String(row.prompt), runtime: row.runtime as Run['runtime'], executable: String(row.executable), workspacePath: String(row.workspace_path), startedAt: nullable(row.started_at), endedAt: nullable(row.ended_at), exitCode: row.exit_code === null ? null : Number(row.exit_code), sessionId: nullable(row.session_id), stdout: String(row.stdout ?? ''), stderr: String(row.stderr ?? ''), finalResponse: nullable(row.final_response), baseCommit: nullable(row.base_commit), retryReason: nullable(row.retry_reason), evidence }
  }

  private event(aggregateType: string, aggregateId: string, eventType: string, payload: unknown): void {
    this.db.prepare('INSERT INTO t_event VALUES (?,?,?,?,?,?)').run(randomUUID(), aggregateType, aggregateId, eventType, json(payload), now())
  }
}

const nullable = (value: unknown): string | null => value === null || value === undefined ? null : String(value)
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)))
const fullPermissions = (write: boolean): Agent['permissions'] => ({ read: true, write, shell: true, git: true, network: true })
const mapWorkspace = (r: Record<string, unknown>): Workspace => ({ id: String(r.id), name: String(r.name), path: String(r.path), repoRoot: nullable(r.repo_root), branch: nullable(r.branch), baseCommit: nullable(r.base_commit), createdAt: String(r.created_at) })
const mapAgent = (r: Record<string, unknown>): Agent => ({ id: String(r.id), name: String(r.name), icon: String(r.icon), description: String(r.description), responsibility: String(r.responsibility), qualityBar: parse(String(r.quality_bar), []), runtime: r.runtime as Agent['runtime'], command: nullable(r.command), argsTemplate: nullable(r.args_template), workspaceIds: parse(String(r.workspace_ids), []), permissions: parse(String(r.permissions), fullPermissions(false)), status: r.status as Agent['status'], currentRunId: nullable(r.current_run_id), createdAt: String(r.created_at) })
const mapChange = (r: Record<string, unknown>): Change => ({ id: String(r.id), number: Number(r.number), title: String(r.title), description: String(r.description), workflowType: r.workflow_type as Change['workflowType'], priority: r.priority as Change['priority'], dueDate: nullable(r.due_date), status: r.status as Change['status'], currentPhase: Number(r.current_phase), workspaceIds: parse(String(r.workspace_ids), []), agentIds: parse(String(r.agent_ids), []), tags: parse(String(r.tags), []), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })
const mapMessage = (r: Record<string, unknown>): Message => ({ id: String(r.id), changeId: String(r.change_id), senderType: r.sender_type as Message['senderType'], senderId: nullable(r.sender_id), senderName: String(r.sender_name), content: String(r.content), runId: nullable(r.run_id), createdAt: String(r.created_at) })
const mapEvidence = (r: Record<string, unknown>): Evidence => ({ id: String(r.id), runId: String(r.run_id), type: r.type as Evidence['type'], title: String(r.title), status: r.status as Evidence['status'], detail: String(r.detail), createdAt: String(r.created_at) })
const mapArtifact = (r: Record<string, unknown>): Artifact => ({ id: String(r.id), changeId: String(r.change_id), type: String(r.type), title: String(r.title), version: Number(r.version), status: r.status as Artifact['status'], content: String(r.content), supersedes: nullable(r.supersedes), createdAt: String(r.created_at), approvedAt: nullable(r.approved_at) })
const mapBinding = (r: Record<string, unknown>): AgentWorkspaceBinding => ({ id: String(r.id), changeId: String(r.change_id), agentId: String(r.agent_id), workspaceId: String(r.workspace_id), permissions: parse(String(r.permissions), fullPermissions(false)), createdAt: String(r.created_at) })
const mapWorkstream = (r: Record<string, unknown>): Workstream => ({ id: String(r.id), changeId: String(r.change_id), workspaceId: String(r.workspace_id), agentId: String(r.agent_id), name: String(r.name), status: r.status as Workstream['status'], worktreePath: nullable(r.worktree_path), branch: nullable(r.branch), baseCommit: nullable(r.base_commit), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })
const mapTask = (r: Record<string, unknown>): Task => ({ id: String(r.id), changeId: String(r.change_id), workstreamId: nullable(r.workstream_id), phaseId: String(r.phase_id), title: String(r.title), description: String(r.description), assignedAgentId: String(r.assigned_agent_id), verifierAgentId: nullable(r.verifier_agent_id), status: r.status as Task['status'], requiredEvidence: parse(String(r.required_evidence), []), currentRunId: nullable(r.current_run_id), parentTaskId: nullable(r.parent_task_id), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })
const mapAgentSession = (r: Record<string, unknown>): AgentSession => ({ id: String(r.id), changeId: String(r.change_id), agentId: String(r.agent_id), workspaceId: String(r.workspace_id), nativeSessionId: nullable(r.native_session_id), runtime: r.runtime as AgentSession['runtime'], status: r.status as AgentSession['status'], summary: nullable(r.summary), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })
const mapHandoff = (r: Record<string, unknown>): Handoff => ({ id: String(r.id), changeId: String(r.change_id), fromTaskId: nullable(r.from_task_id), fromAgentId: nullable(r.from_agent_id), toTaskId: nullable(r.to_task_id), toAgentId: nullable(r.to_agent_id), deliverable: String(r.deliverable), evidenceIds: parse(String(r.evidence_ids), []), status: r.status as Handoff['status'], createdAt: String(r.created_at), acceptedAt: nullable(r.accepted_at) })
const mapIssue = (r: Record<string, unknown>): Issue => ({ id: String(r.id), changeId: String(r.change_id), taskId: nullable(r.task_id), ownerAgentId: nullable(r.owner_agent_id), title: String(r.title), description: String(r.description), severity: r.severity as Issue['severity'], status: r.status as Issue['status'], sourceEvidenceId: nullable(r.source_evidence_id), resolution: nullable(r.resolution), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })
const mapIntervention = (r: Record<string, unknown>): HumanIntervention => ({ id: String(r.id), changeId: String(r.change_id), targetAgentId: nullable(r.target_agent_id), affectedRunId: nullable(r.affected_run_id), reason: String(r.reason), newConstraints: String(r.new_constraints), operator: String(r.operator), createdAt: String(r.created_at) })
const mapConversation = (r: Record<string, unknown>): Conversation => ({ id: String(r.id), number: Number(r.number), title: String(r.title), topic: String(r.topic), background: String(r.background), mode: r.mode as Conversation['mode'], status: r.status as Conversation['status'], currentRound: Number(r.current_round), maxRounds: Number(r.max_rounds), maxMessages: Number(r.max_messages), maxTokens: Number(r.max_tokens), messageCount: Number(r.message_count), tokenUsed: Number(r.token_used), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })
const mapConversationParticipant = (r: Record<string, unknown>): ConversationParticipant => ({ id: String(r.id), conversationId: String(r.conversation_id), agentId: String(r.agent_id), roleName: String(r.role_name), rolePrompt: String(r.role_prompt), speakingOrder: Number(r.speaking_order), isLeader: Boolean(r.is_leader), enabled: Boolean(r.enabled), nativeSessionId: nullable(r.native_session_id), createdAt: String(r.created_at) })
const mapConversationRound = (r: Record<string, unknown>): ConversationRound => ({ id: String(r.id), conversationId: String(r.conversation_id), number: Number(r.number), focus: String(r.focus), status: r.status as ConversationRound['status'], createdAt: String(r.created_at), completedAt: nullable(r.completed_at) })
const mapConversationTurn = (r: Record<string, unknown>): ConversationTurn => ({ id: String(r.id), conversationId: String(r.conversation_id), roundId: nullable(r.round_id), participantId: nullable(r.participant_id), agentId: nullable(r.agent_id), speakerType: r.speaker_type as ConversationTurn['speakerType'], speakerName: String(r.speaker_name), content: String(r.content), status: r.status as ConversationTurn['status'], inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), error: nullable(r.error), createdAt: String(r.created_at), completedAt: nullable(r.completed_at) })
const mapConversationMemory = (r: Record<string, unknown>): ConversationMemory => ({ id: String(r.id), conversationId: String(r.conversation_id), version: Number(r.version), summary: String(r.summary), consensus: parse(String(r.consensus), []), disagreements: parse(String(r.disagreements), []), openQuestions: parse(String(r.open_questions), []), userPreferences: parse(String(r.user_preferences), []), updatedAt: String(r.updated_at) })
const mapConversationDeliverable = (r: Record<string, unknown>): ConversationDeliverable => ({ id: String(r.id), conversationId: String(r.conversation_id), type: r.type as ConversationDeliverable['type'], title: String(r.title), content: String(r.content), status: r.status as ConversationDeliverable['status'], convertedChangeId: nullable(r.converted_change_id), createdAt: String(r.created_at) })
