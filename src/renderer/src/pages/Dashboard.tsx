import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  MessageCircleMore,
  PlayCircle,
  Plus,
  Users,
} from "lucide-react";
import { useAppStore } from "../store";
import { WORKFLOW_LABELS, phasesFor } from "../../../shared/workflows";
import { statusLabel } from "../status-labels";

export default function Dashboard({
  onNew,
  onNewChat,
  onOpen,
}: {
  onNew(): void;
  onNewChat(): void;
  onOpen(id: string): void;
}): import("react").JSX.Element {
  const { snapshot } = useAppStore();
  const running = snapshot.changes.filter((c) => c.status === "RUNNING").length;
  const waiting = snapshot.changes.filter(
    (c) => c.status === "WAITING_HUMAN",
  ).length;
  const done = snapshot.changes.filter((c) => c.status === "DONE").length;
  const failed = snapshot.changes.filter((c) =>
    ["FAILED", "BLOCKED"].includes(c.status),
  ).length;
  return (
    <section className="page dashboard">
      <header className="page-header">
        <div>
          <h1>下午好，Max</h1>
          <p>Agent Teams · AI Team Runtime</p>
        </div>
        <div className="page-actions">
          <button className="secondary" onClick={onNewChat}>
            <MessageCircleMore />
            新建聊天
          </button>
          <button className="primary" onClick={onNew}>
            <Plus />
            新建任务
          </button>
        </div>
      </header>
      <div className="metric-grid">
        <Metric
          icon={<PlayCircle />}
          label="运行中"
          value={running}
          tone="blue"
        />
        <Metric
          icon={<Clock3 />}
          label="等待人工"
          value={waiting}
          tone="amber"
        />
        <Metric
          icon={<CheckCircle2 />}
          label="今日完成"
          value={done}
          tone="green"
        />
        <Metric
          icon={<AlertCircle />}
          label="失败/终止"
          value={failed}
          tone="red"
        />
      </div>
      <div className="section-title">
        <h2>任务看板概览</h2>
        <span>实时状态来自本地 Runtime</span>
      </div>
      {snapshot.changes.length ? (
        <div className="task-card-grid">
          {snapshot.changes.slice(0, 5).map((change) => {
            const phases = phasesFor(change.workflowType, change.currentPhase);
            const pct = Math.round(
              (change.currentPhase / (phases.length - 1)) * 100,
            );
            return (
              <button
                key={change.id}
                className="task-card"
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
                  #{change.number} · {phases[change.currentPhase]?.name}
                </p>
                <div className="mini-agents">
                  <Users />
                  {change.agentIds.length} Agents · {change.workspaceIds.length}{" "}
                  Workspaces
                </div>
                <div className="progress">
                  <i style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty hero-empty">
          <div className="empty-illustration">◎</div>
          <h3>还没有任务</h3>
          <p>
            添加本地代码目录和真实 Coding Agent，创建第一支 AI Native Team。
          </p>
          <button className="primary" onClick={onNew}>
            <Plus />
            新建任务
          </button>
        </div>
      )}
      <div className="section-title">
        <h2>最近活动</h2>
        <span>{snapshot.runs.length} 个 Run 已记录</span>
      </div>
      <div className="activity-table">
        <div className="table-head">
          <span>任务</span>
          <span>Agent</span>
          <span>运行时</span>
          <span>状态</span>
          <span>证据</span>
        </div>
        {snapshot.runs.slice(0, 6).map((run) => {
          const change = snapshot.changes.find((c) => c.id === run.changeId);
          const agent = snapshot.agents.find((a) => a.id === run.agentId);
          return (
            <div className="table-row" key={run.id}>
              <span>
                #{change?.number} {change?.title}
              </span>
              <span>{agent?.name}</span>
              <span>{run.runtime}</span>
              <span>
                <b className={`status ${run.status.toLowerCase()}`}>
                  {statusLabel(run.status)}
                </b>
              </span>
              <span>{run.evidence.length} 项</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: import("react").JSX.Element;
  label: string;
  value: number;
  tone: string;
}): import("react").JSX.Element {
  return (
    <div className={`metric ${tone}`}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
