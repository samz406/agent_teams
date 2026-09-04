import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  Agent,
  Change,
  PermissionSet,
  Run,
  RuntimeEvent,
  RuntimeInfo,
  Task,
} from "../shared/contracts";
import type { AppDatabase } from "../main/database";
import { collectGitEvidence } from "../main/runtime/git";
import { extractTeamActions } from "../main/runtime/parser";
import { WORKFLOWS } from "../shared/workflows";
import { AdapterRegistry } from "./adapters";
import { EvidenceService } from "./evidence-service";
import { LeaderEngine } from "./leader-engine";
import { RuntimeQueue } from "./runtime-queue";
import { WorkspaceManager } from "./workspace-manager";

type Publish = (event: RuntimeEvent) => void;
interface StartOptions {
  parentRunId?: string | null;
  retryReason?: string | null;
  resumeNative?: boolean;
}
interface EnsurePhaseOptions {
  reason?: string;
  parentRunId?: string | null;
}

const activeStatuses = new Set(["QUEUED", "STARTING", "RUNNING"]);
const writablePhases = new Set(["development", "fix", "refactor"]);
const phaseAgentPreferences: Record<string, string[]> = {
  reproduce: ["QA Agent", "Code Agent", "Leader", "Architect"],
  "root-cause": ["Architect", "Leader", "Code Agent", "QA Agent"],
  fix: ["Code Agent", "Leader", "Architect", "QA Agent"],
  verify: ["QA Agent", "Architect", "Leader", "Code Agent"],
  regression: ["QA Agent", "Code Agent", "Leader", "Architect"],
  review: ["Architect", "QA Agent", "Leader", "Code Agent"],
  discovery: ["Architect", "Leader", "Code Agent", "QA Agent"],
  proposal: ["Architect", "Leader", "Code Agent", "QA Agent"],
  development: ["Code Agent", "Leader", "Architect", "QA Agent"],
  integration: ["QA Agent", "Code Agent", "Leader", "Architect"],
  investigation: ["Architect", "QA Agent", "Leader", "Code Agent"],
  evidence: ["QA Agent", "Architect", "Leader", "Code Agent"],
  checks: ["QA Agent", "Code Agent", "Architect", "Leader"],
  recheck: ["QA Agent", "Code Agent", "Architect", "Leader"],
  triage: ["Architect", "Leader", "QA Agent", "Code Agent"],
  decision: ["Leader", "Architect", "QA Agent", "Code Agent"],
};

export class TeamRunManager {
  private processes = new Map<
    string,
    { child: ChildProcessWithoutNullStreams; agent: Agent }
  >();
  private buffers = new Map<string, { stdout: string; stderr: string }>();
  private cancelling = new Set<string>();
  private resumeRuns = new Set<string>();
  private runtimes: RuntimeInfo[] = [];
  private evidence = new EvidenceService();

  constructor(
    private db: AppDatabase,
    private registry: AdapterRegistry,
    private workspaces: WorkspaceManager,
    private leader: LeaderEngine,
    private publish: Publish,
    private changed: () => void,
    private queue = new RuntimeQueue(3),
  ) {}
  setRuntimes(runtimes: RuntimeInfo[]): void {
    this.runtimes = runtimes;
  }
  getRuntimes(): RuntimeInfo[] {
    return this.runtimes;
  }
  queueStats(): ReturnType<RuntimeQueue["stats"]> {
    return this.queue.stats();
  }

