export type RuntimeType = "claude" | "codex" | "opencode" | "pi" | "custom";
export type RunStatus =
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "PAUSED"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";
export type AgentStatus =
  "ONLINE" | "IDLE" | "RUNNING" | "PAUSED" | "ERROR" | "OFFLINE";
export type WorkflowType =
  "cross-project" | "incident" | "bug-fix" | "refactor" | "release";
export type ArtifactStatus = "DRAFT" | "REVIEW" | "APPROVED" | "DEPRECATED";
export type TaskStatus =
  | "ASSIGNED"
  | "QUEUED"
  | "RUNNING"
  | "RUN_COMPLETED"
  | "VERIFYING"
  | "ACCEPTED"
  | "REWORK"
  | "BLOCKED"
  | "CANCELLED";
export type IssueStatus =
  "OPEN" | "FIXING" | "RESOLVED" | "VERIFIED" | "WONT_FIX";
export type PermissionSet = {
  read: boolean;
  write: boolean;
  shell: boolean;
  git: boolean;
  network: boolean;
};
export type ConversationMode =
  | "roundtable"
  | "brainstorm"
  | "debate"
  | "consultation"
  | "retreat"
  | "six-hats";
export type ConversationStatus =
  | "DRAFT"
  | "RUNNING"
  | "PAUSED"
  | "READY_TO_SUMMARIZE"
  | "COMPLETED"
  | "FAILED";
export type ConversationStopReason =
  "MAX_ROUNDS" | "USER_ENDED" | "ERROR" | null;
export type AgentProfileStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
export type MemoryScope = "ROLE" | "PROJECT" | "EPISODE" | "WORKFLOW";
export type MemoryKind =
  "RULE" | "PREFERENCE" | "FACT" | "SOURCE" | "DECISION" | "LESSON" | "FAILURE";
export type MemoryStatus =
  "CANDIDATE" | "ACTIVE" | "REJECTED" | "SUPERSEDED" | "EXPIRED";
export type MemoryProvenance = "TRUSTED" | "UNTRUSTED";
export type WorkOrderStatus =
  | "DRAFT"
  | "READY"
  | "QUEUED"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "BLOCKED"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";
export type ScheduleMisfirePolicy = "SKIP" | "RUN_ONCE" | "RUN_ALL_BOUNDED";
export type ScheduleConcurrencyPolicy = "SKIP" | "QUEUE" | "REPLACE";

export interface RuntimeInfo {
  type: RuntimeType;
  label: string;
  executable: string;
  path: string | null;
  version: string | null;
  available: boolean;
  capabilities: string[];
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  repoRoot: string | null;
  branch: string | null;
  baseCommit: string | null;
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  icon: string;
  description: string;
  responsibility: string;
  qualityBar: string[];
  runtime: RuntimeType;
  command: string | null;
  argsTemplate: string | null;
  workspaceIds: string[];
  permissions: PermissionSet;
  status: AgentStatus;
  currentRunId?: string | null;
  createdAt: string;
}

