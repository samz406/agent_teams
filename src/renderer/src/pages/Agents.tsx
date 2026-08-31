import { useState } from 'react'
import { Bot, Edit3, Plus, ShieldCheck, X } from 'lucide-react'
import type { Agent, RuntimeType } from '../../../shared/contracts'
import { errorText, useAppStore } from '../store'

type AgentForm = { name: string; description: string; responsibility: string; runtime: RuntimeType; command: string; quality: string; read: boolean; write: boolean; shell: boolean; git: boolean; network: boolean }
const blankForm = (): AgentForm => ({ name: '', description: '', responsibility: '', runtime: 'claude', command: '', quality: '', read: true, write: true, shell: true, git: true, network: true })

export default function Agents(): import('react').JSX.Element {
  const { snapshot, notify } = useAppStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [form, setForm] = useState<AgentForm>(blankForm())

  function createNew(): void { setEditing(null); setForm(blankForm()); setOpen(true) }
  function edit(agent: Agent): void {
    setEditing(agent)
    setForm({ name: agent.name, description: agent.description, responsibility: agent.responsibility, runtime: agent.runtime, command: agent.command || '', quality: agent.qualityBar.join('\n'), read: agent.permissions.read, write: agent.permissions.write, shell: agent.permissions.shell, git: agent.permissions.git, network: agent.permissions.network })
    setOpen(true)
  }
  async function save(): Promise<void> {
    const payload = { name: form.name.trim(), icon: (form.name.trim() || editing?.name || 'A').slice(0, 1).toUpperCase(), description: form.description.trim(), responsibility: form.responsibility.trim(), qualityBar: form.quality.split('\n').map(item => item.trim()).filter(Boolean), runtime: form.runtime, command: form.command.trim() || null, argsTemplate: editing?.argsTemplate ?? null, workspaceIds: editing?.workspaceIds ?? [], permissions: { read: form.read, write: form.write, shell: form.shell, git: form.git, network: form.network } }
    try {
      if (editing) await window.moxt.updateAgent({ id: editing.id, ...payload })
      else await window.moxt.createAgent(payload)
      setOpen(false)
      notify('success', editing ? 'Agent 配置已更新，下一个 Run 开始生效' : 'Agent 已加入 Agent Pool')
    } catch (error) { notify('error', errorText(error)) }
  }

  return <section className="page"><header className="page-header"><div><h1>Agent 团队</h1><p>Agent 是长期责任角色；可随时调整角色、Runtime、质量标准与默认权限。</p></div><button className="primary" onClick={createNew}><Plus/>新建 Agent</button></header><div className="agent-table editable-agent-table"><div className="table-head"><span>Agent</span><span>责任</span><span>Runtime</span><span>权限</span><span>状态</span><span>操作</span></div>{snapshot.agents.map(agent => <div className="table-row agent-row" key={agent.id}><span><i className="agent-avatar">{agent.icon}</i><b>{agent.name}<small>{agent.description}</small></b></span><span>{agent.responsibility}</span><span>{agent.runtime}</span><span>{Object.entries(agent.permissions).filter(([,v]) => v).map(([k]) => k).join(' · ')}</span><span><b className={`status ${agent.status.toLowerCase()}`}>{agent.status}</b></span><span><button className="table-action" onClick={() => edit(agent)}><Edit3/>编辑</button></span></div>)}</div>{open && <div className="modal-backdrop"><div className="modal"><header><div><h2>{editing ? `编辑 ${editing.name}` : '创建自定义 Agent'}</h2><p>{editing ? '修改长期角色配置；正在运行的 Run 不受影响，新配置从后续 Run 生效。' : '先定义责任和质量标准，再选择 Runtime。'}</p></div><button onClick={() => setOpen(false)}><X/></button></header><div className="form-grid"><label>名称<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label>Runtime<select value={form.runtime} onChange={e => setForm({ ...form, runtime: e.target.value as RuntimeType })}>{snapshot.runtimes.map(r => <option value={r.type} key={r.type}>{r.label} {r.available ? '✓' : '—'}</option>)}</select></label><label className="full">角色描述<input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label><label className="full">责任边界<textarea value={form.responsibility} onChange={e => setForm({ ...form, responsibility: e.target.value })}/></label><label className="full">质量标准（每行一条）<textarea value={form.quality} onChange={e => setForm({ ...form, quality: e.target.value })}/></label><label className="full">自定义可执行路径（可选）<input value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} placeholder="留空使用检测到的 Runtime 路径"/></label><div className="permission-options full"><label><input type="checkbox" checked={form.read} onChange={e => setForm({ ...form, read: e.target.checked })}/>Read</label><label><input type="checkbox" checked={form.write} onChange={e => setForm({ ...form, write: e.target.checked })}/>Write</label><label><input type="checkbox" checked={form.shell} onChange={e => setForm({ ...form, shell: e.target.checked })}/>Shell</label><label><input type="checkbox" checked={form.git} onChange={e => setForm({ ...form, git: e.target.checked })}/>Git</label><label><input type="checkbox" checked={form.network} onChange={e => setForm({ ...form, network: e.target.checked })}/>Network</label></div></div><div className="permission-note"><ShieldCheck/>这里是 Agent 默认权限；创建任务时仍会通过 Agent-Workspace Binding 做最终硬校验，不会因为编辑 Agent 自动放宽已有任务权限。</div><footer><button className="secondary" onClick={() => setOpen(false)}>取消</button><button className="primary" disabled={!form.name.trim() || !form.responsibility.trim()} onClick={() => void save()}><Bot/>{editing ? '保存修改' : '创建 Agent'}</button></footer></div></div>}</section>
}
