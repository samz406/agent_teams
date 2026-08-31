import { useState } from 'react'
import { CheckCircle2, CircleOff, LoaderCircle, RefreshCw, Settings2, Terminal } from 'lucide-react'
import { errorText, useAppStore } from '../store'

export default function RuntimeSettings(): import('react').JSX.Element {
  const { snapshot, notify } = useAppStore()
  const [detecting, setDetecting] = useState(false)
  async function detect(): Promise<void> { setDetecting(true); try { await window.moxt.detectRuntimes(); notify('success', '运行时检测完成') } catch (error) { notify('error', errorText(error)) } finally { setDetecting(false) } }
  return <section className="page settings-page"><header className="page-header"><div><h1>运行时设置</h1><p>使用本机已有 CLI 登录态；Moxt 不复制或保存 API Key。</p></div><button className="primary" onClick={() => void detect()}>{detecting ? <LoaderCircle className="spin"/> : <RefreshCw/>}重新检测</button></header><div className="settings-layout"><aside><button><Settings2/>通用</button><button className="active"><Terminal/>运行时</button><button><CheckCircle2/>安全</button></aside><div className="runtime-list">{snapshot.runtimes.map(runtime => <div key={runtime.type}><span className={`runtime-icon ${runtime.available ? 'ok' : ''}`}><Terminal/></span><div><h3>{runtime.label} <b>{runtime.type === 'custom' ? '可配置' : 'Local'}</b></h3><p>路径：{runtime.path || (runtime.type === 'custom' ? '在 Agent 中配置' : '未检测到')}</p><small>{runtime.version || runtime.capabilities.join(' · ')}</small></div><span className={`runtime-state ${runtime.available ? 'available' : ''}`}>{runtime.available ? <><CheckCircle2/>可用</> : <><CircleOff/>未安装</>}</span></div>)}</div></div><div className="security-banner"><CheckCircle2/><div><strong>安全边界已启用</strong><p>Renderer 无 Node 权限；所有文件、Shell、Git 和 Runtime 操作均经过受控 IPC 与本地 Runtime。</p></div></div></section>
}
