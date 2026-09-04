import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDatabase } from "../src/main/database";
import {
  ConversationEngine,
  type ConversationExecutor,
} from "../src/runtime/conversation-engine";
import type {
  Agent,
  Conversation,
  ConversationParticipant,
} from "../src/shared/contracts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

class FakeExecutor implements ConversationExecutor {
  calls: Array<{ participantId: string; prompt: string }> = [];
  async execute(
    _conversation: Conversation,
    participant: ConversationParticipant,
    _agent: Agent,
    _turnId: string,
    prompt: string,
  ) {
    this.calls.push({ participantId: participant.id, prompt });
    return {
      content: `${participant.roleName}：我同意先确认目标，但是需要关注执行风险？`,
      nativeSessionId: `session-${participant.id}`,
      inputTokens: 10,
      outputTokens: 20,
      cachedInputTokens: 5,
      cacheCreationInputTokens: 2,
      totalTokens: 37,
      costUsd: 0.001,
      model: "test-model",
    };
  }
  async cancel(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

function setup(maxRounds = 1, mode: Conversation["mode"] = "roundtable") {
  const root = mkdtempSync(join(tmpdir(), "moxt-conversation-"));
  roots.push(root);
  const db = new AppDatabase(join(root, "db.sqlite"));
  const agents = db.snapshot([]).agents.slice(0, 2);
  const conversation = db.createConversation({
    title: "管理能力提升",
    topic: "如何提升管理水平",
    background: "技术负责人，希望从执行走向管理",
    mode,
    maxRounds,
    participants: agents.map((agent, index) => ({
      agentId: agent.id,
      roleName: index ? "组织教练" : "主持人",
      rolePrompt: index ? "关注人的动机与反馈" : "收敛共识和分歧",
      isLeader: index === 0,
    })),
  });
  const executor = new FakeExecutor();
  const engine = new ConversationEngine(db, executor, () => undefined);
  return { db, agents, conversation, executor, engine };
}

describe("conversation engine", () => {
  it("shares prior turns, respects round limit and ends ready to summarize", async () => {
    const { db, conversation, executor, engine } = setup();
    engine.start(conversation.id);
    await waitFor(
      () =>
        db.getConversation(conversation.id)?.status === "READY_TO_SUMMARIZE",
    );
    const restored = db.snapshot([]);
    const turns = restored.conversationTurns.filter(
      (item) =>
        item.conversationId === conversation.id &&
        item.speakerType !== "system",
    );
    expect(turns).toHaveLength(2);
    expect(executor.calls[1].prompt).toContain("组织教练：我同意先确认目标");
    expect(restored.conversationRounds[0].status).toBe("COMPLETED");
    expect(
      restored.conversationMemories[0].disagreements.length,
    ).toBeGreaterThan(0);
    expect(db.getConversation(conversation.id)?.tokenUsed).toBe(74);
    expect(turns[0]).toMatchObject({
      cachedInputTokens: 5,
      cacheCreationInputTokens: 2,
      totalTokens: 37,
      costUsd: 0.001,
      model: "test-model",
    });
  });

  it("keeps one native session per participant and sends only unseen shared turns on resume", async () => {
    const { db, conversation, executor, engine } = setup(2);
    engine.start(conversation.id);
    await waitFor(
      () =>
        db.getConversation(conversation.id)?.status === "READY_TO_SUMMARIZE",
    );
    expect(executor.calls).toHaveLength(4);
    expect(executor.calls[2].prompt).not.toContain("主题：如何提升管理水平");
    expect(executor.calls[2].prompt).toContain("[消息 #2 · 主持人]");
    expect(executor.calls[2].prompt).not.toContain("[消息 #1 · 组织教练]");
    const participants = db.getConversationParticipants(conversation.id);
    expect(
      participants.find((item) => item.roleName === "组织教练"),
    ).toMatchObject({
      nativeSessionId: expect.any(String),
      lastSeenTurnSequence: 3,
    });
    expect(participants.find((item) => item.isLeader)).toMatchObject({
      nativeSessionId: expect.any(String),
      lastSeenTurnSequence: 4,
    });
  });

  it("extends a stopped conversation without replacing participant sessions", async () => {
    const { db, conversation, executor, engine } = setup();
    engine.start(conversation.id);
    await waitFor(
      () =>
        db.getConversation(conversation.id)?.status === "READY_TO_SUMMARIZE",
    );
    expect(db.getConversation(conversation.id)?.stopReason).toBe("MAX_ROUNDS");
    engine.extend(conversation.id, 1);
    await waitFor(
      () =>
        db.getConversation(conversation.id)?.currentRound === 2 &&
        db.getConversation(conversation.id)?.status === "READY_TO_SUMMARIZE",
    );
    expect(db.getConversation(conversation.id)).toMatchObject({
      maxRounds: 2,
      currentRound: 2,
      stopReason: "MAX_ROUNDS",
    });
    expect(executor.calls).toHaveLength(4);
  });

  it("prioritizes a directly addressed participant and creates a leader deliverable", async () => {
    const { db, conversation, executor, engine } = setup();
    const participants = db.getConversationParticipants(conversation.id);
    const target = participants.find((item) => !item.isLeader)!;
    engine.sendMessage(
      conversation.id,
      "请组织教练先分析我的反馈方式。",
      target.id,
    );
    engine.start(conversation.id);
    await waitFor(
      () =>
        db.getConversation(conversation.id)?.status === "READY_TO_SUMMARIZE",
    );
    expect(executor.calls[0].participantId).toBe(target.id);
    expect(executor.calls[0].prompt).toContain("→ 请你回答");
    await engine.summarize(conversation.id, "ACTION_PLAN");
    const snapshot = db.snapshot([]);
    expect(db.getConversation(conversation.id)?.status).toBe("COMPLETED");
    expect(snapshot.conversationDeliverables[0].type).toBe("ACTION_PLAN");
    expect(engine.exportMarkdown(conversation.id).content).toContain(
      "讨论记录",
    );
  });

  it("runs a retreat in strategic stages and creates a strategic agenda", async () => {
    const { db, conversation, executor, engine } = setup(1, "retreat");
    engine.start(conversation.id);
    await waitFor(
      () =>
        db.getConversation(conversation.id)?.status === "READY_TO_SUMMARIZE",
    );
    expect(executor.calls[0].prompt).toContain("务虚会：拉开时间尺度");
    expect(executor.calls[0].prompt).toContain("未来一到三年");
    expect(executor.calls[1].prompt).toContain("避免过早拆任务");
    await engine.summarize(conversation.id, "STRATEGIC_AGENDA");
    expect(executor.calls[2].prompt).toContain("战略议题清单");
    expect(executor.calls[2].prompt).toContain(
      "不要把务虚会强行改写成任务分解",
    );
    expect(db.getConversationDeliverables(conversation.id)[0]).toMatchObject({
      type: "STRATEGIC_AGENDA",
      title: "管理能力提升 · 战略议题清单",
    });
  });

  it("keeps six-hat perspectives separated and produces a six-hat report", async () => {
    const { db, conversation, executor, engine } = setup(1, "six-hats");
    engine.start(conversation.id);
    await waitFor(
      () =>
        db.getConversation(conversation.id)?.status === "READY_TO_SUMMARIZE",
    );
    expect(executor.calls[0].prompt).toContain("白帽处理事实");
    expect(executor.calls[0].prompt).toContain("各帽严格从自己的单一视角");
    expect(executor.calls[1].prompt).toContain("不要替其他帽子发言");
    await engine.summarize(conversation.id, "SIX_HATS_REPORT");
    expect(executor.calls[2].prompt).toContain("六帽分析报告");
    expect(executor.calls[2].prompt).toContain("不要混淆事实、感受与判断");
    expect(db.getConversationDeliverables(conversation.id)[0]).toMatchObject({
      type: "SIX_HATS_REPORT",
      title: "管理能力提升 · 六帽分析报告",
    });
  });

  it("requires exactly one leader", () => {
    const root = mkdtempSync(join(tmpdir(), "moxt-conversation-validation-"));
    roots.push(root);
    const db = new AppDatabase(join(root, "db.sqlite"));
    const agents = db.snapshot([]).agents.slice(0, 2);
    expect(() =>
      db.createConversation({
        title: "x",
        topic: "y",
        background: "",
        mode: "debate",
        maxRounds: 2,
        participants: agents.map((agent) => ({
          agentId: agent.id,
          roleName: agent.name,
          rolePrompt: "",
          isLeader: false,
        })),
      }),
    ).toThrow("必须且只能有一个 Leader");
  });

  it("uses rounds as the only configured conversation limit", () => {
    const root = mkdtempSync(join(tmpdir(), "moxt-conversation-budget-"));
    roots.push(root);
    const db = new AppDatabase(join(root, "db.sqlite"));
    const agents = db.snapshot([]).agents.slice(0, 2);
    const conversation = db.createConversation({
      title: "x",
      topic: "y",
      background: "",
      mode: "roundtable",
      maxRounds: 20,
      participants: agents.map((agent, index) => ({
        agentId: agent.id,
        roleName: index ? "实践顾问" : "讨论主持人",
        rolePrompt: "",
        isLeader: index === 0,
      })),
    });
    expect(conversation.maxRounds).toBe(20);
    expect(db.getConversation(conversation.id)).not.toHaveProperty(
      "maxMessages",
    );
    expect(db.getConversation(conversation.id)).not.toHaveProperty("maxTokens");
  });
});

async function waitFor(
  predicate: () => boolean,
  timeout = 2000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
