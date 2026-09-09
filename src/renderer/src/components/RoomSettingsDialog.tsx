import { LoaderCircle, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText, useAppStore } from "../store";

export default function RoomSettingsDialog({
  roomId,
}: {
  roomId: string;
}): import("react").JSX.Element | null {
  const { snapshot, notify, load } = useAppStore();
  const room = snapshot.rooms.find((item) => item.id === roomId);
  const context = snapshot.roomContexts.find((item) => item.roomId === roomId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => buildForm(room, context));

  useEffect(() => setForm(buildForm(room, context)), [room, context]);
  if (!room || !context) return null;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await window.moxt.updateRoomPolicy(roomId, {
        permissions: {
          read: form.read,
          write: form.write,
          shell: form.shell,
          git: form.git,
          network: form.network,
        },
        skillVersionIds: form.skillVersionIds,
        allowAgentDelegation: form.allowAgentDelegation,
        responseMode: form.responseMode,
        maxAgentTurns: Math.max(1, Math.min(100, form.maxAgentTurns)),
      });
      await window.moxt.updateRoomContext(roomId, {
        summary: form.summary,
        facts: splitLines(form.facts),
        decisions: splitLines(form.decisions),
        constraints: splitLines(form.constraints),
        openQuestions: splitLines(form.openQuestions),
      });
      await load();
      setOpen(false);
      notify("success", "空间上下文与策略已更新");
    } catch (error) {
      notify("error", errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="secondary" onClick={() => setOpen(true)}>
        <Settings2 />
        空间设置
      </button>
      {open && (
        <div className="modal-backdrop">
          <div className="modal wide-modal">
            <header>
              <div>
                <h2>{room.name}</h2>
                <p>{room.goal}</p>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)}>
                <X />
              </button>
            </header>
            <div className="form-grid">
              <label className="full">
                空间摘要
                <textarea
                  value={form.summary}
                  onChange={(event) =>
                    setForm({ ...form, summary: event.target.value })
                  }
                />
              </label>
              {(
                [
                  ["facts", "事实（每行一条）"],
                  ["decisions", "决策（每行一条）"],
                  ["constraints", "约束（每行一条）"],
                  ["openQuestions", "待确认问题（每行一条）"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <textarea
                    value={form[key]}
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                回应模式
                <select
                  value={form.responseMode}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      responseMode: event.target.value as typeof form.responseMode,
                    })
                  }
                >
                  <option value="AUTONOMOUS">自主推进</option>
                  <option value="MENTION_ONLY">仅被点名时响应</option>
                  <option value="MANUAL">仅手动启动</option>
                </select>
              </label>
              <label>
                Agent 最大发言/执行次数
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.maxAgentTurns}
                  onChange={(event) =>
                    setForm({ ...form, maxAgentTurns: Number(event.target.value) })
                  }
                />
              </label>
              <label className="full">
                空间 Skill（可多选）
                <select
                  multiple
                  value={form.skillVersionIds}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      skillVersionIds: Array.from(
                        event.target.selectedOptions,
                        (option) => option.value,
                      ),
                    })
                  }
                >
                  {snapshot.skillVersions
                    .filter((skill) => skill.status === "VERIFIED")
                    .map((skill) => (
                      <option value={skill.id} key={skill.id}>
                        {snapshot.skills.find((item) => item.id === skill.skillId)?.name ??
                          skill.id} · v{skill.version}
                      </option>
                    ))}
                </select>
              </label>
              <div className="permission-options full">
                {(
                  [
                    ["read", "读取"],
                    ["write", "写入"],
                    ["shell", "Shell"],
                    ["git", "Git"],
                    ["network", "网络"],
                    ["allowAgentDelegation", "Agent 委派"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={form[key]}
                      onChange={(event) =>
                        setForm({ ...form, [key]: event.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <footer>
              <button className="secondary" onClick={() => setOpen(false)}>
                取消
              </button>
              <button className="primary" disabled={busy} onClick={() => void save()}>
                {busy && <LoaderCircle className="spin" />}
                保存空间设置
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function buildForm(
  room: ReturnType<typeof useAppStore.getState>["snapshot"]["rooms"][number] | undefined,
  context: ReturnType<typeof useAppStore.getState>["snapshot"]["roomContexts"][number] | undefined,
) {
  return {
    summary: context?.summary ?? "",
    facts: context?.facts.join("\n") ?? "",
    decisions: context?.decisions.join("\n") ?? "",
    constraints: context?.constraints.join("\n") ?? "",
    openQuestions: context?.openQuestions.join("\n") ?? "",
    read: room?.policy.permissions.read ?? true,
    write: room?.policy.permissions.write ?? false,
    shell: room?.policy.permissions.shell ?? true,
    git: room?.policy.permissions.git ?? true,
    network: room?.policy.permissions.network ?? true,
    allowAgentDelegation: room?.policy.allowAgentDelegation ?? false,
    skillVersionIds: room?.policy.skillVersionIds ?? [],
    responseMode: room?.policy.responseMode ?? ("MENTION_ONLY" as const),
    maxAgentTurns: room?.policy.maxAgentTurns ?? 20,
  };
}

const splitLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
