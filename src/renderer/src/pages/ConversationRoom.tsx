import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ArrowLeft, Brain, Check, CircleStop, Download, FileText, LoaderCircle, MessageCircleMore, Pause, Play, RotateCcw, Send, Sparkles, Users, Workflow } from 'lucide-react'
import type { Conversation, ConversationDeliverable, ConversationParticipant, ConversationTurn, WorkflowType } from '../../../shared/contracts'
import { findConversationMention, resolveMentionedParticipant, type ConversationMention } from '../../../shared/conversation-templates'
import { errorText, useAppStore } from '../store'

interface Props { conversation: Conversation; onBack(): void; onOpenTask(id: string): void }

export default function ConversationRoom({ conversation, onBack, onOpenTask }: Props): import('react').JSX.Element {
  const { snapshot, notify } = useAppStore()
  const [target, setTarget] = useState('')
  const [text, setText] = useState('')
  const [mention, setMention] = useState<ConversationMention | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'discussion' | 'result'>('discussion')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const participants = snapshot.conversationParticipants.filter(item => item.conversationId === conversation.id)
  const turns = snapshot.conversationTurns.filter(item => item.conversationId === conversation.id)
  const rounds = snapshot.conversationRounds.filter(item => item.conversationId === conversation.id)
  const memory = snapshot.conversationMemories.find(item => item.conversationId === conversation.id)
  const deliverables = snapshot.conversationDeliverables.filter(item => item.conversationId === conversation.id)
  const runningTurn = [...turns].reverse().find(item => ['QUEUED', 'RUNNING'].includes(item.status))
  const visibleTurns = turns.filter(turn => !isTerminalSystemTurn(turn))
  const mentionMatches = mention ? participants.filter(item => item.roleName.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : []

  async function control(action: 'start' | 'pause' | 'resume' | 'end'): Promise<void> {
    setBusy(true)
    try {
      await window.moxt.controlConversation(conversation.id, action)
      notify('success', action === 'start' ? '讨论已开始' : action === 'resume' ? '讨论已继续' : action === 'pause' ? '讨论已暂停' : '讨论已结束，可以生成产物')
    } catch (error) { notify('error', errorText(error)) } finally { setBusy(false) }
  }

  async function send(): Promise<void> {
    if (!text.trim()) return
    setBusy(true)
    try {
      const mentioned = resolveMentionedParticipant(text, participants)
      await window.moxt.sendConversationMessage(conversation.id, text.trim(), target || mentioned?.id || undefined)
      setText('')
      setMention(null)
      notify('success', conversation.status === 'RUNNING' ? '补充内容会进入共享上下文' : '内容已加入上下文，继续讨论后 Agent 会回应')
    } catch (error) { notify('error', errorText(error)) } finally { setBusy(false) }
  }

  function updateText(value: string, cursor: number): void {
    setText(value)
    setMention(findConversationMention(value, cursor))
  }

  function chooseMention(participant: ConversationParticipant): void {
    if (!mention) return
    const next = `${text.slice(0, mention.start)}@${participant.roleName} ${text.slice(mention.cursor)}`
    const cursor = mention.start + participant.roleName.length + 2
    setText(next); setTarget(participant.id); setMention(null)
    window.requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(cursor, cursor) })
  }

  async function summarize(type: ConversationDeliverable['type']): Promise<void> {
    setBusy(true)
    try { await window.moxt.summarizeConversation(conversation.id, type); setTab('result'); notify('success', 'Leader 已生成正式产物') }
    catch (error) { notify('error', errorText(error)) } finally { setBusy(false) }
  }

  async function extend(additionalRounds: number): Promise<void> {
    setBusy(true)
    try { await window.moxt.extendConversation(conversation.id, additionalRounds); notify('success', `已追加 ${additionalRounds} 轮讨论`) }
    catch (error) { notify('error', errorText(error)) } finally { setBusy(false) }
  }

  async function exportFile(): Promise<void> {
    try { if (await window.moxt.exportConversation(conversation.id)) notify('success', 'Markdown 已导出') }
    catch (error) { notify('error', errorText(error)) }
  }

  return <section className="conversation-room">
    <header className="conversation-header">
      <button className="back-button" onClick={onBack}><ArrowLeft/></button>
      <div><div className="eyebrow">多人聊天 #{conversation.number} · {modeName(conversation.mode)}</div><h1>{conversation.title}</h1><p>{conversation.topic}</p></div>
      <div className="conversation-controls">
        <span className={`conversation-status ${conversation.status.toLowerCase()}`}>{statusName(conversation.status)}</span>
        {conversation.status === 'DRAFT' && <button className="primary" disabled={busy} onClick={() => void control('start')}><Play/>开始讨论</button>}
        {conversation.status === 'RUNNING' && <><button className="secondary" disabled={busy} onClick={() => void control('pause')}><Pause/>暂停</button><button className="secondary danger" disabled={busy} onClick={() => void control('end')}><CircleStop/>结束</button></>}
        {['PAUSED', 'FAILED'].includes(conversation.status) && <><button className="primary" disabled={busy} onClick={() => void control('resume')}><Play/>继续</button><button className="secondary" disabled={busy} onClick={() => void control('end')}><CircleStop/>结束</button></>}
        <button className="secondary" onClick={() => void exportFile()}><Download/>导出</button>
      </div>
    </header>
    <div className="conversation-progress"><Progress label="讨论轮次" value={conversation.currentRound} max={conversation.maxRounds}/><Progress label="消息数量" value={conversation.messageCount} max={conversation.maxMessages}/><Progress label="Token 用量" value={conversation.tokenUsed} max={conversation.maxTokens}/></div>
    <div className="conversation-tabs"><button className={tab === 'discussion' ? 'active' : ''} onClick={() => setTab('discussion')}><MessageCircleMore/>讨论现场</button><button className={tab === 'result' ? 'active' : ''} onClick={() => setTab('result')}><FileText/>讨论产物 <em>{deliverables.length}</em></button></div>
    {tab === 'discussion'
      ? <div className="conversation-layout">
          <aside className="conversation-roles">
            <h3><Users/>讨论角色</h3>
            {participants.map(participant => <Role key={participant.id} participant={participant} active={runningTurn?.participantId === participant.id} onSelect={() => setTarget(participant.id)}/>) }
            <h3><Brain/>共享记忆</h3>
            <div className="memory-card"><MemorySection title="当前共识" content={memory?.consensus.join('\n\n') || '尚未形成'}/><MemorySection title="主要分歧" content={memory?.disagreements.join('\n\n') || '尚未识别'}/><MemorySection title="待回答问题" content={memory?.openQuestions.join('\n\n') || '暂无'}/></div>
          </aside>
          <main className="conversation-feed">
            <div className="round-timeline">{rounds.map(round => <span className={round.status.toLowerCase()} key={round.id}>第 {round.number} 轮 · {round.status}</span>)}</div>
            <div className="conversation-scroll">
              {visibleTurns.map(turn => <Turn key={turn.id} turn={turn} targetName={turn.speakerType === 'human' ? participants.find(item => item.id === turn.participantId)?.roleName : undefined}/>) }
              {!turns.length && <div className="conversation-welcome"><Sparkles/><h2>角色和边界已经就绪</h2><p>点击“开始讨论”，成员会依次表达，后一个角色能够看到前面的发言，Leader 在每轮末负责收敛。</p></div>}
              {conversation.status === 'READY_TO_SUMMARIZE' && <CompletionCard conversation={conversation} turns={turns} busy={busy} onSummarize={summarize} onExtend={extend} onOpenResults={() => setTab('result')}/>}
            </div>
            <div className="discussion-composer">
              <div><select value={target} onChange={event => setTarget(event.target.value)}><option value="">补充给所有角色</option>{participants.map(item => <option value={item.id} key={item.id}>@{item.roleName}</option>)}</select><span>{conversation.stopReason === 'TOKEN_BUDGET' ? '已达到 Token 安全线，请先生成产物' : conversation.status === 'RUNNING' ? '内容将进入当前讨论上下文' : conversation.status === 'READY_TO_SUMMARIZE' ? '补充后可在上方追加讨论' : '发送后需点击继续讨论'}</span></div>
              {mention && <div className="discussion-mention-list" role="listbox" aria-label="选择要追问的角色"><div className="discussion-mention-title">选择要追问的角色</div><div className="discussion-mention-options">{mentionMatches.map(item => <button role="option" aria-selected={target === item.id} onMouseDown={event => { event.preventDefault(); chooseMention(item) }} key={item.id}><span className="agent-avatar">{roleIcon(item.roleName)}</span><span className="discussion-mention-copy"><strong>{item.roleName}</strong><small>{item.rolePrompt}</small></span><em>{item.isLeader ? 'Leader' : '定向追问'}</em></button>)}{!mentionMatches.length && <p>没有匹配的角色</p>}</div></div>}
              <textarea ref={textareaRef} value={text} onChange={event => updateText(event.target.value, event.target.selectionStart)} onKeyDown={event => { if (event.key === 'Escape') setMention(null); if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void send() }} placeholder="输入 @ 可追问某个角色，也可以补充背景或纠正讨论方向…"/>
              <button className="send" disabled={busy || !text.trim() || conversation.status === 'COMPLETED' || conversation.stopReason === 'TOKEN_BUDGET'} onClick={() => void send()}>{busy ? <LoaderCircle className="spin"/> : <Send/>}</button>
            </div>
          </main>
        </div>
      : <ResultPanel conversation={conversation} deliverables={deliverables} participants={participants.map(item => item.agentId)} busy={busy} onSummarize={summarize} onOpenTask={onOpenTask}/>} 
  </section>
}

