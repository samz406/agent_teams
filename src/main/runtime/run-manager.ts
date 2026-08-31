import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Agent, Run, RuntimeEvent, RuntimeInfo } from '../../shared/contracts'
import type { AppDatabase } from '../database'
import { collectGitEvidence } from './git'
import { extractFinalResponse, extractSessionId, extractTeamActions } from './parser'
import { resolveLoginEnvironment, runtimeArgs } from './environment'

type Publish = (event: RuntimeEvent) => void

export class RunManager {
  private processes = new Map<string, ChildProcessWithoutNullStreams>()
  private cancelling = new Set<string>()

  constructor(private db: AppDatabase, private getRuntimes: () => RuntimeInfo[], private publish: Publish, private changed: () => void) {}

  async start(changeId: string, agent: Agent, workspacePath: string, prompt: string, parentRunId: string | null = null, retryReason: string | null = null): Promise<string> {
    const runtime = this.getRuntimes().find(item => item.type === agent.runtime)
    const executable = agent.command || runtime?.path || runtime?.executable
    if (!executable || (!runtime?.available && !agent.command)) throw new Error(`${agent.runtime} 未安装或未配置，请先到运行时设置检测。`)
    const baseCommit = (await collectGitEvidence(workspacePath, null)).head
    const id = randomUUID()
    const run: Run = { id, changeId, agentId: agent.id, parentRunId, status: 'QUEUED', prompt, runtime: agent.runtime, executable, workspacePath, startedAt: null, endedAt: null, exitCode: null, sessionId: null, stdout: '', stderr: '', finalResponse: null, baseCommit, retryReason, evidence: [] }
    this.db.createRun(run)
    this.publish({ type: 'run.status', runId: id, status: 'QUEUED' })
    this.changed()
    void this.execute(run, agent)
    return id
  }

  async control(runId: string, action: 'pause' | 'resume' | 'stop' | 'retry', reason?: string): Promise<void> {
    const run = this.db.getRun(runId)
    if (!run) throw new Error('Run 不存在')
    if (action === 'stop' || action === 'pause') {
      const child = this.processes.get(runId)
      if (child) {
        this.cancelling.add(runId)
        await terminateTree(child)
      }
      const status = action === 'pause' ? 'PAUSED' : 'CANCELLED'
      this.db.updateRun(runId, { status, endedAt: new Date().toISOString() })
      this.publish({ type: 'run.status', runId, status })
      this.changed()
      return
    }
    const agent = this.db.getAgent(run.agentId)
    if (!agent) throw new Error('Agent 不存在')
    await this.start(run.changeId, agent, run.workspacePath, `${run.prompt}\n\nHuman instruction: ${reason || (action === 'retry' ? 'Retry the task and correct the previous failure.' : 'Resume from the previous checkpoint and continue.')}`, run.id, reason || action)
  }

