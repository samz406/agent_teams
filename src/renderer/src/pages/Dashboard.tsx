import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  MessageCircleMore,
  Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { statusLabel } from "../status-labels";
import { dateTime, localDate, recent, taskSummary } from "../workbench";

export default function Dashboard({
  onNew,
  onNewChat,
  onOpen,
  onOpenOrder,
  onSchedules,
  onConversation,
}: {
  onNew(): void;
  onNewChat(): void;
  onOpen(
    id: string,
    tab?: "chat" | "workflow" | "artifacts",
    artifactId?: string,
  ): void;
  onOpenOrder(id: string): void;
  onSchedules(): void;
  onConversation(id: string): void;
}): import("react").JSX.Element {
  const { snapshot } = useAppStore();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const tasks = recent(snapshot.changes);
  const orders = recent(snapshot.workOrders);
  const attention = tasks.filter((t) =>
    ["WAITING_HUMAN", "BLOCKED", "FAILED"].includes(t.status),
  );
  const attentionOrders = orders.filter((t) =>
    ["WAITING_APPROVAL", "BLOCKED", "FAILED"].includes(t.status),
  );
  const running = tasks.filter((t) =>
    ["INITIALIZING", "RUNNING"].includes(t.status),
  );
  const runningOrders = orders.filter((t) =>
    ["QUEUED", "RUNNING", "VERIFYING"].includes(t.status),
  );
  const waiting = attention.length + attentionOrders.length;
  const today =
    tasks.filter((t) => t.status === "DONE" && localDate(t.updatedAt, now))
      .length +
    orders.filter(
      (t) => t.status === "SUCCEEDED" && localDate(t.completedAt, now),
    ).length;
  const deliveries = [
    ...snapshot.artifacts
      .filter((a) => a.status !== "DEPRECATED")
      .map((a) => ({
        id: a.id,
        title: a.title,
        createdAt: a.createdAt,
        label: `方案 v${a.version} · ${statusLabel(a.status)}`,
        open: () => onOpen(a.changeId, "artifacts", a.id),
      })),
    ...snapshot.deliverables.map((a) => ({
      id: a.id,
      title: a.title,
      createdAt: a.createdAt,
      label: "工作单交付",
      open: () => onOpenOrder(a.workOrderId),
    })),
    ...snapshot.conversationDeliverables.map((a) => ({
      id: a.id,
      title: a.title,
      createdAt: a.createdAt,
      label: "讨论产物",
      open: () => onConversation(a.conversationId),
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  const schedules = snapshot.schedules
    .filter((s) => s.enabled)
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))
    .slice(0, 3);
  return (
    <section className="page dashboard">
      <header className="page-header">
        <div>
          <div className="eyebrow">我的 AI 团队</div>
          <h1>工作台</h1>
          <p>
            {waiting
              ? `${waiting} 项工作需要你处理，其余进展在这里汇总。`
              : "查看团队进展、交付成果与下一次自动执行。"}
          </p>
        </div>
        <div className="page-actions">
          <button className="secondary" onClick={onNewChat}>
            <MessageCircleMore />
            发起讨论
          </button>
          <button className="primary" onClick={onNew}>
            <Plus />
            新建任务
          </button>
        </div>
      </header>
      <div className="workbench-summary">
        <span>
          进行中 <strong>{running.length + runningOrders.length}</strong>
        </span>
        <span>
          待你处理 <strong>{waiting}</strong>
        </span>
        <span title="按本机日期统计：协作任务完成状态更新时间、工作单完成时间">
          今日完成 <strong>{today}</strong>
        </span>
      </div>
      <div className="section-title">
        <h2>需要你处理</h2>
        <span>审阅、阻塞与异常</span>
      </div>
      <div className="attention-list">
        {attention.map((t) => (
          <button
            className="attention-row"
            key={t.id}
            onClick={() =>
              onOpen(
                t.id,
                t.status === "WAITING_HUMAN" &&
                  snapshot.artifacts.some(
                    (a) => a.changeId === t.id && a.status === "REVIEW",
                  )
                  ? "artifacts"
                  : "workflow",
              )
            }
          >
            <div>
              <strong>{t.title}</strong>
              <p>{taskSummary(t, snapshot)}</p>
              <small>协作任务 · #{t.number}</small>
            </div>
            <span>
              去处理 <ArrowRight />
            </span>
          </button>
        ))}
        {attentionOrders.map((t) => (
          <button
            className="attention-row"
            key={t.id}
            onClick={() => onOpenOrder(t.id)}
          >
            <div>
              <strong>{t.title}</strong>
              <p>{t.statusReason || statusLabel(t.status)}</p>
              <small>岗位工作单 · #{t.number}</small>
            </div>
            <span>
              去处理 <ArrowRight />
            </span>
          </button>
        ))}
        {!waiting && (
          <div className="quiet-empty">
            <CheckCircle2 />
            当前没有需要你处理的事项
          </div>
        )}
      </div>
      <div className="section-title">
        <h2>正在推进</h2>
        <span>按最近更新排序</span>
      </div>
      <div className="list-card">
        {running.map((t) => (
          <button className="work-row" key={t.id} onClick={() => onOpen(t.id)}>
            <div>
              <strong>{t.title}</strong>
              <small>
                {taskSummary(t, snapshot)} · {t.agentIds.length} 名 Agent ·{" "}
                {dateTime(t.updatedAt)}
              </small>
            </div>
            <span className={`status ${t.status.toLowerCase()}`}>
              {statusLabel(t.status)}
            </span>
            <ArrowRight />
          </button>
        ))}
        {runningOrders.map((t) => (
          <button
            className="work-row"
            key={t.id}
            onClick={() => onOpenOrder(t.id)}
          >
            <div>
              <strong>{t.title}</strong>
              <small>
                {snapshot.agents.find((a) => a.id === t.ownerAgentId)?.name} ·
                岗位工作单 · {dateTime(t.updatedAt)}
              </small>
            </div>
            <span className={`status ${t.status.toLowerCase()}`}>
              {statusLabel(t.status)}
            </span>
            <ArrowRight />
          </button>
        ))}
        {!running.length && !runningOrders.length && (
          <div className="quiet-empty">
            暂无正在执行的工作。
            <button className="secondary" onClick={onNew}>
              创建任务
            </button>
          </div>
        )}
      </div>
      <div className="workbench-columns">
        <section>
          <div className="section-title">
            <h2>最新交付</h2>
          </div>
          <div className="list-card">
            {deliveries.map((d) => (
              <button className="work-row" key={d.id} onClick={d.open}>
                <FileText />
                <div>
                  <strong>{d.title}</strong>
                  <small>
                    {d.label} · {dateTime(d.createdAt)}
                  </small>
                </div>
                <ArrowRight />
              </button>
            ))}
            {!deliveries.length && (
              <div className="quiet-empty">
                团队生成的方案、报告与讨论产物会显示在这里。
              </div>
            )}
          </div>
        </section>
        <section>
          <div className="section-title">
            <h2>下一次自动执行</h2>
            <button className="text-button" onClick={onSchedules}>
              管理计划
            </button>
          </div>
          <div className="list-card">
            {schedules.map((s) => (
              <button className="work-row" key={s.id} onClick={onSchedules}>
                <CalendarClock />
                <div>
                  <strong>{s.name}</strong>
                  <small>{dateTime(s.nextRunAt)} · 本机时间</small>
                  <small>
                    {snapshot.agents.find((a) => a.id === s.ownerAgentId)?.name}{" "}
                    · 计划时区 {s.timezone}
                  </small>
                </div>
              </button>
            ))}
            {!schedules.length && (
              <div className="quiet-empty">
                暂无启用的计划。
                <button className="secondary" onClick={onSchedules}>
                  设置定时计划
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