function CompletionCard({ conversation, turns, busy, onSummarize, onExtend, onOpenResults }: { conversation: Conversation; turns: ConversationTurn[]; busy: boolean; onSummarize(type: ConversationDeliverable['type']): Promise<void>; onExtend(rounds: number): Promise<void>; onOpenResults(): void }): import('react').JSX.Element {
  const recommended = recommendedDeliverable(conversation)
  const totalCost = turns.reduce((sum, turn) => sum + (turn.costUsd ?? 0), 0)
  const canExtend = conversation.stopReason !== 'TOKEN_BUDGET' && conversation.currentRound < 50
  return <section className="conversation-completion-card">
    <div className="completion-icon"><Sparkles/></div>
    <div className="completion-copy"><span>{stopReasonName(conversation.stopReason)}</span><h2>{completionTitle(conversation)}</h2><p>自动讨论已经停止。推荐生成“{deliverableName(recommended)}”，也可以选择其他产物、继续讨论或进入正式任务。</p><small>{conversation.messageCount} 条消息 · {conversation.tokenUsed.toLocaleString()} tokens{totalCost > 0 ? ` · 约 $${totalCost.toFixed(totalCost < 0.1 ? 4 : 2)}` : ''}</small></div>
    <div className="completion-actions"><button className="primary" disabled={busy} onClick={() => void onSummarize(recommended)}><Sparkles/>生成{deliverableName(recommended)}</button><details><summary>选择其他产物</summary><div>{deliverableChoices.filter(([type]) => type !== recommended).map(([type, label, description]) => <button disabled={busy} onClick={() => void onSummarize(type)} key={type}><strong>{label}</strong><small>{description}</small></button>)}</div></details>{canExtend && <details><summary><RotateCcw/>继续讨论</summary><div><button disabled={busy} onClick={() => void onExtend(1)}><strong>追加 1 轮</strong><small>围绕当前分歧继续推进</small></button><button disabled={busy || conversation.currentRound > 47} onClick={() => void onExtend(3)}><strong>追加 3 轮</strong><small>需要更多交叉讨论时选择</small></button></div></details>}<button className="secondary" disabled={busy} onClick={onOpenResults}><Workflow/>转为正式任务</button></div>
  </section>
}

