import { join } from "node:path";
import { AppDatabase } from "../main/database";
import { WORKFLOWS } from "../shared/workflows";
import type {
  Agent,
  AppSnapshot,
  Change,
  RuntimeEvent,
  RuntimeProcessMessage,
  RuntimeRequest,
  RuntimeRequestEnvelope,
} from "../shared/contracts";
import { AdapterRegistry } from "./adapters";
import {
  AdapterConversationExecutor,
  ConversationEngine,
} from "./conversation-engine";
import { updateAgentRecord } from "./agent-store";
import { LeaderEngine } from "./leader-engine";
import { TeamRunManager } from "./run-manager";
import { WorkspaceManager } from "./workspace-manager";
import { RuntimeQueue } from "./runtime-queue";
import { WorkOrderService } from "./work-orders/work-order-service";
import { ScheduleService } from "./schedules/schedule-service";

interface ParentPort {
  postMessage(message: RuntimeProcessMessage): void;
  on(
    event: "message",
    listener: (event: { data: RuntimeRequestEnvelope }) => void,
  ): void;
}
const port = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!port)
  throw new Error("Agent Teams Runtime 必须由 Electron utilityProcess 启动");
const dataDirectory = process.env.MOXT_DATA_DIR;
if (!dataDirectory) throw new Error("Runtime 数据目录未配置");

// Keep the existing database filename so upgrading from the previous Moxt build does not lose local data.
const databasePath = join(dataDirectory, "database", "moxt.db");
const db = new AppDatabase(databasePath);
const registry = new AdapterRegistry();
const runtimeQueue = new RuntimeQueue(3);
const publish = (event: RuntimeEvent): void => port.postMessage({ event });
let runManager: TeamRunManager;
let conversationEngine: ConversationEngine;
let workOrderService: WorkOrderService;
let scheduleService: ScheduleService;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
const changed = (): void => {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    publish({
      type: "snapshot.changed",
      snapshot: db.snapshot(runManager?.getRuntimes() ?? []),
    });
  }, 80);
};
const leader = new LeaderEngine(db, changed);
runManager = new TeamRunManager(
  db,
  registry,
  new WorkspaceManager(dataDirectory),
  leader,
  publish,
  changed,
  runtimeQueue,
);
conversationEngine = new ConversationEngine(
  db,
  new AdapterConversationExecutor(
    registry,
    () => runManager.getRuntimes(),
    runtimeQueue,
    dataDirectory,
  ),
  changed,
);
workOrderService = new WorkOrderService(
  db,
  registry,
  () => runManager.getRuntimes(),
  runtimeQueue,
  dataDirectory,
  publish,
  changed,
);
scheduleService = new ScheduleService(db, workOrderService, changed);
const initialized = registry.detect().then((runtimes) => {
  runManager.setRuntimes(runtimes);
  scheduleService.start();
  changed();
});

process.on("SIGTERM", () => {
  scheduleService.stop();
  void Promise.all([
    runManager.shutdown(),
    conversationEngine.shutdown(),
    workOrderService.shutdown(),
  ]).finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  scheduleService.stop();
  void Promise.all([
    runManager.shutdown(),
    conversationEngine.shutdown(),
    workOrderService.shutdown(),
  ]).finally(() => process.exit(0));
});

