import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FolderGit2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { WorkflowType } from "../../../shared/contracts";
import { WORKFLOW_LABELS, WORKFLOWS } from "../../../shared/workflows";
import { errorText, useAppStore } from "../store";
import { recommendWorkflow, taskPreflight } from "../workbench";

export default function NewTask({
  onCreated,
}: {
  onCreated(id: string): void;
}): import("react").JSX.Element {
  const { snapshot, notify } = useAppStore();
  const [step, setStep] = useState(1);
  const [manualWorkflow, setManualWorkflow] = useState<WorkflowType | null>(
    null,
  );
  const [form, setForm] = useState({
    title: "",
    description: "",
    acceptance: "",
    tags: "",
    roomId: "",
  });
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [bindingMap, setBindingMap] = useState<
    Record<string, { workspaceId: string; write: boolean }>
  >({});
  const [creating, setCreating] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [runtimes, setRuntimes] = useState(snapshot.runtimes);
  const [addedWorkspaces, setAddedWorkspaces] = useState(snapshot.workspaces);
  const workspaces = [
    ...new Map(
      [...addedWorkspaces, ...snapshot.workspaces].map((w) => [w.id, w]),
    ).values(),
  ];
  const selectedWorkspaces = workspaces.filter((w) =>
    workspaceIds.includes(w.id),
  );
  const selectedAgents = snapshot.agents.filter((a) => agentIds.includes(a.id));
  const recommendation = recommendWorkflow(`${form.title} ${form.description}`);
  const workflow = manualWorkflow ?? recommendation;
  // Display, preflight and submission all use the same resolved binding.
  const bindings = Object.fromEntries(
    selectedAgents.map((agent) => [
      agent.id,
      {
        workspaceId: workspaceIds.includes(bindingMap[agent.id]?.workspaceId)
          ? bindingMap[agent.id].workspaceId
          : (workspaceIds[0] ?? ""),
        write: bindingMap[agent.id]?.write ?? agent.permissions.write,
      },
    ]),
  );
  const errors = taskPreflight(
    selectedAgents,
    selectedWorkspaces,
    runtimes,
    bindings,
  );
  const goalValid = Boolean(
    form.title.trim() && form.description.trim() && form.acceptance.trim(),
  );
  async function addWorkspace(): Promise<void> {
    try {
      const value = await window.moxt.selectWorkspace();
      if (value) {
        setAddedWorkspaces((ws) => [
          ...ws.filter((w) => w.id !== value.id),
          value,
        ]);
        setWorkspaceIds((ids) => [...new Set([...ids, value.id])]);
      }
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  async function detect(): Promise<void> {
    setDetecting(true);
    try {
      setRuntimes(await window.moxt.detectRuntimes());
    } catch (error) {
      notify("error", errorText(error));
    } finally {
      setDetecting(false);
    }
  }
  async function create(): Promise<void> {
    if (creating || !goalValid || errors.length) return;
    setCreating(true);
    try {
      const freshRuntimes = await window.moxt.detectRuntimes();
      setRuntimes(freshRuntimes);
      const freshErrors = taskPreflight(
        selectedAgents,
        selectedWorkspaces,
        freshRuntimes,
        bindings,
      );
      if (freshErrors.length) {
        notify("error", freshErrors.join(" "));
        setStep(2);
        return;
      }
      const result = await window.moxt.createChange({
        roomId: form.roomId || null,
        title: form.title.trim(),
        description: `${form.description.trim()}\n\n## 验收标准\n${form.acceptance.trim()}`,
        workflowType: workflow,
        priority: "P1",
        dueDate: null,
        workspaceIds,
        agentIds,
        agentBindings: selectedAgents.map((agent) => ({
          agentId: agent.id,
          workspaceId: bindings[agent.id].workspaceId,
          permissions: {
            ...agent.permissions,
            write: bindings[agent.id].write,
          },
        })),
        tags: form.tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
      });
      notify("success", "任务已创建，正在进入执行阶段");
      onCreated(result.id);
    } catch (error) {
      notify("error", errorText(error));
    } finally {
      setCreating(false);
    }
  }
  return (
    <section className="page new-task">
      <header className="page-header">
        <div>
          <h1>新建任务</h1>
          <p>先说明目标，再选择团队与项目，确认后开始执行。</p>
        </div>
        <div className="stepper">
          {["目标与验收", "团队与项目", "确认启动"].map((label, i) => (
            <span
              className={step >= i + 1 ? "on" : ""}
              key={label}
              aria-current={step === i + 1 ? "step" : undefined}
            >
              <b>{step > i + 1 ? <Check /> : i + 1}</b>
              {label}
            </span>
          ))}
        </div>
      </header>
      <div className="wizard-card">
        {step === 1 && (
          <>
            <div className="wizard-heading">
              <CheckCircle2 />
              <div>
                <h2>你希望团队完成什么？</h2>
                <p>清晰的完成标准能减少反复沟通。</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="full">
                协作空间（可选）
                <select
                  value={form.roomId}
                  onChange={(e) => setForm({ ...form, roomId: e.target.value })}
                >
                  <option value="">为此任务创建新空间</option>
                  {snapshot.rooms
                    .filter((room) => room.status === "ACTIVE")
                    .map((room) => (
                      <option value={room.id} key={room.id}>
                        {room.name} · {room.kind}
                      </option>
                    ))}
                </select>
              </label>
              <label className="full">
                任务标题
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="例如：修复工作流模板详情页点击无响应"
                  required
                />
              </label>
              <label className="full">
                目标与约束
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="说明现状、期望结果，以及不可修改的范围。"
                  required
                />
              </label>
              <label className="full">
                验收标准
                <textarea
                  value={form.acceptance}
                  onChange={(e) =>
                    setForm({ ...form, acceptance: e.target.value })
                  }
                  placeholder="例如：模板卡片可打开详情；返回后保留选择；现有测试通过。"
                  required
                />
              </label>
              <label className="full">
                标签（可选）
                <input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="用逗号分隔"
                />
              </label>
            </div>
            <div className="section-title">
              <h2>协作模式</h2>
              <span>按目标关键词推荐，可手动调整</span>
            </div>
            <div className="workflow-choice">
              {Object.entries(WORKFLOW_LABELS).map(([key, item]) => (
                <button
                  className={workflow === key ? "selected" : ""}
                  aria-pressed={workflow === key}
                  onClick={() => setManualWorkflow(key as WorkflowType)}
                  key={key}
                >
                  <div>
                    <h3>
                      {item.name}{" "}
                      {recommendation === key && <small>· 推荐</small>}
                    </h3>
                    <p>{item.description}</p>
                  </div>
                  {workflow === key && <CheckCircle2 />}
                </button>
              ))}
            </div>
            {manualWorkflow && (
              <button
                className="text-button"
                onClick={() => setManualWorkflow(null)}
              >
                恢复自动推荐
              </button>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <div className="wizard-heading">
              <FolderGit2 />
              <div>
                <h2>选择项目与执行团队</h2>
                <p>
                  项目绑定和写入权限会一并提交；写入 Agent 使用独立 Git 工作树。
                </p>
              </div>
            </div>
            <div className="section-title">
              <h2>项目目录</h2>
              <button className="secondary" onClick={() => void addWorkspace()}>
                <FolderGit2 />
                添加本地目录
              </button>
            </div>
            <div className="workspace-options">
              {workspaces.map((w) => (
                <label className="workspace-option" key={w.id}>
                  <input
                    type="checkbox"
                    checked={workspaceIds.includes(w.id)}
                    onChange={(e) =>
                      setWorkspaceIds((ids) =>
                        e.target.checked
                          ? [...ids, w.id]
                          : ids.filter((id) => id !== w.id),
                      )
                    }
                  />
                  <span>
                    <strong>{w.name}</strong>
                    <small>
                      {w.path} · {w.branch || "非 Git 项目"}
                    </small>
                  </span>
                </label>
              ))}
              {!workspaces.length && (
                <p className="quiet-empty">
                  添加一个本地项目目录后，继续选择团队。
                </p>
              )}
            </div>
            <div className="section-title">
              <h2>执行团队</h2>
              <button
                className="secondary"
                disabled={detecting}
                onClick={() => void detect()}
              >
                <RefreshCw className={detecting ? "spin" : ""} />
                重新检测环境
              </button>
            </div>
            <div className="agent-choice">
              {snapshot.agents.map((agent) => {
                const selected = agentIds.includes(agent.id);
                const binding = bindings[agent.id] ?? {
                  workspaceId: workspaceIds[0] ?? "",
                  write: agent.permissions.write,
                };
                const available =
                  agent.runtime === "custom"
                    ? Boolean(agent.command?.trim())
                    : runtimes.some(
                        (r) => r.type === agent.runtime && r.available,
                      );
                return (
                  <div
                    className={`agent-binding-card ${selected ? "selected" : ""}`}
                    key={agent.id}
                  >
                    <button
                      aria-pressed={selected}
                      onClick={() =>
                        setAgentIds((ids) =>
                          selected
                            ? ids.filter((id) => id !== agent.id)
                            : [...ids, agent.id],
                        )
                      }
                    >
                      <span className="agent-avatar">{agent.icon}</span>
                      <div>
                        <h3>{agent.name}</h3>
                        <p>{agent.responsibility}</p>
                        <small>
                          {agent.runtime} ·{" "}
                          {available
                            ? agent.runtime === "custom"
                              ? "已配置命令（启动时验证）"
                              : "环境可用"
                            : "环境未就绪"}
                        </small>
                      </div>
                      {selected && <CheckCircle2 />}
                    </button>
                    {selected && (
                      <div className="binding-controls">
                        <label>
                          绑定项目
                          <select
                            value={binding.workspaceId}
                            onChange={(e) =>
                              setBindingMap((map) => ({
                                ...map,
                                [agent.id]: {
                                  ...binding,
                                  workspaceId: e.target.value,
                                },
                              }))
                            }
                          >
                            <option value="" disabled>
                              选择项目
                            </option>
                            {selectedWorkspaces.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={binding.write}
                            onChange={(e) =>
                              setBindingMap((map) => ({
                                ...map,
                                [agent.id]: {
                                  ...binding,
                                  write: e.target.checked,
                                },
                              }))
                            }
                          />
                          允许写入（独立工作树）
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {errors.length > 0 && (
              <div className="preflight-errors" role="status">
                <strong>启动前需要完成</strong>
                <ul>
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <div className="wizard-heading">
              <CheckCircle2 />
              <div>
                <h2>确认并启动</h2>
                <p>启动后会实际调用所选 Agent，消耗模型用量。</p>
              </div>
            </div>
            <div className="outcome-card">
              <h2>{form.title}</h2>
              <p className="preserve-lines">{form.description}</p>
              <h3>验收标准</h3>
              <p className="preserve-lines">{form.acceptance}</p>
            </div>
            <div className="review-grid">
              <Review label="协作模式" value={WORKFLOW_LABELS[workflow].name} />
              <Review
                label="项目"
                value={selectedWorkspaces.map((w) => w.name).join("、")}
              />
              <Review
                label="人工确认"
                value={`${WORKFLOWS[workflow].filter((p) => p.humanMode === "IN_LOOP").length} 个强制确认阶段`}
              />
            </div>
            <div className="list-card">
              {selectedAgents.map((a) => (
                <div className="work-row" key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {a.runtime} ·{" "}
                      {
                        workspaces.find(
                          (w) => w.id === bindings[a.id].workspaceId,
                        )?.name
                      }
                    </small>
                  </div>
                  <span>{bindings[a.id].write ? "允许写入" : "只读"}</span>
                </div>
              ))}
            </div>
            <p className="init-note">
              确认后保存任务、验证项目、建立执行会话并自动启动首个阶段。后续进展、用量和交付物在任务详情中查看。
            </p>
            {errors.length > 0 && (
              <div className="preflight-errors" role="alert">
                {errors.join(" ")}
              </div>
            )}
          </>
        )}
        <footer className="wizard-footer">
          <button
            className="secondary"
            disabled={step === 1 || creating}
            onClick={() => setStep((s) => s - 1)}
          >
            <ArrowLeft />
            上一步
          </button>
          {step < 3 ? (
            <button
              className="primary"
              disabled={
                step === 1 ? !goalValid : Boolean(errors.length) || detecting
              }
              onClick={() => setStep((s) => s + 1)}
            >
              下一步
              <ArrowRight />
            </button>
          ) : (
            <button
              className="primary"
              disabled={creating || !goalValid || Boolean(errors.length)}
              onClick={() => void create()}
            >
              {creating ? <LoaderCircle className="spin" /> : <Check />}
              {creating ? "正在验证并创建…" : "创建并开始执行"}
            </button>
          )}
        </footer>
      </div>
    </section>
  );
}
function Review({
  label,
  value,
}: {
  label: string;
  value: string;
}): import("react").JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}