function Role({ participant, active, onSelect }: { participant: ConversationParticipant; active: boolean; onSelect(): void }): import('react').JSX.Element {
  const agent = useAppStore(state => state.snapshot.agents.find(item => item.id === participant.agentId))
  return <button className={active ? 'active' : ''} onClick={onSelect}><span className={`agent-avatar ${active ? 'running' : ''}`}>{roleIcon(participant.roleName)}</span><span><strong>{participant.roleName}{participant.isLeader && <i>Leader</i>}</strong><small>{agent?.runtime} · {participant.rolePrompt}</small></span>{active && <LoaderCircle className="spin"/>}</button>
}

function Turn({ turn, targetName }: { turn: ConversationTurn; targetName?: string }): import('react').JSX.Element {
  let body: import('react').JSX.Element
  if (turn.status === 'RUNNING' || turn.status === 'QUEUED') body = <div className="thinking-output"><LoaderCircle className="spin"/><span>{turn.speakerName} 正在分析上下文并组织观点…</span></div>
  else if (turn.status === 'FAILED' || turn.status === 'CANCELLED') body = <p className="turn-error">{turn.error || turn.status}</p>
  else body = <div className="markdown"><ReactMarkdown>{turn.content}</ReactMarkdown></div>
  const usageTitle = turn.totalTokens ? `输入 ${turn.inputTokens.toLocaleString()} · 缓存读取 ${turn.cachedInputTokens.toLocaleString()} · 缓存写入 ${turn.cacheCreationInputTokens.toLocaleString()} · 输出 ${turn.outputTokens.toLocaleString()}${turn.costUsd !== null ? ` · 约 $${turn.costUsd.toFixed(4)}` : ''}` : undefined
  return <article className={`conversation-turn ${turn.speakerType} ${turn.status.toLowerCase()}`}><span className="turn-avatar">{turn.speakerType === 'human' ? 'Y' : turn.speakerType === 'system' ? 'S' : roleIcon(turn.speakerName)}</span><div><header><strong>{turn.speakerName}{targetName && <em> → @{targetName}</em>}</strong><small title={usageTitle}>{turn.status}{turn.totalTokens > 0 ? ` · ${turn.totalTokens.toLocaleString()} tokens` : ''}</small></header>{body}</div></article>
}

