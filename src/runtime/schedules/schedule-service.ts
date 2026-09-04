import { createHash, randomUUID } from "node:crypto";
import type { AppDatabase } from "../../main/database";
import type {
  CreateScheduleInput,
  CreateWorkOrderInput,
  Schedule,
  WorkOrder,
} from "../../shared/contracts";
import type { WorkOrderService } from "../work-orders/work-order-service";
import {
  nextCronOccurrence,
  renderScheduleTemplate,
} from "./schedule-calculator";

export class ScheduleService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private readonly leaseOwner = `runtime-${randomUUID()}`;

  constructor(
    private db: AppDatabase,
    private workOrders: WorkOrderService,
    private changed: () => void,
  ) {}

  start(): void {
    if (!this.timer) {
      this.timer = setInterval(() => void this.poll(), 20_000);
      void this.poll();
    }
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  create(input: CreateScheduleInput): Schedule {
    if (!input.name.trim()) throw new Error("计划名称不能为空");
    if (input.concurrencyPolicy === "REPLACE")
      throw new Error(
        "REPLACE 会取消上一张工作单，首版暂不开放；请使用 SKIP 或 QUEUE",
      );
    if (input.workOrderTemplate.ownerAgentId !== input.ownerAgentId)
      throw new Error("计划负责人和工作单模板负责人必须一致");
    const next = nextCronOccurrence(
      input.cronExpression,
      input.timezone,
      new Date(),
    ).toISOString();
    const value = this.db.createSchedule(
      {
        ...input,
        maxCatchUpRuns: Math.min(20, Math.max(1, input.maxCatchUpRuns)),
      },
      next,
    );
    this.changed();
    return value;
  }

  setEnabled(id: string, enabled: boolean): void {
    if (!this.db.getSchedule(id)) throw new Error("计划不存在");
    this.db.setScheduleEnabled(id, enabled);
    this.changed();
  }

  async testRun(id: string): Promise<WorkOrder> {
    const schedule = this.requireSchedule(id);
    const scheduledFor = new Date();
    const order = this.createOrder(
      schedule,
      scheduledFor,
      `test:${scheduledFor.toISOString()}`,
    );
    await this.workOrders.start(order.id);
    this.changed();
    return order;
  }

  async poll(at = new Date()): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const schedule of this.db.listDueSchedules(at.toISOString())) {
        const leaseExpiresAt = new Date(at.getTime() + 60_000).toISOString();
        if (
          !this.db.claimSchedule(
            schedule.id,
            this.leaseOwner,
            at.toISOString(),
            leaseExpiresAt,
          )
        )
          continue;
        await this.fire(schedule, at);
      }
    } finally {
      this.polling = false;
    }
  }

  private async fire(schedule: Schedule, now: Date): Promise<void> {
    const scheduledFor = new Date(schedule.nextRunAt);
    const late = now.getTime() - scheduledFor.getTime() > 90_000;
    const next = nextCronOccurrence(
      schedule.cronExpression,
      schedule.timezone,
      late ? now : scheduledFor,
    ).toISOString();
    if (
      schedule.concurrencyPolicy === "SKIP" &&
      this.db.hasActiveScheduleWork(schedule.id)
    ) {
      this.db.createScheduleExecution(
        schedule.id,
        scheduledFor.toISOString(),
        null,
        "SKIPPED",
        "上一张工作单尚未结束",
      );
      this.db.advanceSchedule(schedule.id, scheduledFor.toISOString(), next);
      this.changed();
      return;
    }
    if (late && schedule.misfirePolicy === "SKIP") {
      this.db.createScheduleExecution(
        schedule.id,
        scheduledFor.toISOString(),
        null,
        "SKIPPED",
        "错过执行时间，按 SKIP 策略跳过",
      );
      this.db.advanceSchedule(schedule.id, scheduledFor.toISOString(), next);
      this.changed();
      return;
    }
    try {
      const occurrences = [scheduledFor];
      if (
        late &&
        schedule.misfirePolicy === "RUN_ALL_BOUNDED" &&
        schedule.concurrencyPolicy === "QUEUE"
      ) {
        let cursor = scheduledFor;
        while (occurrences.length < schedule.maxCatchUpRuns) {
          cursor = nextCronOccurrence(
            schedule.cronExpression,
            schedule.timezone,
            cursor,
          );
          if (cursor > now) break;
          occurrences.push(cursor);
        }
      }
      for (const occurrence of occurrences) {
        const order = this.createOrder(schedule, occurrence);
        this.db.createScheduleExecution(
          schedule.id,
          occurrence.toISOString(),
          order.id,
          "CREATED",
        );
        await this.workOrders.start(order.id);
      }
      this.db.advanceSchedule(
        schedule.id,
        occurrences.at(-1)!.toISOString(),
        next,
      );
      this.changed();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.createScheduleExecution(
        schedule.id,
        scheduledFor.toISOString(),
        null,
        "FAILED",
        message,
      );
      this.db.advanceSchedule(schedule.id, scheduledFor.toISOString(), next);
      this.db.notify({
        event: "SCHEDULE_MISFIRE",
        subjectType: "SCHEDULE",
        subjectId: schedule.id,
        title: `计划执行失败：${schedule.name}`,
        body: message,
        channel: "IN_APP",
        dedupeKey: `SCHEDULE_MISFIRE:${schedule.id}:${scheduledFor.toISOString()}`,
      });
      this.changed();
    }
  }

  private createOrder(
    schedule: Schedule,
    scheduledFor: Date,
    customKey?: string,
  ): WorkOrder {
    const template = renderScheduleTemplate(
      schedule.workOrderTemplate,
      scheduledFor,
      schedule.timezone,
      schedule.lastScheduledAt,
    ) as CreateWorkOrderInput;
    const key = createHash("sha256")
      .update(customKey ?? `${schedule.id}:${scheduledFor.toISOString()}`)
      .digest("hex");
    return this.workOrders.create({
      ...template,
      ownerAgentId: schedule.ownerAgentId,
      createdByType: "SCHEDULE",
      createdById: schedule.id,
      scheduleId: schedule.id,
      idempotencyKey: key,
    });
  }

  private requireSchedule(id: string): Schedule {
    const value = this.db.getSchedule(id);
    if (!value) throw new Error("计划不存在");
    return value;
  }
}
