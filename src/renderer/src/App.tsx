import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Boxes,
  Brain,
  BriefcaseBusiness,
  CalendarClock,
  LayoutDashboard,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  UserRoundCog,
} from "lucide-react";
import { useAppStore } from "./store";
import Dashboard from "./pages/Dashboard";
import NewTask from "./pages/NewTask";
import TaskRoom from "./pages/TaskRoom";
import Agents from "./pages/Agents";
import RuntimeSettings from "./pages/RuntimeSettings";
import Discussions from "./pages/Discussions";
import ConversationRoom from "./pages/ConversationRoom";
import Workflows from "./pages/Workflows";
import LongTermAgents from "./pages/LongTermAgents";
import WorkOrders from "./pages/WorkOrders";
import WorkOrderRoom from "./pages/WorkOrderRoom";
import Schedules from "./pages/Schedules";
import Tasks from "./pages/Tasks";

type Route = {
  page:
    | "dashboard"
    | "tasks"
    | "new"
    | "task"
    | "discussions"
    | "conversation"
    | "agents"
    | "employees"
    | "work-orders"
    | "work-order"
    | "schedules"
    | "notifications"
    | "settings"
    | "workflows";
  id?: string;
  createRequest?: number;
  tab?: "chat" | "workflow" | "artifacts";
  artifactId?: string;
};

