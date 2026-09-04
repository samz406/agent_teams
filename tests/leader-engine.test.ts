import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDatabase } from "../src/main/database";
import { LeaderEngine } from "../src/runtime/leader-engine";
import type { Run, WorkflowType } from "../src/shared/contracts";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function setup(workflowType: WorkflowType = "cross-project") {
  const directory = mkdtempSync(join(tmpdir(), "agent-teams-leader-"));
  paths.push(directory);
  const db = new AppDatabase(join(directory, "db.sqlite"));
  const initial = db.snapshot([]);
  const agent = initial.agents[0];
  const workspace = db.addWorkspace({
    name: "repo",
    path: directory,
    repoRoot: directory,
    branch: "main",
    baseCommit: "base",
  });
  const change = db.createChange({
    title: "Change",
    description: "Test evidence state machine",
    workflowType,
    priority: "P1",
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
  return { db, agent, change, leader: new LeaderEngine(db, () => undefined) };
}

describe("evidence-driven leader state machine", () => {
  it("accepts a discovery task with runtime evidence and advances an AUTO phase", () => {
    const { db, agent, change, leader } = setup();
    const task = leader.createTask(change, agent, "Inspect repository");
    const run = createRun(change.id, agent.id, task.id);
    db.createRun(run);
    db.updateRun(run.id, {
      status: "COMPLETED",
      exitCode: 0,
      finalResponse: "Discovery complete",
    });
    db.addEvidence(run.id, {
      type: "RUNTIME",
      title: "Runtime exit",
      status: "PASS",
      detail: "exit 0",
    });
    expect(leader.onRunFinished(db.getRun(run.id)!)).toEqual({
      accepted: true,
      reason: "Evidence 满足当前阶段要求",
    });
    expect(db.getTask(task.id)?.status).toBe("ACCEPTED");
    expect(db.getChange(change.id)?.currentPhase).toBe(1);
  });

  it("rejects coding completion without diff and test evidence, blocks the change, and creates a blocking issue", () => {
    const { db, agent, change, leader } = setup();
    db.updateChangeState(change.id, "RUNNING", 3);
    const current = db.getChange(change.id)!;
    const task = leader.createTask(current, agent, "Implement change");
    const run = createRun(change.id, agent.id, task.id);
    db.createRun(run);
    db.updateRun(run.id, {
      status: "COMPLETED",
      exitCode: 0,
      finalResponse: "Done",
    });
    db.addEvidence(run.id, {
      type: "RUNTIME",
      title: "Runtime exit",
      status: "PASS",
      detail: "exit 0",
    });
    const result = leader.onRunFinished(db.getRun(run.id)!);
    expect(result.accepted).toBe(false);
    expect(db.getTask(task.id)?.status).toBe("REWORK");
    expect(db.getChange(change.id)?.status).toBe("BLOCKED");
    expect(
      db
        .snapshot([])
        .issues.some(
          (issue) => issue.severity === "BLOCKING" && issue.status === "OPEN",
        ),
    ).toBe(true);
  });

  it("accepts a Leader coordination run after child tasks were created and waits for those children", () => {
    const { db, agent, change, leader } = setup();
    db.updateChangeState(change.id, "RUNNING", 3);
    const current = db.getChange(change.id)!;
    const parent = leader.createTask(current, agent, "Coordinate development");
    leader.createTask(current, agent, "Delegated implementation", parent.id);
    const run = createRun(change.id, agent.id, parent.id);
    db.createRun(run);
    db.updateRun(run.id, {
      status: "COMPLETED",
      exitCode: 0,
      finalResponse:
        '```json\n[{"agent":"Backend","prompt":"Implement backend"}]\n```',
    });
    db.addEvidence(run.id, {
      type: "RUNTIME",
      title: "Runtime exit",
      status: "PASS",
      detail: "exit 0",
    });
    expect(leader.onRunFinished(db.getRun(run.id)!).accepted).toBe(true);
    expect(db.getTask(parent.id)?.status).toBe("ACCEPTED");
    expect(db.getChange(change.id)?.currentPhase).toBe(3);
    expect(db.getChange(change.id)?.status).toBe("RUNNING");
  });

  it("does not stop a Bug Fix at the ON_LOOP Fix phase after evidence is accepted", () => {
    const { db, agent, change, leader } = setup("bug-fix");
    db.updateChangeState(change.id, "RUNNING", 2);
    const current = db.getChange(change.id)!;
    const task = leader.createTask(current, agent, "Fix the reproduced bug");
    const run = createRun(change.id, agent.id, task.id);
    db.createRun(run);
    db.updateRun(run.id, {
      status: "COMPLETED",
      exitCode: 0,
      finalResponse: "Fixed and tested",
    });
    db.addEvidence(run.id, {
      type: "RUNTIME",
      title: "Runtime exit",
      status: "PASS",
      detail: "exit 0",
    });
    db.addEvidence(run.id, {
      type: "DIFF",
      title: "1 file changed",
      status: "UNVERIFIED",
      detail: "diff",
    });
    db.addEvidence(run.id, {
      type: "TEST",
      title: "npm test",
      status: "PASS",
      detail: "passed",
    });
    expect(leader.onRunFinished(db.getRun(run.id)!).accepted).toBe(true);
    expect(db.getChange(change.id)?.currentPhase).toBe(3);
    expect(db.getChange(change.id)?.status).toBe("RUNNING");
  });

  it("treats REVIEW as an Agent review phase rather than a human stop", () => {
    const { db, agent, change, leader } = setup("bug-fix");
    db.updateChangeState(change.id, "RUNNING", 5);
    const current = db.getChange(change.id)!;
    const task = leader.createTask(
      current,
      agent,
      "Review final diff and evidence",
    );
    const run = createRun(change.id, agent.id, task.id);
    db.createRun(run);
    db.updateRun(run.id, {
      status: "COMPLETED",
      exitCode: 0,
      finalResponse: "Review passed",
    });
    db.addEvidence(run.id, {
      type: "RUNTIME",
      title: "Runtime exit",
      status: "PASS",
      detail: "exit 0",
    });
    expect(leader.onRunFinished(db.getRun(run.id)!).accepted).toBe(true);
    expect(db.getChange(change.id)?.status).toBe("DONE");
  });
});

function createRun(changeId: string, agentId: string, taskId: string): Run {
  return {
    id: crypto.randomUUID(),
    changeId,
    workOrderId: null,
    agentId,
    taskId,
    agentSessionId: null,
    parentRunId: null,
    status: "QUEUED",
    prompt: "task",
    runtime: "claude",
    executable: "claude",
    workspacePath: "/tmp",
    startedAt: null,
    endedAt: null,
    exitCode: null,
    sessionId: null,
    stdout: "",
    stderr: "",
    finalResponse: null,
    baseCommit: null,
    retryReason: null,
    evidence: [],
  };
}
