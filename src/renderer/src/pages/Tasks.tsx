import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  LayoutTemplate,
  PlayCircle,
  Plus,
  Users,
} from "lucide-react";
import { WORKFLOW_LABELS, phasesFor } from "../../../shared/workflows";
import { useAppStore } from "../store";
import { statusLabel } from "../status-labels";

export default function Tasks({
  onNew,
  onOpen,
  onOpenWorkflows,
}: {
  onNew(): void;
  onOpen(id: string): void;
  onOpenWorkflows(): void;
}): import("react").JSX.Element {
  const { snapshot } = useAppStore();
  const counts = {
    running: snapshot.changes.filter((item) => item.status === "RUNNING")
      .length,
    waiting: snapshot.changes.filter((item) =>
      ["WAITING_HUMAN", "BLOCKED"].includes(item.status),
    ).length,
    completed: snapshot.changes.filter((item) => item.status === "DONE").length,
    failed: snapshot.changes.filter((item) => item.status === "FAILED").length,
  };

  return (
    <section className="page task-center-page">
      <header className="page-header">
        <div>
          <h1>任务中心</h1>
          <p>统一查看正式任务、运行状态、执行团队和 Evidence 验收结果。</p>
        </div>
        <div className="page-actions">
          <button className="secondary" onClick={onOpenWorkflows}>
            <LayoutTemplate />
            工作流模板
          </button>
          <button className="primary" onClick={onNew}>
            <Plus />
            新建任务
          </button>
        </div>
      </header>

      <div className="task-center-metrics">
        <TaskMetric
          icon={<PlayCircle />}
          label="运行中"
          value={counts.running}
        />
        <TaskMetric icon={<Clock3 />} label="等待处理" value={counts.waiting} />
        <TaskMetric
          icon={<CheckCircle2 />}
          label="已完成"
          value={counts.completed}
        />
        <TaskMetric icon={<AlertCircle />} label="失败" value={counts.failed} />
      </div>

      <div className="section-title">
        <h2>全部任务</h2>
        <span>{snapshot.changes.length} 个任务</span>
      </div>
      {snapshot.changes.length ? (
        <div className="task-card-grid">
          {snapshot.changes.map((change) => {
            const phases = phasesFor(change.workflowType, change.currentPhase);
            const denominator = Math.max(1, phases.length - 1);
            const progress = Math.min(
              100,
              Math.round((change.currentPhase / denominator) * 100),
            );
            return (
              <button
                className="task-card"
                key={change.id}
                onClick={() => onOpen(change.id)}
              >
                <div className="task-top">
                  <span className="chip">
                    {WORKFLOW_LABELS[change.workflowType].name}
                  </span>
                  <ArrowRight />
                </div>
                <h3>{change.title}</h3>
                <p>
                  #{change.number} ·{" "}
                  {phases[change.currentPhase]?.name ?? "待开始"}
                </p>
                <div className="task-center-meta">
                  <span className={`status ${change.status.toLowerCase()}`}>
                    {statusLabel(change.status)}
                  </span>
                  <span>
                    <Users /> {change.agentIds.length} 个 Agent ·{" "}
                    {change.workspaceIds.length} 个工作空间
                  </span>
                </div>
                <div className="progress">
                  <i style={{ width: `${progress}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty hero-empty">
          <div className="empty-illustration">◎</div>
          <h3>还没有正式任务</h3>
          <p>创建任务后，运行过程、会话、证据和验收结果都会集中在这里。</p>
          <button className="primary" onClick={onNew}>
            <Plus /> 新建任务
          </button>
        </div>
      )}
    </section>
  );
}

function TaskMetric({
  icon,
  label,
  value,
}: {
  icon: import("react").JSX.Element;
  label: string;
  value: number;
}): import("react").JSX.Element {
  return (
    <div>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