port.on("message", (event) => {
  const envelope = event.data;
  void initialized
    .then(() => dispatch(envelope.request))
    .then((result) => port.postMessage({ id: envelope.id, ok: true, result }))
    .catch((error) =>
      port.postMessage({
        id: envelope.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
});

async function dispatch(request: RuntimeRequest): Promise<unknown> {
  switch (request.type) {
    case "snapshot.get":
      return db.snapshot(runManager.getRuntimes());
    case "workspace.add": {
      const value = db.addWorkspace(request.workspace);
      changed();
      return value;
    }
    case "agent.create": {
      const value = db.createAgent(request.input);
      changed();
      return value;
    }
    case "agent.update": {
      const value = updateAgentRecord(databasePath, request.input);
      changed();
      return value;
    }
    case "runtime.detect": {
      const runtimes = await registry.detect();
      runManager.setRuntimes(runtimes);
      changed();
      return runtimes;
    }
    case "change.create": {
      if (!request.input.title.trim() || !request.input.description.trim())
        throw new Error("任务标题和描述不能为空");
      if (!request.input.workspaceIds.length || !request.input.agentIds.length)
        throw new Error("至少选择一个 Workspace 和 Agent");
      if (request.input.agentBindings.length !== request.input.agentIds.length)
        throw new Error("每个 Agent 必须绑定一个 Workspace");
      for (const binding of request.input.agentBindings)
        if (
          !request.input.agentIds.includes(binding.agentId) ||
          !request.input.workspaceIds.includes(binding.workspaceId)
        )
          throw new Error("Agent-Workspace Binding 越过当前 Change 范围");
      const value = db.createChange(request.input);
      changed();
      await runManager.ensureCurrentPhase(value.id, {
        reason: "Task created: start the first workflow phase immediately",
      });
      return db.getChange(value.id) ?? value;
    }
    case "change.kick":
      return runManager.ensureCurrentPhase(request.changeId, {
        reason: request.reason || "Manual start / continue requested by user",
      });
    case "message.send":
      return sendMessage(
        request.changeId,
        request.content,
        request.targetAgentId,
      );
    case "run.control":
      return runManager.control(request.runId, request.action, request.reason);
    case "artifact.approve":
      db.approveArtifact(request.artifactId, request.approve, request.feedback);
      changed();
      return null;
    case "workflow.advance": {
      const change = db.getChange(request.changeId);
      if (!change) throw new Error("任务不存在");
      leader.advance(change);
      changed();
      await runManager.ensureCurrentPhase(change.id, {
        reason: "Workflow advanced manually",
      });
      return null;
    }
    case "issue.update":
      db.updateIssue(request.issueId, request.status, request.resolution);
      changed();
      return null;
    case "conversation.create": {
      if (!request.input.title.trim() || !request.input.topic.trim())
        throw new Error("讨论标题和主题不能为空");
      const value = db.createConversation(request.input);
      changed();
      return value;
    }
    case "conversation.control": {
      if (request.action === "start" || request.action === "resume")
        conversationEngine.start(request.conversationId);
      else if (request.action === "pause")
        await conversationEngine.pause(request.conversationId);
      else await conversationEngine.end(request.conversationId);
      return null;
    }
    case "conversation.extend":
      conversationEngine.extend(
        request.conversationId,
        request.additionalRounds,
      );
      return null;
    case "conversation.message":
      conversationEngine.sendMessage(
        request.conversationId,
        request.content,
        request.targetParticipantId,
      );
      return null;
    case "conversation.summarize":
      await conversationEngine.summarize(
        request.conversationId,
        request.deliverableType,
      );
      return null;
    case "conversation.export-markdown":
      return conversationEngine.exportMarkdown(request.conversationId);
    case "conversation.convert":
      return convertConversation(request.conversationId, request.input);
    case "agentProfile.upsert": {
      const value = db.upsertAgentProfile(request.input);
      changed();
      return value;
    }
    case "memory.create": {
      const value = db.createMemory(request.input);
      changed();
      return value;
    }
    case "memory.decide":
      db.decideMemory(request.memoryId, request.decision);
      changed();
      return null;
    case "skill.createDraft": {
      const value = db.createSkill(request.input);
      changed();
      return value;
    }
    case "skill.publish":
      db.publishSkill(request.skillVersionId);
      changed();
      return null;
    case "workOrder.create":
      return workOrderService.create(request.input);
    case "workOrder.control":
      await workOrderService.control(request.id, request.action);
      return null;
    case "schedule.create":
      return scheduleService.create(request.input);
    case "schedule.update":
      scheduleService.setEnabled(request.id, request.enabled);
      return null;
    case "schedule.testRun":
      return scheduleService.testRun(request.scheduleId);
    case "notification.read":
      db.markNotificationRead(request.id);
      changed();
      return null;
  }
}

function convertConversation(
  conversationId: string,
  input: Extract<RuntimeRequest, { type: "conversation.convert" }>["input"],
): unknown {
  const conversation = db.getConversation(conversationId);
  const workspace = db.getWorkspace(input.workspaceId);
  if (!conversation || !workspace)
    throw new Error("讨论或目标 Workspace 不存在");
  const participants = db.getConversationParticipants(conversationId);
  const agentIds = [...new Set(input.agentIds)];
  const allowed = new Set(participants.map((item) => item.agentId));
  if (!agentIds.length || agentIds.some((id) => !allowed.has(id)))
    throw new Error("转任务只能选择当前讨论中的 Agent");
  if (!workspace.repoRoot || !workspace.baseCommit)
    throw new Error(
      "转为正式任务需要选择 Git Workspace，以便写 Agent 使用独立 Worktree",
    );
  const deliverable = db.getConversationDeliverables(conversationId)[0];
  const change = db.createChange({
    title: conversation.title,
    description:
      deliverable?.content ||
      conversationEngine.exportMarkdown(conversationId).content,
    workflowType: input.workflowType,
    priority: input.priority,
    workspaceIds: [workspace.id],
    agentIds,
    agentBindings: agentIds.map((agentId) => {
      const agent = db.getAgent(agentId);
      if (!agent) throw new Error(`Agent ${agentId} 不存在`);
      return {
        agentId,
        workspaceId: workspace.id,
        permissions: agent.permissions,
      };
    }),
    tags: ["from-discussion"],
  });
  const source =
    deliverable ??
    db.createConversationDeliverable(
      conversationId,
      "MARKDOWN",
      `${conversation.title} · 讨论记录`,
      conversationEngine.exportMarkdown(conversationId).content,
    );
  db.markConversationConverted(source.id, change.id);
  changed();
  return change;
}

async function sendMessage(
  changeId: string,
  content: string,
  targetAgentId?: string,
): Promise<void> {
  const change = db.getChange(changeId);
  if (!change) throw new Error("任务不存在");
  db.addMessage(changeId, "human", null, "You", content, null);
  const state = db.snapshot(runManager.getRuntimes());
  const normalized = content.toLowerCase();
  const target = targetAgentId
    ? db.getAgent(targetAgentId)
    : state.agents.find(
        (agent) =>
          normalized.includes(
            `@${agent.name.toLowerCase().replaceAll(" ", "-")}`,
          ) || normalized.includes(`@${agent.name.toLowerCase()}`),
      ) ||
      state.agents.find((agent) => agent.name === "Leader") ||
      state.agents.find((agent) => change.agentIds.includes(agent.id));
  assertTeamAgent(target, change.agentIds);

  if (target.name === "Leader" && isStatusQuery(content)) {
    db.addMessage(
      change.id,
      "leader",
      target.id,
      "Leader",
      formatRuntimeStatus(change, state),
      null,
    );
    changed();
    return;
  }

  const active = db.findActiveRun(changeId, target.id);
  if (active) {
    db.addIntervention({
      changeId,
      targetAgentId: target.id,
      affectedRunId: active.id,
      reason: "Direct human instruction while Agent was active",
      newConstraints: content,
      operator: "You",
    });
    await runManager.control(active.id, "pause", content);
  }
  const phaseId = WORKFLOWS[change.workflowType][change.currentPhase].id;
  const task =
    db.findReworkTask(change.id, phaseId, target.id) ??
    leader.createTask(change, target, content);
  if (task.status === "REWORK" || task.status === "BLOCKED")
    db.updateTask(task.id, "ASSIGNED", null);
  const latestState = db.snapshot(runManager.getRuntimes());
  const prompt = buildExecutionContext(change, latestState, target, content);
  await runManager.start(
    changeId,
    target,
    prompt,
    task,
    active
      ? {
          parentRunId: active.id,
          retryReason: "Human intervention",
          resumeNative: true,
        }
      : {},
  );
}

function buildExecutionContext(
  change: Change,
  state: AppSnapshot,
  target: Agent,
  instruction: string,
): string {
  const phase = WORKFLOWS[change.workflowType][change.currentPhase];
  const tasks = state.tasks.filter((task) => task.changeId === change.id);
  const activeRuns = state.runs.filter(
    (run) =>
      run.changeId === change.id &&
      ["QUEUED", "STARTING", "RUNNING"].includes(run.status),
  );
  const taskLines = tasks.length
    ? tasks
        .map(
          (task) =>
            `- ${task.title}: ${task.status}${task.currentRunId ? ` (run ${task.currentRunId.slice(0, 8)})` : ""}`,
        )
        .join("\n")
    : "- 暂无持久化 Task";
  const runLines = activeRuns.length
    ? activeRuns
        .map(
          (run) =>
            `- ${state.agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId}: ${run.status} (${run.id.slice(0, 8)})`,
        )
        .join("\n")
    : "- 当前没有活动 Run";
  return `Agent Teams Runtime context（这是应用内 Source of Truth，不要通过 Workspace 文件猜测任务是否存在）：\nChange: #${change.number} ${change.title}\nChange Status: ${change.status}\nWorkflow Phase: ${phase.name} — ${phase.goal}\nTarget Agent: ${target.name}\n\nPersisted Tasks:\n${taskLines}\n\nActive Runs:\n${runLines}\n\nHuman instruction:\n${instruction}\n\n请基于以上应用状态和真实 Workspace 执行。若上下文列出了 Task/Run，不得回答“任务列表为空”或“当前没有任务”，除非你明确指出是在说其他 CLI/文件系统中的列表。`;
}

function isStatusQuery(content: string): boolean {
  const value = content.trim().toLowerCase();
  if (/^\/status\b/.test(value)) return true;
  if (value.length > 50) return false;
  return /(任务.*(在进行|进行没|进行吗|有没有)|还在执行|执行到哪|当前(进度|状态)|现在(进度|状态)|进度如何|状态如何|running\??$|status\??$|progress\??$)/i.test(
    value,
  );
}

function formatRuntimeStatus(change: Change, state: AppSnapshot): string {
  const phase = WORKFLOWS[change.workflowType][change.currentPhase];
  const tasks = state.tasks.filter((task) => task.changeId === change.id);
  const activeRuns = state.runs.filter(
    (run) =>
      run.changeId === change.id &&
      ["QUEUED", "STARTING", "RUNNING"].includes(run.status),
  );
  const taskSummary = tasks.length
    ? tasks.map((task) => `- ${task.title}：${task.status}`).join("\n")
    : "- 暂无 Task";
  const runSummary = activeRuns.length
    ? activeRuns
        .map(
          (run) =>
            `- ${state.agents.find((agent) => agent.id === run.agentId)?.name ?? "Agent"}：${run.status}，Run ${run.id.slice(0, 8)}`,
        )
        .join("\n")
    : "- 当前没有活动 Run";
  return `任务 #${change.number} **${change.title}** 当前状态：**${change.status}**，Workflow 位于 **${phase.name}**。\n\nTask：\n${taskSummary}\n\nRuntime：\n${runSummary}\n\n以上直接来自 Agent Teams 的持久化状态，不是从 Workspace 或 CLI 的临时任务列表推断。`;
}

function assertTeamAgent(
  agent: Agent | undefined,
  teamIds: string[],
): asserts agent is Agent {
  if (!agent) throw new Error("没有可执行的 Agent");
  if (!teamIds.includes(agent.id))
    throw new Error(`${agent.name} 不属于当前 Session Team`);
}
