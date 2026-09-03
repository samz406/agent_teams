import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Bot, Brain, CheckCircle2, Compass, Lightbulb, LoaderCircle, MessageCircleMore, Palette, Plus, Scale, Stethoscope, Users, X } from 'lucide-react'
import type { ConversationMode, CreateConversationInput } from '../../../shared/contracts'
import { buildConversationParticipants } from '../../../shared/conversation-templates'
import { errorText, useAppStore } from '../store'

const modes: Array<{ id: ConversationMode; name: string; description: string; icon: import('react').JSX.Element }> = [
  { id: 'roundtable', name: '圆桌讨论', description: '多视角分析、交叉回应并逐步形成判断', icon: <Users/> },
  { id: 'brainstorm', name: '头脑风暴', description: '先发散灵感，再组合和筛选想法', icon: <Lightbulb/> },
  { id: 'debate', name: '正反辩论', description: '暴露假设、反例、代价与二阶影响', icon: <Scale/> },
  { id: 'consultation', name: '专家会诊', description: '提出假设、依据、风险和行动建议', icon: <Stethoscope/> },
  { id: 'retreat', name: '务虚会', description: '反思长期变化，形成战略议题与待验证假设', icon: <Compass/> },
  { id: 'six-hats', name: '六顶思考帽', description: '用事实、直觉、风险、价值与创意完整审视问题', icon: <Palette/> }
]

