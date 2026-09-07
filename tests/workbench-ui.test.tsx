// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/src/App";
import { useAppStore } from "../src/renderer/src/store";
import type { AppSnapshot, DesktopApi } from "../src/shared/contracts";
import fixture from "./fixtures/workbench.json";
let root: Root;
let snapshot: AppSnapshot;
let api: DesktopApi;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
async function click(text: string, selector = "button") {
  const node = Array.from(
    document.querySelectorAll<HTMLButtonElement>(selector),
  ).find((n) => n.textContent?.includes(text));
  expect(node, `Missing ${selector}: ${text}`).toBeTruthy();
  expect(node!.disabled, `Disabled: ${text}`).not.toBe(true);
  await act(async () => {
    node!.click();
  });
}
async function nav(text: string) {
  await click(text, ".nav-item");
}
async function input(
  node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    node.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : node.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  localStorage.clear();
  snapshot = structuredClone(fixture) as AppSnapshot;
  snapshot.workOrders[0].completedAt = new Date().toISOString();
  api = {
    getSnapshot: vi.fn(async () => snapshot),
    onRuntimeEvent: vi.fn(() => () => {}),
    detectRuntimes: vi.fn(async () => snapshot.runtimes),
    approveArtifact: vi.fn(async () => {}),
    advanceWorkflow: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    createChange: vi.fn(async (input) => {
      const change = { ...snapshot.changes[0], ...input, id: "created" };
      useAppStore.setState({
        snapshot: { ...snapshot, changes: [...snapshot.changes, change] },
      });
      return change;
    }),
  } as unknown as DesktopApi;
  window.moxt = api;
  useAppStore.setState({ snapshot, ready: false, live: {}, notice: null });
  root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});
describe("workbench interactions", () => {
  it("aggregates current-day completion and opens the exact artifact from dashboard", async () => {
    expect(document.querySelector(".workbench-summary")?.textContent).toMatch(
      /今日完成\s*1/,
    );
    await click("预览架构方案与接口契约", ".work-row");
    expect(document.querySelector(".artifact-view h2")?.textContent).toContain(
      "预览架构方案与接口契约",
    );
    expect(document.querySelector(".room-tabs .active")?.textContent).toContain(
      "交付物与验收",
    );
  });
  it("distinguishes a saved approval from a failed phase advance", async () => {
    vi.mocked(api.advanceWorkflow).mockRejectedValue(
      new Error("存在未验收任务"),
    );
    await click("去处理");
    await click("批准并继续执行");
    expect(api.approveArtifact).toHaveBeenCalledWith(
      "artifact",
      true,
      undefined,
    );
    expect(api.advanceWorkflow).toHaveBeenCalledWith("c");
    expect(document.querySelector(".review-actions")?.textContent).toContain(
      "审批已保存，阶段尚未推进",
    );
  });
  it("does not advance after a rejected approval and requires feedback for rework", async () => {
    vi.mocked(api.approveArtifact).mockRejectedValue(new Error("审批失败"));
    await click("去处理");
    await click("批准并继续执行");
    expect(api.advanceWorkflow).not.toHaveBeenCalled();
    vi.mocked(api.approveArtifact).mockClear();
    await click("退回修改");
    expect(api.approveArtifact).not.toHaveBeenCalled();
    expect(document.querySelector(".review-actions")?.textContent).toContain(
      "请填写修改意见",
    );
  });
  it("shows employee work by default and navigates to the actual work order", async () => {
    await nav("数字员工");
    expect(document.querySelector(".detail-tabs .active")?.textContent).toBe(
      "工作概览",
    );
    expect(document.querySelector(".employee-overview")?.textContent).toContain(
      "将复杂需求转化为可以验收的方案",
    );
    await click("每日接口检查", ".employee-overview button");
    expect(document.querySelector(".workorder-room h1")?.textContent).toBe(
      "每日接口检查",
    );
    await click("执行记录", ".workorder-tabs button");
    expect(document.querySelector(".runtime-panel")).not.toBeNull();
    await click("交付与验收", ".workorder-tabs button");
    expect(document.querySelector(".deliverable-document")).not.toBeNull();
  });
  it("closes execution drawer with Escape and shows unknown usage as unknown", async () => {
    await click("去处理");
    await click("协作动态", ".room-tabs button");
    await click("Architect", ".team-rail button");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("tokens", ".usage-pill");
    expect(document.querySelector(".usage-grid")?.textContent).toContain("—");
  });
  it("submits goal, acceptance and the resolved workspace after removing a previous binding", async () => {
    await click("新建任务");
    const inputs =
      document.querySelectorAll<HTMLInputElement>(".form-grid input");
    const areas = document.querySelectorAll<HTMLTextAreaElement>(
      ".form-grid textarea",
    );
    await input(inputs[0], "修复接口错误");
    await input(areas[0], "保持兼容");
    await input(areas[1], "回归测试通过");
    await click("下一步");
    await act(async () =>
      document
        .querySelectorAll<HTMLInputElement>(".workspace-option input")
        .forEach((n) => n.click()),
    );
    await click("Architect", ".agent-binding-card button");
    await input(
      document.querySelector<HTMLSelectElement>(".binding-controls select")!,
      "w2",
    );
    await act(async () =>
      document
        .querySelectorAll<HTMLInputElement>(".workspace-option input")[1]
        .click(),
    );
    expect(
      document.querySelector<HTMLSelectElement>(".binding-controls select")!
        .value,
    ).toBe("w");
    await click("下一步");
    await click("创建并开始执行");
    const payload = vi.mocked(api.createChange).mock.calls[0][0];
    expect(payload.workspaceIds).toEqual(["w"]);
    expect(payload.agentBindings[0].workspaceId).toBe("w");
    expect(payload.workflowType).toBe("bug-fix");
    expect(payload.description).toContain("## 验收标准\n回归测试通过");
  });
  it("persists manual navigation collapse and retains all navigation labels", async () => {
    await click("AT", ".sidebar .brand-mark");
    expect(localStorage.getItem("sidebar-collapsed")).toBe("true");
    expect(
      document.querySelector('.nav-item[aria-label="团队讨论"]'),
    ).not.toBeNull();
  });
});
