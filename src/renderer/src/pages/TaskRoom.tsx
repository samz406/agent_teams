import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Activity, ArrowRight, Bot, Check, ChevronRight, CircleStop, Clock3, FileCode2, FileText, GitCompare, LoaderCircle, MessageSquareText, MoreHorizontal, Pause, Play, RefreshCw, Send, ShieldCheck, Terminal, TestTube2, Users, X } from 'lucide-react'
import type { Agent, Change, Run } from '../../../shared/contracts'
import { phasesFor, WORKFLOW_LABELS } from '../../../shared/workflows'
import { errorText, useAppStore } from '../store'

type Tab = 'chat' | 'workflow' | 'artifacts'

export default function TaskRoom({ change }: { change: Change }): import('react').JSX.Element {
  const { snapshot, live, notify } = useAppStore()
  const [tab, setTab] = useState<Tab>('chat')
  const [text, setText] = useState('')
  const [target, setTarget] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const team = snapshot.agents.filter(a => change.agentIds.includes(a.id))
  const messages = snapshot.messages.filter(m => m.changeId === change.id)
  const runs = snapshot.runs.filter(r => r.changeId === change.id)
  const artifacts = snapshot.artifacts.filter(a => a.changeId === change.id)
  const phases = phasesFor(change.workflowType, change.currentPhase)
  const inspector = selectedAgent ? team.find(a => a.id === selectedAgent) : undefined
  async function send(): Promise<void> {
    if (!text.trim()) return
    setSending(true)
    try { await window.moxt.sendMessage(change.id, text.trim(), target || undefined); setText(''); notify('success', '已交给真实 CLI Runtime 执行') }
    catch (error) { notify('error', errorText(error)) } finally { setSending(false) }
  }
  return <section className="task-room">
    <header className="room-header"><div><div className="eyebrow">任务 #{change.number} · {WORKFLOW_LABELS[change.workflowType].name}</div><h1>{change.title}</h1><p>{change.description}</p></div><div className="room-actions"><span className="running-dot">● {change.status}</span><button className="icon-btn"><MoreHorizontal/></button></div></header>
    <div className="phase-bar">{phases.map((phase, i) => <button key={phase.id} className={phase.status.toLowerCase()} onClick={() => setTab('workflow')}><i>{phase.status === 'DONE' ? <Check/> : i + 1}</i><span>{phase.name}</span></button>)}</div>
    <div className="room-tabs"><button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}><MessageSquareText/>Team Chat</button><button className={tab === 'workflow' ? 'active' : ''} onClick={() => setTab('workflow')}><Activity/>Workflow</button><button className={tab === 'artifacts' ? 'active' : ''} onClick={() => setTab('artifacts')}><FileText/>Artifact <em>{artifacts.length}</em></button></div>
    <div className={`room-body ${inspector ? 'with-inspector' : ''}`}>
      <aside className="team-rail"><h3><Users/>参与者 <span>{team.length}</span></h3>{team.map(agent => <button className={selectedAgent === agent.id ? 'active' : ''} onClick={() => setSelectedAgent(agent.id)} key={agent.id}><span className={`agent-avatar ${agent.status.toLowerCase()}`}>{agent.icon}</span><div><strong>{agent.name}</strong><small>{agent.status} · {agent.runtime}</small></div>{agent.status === 'RUNNING' && <LoaderCircle className="spin"/>}</button>)}<h3 className="rail-section"><Terminal/>Workspaces</h3>{snapshot.workspaces.filter(w => change.workspaceIds.includes(w.id)).map(w => <div className="workspace-mini" key={w.id}><FileCode2/><span>{w.name}<small>{w.branch || 'local'}</small></span></div>)}</aside>
      <div className="room-content">
        {tab === 'chat' && <Chat messages={messages} runs={runs} live={live} agents={team} onInspect={setSelectedAgent}/>} 
        {tab === 'workflow' && <WorkflowView change={change}/>} 
        {tab === 'artifacts' && <ArtifactView change={change}/>} 
        {tab === 'chat' && <div className="composer"><div className="composer-top"><select value={target} onChange={e => setTarget(e.target.value)}><option value="">@Leader（默认）</option>{team.map(a => <option value={a.id} key={a.id}>@{a.name}</option>)}</select><span>发送会启动真实 CLI Run</span></div><textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send() }} placeholder="输入目标、约束或纠偏指令。可直接 @Agent；⌘/Ctrl + Enter 发送。"/><div className="composer-foot"><span>/status 查看状态 · /plan 重新规划</span><button className="send" disabled={sending || !text.trim()} onClick={() => void send()}>{sending ? <LoaderCircle className="spin"/> : <Send/>}</button></div></div>}
      </div>
      {inspector && <AgentInspector agent={inspector} runs={runs.filter(r => r.agentId === inspector.id)} live={live} onClose={() => setSelectedAgent(null)}/>} 
    </div>
  </section>
}

