import { useMemo, useState } from 'react'
import { ArrowRight, Bot, Brain, CheckCircle2, Lightbulb, LoaderCircle, MessageCircleMore, Plus, Scale, Stethoscope, Users, X } from 'lucide-react'
import type { ConversationMode, CreateConversationInput } from '../../../shared/contracts'
import { errorText, useAppStore } from '../store'

const modes: Array<{ id: ConversationMode; name: string; description: string; icon: import('react').JSX.Element }> = [
  { id: 'roundtable', name: '圆桌讨论', description: '多视角分析、交叉回应并逐步形成判断', icon: <Users/> },
  { id: 'brainstorm', name: '头脑风暴', description: '先发散灵感，再组合和筛选想法', icon: <Lightbulb/> },
  { id: 'debate', name: '正反辩论', description: '暴露假设、反例、代价与二阶影响', icon: <Scale/> },
  { id: 'consultation', name: '专家会诊', description: '提出假设、依据、风险和行动建议', icon: <Stethoscope/> }
]

export default function Discussions({ onOpen }: { onOpen(id: string): void }): import('react').JSX.Element {
  const { snapshot, notify } = useAppStore()
  const [creating, setCreating] = useState(false)
  return <section className="page discussions-page">
    <header className="page-header"><div><h1>主题讨论</h1><p>让多个角色围绕一个问题产生认知碰撞，并将结论沉淀为文档或正式任务。</p></div><button className="primary" onClick={() => setCreating(true)}><Plus/>新建讨论</button></header>
    <div className="discussion-stats"><div><MessageCircleMore/><span><strong>{snapshot.conversations.length}</strong>全部讨论</span></div><div><Brain/><span><strong>{snapshot.conversations.filter(item => item.status === 'RUNNING').length}</strong>正在讨论</span></div><div><CheckCircle2/><span><strong>{snapshot.conversationDeliverables.length}</strong>已沉淀产物</span></div></div>
    <div className="discussion-grid">{snapshot.conversations.map(item => { const participants = snapshot.conversationParticipants.filter(p => p.conversationId === item.id); const mode = modes.find(mode => mode.id === item.mode)!; return <button className="discussion-card" onClick={() => onOpen(item.id)} key={item.id}><header><span className={`conversation-status ${item.status.toLowerCase()}`}>{item.status}</span><small>讨论 #{item.number}</small></header><div className="discussion-mode">{mode.icon}{mode.name}</div><h2>{item.title}</h2><p>{item.topic}</p><div className="participant-stack">{participants.map(participant => { const agent = snapshot.agents.find(agent => agent.id === participant.agentId); return <span title={`${participant.roleName}${participant.isLeader ? ' · Leader' : ''}`} key={participant.id}>{agent?.icon || 'A'}</span> })}<small>{participants.length} 个角色</small></div><footer><span>{item.currentRound}/{item.maxRounds} 轮</span><span>{item.messageCount}/{item.maxMessages} 消息</span><span>{item.tokenUsed.toLocaleString()}/{item.maxTokens.toLocaleString()} tokens</span><ArrowRight/></footer></button> })}{!snapshot.conversations.length && <div className="discussion-empty"><Brain/><h2>从一个值得讨论的问题开始</h2><p>例如：如何提升管理水平？网站设计怎样获得更有区分度的灵感？</p><button className="primary" onClick={() => setCreating(true)}><Plus/>创建第一次讨论</button></div>}</div>
    {creating && <NewConversation onClose={() => setCreating(false)} onCreated={id => { setCreating(false); onOpen(id) }} notify={notify}/>} 
  </section>
}

function NewConversation({ onClose, onCreated, notify }: { onClose(): void; onCreated(id: string): void; notify(type: 'success' | 'error', text: string): void }): import('react').JSX.Element {
  const agents = useAppStore(state => state.snapshot.agents)
  const defaults = agents.slice(0, Math.min(4, agents.length)).map((agent, index) => ({ agentId: agent.id, roleName: agent.name, rolePrompt: defaultRolePrompt(agent.name), isLeader: index === 0 }))
  const [form, setForm] = useState<Omit<CreateConversationInput, 'participants'>>({ title: '', topic: '', background: '', mode: 'roundtable', maxRounds: 3, maxMessages: 16, maxTokens: 50000 })
  const [participants, setParticipants] = useState(defaults)
  const [saving, setSaving] = useState(false)
  const valid = useMemo(() => form.title.trim() && form.topic.trim() && participants.length >= 2 && participants.length <= 6 && participants.filter(item => item.isLeader).length === 1, [form, participants])
  function toggle(agentId: string): void {
    if (participants.some(item => item.agentId === agentId)) { const next = participants.filter(item => item.agentId !== agentId); if (!next.some(item => item.isLeader) && next[0]) next[0] = { ...next[0], isLeader: true }; setParticipants(next); return }
    if (participants.length >= 6) return
    const agent = agents.find(item => item.id === agentId)!; setParticipants([...participants, { agentId, roleName: agent.name, rolePrompt: defaultRolePrompt(agent.name), isLeader: !participants.length }])
  }
  function patchParticipant(agentId: string, patch: Partial<(typeof participants)[number]>): void { setParticipants(items => items.map(item => item.agentId === agentId ? { ...item, ...patch } : patch.isLeader ? { ...item, isLeader: false } : item)) }
  async function create(): Promise<void> { if (!valid) return; setSaving(true); try { const value = await window.moxt.createConversation({ ...form, participants }); notify('success', '讨论已创建，可以开始第一轮'); onCreated(value.id) } catch (error) { notify('error', errorText(error)) } finally { setSaving(false) } }
  return <div className="modal-backdrop"><div className="discussion-modal"><header><div><h2>新建主题讨论</h2><p>定义问题、讨论协议与有差异的角色。</p></div><button className="icon-btn" onClick={onClose}><X/></button></header><div className="discussion-form"><label>讨论标题<input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="例如：我的管理能力提升路径"/></label><label>核心问题<textarea value={form.topic} onChange={event => setForm({ ...form, topic: event.target.value })} placeholder="把真正想解决的问题写清楚…"/></label><label>背景与约束<textarea value={form.background} onChange={event => setForm({ ...form, background: event.target.value })} placeholder="你的现状、已尝试方法、限制条件（可选）"/></label><div><span className="field-label">讨论模式</span><div className="mode-grid">{modes.map(mode => <button className={form.mode === mode.id ? 'selected' : ''} onClick={() => setForm({ ...form, mode: mode.id })} key={mode.id}>{mode.icon}<strong>{mode.name}</strong><small>{mode.description}</small></button>)}</div></div><div className="limit-grid"><label>最大轮数<input type="number" min="1" max="10" value={form.maxRounds} onChange={event => setForm({ ...form, maxRounds: Number(event.target.value) })}/></label><label>最大消息数<input type="number" min="4" max="100" value={form.maxMessages} onChange={event => setForm({ ...form, maxMessages: Number(event.target.value) })}/></label><label>Token 上限<input type="number" min="1000" step="1000" value={form.maxTokens} onChange={event => setForm({ ...form, maxTokens: Number(event.target.value) })}/></label></div><div><span className="field-label">选择 2～6 个角色</span><div className="discussion-agent-list">{agents.map(agent => { const participant = participants.find(item => item.agentId === agent.id); return <div className={participant ? 'selected' : ''} key={agent.id}><button onClick={() => toggle(agent.id)}><span className="agent-avatar">{agent.icon}</span><span><strong>{agent.name}</strong><small>{agent.runtime} · {agent.responsibility}</small></span>{participant && <CheckCircle2/>}</button>{participant && <div className="role-config"><label>本次角色<input value={participant.roleName} onChange={event => patchParticipant(agent.id, { roleName: event.target.value })}/></label><label>角色视角<input value={participant.rolePrompt} onChange={event => patchParticipant(agent.id, { rolePrompt: event.target.value })}/></label><label className="leader-radio"><input type="radio" checked={participant.isLeader} onChange={() => patchParticipant(agent.id, { isLeader: true })}/>Leader</label></div>}</div> })}</div></div></div><footer><span>{participants.length}/6 个角色 · Leader：{participants.find(item => item.isLeader)?.roleName || '未设置'}</span><div><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!valid || saving} onClick={() => void create()}>{saving ? <LoaderCircle className="spin"/> : <Bot/>}创建讨论</button></div></footer></div></div>
}

function defaultRolePrompt(name: string): string {
  if (/leader/i.test(name)) return '主持讨论，识别重复、共识、分歧和待确认问题，推动收敛。'
  if (/architect/i.test(name)) return '从结构、边界、长期演进与二阶影响分析问题。'
  if (/qa/i.test(name)) return '质疑隐含假设，寻找反例、风险和不可验证的结论。'
  return '从实践和落地视角给出具体判断、例子与行动建议。'
}
