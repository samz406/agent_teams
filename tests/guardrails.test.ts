import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDatabase } from "../src/main/database";
import { LeaderEngine } from "../src/runtime/leader-engine";

const roots: string[] = [];
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "agent-teams-guardrails-"));
  roots.push(root);
  return new AppDatabase(join(root, "db.sqlite"));
};

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("guardrails", () => {
  it("does not accept runs when required evidence is missing", () => {
    const db = setup();
    const changed = () => undefined;
    const leader = new LeaderEngine(db, changed);
    const state = db.snapshot([]);
    const agent = state.agents.find((item) => item.name === "Code Agent")!;
    const room = db.createRoom({
      name: "r",
      goal: "g",
      kind: "PROJECT",
      agentIds: [agent.id],
    });
    const workspace = db.addWorkspace({
      name: "ws",
      path: "/tmp/ws",
      repoRoot: null,
      branch: null,
      baseCommit: null,
      backend: "ephemeral-local",
    });
    const change = db.createChange({
      roomId: room.id,
      title: "Fix bug",
      description: "Fix it",
      workflowType: "bug-fix",
      priority: "P1",
      dueDate: null,
      workspaceIds: [workspace.id],
      agentIds: [agent.id],
      agentBindings: [
        {
          agentId: agent.id,
          workspaceId: workspace.id,
          permissions: agent.permissions,
        },
      ],
      tags: [],
    });
    db.updateChangeState(change.id, "RUNNING", 2);
    const current = db.getChange(change.id)!;
    const task = leader.createTask(current, agent, "do work");
    db.createRun({
      id: "run-1",
      changeId: change.id,
      workOrderId: null,
      agentId: agent.id,
      taskId: task.id,
      agentSessionId: null,
      parentRunId: null,
      status: "COMPLETED",
      prompt: "x",
      runtime: agent.runtime,
      executable: "echo",
      workspacePath: "/tmp",
      startedAt: null,
      endedAt: null,
      exitCode: 0,
      sessionId: null,
      stdout: "",
      stderr: "",
      finalResponse: "done",
      baseCommit: null,
      retryReason: null,
      evidence: [],
    });
    db.addEvidence("run-1", {
      type: "RUNTIME",
      title: "ok",
      status: "PASS",
      detail: "",
    });
    const result = leader.onRunFinished(db.getRun("run-1")!);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("缺少");
  });

  it("enforces source validation and audit path for memory promotion", () => {
    const db = setup();
    const agent = db.snapshot([]).agents[0];
    const memory = db.createMemory({
      agentId: agent.id,
      scope: "EPISODE",
      scopeId: "episode-x",
      kind: "FACT",
      title: "fact",
      content: "content",
      tags: [],
      confidence: 0.7,
      sourceType: "RUN",
      sourceId: "missing-run",
      supersedesId: null,
      expiresAt: null,
      provenance: "TRUSTED",
    });
    expect(() => db.decideMemory(memory.id, "APPROVE")).toThrow("来源 Run 不存在");
  });

  it("deduplicates delegation jobs and connector invocations by idempotency keys", () => {
    const db = setup();
    const jobA = db.createDelegationJob({
      parentRunId: "run-parent",
      changeId: "change-x",
      fromAgentId: "a",
      toAgentId: "b",
      prompt: "do",
      promptHash: "hash",
    });
    const jobB = db.createDelegationJob({
      parentRunId: "run-parent",
      changeId: "change-x",
      fromAgentId: "a",
      toAgentId: "b",
      prompt: "do",
      promptHash: "hash",
    });
    expect(jobB.id).toBe(jobA.id);
    const invA = db.recordConnectorInvocation({
      connectorId: "knowledge.search",
      roomId: "room-x",
      agentId: null,
      action: "search",
      payload: { q: "x" },
      status: "ALLOWED",
      reason: null,
      idempotencyKey: "same-key",
    });
    const invB = db.recordConnectorInvocation({
      connectorId: "knowledge.search",
      roomId: "room-x",
      agentId: null,
      action: "search",
      payload: { q: "x" },
      status: "ALLOWED",
      reason: null,
      idempotencyKey: "same-key",
    });
    expect(invB.id).toBe(invA.id);
  });
});
