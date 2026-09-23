import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification as NativeNotification,
  Tray,
} from "electron";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { inspectWorkspace } from "./runtime/git";
import { RuntimeClient } from "./runtime-client";
import type {
  AppSnapshot,
  ConvertConversationInput,
  CreateAgentInput,
  CreateChangeInput,
  CreateConversationInput,
  CreateMemoryInput,
  CreateRoomInput,
  CreateScheduleInput,
  CreateSkillInput,
  CreateWorkOrderInput,
  IssueStatus,
  RoomPolicy,
  RuntimeEvent,
  UpdateAgentInput,
  UpdateRoomContextInput,
  UpsertAgentProfileInput,
} from "../shared/contracts";

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const notified = new Set<string>();
let runtime: RuntimeClient;
let apiServer: ReturnType<typeof createServer> | null = null;
const publish = (event: RuntimeEvent): void => {
  const target = window;
  if (target && !target.isDestroyed())
    target.webContents.send("runtime:event", event);
  if (
    event.type === "snapshot.changed" &&
    (!target || !target.isVisible()) &&
    NativeNotification.isSupported()
  ) {
    for (const item of event.snapshot.notifications.filter(
      (value) => !value.readAt && !notified.has(value.id),
    )) {
      notified.add(item.id);
      new NativeNotification({ title: item.title, body: item.body }).show();
    }
  }
};

function createWindow(): void {
  window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 760,
    minHeight: 600,
    show: false,
    backgroundColor: "#f4f7fb",
    title: "Agent Teams",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.on("ready-to-show", () => window?.show());
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (is.dev && process.env.ELECTRON_RENDERER_URL)
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else window.loadFile(join(__dirname, "../renderer/index.html"));
}

