import { randomUUID } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Agent, PermissionSet, Run, RuntimeEvent, RuntimeInfo, Task } from '../shared/contracts'
import type { AppDatabase } from '../main/database'
import { collectGitEvidence } from '../main/runtime/git'
import { extractTeamActions } from '../main/runtime/parser'
import { WORKFLOWS } from '../shared/workflows'
import { AdapterRegistry } from './adapters'
import { EvidenceService } from './evidence-service'
import { LeaderEngine } from './leader-engine'
import { RuntimeQueue } from './runtime-queue'
import { WorkspaceManager } from './workspace-manager'

type Publish = (event: RuntimeEvent) => void
interface StartOptions { parentRunId?: string | null; retryReason?: string | null; resumeNative?: boolean }

export class TeamRunManager {
  private queue = new RuntimeQueue(3)
  private processes = new Map<string, { child: ChildProcessWithoutNullStreams; agent: Agent }>()
  private buffers = new Map<string, { stdout: string; stderr: string }>()
  private cancelling = new Set<string>()
  private resumeRuns = new Set<string>()
  private runtimes: RuntimeInfo[] = []
  private evidence = new EvidenceService()

  constructor(private db: AppDatabase, private registry: AdapterRegistry, private workspaces: WorkspaceManager, private leader: LeaderEngine, private publish: Publish, private changed: () => void) {}
  setRuntimes(runtimes: RuntimeInfo[]): void { this.runtimes = runtimes }
  getRuntimes(): RuntimeInfo[] { return this.runtimes }
  queueStats(): ReturnType<RuntimeQueue['stats']> { return this.queue.stats() }

  async start(changeId: string, agent: Agent, prompt: string, task: Task, options: StartOptions = {}): Promise<string> {
    const change = this.db.getChange(changeId)
    if (!change || !change.agentIds.includes(agent.id)) throw new Error('Agent 不属于当前 Session Team')
    const binding = this.db.getBinding(changeId, agent.id)
    if (!binding) throw new Error(`${agent.name} 没有 Agent-Workspace Binding`)
    const workspace = this.db.getWorkspace(binding.workspaceId)
    const workstream = this.db.getWorkstream(changeId, agent.id, binding.workspaceId)
    if (!workspace || !workstream) throw new Error('Workspace 或 Workstream 不存在')
    const phase = WORKFLOWS[change.workflowType][change.currentPhase]
    const effectivePermissions: PermissionSet = { ...binding.permissions, write: binding.permissions.write && ['development', 'fix', 'refactor'].includes(phase.id) }
    const prepared = await this.workspaces.prepare(change, workspace, { ...binding, permissions: effectivePermissions }, workstream)
    this.db.updateWorkstream(workstream.id, { status: 'ACTIVE', worktreePath: effectivePermissions.write ? prepared.cwd : workstream.worktreePath, branch: prepared.branch, baseCommit: prepared.baseCommit })
    const adapter = this.registry.get(agent.runtime)
    const runtime = adapter.detect(this.runtimes)
    const executable = agent.command || runtime?.path || runtime?.executable
    if (!executable || (!runtime?.available && !agent.command)) throw new Error(`${agent.runtime} 未安装或未配置`)
    const session = this.db.ensureAgentSession(changeId, agent.id, workspace.id, agent.runtime)
    const id = randomUUID()
    const run: Run = { id, changeId, agentId: agent.id, taskId: task.id, agentSessionId: session.id, parentRunId: options.parentRunId ?? null, status: 'QUEUED', prompt, runtime: agent.runtime, executable, workspacePath: prepared.cwd, startedAt: null, endedAt: null, exitCode: null, sessionId: session.nativeSessionId, stdout: '', stderr: '', finalResponse: null, baseCommit: prepared.baseCommit, retryReason: options.retryReason ?? null, evidence: [] }
    this.db.createRun(run); this.db.updateTask(task.id, 'QUEUED', id)
    if (options.resumeNative) this.resumeRuns.add(id)
    this.publish({ type: 'run.status', runId: id, status: 'QUEUED' }); this.changed()
    this.queue.enqueue(id, () => this.execute(run, agent, effectivePermissions, session.nativeSessionId))
    return id
  }

