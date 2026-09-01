import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Agent, Conversation, ConversationDeliverable, ConversationMemory, ConversationParticipant, ConversationTurn, RuntimeInfo } from '../shared/contracts'
import type { AppDatabase } from '../main/database'
import { extractTokenUsage } from '../main/runtime/parser'
import { AdapterRegistry, type RuntimeAdapter } from './adapters'
import { RuntimeQueue } from './runtime-queue'

type ChatResult = { content: string; nativeSessionId: string | null; inputTokens: number; outputTokens: number }

export interface ConversationExecutor {
  execute(conversation: Conversation, participant: ConversationParticipant, agent: Agent, turnId: string, prompt: string): Promise<ChatResult>
  cancel(conversationId: string, force: boolean): Promise<void>
  shutdown(): Promise<void>
}

export class AdapterConversationExecutor implements ConversationExecutor {
  private active = new Map<string, { queueId: string; child: ChildProcessWithoutNullStreams; adapter: RuntimeAdapter }>()
  private queued = new Map<string, string>()
  private cancelled = new Set<string>()

  constructor(private registry: AdapterRegistry, private runtimes: () => RuntimeInfo[], private queue: RuntimeQueue, private dataDirectory: string) {}

  async execute(conversation: Conversation, participant: ConversationParticipant, agent: Agent, turnId: string, prompt: string): Promise<ChatResult> {
    const adapter = this.registry.get(agent.runtime)
    const detected = adapter.detect(this.runtimes())
    const executable = agent.command || detected?.path || detected?.executable
    if (!executable || (!detected?.available && !agent.command)) throw new Error(`${agent.runtime} 未安装或未配置`)
    const cwd = join(this.dataDirectory, 'conversations', conversation.id)
    await mkdir(cwd, { recursive: true })
    const queueId = `conversation:${conversation.id}:${turnId}`
    this.queued.set(conversation.id, queueId)
    let result: ChatResult | undefined; let failure: unknown
    await this.queue.enqueue(queueId, async () => {
      this.queued.delete(conversation.id)
      if (this.cancelled.has(conversation.id)) return
      try {
        const input = { executable, prompt, cwd, permissions: { read: true, write: false, shell: true, git: true, network: true }, nativeSessionId: participant.nativeSessionId, argsTemplate: agent.argsTemplate }
        const launch = participant.nativeSessionId && adapter.supportsNativeResume ? await adapter.resume(input) : await adapter.start(input)
        this.active.set(conversation.id, { queueId, child: launch.child, adapter })
        let stdout = ''; let stderr = ''
        launch.child.stdout.on('data', chunk => { stdout += String(chunk) })
        launch.child.stderr.on('data', chunk => { stderr += String(chunk) })
        const code = await new Promise<number | null>((resolve, reject) => { launch.child.once('error', reject); launch.child.once('close', resolve) })
        if (this.cancelled.has(conversation.id)) return
        if (code !== 0) throw new Error(`Agent 对话执行失败（exit=${code ?? 'null'}）：${stderr.slice(-1000)}`)
        const parsed = adapter.parse(stdout)
        const usage = extractTokenUsage(stdout, prompt, parsed.finalResponse)
        result = { content: parsed.finalResponse, nativeSessionId: parsed.nativeSessionId, ...usage }
      } catch (error) { failure = error }
      finally { this.active.delete(conversation.id) }
    })
    this.queued.delete(conversation.id)
    if (this.cancelled.delete(conversation.id)) throw new Error('讨论已暂停或结束')
    if (failure) throw failure
    if (!result) throw new Error('Agent 未返回讨论结果')
    return result
  }

  async cancel(conversationId: string, force: boolean): Promise<void> {
    const queued = this.queued.get(conversationId)
    const active = this.active.get(conversationId)
    if (!queued && !active) return

    this.cancelled.add(conversationId)
    if (queued && this.queue.cancel(queued)) { this.queued.delete(conversationId); return }
    if (active) await (force ? active.adapter.cancel(active.child) : active.adapter.interrupt(active.child))
  }

