import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  AgentWorkspaceBinding,
  Change,
  Workspace,
  Workstream,
} from "../shared/contracts";

const exec = promisify(execFile);

export interface PreparedWorkspace {
  cwd: string;
  branch: string | null;
  baseCommit: string | null;
}

export interface WorkspaceBackend {
  readonly id: Workspace["backend"];
  prepare(input: {
    change: Change;
    workspace: Workspace;
    binding: AgentWorkspaceBinding;
    workstream: Workstream;
    dataDirectory: string;
  }): Promise<PreparedWorkspace>;
}

class LocalGitBackend implements WorkspaceBackend {
  readonly id = "local-git" as const;

  async prepare(input: {
    change: Change;
    workspace: Workspace;
    binding: AgentWorkspaceBinding;
    workstream: Workstream;
    dataDirectory: string;
  }): Promise<PreparedWorkspace> {
    const { change, workspace, binding, workstream, dataDirectory } = input;
    const root = resolve(workspace.repoRoot || workspace.path);
    await stat(root);
    if (!binding.permissions.write) {
      if (workstream.worktreePath) {
        await stat(workstream.worktreePath);
        await assertInside(workstream.worktreePath, dataDirectory);
        return {
          cwd: workstream.worktreePath,
          branch: workstream.branch,
          baseCommit: workstream.baseCommit,
        };
      }
      return {
        cwd: root,
        branch: workspace.branch,
        baseCommit: workspace.baseCommit,
      };
    }
    if (!workspace.repoRoot || !workspace.baseCommit)
      throw new Error(
        "具有 Write 权限的 Agent 必须使用 Git Workspace，非 Git 目录已拒绝执行",
      );
    if (workstream.worktreePath) {
      await assertInside(workstream.worktreePath, dataDirectory);
      return {
        cwd: workstream.worktreePath,
        branch: workstream.branch,
        baseCommit: workstream.baseCommit,
      };
    }
    const safeAgent = binding.agentId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 12);
    const worktreePath = join(dataDirectory, "worktrees", change.id, safeAgent);
    const branch = `moxt/${change.number}/${safeAgent}`;
    await mkdir(join(dataDirectory, "worktrees", change.id), { recursive: true });
    await assertInside(worktreePath, dataDirectory);
    try {
      await exec(
        "git",
        [
          "-C",
          workspace.repoRoot,
          "worktree",
          "add",
          "-b",
          branch,
          worktreePath,
          workspace.baseCommit,
        ],
        { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
      );
    } catch (error) {
      try {
        await exec(
          "git",
          ["-C", workspace.repoRoot, "worktree", "add", worktreePath, branch],
          { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
        );
      } catch {
        try {
          await stat(join(worktreePath, ".git"));
        } catch {
          throw new Error(
            `创建 Git Worktree 失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    return { cwd: worktreePath, branch, baseCommit: workspace.baseCommit };
  }
}

class EphemeralLocalBackend implements WorkspaceBackend {
  readonly id = "ephemeral-local" as const;

  async prepare(input: {
    workspace: Workspace;
    binding: AgentWorkspaceBinding;
    workstream: Workstream;
    dataDirectory: string;
  }): Promise<PreparedWorkspace> {
    const { workspace, binding, workstream, dataDirectory } = input;
    const root = resolve(workspace.path);
    await stat(root);
    if (binding.permissions.write)
      throw new Error("ephemeral-local backend 不支持写入执行");
    if (workstream.worktreePath) {
      await stat(workstream.worktreePath);
      await assertInside(workstream.worktreePath, dataDirectory);
      return {
        cwd: workstream.worktreePath,
        branch: workstream.branch,
        baseCommit: workstream.baseCommit,
      };
    }
    const ephemeral = join(dataDirectory, "ephemeral", workstream.id);
    await mkdir(ephemeral, { recursive: true });
    return {
      cwd: root,
      branch: workspace.branch,
      baseCommit: workspace.baseCommit,
    };
  }
}

export class WorkspaceManager {
  private backends = new Map<Workspace["backend"], WorkspaceBackend>([
    ["local-git", new LocalGitBackend()],
    ["ephemeral-local", new EphemeralLocalBackend()],
  ]);

  constructor(private dataDirectory: string) {}

  async prepare(
    change: Change,
    workspace: Workspace,
    binding: AgentWorkspaceBinding,
    workstream: Workstream,
  ): Promise<PreparedWorkspace> {
    const backend = this.backends.get(workspace.backend ?? "local-git");
    if (!backend) throw new Error(`未支持的 workspace backend: ${workspace.backend}`);
    return backend.prepare({
      change,
      workspace,
      binding,
      workstream,
      dataDirectory: this.dataDirectory,
    });
  }
}

async function assertInside(path: string, parent: string): Promise<void> {
  const target = resolve(path);
  const base = resolve(parent);
  if (target !== base && !target.startsWith(`${base}${sep}`))
    throw new Error("Worktree 路径越过 Runtime 数据边界");
}
