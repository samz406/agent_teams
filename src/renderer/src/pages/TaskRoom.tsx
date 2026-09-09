import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Activity,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  FileCode2,
  FileText,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Terminal,
  Users,
  X,
} from "lucide-react";
import type { Agent, Change, Run, Task } from "../../../shared/contracts";
import { phasesFor, WORKFLOW_LABELS } from "../../../shared/workflows";
import {
  aggregateRunUsage,
  formatCost,
  formatDuration,
  formatTokens,
  usageForRun,
} from "../../../shared/usage";
import { errorText, useAppStore } from "../store";
import { taskSummary } from "../workbench";
import { statusLabel } from "../status-labels";
import RoomSettingsDialog from "../components/RoomSettingsDialog";

type Tab = "chat" | "workflow" | "artifacts";

export default function TaskRoom({
  change,
  initialTab,
  initialArtifactId,
  onBack,
}: {
  change: Change;
  initialTab?: Tab;
  initialArtifactId?: string;
  onBack(): void;
}): import("react").JSX.Element {
  const { snapshot, live, notify, load } = useAppStore();
  const [tab, setTab] = useState<Tab>(initialTab ?? "chat");
  const [artifactId, setArtifactId] = useState(initialArtifactId);
  const [teamOpen, setTeamOpen] = useState(false);
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const team = snapshot.agents.filter((a) => change.agentIds.includes(a.id));
  const messages = snapshot.messages.filter((m) => m.changeId === change.id);
  const runs = snapshot.runs.filter((r) => r.changeId === change.id);
  const tasks = snapshot.tasks.filter((task) => task.changeId === change.id);
  const artifacts = snapshot.artifacts.filter((a) => a.changeId === change.id);
  const phases = phasesFor(change.workflowType, change.currentPhase);
  const inspector = selectedAgent
    ? team.find((a) => a.id === selectedAgent)
    : undefined;
  const mentionMatches = useMemo(
    () =>
      mentionQuery === null
        ? []
        : team
            .filter((agent) =>
              agent.name.toLowerCase().includes(mentionQuery.toLowerCase()),
            )
            .slice(0, 8),
    [mentionQuery, team],
  );
  const taskUsage = aggregateRunUsage(runs, live);
  const room = snapshot.rooms.find((item) => item.id === change.roomId);

  async function send(): Promise<void> {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await window.moxt.sendMessage(
        change.id,
        text.trim(),
        target || undefined,
      );
      setText("");
      setMentionQuery(null);
      notify("success", "消息已交给 Agent Teams Runtime");
    } catch (error) {
      notify("error", errorText(error));
    } finally {
      setSending(false);
    }
  }
  function updateText(value: string): void {
    setText(value);
    const match = value.match(/(?:^|\s)@([^@\s]*)$/);
    setMentionQuery(match ? match[1] : null);
  }
  function chooseMention(agent: Agent): void {
    setText((current) =>
      current.replace(
        /(^|\s)@[^@\s]*$/,
        (_match, prefix: string) => `${prefix}@${agent.name} `,
      ),
    );
    setTarget(agent.id);
    setMentionQuery(null);
  }
  async function controlAll(action: "pause" | "stop"): Promise<void> {
    const active = runs.filter((run) =>
      ["QUEUED", "STARTING", "RUNNING"].includes(run.status),
    );
    if (!active.length) {
      notify("success", "当前没有运行中的 Run");
      setMenuOpen(false);
      return;
    }
    try {
      await Promise.all(
        active.map((run) => window.moxt.controlRun(run.id, action)),
      );
      notify(
        "success",
        action === "pause"
          ? `已暂停 ${active.length} 个 Run`
          : `已终止 ${active.length} 个 Run`,
      );
    } catch (error) {
      notify("error", errorText(error));
    }
    setMenuOpen(false);
  }
  async function refresh(): Promise<void> {
    await load();
    notify("success", "任务状态已刷新");
    setMenuOpen(false);
  }
  async function kick(): Promise<void> {
    try {
      await window.moxt.startChange(
        change.id,
        "User requested start / continue from task room",
      );
      notify("success", "已检查当前阶段并启动/继续执行");
    } catch (error) {
      notify("error", errorText(error));
    }
    setMenuOpen(false);
  }
  async function replan(): Promise<void> {
    const leaderAgent = team.find((agent) => agent.name === "Leader");
    try {
      await window.moxt.sendMessage(change.id, "/plan", leaderAgent?.id);
      notify("success", "已要求 Leader 基于当前证据重新规划");
    } catch (error) {
      notify("error", errorText(error));
    }
    setMenuOpen(false);
  }

  return (
    <section className="task-room">
      <header className="room-header">
        <button className="icon-btn" aria-label="返回任务中心" onClick={onBack}>
          <ArrowLeft />
        </button>
        <div>
          <div className="eyebrow">
            任务 #{change.number} · {WORKFLOW_LABELS[change.workflowType].name}
            {room ? ` · ${room.name}` : ""}
          </div>
          <h1>{change.title}</h1>
          <details className="task-goal">
            <summary>查看目标与验收要求</summary>
            <p className="preserve-lines">{change.description}</p>
          </details>
        </div>
        <div className="room-actions">
          <RoomSettingsDialog roomId={change.roomId} />
          <div className="usage-meter">
            <button
              className="usage-pill"
              aria-expanded={usageOpen}
              onClick={() => setUsageOpen((value) => !value)}
            >
              <strong>
                {taskUsage.usageRuns
                  ? formatTokens(taskUsage.usage.totalTokens)
                  : "—"}
              </strong>
              <span>tokens</span>
              <em>
                {taskUsage.usageRuns
                  ? formatCost(taskUsage)
                  : runs.some((r) =>
                        ["QUEUED", "STARTING", "RUNNING"].includes(r.status),
                      )
                    ? "计量中"
                    : "未报告用量"}
              </em>
            </button>
            {usageOpen && (
              <UsagePopover
                runs={runs}
                tasks={tasks}
                live={live}
                agents={team}
              />
            )}
          </div>
          <span className="running-dot">● {statusLabel(change.status)}</span>
          <div className="task-menu">
            <button
              className="icon-btn"
              aria-label="任务操作"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <MoreHorizontal />
            </button>
            {menuOpen && (
              <div className="task-menu-popover">
                <button onClick={() => void kick()}>
                  <Play />
                  启动 / 继续执行
                </button>
                <button
                  onClick={() => {
                    setTab("workflow");
                    setMenuOpen(false);
                  }}
                >
                  <Activity />
                  查看 Workflow
                </button>
                <button onClick={() => void refresh()}>
                  <RefreshCw />
                  刷新任务状态
                </button>
                <button onClick={() => void replan()}>
                  <Play />让 Leader 重新规划
                </button>
                <button onClick={() => void controlAll("pause")}>
                  <Pause />
                  暂停全部运行
                </button>
                <button
                  className="danger"
                  onClick={() => void controlAll("stop")}
                >
                  <CircleStop />
                  终止全部运行
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="phase-bar">
        {phases.map((phase, i) => (
          <button
            key={phase.id}
            className={phase.status.toLowerCase()}
            onClick={() => setTab("workflow")}
          >
            <i>{phase.status === "DONE" ? <Check /> : i + 1}</i>
            <span>{phase.name}</span>
          </button>
        ))}
      </div>
      <div className="room-tabs">
        <button
          className={tab === "chat" ? "active" : ""}
          onClick={() => setTab("chat")}
        >
          <MessageSquareText />
          协作动态
        </button>
        <button
          className={tab === "workflow" ? "active" : ""}
          onClick={() => setTab("workflow")}
        >
          <Activity />
          执行流程
        </button>
        <button
          className={tab === "artifacts" ? "active" : ""}
          onClick={() => setTab("artifacts")}
        >
          <FileText />
          交付物与验收 <em>{artifacts.length}</em>
        </button>
      </div>
      <div
        className={`room-body ${inspector ? "with-inspector" : ""} ${teamOpen ? "team-open" : ""}`}
      >
        <aside className="team-rail" aria-label="执行团队">
          <h3>
            <Users />
            参与者 <span>{team.length}</span>
          </h3>
          {team.map((agent) => (
            <button
              className={selectedAgent === agent.id ? "active" : ""}
              onClick={() => setSelectedAgent(agent.id)}
              key={agent.id}
            >
              <span className={`agent-avatar ${agent.status.toLowerCase()}`}>
                {agent.icon}
              </span>
              <div>
                <strong>{agent.name}</strong>
                <small>
                  {statusLabel(agent.status)} · {agent.runtime}
                </small>
              </div>
              {agent.status === "RUNNING" && <LoaderCircle className="spin" />}
            </button>
          ))}
          <h3 className="rail-section">
            <Terminal />
            关联项目
          </h3>
          {snapshot.workspaces
            .filter((w) => change.workspaceIds.includes(w.id))
            .map((w) => (
              <div className="workspace-mini" key={w.id}>
                <FileCode2 />
                <span>
                  {w.name}
                  <small>{w.branch || "local"}</small>
                </span>
              </div>
            ))}
        </aside>
        <div className="room-content">
          <div
            className={`task-context ${["WAITING_HUMAN", "BLOCKED", "FAILED"].includes(change.status) ? "needs-attention" : ""}`}
          >
            <div>
              <strong>{taskSummary(change, snapshot)}</strong>
              <small>
                当前阶段：{phases[change.currentPhase]?.name ?? "待开始"}
              </small>
            </div>
            <button
              className="secondary team-toggle"
              onClick={() => setTeamOpen((v) => !v)}
              aria-expanded={teamOpen}
            >
              <Users />
              团队
            </button>
            <button
              className="secondary"
              onClick={() =>
                setTab(
                  change.status === "WAITING_HUMAN" &&
                    artifacts.some((a) => a.status === "REVIEW")
                    ? "artifacts"
                    : "workflow",
                )
              }
            >
              {change.status === "WAITING_HUMAN" ? "查看验收" : "查看阶段"}
            </button>
          </div>
          {tab === "chat" && (
            <Chat
              messages={messages}
              runs={runs}
              live={live}
              agents={team}
              onInspect={setSelectedAgent}
              artifacts={artifacts}
              onArtifact={(id) => {
                setArtifactId(id);
                setTab("artifacts");
              }}
            />
          )}
          {tab === "workflow" && <WorkflowView change={change} />}
          {tab === "artifacts" && (
            <ArtifactView
              key={artifactId ?? "all"}
              change={change}
              initialArtifactId={artifactId}
            />
          )}
          {tab === "chat" && (
            <div className="composer">
              <div className="composer-top">
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">@Leader（默认）</option>
                  {team.map((a) => (
                    <option value={a.id} key={a.id}>
                      @{a.name}
                    </option>
                  ))}
                </select>
                <span>补充目标或纠偏指令；发送将产生模型用量</span>
              </div>
              <div className="composer-editor">
                <textarea
                  value={text}
                  onChange={(e) => updateText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMentionQuery(null);
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                      void send();
                  }}
                  placeholder="输入目标、约束或纠偏指令。输入 @ 可选择 Agent；⌘/Ctrl + Enter 发送。"
                />
                {mentionQuery !== null && (
                  <div className="mention-popover">
                    <div className="mention-title">选择 Agent</div>
                    {mentionMatches.length ? (
                      mentionMatches.map((agent) => (
                        <button
                          key={agent.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => chooseMention(agent)}
                        >
                          <span className="agent-avatar">{agent.icon}</span>
                          <div>
                            <strong>@{agent.name}</strong>
                            <small>{agent.responsibility}</small>
                          </div>
                          <em>{agent.runtime}</em>
                        </button>
                      ))
                    ) : (
                      <p>当前团队没有匹配的 Agent</p>
                    )}
                  </div>
                )}
              </div>
              <div className="composer-foot">
                <span>/status 查看状态 · /plan 重新规划</span>
                <button
                  className="send"
                  aria-label="发送指令"
                  disabled={sending || !text.trim()}
                  onClick={() => void send()}
                >
                  {sending ? <LoaderCircle className="spin" /> : <Send />}
                </button>
              </div>
            </div>
          )}
        </div>
        {inspector && (
          <>
            <button
              className="inspector-backdrop"
              aria-label="关闭执行详情"
              onClick={() => setSelectedAgent(null)}
            />
            <AgentInspector
              agent={inspector}
              runs={runs.filter((r) => r.agentId === inspector.id)}
              live={live}
              onClose={() => setSelectedAgent(null)}
            />
          </>
        )}
      </div>
    </section>
  );
}