export interface AgentProfile {
  id: string;
  agentId: string;
  positionTitle: string;
  outcomeStatement: string;
  recurringResponsibilities: string[];
  preferredSources: string[];
  standardDeliverables: string[];
  acceptanceCriteria: string[];
  prohibitedActions: string[];
  approvalPoints: string[];
  failurePolicy: string;
  defaultSkillIds: string[];
  status: AgentProfileStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntry {
  id: string;
  agentId: string | null;
  scope: MemoryScope;
  scopeId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  status: MemoryStatus;
  sourceType: "HUMAN" | "RUN" | "EVIDENCE" | "HANDOFF" | "IMPORT";
  sourceId: string;
  supersedesId: string | null;
  expiresAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  provenance: MemoryProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  trigger: string;
  ownerAgentId: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  activeVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  instructions: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredCapabilities: string[];
  requiredEvidence: Evidence["type"][];
  approvalPoints: string[];
  failurePolicy: string;
  checksum: string;
  status: "DRAFT" | "TESTING" | "VERIFIED" | "RETIRED";
  createdFromRunId: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface WorkflowPhase {
  id: string;
  name: string;
  goal: string;
  deliverable: string;
  exitCriteria: string[];
  humanMode: "AUTO" | "ON_LOOP" | "REVIEW" | "IN_LOOP";
  status: "DONE" | "ACTIVE" | "PENDING" | "BLOCKED";
}

export interface Change {
  id: string;
  number: number;
  title: string;
  description: string;
  workflowType: WorkflowType;
  priority: "P0" | "P1" | "P2" | "P3";
  dueDate: string | null;
  status:
    | "INITIALIZING"
    | "RUNNING"
    | "WAITING_HUMAN"
    | "BLOCKED"
    | "DONE"
    | "FAILED";
  currentPhase: number;
  workspaceIds: string[];
  agentIds: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentWorkspaceBinding {
  id: string;
  changeId: string;
  agentId: string;
  workspaceId: string;
  permissions: PermissionSet;
  createdAt: string;
}

export interface Workstream {
  id: string;
  changeId: string;
  workspaceId: string;
  agentId: string;
  name: string;
  status: "READY" | "ACTIVE" | "BLOCKED" | "DONE";
  worktreePath: string | null;
  branch: string | null;
  baseCommit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  changeId: string;
  workstreamId: string | null;
  phaseId: string;
  title: string;
  description: string;
  assignedAgentId: string;
  verifierAgentId: string | null;
  status: TaskStatus;
  requiredEvidence: Evidence["type"][];
  currentRunId: string | null;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSession {
  id: string;
  changeId: string | null;
  workOrderId: string | null;
  subjectType: "CHANGE" | "WORK_ORDER";
  subjectId: string;
  agentId: string;
  workspaceId: string | null;
  nativeSessionId: string | null;
  runtime: RuntimeType;
  status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "CLOSED";
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Handoff {
  id: string;
  changeId: string;
  fromTaskId: string | null;
  fromAgentId: string | null;
  toTaskId: string | null;
  toAgentId: string | null;
  deliverable: string;
  evidenceIds: string[];
  status: "CREATED" | "ACCEPTED" | "REJECTED";
  createdAt: string;
  acceptedAt: string | null;
}

export interface Issue {
  id: string;
  changeId: string;
  taskId: string | null;
  ownerAgentId: string | null;
  title: string;
  description: string;
  severity: "BLOCKING" | "HIGH" | "MEDIUM" | "LOW";
  status: IssueStatus;
  sourceEvidenceId: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HumanIntervention {
  id: string;
  changeId: string;
  targetAgentId: string | null;
  affectedRunId: string | null;
  reason: string;
  newConstraints: string;
  operator: string;
  createdAt: string;
}

export interface Message {
  id: string;
  changeId: string;
  senderType: "human" | "leader" | "agent" | "system";
  senderId: string | null;
  senderName: string;
  content: string;
  runId: string | null;
  createdAt: string;
}

export interface Evidence {
  id: string;
  runId: string;
  type:
    | "COMMAND"
    | "GIT"
    | "DIFF"
    | "FILE"
    | "TEST"
    | "RUNTIME"
    | "USAGE"
    | "CONTEXT"
    | "SOURCE"
    | "DATA_FRESHNESS"
    | "OUTPUT_SCHEMA"
    | "DELIVERY"
    | "APPROVAL";
  title: string;
  status: "PASS" | "WARN" | "FAIL" | "UNVERIFIED";
  detail: string;
  createdAt: string;
}

export interface Run {
  id: string;
  changeId: string | null;
  workOrderId: string | null;
  agentId: string;
  taskId: string | null;
  agentSessionId: string | null;
  parentRunId: string | null;
  status: RunStatus;
  prompt: string;
  runtime: RuntimeType;
  executable: string;
  workspacePath: string;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  sessionId: string | null;
  stdout: string;
  stderr: string;
  finalResponse: string | null;
  baseCommit: string | null;
  retryReason: string | null;
  evidence: Evidence[];
}

export interface OutputContract {
  schema?: Record<string, unknown>;
  requiredSections?: string[];
  requiredEvidence?: Evidence["type"][];
  mustCite?: boolean;
  forbidden?: string[];
}

export interface WorkOrder {
  id: string;
  number: number;
  title: string;
  goal: string;
  ownerAgentId: string;
  createdByType: "HUMAN" | "SCHEDULE" | "AGENT";
  createdById: string | null;
  scheduleId: string | null;
  parentWorkOrderId: string | null;
  projectScopeId: string | null;
  workspaceId: string | null;
  skillVersionIds: string[];
  input: Record<string, unknown>;
  constraints: string[];
  outputContract: OutputContract;
  requiredEvidence: Evidence["type"][];
  permissions: PermissionSet;
  status: WorkOrderStatus;
  statusReason: string | null;
  idempotencyKey: string;
  dueAt: string | null;
  currentRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deliverable {
  id: string;
  workOrderId: string;
  runId: string;
  title: string;
  content: string;
  filePath: string | null;
  sha256: string | null;
  createdAt: string;
}

export interface Schedule {
  id: string;
  name: string;
  ownerAgentId: string;
  workOrderTemplate: CreateWorkOrderInput;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  misfirePolicy: ScheduleMisfirePolicy;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  maxCatchUpRuns: number;
  retryPolicy: { maxAttempts: number; backoffSeconds: number[] };
  nextRunAt: string;
  lastScheduledAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  scheduledFor: string;
  workOrderId: string | null;
  idempotencyKey: string;
  status: "CLAIMED" | "CREATED" | "SKIPPED" | "FAILED";
  error: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  event:
    | "WORKORDER_FAILED"
    | "WORKORDER_BLOCKED"
    | "APPROVAL_REQUESTED"
    | "SCHEDULE_MISFIRE"
    | "COST_LIMIT_HIT";
  subjectType: string;
  subjectId: string;
  title: string;
  body: string;
  channel: "IN_APP" | "OS_NATIVE";
  dedupeKey: string;
  readAt: string | null;
  createdAt: string;
}

export interface Artifact {
  id: string;
  changeId: string;
  type: string;
  title: string;
  version: number;
  status: ArtifactStatus;
  content: string;
  supersedes: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export interface Conversation {
  id: string;
  number: number;
  title: string;
  topic: string;
  background: string;
  mode: ConversationMode;
  status: ConversationStatus;
  currentRound: number;
  maxRounds: number;
  messageCount: number;
  tokenUsed: number;
  stopReason: ConversationStopReason;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationParticipant {
  id: string;
  conversationId: string;
  agentId: string;
  roleName: string;
  rolePrompt: string;
  speakingOrder: number;
  isLeader: boolean;
  enabled: boolean;
  nativeSessionId: string | null;
  lastSeenTurnSequence: number;
  memoryVersion: number;
  sessionGeneration: number;
  createdAt: string;
}

export interface ConversationRound {
  id: string;
  conversationId: string;
  number: number;
  focus: string;
  status: "RUNNING" | "COMPLETED" | "INTERRUPTED";
  createdAt: string;
  completedAt: string | null;
}

export interface ConversationTurn {
  id: string;
  conversationId: string;
  roundId: string | null;
  participantId: string | null;
  agentId: string | null;
  speakerType: "human" | "agent" | "leader" | "system";
  speakerName: string;
  sequence: number;
  content: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  model: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ConversationMemory {
  id: string;
  conversationId: string;
  version: number;
  summary: string;
  consensus: string[];
  disagreements: string[];
  openQuestions: string[];
  userPreferences: string[];
  updatedAt: string;
}

export interface ConversationDeliverable {
  id: string;
  conversationId: string;
  type:
    | "SUMMARY"
    | "ACTION_PLAN"
    | "DESIGN_BRIEF"
    | "PRD"
    | "DECISION_MATRIX"
    | "STRATEGIC_AGENDA"
    | "SIX_HATS_REPORT"
    | "MARKDOWN";
  title: string;
  content: string;
  status: "DRAFT" | "FINAL";
  convertedChangeId: string | null;
  createdAt: string;
}

export interface AppSnapshot {
  changes: Change[];
  agents: Agent[];
  workspaces: Workspace[];
  runtimes: RuntimeInfo[];
  messages: Message[];
  runs: Run[];
  artifacts: Artifact[];
  bindings: AgentWorkspaceBinding[];
  workstreams: Workstream[];
  tasks: Task[];
  agentSessions: AgentSession[];
  handoffs: Handoff[];
  issues: Issue[];
  interventions: HumanIntervention[];
  conversations: Conversation[];
  conversationParticipants: ConversationParticipant[];
  conversationRounds: ConversationRound[];
  conversationTurns: ConversationTurn[];
  conversationMemories: ConversationMemory[];
  conversationDeliverables: ConversationDeliverable[];
  agentProfiles: AgentProfile[];
  memories: MemoryEntry[];
  skills: Skill[];
  skillVersions: SkillVersion[];
  workOrders: WorkOrder[];
  deliverables: Deliverable[];
  schedules: Schedule[];
  scheduleExecutions: ScheduleExecution[];
  notifications: Notification[];
}

export interface CreateChangeInput {
  title: string;
  description: string;
  workflowType: WorkflowType;
  priority: Change["priority"];
  dueDate?: string | null;
  workspaceIds: string[];
  agentIds: string[];
  agentBindings: Array<{
    agentId: string;
    workspaceId: string;
    permissions: PermissionSet;
  }>;
  tags: string[];
}

export interface CreateAgentInput extends Omit<
  Agent,
  "id" | "status" | "createdAt" | "currentRunId"
> {}
export interface UpdateAgentInput extends CreateAgentInput {
  id: string;
}

export interface CreateConversationInput {
  title: string;
  topic: string;
  background: string;
  mode: ConversationMode;
  maxRounds: number;
  participants: Array<{
    agentId: string;
    roleName: string;
    rolePrompt: string;
    isLeader: boolean;
  }>;
}

export interface ConvertConversationInput {
  workspaceId: string;
  agentIds: string[];
  workflowType: WorkflowType;
  priority: Change["priority"];
}

export type UpsertAgentProfileInput = Omit<
  AgentProfile,
  "id" | "version" | "createdAt" | "updatedAt"
>;
export type CreateMemoryInput = Omit<
  MemoryEntry,
  "id" | "status" | "approvedBy" | "approvedAt" | "createdAt" | "updatedAt"
> & { activate?: boolean };
export interface CreateSkillInput {
  name: string;
  description: string;
  trigger: string;
  ownerAgentId: string | null;
  instructions: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredCapabilities: string[];
  requiredEvidence: Evidence["type"][];
  approvalPoints: string[];
  failurePolicy: string;
}
export interface CreateWorkOrderInput {
  title: string;
  goal: string;
  ownerAgentId: string;
  createdByType?: WorkOrder["createdByType"];
  createdById?: string | null;
  scheduleId?: string | null;
  parentWorkOrderId?: string | null;
  projectScopeId?: string | null;
  workspaceId?: string | null;
  skillVersionIds?: string[];
  input?: Record<string, unknown>;
  constraints?: string[];
  outputContract?: OutputContract;
  requiredEvidence?: Evidence["type"][];
  permissions?: PermissionSet;
  idempotencyKey?: string;
  dueAt?: string | null;
}
export interface CreateScheduleInput {
  name: string;
  ownerAgentId: string;
  workOrderTemplate: CreateWorkOrderInput;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  misfirePolicy: ScheduleMisfirePolicy;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  maxCatchUpRuns: number;
}

export type RuntimeEvent =
  | { type: "snapshot.changed"; snapshot: AppSnapshot }
  | {
      type: "run.activity";
      runId: string;
      stream: "stdout" | "stderr";
      chunk: string;
    }
  | { type: "run.status"; runId: string; status: RunStatus }
  | { type: "runtime.notice"; level: "info" | "error"; message: string }
  | {
      type: "conversation.activity";
      conversationId: string;
      turnId: string;
      chunk: string;
    };

export interface DesktopApi {
  getSnapshot(): Promise<AppSnapshot>;
  selectWorkspace(): Promise<Workspace | null>;
  createChange(input: CreateChangeInput): Promise<Change>;
  startChange(changeId: string, reason?: string): Promise<void>;
  createAgent(input: CreateAgentInput): Promise<Agent>;
  updateAgent(input: UpdateAgentInput): Promise<Agent>;
  sendMessage(
    changeId: string,
    content: string,
    targetAgentId?: string,
  ): Promise<void>;
  controlRun(
    runId: string,
    action: "pause" | "resume" | "stop" | "retry",
    reason?: string,
  ): Promise<void>;
  advanceWorkflow(changeId: string): Promise<void>;
  approveArtifact(
    artifactId: string,
    approve: boolean,
    feedback?: string,
  ): Promise<void>;
  detectRuntimes(): Promise<RuntimeInfo[]>;
  updateIssue(
    issueId: string,
    status: IssueStatus,
    resolution?: string,
  ): Promise<void>;
  createConversation(input: CreateConversationInput): Promise<Conversation>;
  controlConversation(
    conversationId: string,
    action: "start" | "pause" | "resume" | "end",
  ): Promise<void>;
  extendConversation(
    conversationId: string,
    additionalRounds: number,
  ): Promise<void>;
  sendConversationMessage(
    conversationId: string,
    content: string,
    targetParticipantId?: string,
  ): Promise<void>;
  summarizeConversation(
    conversationId: string,
    type: ConversationDeliverable["type"],
  ): Promise<void>;
  convertConversation(
    conversationId: string,
    input: ConvertConversationInput,
  ): Promise<Change>;
  exportConversation(conversationId: string): Promise<boolean>;
  upsertAgentProfile(input: UpsertAgentProfileInput): Promise<AgentProfile>;
  createMemory(input: CreateMemoryInput): Promise<MemoryEntry>;
  decideMemory(memoryId: string, decision: "APPROVE" | "REJECT"): Promise<void>;
  createSkill(input: CreateSkillInput): Promise<Skill>;
  publishSkill(skillVersionId: string): Promise<void>;
  createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder>;
  controlWorkOrder(
    id: string,
    action: "start" | "pause" | "resume" | "cancel" | "retry",
  ): Promise<void>;
  createSchedule(input: CreateScheduleInput): Promise<Schedule>;
  updateSchedule(id: string, enabled: boolean): Promise<void>;
  testSchedule(scheduleId: string): Promise<WorkOrder>;
  markNotificationRead(id: string): Promise<void>;
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
}

export type RuntimeRequest =
  | { type: "snapshot.get" }
  | { type: "workspace.add"; workspace: Omit<Workspace, "id" | "createdAt"> }
  | { type: "change.create"; input: CreateChangeInput }
  | { type: "change.kick"; changeId: string; reason?: string }
  | { type: "agent.create"; input: CreateAgentInput }
  | { type: "agent.update"; input: UpdateAgentInput }
  | { type: "runtime.detect" }
  | {
      type: "message.send";
      changeId: string;
      content: string;
      targetAgentId?: string;
    }
  | {
      type: "run.control";
      runId: string;
      action: "pause" | "resume" | "stop" | "retry";
      reason?: string;
    }
  | {
      type: "artifact.approve";
      artifactId: string;
      approve: boolean;
      feedback?: string;
    }
  | { type: "workflow.advance"; changeId: string }
  | {
      type: "issue.update";
      issueId: string;
      status: IssueStatus;
      resolution?: string;
    }
  | { type: "conversation.create"; input: CreateConversationInput }
  | {
      type: "conversation.control";
      conversationId: string;
      action: "start" | "pause" | "resume" | "end";
    }
  | {
      type: "conversation.extend";
      conversationId: string;
      additionalRounds: number;
    }
  | {
      type: "conversation.message";
      conversationId: string;
      content: string;
      targetParticipantId?: string;
    }
  | {
      type: "conversation.summarize";
      conversationId: string;
      deliverableType: ConversationDeliverable["type"];
    }
  | {
      type: "conversation.convert";
      conversationId: string;
      input: ConvertConversationInput;
    }
  | { type: "conversation.export-markdown"; conversationId: string }
  | { type: "agentProfile.upsert"; input: UpsertAgentProfileInput }
  | { type: "memory.create"; input: CreateMemoryInput }
  | { type: "memory.decide"; memoryId: string; decision: "APPROVE" | "REJECT" }
  | { type: "skill.createDraft"; input: CreateSkillInput }
  | { type: "skill.publish"; skillVersionId: string }
  | { type: "workOrder.create"; input: CreateWorkOrderInput }
  | {
      type: "workOrder.control";
      id: string;
      action: "start" | "pause" | "resume" | "cancel" | "retry";
    }
  | { type: "schedule.create"; input: CreateScheduleInput }
  | { type: "schedule.update"; id: string; enabled: boolean }
  | { type: "schedule.testRun"; scheduleId: string }
  | { type: "notification.read"; id: string };

export interface RuntimeRequestEnvelope {
  id: string;
  request: RuntimeRequest;
}
export type RuntimeResponseEnvelope =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };
export type RuntimeProcessMessage =
  RuntimeResponseEnvelope | { event: RuntimeEvent };