export default function Discussions({ onOpen, createRequest }: { onOpen(id: string): void; createRequest?: number }): import('react').JSX.Element {
  const { snapshot, notify } = useAppStore()
  const [creating, setCreating] = useState(false)
  useEffect(() => { if (createRequest) setCreating(true) }, [createRequest])
  return <section className="page discussions-page">
    <header className="page-header"><div><h1>多人聊天</h1><p>让多个角色围绕一个问题产生认知碰撞，并将结论沉淀为文档或正式任务。</p></div><button className="primary" onClick={() => setCreating(true)}><Plus/>新建聊天</button></header>
    <div className="discussion-stats"><div><MessageCircleMore/><span><strong>{snapshot.conversations.length}</strong>全部聊天</span></div><div><Brain/><span><strong>{snapshot.conversations.filter(item => item.status === 'RUNNING').length}</strong>正在聊天</span></div><div><CheckCircle2/><span><strong>{snapshot.conversationDeliverables.length}</strong>已沉淀产物</span></div></div>
    <div className="discussion-grid">{snapshot.conversations.map(item => { const participants = snapshot.conversationParticipants.filter(p => p.conversationId === item.id); const mode = modes.find(mode => mode.id === item.mode)!; return <button className="discussion-card" onClick={() => onOpen(item.id)} key={item.id}><header><span className={`conversation-status ${item.status.toLowerCase()}`}>{conversationStatusName(item.status)}</span><small>聊天 #{item.number}</small></header><div className="discussion-mode">{mode.icon}{mode.name}</div><h2>{item.title}</h2><p>{item.topic}</p><div className="participant-stack">{participants.map(participant => { const agent = snapshot.agents.find(agent => agent.id === participant.agentId); return <span title={`${participant.roleName}${participant.isLeader ? ' · Leader' : ''}`} key={participant.id}>{agent?.icon || 'A'}</span> })}<small>{participants.length} 个角色</small></div><footer><span>{item.currentRound}/{item.maxRounds} 轮</span><span>{item.messageCount} 条消息</span><ArrowRight/></footer></button> })}{!snapshot.conversations.length && <div className="discussion-empty"><Brain/><h2>从一个值得讨论的问题开始</h2><p>例如：如何提升管理水平？网站设计怎样获得更有区分度的灵感？</p><button className="primary" onClick={() => setCreating(true)}><Plus/>创建第一次聊天</button></div>}</div>
    {creating && <NewConversation onClose={() => setCreating(false)} onCreated={id => { setCreating(false); onOpen(id) }} notify={notify}/>} 
  </section>
}

function NewConversation({ onClose, onCreated, notify }: { onClose(): void; onCreated(id: string): void; notify(type: 'success' | 'error', text: string): void }): import('react').JSX.Element {
  const agents = useAppStore(state => state.snapshot.agents)
  const [form, setForm] = useState<Omit<CreateConversationInput, 'participants'>>({ title: '', topic: '', background: '', mode: 'roundtable', maxRounds: 20 })
  const [participants, setParticipants] = useState(() => buildConversationParticipants('roundtable', agents))
  const [saving, setSaving] = useState(false)
  const valid = useMemo(() => form.title.trim() && form.topic.trim() && participants.length >= 2 && participants.length <= 6 && participants.filter(item => item.isLeader).length === 1, [form, participants])
  function selectMode(mode: ConversationMode): void {
    setForm(value => ({ ...value, mode }))
    setParticipants(buildConversationParticipants(mode, agents))
  }
  function patchParticipant(index: number, patch: Partial<(typeof participants)[number]>): void { setParticipants(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : patch.isLeader ? { ...item, isLeader: false } : item)) }
  async function create(): Promise<void> { if (!valid) return; setSaving(true); try { const value = await window.moxt.createConversation({ ...form, participants }); notify('success', '聊天已创建，可以开始第一轮'); onCreated(value.id) } catch (error) { notify('error', errorText(error)) } finally { setSaving(false) } }
  return <div className="modal-backdrop"><div className="discussion-modal"><header><div><h2>新建多人聊天</h2><p>定义问题和模式，系统会自动配置适合本次聊天的角色。</p></div><button className="icon-btn" onClick={onClose}><X/></button></header><div className="discussion-form"><label>聊天标题<input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="例如：我的管理能力提升路径"/></label><label>核心问题<textarea value={form.topic} onChange={event => setForm({ ...form, topic: event.target.value })} placeholder="把真正想解决的问题写清楚…"/></label><label>背景与约束<textarea value={form.background} onChange={event => setForm({ ...form, background: event.target.value })} placeholder="你的现状、已尝试方法、限制条件（可选）"/></label><div><span className="field-label">聊天模式</span><div className="mode-grid">{modes.map(mode => <button className={form.mode === mode.id ? 'selected' : ''} onClick={() => selectMode(mode.id)} key={mode.id}>{mode.icon}<strong>{mode.name}</strong><small>{mode.description}</small></button>)}</div></div><div className="round-limit"><label>最大轮数<input className="numeric-input" type="text" inputMode="numeric" value={form.maxRounds} onChange={event => setForm({ ...form, maxRounds: digits(event.target.value) })} onBlur={() => setForm(value => ({ ...value, maxRounds: clamp(value.maxRounds, 1, 50) }))}/><small>唯一的自动停止条件，建议 3～20，最高 50 轮</small></label></div><div><span className="field-label">模式角色模板</span><p className="role-template-note">已按“{modes.find(item => item.id === form.mode)?.name}”生成角色。每个角色拥有独立 Session；角色多于 Runtime Agent 时会复用执行配置，但不会共享会话记忆。</p>{participants.length >= 2 ? <div className="discussion-agent-list role-template-list">{participants.map((participant, index) => { const executor = agents.find(item => item.id === participant.agentId); return <div className="selected" key={`${participant.agentId}-${index}`}><div className="role-template-heading"><span className="agent-avatar">{roleIcon(participant.roleName)}</span><span><strong>{participant.roleName}</strong><small>{participant.isLeader ? '主持与收敛' : '独立讨论角色'} · 由 {executor?.runtime || '未配置'} Runtime 执行</small></span><CheckCircle2/></div><div className="role-config"><label>角色名称<input value={participant.roleName} onChange={event => patchParticipant(index, { roleName: event.target.value })}/></label><label>角色视角<input value={participant.rolePrompt} onChange={event => patchParticipant(index, { rolePrompt: event.target.value })}/></label><label className="leader-radio"><input type="radio" checked={participant.isLeader} onChange={() => patchParticipant(index, { isLeader: true })}/>Leader</label></div></div> })}</div> : <div className="role-template-warning">至少需要配置两个可用 Agent，才能创建多人聊天。</div>}</div></div><footer><span>{participants.length} 个模式角色 · Leader：{participants.find(item => item.isLeader)?.roleName || '未设置'}</span><div><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!valid || saving} onClick={() => void create()}>{saving ? <LoaderCircle className="spin"/> : <Bot/>}创建聊天</button></div></footer></div></div>
}

function digits(value: string): number { return Number(value.replace(/\D/g, '')) || 0 }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }
function roleIcon(name: string): string { return name.trim().slice(0, 1) || '角' }
function conversationStatusName(status: string): string { return ({ DRAFT: '待开始', RUNNING: '讨论中', PAUSED: '已暂停', READY_TO_SUMMARIZE: '待生成结果', COMPLETED: '已完成', FAILED: '运行失败' } as Record<string, string>)[status] ?? status }
