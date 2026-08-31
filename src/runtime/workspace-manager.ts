import { execFile } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AgentWorkspaceBinding, Change, Workspace, Workstream } from '../shared/contracts'

const exec = promisify(execFile)

export class WorkspaceManager {
  constructor(private dataDirectory: string) {}

  async prepare(change: Change, workspace: Workspace, binding: AgentWorkspaceBinding, workstream: Workstream): Promise<{ cwd: string; branch: string | null; baseCommit: string | null }> {
    const root = resolve(workspace.repoRoot || workspace.path)
    await stat(root)
    if (!binding.permissions.write) {
      if (workstream.worktreePath) { await stat(workstream.worktreePath); await this.assertInside(workstream.worktreePath, this.dataDirectory); return { cwd: workstream.worktreePath, branch: workstream.branch, baseCommit: workstream.baseCommit } }
      return { cwd: root, branch: workspace.branch, baseCommit: workspace.baseCommit }
    }
    if (!workspace.repoRoot || !workspace.baseCommit) throw new Error('具有 Write 权限的 Agent 必须使用 Git Workspace，非 Git 目录已拒绝执行')
    if (workstream.worktreePath) { await this.assertInside(workstream.worktreePath, this.dataDirectory); return { cwd: workstream.worktreePath, branch: workstream.branch, baseCommit: workstream.baseCommit } }
    const safeAgent = binding.agentId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12)
    const worktreePath = join(this.dataDirectory, 'worktrees', change.id, safeAgent)
    const branch = `moxt/${change.number}/${safeAgent}`
    await mkdir(join(this.dataDirectory, 'worktrees', change.id), { recursive: true })
    await this.assertInside(worktreePath, this.dataDirectory)
    try { await exec('git', ['-C', workspace.repoRoot, 'worktree', 'add', '-b', branch, worktreePath, workspace.baseCommit], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }) }
    catch (error) {
      try { await exec('git', ['-C', workspace.repoRoot, 'worktree', 'add', worktreePath, branch], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }) }
      catch {
        try { await stat(join(worktreePath, '.git')) }
        catch { throw new Error(`创建 Git Worktree 失败：${error instanceof Error ? error.message : String(error)}`) }
      }
    }
    return { cwd: worktreePath, branch, baseCommit: workspace.baseCommit }
  }

  private async assertInside(path: string, parent: string): Promise<void> {
    const target = resolve(path); const base = resolve(parent)
    if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('Worktree 路径越过 Runtime 数据边界')
  }
}
