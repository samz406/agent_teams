import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { inspectWorkspace } from './runtime/git'
import { RuntimeClient } from './runtime-client'
import type { AppSnapshot, CreateAgentInput, CreateChangeInput, IssueStatus, RuntimeEvent } from '../shared/contracts'

let window: BrowserWindow | null = null
let runtime: RuntimeClient
const publish = (event: RuntimeEvent): void => { const target = window; if (target && !target.isDestroyed()) target.webContents.send('runtime:event', event) }

function createWindow(): void {
  window = new BrowserWindow({ width: 1500, height: 940, minWidth: 1100, minHeight: 700, show: false, backgroundColor: '#f4f7fb', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  window.on('ready-to-show', () => window?.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (is.dev && process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('app:snapshot', () => runtime.request<AppSnapshot>({ type: 'snapshot.get' }))
  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory', 'createDirectory'], title: '选择本地项目 Workspace' })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]; const info = await inspectWorkspace(path)
    return runtime.request({ type: 'workspace.add', workspace: { path, ...info } })
  })
  ipcMain.handle('change:create', (_event, input: CreateChangeInput) => runtime.request({ type: 'change.create', input }))
  ipcMain.handle('agent:create', (_event, input: CreateAgentInput) => runtime.request({ type: 'agent.create', input }))
  ipcMain.handle('runtime:detect', () => runtime.request({ type: 'runtime.detect' }))
  ipcMain.handle('message:send', (_event, changeId: string, content: string, targetAgentId?: string) => runtime.request({ type: 'message.send', changeId, content, targetAgentId }))
  ipcMain.handle('run:control', (_event, runId: string, action: 'pause' | 'resume' | 'stop' | 'retry', reason?: string) => runtime.request({ type: 'run.control', runId, action, reason }))
  ipcMain.handle('artifact:approve', (_event, artifactId: string, approve: boolean, feedback?: string) => runtime.request({ type: 'artifact.approve', artifactId, approve, feedback }))
  ipcMain.handle('workflow:advance', (_event, changeId: string) => runtime.request({ type: 'workflow.advance', changeId }))
  ipcMain.handle('issue:update', (_event, issueId: string, status: IssueStatus, resolution?: string) => runtime.request({ type: 'issue.update', issueId, status, resolution }))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('ai.moxt.runtime')
  app.on('browser-window-created', (_, createdWindow) => optimizer.watchWindowShortcuts(createdWindow))
  runtime = new RuntimeClient(app.getPath('userData'), publish)
  registerIpc(); createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => runtime?.close())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