function Chat({ messages, runs, live, agents, onInspect }: { messages: ReturnType<typeof useAppStore.getState>['snapshot']['messages']; runs: Run[]; live: Record<string, string>; agents: Agent[]; onInspect(id: string): void }): import('react').JSX.Element {
  const activeRuns = runs.filter(r => ['QUEUED', 'STARTING', 'RUNNING'].includes(r.status))
  return <div className="chat-scroll">
    {activeRuns.map(run => { const agent = agents.find(a => a.id === run.agentId); return <button className="running-card" key={run.id} onClick={() => onInspect(run.agentId)}><span className="agent-avatar running">{agent?.icon}</span><div><strong>{agent?.name} 正在工作</strong><p>{run.runtime} · {run.workspacePath}</p><code>{(live[run.id] || '正在启动 Runtime…').slice(-180)}</code></div><div><LoaderCircle className="spin"/><small>查看执行过程</small></div></button> })}
    {messages.map(message => { const run = message.runId ? runs.find(r => r.id === message.runId) : undefined; return <article className={`message ${message.senderType}`} key={message.id}><span className="message-avatar">{message.senderType === 'human' ? 'Y' : message.senderType === 'system' ? 'S' : agents.find(a => a.id === message.senderId)?.icon || 'L'}</span><div><header><strong>{message.senderName}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{run && <span className={`status ${run.status.toLowerCase()}`}>{run.runtime} · {run.status}</span>}</header><div className="markdown"><ReactMarkdown>{message.content}</ReactMarkdown></div>{run && <button className="evidence-link" onClick={() => onInspect(run.agentId)}><ShieldCheck/>{run.evidence.length} 项 Evidence · Exit {run.exitCode ?? '—'} · 打开 Session <ChevronRight/></button>}</div></article> })}
  </div>
}

function AgentInspector({ agent, runs, live, onClose }: { agent: Agent; runs: Run[]; live: Record<string, string>; onClose(): void }): import('react').JSX.Element {
  const { notify } = useAppStore()
  const [selected, setSelected] = useState(runs[0]?.id)
  const run = runs.find(r => r.id === selected) || runs[0]
  async function control(action: 'pause' | 'resume' | 'stop' | 'retry'): Promise<void> { if (!run) return; try { await window.moxt.controlRun(run.id, action); notify('success', `已执行 ${action}`) } catch (error) { notify('error', errorText(error)) } }
  return <aside className="inspector"><header><div className="agent-avatar">{agent.icon}</div><div><h2>{agent.name}</h2><p>{agent.runtime} · {agent.status}</p></div><button onClick={onClose}><X/></button></header><div className="inspector-actions"><button onClick={() => void control('pause')} disabled={!run || run.status !== 'RUNNING'}><Pause/>暂停</button><button onClick={() => void control('stop')} disabled={!run || !['RUNNING','STARTING','QUEUED'].includes(run.status)}><CircleStop/>终止</button><button onClick={() => void control('retry')} disabled={!run}><RefreshCw/>重试</button></div><div className="session-layout"><div className="session-list"><h4>Session / Run</h4>{runs.map(item => <button className={item.id === run?.id ? 'active' : ''} onClick={() => setSelected(item.id)} key={item.id}><span>{item.id.slice(0, 8)}</span><small>{item.status} · {item.startedAt ? new Date(item.startedAt).toLocaleString() : '排队中'}</small></button>)}</div>{run ? <div className="run-detail"><div className="run-meta"><span><Clock3/> {run.status}</span><span><Terminal/> {run.executable}</span></div><h4>实时 Transcript</h4><pre>{(live[run.id] || run.stdout || run.stderr || '暂无输出').slice(-12000)}</pre><h4>Evidence</h4><div className="evidence-list">{run.evidence.map(item => <div key={item.id}><span className={`evidence-status ${item.status.toLowerCase()}`}>{item.status}</span><strong>{item.title}</strong><p>{item.detail.slice(0, 600)}</p></div>)}</div></div> : <div className="empty"><Terminal/><h3>尚无 Run</h3><p>在 Team Chat 中给这个 Agent 发送任务。</p></div>}</div></aside>
}

