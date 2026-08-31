import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Agent, AppSnapshot, Artifact, Change, CreateAgentInput, CreateChangeInput, Evidence, Message, Run, RuntimeInfo, Workspace } from '../shared/contracts'

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
      CREATE INDEX IF NOT EXISTS idx_message_change ON t_message(change_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_run_change ON t_run(change_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_event_aggregate ON t_event(aggregate_id, created_at);
    `)
  }

  private recoverInterruptedRuns(): void {
    const affected = this.db.prepare("SELECT id FROM t_run WHERE status IN ('QUEUED','STARTING','RUNNING')").all() as { id: string }[]
    const tx = this.db.transaction(() => {
      for (const row of affected) {
        this.db.prepare("UPDATE t_run SET status='INTERRUPTED', ended_at=? WHERE id=?").run(now(), row.id)
        this.event('run', row.id, 'RUN_INTERRUPTED', { reason: 'Application restarted while run was active' })
      }
      this.db.prepare("UPDATE t_agent SET status='IDLE', current_run_id=NULL WHERE status='RUNNING'").run()
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
      artifacts: (this.db.prepare('SELECT * FROM t_artifact ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(mapArtifact)
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
      this.db.prepare(`INSERT INTO t_run (id,change_id,agent_id,parent_run_id,status,prompt,runtime,executable,workspace_path,started_at,ended_at,exit_code,session_id,stdout,stderr,final_response,base_commit,retry_reason,created_at)
        VALUES (@id,@changeId,@agentId,@parentRunId,@status,@prompt,@runtime,@executable,@workspacePath,@startedAt,@endedAt,@exitCode,@sessionId,@stdout,@stderr,@finalResponse,@baseCommit,@retryReason,@createdAt)`)
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
    return { id: String(row.id), changeId: String(row.change_id), agentId: String(row.agent_id), parentRunId: nullable(row.parent_run_id), status: row.status as Run['status'], prompt: String(row.prompt), runtime: row.runtime as Run['runtime'], executable: String(row.executable), workspacePath: String(row.workspace_path), startedAt: nullable(row.started_at), endedAt: nullable(row.ended_at), exitCode: row.exit_code === null ? null : Number(row.exit_code), sessionId: nullable(row.session_id), stdout: String(row.stdout ?? ''), stderr: String(row.stderr ?? ''), finalResponse: nullable(row.final_response), baseCommit: nullable(row.base_commit), retryReason: nullable(row.retry_reason), evidence }
  }

  private event(aggregateType: string, aggregateId: string, eventType: string, payload: unknown): void {
    this.db.prepare('INSERT INTO t_event VALUES (?,?,?,?,?,?)').run(randomUUID(), aggregateType, aggregateId, eventType, json(payload), now())
  }
}

const nullable = (value: unknown): string | null => value === null || value === undefined ? null : String(value)
const fullPermissions = (write: boolean): Agent['permissions'] => ({ read: true, write, shell: true, git: true, network: true })
const mapWorkspace = (r: Record<string, unknown>): Workspace => ({ id: String(r.id), name: String(r.name), path: String(r.path), repoRoot: nullable(r.repo_root), branch: nullable(r.branch), baseCommit: nullable(r.base_commit), createdAt: String(r.created_at) })
const mapAgent = (r: Record<string, unknown>): Agent => ({ id: String(r.id), name: String(r.name), icon: String(r.icon), description: String(r.description), responsibility: String(r.responsibility), qualityBar: parse(String(r.quality_bar), []), runtime: r.runtime as Agent['runtime'], command: nullable(r.command), argsTemplate: nullable(r.args_template), workspaceIds: parse(String(r.workspace_ids), []), permissions: parse(String(r.permissions), fullPermissions(false)), status: r.status as Agent['status'], currentRunId: nullable(r.current_run_id), createdAt: String(r.created_at) })
const mapChange = (r: Record<string, unknown>): Change => ({ id: String(r.id), number: Number(r.number), title: String(r.title), description: String(r.description), workflowType: r.workflow_type as Change['workflowType'], priority: r.priority as Change['priority'], dueDate: nullable(r.due_date), status: r.status as Change['status'], currentPhase: Number(r.current_phase), workspaceIds: parse(String(r.workspace_ids), []), agentIds: parse(String(r.agent_ids), []), tags: parse(String(r.tags), []), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })
const mapMessage = (r: Record<string, unknown>): Message => ({ id: String(r.id), changeId: String(r.change_id), senderType: r.sender_type as Message['senderType'], senderId: nullable(r.sender_id), senderName: String(r.sender_name), content: String(r.content), runId: nullable(r.run_id), createdAt: String(r.created_at) })
const mapEvidence = (r: Record<string, unknown>): Evidence => ({ id: String(r.id), runId: String(r.run_id), type: r.type as Evidence['type'], title: String(r.title), status: r.status as Evidence['status'], detail: String(r.detail), createdAt: String(r.created_at) })
const mapArtifact = (r: Record<string, unknown>): Artifact => ({ id: String(r.id), changeId: String(r.change_id), type: String(r.type), title: String(r.title), version: Number(r.version), status: r.status as Artifact['status'], content: String(r.content), supersedes: nullable(r.supersedes), createdAt: String(r.created_at), approvedAt: nullable(r.approved_at) })
