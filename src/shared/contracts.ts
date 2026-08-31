export type RuntimeType = 'claude' | 'codex' | 'opencode' | 'pi' | 'custom'
export type RunStatus = 'QUEUED' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED'
export type AgentStatus = 'ONLINE' | 'IDLE' | 'RUNNING' | 'PAUSED' | 'ERROR' | 'OFFLINE'
export type WorkflowType = 'cross-project' | 'incident' | 'bug-fix' | 'refactor' | 'release'
export type ArtifactStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'DEPRECATED'

export interface RuntimeInfo {
  type: RuntimeType
  label: string
  executable: string
  path: string | null
  version: string | null
  available: boolean
  capabilities: string[]
}

export interface Workspace {
  id: string
  name: string
  path: string
  repoRoot: string | null
  branch: string | null
  baseCommit: string | null
  createdAt: string
}

export interface Agent {
  id: string
  name: string
  icon: string
  description: string
  responsibility: string
  qualityBar: string[]
  runtime: RuntimeType
  command: string | null
  argsTemplate: string | null
  workspaceIds: string[]
  permissions: { read: boolean; write: boolean; shell: boolean; git: boolean; network: boolean }
  status: AgentStatus
  currentRunId?: string | null
  createdAt: string
}

export interface WorkflowPhase {
  id: string
  name: string
  goal: string
  deliverable: string
  exitCriteria: string[]
  humanMode: 'AUTO' | 'ON_LOOP' | 'REVIEW' | 'IN_LOOP'
  status: 'DONE' | 'ACTIVE' | 'PENDING' | 'BLOCKED'
}

export interface Change {
  id: string
  number: number
  title: string
  description: string
  workflowType: WorkflowType
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  dueDate: string | null
  status: 'INITIALIZING' | 'RUNNING' | 'WAITING_HUMAN' | 'BLOCKED' | 'DONE' | 'FAILED'
  currentPhase: number
  workspaceIds: string[]
  agentIds: string[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  changeId: string
  senderType: 'human' | 'leader' | 'agent' | 'system'
  senderId: string | null
  senderName: string
  content: string
  runId: string | null
  createdAt: string
}

export interface Evidence {
  id: string
  runId: string
  type: 'COMMAND' | 'GIT' | 'DIFF' | 'FILE' | 'TEST' | 'RUNTIME'
  title: string
  status: 'PASS' | 'WARN' | 'FAIL' | 'UNVERIFIED'
  detail: string
  createdAt: string
}

export interface Run {
  id: string
  changeId: string
  agentId: string
  parentRunId: string | null
  status: RunStatus
  prompt: string
  runtime: RuntimeType
  executable: string
  workspacePath: string
  startedAt: string | null
  endedAt: string | null
  exitCode: number | null
  sessionId: string | null
  stdout: string
  stderr: string
  finalResponse: string | null
  baseCommit: string | null
  retryReason: string | null
  evidence: Evidence[]
}

export interface Artifact {
  id: string
  changeId: string
  type: string
  title: string
  version: number
  status: ArtifactStatus
  content: string
  supersedes: string | null
  createdAt: string
  approvedAt: string | null
}

export interface AppSnapshot {
  changes: Change[]
  agents: Agent[]
  workspaces: Workspace[]
  runtimes: RuntimeInfo[]
  messages: Message[]
  runs: Run[]
  artifacts: Artifact[]
}

export interface CreateChangeInput {
  title: string
  description: string
  workflowType: WorkflowType
  priority: Change['priority']
  dueDate?: string | null
  workspaceIds: string[]
  agentIds: string[]
  tags: string[]
}

export interface CreateAgentInput extends Omit<Agent, 'id' | 'status' | 'createdAt' | 'currentRunId'> {}

export type RuntimeEvent =
  | { type: 'snapshot.changed'; snapshot: AppSnapshot }
  | { type: 'run.activity'; runId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'run.status'; runId: string; status: RunStatus }
  | { type: 'runtime.notice'; level: 'info' | 'error'; message: string }

export interface DesktopApi {
  getSnapshot(): Promise<AppSnapshot>
  selectWorkspace(): Promise<Workspace | null>
  createChange(input: CreateChangeInput): Promise<Change>
  createAgent(input: CreateAgentInput): Promise<Agent>
  sendMessage(changeId: string, content: string, targetAgentId?: string): Promise<void>
  controlRun(runId: string, action: 'pause' | 'resume' | 'stop' | 'retry', reason?: string): Promise<void>
  advanceWorkflow(changeId: string): Promise<void>
  approveArtifact(artifactId: string, approve: boolean, feedback?: string): Promise<void>
  detectRuntimes(): Promise<RuntimeInfo[]>
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void
}