function WorkflowView({ change }: { change: Change }): import('react').JSX.Element {
  const { snapshot, notify } = useAppStore()
  const phases = phasesFor(change.workflowType, change.currentPhase)
  const current = phases[change.currentPhase]
  const active = snapshot.runs.filter(r => r.changeId === change.id && r.status === 'RUNNING')
  async function advance(): Promise<void> { try { await window.moxt.advanceWorkflow(change.id); notify('success', 'Workflow 已进入下一阶段') } catch (error) { notify('error', errorText(error)) } }
  return <div className="workflow-view"><div className="phase-list">{phases.map((phase, i) => <div className={phase.status.toLowerCase()} key={phase.id}><i>{phase.status === 'DONE' ? <Check/> : i + 1}</i><div><strong>{phase.name}</strong><p>{phase.goal}</p></div><span>{phase.status}</span></div>)}</div><div className="phase-detail"><span className="chip">当前阶段</span><h2>{current.name}</h2><p>{current.goal}</p><h4>交付物</h4><div className="deliverable"><FileText/>{current.deliverable}</div><h4>Exit Criteria</h4>{current.exitCriteria.map((item, i) => <label key={item}><input type="checkbox" readOnly checked={i === 0 && Boolean(snapshot.artifacts.find(a => a.changeId === change.id))}/>{item}</label>)}<h4>Human Mode</h4><span className="human-mode">{current.humanMode}</span><h4>Active Runs</h4><p>{active.length ? `${active.length} 个 Agent 正在执行` : '当前没有运行中的 Agent'}</p><button className="primary" onClick={() => void advance()}>推进到下一阶段<ArrowRight/></button></div></div>
}

function ArtifactView({ change }: { change: Change }): import('react').JSX.Element {
  const { snapshot, notify } = useAppStore()
  const artifacts = snapshot.artifacts.filter(a => a.changeId === change.id)
  const [selected, setSelected] = useState(artifacts[0]?.id)
  const artifact = artifacts.find(a => a.id === selected) || artifacts[0]
  async function approve(value: boolean): Promise<void> { if (!artifact) return; try { await window.moxt.approveArtifact(artifact.id, value); notify('success', value ? 'Artifact 已批准并成为 Current Truth' : 'Artifact 已退回修改') } catch (error) { notify('error', errorText(error)) } }
  return <div className="artifact-view"><div className="artifact-list"><h3>方案与交付物</h3>{artifacts.map(item => <button className={item.id === artifact?.id ? 'active' : ''} onClick={() => setSelected(item.id)} key={item.id}><FileText/><div><strong>{item.title}</strong><small>v{item.version} · {item.status}</small></div></button>)}</div>{artifact ? <article><header><div><span className={`status ${artifact.status.toLowerCase()}`}>{artifact.status}</span><h2>{artifact.title} · v{artifact.version}</h2></div><div><button className="secondary" onClick={() => void approve(false)}>退回修改</button><button className="primary" onClick={() => void approve(true)} disabled={artifact.status === 'APPROVED'}><Check/>批准</button></div></header><div className="markdown"><ReactMarkdown>{artifact.content}</ReactMarkdown></div></article> : <div className="empty"><FileText/><h3>暂无 Artifact</h3><p>Agent 产出 Proposal、Contract 或 Report 后会自动进入这里，等待版本化评审。</p></div>}</div>
}
