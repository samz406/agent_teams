import { createHash, randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppDatabase } from "../../main/database";
import { extractWorkEvidence } from "../../main/runtime/parser";
import type {
  Agent,
  CreateWorkOrderInput,
  PermissionSet,
  Run,
  RuntimeEvent,
  RuntimeInfo,
  WorkOrder,
} from "../../shared/contracts";
import { AdapterRegistry, type RuntimeAdapter } from "../adapters";
import { EvidenceService } from "../evidence-service";
import { assembleContext } from "../memory/context-assembler";
import { RuntimeQueue } from "../runtime-queue";
import { validateJsonSchema } from "../skills/skill-validator";
import { validateOutput } from "./output-validator";

type Publish = (event: RuntimeEvent) => void;

export class WorkOrderService {
  private active = new Map<
    string,
    { child: ChildProcessWithoutNullStreams; adapter: RuntimeAdapter }
  >();
  private interrupted = new Set<string>();
  private evidence = new EvidenceService();

  constructor(
    private db: AppDatabase,
    private registry: AdapterRegistry,
    private runtimes: () => RuntimeInfo[],
    private queue: RuntimeQueue,
    private dataDirectory: string,
    private publish: Publish,
    private changed: () => void,
  ) {}

  create(input: CreateWorkOrderInput): WorkOrder {
    if (!input.title.trim() || !input.goal.trim())
      throw new Error("工作单标题和目标不能为空");
    if (!this.db.getAgent(input.ownerAgentId))
      throw new Error("负责人 Agent 不存在");
    const value = this.db.createWorkOrder(input);
    this.changed();
    return value;
  }

  async start(id: string, resume = false): Promise<void> {
    const order = this.requireOrder(id);
    const agent = this.requireAgent(order.ownerAgentId);
    const profile = this.db.getAgentProfile(agent.id);
    if (!profile || profile.status !== "ACTIVE")
      return this.block(
        order,
        "负责人岗位档案尚未启用，请先补全岗位并设为“启用”",
      );
    const skills = order.skillVersionIds
      .map((skillId) => this.db.getSkillVersion(skillId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (
      skills.length !== order.skillVersionIds.length ||
      skills.some((item) => item.status !== "VERIFIED")
    )
      return this.block(order, "指定的 SkillVersion 不存在或尚未发布");
    for (const skill of skills) {
      const validation = validateJsonSchema(order.input, skill.inputSchema);
      if (!validation.valid)
        return this.block(
          order,
          `输入不符合 Skill Schema：${validation.errors.join("；")}`,
        );
    }
    const permissions = intersectPermissions(
      agent.permissions,
      order.permissions,
    );
    const missing = [
      ...new Set(skills.flatMap((item) => item.requiredCapabilities)),
    ].filter((capability) => !hasCapability(permissions, capability));
    if (missing.length)
      return this.block(
        order,
        `缺少能力：${missing.join("、")}。Skill 不能自动放宽权限。`,
      );
    const workspace = order.workspaceId
      ? this.db.getWorkspace(order.workspaceId)
      : undefined;
    if (order.workspaceId && !workspace)
      return this.block(order, "工作单关联的 Workspace 不存在");
    const cwd =
      workspace?.path ??
      join(this.dataDirectory, "work-orders", order.id, "workspace");
    await mkdir(cwd, { recursive: true });
    const context = assembleContext(
      agent,
      profile,
      order,
      this.db.listActiveMemories(agent.id, order.projectScopeId),
      skills,
    );
    const adapter = this.registry.get(agent.runtime);
    const detected = adapter.detect(this.runtimes());
    const executable = agent.command || detected?.path || detected?.executable;
    if (!executable || (!detected?.available && !agent.command))
      return this.block(order, `${agent.runtime} 未安装或未配置`);
    const session = this.db.ensureWorkOrderSession(
      order.id,
      agent.id,
      workspace?.id ?? null,
      agent.runtime,
    );
    const previous = order.currentRunId
      ? this.db.getRun(order.currentRunId)
      : undefined;
    const run: Run = {
      id: randomUUID(),
      changeId: null,
      workOrderId: order.id,
      agentId: agent.id,
      taskId: null,
      agentSessionId: session.id,
      parentRunId: previous?.id ?? null,
      status: "QUEUED",
      prompt: context.prompt,
      runtime: agent.runtime,
      executable,
      workspacePath: cwd,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      sessionId: session.nativeSessionId,
      stdout: "",
      stderr: "",
      finalResponse: null,
      baseCommit: workspace?.baseCommit ?? null,
      retryReason: previous ? "WorkOrder retry/resume" : null,
      evidence: [],
    };
    this.db.updateWorkOrder(order.id, "READY");
    this.db.createRun(run);
    this.db.addEvidence(run.id, context.evidence);
    this.db.updateWorkOrder(order.id, "QUEUED", { runId: run.id });
    this.publish({ type: "run.status", runId: run.id, status: "QUEUED" });
    this.changed();
    const priority =
      order.createdByType === "SCHEDULE" ? "SCHEDULED" : "INTERACTIVE";
    void this.queue.enqueue(
      `work-order:${run.id}`,
      () =>
        this.execute(
          order,
          run,
          agent,
          permissions,
          adapter,
          resume && Boolean(session.nativeSessionId),
        ),
      priority,
    );
  }

  async control(
    id: string,
    action: "start" | "pause" | "resume" | "cancel" | "retry",
  ): Promise<void> {
    const order = this.requireOrder(id);
    if (action === "start" || action === "retry" || action === "resume")
      return this.start(id, action === "resume" || action === "retry");
    const runId = order.currentRunId;
    if (runId && this.queue.cancel(`work-order:${runId}`))
      this.db.updateRun(runId, {
        status: action === "pause" ? "PAUSED" : "CANCELLED",
        endedAt: new Date().toISOString(),
      });
    const current = runId ? this.active.get(runId) : undefined;
    if (current) {
      this.interrupted.add(runId!);
      await (action === "pause"
        ? current.adapter.interrupt(current.child)
        : current.adapter.cancel(current.child));
    }
    if (runId)
      this.db.updateRun(runId, {
        status: action === "pause" ? "PAUSED" : "CANCELLED",
        endedAt: new Date().toISOString(),
      });
    this.db.updateWorkOrder(id, action === "pause" ? "BLOCKED" : "CANCELLED", {
      reason: action === "pause" ? "用户已暂停" : "用户已取消",
    });
    this.changed();
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.active.values()].map((item) => item.adapter.cancel(item.child)),
    );
    this.active.clear();
  }

