import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  LoaderCircle,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import type { Evidence } from "../../../shared/contracts";
import { errorText, useAppStore } from "../store";
import { statusLabel } from "../status-labels";

export default function WorkOrders({
  onOpen,
}: {
  onOpen(id: string): void;
}): import("react").JSX.Element {
  const { snapshot, notify } = useAppStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    goal: "",
    ownerAgentId: snapshot.agents[0]?.id ?? "",
    workspaceId: "",
    skillVersionId: "",
    input: "{}",
    constraints: "",
    sections: "核心结论\n证据与来源\n下一步",
    mustCite: true,
    network: true,
  });
  async function create(): Promise<void> {
    setBusy(true);
    try {
      const required: Evidence["type"][] = [
        "RUNTIME",
        "OUTPUT_SCHEMA",
        "DELIVERY",
        ...(form.mustCite
          ? ["SOURCE" as const, "DATA_FRESHNESS" as const]
          : []),
      ];
      const order = await window.moxt.createWorkOrder({
        title: form.title,
        goal: form.goal,
        ownerAgentId: form.ownerAgentId,
        workspaceId: form.workspaceId || null,
        projectScopeId: form.workspaceId || null,
        skillVersionIds: form.skillVersionId ? [form.skillVersionId] : [],
        input: JSON.parse(form.input || "{}"),
        constraints: form.constraints.split("\n").filter(Boolean),
        outputContract: {
          requiredSections: form.sections.split("\n").filter(Boolean),
          mustCite: form.mustCite,
        },
        requiredEvidence: required,
        permissions: {
          read: true,
          write: false,
          shell: true,
          git: true,
          network: form.network,
        },
      });
      await window.moxt.controlWorkOrder(order.id, "start");
      setOpen(false);
      onOpen(order.id);
    } catch (error) {
      notify("error", errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>工作单</h1>
          <p>
            面向调研、运营、内容和分析的独立执行主体；不再伪装成代码 Change。
          </p>
        </div>
        <button className="primary" onClick={() => setOpen(true)}>
          <Plus />
          新建工作单
        </button>
      </header>
      <div className="workorder-metrics">
        <div>
          <BriefcaseBusiness />
          <span>全部工作单</span>
          <strong>{snapshot.workOrders.length}</strong>
        </div>
        <div>
          <LoaderCircle />
          <span>正在执行</span>
          <strong>
            {
              snapshot.workOrders.filter((item) =>
                ["QUEUED", "RUNNING", "VERIFYING"].includes(item.status),
              ).length
            }
          </strong>
        </div>
        <div>
          <ShieldCheck />
          <span>待处理</span>
          <strong>
            {
              snapshot.workOrders.filter((item) =>
                ["BLOCKED", "WAITING_APPROVAL"].includes(item.status),
              ).length
            }
          </strong>
        </div>
        <div>
          <CalendarClock />
          <span>计划产生</span>
          <strong>
            {
              snapshot.workOrders.filter(
                (item) => item.createdByType === "SCHEDULE",
              ).length
            }
          </strong>
        </div>
      </div>
      <div className="workorder-list">
        {snapshot.workOrders.map((item) => {
          const owner = snapshot.agents.find(
            (agent) => agent.id === item.ownerAgentId,
          );
          return (
            <button onClick={() => onOpen(item.id)} key={item.id}>
              <span className="agent-avatar">{owner?.icon || "A"}</span>
              <div>
                <header>
                  <strong>
                    #{item.number} · {item.title}
                  </strong>
                  <span className={`status ${item.status.toLowerCase()}`}>
                    {statusLabel(item.status)}
                  </span>
                </header>
                <p>{item.goal}</p>
                <small>
                  {owner?.name} ·{" "}
                  {item.createdByType === "SCHEDULE" ? "定时计划" : "人工创建"}
                  {item.statusReason ? ` · ${item.statusReason}` : ""}
                </small>
              </div>
              <ArrowRight />
            </button>
          );
        })}
        {!snapshot.workOrders.length && (
          <div className="empty">
            <BriefcaseBusiness />
            <h3>还没有工作单</h3>
            <p>先创建一张可验收的真实工作单。</p>
          </div>
        )}
      </div>
      {open && (
        <div className="modal-backdrop">
          <div className="modal wide-modal">
            <header>
              <div>
                <h2>新建工作单</h2>
                <p>
                  明确负责人、结果、输入与证据要求；创建后使用独立 Session。
                </p>
              </div>
              <button onClick={() => setOpen(false)}>
                <X />
              </button>
            </header>
            <div className="form-grid">
              <label>
                标题
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label>
                负责人
                <select
                  value={form.ownerAgentId}
                  onChange={(e) =>
                    setForm({ ...form, ownerAgentId: e.target.value })
                  }
                >
                  {snapshot.agents.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} ·{" "}
                      {
                        snapshot.agentProfiles.find(
                          (p) => p.agentId === item.id,
                        )?.positionTitle
                      }
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                最终要完成的结果
                <textarea
                  value={form.goal}
                  onChange={(e) => setForm({ ...form, goal: e.target.value })}
                />
              </label>
              <label>
                项目空间（可选）
                <select
                  value={form.workspaceId}
                  onChange={(e) =>
                    setForm({ ...form, workspaceId: e.target.value })
                  }
                >
                  <option value="">使用隔离工作目录</option>
                  {snapshot.workspaces.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                工作方法（可选）
                <select
                  value={form.skillVersionId}
                  onChange={(e) =>
                    setForm({ ...form, skillVersionId: e.target.value })
                  }
                >
                  <option value="">不指定 Skill</option>
                  {snapshot.skillVersions
                    .filter((item) => item.status === "VERIFIED")
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {
                          snapshot.skills.find(
                            (skill) => skill.id === item.skillId,
                          )?.name
                        }{" "}
                        · v{item.version}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                输入数据（JSON）
                <textarea
                  value={form.input}
                  onChange={(e) => setForm({ ...form, input: e.target.value })}
                />
              </label>
              <label>
                限制条件（每行一条）
                <textarea
                  value={form.constraints}
                  onChange={(e) =>
                    setForm({ ...form, constraints: e.target.value })
                  }
                />
              </label>
              <label>
                必需章节（每行一条）
                <textarea
                  value={form.sections}
                  onChange={(e) =>
                    setForm({ ...form, sections: e.target.value })
                  }
                />
              </label>
              <div className="permission-options">
                <label>
                  <input
                    type="checkbox"
                    checked={form.mustCite}
                    onChange={(e) =>
                      setForm({ ...form, mustCite: e.target.checked })
                    }
                  />
                  要求可核验来源和数据时间
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.network}
                    onChange={(e) =>
                      setForm({ ...form, network: e.target.checked })
                    }
                  />
                  允许网络读取
                </label>
              </div>
            </div>
            <footer>
              <button className="secondary" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                className="primary"
                disabled={
                  busy || !form.title || !form.goal || !form.ownerAgentId
                }
                onClick={() => void create()}
              >
                {busy ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <BriefcaseBusiness />
                )}
                创建并启动
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
