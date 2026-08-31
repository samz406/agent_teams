import { join } from 'node:path'
import { AppDatabase } from '../main/database'
import { WORKFLOWS } from '../shared/workflows'
import type { Agent, RuntimeEvent, RuntimeProcessMessage, RuntimeRequest, RuntimeRequestEnvelope } from '../shared/contracts'
import { AdapterRegistry } from './adapters'
import { LeaderEngine } from './leader-engine'
import { TeamRunManager } from './run-manager'
import { WorkspaceManager } from './workspace-manager'

interface ParentPort { postMessage(message: RuntimeProcessMessage): void; on(event: 'message', listener: (event: { data: RuntimeRequestEnvelope }) => void): void }
const port = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
if (!port) throw new Error('Moxt Runtime 必须由 Electron utilityProcess 启动')
const dataDirectory = process.env.MOXT_DATA_DIR
if (!dataDirectory) throw new Error('MOXT_DATA_DIR 未配置')

const db = new AppDatabase(join(dataDirectory, 'database', 'moxt.db'))
const registry = new AdapterRegistry()
const publish = (event: RuntimeEvent): void => port.postMessage({ event })
let runManager: TeamRunManager
const changed = (): void => publish({ type: 'snapshot.changed', snapshot: db.snapshot(runManager?.getRuntimes() ?? []) })
const leader = new LeaderEngine(db, changed)
runManager = new TeamRunManager(db, registry, new WorkspaceManager(dataDirectory), leader, publish, changed)
const initialized = registry.detect().then(runtimes => { runManager.setRuntimes(runtimes); changed() })

process.on('SIGTERM', () => { void runManager.shutdown().finally(() => process.exit(0)) })
process.on('SIGINT', () => { void runManager.shutdown().finally(() => process.exit(0)) })

port.on('message', event => {
  const envelope = event.data
  void initialized.then(() => dispatch(envelope.request)).then(result => port.postMessage({ id: envelope.id, ok: true, result })).catch(error => port.postMessage({ id: envelope.id, ok: false, error: error instanceof Error ? error.message : String(error) }))
})

async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.type) {
    case 'snapshot.get': return db.snapshot(runManager.getRuntimes())
    case 'workspace.add': { const value = db.addWorkspace(request.workspace); changed(); return value }
    case 'agent.create': { const value = db.createAgent(request.input); changed(); return value }
    case 'runtime.detect': { const runtimes = await registry.detect(); runManager.setRuntimes(runtimes); changed(); return runtimes }
    case 'change.create': {
      if (!request.input.title.trim() || !request.input.description.trim()) throw new Error('任务标题和描述不能为空')
      if (!request.input.workspaceIds.length || !request.input.agentIds.length) throw new Error('至少选择一个 Workspace 和 Agent')
      if (request.input.agentBindings.length !== request.input.agentIds.length) throw new Error('每个 Agent 必须绑定一个 Workspace')
      for (const binding of request.input.agentBindings) if (!request.input.agentIds.includes(binding.agentId) || !request.input.workspaceIds.includes(binding.workspaceId)) throw new Error('Agent-Workspace Binding 越过当前 Change 范围')
      const value = db.createChange(request.input); changed(); return value
    }
    case 'message.send': return sendMessage(request.changeId, request.content, request.targetAgentId)
    case 'run.control': return runManager.control(request.runId, request.action, request.reason)
    case 'artifact.approve': db.approveArtifact(request.artifactId, request.approve, request.feedback); changed(); return null
    case 'workflow.advance': { const change = db.getChange(request.changeId); if (!change) throw new Error('任务不存在'); leader.advance(change); changed(); return null }
    case 'issue.update': db.updateIssue(request.issueId, request.status, request.resolution); changed(); return null
  }
}

async function sendMessage(changeId: string, content: string, targetAgentId?: string): Promise<void> {
  const change = db.getChange(changeId); if (!change) throw new Error('任务不存在')
  db.addMessage(changeId, 'human', null, 'You', content, null)
  const state = db.snapshot(runManager.getRuntimes()); const normalized = content.toLowerCase()
  const target = targetAgentId ? db.getAgent(targetAgentId) : state.agents.find(agent => normalized.includes(`@${agent.name.toLowerCase().replaceAll(' ', '-')}`) || normalized.includes(`@${agent.name.toLowerCase()}`)) || state.agents.find(agent => agent.name === 'Leader') || state.agents.find(agent => change.agentIds.includes(agent.id))
  assertTeamAgent(target, change.agentIds)
  const active = db.findActiveRun(changeId, target.id)
  if (active) {
    db.addIntervention({ changeId, targetAgentId: target.id, affectedRunId: active.id, reason: 'Direct human instruction while Agent was active', newConstraints: content, operator: 'You' })
    await runManager.control(active.id, 'pause', content)
  }
  const phaseId = WORKFLOWS[change.workflowType][change.currentPhase].id
  const task = db.findReworkTask(change.id, phaseId, target.id) ?? leader.createTask(change, target, content)
  if (task.status === 'REWORK' || task.status === 'BLOCKED') db.updateTask(task.id, 'ASSIGNED', null)
  await runManager.start(changeId, target, content, task, active ? { parentRunId: active.id, retryReason: 'Human intervention', resumeNative: true } : {})
}

function assertTeamAgent(agent: Agent | undefined, teamIds: string[]): asserts agent is Agent {
  if (!agent) throw new Error('没有可执行的 Agent')
  if (!teamIds.includes(agent.id)) throw new Error(`${agent.name} 不属于当前 Session Team`)
}
