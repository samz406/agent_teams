import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ArrowLeft, Brain, Check, CircleStop, Download, FileText, LoaderCircle, MessageCircleMore, Pause, Play, Send, Sparkles, Users, Workflow } from 'lucide-react'
import type { Conversation, ConversationDeliverable, ConversationParticipant, ConversationTurn, WorkflowType } from '../../../shared/contracts'
import { errorText, useAppStore } from '../store'

interface Props { conversation: Conversation; onBack(): void; onOpenTask(id: string): void }

export default function ConversationRoom({ conversation, onBack, onOpenTask }: Props): import('react').JSX.Element {
  const { snapshot, conversationLive, notify } = useAppStore()
  const [target, setTarget] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'discussion' | 'result'>('discussion')
  const participants = snapshot.conversationParticipants.filter(item => item.conversationId === conversation.id)
  const turns = snapshot.conversationTurns.filter(item => item.conversationId === conversation.id)
  const rounds = snapshot.conversationRounds.filter(item => item.conversationId === conversation.id)
  const memory = snapshot.conversationMemories.find(item => item.conversationId === conversation.id)
  const deliverables = snapshot.conversationDeliverables.filter(item => item.conversationId === conversation.id)
  const runningTurn = [...turns].reverse().find(item => ['QUEUED', 'RUNNING'].includes(item.status))

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
      await window.moxt.sendConversationMessage(conversation.id, text.trim(), target || undefined)
      setText('')
      notify('success', conversation.status === 'RUNNING' ? '补充内容会进入共享上下文' : '内容已加入上下文，继续讨论后 Agent 会回应')
    } catch (error) { notify('error', errorText(error)) } finally { setBusy(false) }
  }

  async function summarize(type: ConversationDeliverable['type']): Promise<void> {
    setBusy(true)
    try { await window.moxt.summarizeConversation(conversation.id, type); setTab('result'); notify('success', 'Leader 已生成正式产物') }
    catch (error) { notify('error', errorText(error)) } finally { setBusy(false) }
  }

  async function exportFile(): Promise<void> {
    try { if (await window.moxt.exportConversation(conversation.id)) notify('success', 'Markdown 已导出') }
    catch (error) { notify('error', errorText(error)) }
  }

  return <section className="conversation-room">
    <header className="conversation-header">
      <button className="back-button" onClick={onBack}><ArrowLeft/></button>
      <div><div className="eyebrow">主题讨论 #{conversation.number} · {modeName(conversation.mode)}</div><h1>{conversation.title}</h1><p>{conversation.topic}</p></div>
      <div className="conversation-controls">
        <span className={`conversation-status ${conversation.status.toLowerCase()}`}>{conversation.status}</span>
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
            <div className="memory-card"><strong>当前共识</strong><p>{memory?.consensus.join('；') || '尚未形成'}</p><strong>主要分歧</strong><p>{memory?.disagreements.join('；') || '尚未识别'}</p><strong>待回答问题</strong><p>{memory?.openQuestions.join('；') || '暂无'}</p></div>
          </aside>
          <main className="conversation-feed">
            <div className="round-timeline">{rounds.map(round => <span className={round.status.toLowerCase()} key={round.id}>第 {round.number} 轮 · {round.status}</span>)}</div>
            <div className="conversation-scroll">
              {turns.map(turn => <Turn key={turn.id} turn={turn} live={conversationLive[turn.id]}/>) }
              {!turns.length && <div className="conversation-welcome"><Sparkles/><h2>角色和边界已经就绪</h2><p>点击“开始讨论”，成员会依次表达，后一个角色能够看到前面的发言，Leader 在每轮末负责收敛。</p></div>}
            </div>
            <div className="discussion-composer">
              <div><select value={target} onChange={event => setTarget(event.target.value)}><option value="">补充给所有角色</option>{participants.map(item => <option value={item.id} key={item.id}>@{item.roleName}</option>)}</select><span>{conversation.status === 'RUNNING' ? '内容将进入当前讨论上下文' : '发送后需点击继续讨论'}</span></div>
              <textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void send() }} placeholder="补充背景、追问某个角色或纠正讨论方向…"/>
              <button className="send" disabled={busy || !text.trim() || conversation.status === 'COMPLETED'} onClick={() => void send()}>{busy ? <LoaderCircle className="spin"/> : <Send/>}</button>
            </div>
          </main>
        </div>
      : <ResultPanel conversation={conversation} deliverables={deliverables} participants={participants.map(item => item.agentId)} busy={busy} onSummarize={summarize} onOpenTask={onOpenTask}/>} 
  </section>
}