  async control(runId: string, action: 'pause' | 'resume' | 'stop' | 'retry', reason?: string): Promise<void> {
    const run = this.db.getRun(runId); if (!run) throw new Error('Run 不存在')
    const adapter = this.registry.get(run.runtime)
    if (action === 'stop' || action === 'pause') {
      if (this.queue.cancel(runId)) {
        this.db.updateRun(runId, { status: action === 'pause' ? 'PAUSED' : 'CANCELLED', endedAt: new Date().toISOString() })
      } else {
        const active = this.processes.get(runId)
        if (active) { this.cancelling.add(runId); await (action === 'pause' ? adapter.interrupt(active.child) : adapter.cancel(active.child)) }
        const buffer = this.buffers.get(runId)
        const parsedSession = buffer ? adapter.parse(buffer.stdout).nativeSessionId : run.sessionId
        this.db.updateRun(runId, { status: action === 'pause' ? 'PAUSED' : 'CANCELLED', endedAt: new Date().toISOString(), stdout: buffer?.stdout ?? run.stdout, stderr: buffer?.stderr ?? run.stderr, sessionId: parsedSession })
      }
      const refreshed = this.db.getRun(runId)
      if (run.agentSessionId) this.db.updateAgentSession(run.agentSessionId, refreshed?.sessionId ?? run.sessionId, action === 'pause' ? 'PAUSED' : 'CLOSED')
      if (run.taskId) this.db.updateTask(run.taskId, action === 'pause' ? 'BLOCKED' : 'CANCELLED', run.id)
      this.publish({ type: 'run.status', runId, status: action === 'pause' ? 'PAUSED' : 'CANCELLED' }); this.changed(); return
    }
    const agent = this.db.getAgent(run.agentId); const oldTask = run.taskId ? this.db.getTask(run.taskId) : undefined
    const change = this.db.getChange(run.changeId)
    if (!agent || !change) throw new Error('Agent 或 Change 不存在')
    const task = oldTask ?? this.leader.createTask(change, agent, `${run.prompt}\n\nHuman constraint: ${reason || action}`, null)
    this.db.updateTask(task.id, 'ASSIGNED', null)
    this.db.addIntervention({ changeId: run.changeId, targetAgentId: run.agentId, affectedRunId: run.id, reason: action, newConstraints: reason || 'Continue from previous execution evidence', operator: 'You' })
    await this.start(run.changeId, agent, `${run.prompt}\n\nHuman instruction: ${reason || 'Continue and correct the previous execution.'}`, task, { parentRunId: run.id, retryReason: reason || action, resumeNative: action === 'resume' && adapter.supportsNativeResume && Boolean(run.sessionId) })
  }