  async ensureCurrentPhase(
    changeId: string,
    options: EnsurePhaseOptions = {},
  ): Promise<string | null> {
    const change = this.db.getChange(changeId);
    if (!change) throw new Error("任务不存在");
    if (change.status === "DONE" || change.status === "FAILED") return null;
    const phase = WORKFLOWS[change.workflowType][change.currentPhase];
    if (!phase || phase.id === "done") {
      this.db.updateChangeState(
        change.id,
        "DONE",
        Math.max(0, WORKFLOWS[change.workflowType].length - 1),
      );
      this.changed();
      return null;
    }

    if (
      phase.humanMode === "IN_LOOP" &&
      !this.db.hasApprovedArtifact(change.id)
    ) {
      if (change.status !== "WAITING_HUMAN") {
        this.db.updateChangeState(change.id, "WAITING_HUMAN");
        this.db.addMessage(
          change.id,
          "system",
          null,
          "System",
          `${phase.name} 是强人工 Gate，Workflow 已暂停，等待批准 Artifact 后继续。`,
          null,
        );
        this.changed();
      }
      return null;
    }

    const state = this.db.snapshot(this.runtimes);
    const phaseTasks = this.db.getPhaseTasks(change.id, phase.id);
    const active = state.runs.find(
      (run) =>
        run.changeId === change.id &&
        activeStatuses.has(run.status) &&
        phaseTasks.some((task) => task.id === run.taskId),
    );
    if (active) return active.id;

    if (
      phaseTasks.length &&
      phaseTasks.every((task) => task.status === "ACCEPTED")
    ) {
      try {
        this.leader.advance(change);
        this.changed();
        return this.ensureCurrentPhase(changeId, {
          reason: `Continue after ${phase.name}`,
          parentRunId: options.parentRunId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.db.updateChangeState(change.id, "BLOCKED");
        this.db.addMessage(
          change.id,
          "system",
          null,
          "System",
          `无法从 ${phase.name} 推进：${message}`,
          null,
        );
        this.changed();
        return null;
      }
    }

    let task = phaseTasks.find((item) =>
      ["ASSIGNED", "BLOCKED", "REWORK"].includes(item.status),
    );
    let agent = task ? this.db.getAgent(task.assignedAgentId) : undefined;
    if (!agent) agent = this.selectPhaseAgent(change, phase.id);
    if (!agent) {
      this.db.updateChangeState(change.id, "BLOCKED");
      this.db.addMessage(
        change.id,
        "system",
        null,
        "System",
        `${phase.name} 无可用 Agent。请为当前团队配置至少一个可执行 Runtime。`,
        null,
      );
      this.publish({
        type: "runtime.notice",
        level: "error",
        message: `${phase.name} 无可用 Agent`,
      });
      this.changed();
      return null;
    }

    const instruction = this.buildPhaseInstruction(
      change,
      phase.id,
      agent,
      options.reason,
    );
    if (!task) {
      task = this.leader.createTask(change, agent, instruction);
      this.db.addMessage(
        change.id,
        "system",
        null,
        "System",
        `${agent.name} 已自动接手 ${phase.name}，准备启动真实 ${agent.runtime} Runtime。`,
        null,
      );
    } else if (task.status !== "ASSIGNED") {
      this.db.updateTask(task.id, "ASSIGNED", null);
      this.db.addMessage(
        change.id,
        "system",
        null,
        "System",
        `${phase.name} 的 Task 已恢复，正在重新启动 ${agent.name}。`,
        null,
      );
    }
    this.db.updateChangeState(change.id, "RUNNING");
    this.changed();

    try {
      return await this.start(change.id, agent, instruction, task, {
        parentRunId: options.parentRunId ?? null,
        retryReason: options.reason ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.updateTask(task.id, "BLOCKED", null);
      this.db.updateChangeState(change.id, "BLOCKED");
      this.db.addMessage(
        change.id,
        "system",
        null,
        "System",
        `${phase.name} Runtime 启动失败：${message}。Task 已保留，可在任务菜单点击“启动/继续执行”重试。`,
        null,
      );
      this.publish({
        type: "runtime.notice",
        level: "error",
        message: `${phase.name} 启动失败：${message}`,
      });
      this.changed();
      return null;
    }
  }

  async start(
    changeId: string,
    agent: Agent,
    prompt: string,
    task: Task,
    options: StartOptions = {},
  ): Promise<string> {
    const change = this.db.getChange(changeId);
    if (!change || !change.agentIds.includes(agent.id))
      throw new Error("Agent 不属于当前 Session Team");
    const binding = this.db.getBinding(changeId, agent.id);
    if (!binding) throw new Error(`${agent.name} 没有 Agent-Workspace Binding`);
    const workspace = this.db.getWorkspace(binding.workspaceId);
    const workstream = this.db.getWorkstream(
      changeId,
      agent.id,
      binding.workspaceId,
    );
    if (!workspace || !workstream)
      throw new Error("Workspace 或 Workstream 不存在");
    const phase = WORKFLOWS[change.workflowType][change.currentPhase];
    const effectivePermissions: PermissionSet = {
      ...binding.permissions,
      write: binding.permissions.write && writablePhases.has(phase.id),
    };
    const prepared = await this.workspaces.prepare(
      change,
      workspace,
      { ...binding, permissions: effectivePermissions },
      workstream,
    );
    this.db.updateWorkstream(workstream.id, {
      status: "ACTIVE",
      worktreePath: effectivePermissions.write
        ? prepared.cwd
        : workstream.worktreePath,
      branch: prepared.branch,
      baseCommit: prepared.baseCommit,
    });
    const adapter = this.registry.get(agent.runtime);
    const runtime = adapter.detect(this.runtimes);
    const executable = agent.command || runtime?.path || runtime?.executable;
    if (!executable || (!runtime?.available && !agent.command))
      throw new Error(`${agent.runtime} 未安装或未配置`);
    const session = this.db.ensureAgentSession(
      changeId,
      agent.id,
      workspace.id,
      agent.runtime,
    );
    const id = randomUUID();
    const run: Run = {
      id,
      changeId,
      workOrderId: null,
      agentId: agent.id,
      taskId: task.id,
      agentSessionId: session.id,
      parentRunId: options.parentRunId ?? null,
      status: "QUEUED",
      prompt,
      runtime: agent.runtime,
      executable,
      workspacePath: prepared.cwd,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      sessionId: session.nativeSessionId,
      stdout: "",
      stderr: "",
      finalResponse: null,
      baseCommit: prepared.baseCommit,
      retryReason: options.retryReason ?? null,
      evidence: [],
    };
    this.db.createRun(run);
    this.db.updateTask(task.id, "QUEUED", id);
    if (options.resumeNative) this.resumeRuns.add(id);
    this.publish({ type: "run.status", runId: id, status: "QUEUED" });
    this.changed();
    void this.queue.enqueue(id, () =>
      this.execute(run, agent, effectivePermissions, session.nativeSessionId),
    );
    return id;
  }

  async control(
    runId: string,
    action: "pause" | "resume" | "stop" | "retry",
    reason?: string,
  ): Promise<void> {
    const run = this.db.getRun(runId);
    if (!run) throw new Error("Run 不存在");
    const adapter = this.registry.get(run.runtime);
    if (action === "stop" || action === "pause") {
      if (this.queue.cancel(runId)) {
        this.db.updateRun(runId, {
          status: action === "pause" ? "PAUSED" : "CANCELLED",
          endedAt: new Date().toISOString(),
        });
      } else {
        const active = this.processes.get(runId);
        if (active) {
          this.cancelling.add(runId);
          await (action === "pause"
            ? adapter.interrupt(active.child)
            : adapter.cancel(active.child));
        }
        const buffer = this.buffers.get(runId);
        const parsedSession = buffer
          ? adapter.parse(buffer.stdout).nativeSessionId
          : run.sessionId;
        this.db.updateRun(runId, {
          status: action === "pause" ? "PAUSED" : "CANCELLED",
          endedAt: new Date().toISOString(),
          stdout: buffer?.stdout ?? run.stdout,
          stderr: buffer?.stderr ?? run.stderr,
          sessionId: parsedSession,
        });
      }
      const refreshed = this.db.getRun(runId);
      if (run.agentSessionId)
        this.db.updateAgentSession(
          run.agentSessionId,
          refreshed?.sessionId ?? run.sessionId,
          action === "pause" ? "PAUSED" : "CLOSED",
        );
      if (run.taskId)
        this.db.updateTask(
          run.taskId,
          action === "pause" ? "BLOCKED" : "CANCELLED",
          run.id,
        );
      this.publish({
        type: "run.status",
        runId,
        status: action === "pause" ? "PAUSED" : "CANCELLED",
      });
      this.changed();
      return;
    }
    const agent = this.db.getAgent(run.agentId);
    const oldTask = run.taskId ? this.db.getTask(run.taskId) : undefined;
    if (!run.changeId)
      throw new Error("该 Run 不属于研发 Change，请从工作单页面控制");
    const change = this.db.getChange(run.changeId);
    if (!agent || !change) throw new Error("Agent 或 Change 不存在");
    const task =
      oldTask ??
      this.leader.createTask(
        change,
        agent,
        `${run.prompt}\n\nHuman constraint: ${reason || action}`,
        null,
      );
    this.db.updateTask(task.id, "ASSIGNED", null);
    this.db.addIntervention({
      changeId: run.changeId,
      targetAgentId: run.agentId,
      affectedRunId: run.id,
      reason: action,
      newConstraints: reason || "Continue from previous execution evidence",
      operator: "You",
    });
    await this.start(
      run.changeId,
      agent,
      `${run.prompt}\n\nHuman instruction: ${reason || "Continue and correct the previous execution."}`,
      task,
      {
        parentRunId: run.id,
        retryReason: reason || action,
        resumeNative:
          action === "resume" &&
          adapter.supportsNativeResume &&
          Boolean(run.sessionId),
      },
    );
  }

  private selectPhaseAgent(change: Change, phaseId: string): Agent | undefined {
    const state = this.db.snapshot(this.runtimes);
    const fixAgents =
      change.workflowType === "bug-fix" && phaseId === "verify"
        ? new Set(
            this.db
              .getPhaseTasks(change.id, "fix")
              .map((task) => task.assignedAgentId),
          )
        : new Set<string>();
    let candidates = state.agents.filter(
      (agent) => change.agentIds.includes(agent.id) && !fixAgents.has(agent.id),
    );
    if (writablePhases.has(phaseId)) {
      const writable = candidates.filter((agent) =>
        Boolean(this.db.getBinding(change.id, agent.id)?.permissions.write),
      );
      if (writable.length) candidates = writable;
    }
    const available = candidates.filter(
      (agent) =>
        Boolean(agent.command) ||
        this.runtimes.some(
          (runtime) => runtime.type === agent.runtime && runtime.available,
        ),
    );
    if (available.length) candidates = available;
    const preferences = phaseAgentPreferences[phaseId] ?? [
      "Leader",
      "Code Agent",
      "Architect",
      "QA Agent",
    ];
    candidates.sort(
      (a, b) => rankAgent(a.name, preferences) - rankAgent(b.name, preferences),
    );
    return candidates[0];
  }

  private buildPhaseInstruction(
    change: Change,
    phaseId: string,
    agent: Agent,
    reason?: string,
  ): string {
    const phase = WORKFLOWS[change.workflowType][change.currentPhase];
    const phaseGuidance: Record<string, string> = {
      reproduce:
        "稳定复现缺陷。优先找到最小复现路径，记录 Expected / Actual，并执行真实命令或测试证明问题存在。此阶段不要修改业务代码。",
      "root-cause":
        "基于已经得到的复现证据定位根因，给出从现象到代码机制的因果链，并指出将要修改的最小范围。",
      fix: "实施最小范围修复。必须产生真实 Diff，并运行与缺陷直接相关的测试；不要顺手重构无关代码。",
      verify:
        "作为独立验证者，不依赖实现者结论，重新执行原复现 Case 和相关测试，证明缺陷已消失。不要修改实现代码。",
      regression:
        "运行受影响范围的回归测试，关注修复引入的二阶影响，并给出明确 PASS/FAIL 证据。",
      review:
        "审查最终 Diff、测试与风险，检查越界修改、遗漏 Case 和潜在回归。Review 不要求为了形式重复执行全部测试，但结论必须引用已有证据。",
    };
    const state = this.db.snapshot(this.runtimes);
    const priorTasks =
      state.tasks
        .filter((task) => task.changeId === change.id)
        .map((task) => `- ${task.phaseId}: ${task.title} = ${task.status}`)
        .join("\n") || "- 暂无前序 Task";
    return `Agent Teams 自动调度任务。\n\nChange: #${change.number} ${change.title}\nWorkflow: ${change.workflowType}\nCurrent phase: ${phase.name}\nPhase goal: ${phase.goal}\nDeliverable: ${phase.deliverable}\nExit criteria:\n${phase.exitCriteria.map((item) => `- ${item}`).join("\n")}\nAssigned agent: ${agent.name}\n\nOriginal requirement:\n${change.description}\n\nPhase guidance:\n${phaseGuidance[phaseId] ?? "完成当前阶段目标，并用真实 Workspace 证据支撑结论。"}\n\nPersisted task history:\n${priorTasks}\n${reason ? `\nScheduler reason:\n${reason}\n` : ""}\n直接开始执行，不要等待用户再次确认。所有“完成/通过”判断必须基于真实命令、测试、Diff 或 Runtime Evidence。需要当前团队其他 Agent 协作时可使用 team-actions。`;
  }

  private async execute(
    run: Run,
    agent: Agent,
    permissions: PermissionSet,
    nativeSessionId: string | null,
  ): Promise<void> {
    if (!run.changeId) throw new Error("TeamRunManager 只执行 Change Run");
    this.db.updateRun(run.id, {
      status: "STARTING",
      startedAt: new Date().toISOString(),
    });
    this.leader.onRunStarted(run.taskId, run.id);
    this.publish({ type: "run.status", runId: run.id, status: "STARTING" });
    this.changed();
    const adapter = this.registry.get(run.runtime);
    try {
      const launchInput = {
        executable: run.executable,
        prompt: buildPrompt(agent, run.prompt),
        cwd: run.workspacePath,
        permissions,
        nativeSessionId,
        argsTemplate: agent.argsTemplate,
      };
      const launch = this.resumeRuns.delete(run.id)
        ? await adapter.resume(launchInput)
        : await adapter.start(launchInput);
      this.processes.set(run.id, { child: launch.child, agent });
      this.db.updateRun(run.id, { status: "RUNNING" });
      this.db.addEvidence(run.id, {
        type: "COMMAND",
        title: launch.redactedCommand,
        status: "UNVERIFIED",
        detail: `cwd: ${run.workspacePath}`,
      });
      this.publish({ type: "run.status", runId: run.id, status: "RUNNING" });
      this.changed();
      let stdout = "";
      let stderr = "";
      this.buffers.set(run.id, { stdout, stderr });
      launch.child.stdout.on("data", (chunk) => {
        const value = String(chunk);
        stdout += value;
        this.buffers.set(run.id, { stdout, stderr });
        this.publish({
          type: "run.activity",
          runId: run.id,
          stream: "stdout",
          chunk: value,
        });
      });
      launch.child.stderr.on("data", (chunk) => {
        const value = String(chunk);
        stderr += value;
        this.buffers.set(run.id, { stdout, stderr });
        this.publish({
          type: "run.activity",
          runId: run.id,
          stream: "stderr",
          chunk: value,
        });
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        launch.child.once("error", reject);
        launch.child.once("close", resolve);
      });
      this.processes.delete(run.id);
      if (this.cancelling.delete(run.id)) {
        this.processes.delete(run.id);
        this.buffers.delete(run.id);
        return;
      }
      const status = code === 0 ? "COMPLETED" : "FAILED";
      const parsed = adapter.parse(stdout);
      this.db.updateRun(run.id, {
        status,
        endedAt: new Date().toISOString(),
        exitCode: code,
        stdout,
        stderr,
        finalResponse: parsed.finalResponse,
        sessionId: parsed.nativeSessionId,
      });
      this.db.addEvidence(run.id, {
        type: "RUNTIME",
        title: "Runtime exit",
        status: code === 0 ? "PASS" : "FAIL",
        detail: `exit code: ${code}`,
      });
      for (const item of this.evidence.derive(stdout, stderr, code))
        this.db.addEvidence(run.id, item);
      const git = await collectGitEvidence(run.workspacePath, run.baseCommit);
      this.db.addEvidence(run.id, {
        type: "GIT",
        title: "Workspace state",
        status: "UNVERIFIED",
        detail: git.status || "Clean working tree",
      });
      if (git.files.length)
        this.db.addEvidence(run.id, {
          type: "DIFF",
          title: `${git.files.length} files changed`,
          status: "UNVERIFIED",
          detail: `${git.diff}\n\n${git.files.join("\n")}`,
        });
      if (run.agentSessionId)
        this.db.updateAgentSession(
          run.agentSessionId,
          parsed.nativeSessionId,
          "ACTIVE",
          parsed.finalResponse.slice(0, 2000),
        );
      this.db.addMessage(
        run.changeId,
        "agent",
        agent.id,
        agent.name,
        parsed.finalResponse,
        run.id,
      );
      if (/proposal|contract|report|方案|报告/i.test(parsed.finalResponse))
        this.db.createArtifact(
          run.changeId,
          "RUN_DELIVERABLE",
          `${agent.name} Deliverable`,
          parsed.finalResponse,
        );
      const completed = this.db.getRun(run.id)!;
      await this.delegateActions(completed, agent, parsed.finalResponse);
      const beforePhase = this.db.getChange(run.changeId)?.currentPhase;
      const result = this.leader.onRunFinished(this.db.getRun(run.id)!);
      const after = this.db.getChange(run.changeId);
      this.publish({ type: "run.status", runId: run.id, status });
      this.changed();
      this.buffers.delete(run.id);
      if (
        result.accepted &&
        after &&
        after.status === "RUNNING" &&
        beforePhase !== undefined &&
        after.currentPhase !== beforePhase
      ) {
        await this.ensureCurrentPhase(after.id, {
          reason: `Auto-continue after ${WORKFLOWS[after.workflowType][beforePhase]?.name ?? "previous phase"}`,
          parentRunId: run.id,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.processes.delete(run.id);
      this.buffers.delete(run.id);
      this.db.updateRun(run.id, {
        status: "FAILED",
        endedAt: new Date().toISOString(),
        stderr: message,
        finalResponse: message,
      });
      this.db.addEvidence(run.id, {
        type: "RUNTIME",
        title: "Runtime failure",
        status: "FAIL",
        detail: message,
      });
      if (run.taskId) this.leader.onRunFinished(this.db.getRun(run.id)!);
      this.publish({ type: "run.status", runId: run.id, status: "FAILED" });
      this.publish({ type: "runtime.notice", level: "error", message });
      this.changed();
    }
  }

  private async delegateActions(
    parentRun: Run,
    sender: Agent,
    response: string,
  ): Promise<void> {
    if (!parentRun.changeId) return;
    const change = this.db.getChange(parentRun.changeId);
    if (!change) return;
    for (const action of extractTeamActions(response)) {
      const target = this.db
        .snapshot(this.runtimes)
        .agents.find(
          (item) =>
            (item.name.toLowerCase() === action.agent.toLowerCase() ||
              item.id === action.agent) &&
            change.agentIds.includes(item.id),
        );
      if (!target || target.id === sender.id) continue;
      const task = this.leader.createTask(
        change,
        target,
        action.prompt,
        parentRun.taskId,
      );
      this.db.createHandoff({
        changeId: change.id,
        fromTaskId: parentRun.taskId,
        fromAgentId: sender.id,
        toTaskId: task.id,
        toAgentId: target.id,
        deliverable: response.slice(0, 4000),
        evidenceIds: parentRun.evidence.map((item) => item.id),
      });
      await this.start(change.id, target, action.prompt, task, {
        parentRunId: parentRun.id,
        retryReason: `Delegated by ${sender.name}`,
      });
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.processes.entries()].map(async ([runId, active]) => {
        try {
          await this.registry.get(active.agent.runtime).cancel(active.child);
        } finally {
          this.db.updateRun(runId, {
            status: "INTERRUPTED",
            endedAt: new Date().toISOString(),
          });
        }
      }),
    );
    this.processes.clear();
    this.changed();
  }
}

function rankAgent(name: string, preferences: string[]): number {
  const index = preferences.findIndex(
    (value) => value.toLowerCase() === name.toLowerCase(),
  );
  return index === -1 ? preferences.length + 1 : index;
}

function buildPrompt(agent: Agent, prompt: string): string {
  return `You are ${agent.name}. Responsibility: ${agent.responsibility}\nQuality bar:\n${agent.qualityBar.map((item) => `- ${item}`).join("\n")}\n\nTask:\n${prompt}\n\nWork only in the provided workspace. Report claims with concrete command, test and diff evidence. Do not claim tests passed unless they actually ran. To delegate, append a fenced team-actions JSON array containing agent and prompt.`;
}