  async shutdown(): Promise<void> { await Promise.all([...new Set([...this.active.keys(), ...this.queued.keys()])].map(id => this.cancel(id, true))) }
}

export class ConversationEngine {
  private loops = new Set<string>()
  constructor(private db: AppDatabase, private executor: ConversationExecutor, private changed: () => void) {}

  start(conversationId: string): void {
    const conversation = this.requireConversation(conversationId)
    if (conversation.status === 'COMPLETED') throw new Error('讨论已经完成')
    if (conversation.status === 'READY_TO_SUMMARIZE') throw new Error('讨论轮次已结束，请生成总结或转为任务')
    this.db.updateConversationStatus(conversationId, 'RUNNING'); this.changed()
    if (!this.loops.has(conversationId)) { this.loops.add(conversationId); void this.runLoop(conversationId).finally(() => this.loops.delete(conversationId)) }
  }

  async pause(conversationId: string): Promise<void> {
    const conversation = this.requireConversation(conversationId)
    if (conversation.status !== 'RUNNING') throw new Error('讨论当前不在运行中')
    this.db.updateConversationStatus(conversationId, 'PAUSED'); this.db.interruptActiveConversationRound(conversationId); await this.executor.cancel(conversationId, false); this.changed()
  }

  async end(conversationId: string): Promise<void> {
    this.requireConversation(conversationId)
    this.db.updateConversationStatus(conversationId, 'READY_TO_SUMMARIZE'); this.db.interruptActiveConversationRound(conversationId); await this.executor.cancel(conversationId, true)
    this.systemTurn(conversationId, '讨论已结束。你可以生成总结、行动计划、设计 Brief、PRD 或决策矩阵，也可以将结论转为正式任务。'); this.changed()
  }

  sendMessage(conversationId: string, content: string, targetParticipantId?: string): void {
    const conversation = this.requireConversation(conversationId)
    if (!content.trim()) throw new Error('消息不能为空')
    if (conversation.status === 'COMPLETED') throw new Error('讨论已经完成')
    if (conversation.messageCount >= conversation.maxMessages || conversation.tokenUsed >= conversation.maxTokens) throw new Error('讨论已达到消息或 Token 上限')
    if (targetParticipantId && !this.db.getConversationParticipants(conversationId).some(item => item.id === targetParticipantId)) throw new Error('目标角色不属于当前讨论')
    this.db.createConversationTurn({ conversationId, roundId: null, participantId: targetParticipantId ?? null, agentId: null, speakerType: 'human', speakerName: 'You', content: content.trim(), status: 'COMPLETED' })
    const tokens = estimateTokens(content); this.db.updateConversationProgress(conversationId, conversation.currentRound, 1, tokens)
    const memory = this.db.getConversationMemory(conversationId)
    if (memory) this.db.updateConversationMemory(conversationId, { ...memory, userPreferences: dedupe([...memory.userPreferences, content.trim().slice(0, 300)]).slice(-10) })
    this.changed()
  }

  async summarize(conversationId: string, type: ConversationDeliverable['type']): Promise<void> {
    const conversation = this.requireConversation(conversationId)
    if (conversation.status === 'RUNNING') throw new Error('请先暂停或结束讨论')
    const participants = this.db.getConversationParticipants(conversationId)
    const leader = participants.find(item => item.isLeader)
    if (!leader) throw new Error('讨论没有 Leader')
    const agent = this.db.getAgent(leader.agentId)
    if (!agent) throw new Error('Leader Agent 不存在')
    const turn = this.db.createConversationTurn({ conversationId, roundId: null, participantId: leader.id, agentId: agent.id, speakerType: 'leader', speakerName: leader.roleName, content: '', status: 'QUEUED' })
    this.changed()
    try {
      this.db.updateConversationTurn(turn.id, { status: 'RUNNING' }); this.changed()
      const result = await this.executor.execute(conversation, leader, agent, turn.id, this.summaryPrompt(conversation, type))
      this.db.updateConversationParticipantSession(leader.id, result.nativeSessionId)
      this.db.updateConversationTurn(turn.id, { status: 'COMPLETED', content: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens })
      this.db.updateConversationProgress(conversationId, conversation.currentRound, 1, result.inputTokens + result.outputTokens)
      this.db.createConversationDeliverable(conversationId, type, `${conversation.title} · ${deliverableLabel(type)}`, result.content)
      this.db.updateConversationStatus(conversationId, 'COMPLETED'); this.changed()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.db.updateConversationTurn(turn.id, { status: 'FAILED', error: message }); this.db.updateConversationStatus(conversationId, 'READY_TO_SUMMARIZE'); this.changed(); throw error
    }
  }

