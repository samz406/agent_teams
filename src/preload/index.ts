import { contextBridge, ipcRenderer } from 'electron'
import type { CreateAgentInput, CreateChangeInput, DesktopApi, RuntimeEvent } from '../shared/contracts'

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke('app:snapshot'),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  createChange: (input: CreateChangeInput) => ipcRenderer.invoke('change:create', input),
  createAgent: (input: CreateAgentInput) => ipcRenderer.invoke('agent:create', input),
  sendMessage: (changeId: string, content: string, targetAgentId?: string) => ipcRenderer.invoke('message:send', changeId, content, targetAgentId),
  controlRun: (runId, action, reason) => ipcRenderer.invoke('run:control', runId, action, reason),
  advanceWorkflow: changeId => ipcRenderer.invoke('workflow:advance', changeId),
  approveArtifact: (artifactId, approve, feedback) => ipcRenderer.invoke('artifact:approve', artifactId, approve, feedback),
  detectRuntimes: () => ipcRenderer.invoke('runtime:detect'),
  onRuntimeEvent: listener => {
    const handler = (_event: Electron.IpcRendererEvent, payload: RuntimeEvent): void => listener(payload)
    ipcRenderer.on('runtime:event', handler)
    return () => ipcRenderer.removeListener('runtime:event', handler)
  }
}

contextBridge.exposeInMainWorld('moxt', api)