function UsagePopover({
  runs,
  tasks,
  live,
  agents,
}: {
  runs: Run[];
  tasks: Task[];
  live: Record<string, string>;
  agents: Agent[];
}): import("react").JSX.Element {
  const total = aggregateRunUsage(runs, live);
  const byAgent = agents
    .map((agent) => ({
      agent,
      usage: aggregateRunUsage(
        runs.filter((run) => run.agentId === agent.id),
        live,
      ),
    }))
    .filter((item) => item.usage.usageRuns);
  const wasteRuns = runs.filter(
    (run) =>
      Boolean(run.retryReason) ||
      ["FAILED", "CANCELLED", "INTERRUPTED"].includes(run.status) ||
      (run.taskId
        ? tasks.find((task) => task.id === run.taskId)?.status === "REWORK"
        : false),
  );
  const waste = aggregateRunUsage(wasteRuns, live);
  return (
    <div className="usage-popover">
      <header>
        <div>
          <strong>本任务资源消耗</strong>
          <small>
            已计量 {total.usageRuns} / {runs.length} 次执行；未报告的数据以 —
            表示
          </small>
        </div>
        <span>{runs.length} Runs</span>
      </header>
      <div className="usage-total">
        <div>
          <span>累计 Token</span>
          <strong>
            {total.usageRuns ? total.usage.totalTokens.toLocaleString() : "—"}
          </strong>
        </div>
        <div>
          <span>报告 / 估算费用</span>
          <strong>{formatCost(total)}</strong>
        </div>
      </div>
      <div className="usage-grid">
        <div>
          <span>输入</span>
          <strong>
            {total.usageRuns ? formatTokens(total.usage.inputTokens) : "—"}
          </strong>
        </div>
        <div>
          <span>输出</span>
          <strong>
            {total.usageRuns ? formatTokens(total.usage.outputTokens) : "—"}
          </strong>
        </div>
        <div>
          <span>缓存读写</span>
          <strong>
            {total.usageRuns
              ? formatTokens(
                  total.usage.cachedInputTokens +
                    total.usage.cacheCreationInputTokens,
                )
              : "—"}
          </strong>
        </div>
        <div>
          <span>推理</span>
          <strong>
            {total.usageRuns
              ? formatTokens(total.usage.reasoningOutputTokens)
              : "—"}
          </strong>
        </div>
      </div>
      {byAgent.length > 0 && (
        <>
          <h4>按 Agent 统计</h4>
          <div className="usage-agent-list">
            {byAgent.map((item) => (
              <div key={item.agent.id}>
                <span>
                  <i className="agent-avatar">{item.agent.icon}</i>
                  {item.agent.name}
                </span>
                <strong>{formatTokens(item.usage.usage.totalTokens)}</strong>
                <em>{formatCost(item.usage)}</em>
              </div>
            ))}
          </div>
        </>
      )}
      {waste.usageRuns > 0 && (
        <div className="usage-waste">
          <span>重试 / 失败消耗</span>
          <strong>
            {formatTokens(waste.usage.totalTokens)} · {formatCost(waste)}
          </strong>
        </div>
      )}
      <details className="usage-sources">
        <summary>计量来源与计价版本</summary>
        {runs.map((run) => {
          const summary = usageForRun(run, live[run.id]);
          if (!summary)
            return (
              <p key={run.id}>
                {run.runtime} · {run.id.slice(0, 8)}：尚未报告用量
              </p>
            );
          const stamp = run.evidence
            .filter((e) => e.type === "USAGE")
            .sort((a, b) =>
              b.createdAt.localeCompare(a.createdAt),
            )[0]?.createdAt;
          return (
            <p key={run.id}>
              <strong>{summary.model || run.runtime}</strong> ·{" "}
              {summary.costType === "REPORTED"
                ? "运行环境报告金额"
                : summary.costType === "ESTIMATED"
                  ? "按模型费率估算"
                  : "费用未知"}
              <br />
              {summary.pricingVersion || "无估算费率版本"} ·{" "}
              {stamp
                ? `计量记录 ${new Date(stamp).toLocaleString()}`
                : live[run.id]
                  ? "随执行输出更新"
                  : "暂无计量时间"}
            </p>
          );
        })}
        <p>
          缓存读写为缓存命中与缓存创建 Token 合计；推理 Token
          按运行环境报告口径展示，不能直接与其余字段相加。
        </p>
      </details>
      <p className="usage-note">
        金额为 CLI 报告值或按对应模型公开费率估算，不代表 Plus / Pro /
        企业订阅的实际账单扣费。未知模型只统计 Token，不猜价格。
      </p>
    </div>
  );
}

