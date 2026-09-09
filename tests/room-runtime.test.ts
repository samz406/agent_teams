import { describe, expect, it } from "vitest";
import { evaluateRoomPermissions, formatRoomContext } from "../src/runtime/room-runtime";
import type { Agent, Room, RoomContext, RoomMember } from "../src/shared/contracts";

const permissions = {
  read: true,
  write: true,
  shell: true,
  git: true,
  network: true,
};

describe("room runtime policy", () => {
  it("only narrows permissions and renders durable shared context", () => {
    const agent = { id: "agent", name: "Builder", permissions } as Agent;
    const room = {
      id: "room",
      name: "发布空间",
      goal: "安全发布",
      kind: "PROJECT",
      status: "ACTIVE",
      policy: {
        permissions: { ...permissions, network: false },
        allowAgentDelegation: false,
        responseMode: "MENTION_ONLY",
        maxAgentTurns: 10,
      },
    } as Room;
    const member = {
      id: "member",
      roomId: room.id,
      subjectType: "AGENT",
      subjectId: agent.id,
      role: "AGENT",
      permissions: { ...permissions, write: false },
    } as RoomMember;
    const context = {
      id: "context",
      roomId: room.id,
      version: 3,
      summary: "已完成预检",
      facts: ["主分支为 main"],
      decisions: ["先跑回归"],
      constraints: ["不得跳过审查"],
      openQuestions: [],
      updatedAt: "2026-09-09T00:00:00.000Z",
    } as RoomContext;
    const effective = evaluateRoomPermissions(agent, room, member, permissions);
    expect(effective).toMatchObject({ write: false, network: false });
    expect(formatRoomContext({ room, context, member, permissions: effective })).toContain(
      "先跑回归",
    );
  });

  it("rejects an agent that is not a room member", () => {
    const agent = { id: "agent", name: "Builder", permissions } as Agent;
    const room = {
      name: "受控空间",
      status: "ACTIVE",
      policy: { permissions },
    } as Room;
    expect(() => evaluateRoomPermissions(agent, room, undefined, permissions)).toThrow(
      "不是空间",
    );
  });
});