  exportMarkdown(conversationId: string): { title: string; content: string } {
    const conversation = this.requireConversation(conversationId)
    const deliverable = this.db.getConversationDeliverables(conversationId)[0]
    const transcript = this.db.getConversationTurns(conversationId).map(turn => `### ${turn.speakerName}\n\n${turn.content || `_${turn.status}${turn.error ? `：${turn.error}` : ''}_`}`).join('\n\n')
    return { title: `${conversation.title}.md`, content: `# ${conversation.title}\n\n> ${conversation.topic}\n\n${conversation.background ? `## 背景\n\n${conversation.background}\n\n` : ''}${deliverable ? `## ${deliverable.title}\n\n${deliverable.content}\n\n` : ''}## 讨论记录\n\n${transcript}\n` }
  }

  shutdown(): Promise<void> { return this.executor.shutdown() }

  private async runLoop(conversationId: string): Promise<void> {
    try {
      while (this.db.getConversation(conversationId)?.status === 'RUNNING') {
        const conversation = this.requireConversation(conversationId)
        if (this.limitReached(conversation)) { this.readyToSummarize(conversation); return }
        const roundNumber = conversation.currentRound + 1
        const focus = this.nextFocus(conversation)
        const round = this.db.createConversationRound(conversationId, roundNumber, focus)
        const participants = this.db.getConversationParticipants(conversationId)
        const latestTarget = [...this.db.getConversationTurns(conversationId)].reverse().find(item => item.speakerType === 'human' && item.participantId)?.participantId
        const ordered = [...participants.filter(item => !item.isLeader).sort((a, b) => Number(b.id === latestTarget) - Number(a.id === latestTarget)), ...participants.filter(item => item.isLeader)]
        let successes = 0
        for (const participant of ordered) {
          const latest = this.requireConversation(conversationId)
          if (latest.status !== 'RUNNING' || this.budgetReached(latest)) break
          if (await this.runParticipant(latest, participant, round.id, roundNumber, focus)) successes++
        }
        const latest = this.requireConversation(conversationId)
        this.db.finishConversationRound(round.id, latest.status === 'RUNNING' ? 'COMPLETED' : 'INTERRUPTED')
        this.refreshMemory(conversationId, round.id)
        if (!successes && latest.status === 'RUNNING') { this.db.updateConversationStatus(conversationId, 'FAILED'); this.systemTurn(conversationId, '本轮没有 Agent 成功返回，请检查 Runtime 配置后恢复讨论。'); this.changed(); return }
        if (latest.status !== 'RUNNING') return
        const progressed = this.requireConversation(conversationId)
        if (this.limitReached(progressed)) { this.readyToSummarize(progressed); return }
      }
    } catch (error) {
      const current = this.db.getConversation(conversationId)
      if (current?.status === 'RUNNING') { this.db.updateConversationStatus(conversationId, 'FAILED'); this.systemTurn(conversationId, `讨论编排失败：${error instanceof Error ? error.message : String(error)}`); this.changed() }
    }
  }

  private async runParticipant(conversation: Conversation, participant: ConversationParticipant, roundId: string, roundNumber: number, focus: string): Promise<boolean> {
    const agent = this.db.getAgent(participant.agentId)
    if (!agent) return false
    const speakerType = participant.isLeader ? 'leader' : 'agent'
    const turn = this.db.createConversationTurn({ conversationId: conversation.id, roundId, participantId: participant.id, agentId: agent.id, speakerType, speakerName: participant.roleName, content: '', status: 'QUEUED' })
    this.changed()
    try {
      this.db.updateConversationTurn(turn.id, { status: 'RUNNING' }); this.changed()
      const prompt = this.participantPrompt(conversation, participant, roundNumber, focus)
      const result = await this.executor.execute(conversation, participant, agent, turn.id, prompt)
      this.db.updateConversationParticipantSession(participant.id, result.nativeSessionId)
      this.db.updateConversationTurn(turn.id, { content: result.content, status: 'COMPLETED', inputTokens: result.inputTokens, outputTokens: result.outputTokens })
      this.db.updateConversationProgress(conversation.id, roundNumber, 1, result.inputTokens + result.outputTokens); this.changed(); return true
    } catch (error) {
      const latest = this.db.getConversation(conversation.id)
      const cancelled = latest?.status === 'PAUSED' || latest?.status === 'READY_TO_SUMMARIZE'
      this.db.updateConversationTurn(turn.id, { status: cancelled ? 'CANCELLED' : 'FAILED', error: error instanceof Error ? error.message : String(error) })
      if (!cancelled) this.db.updateConversationProgress(conversation.id, roundNumber, 1, 0)
      this.changed(); return false
    }
  }

  private participantPrompt(conversation: Conversation, participant: ConversationParticipant, roundNumber: number, focus: string): string {
    const memory = this.db.getConversationMemory(conversation.id)
    const recentTurns = this.db.getConversationTurns(conversation.id, 14).filter(item => item.status === 'COMPLETED' && item.content)
    const recent = recentTurns.map(item => `[${item.speakerName}${item.participantId === participant.id && item.speakerType === 'human' ? ' → 请你回答' : ''}] ${item.content.slice(0, 1400)}`).join('\n\n')
    const modeInstruction = modeInstructions[conversation.mode]
    const leaderInstruction = participant.isLeader ? '你是主持人。识别重复、共识、分歧和未回答问题；不要垄断讨论，本轮末给出收敛意见与下一轮建议。' : '明确回应其他角色已经提出的观点，贡献新的判断、例子或反驳，禁止只做同义复述。'
    return `你正在参加 Moxt 主题讨论。不得操作文件、Shell 或网络；本次只进行思考与表达。\n\n主题：${conversation.topic}\n背景：${conversation.background || '无额外背景'}\n讨论模式：${modeInstruction}\n当前第 ${roundNumber}/${conversation.maxRounds} 轮\n本轮焦点：${focus}\n\n你的角色：${participant.roleName}\n角色要求：${participant.rolePrompt || '从你的专业视角提供有区分度的判断。'}\n${leaderInstruction}\n\n共享记忆：\n${formatMemory(memory)}\n\n最近对话：\n${recent || '尚无其他发言。'}\n\n请使用中文，观点具体、有机制、有例子，控制在 600 字以内。`
  }

  private summaryPrompt(conversation: Conversation, type: ConversationDeliverable['type']): string {
    const memory = this.db.getConversationMemory(conversation.id)
    const turns = this.db.getConversationTurns(conversation.id).filter(item => item.status === 'COMPLETED' && item.content).slice(-40).map(item => `[${item.speakerName}] ${item.content.slice(0, 1800)}`).join('\n\n')
    return `你是本次讨论的 Leader。基于真实聊天记录生成“${deliverableLabel(type)}”，不得杜撰讨论中没有出现的事实。主题：${conversation.topic}\n背景：${conversation.background}\n\n共享记忆：\n${formatMemory(memory)}\n\n聊天记录：\n${turns}\n\n输出完整 Markdown。先给核心结论，再写主要观点、关键分歧、用户需要做的选择和下一步行动；保留有价值的少数意见。`
  }

  private refreshMemory(conversationId: string, roundId: string): void {
    const memory = this.db.getConversationMemory(conversationId)
    if (!memory) return
    const turns = this.db.getConversationTurns(conversationId).filter(item => item.roundId === roundId && item.status === 'COMPLETED')
    const notes = turns.map(item => `${item.speakerName}：${item.content.replace(/\s+/g, ' ').slice(0, 360)}`)
    const lines = turns.flatMap(item => item.content.split(/\r?\n/).map(line => line.replace(/^[-*#\s]+/, '').trim()).filter(Boolean))
    const consensus = dedupe([...memory.consensus, ...lines.filter(line => /共识|同意|赞同|一致|可以确定/.test(line))]).slice(-12)
    const disagreements = dedupe([...memory.disagreements, ...lines.filter(line => /反对|不同意|分歧|风险|但是|然而/.test(line))]).slice(-12)
    const openQuestions = dedupe([...memory.openQuestions, ...lines.filter(line => /[？?]$/.test(line))]).slice(-12)
    const summary = [memory.summary, ...notes].filter(Boolean).join('\n').slice(-6000)
    this.db.updateConversationMemory(conversationId, { summary, consensus, disagreements, openQuestions, userPreferences: memory.userPreferences })
  }

  private nextFocus(conversation: Conversation): string {
    const memory = this.db.getConversationMemory(conversation.id)
    if (memory?.openQuestions.length) return memory.openQuestions[0]
    if (conversation.currentRound === 0) return '独立给出你的核心判断、依据和一个具体例子'
    if (conversation.currentRound === 1) return '回应其他角色，指出你认同、质疑或需要补充的部分'
    return '收敛最有价值的结论、分歧与可执行建议'
  }

  private limitReached(value: Conversation): boolean { return value.currentRound >= value.maxRounds || value.messageCount >= value.maxMessages || value.tokenUsed >= value.maxTokens }
  private budgetReached(value: Conversation): boolean { return value.messageCount >= value.maxMessages || value.tokenUsed >= value.maxTokens }
  private readyToSummarize(conversation: Conversation): void { this.db.updateConversationStatus(conversation.id, 'READY_TO_SUMMARIZE'); this.systemTurn(conversation.id, '已达到轮次、消息数或 Token 上限。讨论不会继续自动运行，请选择生成总结或转为正式任务。'); this.changed() }
  private systemTurn(conversationId: string, content: string): void { this.db.createConversationTurn({ conversationId, roundId: null, participantId: null, agentId: null, speakerType: 'system', speakerName: 'System', content, status: 'COMPLETED' }) }
  private requireConversation(id: string): Conversation { const value = this.db.getConversation(id); if (!value) throw new Error('讨论不存在'); return value }
}

const modeInstructions: Record<Conversation['mode'], string> = {
  roundtable: '圆桌讨论：从不同专业视角分析，交叉回应并逐步形成判断。',
  brainstorm: '头脑风暴：先发散产生差异化想法，再组合、筛选，不要过早否定。',
  debate: '正反辩论：主动暴露假设、反例、代价和二阶影响，以论证而不是立场取胜。',
  consultation: '专家会诊：给出假设、依据、风险、建议以及仍需确认的信息。'
}
const deliverableLabel = (type: ConversationDeliverable['type']): string => ({ SUMMARY: '讨论总结', ACTION_PLAN: '行动计划', DESIGN_BRIEF: 'Design Brief', PRD: '产品需求文档', DECISION_MATRIX: '决策矩阵', MARKDOWN: '主题文档' }[type])
const estimateTokens = (value: string): number => Math.max(1, Math.ceil(value.length / 3))
const dedupe = (values: string[]): string[] => [...new Set(values.map(item => item.trim()).filter(Boolean))]
const formatMemory = (memory: ConversationMemory | undefined): string => memory ? `阶段摘要：${memory.summary || '暂无'}\n共识：${memory.consensus.join('；') || '暂无'}\n分歧：${memory.disagreements.join('；') || '暂无'}\n待回答：${memory.openQuestions.join('；') || '暂无'}\n用户补充：${memory.userPreferences.join('；') || '暂无'}` : '暂无共享记忆'
