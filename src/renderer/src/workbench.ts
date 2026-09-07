import type {
  AppSnapshot,
  Change,
  WorkflowType,
  Agent,
  Workspace,
  RuntimeInfo,
} from "../../shared/contracts";
import { phasesFor } from "../../shared/workflows";

export const localDate = (value: string | null, now = new Date()): boolean => {
  if (!value) return false;
  const date = new Date(value);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};
export const dateTime = (value: string | null): string =>
  value
    ? new Date(value).toLocaleString([], {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未安排";
export const recent = <T extends { updatedAt: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export function taskSummary(change: Change, snapshot: AppSnapshot): string {
  const issue = snapshot.issues.find(
    (i) =>
      i.changeId === change.id &&
      !["RESOLVED", "VERIFIED", "WONT_FIX"].includes(i.status),
  );
  if (issue && ["BLOCKED", "FAILED"].includes(change.status))
    return issue.title;
  if (change.status === "WAITING_HUMAN")
    return snapshot.artifacts.some(
      (a) => a.changeId === change.id && a.status === "REVIEW",
    )
      ? "方案已提交，等待你审阅"
      : "等待人工确认阶段验收要求";
  if (change.status === "FAILED") return "执行失败，请查看执行记录并处理";
  if (change.status === "BLOCKED") return "执行受阻，请查看当前阶段与验收证据";
  if (change.status === "DONE") return "任务已完成，可查看交付物与验收证据";
  return (
    phasesFor(change.workflowType, change.currentPhase)[change.currentPhase]
      ?.name ?? "正在准备执行"
  );
}
export function recommendWorkflow(text: string): WorkflowType {
  if (/线上|故障|事故|incident|宕机/i.test(text)) return "incident";
  if (/发布|上线|release/i.test(text)) return "release";
  if (/重构|refactor/i.test(text)) return "refactor";
  if (/修复|bug|报错|无响应/i.test(text)) return "bug-fix";
  return "cross-project";
}
export function taskPreflight(
  agents: Agent[],
  workspaces: Workspace[],
  runtimes: RuntimeInfo[],
  bindings: Record<string, { workspaceId: string; write: boolean }>,
): string[] {
  const errors: string[] = [];
  if (!workspaces.length) errors.push("请至少选择一个项目目录。");
  if (!agents.length) errors.push("请至少选择一名 Agent；可在数字员工中配置。");
  for (const agent of agents) {
    const binding = bindings[agent.id];
    const workspace = workspaces.find((w) => w.id === binding?.workspaceId);
    if (!workspace) errors.push(`${agent.name}：请选择有效的项目绑定。`);
    if (binding?.write && workspace && !workspace.repoRoot)
      errors.push(
        `${agent.name}：写入需要 Git 项目，请更换目录或关闭写入权限。`,
      );
    if (agent.runtime === "custom") {
      if (!agent.command?.trim())
        errors.push(`${agent.name}：请先配置自定义运行命令。`);
    } else if (!runtimes.some((r) => r.type === agent.runtime && r.available))
      errors.push(
        `${agent.name}：${agent.runtime} 运行环境不可用，请在设置中检查。`,
      );
  }
  return errors;
}