  private async execute(run: Run, agent: Agent, permissions: PermissionSet, nativeSessionId: string | null): Promise<void> {
    this.db.updateRun(run.id, { status: 'STARTING', startedAt: new Date().toISOString() }); this.leader.onRunStarted(run.taskId, run.id); this.publish({ type: 'run.status', runId: run.id, status: 'STARTING' })
    const adapter = this.registry.get(run.runtime)
    try {
      const launchInput = { executable: run.executable, prompt: buildPrompt(agent, run.prompt), cwd: run.workspacePath, permissions, nativeSessionId, argsTemplate: agent.argsTemplate }
      const launch = this.resumeRuns.delete(run.id) ? await adapter.resume(launchInput) : await adapter.start(launchInput)
      this.processes.set(run.id, { child: launch.child, agent })
      this.db.updateRun(run.id, { status: 'RUNNING' }); this.db.addEvidence(run.id, { type: 'COMMAND', title: launch.redactedCommand, status: 'UNVERIFIED', detail: `cwd: ${run.workspacePath}` }); this.publish({ type: 'run.status', runId: run.id, status: 'RUNNING' })
      let stdout = ''; let stderr = ''
      this.buffers.set(run.id, { stdout, stderr })
      launch.child.stdout.on('data', chunk => { const value = String(chunk); stdout += value; this.buffers.set(run.id, { stdout, stderr }); this.publish({ type: 'run.activity', runId: run.id, stream: 'stdout', chunk: value }) })
      launch.child.stderr.on('data', chunk => { const value = String(chunk); stderr += value; this.buffers.set(run.id, { stdout, stderr }); this.publish({ type: 'run.activity', runId: run.id, stream: 'stderr', chunk: value }) })
      const code = await new Promise<number | null>((resolve, reject) => { launch.child.once('error', reject); launch.child.once('close', resolve) })
      this.processes.delete(run.id)
      if (this.cancelling.delete(run.id)) { this.processes.delete(run.id); this.buffers.delete(run.id); return }
      const status = code === 0 ? 'COMPLETED' : 'FAILED'
      const parsed = adapter.parse(stdout)
      this.db.updateRun(run.id, { status, endedAt: new Date().toISOString(), exitCode: code, stdout, stderr, finalResponse: parsed.finalResponse, sessionId: parsed.nativeSessionId })
      this.db.addEvidence(run.id, { type: 'RUNTIME', title: 'Runtime exit', status: code === 0 ? 'PASS' : 'FAIL', detail: `exit code: ${code}` })
      for (const item of this.evidence.derive(stdout, stderr, code)) this.db.addEvidence(run.id, item)
      const git = await collectGitEvidence(run.workspacePath, run.baseCommit)
      this.db.addEvidence(run.id, { type: 'GIT', title: 'Workspace state', status: 'UNVERIFIED', detail: git.status || 'Clean working tree' })
      if (git.files.length) this.db.addEvidence(run.id, { type: 'DIFF', title: `${git.files.length} files changed`, status: 'UNVERIFIED', detail: `${git.diff}\n\n${git.files.join('\n')}` })
      if (run.agentSessionId) this.db.updateAgentSession(run.agentSessionId, parsed.nativeSessionId, 'ACTIVE', parsed.finalResponse.slice(0, 2000))
      this.db.addMessage(run.changeId, 'agent', agent.id, agent.name, parsed.finalResponse, run.id)
      if (/proposal|contract|report|方案|报告/i.test(parsed.finalResponse)) this.db.createArtifact(run.changeId, 'RUN_DELIVERABLE', `${agent.name} Deliverable`, parsed.finalResponse)
      const completed = this.db.getRun(run.id)!
      await this.delegateActions(completed, agent, parsed.finalResponse)
      this.leader.onRunFinished(this.db.getRun(run.id)!)
      this.publish({ type: 'run.status', runId: run.id, status }); this.changed()
      this.buffers.delete(run.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.processes.delete(run.id); this.buffers.delete(run.id); this.db.updateRun(run.id, { status: 'FAILED', endedAt: new Date().toISOString(), stderr: message, finalResponse: message }); this.db.addEvidence(run.id, { type: 'RUNTIME', title: 'Runtime failure', status: 'FAIL', detail: message })
      if (run.taskId) this.leader.onRunFinished(this.db.getRun(run.id)!)
      this.publish({ type: 'runtime.notice', level: 'error', message }); this.changed()
    }
  }

  private async delegateActions(parentRun: Run, sender: Agent, response: string): Promise<void> {
    const change = this.db.getChange(parentRun.changeId); if (!change) return
    for (const action of extractTeamActions(response)) {
      const target = this.db.snapshot(this.runtimes).agents.find(item => (item.name.toLowerCase() === action.agent.toLowerCase() || item.id === action.agent) && change.agentIds.includes(item.id))
      if (!target || target.id === sender.id) continue
      const task = this.leader.createTask(change, target, action.prompt, parentRun.taskId)
      this.db.createHandoff({ changeId: change.id, fromTaskId: parentRun.taskId, fromAgentId: sender.id, toTaskId: task.id, toAgentId: target.id, deliverable: response.slice(0, 4000), evidenceIds: parentRun.evidence.map(item => item.id) })
      await this.start(change.id, target, action.prompt, task, { parentRunId: parentRun.id, retryReason: `Delegated by ${sender.name}` })
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.processes.entries()].map(async ([runId, active]) => {
      try { await this.registry.get(active.agent.runtime).cancel(active.child) } finally { this.db.updateRun(runId, { status: 'INTERRUPTED', endedAt: new Date().toISOString() }) }
    }))
    this.processes.clear(); this.changed()
  }
}

function buildPrompt(agent: Agent, prompt: string): string {
  return `You are ${agent.name}. Responsibility: ${agent.responsibility}\nQuality bar:\n${agent.qualityBar.map(item => `- ${item}`).join('\n')}\n\nTask:\n${prompt}\n\nWork only in the provided workspace. Report claims with concrete command, test and diff evidence. Do not claim tests passed unless they actually ran. To delegate, append a fenced team-actions JSON array containing agent and prompt.`
}
