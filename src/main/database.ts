import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Agent,
  AgentProfile,
  AgentSession,
  AgentWorkspaceBinding,
  AppSnapshot,
  Artifact,
  Change,
  Conversation,
  ConversationDeliverable,
  ConversationMemory,
  ConversationParticipant,
  ConversationRound,
  ConversationStatus,
  ConversationTurn,
  CreateAgentInput,
  CreateChangeInput,
  CreateConversationInput,
  CreateMemoryInput,
  CreateScheduleInput,
  CreateSkillInput,
  CreateWorkOrderInput,
  Deliverable,
  Evidence,
  Handoff,
  HumanIntervention,
  Issue,
  IssueStatus,
  MemoryEntry,
  Message,
  Notification,
  Run,
  RuntimeInfo,
  Schedule,
  ScheduleExecution,
  Skill,
  SkillVersion,
  Task,
  TaskStatus,
  UpsertAgentProfileInput,
  Workspace,
  WorkOrder,
  WorkOrderStatus,
  Workstream,
} from "../shared/contracts";

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const parse = <T>(value: string | null | undefined, fallback: T): T =>
  value ? (JSON.parse(value) as T) : fallback;
const LEGACY_UNBOUNDED_LIMIT = 9_000_000_000_000_000;

export class AppDatabase {
  private db: Database.Database;

  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.backupBeforeMigration();
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
    this.recoverInterruptedRuns();
    this.seedAgents();
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
        message_count INTEGER NOT NULL, token_used INTEGER NOT NULL, stop_reason TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_conversation_participant (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL, role_name TEXT NOT NULL,
        role_prompt TEXT NOT NULL, speaking_order INTEGER NOT NULL, is_leader INTEGER NOT NULL,
        enabled INTEGER NOT NULL, native_session_id TEXT, last_seen_turn_sequence INTEGER NOT NULL DEFAULT 0,
        memory_version INTEGER NOT NULL DEFAULT 0, session_generation INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_conversation_round (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, number INTEGER NOT NULL, focus TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
        UNIQUE(conversation_id, number)
      );
      CREATE TABLE IF NOT EXISTS t_conversation_turn (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, round_id TEXT, participant_id TEXT, agent_id TEXT,
        speaker_type TEXT NOT NULL, speaker_name TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL, status TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0, cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL, model TEXT, error TEXT,
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
    `);
    this.ensureColumn("t_run", "task_id", "TEXT");
    this.ensureColumn("t_run", "agent_session_id", "TEXT");
    this.ensureColumn("t_conversation", "stop_reason", "TEXT");
    this.ensureColumn(
      "t_conversation_participant",
      "last_seen_turn_sequence",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "t_conversation_participant",
      "memory_version",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "t_conversation_participant",
      "session_generation",
      "INTEGER NOT NULL DEFAULT 1",
    );
    this.allowConversationAgentReuse();
    this.ensureColumn(
      "t_conversation_turn",
      "sequence",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "t_conversation_turn",
      "cached_input_tokens",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "t_conversation_turn",
      "cache_creation_input_tokens",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "t_conversation_turn",
      "reasoning_output_tokens",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "t_conversation_turn",
      "total_tokens",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn("t_conversation_turn", "cost_usd", "REAL");
    this.ensureColumn("t_conversation_turn", "model", "TEXT");
    this.db.exec(`
      UPDATE t_conversation_turn
      SET sequence=(SELECT COUNT(*) FROM t_conversation_turn previous WHERE previous.conversation_id=t_conversation_turn.conversation_id AND previous.rowid<=t_conversation_turn.rowid)
      WHERE sequence=0;
      UPDATE t_conversation_turn SET total_tokens=input_tokens+output_tokens WHERE total_tokens=0 AND input_tokens+output_tokens>0;
      UPDATE t_conversation_participant
      SET last_seen_turn_sequence=COALESCE((SELECT MAX(sequence) FROM t_conversation_turn WHERE participant_id=t_conversation_participant.id AND status='COMPLETED'),0)
      WHERE native_session_id IS NOT NULL AND last_seen_turn_sequence=0;
      UPDATE t_conversation
      SET stop_reason=CASE WHEN current_round>=max_rounds THEN 'MAX_ROUNDS' ELSE 'USER_ENDED' END
      WHERE status='READY_TO_SUMMARIZE' AND stop_reason IS NULL;
      UPDATE t_conversation
      SET max_rounds=MAX(1,current_round),stop_reason=CASE WHEN current_round>0 THEN 'MAX_ROUNDS' ELSE 'USER_ENDED' END
      WHERE status='READY_TO_SUMMARIZE' AND stop_reason IN ('TOKEN_BUDGET','MAX_MESSAGES');
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_turn_sequence ON t_conversation_turn(conversation_id,sequence);
      CREATE INDEX IF NOT EXISTS idx_conversation_participant_agent ON t_conversation_participant(conversation_id,agent_id);
    `);
    this.upgradeExecutionSubjects();
    this.createLongTermSchema();
    this.db.pragma("user_version = 3");
  }

  private backupBeforeMigration(): void {
    const version = Number(
      this.db.pragma("user_version", { simple: true }) ?? 0,
    );
    const hasTables = Boolean(
      this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1")
        .get(),
    );
    if (hasTables && version < 3 && existsSync(this.path))
      copyFileSync(this.path, `${this.path}.pre-v3.bak`);
  }

  private upgradeExecutionSubjects(): void {
    const runColumns = this.db
      .prepare("PRAGMA table_info(t_run)")
      .all() as Array<{ name: string; notnull: number }>;
    if (
      !runColumns.some((item) => item.name === "work_order_id") ||
      runColumns.find((item) => item.name === "change_id")?.notnull
    ) {
      this.db.pragma("foreign_keys = OFF");
      const tx = this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE t_evidence RENAME TO t_evidence_legacy;
          ALTER TABLE t_run RENAME TO t_run_legacy;
          CREATE TABLE t_run (
            id TEXT PRIMARY KEY, change_id TEXT, work_order_id TEXT, agent_id TEXT NOT NULL, parent_run_id TEXT,
            task_id TEXT, agent_session_id TEXT, status TEXT NOT NULL, prompt TEXT NOT NULL, runtime TEXT NOT NULL,
            executable TEXT NOT NULL, workspace_path TEXT NOT NULL, started_at TEXT, ended_at TEXT, exit_code INTEGER,
            session_id TEXT, stdout TEXT NOT NULL DEFAULT '', stderr TEXT NOT NULL DEFAULT '', final_response TEXT,
            base_commit TEXT, retry_reason TEXT, created_at TEXT NOT NULL,
            CHECK ((change_id IS NOT NULL) <> (work_order_id IS NOT NULL))
          );
          INSERT INTO t_run (id,change_id,work_order_id,agent_id,parent_run_id,task_id,agent_session_id,status,prompt,runtime,executable,workspace_path,started_at,ended_at,exit_code,session_id,stdout,stderr,final_response,base_commit,retry_reason,created_at)
          SELECT id,change_id,NULL,agent_id,parent_run_id,task_id,agent_session_id,status,prompt,runtime,executable,workspace_path,started_at,ended_at,exit_code,session_id,stdout,stderr,final_response,base_commit,retry_reason,created_at FROM t_run_legacy;
          CREATE TABLE t_evidence (
            id TEXT PRIMARY KEY, run_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
            status TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES t_run(id)
          );
          INSERT INTO t_evidence SELECT * FROM t_evidence_legacy;
          DROP TABLE t_evidence_legacy;
          DROP TABLE t_run_legacy;
          CREATE INDEX idx_run_change ON t_run(change_id, created_at);
          CREATE INDEX idx_run_work_order ON t_run(work_order_id, created_at);
        `);
      });
      tx();
      this.db.pragma("foreign_keys = ON");
    }

    const sessionColumns = this.db
      .prepare("PRAGMA table_info(t_agent_session)")
      .all() as Array<{ name: string }>;
    if (!sessionColumns.some((item) => item.name === "subject_type")) {
      this.db.pragma("foreign_keys = OFF");
      const tx = this.db.transaction(() =>
        this.db.exec(`
        ALTER TABLE t_agent_session RENAME TO t_agent_session_legacy;
        CREATE TABLE t_agent_session (
          id TEXT PRIMARY KEY, change_id TEXT, work_order_id TEXT, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
          agent_id TEXT NOT NULL, workspace_id TEXT, native_session_id TEXT, runtime TEXT NOT NULL, status TEXT NOT NULL,
          summary TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        INSERT INTO t_agent_session (id,change_id,work_order_id,subject_type,subject_id,agent_id,workspace_id,native_session_id,runtime,status,summary,created_at,updated_at)
        SELECT id,change_id,NULL,'CHANGE',change_id,agent_id,workspace_id,native_session_id,runtime,status,summary,created_at,updated_at FROM t_agent_session_legacy;
        DROP TABLE t_agent_session_legacy;
        CREATE UNIQUE INDEX idx_session_subject ON t_agent_session(agent_id,subject_type,subject_id,IFNULL(workspace_id,''));
        CREATE INDEX idx_session_agent ON t_agent_session(subject_type,subject_id,agent_id);
      `),
      );
      tx();
      this.db.pragma("foreign_keys = ON");
    }
  }

  private createLongTermSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS t_agent_profile (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL UNIQUE, position_title TEXT NOT NULL, outcome_statement TEXT NOT NULL,
        recurring_responsibilities TEXT NOT NULL, preferred_sources TEXT NOT NULL, standard_deliverables TEXT NOT NULL,
        acceptance_criteria TEXT NOT NULL, prohibited_actions TEXT NOT NULL, approval_points TEXT NOT NULL,
        failure_policy TEXT NOT NULL, default_skill_ids TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_agent_profile_revision (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(profile_id,version)
      );
      CREATE TABLE IF NOT EXISTS t_memory_entry (
        id TEXT PRIMARY KEY, agent_id TEXT, scope TEXT NOT NULL, scope_id TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL,
        source_type TEXT NOT NULL, source_id TEXT NOT NULL, supersedes_id TEXT, expires_at TEXT, approved_by TEXT,
        approved_at TEXT, provenance TEXT NOT NULL DEFAULT 'TRUSTED', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_scope ON t_memory_entry(agent_id,scope,scope_id,status);
      CREATE INDEX IF NOT EXISTS idx_memory_status ON t_memory_entry(status,updated_at);
      CREATE INDEX IF NOT EXISTS idx_memory_source ON t_memory_entry(source_type,source_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS t_memory_fts USING fts5(id UNINDEXED,title,content,tags);
      CREATE TABLE IF NOT EXISTS t_skill (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, trigger_text TEXT NOT NULL, owner_agent_id TEXT,
        status TEXT NOT NULL, active_version_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_skill_version (
        id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, version INTEGER NOT NULL, instructions TEXT NOT NULL,
        input_schema TEXT NOT NULL, output_schema TEXT NOT NULL, required_capabilities TEXT NOT NULL,
        required_evidence TEXT NOT NULL, approval_points TEXT NOT NULL, failure_policy TEXT NOT NULL, checksum TEXT NOT NULL,
        status TEXT NOT NULL, created_from_run_id TEXT, created_at TEXT NOT NULL, verified_at TEXT,
        UNIQUE(skill_id,version)
      );
      CREATE TABLE IF NOT EXISTS t_agent_skill (agent_id TEXT NOT NULL,skill_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(agent_id,skill_id));
      CREATE TABLE IF NOT EXISTS t_work_order (
        id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, title TEXT NOT NULL, goal TEXT NOT NULL, owner_agent_id TEXT NOT NULL,
        created_by_type TEXT NOT NULL, created_by_id TEXT, schedule_id TEXT, parent_work_order_id TEXT, project_scope_id TEXT,
        workspace_id TEXT, skill_version_ids TEXT NOT NULL, input TEXT NOT NULL, constraints_json TEXT NOT NULL,
        output_contract TEXT NOT NULL, required_evidence TEXT NOT NULL, permissions TEXT NOT NULL, status TEXT NOT NULL,
        status_reason TEXT, idempotency_key TEXT NOT NULL UNIQUE, due_at TEXT, current_run_id TEXT, started_at TEXT,
        completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_work_order_status ON t_work_order(status,updated_at);
      CREATE INDEX IF NOT EXISTS idx_work_order_agent ON t_work_order(owner_agent_id,created_at);
      CREATE TABLE IF NOT EXISTS t_deliverable (
        id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, run_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
        file_path TEXT, sha256 TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_schedule (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_agent_id TEXT NOT NULL, work_order_template TEXT NOT NULL,
        cron_expression TEXT NOT NULL, timezone TEXT NOT NULL, enabled INTEGER NOT NULL, misfire_policy TEXT NOT NULL,
        concurrency_policy TEXT NOT NULL, max_catch_up_runs INTEGER NOT NULL, retry_policy TEXT NOT NULL, next_run_at TEXT NOT NULL,
        last_scheduled_at TEXT, lease_owner TEXT, lease_expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS t_schedule_execution (
        id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, scheduled_for TEXT NOT NULL, work_order_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL,
        UNIQUE(schedule_id,scheduled_for)
      );
      CREATE TABLE IF NOT EXISTS t_notification (
        id TEXT PRIMARY KEY, event TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, title TEXT NOT NULL,
        body TEXT NOT NULL, channel TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, read_at TEXT, created_at TEXT NOT NULL
      );
    `);
    const time = now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO t_agent_profile
      (id,agent_id,position_title,outcome_statement,recurring_responsibilities,preferred_sources,standard_deliverables,acceptance_criteria,prohibited_actions,approval_points,failure_policy,default_skill_ids,status,version,created_at,updated_at)
      SELECT lower(hex(randomblob(16))),id,description,responsibility,'[]','[]','[]',quality_bar,'[]','[]','数据缺失或无法核验时进入阻塞，并明确说明原因。','[]','DRAFT',1,?,? FROM t_agent`,
      )
      .run(time, time);
  }

  private ensureColumn(table: string, column: string, type: string): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column))
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  private allowConversationAgentReuse(): void {
    const row = this.db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='t_conversation_participant'",
      )
      .get() as { sql: string } | undefined;
    if (
      !row ||
      !/UNIQUE\s*\(\s*conversation_id\s*,\s*agent_id\s*\)/i.test(row.sql)
    )
      return;
    const tx = this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE t_conversation_participant_next (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL, role_name TEXT NOT NULL,
          role_prompt TEXT NOT NULL, speaking_order INTEGER NOT NULL, is_leader INTEGER NOT NULL,
          enabled INTEGER NOT NULL, native_session_id TEXT, last_seen_turn_sequence INTEGER NOT NULL DEFAULT 0,
          memory_version INTEGER NOT NULL DEFAULT 0, session_generation INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
        );
        INSERT INTO t_conversation_participant_next
          SELECT id,conversation_id,agent_id,role_name,role_prompt,speaking_order,is_leader,enabled,native_session_id,last_seen_turn_sequence,memory_version,session_generation,created_at
          FROM t_conversation_participant;
        DROP TABLE t_conversation_participant;
        ALTER TABLE t_conversation_participant_next RENAME TO t_conversation_participant;
      `);
    });
    tx();
  }

  private recoverInterruptedRuns(): void {
    const affected = this.db
      .prepare(
        "SELECT id, task_id, work_order_id, agent_session_id FROM t_run WHERE status IN ('QUEUED','STARTING','RUNNING')",
      )
      .all() as Array<{
      id: string;
      task_id: string | null;
      work_order_id: string | null;
      agent_session_id: string | null;
    }>;
    const recoveredAt = now();
    const tx = this.db.transaction(() => {
      for (const row of affected) {
        this.db
          .prepare(
            "UPDATE t_run SET status='INTERRUPTED', ended_at=? WHERE id=?",
          )
          .run(recoveredAt, row.id);
        if (row.task_id) {
          this.db
            .prepare(
              "UPDATE t_task SET status='BLOCKED', updated_at=? WHERE id=? AND status IN ('ASSIGNED','QUEUED','RUNNING','RUN_COMPLETED','VERIFYING')",
            )
            .run(recoveredAt, row.task_id);
          this.event("task", row.task_id, "TASK_BLOCKED", {
            reason: "Runtime process restarted while Task was active",
            runId: row.id,
          });
        }
        if (row.work_order_id) {
          this.db
            .prepare(
              "UPDATE t_work_order SET status='BLOCKED',status_reason='应用在执行期间重启，可从原 Session 继续',updated_at=? WHERE id=? AND status IN ('READY','QUEUED','RUNNING','VERIFYING')",
            )
            .run(recoveredAt, row.work_order_id);
          this.event("work-order", row.work_order_id, "WORK_ORDER_BLOCKED", {
            reason: "Runtime process restarted",
            runId: row.id,
          });
        }
        if (row.agent_session_id)
          this.db
            .prepare(
              "UPDATE t_agent_session SET status='INTERRUPTED', updated_at=? WHERE id=?",
            )
            .run(recoveredAt, row.agent_session_id);
        this.event("run", row.id, "RUN_INTERRUPTED", {
          reason: "Application restarted while run was active",
        });
      }
      this.db
        .prepare(
          "UPDATE t_agent SET status='IDLE', current_run_id=NULL WHERE status='RUNNING'",
        )
        .run();
      this.db
        .prepare(
          "UPDATE t_workstream SET status='BLOCKED', updated_at=? WHERE id IN (SELECT DISTINCT workstream_id FROM t_task WHERE status='BLOCKED' AND workstream_id IS NOT NULL)",
        )
        .run(recoveredAt);
      this.db
        .prepare(
          "UPDATE t_conversation SET status='PAUSED', updated_at=? WHERE status='RUNNING'",
        )
        .run(recoveredAt);
      this.db
        .prepare(
          "UPDATE t_conversation_round SET status='INTERRUPTED', completed_at=? WHERE status='RUNNING'",
        )
        .run(recoveredAt);
      this.db
        .prepare(
          "UPDATE t_conversation_turn SET status='FAILED', error='Runtime process restarted', completed_at=? WHERE status IN ('QUEUED','RUNNING')",
        )
        .run(recoveredAt);
      this.db
        .prepare(
          "UPDATE t_conversation SET current_round=COALESCE((SELECT MAX(number) FROM t_conversation_round WHERE conversation_id=t_conversation.id),current_round) WHERE status='PAUSED'",
        )
        .run();
    });
    tx();
  }

  private seedAgents(): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) AS count FROM t_agent").get() as {
        count: number;
      }
    ).count;
    if (count) return;
    const defaults: CreateAgentInput[] = [
      {
        name: "Leader",
        icon: "L",
        description: "团队负责人",
        responsibility: "理解目标、分派任务、检查真实证据并推进 Workflow",
        qualityBar: ["不以 exit 0 直接判定任务完成", "重大取舍升级给用户"],
        runtime: "claude",
        command: null,
        argsTemplate: null,
        workspaceIds: [],
        permissions: fullPermissions(true),
      },
      {
        name: "Code Agent",
        icon: "C",
        description: "实现与修复专家",
        responsibility: "阅读代码、完成最小范围实现并提供测试和 Diff 证据",
        qualityBar: ["保持兼容", "变更必须有验证"],
        runtime: "codex",
        command: null,
        argsTemplate: null,
        workspaceIds: [],
        permissions: fullPermissions(true),
      },
      {
        name: "Architect",
        icon: "A",
        description: "架构与边界审查",
        responsibility: "分析系统边界、契约、风险与演进路径",
        qualityBar: ["结论必须关联源码或 Artifact"],
        runtime: "claude",
        command: null,
        argsTemplate: null,
        workspaceIds: [],
        permissions: fullPermissions(false),
      },
      {
        name: "QA Agent",
        icon: "Q",
        description: "独立验证专家",
        responsibility: "构建复现、执行独立验证与回归检查",
        qualityBar: ["不接受实现者自验替代独立验证"],
        runtime: "codex",
        command: null,
        argsTemplate: null,
        workspaceIds: [],
        permissions: fullPermissions(false),
      },
    ];
    for (const agent of defaults) this.createAgent(agent);
  }

  snapshot(runtimes: RuntimeInfo[]): AppSnapshot {
    return {
      changes: (
        this.db
          .prepare("SELECT * FROM t_change ORDER BY updated_at DESC")
          .all() as Record<string, unknown>[]
      ).map(mapChange),
      agents: (
        this.db
          .prepare("SELECT * FROM t_agent ORDER BY created_at")
          .all() as Record<string, unknown>[]
      ).map(mapAgent),
      workspaces: (
        this.db
          .prepare("SELECT * FROM t_workspace ORDER BY created_at DESC")
          .all() as Record<string, unknown>[]
      ).map(mapWorkspace),
      runtimes,
      messages: (
        this.db
          .prepare("SELECT * FROM t_message ORDER BY created_at")
          .all() as Record<string, unknown>[]
      ).map(mapMessage),
      runs: this.mapRuns(
        this.db
          .prepare("SELECT * FROM t_run ORDER BY created_at DESC LIMIT 500")
          .all() as Record<string, unknown>[],
      ),
      artifacts: (
        this.db
          .prepare("SELECT * FROM t_artifact ORDER BY created_at DESC")
          .all() as Record<string, unknown>[]
      ).map(mapArtifact),
      bindings: (
        this.db
          .prepare("SELECT * FROM t_agent_workspace ORDER BY created_at")
          .all() as Record<string, unknown>[]
      ).map(mapBinding),
      workstreams: (
        this.db
          .prepare("SELECT * FROM t_workstream ORDER BY created_at")
          .all() as Record<string, unknown>[]
      ).map(mapWorkstream),
      tasks: (
        this.db
          .prepare("SELECT * FROM t_task ORDER BY created_at")
          .all() as Record<string, unknown>[]
      ).map(mapTask),
      agentSessions: (
        this.db
          .prepare("SELECT * FROM t_agent_session ORDER BY created_at")
          .all() as Record<string, unknown>[]
      ).map(mapAgentSession),
      handoffs: (
        this.db
          .prepare("SELECT * FROM t_handoff ORDER BY created_at")
          .all() as Record<string, unknown>[]
      ).map(mapHandoff),
      issues: (
        this.db
          .prepare("SELECT * FROM t_issue ORDER BY created_at")
          .all() as Record<string, unknown>[]
      ).map(mapIssue),
      interventions: (
        this.db
          .prepare("SELECT * FROM t_human_intervention ORDER BY created_at")
          .all() as Record<string, unknown>[]
      ).map(mapIntervention),
      conversations: (
        this.db
          .prepare("SELECT * FROM t_conversation ORDER BY updated_at DESC")
          .all() as Record<string, unknown>[]
      ).map(mapConversation),
      conversationParticipants: (
        this.db
          .prepare(
            "SELECT * FROM t_conversation_participant ORDER BY speaking_order",
          )
          .all() as Record<string, unknown>[]
      ).map(mapConversationParticipant),
      conversationRounds: (
        this.db
          .prepare(
            "SELECT * FROM t_conversation_round ORDER BY conversation_id,number",
          )
          .all() as Record<string, unknown>[]
      ).map(mapConversationRound),
      conversationTurns: (
        this.db
          .prepare(
            "SELECT * FROM t_conversation_turn ORDER BY conversation_id,sequence",
          )
          .all() as Record<string, unknown>[]
      ).map(mapConversationTurn),
      conversationMemories: (
        this.db
          .prepare("SELECT * FROM t_conversation_memory ORDER BY updated_at")
          .all() as Record<string, unknown>[]
      ).map(mapConversationMemory),
      conversationDeliverables: (
        this.db
          .prepare(
            "SELECT * FROM t_conversation_deliverable ORDER BY created_at DESC",
          )
          .all() as Record<string, unknown>[]
      ).map(mapConversationDeliverable),
      agentProfiles: (
        this.db
          .prepare("SELECT * FROM t_agent_profile ORDER BY updated_at DESC")
          .all() as Record<string, unknown>[]
      ).map(mapAgentProfile),
      memories: (
        this.db
          .prepare(
            "SELECT * FROM t_memory_entry ORDER BY updated_at DESC LIMIT 500",
          )
          .all() as Record<string, unknown>[]
      ).map(mapMemory),
      skills: (
        this.db
          .prepare("SELECT * FROM t_skill ORDER BY updated_at DESC")
          .all() as Record<string, unknown>[]
      ).map(mapSkill),
      skillVersions: (
        this.db
          .prepare("SELECT * FROM t_skill_version ORDER BY created_at DESC")
          .all() as Record<string, unknown>[]
      ).map(mapSkillVersion),
      workOrders: (
        this.db
          .prepare(
            "SELECT * FROM t_work_order ORDER BY updated_at DESC LIMIT 500",
          )
          .all() as Record<string, unknown>[]
      ).map(mapWorkOrder),
      deliverables: (
        this.db
          .prepare(
            "SELECT * FROM t_deliverable ORDER BY created_at DESC LIMIT 500",
          )
          .all() as Record<string, unknown>[]
      ).map(mapDeliverable),
      schedules: (
        this.db
          .prepare("SELECT * FROM t_schedule ORDER BY updated_at DESC")
          .all() as Record<string, unknown>[]
      ).map(mapSchedule),
      scheduleExecutions: (
        this.db
          .prepare(
            "SELECT * FROM t_schedule_execution ORDER BY created_at DESC LIMIT 500",
          )
          .all() as Record<string, unknown>[]
      ).map(mapScheduleExecution),
      notifications: (
        this.db
          .prepare(
            "SELECT * FROM t_notification ORDER BY created_at DESC LIMIT 100",
          )
          .all() as Record<string, unknown>[]
      ).map(mapNotification),
    };
  }

  addWorkspace(workspace: Omit<Workspace, "id" | "createdAt">): Workspace {
    const existing = this.db
      .prepare("SELECT * FROM t_workspace WHERE path=?")
      .get(workspace.path) as Record<string, unknown> | undefined;
    if (existing) return mapWorkspace(existing);
    const value: Workspace = {
      ...workspace,
      id: randomUUID(),
      createdAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO t_workspace VALUES (@id,@name,@path,@repoRoot,@branch,@baseCommit,@createdAt)",
      )
      .run(value);
    this.event("workspace", value.id, "WORKSPACE_ADDED", value);
    return value;
  }

  createAgent(input: CreateAgentInput): Agent {
    const value: Agent = {
      ...input,
      id: randomUUID(),
      status: "IDLE",
      currentRunId: null,
      createdAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO t_agent (id,name,icon,description,responsibility,quality_bar,runtime,command,args_template,workspace_ids,permissions,status,current_run_id,created_at)
      VALUES (@id,@name,@icon,@description,@responsibility,@qualityBar,@runtime,@command,@argsTemplate,@workspaceIds,@permissions,@status,@currentRunId,@createdAt)`,
      )
      .run({
        ...value,
        qualityBar: json(value.qualityBar),
        workspaceIds: json(value.workspaceIds),
        permissions: json(value.permissions),
      });
    this.event("agent", value.id, "AGENT_CREATED", value);
    this.upsertAgentProfile({
      agentId: value.id,
      positionTitle: value.description,
      outcomeStatement: value.responsibility,
      recurringResponsibilities: [],
      preferredSources: [],
      standardDeliverables: [],
      acceptanceCriteria: value.qualityBar,
      prohibitedActions: [],
      approvalPoints: [],
      failurePolicy: "数据缺失或无法核验时进入阻塞，并明确说明原因。",
      defaultSkillIds: [],
      status: "DRAFT",
    });
    return value;
  }

  createChange(input: CreateChangeInput): Change {
    const number =
      ((
        this.db.prepare("SELECT MAX(number) AS n FROM t_change").get() as {
          n: number | null;
        }
      ).n ?? 1023) + 1;
    const time = now();
    const value: Change = {
      ...input,
      id: randomUUID(),
      number,
      dueDate: input.dueDate ?? null,
      status: "RUNNING",
      currentPhase: 0,
      createdAt: time,
      updatedAt: time,
    };
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO t_change (id,number,title,description,workflow_type,priority,due_date,status,current_phase,workspace_ids,agent_ids,tags,created_at,updated_at)
        VALUES (@id,@number,@title,@description,@workflowType,@priority,@dueDate,@status,@currentPhase,@workspaceIds,@agentIds,@tags,@createdAt,@updatedAt)`,
        )
        .run({
          ...value,
          workspaceIds: json(value.workspaceIds),
          agentIds: json(value.agentIds),
          tags: json(value.tags),
        });
      for (const binding of input.agentBindings) {
        const id = randomUUID();
        this.db
          .prepare("INSERT INTO t_agent_workspace VALUES (?,?,?,?,?,?)")
          .run(
            id,
            value.id,
            binding.agentId,
            binding.workspaceId,
            json(binding.permissions),
            time,
          );
        const workspace = this.getWorkspace(binding.workspaceId);
        this.db
          .prepare("INSERT INTO t_workstream VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run(
            randomUUID(),
            value.id,
            binding.workspaceId,
            binding.agentId,
            `${workspace?.name ?? "Workspace"} · ${binding.agentId.slice(0, 6)}`,
            "READY",
            null,
            null,
            workspace?.baseCommit ?? null,
            time,
            time,
          );
      }
      this.addMessage(
        value.id,
        "system",
        null,
        "System",
        `任务 #${number} 已创建。Workspace 与 Agent 已就绪，当前进入 Discovery。`,
        null,
      );
      this.event("change", value.id, "CHANGE_CREATED", value);
    });
    tx();
    return value;
  }

  addMessage(
    changeId: string,
    senderType: Message["senderType"],
    senderId: string | null,
    senderName: string,
    content: string,
    runId: string | null,
  ): Message {
    const value: Message = {
      id: randomUUID(),
      changeId,
      senderType,
      senderId,
      senderName,
      content,
      runId,
      createdAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO t_message VALUES (@id,@changeId,@senderType,@senderId,@senderName,@content,@runId,@createdAt)",
      )
      .run(value);
    this.event("change", changeId, "MESSAGE_CREATED", value);
    return value;
  }

  getAgent(id: string): Agent | undefined {
    const row = this.db.prepare("SELECT * FROM t_agent WHERE id=?").get(id) as
      Record<string, unknown> | undefined;
    return row ? mapAgent(row) : undefined;
  }

  getChange(id: string): Change | undefined {
    const row = this.db.prepare("SELECT * FROM t_change WHERE id=?").get(id) as
      Record<string, unknown> | undefined;
    return row ? mapChange(row) : undefined;
  }

  getWorkspace(id: string): Workspace | undefined {
    const row = this.db
      .prepare("SELECT * FROM t_workspace WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapWorkspace(row) : undefined;
  }

  createRun(value: Run): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO t_run (id,change_id,work_order_id,agent_id,parent_run_id,task_id,agent_session_id,status,prompt,runtime,executable,workspace_path,started_at,ended_at,exit_code,session_id,stdout,stderr,final_response,base_commit,retry_reason,created_at)
        VALUES (@id,@changeId,@workOrderId,@agentId,@parentRunId,@taskId,@agentSessionId,@status,@prompt,@runtime,@executable,@workspacePath,@startedAt,@endedAt,@exitCode,@sessionId,@stdout,@stderr,@finalResponse,@baseCommit,@retryReason,@createdAt)`,
        )
        .run({
          ...value,
          workOrderId: value.workOrderId ?? null,
          createdAt: now(),
        });
      this.db
        .prepare(
          "UPDATE t_agent SET status='RUNNING', current_run_id=? WHERE id=?",
        )
        .run(value.id, value.agentId);
      this.event("run", value.id, "RUN_QUEUED", {
        changeId: value.changeId,
        workOrderId: value.workOrderId,
        agentId: value.agentId,
      });
    });
    tx();
  }

  updateRun(
    id: string,
    patch: Partial<
      Pick<
        Run,
        | "status"
        | "startedAt"
        | "endedAt"
        | "exitCode"
        | "sessionId"
        | "stdout"
        | "stderr"
        | "finalResponse"
      >
    >,
  ): void {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };
    const names: Record<string, string> = {
      startedAt: "started_at",
      endedAt: "ended_at",
      exitCode: "exit_code",
      sessionId: "session_id",
      finalResponse: "final_response",
      status: "status",
      stdout: "stdout",
      stderr: "stderr",
    };
    for (const [key, value] of Object.entries(patch)) {
      fields.push(`${names[key]}=@${key}`);
      values[key] = value;
    }
    if (fields.length)
      this.db
        .prepare(`UPDATE t_run SET ${fields.join(",")} WHERE id=@id`)
        .run(values);
    if (
      patch.status &&
      ["COMPLETED", "FAILED", "CANCELLED", "PAUSED", "INTERRUPTED"].includes(
        patch.status,
      )
    ) {
      this.db
        .prepare(
          "UPDATE t_agent SET status=CASE WHEN ?='PAUSED' THEN 'PAUSED' WHEN ?='FAILED' THEN 'ERROR' ELSE 'IDLE' END, current_run_id=NULL WHERE current_run_id=?",
        )
        .run(patch.status, patch.status, id);
    }
    if (patch.status) this.event("run", id, `RUN_${patch.status}`, patch);
  }

  getRun(id: string): Run | undefined {
    const row = this.db.prepare("SELECT * FROM t_run WHERE id=?").get(id) as
      Record<string, unknown> | undefined;
    return row ? this.mapRun(row) : undefined;
  }

  getBinding(
    changeId: string,
    agentId: string,
  ): AgentWorkspaceBinding | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM t_agent_workspace WHERE change_id=? AND agent_id=? ORDER BY created_at LIMIT 1",
      )
      .get(changeId, agentId) as Record<string, unknown> | undefined;
    return row ? mapBinding(row) : undefined;
  }

  getWorkstream(
    changeId: string,
    agentId: string,
    workspaceId?: string,
  ): Workstream | undefined {
    const row = (
      workspaceId
        ? this.db
            .prepare(
              "SELECT * FROM t_workstream WHERE change_id=? AND agent_id=? AND workspace_id=? LIMIT 1",
            )
            .get(changeId, agentId, workspaceId)
        : this.db
            .prepare(
              "SELECT * FROM t_workstream WHERE change_id=? AND agent_id=? ORDER BY created_at LIMIT 1",
            )
            .get(changeId, agentId)
    ) as Record<string, unknown> | undefined;
    return row ? mapWorkstream(row) : undefined;
  }

  updateWorkstream(
    id: string,
    patch: Partial<
      Pick<Workstream, "status" | "worktreePath" | "branch" | "baseCommit">
    >,
  ): void {
    const map: Record<string, string> = {
      status: "status",
      worktreePath: "worktree_path",
      branch: "branch",
      baseCommit: "base_commit",
    };
    const fields: string[] = [];
    const values: Record<string, unknown> = { id, updatedAt: now() };
    for (const [key, value] of Object.entries(patch)) {
      fields.push(`${map[key]}=@${key}`);
      values[key] = value;
    }
    if (fields.length)
      this.db
        .prepare(
          `UPDATE t_workstream SET ${fields.join(",")},updated_at=@updatedAt WHERE id=@id`,
        )
        .run(values);
  }

  createTask(input: Omit<Task, "id" | "createdAt" | "updatedAt">): Task {
    const time = now();
    const value: Task = {
      ...input,
      id: randomUUID(),
      createdAt: time,
      updatedAt: time,
    };
    this.db
      .prepare(
        `INSERT INTO t_task VALUES (@id,@changeId,@workstreamId,@phaseId,@title,@description,@assignedAgentId,@verifierAgentId,@status,@requiredEvidence,@currentRunId,@parentTaskId,@createdAt,@updatedAt)`,
      )
      .run({ ...value, requiredEvidence: json(value.requiredEvidence) });
    this.event("task", value.id, "TASK_CREATED", value);
    return value;
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare("SELECT * FROM t_task WHERE id=?").get(id) as
      Record<string, unknown> | undefined;
    return row ? mapTask(row) : undefined;
  }

  getPhaseTasks(changeId: string, phaseId: string): Task[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM t_task WHERE change_id=? AND phase_id=? ORDER BY created_at",
        )
        .all(changeId, phaseId) as Record<string, unknown>[]
    ).map(mapTask);
  }
  findReworkTask(
    changeId: string,
    phaseId: string,
    agentId: string,
  ): Task | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM t_task WHERE change_id=? AND phase_id=? AND assigned_agent_id=? AND status IN ('REWORK','BLOCKED') ORDER BY updated_at DESC LIMIT 1",
      )
      .get(changeId, phaseId, agentId) as Record<string, unknown> | undefined;
    return row ? mapTask(row) : undefined;
  }

  updateTask(
    id: string,
    status: TaskStatus,
    currentRunId?: string | null,
    verifierAgentId?: string | null,
  ): void {
    this.db
      .prepare(
        "UPDATE t_task SET status=?, current_run_id=COALESCE(?,current_run_id), verifier_agent_id=COALESCE(?,verifier_agent_id), updated_at=? WHERE id=?",
      )
      .run(status, currentRunId ?? null, verifierAgentId ?? null, now(), id);
    this.event("task", id, `TASK_${status}`, { currentRunId, verifierAgentId });
  }

  ensureAgentSession(
    changeId: string,
    agentId: string,
    workspaceId: string,
    runtime: AgentSession["runtime"],
  ): AgentSession {
    const existing = this.db
      .prepare(
        "SELECT * FROM t_agent_session WHERE subject_type='CHANGE' AND subject_id=? AND agent_id=? AND workspace_id=?",
      )
      .get(changeId, agentId, workspaceId) as
      Record<string, unknown> | undefined;
    if (existing) return mapAgentSession(existing);
    const time = now();
    const value: AgentSession = {
      id: randomUUID(),
      changeId,
      workOrderId: null,
      subjectType: "CHANGE",
      subjectId: changeId,
      agentId,
      workspaceId,
      nativeSessionId: null,
      runtime,
      status: "ACTIVE",
      summary: null,
      createdAt: time,
      updatedAt: time,
    };
    this.db
      .prepare(
        `INSERT INTO t_agent_session (id,change_id,work_order_id,subject_type,subject_id,agent_id,workspace_id,native_session_id,runtime,status,summary,created_at,updated_at)
      VALUES (@id,@changeId,@workOrderId,@subjectType,@subjectId,@agentId,@workspaceId,@nativeSessionId,@runtime,@status,@summary,@createdAt,@updatedAt)`,
      )
      .run(value);
    return value;
  }

  ensureWorkOrderSession(
    workOrderId: string,
    agentId: string,
    workspaceId: string | null,
    runtime: AgentSession["runtime"],
  ): AgentSession {
    const existing = this.db
      .prepare(
        "SELECT * FROM t_agent_session WHERE subject_type='WORK_ORDER' AND subject_id=? AND agent_id=? AND IFNULL(workspace_id,'')=IFNULL(?,'')",
      )
      .get(workOrderId, agentId, workspaceId) as
      Record<string, unknown> | undefined;
    if (existing) return mapAgentSession(existing);
    const time = now();
    const value: AgentSession = {
      id: randomUUID(),
      changeId: null,
      workOrderId,
      subjectType: "WORK_ORDER",
      subjectId: workOrderId,
      agentId,
      workspaceId,
      nativeSessionId: null,
      runtime,
      status: "ACTIVE",
      summary: null,
      createdAt: time,
      updatedAt: time,
    };
    this.db
      .prepare(
        `INSERT INTO t_agent_session (id,change_id,work_order_id,subject_type,subject_id,agent_id,workspace_id,native_session_id,runtime,status,summary,created_at,updated_at)
      VALUES (@id,@changeId,@workOrderId,@subjectType,@subjectId,@agentId,@workspaceId,@nativeSessionId,@runtime,@status,@summary,@createdAt,@updatedAt)`,
      )
      .run(value);
    return value;
  }

  updateAgentSession(
    id: string,
    nativeSessionId: string | null,
    status: AgentSession["status"],
    summary?: string | null,
  ): void {
    this.db
      .prepare(
        "UPDATE t_agent_session SET native_session_id=COALESCE(?,native_session_id),status=?,summary=COALESCE(?,summary),updated_at=? WHERE id=?",
      )
      .run(nativeSessionId, status, summary ?? null, now(), id);
  }

  createHandoff(
    input: Omit<Handoff, "id" | "createdAt" | "acceptedAt" | "status">,
  ): Handoff {
    const value: Handoff = {
      ...input,
      id: randomUUID(),
      status: "CREATED",
      createdAt: now(),
      acceptedAt: null,
    };
    this.db
      .prepare(
        "INSERT INTO t_handoff VALUES (@id,@changeId,@fromTaskId,@fromAgentId,@toTaskId,@toAgentId,@deliverable,@evidenceIds,@status,@createdAt,@acceptedAt)",
      )
      .run({ ...value, evidenceIds: json(value.evidenceIds) });
    this.event("handoff", value.id, "HANDOFF_CREATED", value);
    return value;
  }

  createIssue(
    input: Omit<
      Issue,
      "id" | "createdAt" | "updatedAt" | "status" | "resolution"
    >,
  ): Issue {
    const time = now();
    const value: Issue = {
      ...input,
      id: randomUUID(),
      status: "OPEN",
      resolution: null,
      createdAt: time,
      updatedAt: time,
    };
    this.db
      .prepare(
        "INSERT INTO t_issue VALUES (@id,@changeId,@taskId,@ownerAgentId,@title,@description,@severity,@status,@sourceEvidenceId,@resolution,@createdAt,@updatedAt)",
      )
      .run(value);
    this.event("issue", value.id, "ISSUE_CREATED", value);
    return value;
  }

  updateIssue(id: string, status: IssueStatus, resolution?: string): void {
    this.db
      .prepare(
        "UPDATE t_issue SET status=?,resolution=COALESCE(?,resolution),updated_at=? WHERE id=?",
      )
      .run(status, resolution ?? null, now(), id);
    this.event("issue", id, `ISSUE_${status}`, { resolution });
  }
  resolveTaskIssues(taskId: string, resolution: string): void {
    this.db
      .prepare(
        "UPDATE t_issue SET status='RESOLVED',resolution=?,updated_at=? WHERE task_id=? AND status IN ('OPEN','FIXING')",
      )
      .run(resolution, now(), taskId);
  }
  hasBlockingIssues(changeId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM t_issue WHERE change_id=? AND severity='BLOCKING' AND status NOT IN ('RESOLVED','VERIFIED','WONT_FIX') LIMIT 1",
        )
        .get(changeId),
    );
  }

  addIntervention(
    input: Omit<HumanIntervention, "id" | "createdAt">,
  ): HumanIntervention {
    const value: HumanIntervention = {
      ...input,
      id: randomUUID(),
      createdAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO t_human_intervention VALUES (@id,@changeId,@targetAgentId,@affectedRunId,@reason,@newConstraints,@operator,@createdAt)",
      )
      .run(value);
    this.event("change", value.changeId, "HUMAN_INTERVENTION", value);
    return value;
  }

  findActiveRun(changeId: string, agentId: string): Run | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM t_run WHERE change_id=? AND agent_id=? AND status IN ('QUEUED','STARTING','RUNNING') ORDER BY created_at DESC LIMIT 1",
      )
      .get(changeId, agentId) as Record<string, unknown> | undefined;
    return row ? this.mapRun(row) : undefined;
  }

  updateChangeState(
    changeId: string,
    status: Change["status"],
    phase?: number,
  ): void {
    this.db
      .prepare(
        "UPDATE t_change SET status=?,current_phase=COALESCE(?,current_phase),updated_at=? WHERE id=?",
      )
      .run(status, phase ?? null, now(), changeId);
    this.event("change", changeId, `CHANGE_${status}`, { phase });
  }

  createConversation(input: CreateConversationInput): Conversation {
    const leaders = input.participants.filter((item) => item.isLeader);
    if (input.participants.length < 2 || input.participants.length > 6)
      throw new Error("主题讨论需要 2～6 个参与角色");
    if (leaders.length !== 1)
      throw new Error("主题讨论必须且只能有一个 Leader");
    if (
      new Set(
        input.participants.map((item) =>
          item.roleName.trim().toLocaleLowerCase(),
        ),
      ).size !== input.participants.length
    )
      throw new Error("同一讨论中的角色名称不能重复");
    const number =
      ((
        this.db
          .prepare("SELECT MAX(number) AS n FROM t_conversation")
          .get() as { n: number | null }
      ).n ?? 0) + 1;
    const time = now();
    const value: Conversation = {
      id: randomUUID(),
      number,
      title: input.title.trim(),
      topic: input.topic.trim(),
      background: input.background.trim(),
      mode: input.mode,
      status: "DRAFT",
      currentRound: 0,
      maxRounds: clamp(input.maxRounds, 1, 50),
      messageCount: 0,
      tokenUsed: 0,
      stopReason: null,
      createdAt: time,
      updatedAt: time,
    };
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO t_conversation (id,number,title,topic,background,mode,status,current_round,max_rounds,max_messages,max_tokens,message_count,token_used,stop_reason,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          value.id,
          value.number,
          value.title,
          value.topic,
          value.background,
          value.mode,
          value.status,
          value.currentRound,
          value.maxRounds,
          LEGACY_UNBOUNDED_LIMIT,
          LEGACY_UNBOUNDED_LIMIT,
          value.messageCount,
          value.tokenUsed,
          value.stopReason,
          value.createdAt,
          value.updatedAt,
        );
      input.participants.forEach((participant, index) => {
        const agent = this.getAgent(participant.agentId);
        if (!agent) throw new Error(`Agent ${participant.agentId} 不存在`);
        this.db
          .prepare(
            `INSERT INTO t_conversation_participant (id,conversation_id,agent_id,role_name,role_prompt,speaking_order,is_leader,enabled,native_session_id,last_seen_turn_sequence,memory_version,session_generation,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            randomUUID(),
            value.id,
            participant.agentId,
            participant.roleName.trim() || agent.name,
            participant.rolePrompt.trim(),
            index,
            participant.isLeader ? 1 : 0,
            1,
            null,
            0,
            0,
            1,
            time,
          );
      });
      this.db
        .prepare("INSERT INTO t_conversation_memory VALUES (?,?,?,?,?,?,?,?,?)")
        .run(
          randomUUID(),
          value.id,
          1,
          "",
          json([]),
          json([]),
          json([]),
          json([]),
          time,
        );
      this.event("conversation", value.id, "CONVERSATION_CREATED", input);
    });
    tx();
    return this.getConversation(value.id)!;
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.db
      .prepare("SELECT * FROM t_conversation WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapConversation(row) : undefined;
  }
  getConversationParticipants(id: string): ConversationParticipant[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM t_conversation_participant WHERE conversation_id=? AND enabled=1 ORDER BY speaking_order",
        )
        .all(id) as Record<string, unknown>[]
    ).map(mapConversationParticipant);
  }
  getConversationTurns(id: string, limit?: number): ConversationTurn[] {
    const rows = limit
      ? this.db
          .prepare(
            "SELECT * FROM (SELECT * FROM t_conversation_turn WHERE conversation_id=? ORDER BY sequence DESC LIMIT ?) ORDER BY sequence",
          )
          .all(id, limit)
      : this.db
          .prepare(
            "SELECT * FROM t_conversation_turn WHERE conversation_id=? ORDER BY sequence",
          )
          .all(id);
    return (rows as Record<string, unknown>[]).map(mapConversationTurn);
  }
  getConversationTurnsAfter(id: string, sequence: number): ConversationTurn[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM t_conversation_turn WHERE conversation_id=? AND sequence>? ORDER BY sequence",
        )
        .all(id, sequence) as Record<string, unknown>[]
    ).map(mapConversationTurn);
  }
  getConversationMemory(id: string): ConversationMemory | undefined {
    const row = this.db
      .prepare("SELECT * FROM t_conversation_memory WHERE conversation_id=?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapConversationMemory(row) : undefined;
  }
  getConversationDeliverables(id: string): ConversationDeliverable[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM t_conversation_deliverable WHERE conversation_id=? ORDER BY created_at DESC",
        )
        .all(id) as Record<string, unknown>[]
    ).map(mapConversationDeliverable);
  }

  updateConversationStatus(
    id: string,
    status: ConversationStatus,
    stopReason: Conversation["stopReason"] = null,
  ): void {
    this.db
      .prepare(
        "UPDATE t_conversation SET status=?,stop_reason=?,updated_at=? WHERE id=?",
      )
      .run(status, stopReason, now(), id);
    this.event("conversation", id, `CONVERSATION_${status}`, { stopReason });
  }
  updateConversationProgress(
    id: string,
    round: number,
    addedMessages: number,
    addedTokens: number,
  ): void {
    this.db
      .prepare(
        "UPDATE t_conversation SET current_round=?,message_count=message_count+?,token_used=token_used+?,updated_at=? WHERE id=?",
      )
      .run(round, addedMessages, addedTokens, now(), id);
  }
  extendConversation(id: string, additionalRounds: number): void {
    this.db
      .prepare(
        "UPDATE t_conversation SET max_rounds=MIN(50,current_round+?),status='PAUSED',stop_reason=NULL,updated_at=? WHERE id=?",
      )
      .run(additionalRounds, now(), id);
    this.event("conversation", id, "CONVERSATION_EXTENDED", {
      additionalRounds,
    });
  }

  createConversationRound(
    conversationId: string,
    number: number,
    focus: string,
  ): ConversationRound {
    const value: ConversationRound = {
      id: randomUUID(),
      conversationId,
      number,
      focus,
      status: "RUNNING",
      createdAt: now(),
      completedAt: null,
    };
    this.db
      .prepare(
        "INSERT INTO t_conversation_round VALUES (@id,@conversationId,@number,@focus,@status,@createdAt,@completedAt)",
      )
      .run(value);
    return value;
  }
  finishConversationRound(
    id: string,
    status: ConversationRound["status"],
  ): void {
    this.db
      .prepare(
        "UPDATE t_conversation_round SET status=?,completed_at=? WHERE id=?",
      )
      .run(status, now(), id);
  }
  interruptActiveConversationRound(conversationId: string): void {
    const row = this.db
      .prepare(
        "SELECT id,number FROM t_conversation_round WHERE conversation_id=? AND status='RUNNING' ORDER BY number DESC LIMIT 1",
      )
      .get(conversationId) as { id: string; number: number } | undefined;
    if (!row) return;
    this.finishConversationRound(row.id, "INTERRUPTED");
    this.updateConversationProgress(conversationId, row.number, 0, 0);
  }

  createConversationTurn(
    input: Omit<
      ConversationTurn,
      | "id"
      | "sequence"
      | "createdAt"
      | "completedAt"
      | "inputTokens"
      | "outputTokens"
      | "cachedInputTokens"
      | "cacheCreationInputTokens"
      | "reasoningOutputTokens"
      | "totalTokens"
      | "costUsd"
      | "model"
      | "error"
    >,
  ): ConversationTurn {
    const sequence = Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM t_conversation_turn WHERE conversation_id=?",
          )
          .get(input.conversationId) as { sequence: number }
      ).sequence,
    );
    const value: ConversationTurn = {
      ...input,
      id: randomUUID(),
      sequence,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      costUsd: null,
      model: null,
      error: null,
      createdAt: now(),
      completedAt: input.status === "COMPLETED" ? now() : null,
    };
    this.db
      .prepare(
        `INSERT INTO t_conversation_turn (id,conversation_id,round_id,participant_id,agent_id,speaker_type,speaker_name,sequence,content,status,input_tokens,output_tokens,cached_input_tokens,cache_creation_input_tokens,reasoning_output_tokens,total_tokens,cost_usd,model,error,created_at,completed_at)
      VALUES (@id,@conversationId,@roundId,@participantId,@agentId,@speakerType,@speakerName,@sequence,@content,@status,@inputTokens,@outputTokens,@cachedInputTokens,@cacheCreationInputTokens,@reasoningOutputTokens,@totalTokens,@costUsd,@model,@error,@createdAt,@completedAt)`,
      )
      .run(value);
    return value;
  }
  updateConversationTurn(
    id: string,
    patch: Partial<
      Pick<
        ConversationTurn,
        | "content"
        | "status"
        | "inputTokens"
        | "outputTokens"
        | "cachedInputTokens"
        | "cacheCreationInputTokens"
        | "reasoningOutputTokens"
        | "totalTokens"
        | "costUsd"
        | "model"
        | "error"
      >
    >,
  ): void {
    const columns: Record<string, string> = {
      content: "content",
      status: "status",
      inputTokens: "input_tokens",
      outputTokens: "output_tokens",
      cachedInputTokens: "cached_input_tokens",
      cacheCreationInputTokens: "cache_creation_input_tokens",
      reasoningOutputTokens: "reasoning_output_tokens",
      totalTokens: "total_tokens",
      costUsd: "cost_usd",
      model: "model",
      error: "error",
    };
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };
    for (const [key, value] of Object.entries(patch)) {
      fields.push(`${columns[key]}=@${key}`);
      values[key] = value;
    }
    if (
      patch.status &&
      ["COMPLETED", "FAILED", "CANCELLED"].includes(patch.status)
    ) {
      fields.push("completed_at=@completedAt");
      values.completedAt = now();
    }
    if (fields.length)
      this.db
        .prepare(
          `UPDATE t_conversation_turn SET ${fields.join(",")} WHERE id=@id`,
        )
        .run(values);
  }
  updateConversationParticipantSession(
    id: string,
    sessionId: string | null,
    lastSeenTurnSequence: number,
    memoryVersion: number,
  ): void {
    this.db
      .prepare(
        "UPDATE t_conversation_participant SET native_session_id=COALESCE(?,native_session_id),last_seen_turn_sequence=MAX(last_seen_turn_sequence,?),memory_version=MAX(memory_version,?) WHERE id=?",
      )
      .run(sessionId, lastSeenTurnSequence, memoryVersion, id);
  }

  updateConversationMemory(
    conversationId: string,
    patch: Pick<
      ConversationMemory,
      | "summary"
      | "consensus"
      | "disagreements"
      | "openQuestions"
      | "userPreferences"
    >,
  ): void {
    this.db
      .prepare(
        "UPDATE t_conversation_memory SET version=version+1,summary=?,consensus=?,disagreements=?,open_questions=?,user_preferences=?,updated_at=? WHERE conversation_id=?",
      )
      .run(
        patch.summary,
        json(patch.consensus),
        json(patch.disagreements),
        json(patch.openQuestions),
        json(patch.userPreferences),
        now(),
        conversationId,
      );
  }

  createConversationDeliverable(
    conversationId: string,
    type: ConversationDeliverable["type"],
    title: string,
    content: string,
  ): ConversationDeliverable {
    const value: ConversationDeliverable = {
      id: randomUUID(),
      conversationId,
      type,
      title,
      content,
      status: "FINAL",
      convertedChangeId: null,
      createdAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO t_conversation_deliverable VALUES (@id,@conversationId,@type,@title,@content,@status,@convertedChangeId,@createdAt)",
      )
      .run(value);
    this.event(
      "conversation",
      conversationId,
      "CONVERSATION_DELIVERABLE_CREATED",
      { id: value.id, type },
    );
    return value;
  }
  markConversationConverted(deliverableId: string, changeId: string): void {
    this.db
      .prepare(
        "UPDATE t_conversation_deliverable SET converted_change_id=? WHERE id=?",
      )
      .run(changeId, deliverableId);
  }

  getAgentProfile(agentId: string): AgentProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM t_agent_profile WHERE agent_id=?")
      .get(agentId) as Record<string, unknown> | undefined;
    return row ? mapAgentProfile(row) : undefined;
  }

  upsertAgentProfile(input: UpsertAgentProfileInput): AgentProfile {
    const existing = this.getAgentProfile(input.agentId);
    const time = now();
    const value: AgentProfile = {
      ...input,
      id: existing?.id ?? randomUUID(),
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? time,
      updatedAt: time,
    };
    this.db
      .prepare(
        `INSERT INTO t_agent_profile (id,agent_id,position_title,outcome_statement,recurring_responsibilities,preferred_sources,standard_deliverables,acceptance_criteria,prohibited_actions,approval_points,failure_policy,default_skill_ids,status,version,created_at,updated_at)
      VALUES (@id,@agentId,@positionTitle,@outcomeStatement,@recurringResponsibilities,@preferredSources,@standardDeliverables,@acceptanceCriteria,@prohibitedActions,@approvalPoints,@failurePolicy,@defaultSkillIds,@status,@version,@createdAt,@updatedAt)
      ON CONFLICT(agent_id) DO UPDATE SET position_title=excluded.position_title,outcome_statement=excluded.outcome_statement,recurring_responsibilities=excluded.recurring_responsibilities,preferred_sources=excluded.preferred_sources,standard_deliverables=excluded.standard_deliverables,acceptance_criteria=excluded.acceptance_criteria,prohibited_actions=excluded.prohibited_actions,approval_points=excluded.approval_points,failure_policy=excluded.failure_policy,default_skill_ids=excluded.default_skill_ids,status=excluded.status,version=excluded.version,updated_at=excluded.updated_at`,
      )
      .run({
        ...value,
        recurringResponsibilities: json(value.recurringResponsibilities),
        preferredSources: json(value.preferredSources),
        standardDeliverables: json(value.standardDeliverables),
        acceptanceCriteria: json(value.acceptanceCriteria),
        prohibitedActions: json(value.prohibitedActions),
        approvalPoints: json(value.approvalPoints),
        defaultSkillIds: json(value.defaultSkillIds),
      });
    this.db
      .prepare(
        "INSERT OR REPLACE INTO t_agent_profile_revision VALUES (?,?,?,?,?)",
      )
      .run(randomUUID(), value.id, value.version, json(value), time);
    this.event(
      "agent-profile",
      value.id,
      existing ? "PROFILE_UPDATED" : "PROFILE_CREATED",
      { agentId: input.agentId, version: value.version },
    );
    return value;
  }

  createMemory(input: CreateMemoryInput): MemoryEntry {
    if (
      input.provenance === "UNTRUSTED" &&
      input.scope === "ROLE" &&
      input.kind === "RULE"
    )
      throw new Error("不可信来源不能创建岗位规则");
    const time = now();
    const activate =
      Boolean(input.activate) &&
      (input.sourceType === "HUMAN" ||
        (input.sourceType === "RUN" &&
          input.scope === "EPISODE" &&
          input.kind !== "RULE"));
    const value: MemoryEntry = {
      ...input,
      id: randomUUID(),
      status: activate ? "ACTIVE" : "CANDIDATE",
      approvedBy: activate ? "You" : null,
      approvedAt: activate ? time : null,
      createdAt: time,
      updatedAt: time,
    };
    this.db
      .prepare(
        `INSERT INTO t_memory_entry (id,agent_id,scope,scope_id,kind,title,content,tags,confidence,status,source_type,source_id,supersedes_id,expires_at,approved_by,approved_at,provenance,created_at,updated_at)
      VALUES (@id,@agentId,@scope,@scopeId,@kind,@title,@content,@tags,@confidence,@status,@sourceType,@sourceId,@supersedesId,@expiresAt,@approvedBy,@approvedAt,@provenance,@createdAt,@updatedAt)`,
      )
      .run({ ...value, tags: json(value.tags) });
    this.db
      .prepare(
        "INSERT INTO t_memory_fts (id,title,content,tags) VALUES (?,?,?,?)",
      )
      .run(value.id, value.title, value.content, value.tags.join(" "));
    this.event("memory", value.id, `MEMORY_${value.status}`, {
      sourceType: value.sourceType,
      sourceId: value.sourceId,
    });
    return value;
  }

  decideMemory(id: string, decision: "APPROVE" | "REJECT"): void {
    const row = this.db
      .prepare("SELECT * FROM t_memory_entry WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error("记忆不存在");
    if (
      decision === "APPROVE" &&
      row.provenance === "UNTRUSTED" &&
      row.scope === "ROLE" &&
      row.kind === "RULE"
    )
      throw new Error("不可信来源不能激活为岗位规则");
    if (decision === "APPROVE" && row.kind === "RULE") {
      const conflict = this.db
        .prepare(
          "SELECT id FROM t_memory_entry WHERE id<>? AND status='ACTIVE' AND IFNULL(agent_id,'')=IFNULL(?,'') AND scope=? AND scope_id=? AND kind='RULE' AND content<>? AND (lower(title)=lower(?) OR tags=?) LIMIT 1",
        )
        .get(
          id,
          row.agent_id,
          row.scope,
          row.scope_id,
          row.content,
          row.title,
          row.tags,
        ) as { id: string } | undefined;
      if (conflict && row.supersedes_id !== conflict.id)
        throw new Error(
          "发现同作用域的生效规则。请先明确替代关系，不能静默覆盖。",
        );
    }
    const status = decision === "APPROVE" ? "ACTIVE" : "REJECTED";
    const time = now();
    const tx = this.db.transaction(() => {
      if (decision === "APPROVE" && row.supersedes_id)
        this.db
          .prepare(
            "UPDATE t_memory_entry SET status='SUPERSEDED',updated_at=? WHERE id=?",
          )
          .run(time, row.supersedes_id);
      this.db
        .prepare(
          "UPDATE t_memory_entry SET status=?,approved_by=?,approved_at=?,updated_at=? WHERE id=?",
        )
        .run(
          status,
          decision === "APPROVE" ? "You" : null,
          decision === "APPROVE" ? time : null,
          time,
          id,
        );
      this.event("memory", id, `MEMORY_${status}`, {});
    });
    tx();
  }

  listActiveMemories(
    agentId: string,
    projectScopeId: string | null,
  ): MemoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM t_memory_entry WHERE status='ACTIVE' AND (expires_at IS NULL OR expires_at>?)
      AND (agent_id IS NULL OR agent_id=?) AND (scope='ROLE' OR (scope='PROJECT' AND scope_id=?) OR scope IN ('EPISODE','WORKFLOW')) ORDER BY updated_at DESC LIMIT 200`,
      )
      .all(now(), agentId, projectScopeId ?? "") as Record<string, unknown>[];
    return rows.map(mapMemory);
  }

  getSkillVersion(id: string): SkillVersion | undefined {
    const row = this.db
      .prepare("SELECT * FROM t_skill_version WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapSkillVersion(row) : undefined;
  }
  createSkill(input: CreateSkillInput): Skill {
    const time = now();
    const skill: Skill = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description.trim(),
      trigger: input.trigger.trim(),
      ownerAgentId: input.ownerAgentId,
      status: "DRAFT",
      activeVersionId: null,
      createdAt: time,
      updatedAt: time,
    };
    const checksum = createHash("sha256")
      .update(input.instructions)
      .digest("hex");
    const version: SkillVersion = {
      id: randomUUID(),
      skillId: skill.id,
      version: 1,
      instructions: input.instructions,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      requiredCapabilities: input.requiredCapabilities,
      requiredEvidence: input.requiredEvidence,
      approvalPoints: input.approvalPoints,
      failurePolicy: input.failurePolicy,
      checksum,
      status: "DRAFT",
      createdFromRunId: null,
      createdAt: time,
      verifiedAt: null,
    };
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO t_skill VALUES (@id,@name,@description,@trigger,@ownerAgentId,@status,@activeVersionId,@createdAt,@updatedAt)",
        )
        .run(skill);
      this.db
        .prepare(
          `INSERT INTO t_skill_version (id,skill_id,version,instructions,input_schema,output_schema,required_capabilities,required_evidence,approval_points,failure_policy,checksum,status,created_from_run_id,created_at,verified_at)
        VALUES (@id,@skillId,@version,@instructions,@inputSchema,@outputSchema,@requiredCapabilities,@requiredEvidence,@approvalPoints,@failurePolicy,@checksum,@status,@createdFromRunId,@createdAt,@verifiedAt)`,
        )
        .run({
          ...version,
          inputSchema: json(version.inputSchema),
          outputSchema: json(version.outputSchema),
          requiredCapabilities: json(version.requiredCapabilities),
          requiredEvidence: json(version.requiredEvidence),
          approvalPoints: json(version.approvalPoints),
        });
      if (skill.ownerAgentId)
        this.db
          .prepare("INSERT OR IGNORE INTO t_agent_skill VALUES (?,?,?)")
          .run(skill.ownerAgentId, skill.id, time);
      this.event("skill", skill.id, "SKILL_DRAFT_CREATED", {
        versionId: version.id,
      });
    });
    tx();
    return skill;
  }

  publishSkill(versionId: string): void {
    const version = this.getSkillVersion(versionId);
    if (!version) throw new Error("Skill 版本不存在");
    if (
      !version.instructions.trim() ||
      !Object.keys(version.outputSchema).length ||
      !version.failurePolicy.trim()
    )
      throw new Error("Skill 缺少步骤、输出 Schema 或失败策略，不能发布");
    const time = now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE t_skill_version SET status='RETIRED' WHERE skill_id=? AND status='VERIFIED'",
        )
        .run(version.skillId);
      this.db
        .prepare(
          "UPDATE t_skill_version SET status='VERIFIED',verified_at=? WHERE id=?",
        )
        .run(time, versionId);
      this.db
        .prepare(
          "UPDATE t_skill SET status='ACTIVE',active_version_id=?,updated_at=? WHERE id=?",
        )
        .run(versionId, time, version.skillId);
      this.event("skill", version.skillId, "SKILL_PUBLISHED", { versionId });
    });
    tx();
  }

  createWorkOrder(input: CreateWorkOrderInput): WorkOrder {
    const existing = input.idempotencyKey
      ? (this.db
          .prepare("SELECT * FROM t_work_order WHERE idempotency_key=?")
          .get(input.idempotencyKey) as Record<string, unknown> | undefined)
      : undefined;
    if (existing) return mapWorkOrder(existing);
    const number =
      ((
        this.db.prepare("SELECT MAX(number) n FROM t_work_order").get() as {
          n: number | null;
        }
      ).n ?? 0) + 1;
    const time = now();
    const idempotencyKey =
      input.idempotencyKey ||
      createHash("sha256")
        .update(
          `HUMAN:${input.ownerAgentId}:${input.title}:${time.slice(0, 16)}`,
        )
        .digest("hex");
    const value: WorkOrder = {
      id: randomUUID(),
      number,
      title: input.title.trim(),
      goal: input.goal.trim(),
      ownerAgentId: input.ownerAgentId,
      createdByType: input.createdByType ?? "HUMAN",
      createdById: input.createdById ?? null,
      scheduleId: input.scheduleId ?? null,
      parentWorkOrderId: input.parentWorkOrderId ?? null,
      projectScopeId: input.projectScopeId ?? null,
      workspaceId: input.workspaceId ?? null,
      skillVersionIds: input.skillVersionIds ?? [],
      input: input.input ?? {},
      constraints: input.constraints ?? [],
      outputContract: input.outputContract ?? {},
      requiredEvidence: input.requiredEvidence ?? [
        "RUNTIME",
        "OUTPUT_SCHEMA",
        "DELIVERY",
      ],
      permissions: input.permissions ?? fullPermissions(false),
      status: "DRAFT",
      statusReason: null,
      idempotencyKey,
      dueAt: input.dueAt ?? null,
      currentRunId: null,
      startedAt: null,
      completedAt: null,
      createdAt: time,
      updatedAt: time,
    };
    this.db
      .prepare(
        `INSERT INTO t_work_order (id,number,title,goal,owner_agent_id,created_by_type,created_by_id,schedule_id,parent_work_order_id,project_scope_id,workspace_id,skill_version_ids,input,constraints_json,output_contract,required_evidence,permissions,status,status_reason,idempotency_key,due_at,current_run_id,started_at,completed_at,created_at,updated_at)
      VALUES (@id,@number,@title,@goal,@ownerAgentId,@createdByType,@createdById,@scheduleId,@parentWorkOrderId,@projectScopeId,@workspaceId,@skillVersionIds,@input,@constraints,@outputContract,@requiredEvidence,@permissions,@status,@statusReason,@idempotencyKey,@dueAt,@currentRunId,@startedAt,@completedAt,@createdAt,@updatedAt)`,
      )
      .run({
        ...value,
        skillVersionIds: json(value.skillVersionIds),
        input: json(value.input),
        constraints: json(value.constraints),
        outputContract: json(value.outputContract),
        requiredEvidence: json(value.requiredEvidence),
        permissions: json(value.permissions),
      });
    this.event("work-order", value.id, "WORK_ORDER_CREATED", {
      number,
      source: value.createdByType,
    });
    return value;
  }

  getWorkOrder(id: string): WorkOrder | undefined {
    const row = this.db
      .prepare("SELECT * FROM t_work_order WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapWorkOrder(row) : undefined;
  }
  updateWorkOrder(
    id: string,
    status: WorkOrderStatus,
    patch: { reason?: string | null; runId?: string | null } = {},
  ): void {
    const current = this.getWorkOrder(id);
    if (!current) throw new Error("工作单不存在");
    const allowed: Record<WorkOrderStatus, WorkOrderStatus[]> = {
      DRAFT: ["READY", "BLOCKED", "CANCELLED"],
      READY: ["QUEUED", "BLOCKED", "CANCELLED"],
      QUEUED: ["RUNNING", "BLOCKED", "FAILED", "CANCELLED"],
      RUNNING: ["VERIFYING", "BLOCKED", "FAILED", "CANCELLED"],
      VERIFYING: ["SUCCEEDED", "BLOCKED", "FAILED", "CANCELLED"],
      BLOCKED: ["READY", "QUEUED", "CANCELLED"],
      FAILED: ["READY", "QUEUED", "CANCELLED"],
      WAITING_APPROVAL: ["READY", "QUEUED", "BLOCKED", "CANCELLED"],
      SUCCEEDED: [],
      CANCELLED: [],
    };
    if (current.status !== status && !allowed[current.status].includes(status))
      throw new Error(`工作单状态不能从 ${current.status} 变为 ${status}`);
    const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status);
    const time = now();
    this.db
      .prepare(
        `UPDATE t_work_order SET status=?,status_reason=?,current_run_id=COALESCE(?,current_run_id),started_at=CASE WHEN ?='RUNNING' THEN COALESCE(started_at,?) ELSE started_at END,completed_at=CASE WHEN ? THEN ? ELSE completed_at END,updated_at=? WHERE id=?`,
      )
      .run(
        status,
        patch.reason ?? null,
        patch.runId ?? null,
        status,
        time,
        terminal ? 1 : 0,
        time,
        time,
        id,
      );
    this.event("work-order", id, `WORK_ORDER_${status}`, patch);
  }

  createDeliverable(
    workOrderId: string,
    runId: string,
    title: string,
    content: string,
    filePath: string | null,
    sha256: string | null,
  ): Deliverable {
    const value: Deliverable = {
      id: randomUUID(),
      workOrderId,
      runId,
      title,
      content,
      filePath,
      sha256,
      createdAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO t_deliverable VALUES (@id,@workOrderId,@runId,@title,@content,@filePath,@sha256,@createdAt)",
      )
      .run(value);
    this.event("work-order", workOrderId, "DELIVERABLE_CREATED", {
      id: value.id,
    });
    return value;
  }

  createSchedule(input: CreateScheduleInput, nextRunAt: string): Schedule {
    const time = now();
    const value: Schedule = {
      ...input,
      id: randomUUID(),
      retryPolicy: { maxAttempts: 3, backoffSeconds: [30, 120, 600] },
      nextRunAt,
      lastScheduledAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: time,
      updatedAt: time,
    };
    this.db
      .prepare(
        `INSERT INTO t_schedule (id,name,owner_agent_id,work_order_template,cron_expression,timezone,enabled,misfire_policy,concurrency_policy,max_catch_up_runs,retry_policy,next_run_at,last_scheduled_at,lease_owner,lease_expires_at,created_at,updated_at)
      VALUES (@id,@name,@ownerAgentId,@workOrderTemplate,@cronExpression,@timezone,@enabled,@misfirePolicy,@concurrencyPolicy,@maxCatchUpRuns,@retryPolicy,@nextRunAt,@lastScheduledAt,@leaseOwner,@leaseExpiresAt,@createdAt,@updatedAt)`,
      )
      .run({
        ...value,
        workOrderTemplate: json(value.workOrderTemplate),
        enabled: value.enabled ? 1 : 0,
        retryPolicy: json(value.retryPolicy),
      });
    this.event("schedule", value.id, "SCHEDULE_CREATED", { nextRunAt });
    return value;
  }
  getSchedule(id: string): Schedule | undefined {
    const row = this.db
      .prepare("SELECT * FROM t_schedule WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapSchedule(row) : undefined;
  }
  listDueSchedules(at: string): Schedule[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM t_schedule WHERE enabled=1 AND next_run_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY next_run_at LIMIT 20",
        )
        .all(at, at) as Record<string, unknown>[]
    ).map(mapSchedule);
  }
  claimSchedule(
    id: string,
    leaseOwner: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE t_schedule
         SET lease_owner=?,lease_expires_at=?,updated_at=?
         WHERE id=? AND enabled=1 AND next_run_at<=?
           AND (lease_expires_at IS NULL OR lease_expires_at<=? OR lease_owner=?)`,
      )
      .run(
        leaseOwner,
        leaseExpiresAt,
        claimedAt,
        id,
        claimedAt,
        claimedAt,
        leaseOwner,
      );
    return result.changes === 1;
  }
  setScheduleEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare("UPDATE t_schedule SET enabled=?,updated_at=? WHERE id=?")
      .run(enabled ? 1 : 0, now(), id);
    this.event(
      "schedule",
      id,
      enabled ? "SCHEDULE_ENABLED" : "SCHEDULE_DISABLED",
      {},
    );
  }
  advanceSchedule(id: string, scheduledFor: string, nextRunAt: string): void {
    this.db
      .prepare(
        "UPDATE t_schedule SET last_scheduled_at=?,next_run_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
      )
      .run(scheduledFor, nextRunAt, now(), id);
  }
  createScheduleExecution(
    scheduleId: string,
    scheduledFor: string,
    workOrderId: string | null,
    status: ScheduleExecution["status"],
    error: string | null = null,
  ): ScheduleExecution {
    const key = createHash("sha256")
      .update(`${scheduleId}:${scheduledFor}`)
      .digest("hex");
    const existing = this.db
      .prepare("SELECT * FROM t_schedule_execution WHERE idempotency_key=?")
      .get(key) as Record<string, unknown> | undefined;
    if (existing) return mapScheduleExecution(existing);
    const value: ScheduleExecution = {
      id: randomUUID(),
      scheduleId,
      scheduledFor,
      workOrderId,
      idempotencyKey: key,
      status,
      error,
      createdAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO t_schedule_execution VALUES (@id,@scheduleId,@scheduledFor,@workOrderId,@idempotencyKey,@status,@error,@createdAt)",
      )
      .run(value);
    return value;
  }
  hasActiveScheduleWork(scheduleId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM t_work_order WHERE schedule_id=? AND status IN ('READY','QUEUED','RUNNING','VERIFYING','BLOCKED','WAITING_APPROVAL') LIMIT 1",
        )
        .get(scheduleId),
    );
  }

  notify(
    input: Omit<Notification, "id" | "readAt" | "createdAt">,
  ): Notification {
    const existing = this.db
      .prepare("SELECT * FROM t_notification WHERE dedupe_key=?")
      .get(input.dedupeKey) as Record<string, unknown> | undefined;
    if (existing) return mapNotification(existing);
    const value: Notification = {
      ...input,
      id: randomUUID(),
      readAt: null,
      createdAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO t_notification VALUES (@id,@event,@subjectType,@subjectId,@title,@body,@channel,@dedupeKey,@readAt,@createdAt)",
      )
      .run(value);
    return value;
  }
  markNotificationRead(id: string): void {
    this.db
      .prepare("UPDATE t_notification SET read_at=? WHERE id=?")
      .run(now(), id);
  }

  addEvidence(
    runId: string,
    input: Omit<Evidence, "id" | "runId" | "createdAt">,
  ): Evidence {
    const value: Evidence = {
      ...input,
      id: randomUUID(),
      runId,
      createdAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO t_evidence VALUES (@id,@runId,@type,@title,@status,@detail,@createdAt)",
      )
      .run(value);
    this.event("run", runId, "EVIDENCE_RECORDED", value);
    return value;
  }

  createArtifact(
    changeId: string,
    type: string,
    title: string,
    content: string,
  ): Artifact {
    const previous = this.db
      .prepare(
        "SELECT * FROM t_artifact WHERE change_id=? AND type=? ORDER BY version DESC LIMIT 1",
      )
      .get(changeId, type) as Record<string, unknown> | undefined;
    const value: Artifact = {
      id: randomUUID(),
      changeId,
      type,
      title,
      version: previous ? Number(previous.version) + 1 : 1,
      status: "DRAFT",
      content,
      supersedes: previous ? String(previous.id) : null,
      createdAt: now(),
      approvedAt: null,
    };
    this.db
      .prepare(
        "INSERT INTO t_artifact VALUES (@id,@changeId,@type,@title,@version,@status,@content,@supersedes,@createdAt,@approvedAt)",
      )
      .run(value);
    this.event("artifact", value.id, "ARTIFACT_CREATED", value);
    return value;
  }

  approveArtifact(id: string, approve: boolean, feedback?: string): void {
    const row = this.db
      .prepare("SELECT * FROM t_artifact WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Artifact 不存在");
    const status = approve ? "APPROVED" : "DRAFT";
    this.db
      .prepare("UPDATE t_artifact SET status=?, approved_at=? WHERE id=?")
      .run(status, approve ? now() : null, id);
    if (approve && row.supersedes)
      this.db
        .prepare("UPDATE t_artifact SET status='DEPRECATED' WHERE id=?")
        .run(row.supersedes);
    if (feedback)
      this.addMessage(
        String(row.change_id),
        "human",
        null,
        "You",
        `${approve ? "批准" : "退回"} Artifact：${String(row.title)}。${feedback}`,
        null,
      );
    this.event(
      "artifact",
      id,
      approve ? "ARTIFACT_APPROVED" : "ARTIFACT_CHANGES_REQUESTED",
      { feedback },
    );
  }

  hasApprovedArtifact(changeId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM t_artifact WHERE change_id=? AND status='APPROVED' LIMIT 1",
        )
        .get(changeId),
    );
  }

  advanceChange(changeId: string): void {
    this.db
      .prepare(
        "UPDATE t_change SET current_phase=current_phase+1, updated_at=? WHERE id=?",
      )
      .run(now(), changeId);
    this.event("change", changeId, "WORKFLOW_PHASE_ADVANCED", {});
  }

  private mapRun(row: Record<string, unknown>): Run {
    const evidence = (
      this.db
        .prepare("SELECT * FROM t_evidence WHERE run_id=? ORDER BY created_at")
        .all(String(row.id)) as Record<string, unknown>[]
    ).map(mapEvidence);
    return this.mapRunValue(row, evidence);
  }

  private mapRuns(rows: Record<string, unknown>[]): Run[] {
    const grouped = new Map<string, Evidence[]>();
    const ids = new Set(rows.map((row) => String(row.id)));
    for (const row of this.db
      .prepare("SELECT * FROM t_evidence ORDER BY created_at")
      .all() as Record<string, unknown>[]) {
      const runId = String(row.run_id);
      if (!ids.has(runId)) continue;
      grouped.set(runId, [...(grouped.get(runId) ?? []), mapEvidence(row)]);
    }
    return rows.map((row) =>
      this.mapRunValue(row, grouped.get(String(row.id)) ?? []),
    );
  }

  private mapRunValue(row: Record<string, unknown>, evidence: Evidence[]): Run {
    return {
      id: String(row.id),
      changeId: nullable(row.change_id),
      workOrderId: nullable(row.work_order_id),
      agentId: String(row.agent_id),
      taskId: nullable(row.task_id),
      agentSessionId: nullable(row.agent_session_id),
      parentRunId: nullable(row.parent_run_id),
      status: row.status as Run["status"],
      prompt: String(row.prompt),
      runtime: row.runtime as Run["runtime"],
      executable: String(row.executable),
      workspacePath: String(row.workspace_path),
      startedAt: nullable(row.started_at),
      endedAt: nullable(row.ended_at),
      exitCode: row.exit_code === null ? null : Number(row.exit_code),
      sessionId: nullable(row.session_id),
      stdout: String(row.stdout ?? ""),
      stderr: String(row.stderr ?? ""),
      finalResponse: nullable(row.final_response),
      baseCommit: nullable(row.base_commit),
      retryReason: nullable(row.retry_reason),
      evidence,
    };
  }

  private event(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: unknown,
  ): void {
    this.db
      .prepare("INSERT INTO t_event VALUES (?,?,?,?,?,?)")
      .run(
        randomUUID(),
        aggregateType,
        aggregateId,
        eventType,
        json(payload),
        now(),
      );
  }
}

