import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateAgentInput,
  CreateChangeInput,
  CreateConversationInput,
  CreateMemoryInput,
  CreateScheduleInput,
  CreateSkillInput,
  CreateWorkOrderInput,
  DesktopApi,
  RuntimeEvent,
  UpdateAgentInput,
  UpsertAgentProfileInput,
} from "../shared/contracts";

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke("app:snapshot"),
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),
  createChange: (input: CreateChangeInput) =>
    ipcRenderer.invoke("change:create", input),
  startChange: (changeId: string, reason?: string) =>
    ipcRenderer.invoke("change:kick", changeId, reason),
  createAgent: (input: CreateAgentInput) =>
    ipcRenderer.invoke("agent:create", input),
  updateAgent: (input: UpdateAgentInput) =>
    ipcRenderer.invoke("agent:update", input),
  sendMessage: (changeId: string, content: string, targetAgentId?: string) =>
    ipcRenderer.invoke("message:send", changeId, content, targetAgentId),
  controlRun: (runId, action, reason) =>
    ipcRenderer.invoke("run:control", runId, action, reason),
  advanceWorkflow: (changeId) =>
    ipcRenderer.invoke("workflow:advance", changeId),
  approveArtifact: (artifactId, approve, feedback) =>
    ipcRenderer.invoke("artifact:approve", artifactId, approve, feedback),
  detectRuntimes: () => ipcRenderer.invoke("runtime:detect"),
  updateIssue: (issueId, status, resolution) =>
    ipcRenderer.invoke("issue:update", issueId, status, resolution),
  createConversation: (input: CreateConversationInput) =>
    ipcRenderer.invoke("conversation:create", input),
  controlConversation: (conversationId, action) =>
    ipcRenderer.invoke("conversation:control", conversationId, action),
  extendConversation: (conversationId, additionalRounds) =>
    ipcRenderer.invoke("conversation:extend", conversationId, additionalRounds),
  sendConversationMessage: (conversationId, content, targetParticipantId) =>
    ipcRenderer.invoke(
      "conversation:message",
      conversationId,
      content,
      targetParticipantId,
    ),
  summarizeConversation: (conversationId, type) =>
    ipcRenderer.invoke("conversation:summarize", conversationId, type),
  convertConversation: (conversationId, input) =>
    ipcRenderer.invoke("conversation:convert", conversationId, input),
  exportConversation: (conversationId) =>
    ipcRenderer.invoke("conversation:export", conversationId),
  upsertAgentProfile: (input: UpsertAgentProfileInput) =>
    ipcRenderer.invoke("agent-profile:upsert", input),
  createMemory: (input: CreateMemoryInput) =>
    ipcRenderer.invoke("memory:create", input),
  decideMemory: (memoryId, decision) =>
    ipcRenderer.invoke("memory:decide", memoryId, decision),
  createSkill: (input: CreateSkillInput) =>
    ipcRenderer.invoke("skill:create", input),
  publishSkill: (skillVersionId) =>
    ipcRenderer.invoke("skill:publish", skillVersionId),
  createWorkOrder: (input: CreateWorkOrderInput) =>
    ipcRenderer.invoke("work-order:create", input),
  controlWorkOrder: (id, action) =>
    ipcRenderer.invoke("work-order:control", id, action),
  createSchedule: (input: CreateScheduleInput) =>
    ipcRenderer.invoke("schedule:create", input),
  updateSchedule: (id, enabled) =>
    ipcRenderer.invoke("schedule:update", id, enabled),
  testSchedule: (scheduleId) => ipcRenderer.invoke("schedule:test", scheduleId),
  markNotificationRead: (id) => ipcRenderer.invoke("notification:read", id),
  onRuntimeEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: RuntimeEvent,
    ): void => listener(payload);
    ipcRenderer.on("runtime:event", handler);
    return () => ipcRenderer.removeListener("runtime:event", handler);
  },
};

contextBridge.exposeInMainWorld("moxt", api);
