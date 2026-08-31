import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { AppDatabase } from './database'
import { detectRuntimes } from './runtime/environment'
import { inspectWorkspace } from './runtime/git'
import { RunManager } from './runtime/run-manager'
import { canAdvance, WORKFLOWS } from '../shared/workflows'
import type { AppSnapshot, CreateAgentInput, CreateChangeInput, RuntimeEvent, RuntimeInfo } from '../shared/contracts'

let window: BrowserWindow | null = null
let database: AppDatabase
let runtimes: RuntimeInfo[] = []
let runManager: RunManager

function publish(event: RuntimeEvent): void {
  const targetWindow = window
  if (targetWindow && !targetWindow.isDestroyed()) targetWindow.webContents.send('runtime:event', event)
}

function snapshot(): AppSnapshot { return database.snapshot(runtimes) }
function changed(): void { publish({ type: 'snapshot.changed', snapshot: snapshot() }) }

function createWindow(): void {
  window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f7fb',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  window.on('ready-to-show', () => window?.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (is.dev && process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('app:snapshot', () => snapshot())
  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory', 'createDirectory'], title: '选择本地项目 Workspace' })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    const info = await inspectWorkspace(path)
    const workspace = database.addWorkspace({ path, ...info })
    changed()
    return workspace
  })
  ipcMain.handle('change:create', (_event, input: CreateChangeInput) => {
    if (!input.title.trim() || !input.description.trim()) throw new Error('任务标题和描述不能为空')
    if (!input.workspaceIds.length) throw new Error('至少选择一个 Workspace')
    if (!input.agentIds.length) throw new Error('至少选择一个 Agent')
    const value = database.createChange(input)
    changed()
    return value
  })
  ipcMain.handle('agent:create', (_event, input: CreateAgentInput) => { const value = database.createAgent(input); changed(); return value })
  ipcMain.handle('runtime:detect', async () => { runtimes = await detectRuntimes(); changed(); return runtimes })
  ipcMain.handle('message:send', async (_event, changeId: string, content: string, targetAgentId?: string) => {
    const change = database.getChange(changeId)
    if (!change) throw new Error('任务不存在')
    database.addMessage(changeId, 'human', null, 'You', content, null)
    const agents = snapshot().agents
    const normalized = content.toLowerCase()
    const target = targetAgentId ? database.getAgent(targetAgentId) : agents.find(agent => normalized.includes(`@${agent.name.toLowerCase().replaceAll(' ', '-')}`) || normalized.includes(`@${agent.name.toLowerCase()}`)) || agents.find(agent => agent.name === 'Leader') || agents.find(agent => change.agentIds.includes(agent.id))
    if (!target) throw new Error('没有可执行的 Agent，请先添加 Agent')
    if (!change.agentIds.includes(target.id)) throw new Error(`${target.name} 不在当前 Session Team 中`)
    const workspaceId = target.workspaceIds.find(id => change.workspaceIds.includes(id)) || change.workspaceIds[0]
    const workspace = database.getWorkspace(workspaceId)
    if (!workspace) throw new Error('Agent 没有可用 Workspace')
    changed()
    await runManager.start(changeId, target, workspace.path, content)
  })
  ipcMain.handle('run:control', (_event, runId: string, action: 'pause' | 'resume' | 'stop' | 'retry', reason?: string) => runManager.control(runId, action, reason))
  ipcMain.handle('artifact:approve', (_event, id: string, approve: boolean, feedback?: string) => { database.approveArtifact(id, approve, feedback); changed() })
  ipcMain.handle('workflow:advance', (_event, changeId: string) => {
    const change = database.getChange(changeId)
    if (!change) throw new Error('任务不存在')
    const phases = WORKFLOWS[change.workflowType]
    if (change.currentPhase >= phases.length - 1) throw new Error('Workflow 已经完成')
    const gate = canAdvance(change.workflowType, change.currentPhase, database.hasApprovedArtifact(changeId))
    if (!gate.ok) throw new Error(gate.reason)
    database.advanceChange(changeId)
    changed()
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('ai.moxt.runtime')
  app.on('browser-window-created', (_, createdWindow) => optimizer.watchWindowShortcuts(createdWindow))
  database = new AppDatabase(join(app.getPath('userData'), 'database', 'moxt.db'))
  runtimes = await detectRuntimes()
  runManager = new RunManager(database, () => runtimes, publish, changed)
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