const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));
const fullPermissions = (write: boolean): Agent["permissions"] => ({
  read: true,
  write,
  shell: true,
  git: true,
  network: true,
});
const mapWorkspace = (r: Record<string, unknown>): Workspace => ({
  id: String(r.id),
  name: String(r.name),
  path: String(r.path),
  repoRoot: nullable(r.repo_root),
  branch: nullable(r.branch),
  baseCommit: nullable(r.base_commit),
  createdAt: String(r.created_at),
});
const mapAgent = (r: Record<string, unknown>): Agent => ({
  id: String(r.id),
  name: String(r.name),
  icon: String(r.icon),
  description: String(r.description),
  responsibility: String(r.responsibility),
  qualityBar: parse(String(r.quality_bar), []),
  runtime: r.runtime as Agent["runtime"],
  command: nullable(r.command),
  argsTemplate: nullable(r.args_template),
  workspaceIds: parse(String(r.workspace_ids), []),
  permissions: parse(String(r.permissions), fullPermissions(false)),
  status: r.status as Agent["status"],
  currentRunId: nullable(r.current_run_id),
  createdAt: String(r.created_at),
});
const mapChange = (r: Record<string, unknown>): Change => ({
  id: String(r.id),
  number: Number(r.number),
  title: String(r.title),
  description: String(r.description),
  workflowType: r.workflow_type as Change["workflowType"],
  priority: r.priority as Change["priority"],
  dueDate: nullable(r.due_date),
  status: r.status as Change["status"],
  currentPhase: Number(r.current_phase),
  workspaceIds: parse(String(r.workspace_ids), []),
  agentIds: parse(String(r.agent_ids), []),
  tags: parse(String(r.tags), []),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapMessage = (r: Record<string, unknown>): Message => ({
  id: String(r.id),
  changeId: String(r.change_id),
  senderType: r.sender_type as Message["senderType"],
  senderId: nullable(r.sender_id),
  senderName: String(r.sender_name),
  content: String(r.content),
  runId: nullable(r.run_id),
  createdAt: String(r.created_at),
});
const mapEvidence = (r: Record<string, unknown>): Evidence => ({
  id: String(r.id),
  runId: String(r.run_id),
  type: r.type as Evidence["type"],
  title: String(r.title),
  status: r.status as Evidence["status"],
  detail: String(r.detail),
  createdAt: String(r.created_at),
});
const mapArtifact = (r: Record<string, unknown>): Artifact => ({
  id: String(r.id),
  changeId: String(r.change_id),
  type: String(r.type),
  title: String(r.title),
  version: Number(r.version),
  status: r.status as Artifact["status"],
  content: String(r.content),
  supersedes: nullable(r.supersedes),
  createdAt: String(r.created_at),
  approvedAt: nullable(r.approved_at),
});
const mapBinding = (r: Record<string, unknown>): AgentWorkspaceBinding => ({
  id: String(r.id),
  changeId: String(r.change_id),
  agentId: String(r.agent_id),
  workspaceId: String(r.workspace_id),
  permissions: parse(String(r.permissions), fullPermissions(false)),
  createdAt: String(r.created_at),
});
const mapWorkstream = (r: Record<string, unknown>): Workstream => ({
  id: String(r.id),
  changeId: String(r.change_id),
  workspaceId: String(r.workspace_id),
  agentId: String(r.agent_id),
  name: String(r.name),
  status: r.status as Workstream["status"],
  worktreePath: nullable(r.worktree_path),
  branch: nullable(r.branch),
  baseCommit: nullable(r.base_commit),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapTask = (r: Record<string, unknown>): Task => ({
  id: String(r.id),
  changeId: String(r.change_id),
  workstreamId: nullable(r.workstream_id),
  phaseId: String(r.phase_id),
  title: String(r.title),
  description: String(r.description),
  assignedAgentId: String(r.assigned_agent_id),
  verifierAgentId: nullable(r.verifier_agent_id),
  status: r.status as Task["status"],
  requiredEvidence: parse(String(r.required_evidence), []),
  currentRunId: nullable(r.current_run_id),
  parentTaskId: nullable(r.parent_task_id),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapAgentSession = (r: Record<string, unknown>): AgentSession => ({
  id: String(r.id),
  changeId: nullable(r.change_id),
  workOrderId: nullable(r.work_order_id),
  subjectType: r.subject_type as AgentSession["subjectType"],
  subjectId: String(r.subject_id),
  agentId: String(r.agent_id),
  workspaceId: nullable(r.workspace_id),
  nativeSessionId: nullable(r.native_session_id),
  runtime: r.runtime as AgentSession["runtime"],
  status: r.status as AgentSession["status"],
  summary: nullable(r.summary),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapHandoff = (r: Record<string, unknown>): Handoff => ({
  id: String(r.id),
  changeId: String(r.change_id),
  fromTaskId: nullable(r.from_task_id),
  fromAgentId: nullable(r.from_agent_id),
  toTaskId: nullable(r.to_task_id),
  toAgentId: nullable(r.to_agent_id),
  deliverable: String(r.deliverable),
  evidenceIds: parse(String(r.evidence_ids), []),
  status: r.status as Handoff["status"],
  createdAt: String(r.created_at),
  acceptedAt: nullable(r.accepted_at),
});
const mapIssue = (r: Record<string, unknown>): Issue => ({
  id: String(r.id),
  changeId: String(r.change_id),
  taskId: nullable(r.task_id),
  ownerAgentId: nullable(r.owner_agent_id),
  title: String(r.title),
  description: String(r.description),
  severity: r.severity as Issue["severity"],
  status: r.status as Issue["status"],
  sourceEvidenceId: nullable(r.source_evidence_id),
  resolution: nullable(r.resolution),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapIntervention = (r: Record<string, unknown>): HumanIntervention => ({
  id: String(r.id),
  changeId: String(r.change_id),
  targetAgentId: nullable(r.target_agent_id),
  affectedRunId: nullable(r.affected_run_id),
  reason: String(r.reason),
  newConstraints: String(r.new_constraints),
  operator: String(r.operator),
  createdAt: String(r.created_at),
});
const mapConversation = (r: Record<string, unknown>): Conversation => ({
  id: String(r.id),
  number: Number(r.number),
  title: String(r.title),
  topic: String(r.topic),
  background: String(r.background),
  mode: r.mode as Conversation["mode"],
  status: r.status as Conversation["status"],
  currentRound: Number(r.current_round),
  maxRounds: Number(r.max_rounds),
  messageCount: Number(r.message_count),
  tokenUsed: Number(r.token_used),
  stopReason: nullable(r.stop_reason) as Conversation["stopReason"],
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapConversationParticipant = (
  r: Record<string, unknown>,
): ConversationParticipant => ({
  id: String(r.id),
  conversationId: String(r.conversation_id),
  agentId: String(r.agent_id),
  roleName: String(r.role_name),
  rolePrompt: String(r.role_prompt),
  speakingOrder: Number(r.speaking_order),
  isLeader: Boolean(r.is_leader),
  enabled: Boolean(r.enabled),
  nativeSessionId: nullable(r.native_session_id),
  lastSeenTurnSequence: Number(r.last_seen_turn_sequence ?? 0),
  memoryVersion: Number(r.memory_version ?? 0),
  sessionGeneration: Number(r.session_generation ?? 1),
  createdAt: String(r.created_at),
});
const mapConversationRound = (
  r: Record<string, unknown>,
): ConversationRound => ({
  id: String(r.id),
  conversationId: String(r.conversation_id),
  number: Number(r.number),
  focus: String(r.focus),
  status: r.status as ConversationRound["status"],
  createdAt: String(r.created_at),
  completedAt: nullable(r.completed_at),
});
const mapConversationTurn = (r: Record<string, unknown>): ConversationTurn => ({
  id: String(r.id),
  conversationId: String(r.conversation_id),
  roundId: nullable(r.round_id),
  participantId: nullable(r.participant_id),
  agentId: nullable(r.agent_id),
  speakerType: r.speaker_type as ConversationTurn["speakerType"],
  speakerName: String(r.speaker_name),
  sequence: Number(r.sequence ?? 0),
  content: String(r.content),
  status: r.status as ConversationTurn["status"],
  inputTokens: Number(r.input_tokens),
  outputTokens: Number(r.output_tokens),
  cachedInputTokens: Number(r.cached_input_tokens ?? 0),
  cacheCreationInputTokens: Number(r.cache_creation_input_tokens ?? 0),
  reasoningOutputTokens: Number(r.reasoning_output_tokens ?? 0),
  totalTokens: Number(
    r.total_tokens ?? Number(r.input_tokens) + Number(r.output_tokens),
  ),
  costUsd:
    r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
  model: nullable(r.model),
  error: nullable(r.error),
  createdAt: String(r.created_at),
  completedAt: nullable(r.completed_at),
});
const mapConversationMemory = (
  r: Record<string, unknown>,
): ConversationMemory => ({
  id: String(r.id),
  conversationId: String(r.conversation_id),
  version: Number(r.version),
  summary: String(r.summary),
  consensus: parse(String(r.consensus), []),
  disagreements: parse(String(r.disagreements), []),
  openQuestions: parse(String(r.open_questions), []),
  userPreferences: parse(String(r.user_preferences), []),
  updatedAt: String(r.updated_at),
});
const mapConversationDeliverable = (
  r: Record<string, unknown>,
): ConversationDeliverable => ({
  id: String(r.id),
  conversationId: String(r.conversation_id),
  type: r.type as ConversationDeliverable["type"],
  title: String(r.title),
  content: String(r.content),
  status: r.status as ConversationDeliverable["status"],
  convertedChangeId: nullable(r.converted_change_id),
  createdAt: String(r.created_at),
});
const mapAgentProfile = (r: Record<string, unknown>): AgentProfile => ({
  id: String(r.id),
  agentId: String(r.agent_id),
  positionTitle: String(r.position_title),
  outcomeStatement: String(r.outcome_statement),
  recurringResponsibilities: parse(String(r.recurring_responsibilities), []),
  preferredSources: parse(String(r.preferred_sources), []),
  standardDeliverables: parse(String(r.standard_deliverables), []),
  acceptanceCriteria: parse(String(r.acceptance_criteria), []),
  prohibitedActions: parse(String(r.prohibited_actions), []),
  approvalPoints: parse(String(r.approval_points), []),
  failurePolicy: String(r.failure_policy),
  defaultSkillIds: parse(String(r.default_skill_ids), []),
  status: r.status as AgentProfile["status"],
  version: Number(r.version),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapMemory = (r: Record<string, unknown>): MemoryEntry => ({
  id: String(r.id),
  agentId: nullable(r.agent_id),
  scope: r.scope as MemoryEntry["scope"],
  scopeId: String(r.scope_id),
  kind: r.kind as MemoryEntry["kind"],
  title: String(r.title),
  content: String(r.content),
  tags: parse(String(r.tags), []),
  confidence: Number(r.confidence),
  status: r.status as MemoryEntry["status"],
  sourceType: r.source_type as MemoryEntry["sourceType"],
  sourceId: String(r.source_id),
  supersedesId: nullable(r.supersedes_id),
  expiresAt: nullable(r.expires_at),
  approvedBy: nullable(r.approved_by),
  approvedAt: nullable(r.approved_at),
  provenance: r.provenance as MemoryEntry["provenance"],
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapSkill = (r: Record<string, unknown>): Skill => ({
  id: String(r.id),
  name: String(r.name),
  description: String(r.description),
  trigger: String(r.trigger_text),
  ownerAgentId: nullable(r.owner_agent_id),
  status: r.status as Skill["status"],
  activeVersionId: nullable(r.active_version_id),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapSkillVersion = (r: Record<string, unknown>): SkillVersion => ({
  id: String(r.id),
  skillId: String(r.skill_id),
  version: Number(r.version),
  instructions: String(r.instructions),
  inputSchema: parse(String(r.input_schema), {}),
  outputSchema: parse(String(r.output_schema), {}),
  requiredCapabilities: parse(String(r.required_capabilities), []),
  requiredEvidence: parse(String(r.required_evidence), []),
  approvalPoints: parse(String(r.approval_points), []),
  failurePolicy: String(r.failure_policy),
  checksum: String(r.checksum),
  status: r.status as SkillVersion["status"],
  createdFromRunId: nullable(r.created_from_run_id),
  createdAt: String(r.created_at),
  verifiedAt: nullable(r.verified_at),
});
const mapWorkOrder = (r: Record<string, unknown>): WorkOrder => ({
  id: String(r.id),
  number: Number(r.number),
  title: String(r.title),
  goal: String(r.goal),
  ownerAgentId: String(r.owner_agent_id),
  createdByType: r.created_by_type as WorkOrder["createdByType"],
  createdById: nullable(r.created_by_id),
  scheduleId: nullable(r.schedule_id),
  parentWorkOrderId: nullable(r.parent_work_order_id),
  projectScopeId: nullable(r.project_scope_id),
  workspaceId: nullable(r.workspace_id),
  skillVersionIds: parse(String(r.skill_version_ids), []),
  input: parse(String(r.input), {}),
  constraints: parse(String(r.constraints_json), []),
  outputContract: parse(String(r.output_contract), {}),
  requiredEvidence: parse(String(r.required_evidence), []),
  permissions: parse(String(r.permissions), fullPermissions(false)),
  status: r.status as WorkOrder["status"],
  statusReason: nullable(r.status_reason),
  idempotencyKey: String(r.idempotency_key),
  dueAt: nullable(r.due_at),
  currentRunId: nullable(r.current_run_id),
  startedAt: nullable(r.started_at),
  completedAt: nullable(r.completed_at),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapDeliverable = (r: Record<string, unknown>): Deliverable => ({
  id: String(r.id),
  workOrderId: String(r.work_order_id),
  runId: String(r.run_id),
  title: String(r.title),
  content: String(r.content),
  filePath: nullable(r.file_path),
  sha256: nullable(r.sha256),
  createdAt: String(r.created_at),
});
const mapSchedule = (r: Record<string, unknown>): Schedule => ({
  id: String(r.id),
  name: String(r.name),
  ownerAgentId: String(r.owner_agent_id),
  workOrderTemplate: parse(
    String(r.work_order_template),
    {} as CreateWorkOrderInput,
  ),
  cronExpression: String(r.cron_expression),
  timezone: String(r.timezone),
  enabled: Boolean(r.enabled),
  misfirePolicy: r.misfire_policy as Schedule["misfirePolicy"],
  concurrencyPolicy: r.concurrency_policy as Schedule["concurrencyPolicy"],
  maxCatchUpRuns: Number(r.max_catch_up_runs),
  retryPolicy: parse(String(r.retry_policy), {
    maxAttempts: 3,
    backoffSeconds: [30, 120, 600],
  }),
  nextRunAt: String(r.next_run_at),
  lastScheduledAt: nullable(r.last_scheduled_at),
  leaseOwner: nullable(r.lease_owner),
  leaseExpiresAt: nullable(r.lease_expires_at),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const mapScheduleExecution = (
  r: Record<string, unknown>,
): ScheduleExecution => ({
  id: String(r.id),
  scheduleId: String(r.schedule_id),
  scheduledFor: String(r.scheduled_for),
  workOrderId: nullable(r.work_order_id),
  idempotencyKey: String(r.idempotency_key),
  status: r.status as ScheduleExecution["status"],
  error: nullable(r.error),
  createdAt: String(r.created_at),
});
const mapNotification = (r: Record<string, unknown>): Notification => ({
  id: String(r.id),
  event: r.event as Notification["event"],
  subjectType: String(r.subject_type),
  subjectId: String(r.subject_id),
  title: String(r.title),
  body: String(r.body),
  channel: r.channel as Notification["channel"],
  dedupeKey: String(r.dedupe_key),
  readAt: nullable(r.read_at),
  createdAt: String(r.created_at),
});
