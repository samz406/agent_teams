import type { Agent, Change, Evidence, Run, Task, WorkflowPhase } from '../shared/contracts'
import type { AppDatabase } from '../main/database'
import { WORKFLOWS } from '../shared/workflows'

const codingPhases = new Set(['development', 'fix', 'refactor'])
const verificationPhases = new Set(['verify', 'regression', 'checks', 'recheck', 'integration'])

export class LeaderEngine {
  constructor(private db: AppDatabase, private changed: () => void) {}

  createTask(change: Change, agent: Agent, description: string, parentTaskId: string | null = null): Task {
    const phase = WORKFLOWS[change.workflowType][change.currentPhase]
    const workstream = this.db.getWorkstream(change.id, agent.id)
    const requiredEvidence: Evidence['type'][] = ['RUNTIME']
    if (codingPhases.has(phase.id)) requiredEvidence.push('DIFF', 'TEST')
    if (verificationPhases.has(phase.id)) requiredEvidence.push('TEST')
    const task = this.db.createTask({ changeId: change.id, workstreamId: workstream?.id ?? null, phaseId: phase.id, title: `${phase.name} · ${agent.name}`, description, assignedAgentId: agent.id, verifierAgentId: phase.id === 'verify' ? agent.id : null, status: 'ASSIGNED', requiredEvidence, currentRunId: null, parentTaskId })
    this.changed(); return task
  }

  onRunStarted(taskId: string | null, runId: string): void { if (taskId) this.db.updateTask(taskId, 'RUNNING', runId) }

  onRunFinished(run: Run): { accepted: boolean; reason: string } {
    if (!run.taskId) return { accepted: false, reason: 'Run 未绑定 Task，不能进入验收' }
    const task = this.db.getTask(run.taskId)
    const change = this.db.getChange(run.changeId)
    if (!task || !change) return { accepted: false, reason: 'Task 或 Change 不存在' }
    this.db.updateTask(task.id, 'RUN_COMPLETED', run.id)
    this.db.updateTask(task.id, 'VERIFYING', run.id)
    const phase = WORKFLOWS[change.workflowType][change.currentPhase]
    const violation = this.verifyTask(change, phase, task, run)
    if (violation) {
      this.db.updateTask(task.id, 'REWORK', run.id)
      this.db.updateChangeState(change.id, 'BLOCKED')
      this.db.createIssue({ changeId: change.id, taskId: task.id, ownerAgentId: task.assignedAgentId, title: `${task.title} 验收未通过`, description: violation, severity: 'BLOCKING', sourceEvidenceId: run.evidence.find(item => item.status === 'FAIL')?.id ?? null })
      this.db.addMessage(change.id, 'leader', null, 'Leader', `拒绝验收 ${task.title}：${violation}。Task 已进入 REWORK，Change 标记为 BLOCKED，并创建 Blocking Issue。可修正 Runtime/代码/测试后点击“启动 / 继续执行”重试。`, run.id)
      this.changed(); return { accepted: false, reason: violation }
    }
    this.db.updateTask(task.id, 'ACCEPTED', run.id)
    this.db.resolveTaskIssues(task.id, `Run ${run.id} 重新验收通过`)
    this.db.createHandoff({ changeId: change.id, fromTaskId: task.id, fromAgentId: task.assignedAgentId, toTaskId: null, toAgentId: null, deliverable: run.finalResponse ?? 'Run completed', evidenceIds: run.evidence.map(item => item.id) })
    this.db.addMessage(change.id, 'leader', null, 'Leader', `已验收 ${task.title}。Run、Diff、测试和 Artifact 已按当前阶段规则检查。`, run.id)
    this.reconcileChange(change)
    this.changed(); return { accepted: true, reason: 'Evidence 满足当前阶段要求' }
  }

  assertCanAdvance(change: Change): void {
    const phase = WORKFLOWS[change.workflowType][change.currentPhase]
    const tasks = this.db.getPhaseTasks(change.id, phase.id)
    const pureApproval = phase.id === 'approval' && this.db.hasApprovedArtifact(change.id)
    if (!tasks.length && !pureApproval) throw new Error('当前阶段还没有 Task，不能空推进')
    if (tasks.some(task => task.status !== 'ACCEPTED')) throw new Error('当前阶段仍有未验收 Task')
    if (this.db.hasBlockingIssues(change.id)) throw new Error('存在未解决的 Blocking Issue')
    if (phase.humanMode === 'IN_LOOP' && !this.db.hasApprovedArtifact(change.id)) throw new Error('当前阶段是人工 Gate，必须先批准 Artifact')
    if (change.workflowType === 'bug-fix' && phase.id === 'verify') this.assertIndependentVerifier(change, tasks)
  }

  advance(change: Change): void {
    this.assertCanAdvance(change)
    const phases = WORKFLOWS[change.workflowType]
    if (change.currentPhase >= phases.length - 1) { this.db.updateChangeState(change.id, 'DONE'); return }
    let next = change.currentPhase + 1
    if (phases[next]?.id === 'approval' && this.db.hasApprovedArtifact(change.id)) next += 1
    if (next >= phases.length - 1) this.db.updateChangeState(change.id, 'DONE', phases.length - 1)
    else this.db.updateChangeState(change.id, 'RUNNING', next)
  }

  private verifyTask(change: Change, phase: Omit<WorkflowPhase, 'status'>, task: Task, run: Run): string | null {
    if (run.status !== 'COMPLETED' || run.exitCode !== 0) return `Runtime 未成功结束（${run.status}, exit=${run.exitCode ?? 'null'}）`
    for (const type of task.requiredEvidence) {
      const matches = run.evidence.filter(item => item.type === type)
      if (!matches.length) return `缺少 ${type} Evidence`
      if ((type === 'RUNTIME' || type === 'TEST') && !matches.some(item => item.status === 'PASS')) return `${type} Evidence 没有 PASS 结果`
    }
    if (change.workflowType === 'bug-fix' && phase.id === 'verify') {
      const fixAgents = this.db.getPhaseTasks(change.id, 'fix').map(item => item.assignedAgentId)
      if (fixAgents.includes(task.assignedAgentId)) return 'Bug Fix 的实现 Agent 不能作为最终独立验证人'
    }
    return null
  }

  private assertIndependentVerifier(change: Change, verifyTasks: Task[]): void {
    const fixAgents = new Set(this.db.getPhaseTasks(change.id, 'fix').map(item => item.assignedAgentId))
    if (verifyTasks.some(task => fixAgents.has(task.assignedAgentId))) throw new Error('独立验证人不能是实现 Agent')
  }

  private reconcileChange(change: Change): void {
    const phase = WORKFLOWS[change.workflowType][change.currentPhase]
    const tasks = this.db.getPhaseTasks(change.id, phase.id)
    if (!tasks.length || tasks.some(task => task.status !== 'ACCEPTED')) return
    // Only a true IN_LOOP gate should stop the autonomous workflow. ON_LOOP means
    // humans may intervene while execution continues; REVIEW is an Agent review phase.
    if (phase.humanMode === 'IN_LOOP') this.db.updateChangeState(change.id, 'WAITING_HUMAN')
    else this.advance(change)
  }
}
