import {
  ArrowLeft,
  FileText,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { WorkOrder } from "../../../shared/contracts";
import { errorText, useAppStore } from "../store";
import { statusLabel } from "../status-labels";

export default function WorkOrderRoom({
  order,
  onBack,
}: {
  order: WorkOrder;
  onBack(): void;
}): import("react").JSX.Element {
  const { snapshot, live, notify } = useAppStore();
  const owner = snapshot.agents.find((item) => item.id === order.ownerAgentId);
  const runs = snapshot.runs.filter((item) => item.workOrderId === order.id);
  const run = runs.find((item) => item.id === order.currentRunId) ?? runs[0];
  const deliverable = snapshot.deliverables.find(
    (item) => item.workOrderId === order.id,
  );
  async function control(
    action: "pause" | "resume" | "cancel" | "retry",
  ): Promise<void> {
    try {
      await window.moxt.controlWorkOrder(order.id, action);
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  return (
    <section className="workorder-room">
      <header>
        <button className="icon-btn" onClick={onBack}>
          <ArrowLeft />
        </button>
        <div>
          <span>工作单 #{order.number}</span>
          <h1>{order.title}</h1>
          <p>{order.goal}</p>
        </div>
        <div className="room-actions">
          <span className={`status ${order.status.toLowerCase()}`}>
            {statusLabel(order.status)}
          </span>
          {["QUEUED", "RUNNING", "VERIFYING"].includes(order.status) && (
            <button className="secondary" onClick={() => void control("pause")}>
              <Pause />
              暂停
            </button>
          )}
          {order.status === "BLOCKED" && (
            <button className="primary" onClick={() => void control("resume")}>
              <Play />
              修正后继续
            </button>
          )}
          {["FAILED", "BLOCKED"].includes(order.status) && (
            <button className="secondary" onClick={() => void control("retry")}>
              <RefreshCw />
              重试
            </button>
          )}{" "}
          {!["SUCCEEDED", "CANCELLED"].includes(order.status) && (
            <button
              className="secondary danger"
              onClick={() => void control("cancel")}
            >
              <XCircle />
              取消
            </button>
          )}
        </div>
      </header>
      <div className="workorder-body">
        <aside>
          <h3>执行信息</h3>
          <dl>
            <dt>负责人</dt>
            <dd>{owner?.name}</dd>
            <dt>创建来源</dt>
            <dd>{order.createdByType}</dd>
            <dt>Session</dt>
            <dd>
              {snapshot.agentSessions
                .find((item) => item.workOrderId === order.id)
                ?.id.slice(0, 8) || "尚未建立"}
            </dd>
            <dt>Skill 版本</dt>
            <dd>
              {order.skillVersionIds.length
                ? order.skillVersionIds.map((id) => id.slice(0, 8)).join("、")
                : "未指定"}
            </dd>
          </dl>
          <h3>状态说明</h3>
          <p className="blocking-reason">
            {order.statusReason || "当前没有阻塞原因。"}
          </p>
          <h3>约束</h3>
          {order.constraints.map((item) => (
            <p key={item}>• {item}</p>
          ))}
        </aside>
        <main>
          <div className="workorder-tabs">
            <span className="active">业务交付</span>
            <span>Runtime 与 Evidence</span>
          </div>
          {deliverable ? (
            <article className="deliverable-document">
              <header>
                <FileText />
                <div>
                  <strong>{deliverable.title}</strong>
                  <small>
                    sha256 {deliverable.sha256?.slice(0, 12)} ·
                    已写入本地交付目录
                  </small>
                </div>
              </header>
              <div className="markdown">
                <ReactMarkdown>{deliverable.content}</ReactMarkdown>
              </div>
            </article>
          ) : (
            <div className="runtime-panel">
              <header>
                <strong>
                  {run ? `Run ${run.id.slice(0, 8)}` : "等待启动"}
                </strong>
                <span>{run ? statusLabel(run.status) : ""}</span>
              </header>
              <pre>
                {run
                  ? (
                      live[run.id] ||
                      run.stdout ||
                      run.stderr ||
                      "Runtime 正在启动…"
                    ).slice(-16000)
                  : "完成岗位、权限和输入预检后才会启动真实 Runtime。"}
              </pre>
            </div>
          )}
          <section className="evidence-board">
            <h3>
              <ShieldCheck />
              验收证据
            </h3>
            {run?.evidence.map((item) => (
              <article key={item.id}>
                <span
                  className={`evidence-status ${item.status.toLowerCase()}`}
                >
                  {statusLabel(item.status)}
                </span>
                <div>
                  <strong>
                    {item.type} · {item.title}
                  </strong>
                  <p>{item.detail.slice(0, 1000)}</p>
                </div>
              </article>
            ))}
          </section>
        </main>
      </div>
    </section>
  );
}