  private async execute(run: Run, agent: Agent): Promise<void> {
    const startedAt = new Date().toISOString()
    this.db.updateRun(run.id, { status: 'STARTING', startedAt })
    this.publish({ type: 'run.status', runId: run.id, status: 'STARTING' })
    try {
      const env = await resolveLoginEnvironment()
      const args = runtimeArgs(run.runtime, buildPrompt(agent, run.prompt), agent.argsTemplate)
      const child = spawn(run.executable, args, { cwd: run.workspacePath, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      this.processes.set(run.id, child)
      this.db.updateRun(run.id, { status: 'RUNNING' })
      this.publish({ type: 'run.status', runId: run.id, status: 'RUNNING' })
      this.db.addEvidence(run.id, { type: 'COMMAND', title: `${run.executable} ${args.map(a => a === run.prompt ? '<prompt>' : a).join(' ')}`, status: 'UNVERIFIED', detail: `cwd: ${run.workspacePath}` })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => { const value = String(chunk); stdout += value; this.publish({ type: 'run.activity', runId: run.id, stream: 'stdout', chunk: value }) })
      child.stderr.on('data', chunk => { const value = String(chunk); stderr += value; this.publish({ type: 'run.activity', runId: run.id, stream: 'stderr', chunk: value }) })
      const outcome = await new Promise<{ code: number | null; error?: Error }>(resolve => {
        child.once('error', error => resolve({ code: null, error }))
        child.once('close', code => resolve({ code }))
      })
      this.processes.delete(run.id)
      if (this.cancelling.delete(run.id)) return
      const endedAt = new Date().toISOString()
      if (outcome.error) {
        stderr += `\n${outcome.error.message}`
        this.db.updateRun(run.id, { status: 'FAILED', endedAt, exitCode: null, stdout, stderr, finalResponse: outcome.error.message })
        this.db.addEvidence(run.id, { type: 'RUNTIME', title: 'CLI 启动失败', status: 'FAIL', detail: outcome.error.message })
        this.publish({ type: 'run.status', runId: run.id, status: 'FAILED' })
        this.changed()
        return
      }
      const status = outcome.code === 0 ? 'COMPLETED' : 'FAILED'
      const finalResponse = extractFinalResponse(stdout)
      const sessionId = extractSessionId(stdout)
      this.db.updateRun(run.id, { status, endedAt, exitCode: outcome.code, stdout, stderr, finalResponse, sessionId })
      this.db.addEvidence(run.id, { type: 'RUNTIME', title: 'Runtime exit', status: outcome.code === 0 ? 'PASS' : 'FAIL', detail: `exit code: ${outcome.code}` })
      const git = await collectGitEvidence(run.workspacePath, run.baseCommit)
      this.db.addEvidence(run.id, { type: 'GIT', title: 'Workspace state', status: 'UNVERIFIED', detail: git.status || 'Clean working tree' })
      if (git.files.length) this.db.addEvidence(run.id, { type: 'DIFF', title: `${git.files.length} files changed`, status: 'UNVERIFIED', detail: `${git.diff}\n\n${git.files.join('\n')}` })
      this.db.addMessage(run.changeId, 'agent', agent.id, agent.name, finalResponse, run.id)
      if (/proposal|contract|report|方案|报告/i.test(finalResponse)) this.db.createArtifact(run.changeId, 'RUN_DELIVERABLE', `${agent.name} Deliverable`, finalResponse)
      this.publish({ type: 'run.status', runId: run.id, status })
      this.changed()
      for (const action of extractTeamActions(finalResponse)) {
        const target = this.db.snapshot(this.getRuntimes()).agents.find(item => item.name.toLowerCase() === action.agent.toLowerCase() || item.id === action.agent)
        if (target && target.id !== agent.id) await this.start(run.changeId, target, this.resolveWorkspace(target, run.workspacePath), action.prompt, run.id, `Delegated by ${agent.name}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.db.updateRun(run.id, { status: 'FAILED', endedAt: new Date().toISOString(), stderr: message, finalResponse: message })
      this.db.addEvidence(run.id, { type: 'RUNTIME', title: 'Runtime failure', status: 'FAIL', detail: message })
      this.publish({ type: 'runtime.notice', level: 'error', message })
      this.changed()
    }
  }

  private resolveWorkspace(agent: Agent, fallback: string): string {
    const id = agent.workspaceIds[0]
    return id ? this.db.getWorkspace(id)?.path || fallback : fallback
  }
}

function buildPrompt(agent: Agent, prompt: string): string {
  return `You are ${agent.name}. Responsibility: ${agent.responsibility}\nQuality bar:\n${agent.qualityBar.map(item => `- ${item}`).join('\n')}\nPermissions: ${JSON.stringify(agent.permissions)}\n\nTask:\n${prompt}\n\nWork in the current local workspace. Report claims with concrete evidence. Do not claim tests passed unless they actually ran. If you need another team member, append a fenced team-actions JSON array, for example [{"agent":"QA Agent","prompt":"Verify ..."}].`
}

async function terminateTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!child.pid) return
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      killer.once('close', () => resolve())
      killer.once('error', () => resolve())
    })
  } else {
    child.kill('SIGINT')
    await new Promise(resolve => setTimeout(resolve, 1200))
    if (!child.killed) child.kill('SIGTERM')
  }
}
