import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceManager } from "../src/runtime/workspace-manager";
import type {
  AgentWorkspaceBinding,
  Change,
  Workspace,
  Workstream,
} from "../src/shared/contracts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("workspace permission and worktree isolation", () => {
  it("creates an isolated branch/worktree for a write binding", async () => {
    const root = mkdtempSync(join(tmpdir(), "moxt-worktree-"));
    roots.push(root);
    const repo = join(root, "repo");
    const data = join(root, "data");
    execFileSync("git", ["init", "-b", "main", repo]);
    execFileSync("git", [
      "-C",
      repo,
      "config",
      "user.email",
      "test@moxt.local",
    ]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Moxt Test"]);
    writeFileSync(join(repo, "README.md"), "base");
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync("git", ["-C", repo, "commit", "-m", "base"]);
    const baseCommit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const change = {
      id: "change-1",
      number: 1024,
      title: "x",
      description: "x",
      workflowType: "cross-project",
      priority: "P1",
      dueDate: null,
      status: "RUNNING",
      currentPhase: 3,
      workspaceIds: ["ws"],
      agentIds: ["agent"],
      tags: [],
      createdAt: "",
      updatedAt: "",
    } satisfies Change;
    const workspace = {
      id: "ws",
      name: "repo",
      path: repo,
      repoRoot: repo,
      branch: "main",
      baseCommit,
      createdAt: "",
    } satisfies Workspace;
    const binding = {
      id: "bind",
      changeId: change.id,
      agentId: "agent",
      workspaceId: workspace.id,
      permissions: {
        read: true,
        write: true,
        shell: true,
        git: true,
        network: true,
      },
      createdAt: "",
    } satisfies AgentWorkspaceBinding;
    const workstream = {
      id: "stream",
      changeId: change.id,
      workspaceId: workspace.id,
      agentId: "agent",
      name: "stream",
      status: "READY",
      worktreePath: null,
      branch: null,
      baseCommit,
      createdAt: "",
      updatedAt: "",
    } satisfies Workstream;
    const prepared = await new WorkspaceManager(data).prepare(
      change,
      workspace,
      binding,
      workstream,
    );
    expect(prepared.cwd).not.toBe(repo);
    expect(existsSync(join(prepared.cwd, ".git"))).toBe(true);
    expect(prepared.branch).toContain("moxt/1024/agent");
  });
});