function registerIpc(): void {
  ipcMain.handle("app:snapshot", () =>
    runtime.request<AppSnapshot>({ type: "snapshot.get" }),
  );
  ipcMain.handle("room:create", (_event, input: CreateRoomInput) =>
    runtime.request({ type: "room.create", input }),
  );
  ipcMain.handle(
    "room:policy-update",
    (_event, roomId: string, policy: RoomPolicy) =>
      runtime.request({ type: "room.policy.update", roomId, policy }),
  );
  ipcMain.handle(
    "room:context-update",
    (_event, roomId: string, input: UpdateRoomContextInput) =>
      runtime.request({ type: "room.context.update", roomId, input }),
  );
  ipcMain.handle("workspace:select", async () => {
    const result = await dialog.showOpenDialog(window!, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择本地项目 Workspace",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    const info = await inspectWorkspace(path);
    return runtime.request({
      type: "workspace.add",
      workspace: { path, ...info },
    });
  });
  ipcMain.handle("change:create", (_event, input: CreateChangeInput) =>
    runtime.request({ type: "change.create", input }),
  );
  ipcMain.handle("change:kick", (_event, changeId: string, reason?: string) =>
    runtime.request({ type: "change.kick", changeId, reason }),
  );
  ipcMain.handle("agent:create", (_event, input: CreateAgentInput) =>
    runtime.request({ type: "agent.create", input }),
  );
  ipcMain.handle("agent:update", (_event, input: UpdateAgentInput) =>
    runtime.request({ type: "agent.update", input }),
  );
  ipcMain.handle("runtime:detect", () =>
    runtime.request({ type: "runtime.detect" }),
  );
  ipcMain.handle(
    "message:send",
    (_event, changeId: string, content: string, targetAgentId?: string) =>
      runtime.request({
        type: "message.send",
        changeId,
        content,
        targetAgentId,
      }),
  );
  ipcMain.handle(
    "run:control",
    (
      _event,
      runId: string,
      action: "pause" | "resume" | "stop" | "retry",
      reason?: string,
    ) => runtime.request({ type: "run.control", runId, action, reason }),
  );
  ipcMain.handle(
    "artifact:approve",
    (_event, artifactId: string, approve: boolean, feedback?: string) =>
      runtime.request({
        type: "artifact.approve",
        artifactId,
        approve,
        feedback,
      }),
  );
  ipcMain.handle("workflow:advance", (_event, changeId: string) =>
    runtime.request({ type: "workflow.advance", changeId }),
  );
  ipcMain.handle(
    "issue:update",
    (_event, issueId: string, status: IssueStatus, resolution?: string) =>
      runtime.request({ type: "issue.update", issueId, status, resolution }),
  );
  ipcMain.handle(
    "conversation:create",
    (_event, input: CreateConversationInput) =>
      runtime.request({ type: "conversation.create", input }),
  );
  ipcMain.handle(
    "conversation:control",
    (
      _event,
      conversationId: string,
      action: "start" | "pause" | "resume" | "end",
    ) =>
      runtime.request({ type: "conversation.control", conversationId, action }),
  );
  ipcMain.handle(
    "conversation:extend",
    (_event, conversationId: string, additionalRounds: number) =>
      runtime.request({
        type: "conversation.extend",
        conversationId,
        additionalRounds,
      }),
  );
  ipcMain.handle(
    "conversation:message",
    (
      _event,
      conversationId: string,
      content: string,
      targetParticipantId?: string,
    ) =>
      runtime.request({
        type: "conversation.message",
        conversationId,
        content,
        targetParticipantId,
      }),
  );
  ipcMain.handle(
    "conversation:summarize",
    (_event, conversationId: string, deliverableType) =>
      runtime.request({
        type: "conversation.summarize",
        conversationId,
        deliverableType,
      }),
  );
  ipcMain.handle(
    "conversation:convert",
    (_event, conversationId: string, input: ConvertConversationInput) =>
      runtime.request({ type: "conversation.convert", conversationId, input }),
  );
  ipcMain.handle(
    "conversation:export",
    async (_event, conversationId: string) => {
      const value = await runtime.request<{ title: string; content: string }>({
        type: "conversation.export-markdown",
        conversationId,
      });
      const safeName = value.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100);
      const result = await dialog.showSaveDialog(window!, {
        title: "导出讨论记录",
        defaultPath: safeName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, value.content, "utf8");
      return true;
    },
  );
  ipcMain.handle(
    "agent-profile:upsert",
    (_event, input: UpsertAgentProfileInput) =>
      runtime.request({ type: "agentProfile.upsert", input }),
  );
  ipcMain.handle("memory:create", (_event, input: CreateMemoryInput) =>
    runtime.request({ type: "memory.create", input }),
  );
  ipcMain.handle(
    "memory:decide",
    (_event, memoryId: string, decision: "APPROVE" | "REJECT") =>
      runtime.request({ type: "memory.decide", memoryId, decision }),
  );
  ipcMain.handle("skill:create", (_event, input: CreateSkillInput) =>
    runtime.request({ type: "skill.createDraft", input }),
  );
  ipcMain.handle("skill:publish", (_event, skillVersionId: string) =>
    runtime.request({ type: "skill.publish", skillVersionId }),
  );
  ipcMain.handle("work-order:create", (_event, input: CreateWorkOrderInput) =>
    runtime.request({ type: "workOrder.create", input }),
  );
  ipcMain.handle(
    "work-order:control",
    (
      _event,
      id: string,
      action: "start" | "pause" | "resume" | "cancel" | "retry",
    ) => runtime.request({ type: "workOrder.control", id, action }),
  );
  ipcMain.handle("schedule:create", (_event, input: CreateScheduleInput) =>
    runtime.request({ type: "schedule.create", input }),
  );
  ipcMain.handle("schedule:update", (_event, id: string, enabled: boolean) =>
    runtime.request({ type: "schedule.update", id, enabled }),
  );
  ipcMain.handle("schedule:test", (_event, scheduleId: string) =>
    runtime.request({ type: "schedule.testRun", scheduleId }),
  );
  ipcMain.handle(
    "context:compactions",
    (
      _event,
      subjectType: "CONVERSATION" | "WORK_ORDER",
      subjectId: string,
    ) => runtime.request({ type: "context.compactions", subjectType, subjectId }),
  );
  ipcMain.handle(
    "connector:invoke",
    (
      _event,
      input: {
        connectorId: string;
        roomId: string;
        action: string;
        payload?: Record<string, unknown>;
        agentId?: string;
        idempotencyKey?: string;
      },
    ) =>
      runtime.request({
        type: "connector.invoke",
        connectorId: input.connectorId,
        roomId: input.roomId,
        action: input.action,
        payload: input.payload,
        agentId: input.agentId,
        idempotencyKey: input.idempotencyKey,
      }),
  );
  ipcMain.handle("notification:read", (_event, id: string) =>
    runtime.request({ type: "notification.read", id }),
  );
}

function startLocalHttpApi(): void {
  if (apiServer) return;
  const port = Number(process.env.MOXT_HTTP_PORT || "4389");
  const webhookSecret = process.env.MOXT_WEBHOOK_SECRET || "";
  apiServer = createServer((req, res) => {
    void handleApiRequest(req, res, webhookSecret);
  });
  apiServer.listen(port, "127.0.0.1");
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  webhookSecret: string,
): Promise<void> {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/snapshot") {
      return ok(res, await runtime.request<AppSnapshot>({ type: "snapshot.get" }));
    }
    if (req.method === "POST" && url.pathname === "/api/change/create") {
      const input = (await readJson(req)) as CreateChangeInput;
      return ok(res, await runtime.request({ type: "change.create", input }));
    }
    if (req.method === "POST" && url.pathname === "/api/change/kick") {
      const body = (await readJson(req)) as { changeId: string; reason?: string };
      return ok(
        res,
        await runtime.request({
          type: "change.kick",
          changeId: body.changeId,
          reason: body.reason,
        }),
      );
    }
    if (req.method === "POST" && url.pathname === "/api/work-order/create") {
      const input = (await readJson(req)) as CreateWorkOrderInput;
      return ok(res, await runtime.request({ type: "workOrder.create", input }));
    }
    if (req.method === "POST" && url.pathname === "/api/work-order/control") {
      const body = (await readJson(req)) as {
        id: string;
        action: "start" | "pause" | "resume" | "cancel" | "retry";
      };
      return ok(
        res,
        await runtime.request({ type: "workOrder.control", id: body.id, action: body.action }),
      );
    }
    if (req.method === "POST" && url.pathname === "/api/webhook") {
      const raw = await readRaw(req);
      const signature = String(req.headers["x-moxt-signature"] || "");
      if (!verifyWebhook(raw, signature, webhookSecret)) return fail(res, 401, "Invalid signature");
      const payload = JSON.parse(raw) as { request: unknown };
      return ok(res, await runtime.request(payload.request as never));
    }
    fail(res, 404, "Not found");
  } catch (error) {
    console.error("[local-api] request failed", error);
    fail(res, 400, "Invalid request");
  }
}

function verifyWebhook(raw: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const computed = createHmac("sha256", secret).update(raw).digest("hex");
  if (!signature) return false;
  const expected = Buffer.from(computed);
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function ok(res: ServerResponse, value: unknown): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, result: value }));
}

function fail(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: message }));
}

async function readRaw(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readRaw(req);
  return raw ? JSON.parse(raw) : {};
}

function createTray(): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#1266f6"/><text x="16" y="21" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="white">AT</text></svg>`;
  tray = new Tray(
    nativeImage
      .createFromDataURL(
        `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      )
      .resize({ width: 18, height: 18 }),
  );
  tray.setToolTip("Agent Teams · 后台运行中");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开 Agent Teams",
        click: () => {
          window?.show();
          window?.focus();
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", () => window?.show());
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("ai.agentteams.runtime");
  app.on("browser-window-created", (_, createdWindow) =>
    optimizer.watchWindowShortcuts(createdWindow),
  );
  runtime = new RuntimeClient(app.getPath("userData"), publish);
  registerIpc();
  startLocalHttpApi();
  createWindow();
  createTray();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
  apiServer?.close();
  apiServer = null;
  runtime?.close();
});
app.on("window-all-closed", () => {
  /* Keep Runtime and schedules alive in the tray. */
});