function Chat({
  messages,
  runs,
  live,
  agents,
  onInspect,
  artifacts,
  onArtifact,
}: {
  messages: ReturnType<typeof useAppStore.getState>["snapshot"]["messages"];
  runs: Run[];
  live: Record<string, string>;
  agents: Agent[];
  onInspect(id: string): void;
  artifacts: import("../../../shared/contracts").Artifact[];
  onArtifact(id: string): void;
}): import("react").JSX.Element {
  const activeRuns = runs.filter((r) =>
    ["QUEUED", "STARTING", "RUNNING"].includes(r.status),
  );
  return (
    <div className="chat-scroll">
      {artifacts
        .filter((a) => a.status !== "DEPRECATED")
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 3)
        .map((a) => (
          <button
            className="chat-artifact"
            key={a.id}
            onClick={() => onArtifact(a.id)}
          >
            <FileText />
            <div>
              <strong>{a.title}</strong>
              <small>
                v{a.version} · {statusLabel(a.status)}
              </small>
            </div>
            <ChevronRight />
          </button>
        ))}
      {!messages.length && !activeRuns.length && (
        <div className="quiet-empty">
          任务动态会显示在这里。可查看当前阶段或向负责人补充指令。
        </div>
      )}
      {activeRuns.map((run) => {
        const agent = agents.find((a) => a.id === run.agentId);
        const usage = usageForRun(run, live[run.id]);
        return (
          <button
            className="running-card"
            key={run.id}
            onClick={() => onInspect(run.agentId)}
          >
            <span className="agent-avatar running">{agent?.icon}</span>
            <div>
              <strong>{agent?.name} 正在工作</strong>
              <p>
                {run.runtime} · {run.workspacePath}
                {usage
                  ? ` · ${formatTokens(usage.usage.totalTokens)} tokens`
                  : ""}
              </p>
              <code>{(live[run.id] || "正在启动 Runtime…").slice(-180)}</code>
            </div>
            <div>
              <LoaderCircle className="spin" />
              <small>查看执行过程</small>
            </div>
          </button>
        );
      })}
      {messages.map((message) => {
        const run = message.runId
          ? runs.find((r) => r.id === message.runId)
          : undefined;
        const usage = run ? usageForRun(run, live[run.id]) : null;
        const duration = run ? formatDuration(run) : null;
        return (
          <article className={`message ${message.senderType}`} key={message.id}>
            <span className="message-avatar">
              {message.senderType === "human"
                ? "Y"
                : message.senderType === "system"
                  ? "S"
                  : agents.find((a) => a.id === message.senderId)?.icon || "L"}
            </span>
            <div>
              <header>
                <strong>{message.senderName}</strong>
                <time>
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {run && (
                  <span className={`status ${run.status.toLowerCase()}`}>
                    {run.runtime} · {statusLabel(run.status)}
                  </span>
                )}
              </header>
              {message.senderType === "system" ? (
                <details className="execution-record">
                  <summary>
                    执行记录 · {message.content.split("\n")[0].slice(0, 80)}
                  </summary>
                  <div className="markdown">
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                </details>
              ) : (
                <div className="markdown">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              )}
              {run && (
                <button
                  className="evidence-link"
                  onClick={() => onInspect(run.agentId)}
                >
                  <ShieldCheck />
                  {run.evidence.length} 项 Evidence · Exit {run.exitCode ?? "—"}
                  {usage
                    ? ` · ${formatTokens(usage.usage.totalTokens)} tokens · ${formatSingleCost(usage.costUsd)}`
                    : ""}
                  {duration ? ` · ${duration}` : ""} · 打开 Session{" "}
                  <ChevronRight />
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AgentInspector({
  agent,
  runs,
  live,
  onClose,
}: {
  agent: Agent;
  runs: Run[];
  live: Record<string, string>;
  onClose(): void;
}): import("react").JSX.Element {
  const { notify, snapshot } = useAppStore();
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab") {
        const items = Array.from(
          drawerRef.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input, select, textarea, a[href]",
          ) ?? [],
        ).filter((el) => el.getClientRects().length > 0);
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, []);
  const [selected, setSelected] = useState(runs[0]?.id);
  const run = runs.find((r) => r.id === selected) || runs[0];
  async function control(
    action: "pause" | "resume" | "stop" | "retry",
  ): Promise<void> {
    if (!run) return;
    try {
      await window.moxt.controlRun(run.id, action);
      notify("success", `已执行 ${action}`);
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  const session = snapshot.agentSessions.find(
    (item) => item.id === run?.agentSessionId,
  );
  const task = snapshot.tasks.find((item) => item.id === run?.taskId);
  const usage = run ? usageForRun(run, live[run.id]) : null;
  const duration = run ? formatDuration(run) : null;
  return (
    <aside
      className="inspector"
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.name} 执行详情`}
    >
      <header>
        <div className="agent-avatar">{agent.icon}</div>
        <div>
          <h2>{agent.name}</h2>
          <p>
            {agent.runtime} · {statusLabel(agent.status)}
          </p>
        </div>
        <button aria-label="关闭执行详情" onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="inspector-actions">
        <button
          onClick={() => void control("pause")}
          disabled={!run || run.status !== "RUNNING"}
        >
          <Pause />
          暂停
        </button>
        <button
          onClick={() => void control("resume")}
          disabled={!run || !["PAUSED", "INTERRUPTED"].includes(run.status)}
        >
          <Play />
          继续
        </button>
        <button
          onClick={() => void control("stop")}
          disabled={
            !run || !["RUNNING", "STARTING", "QUEUED"].includes(run.status)
          }
        >
          <CircleStop />
          终止
        </button>
        <button onClick={() => void control("retry")} disabled={!run}>
          <RefreshCw />
          重试
        </button>
      </div>
      <div className="session-layout">
        <div className="session-list">
          <h4>Session / Run</h4>
          {runs.map((item) => {
            const itemUsage = usageForRun(item, live[item.id]);
            return (
              <button
                className={item.id === run?.id ? "active" : ""}
                onClick={() => setSelected(item.id)}
                key={item.id}
              >
                <span>{item.id.slice(0, 8)}</span>
                <small>
                  {statusLabel(item.status)} ·{" "}
                  {itemUsage
                    ? `${formatTokens(itemUsage.usage.totalTokens)} tokens`
                    : item.startedAt
                      ? new Date(item.startedAt).toLocaleString()
                      : "排队中"}
                </small>
              </button>
            );
          })}
        </div>
        {run ? (
          <div className="run-detail">
            <div className="run-meta">
              <span>
                <Clock3 /> {statusLabel(run.status)}
                {duration ? ` · ${duration}` : ""}
              </span>
              <span>
                <Terminal /> {run.executable}
              </span>
              {usage && (
                <span className="run-usage-meta">
                  {formatTokens(usage.usage.totalTokens)} tokens ·{" "}
                  {formatSingleCost(usage.costUsd)}
                  {usage.model ? ` · ${usage.model}` : ""}
                </span>
              )}
            </div>
            {session && (
              <div className="session-facts">
                <span>Agent Session</span>
                <strong>
                  {session.id.slice(0, 8)} · Native{" "}
                  {session.nativeSessionId || "等待 Runtime 返回"}
                </strong>
              </div>
            )}
            {task && (
              <div className="session-facts">
                <span>Task</span>
                <strong>
                  {statusLabel(task.status)} · {task.phaseId}
                </strong>
              </div>
            )}
            <h4>实时 Transcript</h4>
            <pre>
              {(live[run.id] || run.stdout || run.stderr || "暂无输出").slice(
                -12000,
              )}
            </pre>
            <h4>Evidence</h4>
            <div className="evidence-list">
              {run.evidence.map((item) => (
                <div key={item.id}>
                  <span
                    className={`evidence-status ${item.status.toLowerCase()}`}
                  >
                    {statusLabel(item.status)}
                  </span>
                  <strong>{item.title}</strong>
                  <p>
                    {item.type === "USAGE"
                      ? "Runtime Token Usage / Cost Evidence"
                      : item.detail.slice(0, 600)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty">
            <Terminal />
            <h3>尚无 Run</h3>
            <p>在协作动态中向这名 Agent 发送指令。</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function WorkflowView({
  change,
}: {
  change: Change;
}): import("react").JSX.Element {
  const { snapshot, notify, live } = useAppStore();
  const phases = phasesFor(change.workflowType, change.currentPhase);
  const current = phases[change.currentPhase];
  const allTasks = snapshot.tasks.filter((task) => task.changeId === change.id);
  const active = snapshot.runs.filter(
    (r) =>
      r.changeId === change.id &&
      ["QUEUED", "STARTING", "RUNNING"].includes(r.status),
  );
  const tasks = allTasks.filter((task) => task.phaseId === current.id);
  const issues = snapshot.issues.filter(
    (issue) =>
      issue.changeId === change.id &&
      !["RESOLVED", "VERIFIED", "WONT_FIX"].includes(issue.status),
  );
  const phaseUsage = (phaseId: string) => {
    const ids = new Set(
      allTasks
        .filter((task) => task.phaseId === phaseId)
        .map((task) => task.id),
    );
    return aggregateRunUsage(
      snapshot.runs.filter(
        (run) =>
          run.changeId === change.id &&
          Boolean(run.taskId) &&
          ids.has(run.taskId!),
      ),
      live,
    );
  };
  async function advance(): Promise<void> {
    try {
      await window.moxt.advanceWorkflow(change.id);
      notify("success", "Workflow 已进入下一阶段并尝试自动执行");
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  async function start(): Promise<void> {
    try {
      await window.moxt.startChange(
        change.id,
        "User requested start / continue from Workflow view",
      );
      notify("success", "已检查当前阶段并启动/继续执行");
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  async function resolveIssue(id: string): Promise<void> {
    try {
      await window.moxt.updateIssue(
        id,
        "RESOLVED",
        "Human confirmed resolution",
      );
      notify("success", "Issue 已解决");
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  return (
    <div className="workflow-view">
      <div className="phase-list">
        {phases.map((phase, i) => {
          const usage = phaseUsage(phase.id);
          return (
            <div className={phase.status.toLowerCase()} key={phase.id}>
              <i>{phase.status === "DONE" ? <Check /> : i + 1}</i>
              <div>
                <strong>{phase.name}</strong>
                <p>{phase.goal}</p>
                {usage.usageRuns > 0 && (
                  <small className="phase-usage">
                    {formatTokens(usage.usage.totalTokens)} tokens ·{" "}
                    {formatCost(usage)}
                  </small>
                )}
              </div>
              <span>{statusLabel(phase.status)}</span>
            </div>
          );
        })}
      </div>
      <div className="phase-detail">
        <span className="chip">当前阶段</span>
        <h2>{current.name}</h2>
        <p>{current.goal}</p>
        <h4>当前子任务</h4>
        <div className="task-state-list">
          {tasks.length ? (
            tasks.map((task) => (
              <div key={task.id}>
                <span className={`status ${task.status.toLowerCase()}`}>
                  {statusLabel(task.status)}
                </span>
                <strong>{task.title}</strong>
                <small>Required: {task.requiredEvidence.join(" · ")}</small>
              </div>
            ))
          ) : (
            <p>Scheduler 会自动按当前 Workflow 阶段选择 Agent 并建立 Task。</p>
          )}
        </div>
        <h4>阻塞问题</h4>
        <div className="issue-list">
          {issues.length ? (
            issues.map((issue) => (
              <div key={issue.id}>
                <span>{issue.severity}</span>
                <strong>{issue.title}</strong>
                <p>{issue.description}</p>
                <button onClick={() => void resolveIssue(issue.id)}>
                  标记已解决
                </button>
              </div>
            ))
          ) : (
            <p>当前没有未解决的 Blocking Issue。</p>
          )}
        </div>
        <h4>交付物</h4>
        <div className="deliverable">
          <FileText />
          {current.deliverable}
        </div>
        <h4>验收要求</h4>
        {current.exitCriteria.map((item) => (
          <label key={item}>
            <input
              type="checkbox"
              readOnly
              checked={
                tasks.length > 0 &&
                tasks.every((task) => task.status === "ACCEPTED")
              }
            />
            {item}
          </label>
        ))}
        <h4>人工参与方式</h4>
        <span className="human-mode">{current.humanMode}</span>
        <h4>正在执行</h4>
        <p>
          {active.length
            ? `${active.length} 个 Agent 正在执行`
            : "当前没有运行中的 Agent"}
        </p>
        {!active.length && change.status !== "DONE" && (
          <button className="primary" onClick={() => void start()}>
            <Play />
            启动 / 继续执行
          </button>
        )}
        <button className="primary" onClick={() => void advance()}>
          由状态机校验并推进
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}

function ArtifactView({
  change,
  initialArtifactId,
}: {
  change: Change;
  initialArtifactId?: string;
}): import("react").JSX.Element {
  const { snapshot, notify } = useAppStore();
  const artifacts = snapshot.artifacts.filter((a) => a.changeId === change.id);
  const [selected, setSelected] = useState(initialArtifactId);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const artifact =
    artifacts.find((a) => a.id === selected) ||
    artifacts.find((a) => a.status === "REVIEW") ||
    artifacts[0];
  async function approve(value: boolean, advance = false): Promise<void> {
    if (!artifact || busy) return;
    if (!value && !feedback.trim()) {
      setReviewNotice("请填写修改意见，帮助团队明确返工要求。");
      return;
    }
    setBusy(true);
    setReviewNotice("");
    let saved = false;
    try {
      await window.moxt.approveArtifact(
        artifact.id,
        value,
        feedback.trim() || undefined,
      );
      saved = true;
      if (advance) await window.moxt.advanceWorkflow(change.id);
      const message = value
        ? advance
          ? "方案已批准，阶段校验通过并继续执行"
          : "方案已批准，可在执行流程中继续推进"
        : "已退回修改并记录意见";
      setReviewNotice(message);
      notify("success", message);
    } catch (error) {
      const message = saved
        ? `审批已保存，阶段尚未推进：${errorText(error)}`
        : errorText(error);
      setReviewNotice(message);
      notify("error", message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="artifact-view">
      <div className="artifact-list">
        <h3>方案与交付物</h3>
        {artifacts.map((item) => (
          <button
            className={item.id === artifact?.id ? "active" : ""}
            disabled={busy}
            onClick={() => {
              setSelected(item.id);
              setFeedback("");
              setReviewNotice("");
            }}
            key={item.id}
          >
            <FileText />
            <div>
              <strong>{item.title}</strong>
              <small>
                v{item.version} · {statusLabel(item.status)}
              </small>
            </div>
          </button>
        ))}
      </div>
      {artifact ? (
        <article>
          <header>
            <div>
              <span className={`status ${artifact.status.toLowerCase()}`}>
                {statusLabel(artifact.status)}
              </span>
              <h2>
                {artifact.title} · v{artifact.version}
              </h2>
            </div>
            <div>
              <button
                className="secondary"
                disabled={busy || artifact.status === "DEPRECATED"}
                onClick={() => void approve(false)}
              >
                退回修改
              </button>
              <button
                className="primary"
                onClick={() => void approve(true)}
                disabled={
                  busy ||
                  artifact.status === "APPROVED" ||
                  artifact.status === "DEPRECATED"
                }
              >
                <Check />
                仅批准
              </button>
            </div>
          </header>
          <div className="review-actions">
            <label>
              审阅意见
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="退回时请写明需要调整的内容"
                disabled={busy}
              />
            </label>
            {change.status === "WAITING_HUMAN" &&
              artifact.status === "REVIEW" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void approve(true, true)}
                >
                  {busy ? "正在校验…" : "批准并继续执行"}
                </button>
              )}
            <p role="status">
              {reviewNotice ||
                "批准针对当前文档；阶段推进仍需满足验收证据与阻塞检查。"}
            </p>
            <details>
              <summary>查看本任务验收证据</summary>
              {snapshot.runs
                .filter((r) => r.changeId === change.id)
                .flatMap((r) => r.evidence)
                .map((e) => (
                  <div className="review-evidence" key={e.id}>
                    <strong>
                      {statusLabel(e.status)} · {e.title}
                    </strong>
                    <p>{e.detail}</p>
                  </div>
                ))}
            </details>
          </div>
          <div className="markdown">
            <ReactMarkdown>{artifact.content}</ReactMarkdown>
          </div>
        </article>
      ) : (
        <div className="empty">
          <FileText />
          <h3>暂无交付物</h3>
          <p>
            Agent 产出 Proposal、Contract 或 Report
            后会自动进入这里，等待版本化评审。
          </p>
        </div>
      )}
    </div>
  );
}

function formatSingleCost(costUsd: number | null): string {
  if (costUsd === null) return "成本暂无";
  return `~$${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
}