function MemorySection({ title, content }: { title: string; content: string }): import('react').JSX.Element {
  return <section><strong>{title}</strong><div className="markdown"><ReactMarkdown>{content}</ReactMarkdown></div></section>
}

interface ResultProps { conversation: Conversation; deliverables: ConversationDeliverable[]; participants: string[]; busy: boolean; onSummarize(type: ConversationDeliverable['type']): Promise<void>; onOpenTask(id: string): void }
function ResultPanel({ conversation, deliverables, participants, busy, onSummarize, onOpenTask }: ResultProps): import('react').JSX.Element {
  const { snapshot, notify } = useAppStore()
  const [selected, setSelected] = useState(deliverables[0]?.id)
  const [workspaceId, setWorkspaceId] = useState(snapshot.workspaces.find(item => item.repoRoot && item.baseCommit)?.id || '')
  const [workflowType, setWorkflowType] = useState<WorkflowType>('cross-project')
  const [converting, setConverting] = useState(false)
  const current = deliverables.find(item => item.id === selected) || deliverables[0]
  async function convert(): Promise<void> {
    if (!workspaceId) return
    setConverting(true)
    try { const change = await window.moxt.convertConversation(conversation.id, { workspaceId, agentIds: participants, workflowType, priority: 'P1' }); notify('success', `已创建正式任务 #${change.number}`); onOpenTask(change.id) }
    catch (error) { notify('error', errorText(error)) } finally { setConverting(false) }
  }
  return <div className="conversation-results">
    <aside><h3>生成讨论产物</h3>{deliverableChoices.map(([type, label, description]) => <button disabled={busy || conversation.status === 'RUNNING' || conversation.status === 'DRAFT'} onClick={() => void onSummarize(type)} key={type}><Sparkles/><span><strong>{label}</strong><small>{description}</small></span></button>)}<h3>已有产物</h3>{deliverables.map(item => <button className={current?.id === item.id ? 'active' : ''} onClick={() => setSelected(item.id)} key={item.id}><FileText/><span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span></button>)}</aside>
    <main>
      {current ? <article><header><span className="conversation-status completed">FINAL</span><h2>{current.title}</h2></header><div className="markdown"><ReactMarkdown>{current.content}</ReactMarkdown></div></article> : <div className="result-empty"><FileText/><h2>讨论结束后，把聊天转化为可复用的结果</h2><p>可以生成总结、行动计划、设计 Brief、PRD 或决策矩阵。Leader 会保留共识、分歧和少数意见。</p></div>}
      <div className="convert-task"><div><Workflow/><span><strong>转为正式任务</strong><small>携带讨论结论进入 Workspace、Worktree、Evidence 和 Workflow 执行链路。</small></span></div><select value={workspaceId} onChange={event => setWorkspaceId(event.target.value)}><option value="">选择 Git Workspace</option>{snapshot.workspaces.filter(item => item.repoRoot && item.baseCommit).map(item => <option value={item.id} key={item.id}>{item.name} · {item.branch}</option>)}</select><select value={workflowType} onChange={event => setWorkflowType(event.target.value as WorkflowType)}><option value="cross-project">跨项目协同开发</option><option value="incident">线上问题会诊</option><option value="bug-fix">Bug 修复</option><option value="refactor">大型重构</option><option value="release">发布前检查</option></select><button className="primary" disabled={!workspaceId || converting} onClick={() => void convert()}>{converting ? <LoaderCircle className="spin"/> : <Check/>}创建任务</button></div>
    </main>
  </div>
}