function Role({ participant, active, onSelect }: { participant: ConversationParticipant; active: boolean; onSelect(): void }): import('react').JSX.Element {
  const agent = useAppStore(state => state.snapshot.agents.find(item => item.id === participant.agentId))
  return <button className={active ? 'active' : ''} onClick={onSelect}><span className={`agent-avatar ${active ? 'running' : ''}`}>{agent?.icon || 'A'}</span><span><strong>{participant.roleName}{participant.isLeader && <i>Leader</i>}</strong><small>{agent?.runtime} · {participant.rolePrompt}</small></span>{active && <LoaderCircle className="spin"/>}</button>
}

function Turn({ turn, live }: { turn: ConversationTurn; live?: string }): import('react').JSX.Element {
  const icon = useAppStore(state => state.snapshot.agents.find(item => item.id === turn.agentId)?.icon)
  let body: import('react').JSX.Element
  if (turn.status === 'RUNNING' || turn.status === 'QUEUED') body = <div className="thinking-output"><LoaderCircle className="spin"/><span>{(live || `${turn.speakerName} 正在组织观点…`).slice(-500)}</span></div>
  else if (turn.status === 'FAILED' || turn.status === 'CANCELLED') body = <p className="turn-error">{turn.error || turn.status}</p>
  else body = <div className="markdown"><ReactMarkdown>{turn.content}</ReactMarkdown></div>
  return <article className={`conversation-turn ${turn.speakerType} ${turn.status.toLowerCase()}`}><span className="turn-avatar">{turn.speakerType === 'human' ? 'Y' : turn.speakerType === 'system' ? 'S' : icon || 'L'}</span><div><header><strong>{turn.speakerName}</strong><small>{turn.status}{turn.inputTokens + turn.outputTokens > 0 ? ` · ${(turn.inputTokens + turn.outputTokens).toLocaleString()} tokens` : ''}</small></header>{body}</div></article>
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
  const choices: Array<[ConversationDeliverable['type'], string]> = [['SUMMARY', '讨论总结'], ['ACTION_PLAN', '行动计划'], ['DESIGN_BRIEF', 'Design Brief'], ['PRD', '产品需求文档'], ['DECISION_MATRIX', '决策矩阵']]
  return <div className="conversation-results">
    <aside><h3>生成讨论产物</h3>{choices.map(([type, label]) => <button disabled={busy || conversation.status === 'RUNNING' || conversation.status === 'DRAFT'} onClick={() => void onSummarize(type)} key={type}><Sparkles/><span><strong>{label}</strong><small>由 Leader 基于真实记录生成</small></span></button>)}<h3>已有产物</h3>{deliverables.map(item => <button className={current?.id === item.id ? 'active' : ''} onClick={() => setSelected(item.id)} key={item.id}><FileText/><span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span></button>)}</aside>
    <main>
      {current ? <article><header><span className="conversation-status completed">FINAL</span><h2>{current.title}</h2></header><div className="markdown"><ReactMarkdown>{current.content}</ReactMarkdown></div></article> : <div className="result-empty"><FileText/><h2>讨论结束后，把聊天转化为可复用的结果</h2><p>可以生成总结、行动计划、设计 Brief、PRD 或决策矩阵。Leader 会保留共识、分歧和少数意见。</p></div>}
      <div className="convert-task"><div><Workflow/><span><strong>转为正式任务</strong><small>携带讨论结论进入 Workspace、Worktree、Evidence 和 Workflow 执行链路。</small></span></div><select value={workspaceId} onChange={event => setWorkspaceId(event.target.value)}><option value="">选择 Git Workspace</option>{snapshot.workspaces.filter(item => item.repoRoot && item.baseCommit).map(item => <option value={item.id} key={item.id}>{item.name} · {item.branch}</option>)}</select><select value={workflowType} onChange={event => setWorkflowType(event.target.value as WorkflowType)}><option value="cross-project">跨项目协同开发</option><option value="incident">线上问题会诊</option><option value="bug-fix">Bug 修复</option><option value="refactor">大型重构</option><option value="release">发布前检查</option></select><button className="primary" disabled={!workspaceId || converting} onClick={() => void convert()}>{converting ? <LoaderCircle className="spin"/> : <Check/>}创建任务</button></div>
    </main>
  </div>
}

function Progress({ label, value, max }: { label: string; value: number; max: number }): import('react').JSX.Element { const percent = Math.min(100, max ? value / max * 100 : 0); return <div><span><strong>{label}</strong><small>{value.toLocaleString()} / {max.toLocaleString()}</small></span><i><b style={{ width: `${percent}%` }}/></i></div> }
const modeName = (mode: Conversation['mode']): string => ({ roundtable: '圆桌讨论', brainstorm: '头脑风暴', debate: '正反辩论', consultation: '专家会诊' }[mode])
