import { useEffect, useMemo, useState } from 'react'
import { Activity, Bot, Boxes, FileText, FolderGit2, GitPullRequest, History, LayoutDashboard, LoaderCircle, MessageSquareText, Plus, Settings, Workflow } from 'lucide-react'
import { useAppStore } from './store'
import Dashboard from './pages/Dashboard'
import NewTask from './pages/NewTask'
import TaskRoom from './pages/TaskRoom'
import Agents from './pages/Agents'
import RuntimeSettings from './pages/RuntimeSettings'

type Route = { page: 'dashboard' | 'new' | 'task' | 'agents' | 'settings' | 'workflows' | 'history'; id?: string }

export default function App(): import('react').JSX.Element {
  const { ready, load, apply, snapshot, notice } = useAppStore()
  const [route, setRoute] = useState<Route>({ page: 'dashboard' })
  useEffect(() => { void load(); return window.moxt.onRuntimeEvent(apply) }, [load, apply])
  const active = useMemo(() => route.page === 'task' ? snapshot.changes.find(change => change.id === route.id) : undefined, [route, snapshot])
  if (!ready) return <div className="boot"><div className="brand-mark">M</div><LoaderCircle className="spin"/><span>正在恢复 Team Runtime…</span></div>
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="logo"><div className="brand-mark">M</div><div><strong>Moxt</strong><span>AI Team Runtime</span></div></div>
      <nav>
        <Nav icon={<LayoutDashboard/>} label="工作台" active={route.page === 'dashboard'} onClick={() => setRoute({ page: 'dashboard' })}/>
        <Nav icon={<Plus/>} label="新建任务" active={route.page === 'new'} onClick={() => setRoute({ page: 'new' })}/>
        <Nav icon={<Boxes/>} label="任务看板" active={route.page === 'task'} onClick={() => snapshot.changes[0] && setRoute({ page: 'task', id: snapshot.changes[0].id })} badge={snapshot.changes.filter(c => c.status === 'RUNNING').length}/>
        <Nav icon={<MessageSquareText/>} label="会话历史" active={route.page === 'history'} onClick={() => setRoute({ page: 'history' })}/>
        <Nav icon={<Workflow/>} label="工作流模板" active={route.page === 'workflows'} onClick={() => setRoute({ page: 'workflows' })}/>
        <Nav icon={<Bot/>} label="Agent 团队" active={route.page === 'agents'} onClick={() => setRoute({ page: 'agents' })}/>
        <Nav icon={<FolderGit2/>} label="项目空间" active={false} onClick={() => setRoute({ page: 'new' })}/>
        <Nav icon={<Settings/>} label="设置" active={route.page === 'settings'} onClick={() => setRoute({ page: 'settings' })}/>
      </nav>
      <div className="sidebar-foot"><span className="avatar">M</span><div><strong>Max</strong><span className="online">● 在线</span></div></div>
    </aside>
    <main className="main">
      {route.page === 'dashboard' && <Dashboard onNew={() => setRoute({ page: 'new' })} onOpen={id => setRoute({ page: 'task', id })}/>} 
      {route.page === 'new' && <NewTask onCreated={id => setRoute({ page: 'task', id })}/>} 
      {route.page === 'task' && active && <TaskRoom change={active}/>} 
      {route.page === 'agents' && <Agents/>}
      {route.page === 'settings' && <RuntimeSettings/>}
      {route.page === 'workflows' && <SimpleList title="工作流模板" subtitle="五种责任流模板是护栏，不是固定 DAG。Leader 可以在规则内动态选人、并行、返工和升级。" icon={<GitPullRequest/>} items={['跨项目协同开发', '线上问题会诊', 'Bug 修复与独立验证', '大型受控重构', '发布前检查']}/>} 
      {route.page === 'history' && <SimpleList title="会话历史" subtitle="每条正式 Agent 回复都绑定真实 Session、Run 与 Evidence。" icon={<History/>} items={snapshot.changes.map(c => `#${c.number} · ${c.title} · ${snapshot.messages.filter(m => m.changeId === c.id).length} 条消息`)}/>} 
    </main>
    {notice && <div className={`toast ${notice.type}`}>{notice.text}</div>}
  </div>
}

function Nav({ icon, label, active, onClick, badge }: { icon: import('react').JSX.Element; label: string; active: boolean; onClick(): void; badge?: number }): import('react').JSX.Element {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{Boolean(badge) && <em>{badge}</em>}</button>
}

function SimpleList({ title, subtitle, icon, items }: { title: string; subtitle: string; icon: import('react').JSX.Element; items: string[] }): import('react').JSX.Element {
  return <section className="page"><header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div></header><div className="list-card">{items.length ? items.map((item, i) => <div className="large-row" key={item}>{icon}<span>{item}</span><small>查看详情</small></div>) : <div className="empty"><FileText/><h3>暂无记录</h3></div>}</div></section>
}