function Progress({ label, value, max }: { label: string; value: number; max: number }): import('react').JSX.Element { const percent = Math.min(100, max ? value / max * 100 : 0); return <div><span><strong>{label}</strong><small>{value.toLocaleString()} / {max.toLocaleString()}</small></span><i><b style={{ width: `${percent}%` }}/></i></div> }
const deliverableChoices: Array<[ConversationDeliverable['type'], string, string]> = [['SUMMARY', '讨论总结', '保留主要观点、共识与分歧'], ['ACTION_PLAN', '行动计划', '整理目标、步骤和检查节点'], ['DESIGN_BRIEF', 'Design Brief', '沉淀设计方向与创意约束'], ['PRD', '产品需求文档', '形成可进入开发的产品定义'], ['DECISION_MATRIX', '决策矩阵', '比较方案、代价和选择依据']]
const deliverableName = (type: ConversationDeliverable['type']): string => deliverableChoices.find(item => item[0] === type)?.[1] ?? '讨论总结'
const recommendedDeliverable = (conversation: Conversation): ConversationDeliverable['type'] => {
  const subject = `${conversation.title} ${conversation.topic}`
  if (/需求|功能|产品开发|实现一个|开发一个/.test(subject)) return 'PRD'
  if (/网站|界面|视觉|设计灵感|品牌/.test(subject) || conversation.mode === 'brainstorm') return 'DESIGN_BRIEF'
  if (/管理|学习|提升|计划|怎么做|如何/.test(subject) || conversation.mode === 'consultation') return 'ACTION_PLAN'
  if (conversation.mode === 'debate') return 'DECISION_MATRIX'
  return 'SUMMARY'
}
const statusName = (status: Conversation['status']): string => ({ DRAFT: '待开始', RUNNING: '讨论中', PAUSED: '已暂停', READY_TO_SUMMARIZE: '待生成结果', COMPLETED: '已完成', FAILED: '运行失败' }[status])
const stopReasonName = (reason: Conversation['stopReason']): string => ({ MAX_ROUNDS: '已达到轮数', MAX_MESSAGES: '已达到消息数', TOKEN_BUDGET: '已达到 Token 安全线', USER_ENDED: '你已结束讨论', ERROR: '讨论异常停止' }[reason ?? 'USER_ENDED'])
const completionTitle = (conversation: Conversation): string => conversation.stopReason === 'MAX_ROUNDS' ? `已完成 ${conversation.currentRound} 轮讨论` : conversation.stopReason === 'MAX_MESSAGES' ? `已产生 ${conversation.messageCount} 条消息` : conversation.stopReason === 'TOKEN_BUDGET' ? '本次讨论已停止继续消耗' : '现在可以沉淀讨论结果'
const isTerminalSystemTurn = (turn: ConversationTurn): boolean => turn.speakerType === 'system' && /讨论已结束|已达到.*上限|已完成设定轮数/.test(turn.content)
const modeName = (mode: Conversation['mode']): string => ({ roundtable: '圆桌讨论', brainstorm: '头脑风暴', debate: '正反辩论', consultation: '专家会诊' }[mode])
const roleIcon = (name: string): string => name.trim().slice(0, 1) || '角'
