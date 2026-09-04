import { CalendarClock, FlaskConical, Plus, Power, X } from "lucide-react";
import { useState } from "react";
import type {
  ScheduleConcurrencyPolicy,
  ScheduleMisfirePolicy,
} from "../../../shared/contracts";
import { errorText, useAppStore } from "../store";

export default function Schedules({
  onOpenOrder,
}: {
  onOpenOrder(id: string): void;
}): import("react").JSX.Element {
  const { snapshot, notify } = useAppStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    ownerAgentId: snapshot.agents[0]?.id ?? "",
    title: "",
    goal: "",
    cron: "10 8 * * 1-5",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    misfire: "RUN_ONCE" as ScheduleMisfirePolicy,
    concurrency: "SKIP" as ScheduleConcurrencyPolicy,
  });
  async function create(): Promise<void> {
    try {
      await window.moxt.createSchedule({
        name: form.name,
        ownerAgentId: form.ownerAgentId,
        cronExpression: form.cron,
        timezone: form.timezone,
        enabled: false,
        misfirePolicy: form.misfire,
        concurrencyPolicy: form.concurrency,
        maxCatchUpRuns: 3,
        workOrderTemplate: {
          title: form.title,
          goal: form.goal,
          ownerAgentId: form.ownerAgentId,
          input: { scheduledFor: "{{scheduledFor}}", date: "{{date}}" },
          constraints: ["结果必须标明实际数据时间和覆盖范围"],
          outputContract: {
            requiredSections: ["核心结论", "证据与来源", "下一步"],
            mustCite: true,
          },
          requiredEvidence: [
            "RUNTIME",
            "SOURCE",
            "DATA_FRESHNESS",
            "OUTPUT_SCHEMA",
            "DELIVERY",
          ],
          permissions: {
            read: true,
            write: false,
            shell: true,
            git: true,
            network: true,
          },
        },
      });
      setOpen(false);
      notify("success", "计划已创建，首次默认停用；请先执行测试运行");
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  async function toggle(id: string, enabled: boolean): Promise<void> {
    try {
      await window.moxt.updateSchedule(id, enabled);
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  async function test(id: string): Promise<void> {
    try {
      const order = await window.moxt.testSchedule(id);
      onOpenOrder(order.id);
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>定时计划</h1>
          <p>
            Schedule 只负责按时、幂等地产生工作单；执行、证据和验收仍由
            WorkOrder 状态机负责。
          </p>
        </div>
        <button className="primary" onClick={() => setOpen(true)}>
          <Plus />
          新建计划
        </button>
      </header>
      <div className="schedule-list">
        {snapshot.schedules.map((item) => {
          const owner = snapshot.agents.find(
            (agent) => agent.id === item.ownerAgentId,
          );
          const executions = snapshot.scheduleExecutions.filter(
            (value) => value.scheduleId === item.id,
          );
          return (
            <article key={item.id}>
              <header>
                <span className="schedule-icon">
                  <CalendarClock />
                </span>
                <div>
                  <h2>{item.name}</h2>
                  <p>
                    {owner?.name} · {item.cronExpression} · {item.timezone}
                  </p>
                </div>
                <button
                  className={`toggle ${item.enabled ? "on" : ""}`}
                  onClick={() => void toggle(item.id, !item.enabled)}
                >
                  <Power />
                  {item.enabled ? "运行中" : "已停用"}
                </button>
              </header>
              <div className="schedule-facts">
                <span>
                  下次运行
                  <strong>{new Date(item.nextRunAt).toLocaleString()}</strong>
                </span>
                <span>
                  错过策略<strong>{item.misfirePolicy}</strong>
                </span>
                <span>
                  并发策略<strong>{item.concurrencyPolicy}</strong>
                </span>
                <span>
                  最近执行<strong>{executions[0]?.status ?? "尚未测试"}</strong>
                </span>
              </div>
              <footer>
                <button
                  className="secondary"
                  onClick={() => void test(item.id)}
                >
                  <FlaskConical />
                  立即测试运行
                </button>
                {executions[0]?.workOrderId && (
                  <button
                    className="secondary"
                    onClick={() => onOpenOrder(executions[0].workOrderId!)}
                  >
                    查看工作单
                  </button>
                )}
              </footer>
            </article>
          );
        })}
        {!snapshot.schedules.length && (
          <div className="empty hero-empty">
            <CalendarClock />
            <h3>还没有定时计划</h3>
            <p>建议先让工作单人工跑通，再固化为定时计划。</p>
          </div>
        )}
      </div>
      {open && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <div>
                <h2>新建定时计划</h2>
                <p>先创建为停用状态，测试通过后再启用。</p>
              </div>
              <button onClick={() => setOpen(false)}>
                <X />
              </button>
            </header>
            <div className="form-grid">
              <label>
                计划名称
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
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
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                工作单标题
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label>
                时区
                <input
                  value={form.timezone}
                  onChange={(e) =>
                    setForm({ ...form, timezone: e.target.value })
                  }
                />
              </label>
              <label className="full">
                长期结果
                <textarea
                  value={form.goal}
                  onChange={(e) => setForm({ ...form, goal: e.target.value })}
                />
              </label>
              <label>
                Cron（分 时 日 月 周）
                <input
                  value={form.cron}
                  onChange={(e) => setForm({ ...form, cron: e.target.value })}
                />
              </label>
              <label>
                错过策略
                <select
                  value={form.misfire}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      misfire: e.target.value as ScheduleMisfirePolicy,
                    })
                  }
                >
                  <option value="SKIP">跳过</option>
                  <option value="RUN_ONCE">补一次</option>
                  <option value="RUN_ALL_BOUNDED">有限补跑</option>
                </select>
              </label>
              <label>
                并发策略
                <select
                  value={form.concurrency}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      concurrency: e.target.value as ScheduleConcurrencyPolicy,
                    })
                  }
                >
                  <option value="SKIP">上一单未结束则跳过</option>
                  <option value="QUEUE">继续排队</option>
                  <option value="REPLACE" disabled>
                    替换（首版暂不开放）
                  </option>
                </select>
              </label>
            </div>
            <footer>
              <button className="secondary" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                className="primary"
                disabled={!form.name || !form.title || !form.goal}
                onClick={() => void create()}
              >
                <CalendarClock />
                创建计划
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