  private async execute(
    order: WorkOrder,
    run: Run,
    agent: Agent,
    permissions: PermissionSet,
    adapter: RuntimeAdapter,
    resume: boolean,
  ): Promise<void> {
    this.db.updateRun(run.id, {
      status: "STARTING",
      startedAt: new Date().toISOString(),
    });
    this.db.updateWorkOrder(order.id, "RUNNING", { runId: run.id });
    this.publish({ type: "run.status", runId: run.id, status: "STARTING" });
    this.changed();
    try {
      const input = {
        executable: run.executable,
        prompt: run.prompt,
        cwd: run.workspacePath,
        permissions,
        nativeSessionId: run.sessionId,
        argsTemplate: agent.argsTemplate,
      };
      const launch =
        resume && adapter.supportsNativeResume
          ? await adapter.resume(input)
          : await adapter.start(input);
      this.active.set(run.id, { child: launch.child, adapter });
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
      launch.child.stdout.on("data", (chunk) => {
        const value = String(chunk);
        stdout += value;
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
      this.active.delete(run.id);
      if (this.interrupted.delete(run.id)) return;
      const parsed = adapter.parse(stdout);
      this.db.updateRun(run.id, {
        status: code === 0 ? "COMPLETED" : "FAILED",
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
      if (run.agentSessionId)
        this.db.updateAgentSession(
          run.agentSessionId,
          parsed.nativeSessionId,
          code === 0 ? "ACTIVE" : "INTERRUPTED",
          parsed.finalResponse.slice(0, 2000),
        );
      if (code !== 0)
        return this.fail(order, `Runtime 执行失败（exit=${code ?? "null"}）`);
      const declared = extractWorkEvidence(parsed.finalResponse);
      for (const source of declared.sources)
        this.db.addEvidence(run.id, {
          type: "SOURCE",
          title: source.url,
          status: validDate(source.retrievedAt) ? "PASS" : "FAIL",
          detail: JSON.stringify(source),
        });
      if (declared.dataFreshness)
        this.db.addEvidence(run.id, {
          type: "DATA_FRESHNESS",
          title: declared.dataFreshness.asOf,
          status: validDate(declared.dataFreshness.asOf) ? "PASS" : "FAIL",
          detail: JSON.stringify(declared.dataFreshness),
        });
      this.db.updateWorkOrder(order.id, "VERIFYING", { runId: run.id });
      this.changed();
      let evidence = this.db.getRun(run.id)?.evidence ?? [];
      const output = validateOutput(
        parsed.finalResponse,
        order.outputContract,
        evidence,
      );
      this.db.addEvidence(run.id, {
        type: "OUTPUT_SCHEMA",
        title: "Output contract",
        status: output.valid ? "PASS" : "FAIL",
        detail: output.errors.length
          ? output.errors.join("\n")
          : "输出契约校验通过",
      });
      if (!output.valid) return this.block(order, output.errors.join("；"));
      const directory = join(this.dataDirectory, "deliverables", order.id);
      await mkdir(directory, { recursive: true });
      const filePath = join(directory, `${safe(order.title)}.md`);
      await writeFile(filePath, parsed.finalResponse, "utf8");
      const checksum = createHash("sha256")
        .update(parsed.finalResponse)
        .digest("hex");
      this.db.createDeliverable(
        order.id,
        run.id,
        order.title,
        parsed.finalResponse,
        filePath,
        checksum,
      );
      this.db.addEvidence(run.id, {
        type: "DELIVERY",
        title: filePath,
        status: "PASS",
        detail: JSON.stringify({
          bytes: Buffer.byteLength(parsed.finalResponse),
          sha256: checksum,
        }),
      });
      evidence = this.db.getRun(run.id)?.evidence ?? [];
      const missing = order.requiredEvidence.filter(
        (type) =>
          !evidence.some(
            (item) => item.type === type && item.status === "PASS",
          ),
      );
      if (missing.length)
        return this.block(
          order,
          missing.includes("SOURCE")
            ? "未提供可核验来源"
            : `缺少通过的 Evidence：${missing.join("、")}`,
        );
      this.db.updateWorkOrder(order.id, "SUCCEEDED");
      this.db.createMemory({
        agentId: agent.id,
        scope: "EPISODE",
        scopeId: order.id,
        kind: "LESSON",
        title: `工作单 #${order.number}：${order.title}`,
        content: parsed.finalResponse.slice(0, 1800),
        tags: ["work-order", ...order.constraints.slice(0, 3)],
        confidence: 0.8,
        sourceType: "RUN",
        sourceId: run.id,
        supersedesId: null,
        expiresAt: null,
        provenance: "TRUSTED",
        activate: true,
      });
      this.publish({ type: "run.status", runId: run.id, status: "COMPLETED" });
      this.changed();
    } catch (error) {
      this.active.delete(run.id);
      if (this.interrupted.delete(run.id)) return;
      this.db.updateRun(run.id, {
        status: "FAILED",
        endedAt: new Date().toISOString(),
        finalResponse: error instanceof Error ? error.message : String(error),
      });
      this.fail(order, error instanceof Error ? error.message : String(error));
    }
  }

  private block(order: WorkOrder, reason: string): void {
    this.db.updateWorkOrder(order.id, "BLOCKED", { reason });
    this.notify(order, "WORKORDER_BLOCKED", "工作单已阻塞", reason);
    this.changed();
  }
  private fail(order: WorkOrder, reason: string): void {
    this.db.updateWorkOrder(order.id, "FAILED", { reason });
    this.notify(order, "WORKORDER_FAILED", "工作单执行失败", reason);
    this.changed();
  }
  private notify(
    order: WorkOrder,
    event: "WORKORDER_BLOCKED" | "WORKORDER_FAILED",
    title: string,
    body: string,
  ): void {
    this.db.notify({
      event,
      subjectType: "WORK_ORDER",
      subjectId: order.id,
      title: `${title}：#${order.number} ${order.title}`,
      body,
      channel: "IN_APP",
      dedupeKey: `${event}:${order.id}:${new Date().toISOString().slice(0, 13)}`,
    });
  }
  private requireOrder(id: string): WorkOrder {
    const value = this.db.getWorkOrder(id);
    if (!value) throw new Error("工作单不存在");
    return value;
  }
  private requireAgent(id: string): Agent {
    const value = this.db.getAgent(id);
    if (!value) throw new Error("Agent 不存在");
    return value;
  }
}

const intersectPermissions = (
  a: PermissionSet,
  b: PermissionSet,
): PermissionSet => ({
  read: a.read && b.read,
  write: a.write && b.write,
  shell: a.shell && b.shell,
  git: a.git && b.git,
  network: a.network && b.network,
});
const capabilityMap: Record<string, keyof PermissionSet | undefined> = {
  "fs.read": "read",
  "fs.write": "write",
  "shell.exec": "shell",
  "git.read": "git",
  "git.write": "git",
  "net.fetch": "network",
};
const hasCapability = (
  permissions: PermissionSet,
  capability: string,
): boolean => {
  const key = capabilityMap[capability];
  return key ? permissions[key] : false;
};
const validDate = (value: string): boolean =>
  Number.isFinite(Date.parse(value));
const safe = (value: string): string =>
  value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100) || "deliverable";