export default function App(): import("react").JSX.Element {
  const { ready, load, apply, snapshot, notice } = useAppStore();
  const [route, setRoute] = useState<Route>({ page: "dashboard" });
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "true",
  );
  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);
  useEffect(() => {
    void load();
    return window.moxt.onRuntimeEvent(apply);
  }, [load, apply]);
  const active = useMemo(
    () =>
      route.page === "task"
        ? snapshot.changes.find((change) => change.id === route.id)
        : undefined,
    [route, snapshot],
  );
  const activeConversation = useMemo(
    () =>
      route.page === "conversation"
        ? snapshot.conversations.find((item) => item.id === route.id)
        : undefined,
    [route, snapshot],
  );
  const activeWorkOrder = useMemo(
    () =>
      route.page === "work-order"
        ? snapshot.workOrders.find((item) => item.id === route.id)
        : undefined,
    [route, snapshot],
  );
  if (!ready)
    return (
      <div className="boot">
        <div className="brand-mark">AT</div>
        <LoaderCircle className="spin" />
        <span>正在恢复 Agent Teams Runtime…</span>
      </div>
    );
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="logo">
          <button
            className="brand-mark"
            aria-label={collapsed ? "展开导航" : "收起导航"}
            onClick={() => setCollapsed((v) => !v)}
          >
            AT
          </button>
          <div>
            <strong>Agent Teams</strong>
            <span>AI Team Runtime</span>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "展开导航" : "收起导航"}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <nav aria-label="主导航">
          <Nav
            icon={<LayoutDashboard />}
            label="工作台"
            active={route.page === "dashboard"}
            onClick={() => setRoute({ page: "dashboard" })}
          />
          <div className="nav-group">工作 · 协作任务与岗位工作单</div>
          <Nav
            icon={<Boxes />}
            label="任务中心"
            active={
              route.page === "tasks" ||
              route.page === "task" ||
              route.page === "new" ||
              route.page === "workflows"
            }
            onClick={() => setRoute({ page: "tasks" })}
            badge={
              snapshot.changes.filter((item) =>
                ["RUNNING", "BLOCKED", "WAITING_HUMAN"].includes(item.status),
              ).length
            }
          />
          <Nav
            icon={<BriefcaseBusiness />}
            label="工作单"
            active={route.page === "work-orders" || route.page === "work-order"}
            onClick={() => setRoute({ page: "work-orders" })}
            badge={
              snapshot.workOrders.filter((item) =>
                ["RUNNING", "BLOCKED"].includes(item.status),
              ).length
            }
          />
          <div className="nav-group">团队协作</div>
          <Nav
            icon={<Brain />}
            label="团队讨论"
            active={
              route.page === "discussions" || route.page === "conversation"
            }
            onClick={() => setRoute({ page: "discussions" })}
            badge={
              snapshot.conversations.filter((item) => item.status === "RUNNING")
                .length
            }
          />
          <Nav
            icon={<UserRoundCog />}
            label="数字员工"
            active={route.page === "employees" || route.page === "agents"}
            onClick={() => setRoute({ page: "employees" })}
          />
          <Nav
            icon={<CalendarClock />}
            label="定时计划"
            active={route.page === "schedules"}
            onClick={() => setRoute({ page: "schedules" })}
          />
          <div className="nav-group">管理</div>
          <Nav
            icon={<Bell />}
            label="通知"
            active={route.page === "notifications"}
            onClick={() => setRoute({ page: "notifications" })}
            badge={snapshot.notifications.filter((item) => !item.readAt).length}
          />
          <Nav
            icon={<Settings />}
            label="设置"
            active={route.page === "settings"}
            onClick={() => setRoute({ page: "settings" })}
          />
        </nav>
        <div className="sidebar-foot">
          <span className="avatar">M</span>
          <div>
            <strong>本地工作台</strong>
            <span className="online">
              {snapshot.runtimes.filter((r) => r.available).length}{" "}
              个运行环境可用
            </span>
          </div>
        </div>
      </aside>
      <main className="main">
        {route.page === "dashboard" && (
          <Dashboard
            onNew={() => setRoute({ page: "new" })}
            onNewChat={() =>
              setRoute({ page: "discussions", createRequest: Date.now() })
            }
            onOpen={(id, tab, artifactId) =>
              setRoute({ page: "task", id, tab, artifactId })
            }
            onOpenOrder={(id) => setRoute({ page: "work-order", id })}
            onSchedules={() => setRoute({ page: "schedules" })}
            onConversation={(id) => setRoute({ page: "conversation", id })}
          />
        )}
        {route.page === "new" && (
          <NewTask onCreated={(id) => setRoute({ page: "task", id })} />
        )}
        {route.page === "tasks" && (
          <Tasks
            onNew={() => setRoute({ page: "new" })}
            onOpen={(id) => setRoute({ page: "task", id })}
            onOpenWorkflows={() => setRoute({ page: "workflows" })}
          />
        )}
        {route.page === "task" && active && (
          <TaskRoom
            key={active.id}
            change={active}
            initialTab={route.tab}
            initialArtifactId={route.artifactId}
            onBack={() => setRoute({ page: "tasks" })}
          />
        )}
        {route.page === "discussions" && (
          <Discussions
            createRequest={route.createRequest}
            onOpen={(id) => setRoute({ page: "conversation", id })}
          />
        )}
        {route.page === "conversation" && activeConversation && (
          <ConversationRoom
            conversation={activeConversation}
            onBack={() => setRoute({ page: "discussions" })}
            onOpenTask={(id) => setRoute({ page: "task", id })}
          />
        )}
        {route.page === "agents" && (
          <Agents onBack={() => setRoute({ page: "employees" })} />
        )}
        {route.page === "employees" && (
          <LongTermAgents
            onManageAgents={() => setRoute({ page: "agents" })}
            onOpenTask={(id) => setRoute({ page: "task", id })}
            onOpenOrder={(id) => setRoute({ page: "work-order", id })}
            onSchedules={() => setRoute({ page: "schedules" })}
          />
        )}
        {route.page === "work-orders" && (
          <WorkOrders onOpen={(id) => setRoute({ page: "work-order", id })} />
        )}
        {route.page === "work-order" && activeWorkOrder && (
          <WorkOrderRoom
            order={activeWorkOrder}
            onBack={() => setRoute({ page: "work-orders" })}
          />
        )}
        {route.page === "schedules" && (
          <Schedules
            onOpenOrder={(id) => setRoute({ page: "work-order", id })}
          />
        )}
        {route.page === "notifications" && <NotificationList />}
        {route.page === "settings" && <RuntimeSettings />}
        {route.page === "workflows" && <Workflows />}
      </main>
      {notice && <div className={`toast ${notice.type}`}>{notice.text}</div>}
    </div>
  );
}

function NotificationList(): import("react").JSX.Element {
  const { snapshot } = useAppStore();
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>通知中心</h1>
          <p>工作单阻塞、失败和计划错过都会留下可追溯原因。</p>
        </div>
      </header>
      <div className="list-card">
        {snapshot.notifications.length ? (
          snapshot.notifications.map((item) => (
            <button
              className="large-row notification-row"
              key={item.id}
              onClick={() => void window.moxt.markNotificationRead(item.id)}
            >
              <Bell />
              <span>
                <strong>{item.title}</strong>
                <small>{item.body}</small>
              </span>
              <em>{item.readAt ? "已读" : "标记已读"}</em>
            </button>
          ))
        ) : (
          <div className="empty">
            <Bell />
            <h3>暂无通知</h3>
          </div>
        )}
      </div>
    </section>
  );
}

function Nav({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: import("react").JSX.Element;
  label: string;
  active: boolean;
  onClick(): void;
  badge?: number;
}): import("react").JSX.Element {
  return (
    <button
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`nav-item ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {Boolean(badge) && <em>{badge}</em>}
    </button>
  );
}
