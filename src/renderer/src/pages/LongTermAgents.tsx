import { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  BrainCircuit,
  Check,
  Plus,
  Save,
  ShieldAlert,
  X,
} from "lucide-react";
import type {
  AgentProfile,
  Evidence,
  MemoryKind,
  MemoryScope,
} from "../../../shared/contracts";
import { errorText, useAppStore } from "../store";
import { statusLabel } from "../status-labels";

const split = (value: string): string[] =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

export default function LongTermAgents(): import("react").JSX.Element {
  const { snapshot, notify } = useAppStore();
  const [agentId, setAgentId] = useState(snapshot.agents[0]?.id ?? "");
  const [tab, setTab] = useState<"profile" | "memory" | "skill">("profile");
  const agent = snapshot.agents.find((item) => item.id === agentId);
  const profile = snapshot.agentProfiles.find(
    (item) => item.agentId === agentId,
  );
  const memories = snapshot.memories.filter((item) => item.agentId === agentId);
  const skills = snapshot.skills.filter(
    (item) => item.ownerAgentId === agentId,
  );
  return (
    <section className="page long-term-page">
      <header className="page-header">
        <div>
          <h1>数字员工</h1>
          <p>以长期岗位为中心管理职责、分层记忆与经过验证的工作方法。</p>
        </div>
      </header>
      <div className="long-term-layout">
        <aside className="employee-list">
          {snapshot.agents.map((item) => (
            <button
              className={item.id === agentId ? "active" : ""}
              onClick={() => setAgentId(item.id)}
              key={item.id}
            >
              <i className="agent-avatar">{item.icon}</i>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {snapshot.agentProfiles.find(
                    (value) => value.agentId === item.id,
                  )?.positionTitle || item.description}
                </small>
              </span>
            </button>
          ))}
        </aside>
        <main className="employee-detail">
          {agent && profile ? (
            <>
              <header className="employee-head">
                <div>
                  <span className="agent-avatar">{agent.icon}</span>
                  <div>
                    <h2>{agent.name}</h2>
                    <p>
                      {profile.positionTitle} · 岗位版本 v{profile.version}
                    </p>
                  </div>
                </div>
                <span className={`status ${profile.status.toLowerCase()}`}>
                  {statusLabel(profile.status)}
                </span>
              </header>
              <nav className="detail-tabs">
                <button
                  className={tab === "profile" ? "active" : ""}
                  onClick={() => setTab("profile")}
                >
                  岗位说明
                </button>
                <button
                  className={tab === "memory" ? "active" : ""}
                  onClick={() => setTab("memory")}
                >
                  分层记忆{" "}
                  <em>
                    {
                      memories.filter((item) => item.status === "CANDIDATE")
                        .length
                    }
                  </em>
                </button>
                <button
                  className={tab === "skill" ? "active" : ""}
                  onClick={() => setTab("skill")}
                >
                  Skills <em>{skills.length}</em>
                </button>
              </nav>
              {tab === "profile" && <ProfileEditor profile={profile} />}{" "}
              {tab === "memory" && <MemoryPanel agentId={agentId} />}{" "}
              {tab === "skill" && <SkillPanel agentId={agentId} />}
            </>
          ) : (
            <div className="empty">
              <BrainCircuit />
              <h3>选择一名数字员工</h3>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function ProfileEditor({
  profile,
}: {
  profile: AgentProfile;
}): import("react").JSX.Element {
  const { notify } = useAppStore();
  const [form, setForm] = useState(profile);
  useEffect(() => setForm(profile), [profile]);
  const field = (key: keyof AgentProfile, label: string, multi = false) => (
    <label>
      {label}
      {multi ? (
        <textarea
          value={(form[key] as string[]).join("\n")}
          onChange={(event) =>
            setForm({ ...form, [key]: split(event.target.value) })
          }
        />
      ) : (
        <input
          value={String(form[key])}
          onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        />
      )}
    </label>
  );
  async function save(): Promise<void> {
    try {
      const {
        id: _id,
        version: _version,
        createdAt: _created,
        updatedAt: _updated,
        ...input
      } = form;
      await window.moxt.upsertAgentProfile(input);
      notify("success", "岗位说明已保存并生成新版本");
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  return (
    <div className="profile-editor form-grid">
      {field("positionTitle", "职位名称")}
      {
        <label>
          状态
          <select
            value={form.status}
            onChange={(event) =>
              setForm({
                ...form,
                status: event.target.value as AgentProfile["status"],
              })
            }
          >
            <option value="DRAFT">草稿</option>
            <option value="ACTIVE">启用</option>
            <option value="PAUSED">暂停</option>
            <option value="ARCHIVED">归档</option>
          </select>
        </label>
      }
      {field("outcomeStatement", "长期负责结果")}
      {field("recurringResponsibilities", "固定职责（每行一条）", true)}
      {field("preferredSources", "长期数据源（每行一条）", true)}
      {field("standardDeliverables", "固定交付物（每行一条）", true)}
      {field("acceptanceCriteria", "验收标准（每行一条）", true)}
      {field("prohibitedActions", "禁止动作（每行一条）", true)}
      {field("approvalPoints", "人工审批点（每行一条）", true)}
      {field("failurePolicy", "失败时如何处理")}
      <button className="primary profile-save" onClick={() => void save()}>
        <Save />
        保存岗位版本
      </button>
    </div>
  );
}

function MemoryPanel({
  agentId,
}: {
  agentId: string;
}): import("react").JSX.Element {
  const { snapshot, notify } = useAppStore();
  const memories = snapshot.memories.filter((item) => item.agentId === agentId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    content: "",
    scope: "ROLE" as MemoryScope,
    kind: "RULE" as MemoryKind,
    tags: "",
  });
  async function create(): Promise<void> {
    try {
      await window.moxt.createMemory({
        agentId,
        scope: form.scope,
        scopeId: agentId,
        kind: form.kind,
        title: form.title,
        content: form.content,
        tags: split(form.tags),
        confidence: 1,
        sourceType: "HUMAN",
        sourceId: `human:${Date.now()}`,
        supersedesId: null,
        expiresAt: null,
        provenance: "TRUSTED",
        activate: false,
      });
      setOpen(false);
      notify("success", "已进入记忆待确认");
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  async function decide(
    id: string,
    decision: "APPROVE" | "REJECT",
  ): Promise<void> {
    try {
      await window.moxt.decideMemory(id, decision);
      notify("success", decision === "APPROVE" ? "记忆已生效" : "记忆已拒绝");
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  return (
    <div className="memory-panel">
      <div className="panel-actions">
        <div>
          <h3>记忆治理</h3>
          <p>只有已确认且未过期的记忆会进入后续工作单上下文。</p>
        </div>
        <button className="primary" onClick={() => setOpen(true)}>
          <Plus />
          新增记忆
        </button>
      </div>
      <section>
        <h4>待确认</h4>
        {memories
          .filter((item) => item.status === "CANDIDATE")
          .map((item) => (
            <article className="governance-card" key={item.id}>
              <header>
                <strong>{item.title}</strong>
                <span>
                  {item.scope} · {item.kind}
                </span>
              </header>
              <p>{item.content}</p>
              <footer>
                <button onClick={() => void decide(item.id, "REJECT")}>
                  <X />
                  拒绝
                </button>
                <button
                  className="primary"
                  onClick={() => void decide(item.id, "APPROVE")}
                >
                  <Check />
                  启用
                </button>
              </footer>
            </article>
          ))}
      </section>
      <section>
        <h4>正在生效</h4>
        {memories
          .filter((item) => item.status === "ACTIVE")
          .map((item) => (
            <article className="governance-card active" key={item.id}>
              <header>
                <strong>{item.title}</strong>
                <span>
                  {item.scope} · {item.kind} ·{" "}
                  {item.provenance === "TRUSTED" ? "可信" : "不可信数据"}
                </span>
              </header>
              <p>{item.content}</p>
              <small>
                来源：{item.sourceType} / {item.sourceId}
              </small>
            </article>
          ))}
      </section>
      {open && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <div>
                <h2>新增岗位记忆</h2>
                <p>先保存为候选，确认后才会影响未来工作。</p>
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
                层级
                <select
                  value={form.scope}
                  onChange={(e) =>
                    setForm({ ...form, scope: e.target.value as MemoryScope })
                  }
                >
                  <option value="ROLE">岗位</option>
                  <option value="PROJECT">项目</option>
                  <option value="WORKFLOW">流程</option>
                  <option value="EPISODE">经验</option>
                </select>
              </label>
              <label>
                类型
                <select
                  value={form.kind}
                  onChange={(e) =>
                    setForm({ ...form, kind: e.target.value as MemoryKind })
                  }
                >
                  <option value="RULE">规则</option>
                  <option value="PREFERENCE">偏好</option>
                  <option value="FACT">事实</option>
                  <option value="SOURCE">来源</option>
                  <option value="DECISION">决策</option>
                  <option value="LESSON">经验</option>
                  <option value="FAILURE">失败</option>
                </select>
              </label>
              <label>
                标签（每行一条）
                <textarea
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                />
              </label>
              <label className="full">
                内容
                <textarea
                  value={form.content}
                  onChange={(e) =>
                    setForm({ ...form, content: e.target.value })
                  }
                />
              </label>
            </div>
            <footer>
              <button className="secondary" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                className="primary"
                disabled={!form.title || !form.content}
                onClick={() => void create()}
              >
                <BrainCircuit />
                保存候选
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillPanel({
  agentId,
}: {
  agentId: string;
}): import("react").JSX.Element {
  const { snapshot, notify } = useAppStore();
  const skills = snapshot.skills.filter(
    (item) => item.ownerAgentId === agentId,
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    trigger: "",
    instructions: "",
    inputSchema: '{"type":"object"}',
    outputSchema: '{"type":"object"}',
    capabilities: "net.fetch",
    evidence: "SOURCE\nDATA_FRESHNESS",
    failurePolicy: "数据缺失或无法核验时阻塞，不得猜测。",
  });
  async function create(): Promise<void> {
    try {
      await window.moxt.createSkill({
        name: form.name,
        description: form.description,
        trigger: form.trigger,
        ownerAgentId: agentId,
        instructions: form.instructions,
        inputSchema: JSON.parse(form.inputSchema),
        outputSchema: JSON.parse(form.outputSchema),
        requiredCapabilities: split(form.capabilities),
        requiredEvidence: split(form.evidence) as Evidence["type"][],
        approvalPoints: [],
        failurePolicy: form.failurePolicy,
      });
      setOpen(false);
      notify("success", "Skill 草稿已创建");
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  async function publish(id: string): Promise<void> {
    try {
      await window.moxt.publishSkill(id);
      notify("success", "Skill 已验证并发布");
    } catch (error) {
      notify("error", errorText(error));
    }
  }
  return (
    <div className="memory-panel">
      <div className="panel-actions">
        <div>
          <h3>工作方法</h3>
          <p>Skill 版本被工作单锁定；声明能力不会扩大岗位权限。</p>
        </div>
        <button className="primary" onClick={() => setOpen(true)}>
          <Plus />
          新建 Skill
        </button>
      </div>
      {skills.map((skill) => {
        const version =
          snapshot.skillVersions.find(
            (item) =>
              item.skillId === skill.id &&
              (!skill.activeVersionId || item.id === skill.activeVersionId),
          ) ?? snapshot.skillVersions.find((item) => item.skillId === skill.id);
        return (
          <article className="governance-card" key={skill.id}>
            <header>
              <strong>{skill.name}</strong>
              <span>
                {statusLabel(skill.status)} · v{version?.version}
              </span>
            </header>
            <p>{skill.description}</p>
            <small>触发：{skill.trigger}</small>
            {version?.status === "DRAFT" && (
              <footer>
                <button
                  className="primary"
                  onClick={() => void publish(version.id)}
                >
                  <BookOpenCheck />
                  校验并发布
                </button>
              </footer>
            )}
          </article>
        );
      })}
      {open && (
        <div className="modal-backdrop">
          <div className="modal wide-modal">
            <header>
              <div>
                <h2>创建 Skill 草稿</h2>
                <p>使用 Markdown 写步骤，JSON Schema 定义输入输出。</p>
              </div>
              <button onClick={() => setOpen(false)}>
                <X />
              </button>
            </header>
            <div className="form-grid">
              <label>
                名称
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                触发条件
                <input
                  value={form.trigger}
                  onChange={(e) =>
                    setForm({ ...form, trigger: e.target.value })
                  }
                />
              </label>
              <label className="full">
                说明
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
              <label className="full">
                执行步骤（Markdown）
                <textarea
                  value={form.instructions}
                  onChange={(e) =>
                    setForm({ ...form, instructions: e.target.value })
                  }
                />
              </label>
              <label>
                输入 Schema
                <textarea
                  value={form.inputSchema}
                  onChange={(e) =>
                    setForm({ ...form, inputSchema: e.target.value })
                  }
                />
              </label>
              <label>
                输出 Schema
                <textarea
                  value={form.outputSchema}
                  onChange={(e) =>
                    setForm({ ...form, outputSchema: e.target.value })
                  }
                />
              </label>
              <label>
                所需能力（每行一条）
                <textarea
                  value={form.capabilities}
                  onChange={(e) =>
                    setForm({ ...form, capabilities: e.target.value })
                  }
                />
              </label>
              <label>
                Evidence（每行一条）
                <textarea
                  value={form.evidence}
                  onChange={(e) =>
                    setForm({ ...form, evidence: e.target.value })
                  }
                />
              </label>
              <label className="full">
                失败策略
                <input
                  value={form.failurePolicy}
                  onChange={(e) =>
                    setForm({ ...form, failurePolicy: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="permission-note">
              <ShieldAlert />
              发布只代表结构校验通过；涉及外部副作用的能力仍会被默认拒绝并要求审批。
            </div>
            <footer>
              <button className="secondary" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                className="primary"
                disabled={!form.name || !form.instructions}
                onClick={() => void create()}
              >
                保存草稿
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
