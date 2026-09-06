import { describe, it, expect } from "vitest";
import {
  localDate,
  recommendWorkflow,
  taskPreflight,
} from "../src/renderer/src/workbench";
import type { Agent, Workspace, RuntimeInfo } from "../src/shared/contracts";
const agent = {
  id: "a",
  name: "Developer",
  runtime: "codex",
  permissions: { write: true },
} as Agent;
const workspace = { id: "w", repoRoot: "/repo" } as Workspace;
const runtime = { type: "codex", available: true } as RuntimeInfo;
describe("workbench date and task preflight", () => {
  it("counts only the same local calendar day, excluding old and missing timestamps", () => {
    const now = new Date(2026, 8, 6, 0, 5);
    expect(localDate(new Date(2026, 8, 6, 0, 1).toISOString(), now)).toBe(true);
    expect(localDate(new Date(2026, 8, 5, 23, 59).toISOString(), now)).toBe(
      false,
    );
    expect(localDate(null, now)).toBe(false);
    expect(localDate("invalid", now)).toBe(false);
  });
  it("recommends incident handling ahead of a generic fix", () => {
    expect(recommendWorkflow("修复线上故障")).toBe("incident");
    expect(recommendWorkflow("修复模板页无响应")).toBe("bug-fix");
    expect(recommendWorkflow("发布前检查")).toBe("release");
    expect(recommendWorkflow("重构订单模块")).toBe("refactor");
    expect(recommendWorkflow("实现跨项目需求")).toBe("cross-project");
  });
  it("accepts a ready runtime and valid workspace binding", () => {
    expect(
      taskPreflight([agent], [workspace], [runtime], {
        a: { workspaceId: "w", write: true },
      }),
    ).toEqual([]);
  });
  it("rejects removed workspace bindings instead of starting in the wrong project", () => {
    expect(
      taskPreflight([agent], [workspace], [runtime], {
        a: { workspaceId: "removed", write: true },
      }).join(),
    ).toContain("有效的项目绑定");
  });
  it("rejects unavailable runtimes and write access to non-git directories", () => {
    const messages = taskPreflight(
      [agent],
      [{ ...workspace, repoRoot: null }],
      [],
      { a: { workspaceId: "w", write: true } },
    ).join();
    expect(messages).toContain("运行环境不可用");
    expect(messages).toContain("写入需要 Git");
  });
  it("allows read-only work in a normal directory, and checks custom command configuration", () => {
    expect(
      taskPreflight(
        [{ ...agent, runtime: "custom", command: "my-agent" }],
        [{ ...workspace, repoRoot: null }],
        [],
        { a: { workspaceId: "w", write: false } },
      ),
    ).toEqual([]);
    expect(
      taskPreflight(
        [{ ...agent, runtime: "custom", command: " " }],
        [workspace],
        [],
        { a: { workspaceId: "w", write: false } },
      ).join(),
    ).toContain("配置自定义运行命令");
  });
});
