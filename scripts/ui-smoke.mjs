// Render the production UI with isolated IPC fixtures. Never invokes real agents.
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-sandbox");
if (process.env.UI_HEADLESS !== "0")
  app.commandLine.appendSwitch("ozone-platform", "headless");
const temp = mkdtempSync(join(tmpdir(), "agent-teams-ui-"));
app.setPath("userData", temp);
const screenshotDir =
  process.env.UI_SCREENSHOT_DIR || join(temp, "screenshots");
mkdirSync(screenshotDir, { recursive: true });
const timestamp = new Date().toISOString();
const permissions = {
  read: true,
  write: false,
  shell: true,
  git: true,
  network: false,
};
const agent = {
  id: "a",
  name: "Architect",
  icon: "A",
  description: "架构设计",
  responsibility: "负责方案与接口契约",
  qualityBar: [],
  runtime: "codex",
  command: null,
  argsTemplate: null,
  workspaceIds: ["w"],
  permissions,
  status: "IDLE",
  createdAt: timestamp,
};
const change = {
  id: "c",
  roomId: "room",
  number: 128,
  title: "设计资产预览架构",
  description: "统一预览入口，明确接口边界。\n验收：加载与失败恢复路径可验证。",
  workflowType: "cross-project",
  priority: "P1",
  dueDate: null,
  status: "WAITING_HUMAN",
  currentPhase: 2,
  workspaceIds: ["w"],
  agentIds: ["a"],
  tags: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const snapshot = Object.fromEntries(
  [
    "rooms",
    "roomMembers",
    "roomContexts",
    "roomEvents",
    "changes",
    "agents",
    "workspaces",
    "runtimes",
    "messages",
    "runs",
    "artifacts",
    "bindings",
    "workstreams",
    "tasks",
    "agentSessions",
    "handoffs",
    "issues",
    "interventions",
    "conversations",
    "conversationParticipants",
    "conversationRounds",
    "conversationTurns",
    "conversationMemories",
    "conversationDeliverables",
    "agentProfiles",
    "memories",
    "skills",
    "skillVersions",
    "workOrders",
    "deliverables",
    "schedules",
    "scheduleExecutions",
    "notifications",
  ].map((k) => [k, []]),
);
Object.assign(snapshot, {
  rooms: [
    {
      id: "room",
      name: "设计资产预览",
      goal: "统一预览入口与接口边界",
      kind: "PROJECT",
      status: "ACTIVE",
      policy: {
        permissions: { ...permissions, write: true, network: true },
        skillVersionIds: [],
        allowAgentDelegation: true,
        responseMode: "MENTION_ONLY",
        maxAgentTurns: 20,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  roomMembers: [
    {
      id: "room-agent",
      roomId: "room",
      subjectType: "AGENT",
      subjectId: "a",
      role: "AGENT",
      permissions,
      canInstruct: true,
      canApprove: false,
      createdAt: timestamp,
    },
  ],
  roomContexts: [
    {
      id: "room-context",
      roomId: "room",
      version: 1,
      summary: "等待架构评审",
      facts: ["主分支为 main"],
      decisions: [],
      constraints: ["保持接口兼容"],
      openQuestions: [],
      updatedAt: timestamp,
    },
  ],
  changes: [
    change,
    {
      ...change,
      id: "running",
      number: 129,
      title: "修复工作流模板详情页",
      status: "RUNNING",
      currentPhase: 3,
    },
    { ...change, id: "old", status: "DONE", updatedAt: "2020-01-01T00:00:00Z" },
  ],
  agents: [agent],
  workspaces: [
    {
      id: "w",
      name: "agent_teams",
      path: "/projects/agent_teams",
      repoRoot: "/projects/agent_teams",
      branch: "main",
      baseCommit: "abc",
      createdAt: timestamp,
    },
    {
      id: "w2",
      name: "second_project",
      path: "/projects/second",
      repoRoot: "/projects/second",
      branch: "main",
      baseCommit: "abc",
      createdAt: timestamp,
    },
  ],
  runtimes: [
    {
      type: "codex",
      label: "Codex",
      executable: "codex",
      path: "/usr/bin/codex",
      version: "test",
      available: true,
      capabilities: [],
    },
  ],
  artifacts: [
    {
      id: "artifact",
      changeId: "c",
      type: "Proposal",
      title: "预览架构方案与接口契约",
      version: 2,
      status: "REVIEW",
      content:
        "# 预览架构方案\n\n统一预览入口，区分资产检查与游戏运行预览。\n\n## 验收要求\n- 加载成功与异常状态清晰\n- 错误可恢复\n- 接口契约可追溯",
      supersedes: null,
      createdAt: timestamp,
      approvedAt: null,
    },
  ],
  messages: [
    {
      id: "m",
      changeId: "c",
      senderType: "agent",
      senderId: "a",
      senderName: "Architect",
      content: "方案与接口契约已经整理，请确认后进入开发阶段。",
      runId: null,
      createdAt: timestamp,
    },
    {
      id: "system",
      changeId: "c",
      senderType: "system",
      senderId: null,
      senderName: "系统",
      content: "读取现有接口\n已比对预览链路并整理验收要求。",
      runId: null,
      createdAt: timestamp,
    },
  ],
  agentProfiles: [
    {
      id: "profile",
      agentId: "a",
      positionTitle: "架构师",
      outcomeStatement: "将复杂需求转化为可以验收的方案",
      recurringResponsibilities: ["维护接口边界", "提交架构方案"],
      preferredSources: [],
      standardDeliverables: [],
      acceptanceCriteria: [],
      prohibitedActions: [],
      approvalPoints: [],
      failurePolicy: "",
      defaultSkillIds: [],
      status: "ACTIVE",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  schedules: [
    {
      id: "schedule",
      name: "每日架构检查",
      ownerAgentId: "a",
      workOrderTemplate: { title: "检查", goal: "检查", ownerAgentId: "a" },
      cronExpression: "0 9 * * *",
      timezone: "Asia/Shanghai",
      enabled: true,
      misfirePolicy: "SKIP",
      concurrencyPolicy: "SKIP",
      maxCatchUpRuns: 1,
      retryPolicy: { maxAttempts: 1, backoffSeconds: [] },
      nextRunAt: new Date(Date.now() + 86400000).toISOString(),
      lastScheduledAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  workOrders: [
    {
      id: "order",
      roomId: "room",
      number: 12,
      title: "每日接口检查",
      goal: "检查接口变更",
      ownerAgentId: "a",
      createdByType: "SCHEDULE",
      createdById: null,
      scheduleId: "schedule",
      parentWorkOrderId: null,
      projectScopeId: null,
      workspaceId: "w",
      skillVersionIds: [],
      input: {},
      constraints: [],
      outputContract: {},
      requiredEvidence: [],
      permissions,
      status: "SUCCEEDED",
      statusReason: null,
      idempotencyKey: "test",
      dueAt: null,
      currentRunId: null,
      startedAt: timestamp,
      completedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  deliverables: [
    {
      id: "delivery",
      workOrderId: "order",
      runId: "test-run",
      title: "接口检查报告",
      content: "# 检查报告\n接口边界已确认。",
      filePath: null,
      sha256: null,
      createdAt: timestamp,
    },
  ],
});
let win;
const calls = [];
let rejectAdvance = true;
ipcMain.handle("app:snapshot", () => snapshot);
ipcMain.handle("runtime:detect", () => snapshot.runtimes);
ipcMain.handle("room:policy-update", (_e, roomId, policy) => {
  calls.push(["room-policy", roomId, policy]);
  snapshot.rooms[0].policy = policy;
  publish();
  return snapshot.rooms[0];
});
ipcMain.handle("room:context-update", (_e, roomId, context) => {
  calls.push(["room-context", roomId, context]);
  Object.assign(snapshot.roomContexts[0], context, {
    version: snapshot.roomContexts[0].version + 1,
  });
  publish();
  return snapshot.roomContexts[0];
});
ipcMain.handle("artifact:approve", (_e, id, approve, feedback) => {
  calls.push(["approve", id, approve, feedback]);
  snapshot.artifacts[0].status = approve ? "APPROVED" : "DRAFT";
  publish();
});
ipcMain.handle("workflow:advance", () => {
  calls.push(["advance"]);
  if (rejectAdvance) throw Error("存在未验收任务");
  change.status = "RUNNING";
  publish();
});
ipcMain.handle("message:send", (_e, ...args) => {
  calls.push(["message", ...args]);
});
ipcMain.handle("change:create", (_e, input) => {
  calls.push(["create", input]);
  snapshot.changes.push({
    ...change,
    ...input,
    id: "new",
    number: 130,
    status: "INITIALIZING",
    currentPhase: 0,
  });
  publish();
  return snapshot.changes.at(-1);
});
function publish() {
  win.webContents.send("runtime:event", { type: "snapshot.changed", snapshot });
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function js(code) {
  return win.webContents.executeJavaScript(code, true);
}
async function settle() {
  await delay(80);
}
async function click(text, selector = "button") {
  await js(
    `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)}) && e.getClientRects().length);if(!e)throw Error('Missing button: '+${JSON.stringify(text)});if(e.disabled)throw Error('Disabled: '+${JSON.stringify(text)});e.click()})()`,
  );
  await settle();
}
async function nav(label) {
  await js(
    `document.querySelector('.nav-item[aria-label="${label}"]').click()`,
  );
  await settle();
}
async function screenshot(name) {
  await settle();
  writeFileSync(
    join(screenshotDir, name + ".png"),
    (await win.webContents.capturePage()).toPNG(),
  );
}
async function fits(label) {
  const result = await js(
    `({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main button,main input,main textarea')].filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.textContent.slice(0,40))})`,
  );
  assert.ok(
    result.scroll <= result.width + 1,
    `${label}: document overflow ${JSON.stringify(result)}`,
  );
  assert.equal(
    result.overflow.length,
    0,
    `${label}: controls outside viewport ${JSON.stringify(result)}`,
  );
}
const timer = setTimeout(() => {
  console.error("UI smoke timed out");
  app.exit(1);
}, 60000);
async function main() {
  try {
    console.log("Starting Electron UI smoke");
    await app.whenReady();
    console.log("Electron ready");
    win = new BrowserWindow({
      width: 1440,
      height: 940,
      show: false,
      webPreferences: {
        preload: resolve("out/preload/index.cjs"),
        contextIsolation: true,
        sandbox: true,
        offscreen: true,
      },
    });
    const errors = [];
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3 && !message.includes("Content-Security-Policy")) {
        errors.push(message);
        console.error("Renderer:", message);
      }
    });
    console.log("Loading renderer");
    await win.loadFile(resolve("out/renderer/index.html"));
    console.log("Renderer loaded");

    await settle();
    for (const width of [1440, 1024, 760]) {
      win.setSize(width, 940);
      await nav("工作台");
      console.log(`Checking ${width}px`);
      await fits("dashboard " + width);
      assert.equal(
        await js(
          `/今日完成\\s*1/.test(document.querySelector('.workbench-summary').textContent)`,
        ),
        true,
      );
      if (width === 1440) await screenshot("workbench");
      await click("去处理");
      await fits("review " + width);
      if (width === 1440) await screenshot("task-review");
      if (width === 1440) {
        await click("空间设置");
        await fits("room settings");
        await screenshot("room-settings");
        await click("保存空间设置");
        assert.deepEqual(
          calls.slice(-2).map((call) => call[0]),
          ["room-policy", "room-context"],
        );
      }
      await click("协作动态");
      await fits("chat " + width);
      await click("执行流程", ".room-tabs button");
      await fits("workflow " + width);
      await nav("数字员工");
      await fits("employees " + width);
      if (width === 1440) await screenshot("employees");
      await click("岗位说明");
      await fits("profile " + width);
      await nav("任务中心");
      await fits("tasks " + width);
      await nav("工作单");
      await fits("orders " + width);
      await nav("定时计划");
      await fits("schedules " + width);
      await nav("团队讨论");
      await fits("discussions " + width);
      await nav("设置");
      await fits("settings " + width);
    }
    win.setSize(1440, 940);
    await nav("工作台");
    await click("去处理");
    await click("批准并继续执行");
    assert.deepEqual(
      calls.slice(-2).map((c) => c[0]),
      ["approve", "advance"],
    );
    assert.ok(
      (
        await js(`document.querySelector('.review-actions').textContent`)
      ).includes("审批已保存，阶段尚未推进"),
    );
    await click("协作动态");
    await click("Architect", ".team-rail button");
    assert.equal(
      await js(`Boolean(document.querySelector('[role="dialog"]'))`),
      true,
    );
    await fits("inspector");
    await js(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    );
    await settle();
    assert.equal(
      await js(`Boolean(document.querySelector('[role="dialog"]'))`),
      false,
    );
    await nav("工作台");
    await click("新建任务");
    await js(
      `(()=>{const inputs=document.querySelectorAll('.form-grid input');const areas=document.querySelectorAll('.form-grid textarea');function set(e,value){Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}set(inputs[0],'修复接口错误');set(areas[0],'保持兼容');set(areas[1],'回归测试通过');})()`,
    );
    await settle();
    await click("下一步");
    await js(
      `document.querySelectorAll('.workspace-option input').forEach(e=>e.click())`,
    );
    await settle();
    await click("Architect", ".agent-binding-card button");
    await js(
      `(()=>{const e=document.querySelector('.binding-controls select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'w2');e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await settle();
    await js(`document.querySelectorAll('.workspace-option input')[1].click()`);
    await settle();
    assert.equal(
      await js(`document.querySelector('.binding-controls select').value`),
      "w",
    );
    await fits("new task bindings");
    await click("下一步");
    await screenshot("new-task");
    await click("创建并开始执行");
    const create = calls.find((c) => c[0] === "create")[1];
    assert.deepEqual(create.workspaceIds, ["w"]);
    assert.equal(create.agentBindings[0].workspaceId, "w");
    assert.equal(create.workflowType, "bug-fix");
    assert.match(create.description, /验收标准/);
    assert.deepEqual(errors, []);
    console.log(
      "UI smoke passed: 3 viewport widths, 11 page states, Room settings, review partial failure, drawer Escape, goal-first creation and binding recovery.",
    );
    console.log("Screenshots:", screenshotDir);
    clearTimeout(timer);
    win.destroy();
    if (process.env.UI_SCREENSHOT_DIR)
      rmSync(temp, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timer);
    app.exit(1);
  }
}
// Do not await readiness at ESM top level: Electron waits for entry-module evaluation.
void main();
