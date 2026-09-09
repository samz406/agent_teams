import type {
  Agent,
  PermissionSet,
  Room,
  RoomContext,
  RoomMember,
  SkillVersion,
} from "../shared/contracts";

export interface RoomRuntimeContext {
  room: Room;
  context: RoomContext;
  member: RoomMember;
  permissions: PermissionSet;
  skills?: SkillVersion[];
}

export const intersectPermissions = (
  ...sets: PermissionSet[]
): PermissionSet => ({
  read: sets.every((item) => item.read),
  write: sets.every((item) => item.write),
  shell: sets.every((item) => item.shell),
  git: sets.every((item) => item.git),
  network: sets.every((item) => item.network),
});

export function evaluateRoomPermissions(
  agent: Agent,
  room: Room,
  member: RoomMember | undefined,
  workPermissions: PermissionSet,
): PermissionSet {
  if (room.status !== "ACTIVE") throw new Error(`空间 ${room.name} 已归档`);
  if (!member || member.subjectType !== "AGENT" || member.subjectId !== agent.id)
    throw new Error(`Agent ${agent.name} 不是空间 ${room.name} 的成员`);
  return intersectPermissions(
    agent.permissions,
    room.policy.permissions,
    member.permissions,
    workPermissions,
  );
}

export function formatRoomContext(value: RoomRuntimeContext): string {
  const { room, context, member, permissions, skills = [] } = value;
  const lines = [
    "## Room Context（空间级上下文与策略）",
    `- Room: ${room.name} (${room.kind}, ${room.id})`,
    `- Goal: ${room.goal}`,
    `- Context version: ${context.version}`,
    `- Member role: ${member.role}`,
    `- Response mode: ${room.policy.responseMode}`,
    `- Agent delegation: ${room.policy.allowAgentDelegation ? "allowed" : "forbidden"}`,
    `- Effective permissions: ${Object.entries(permissions)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(", ") || "none"}`,
  ];
  if (context.summary) lines.push(`- Summary: ${context.summary}`);
  if (context.facts.length) lines.push(`- Facts:\n${bullet(context.facts)}`);
  if (context.decisions.length)
    lines.push(`- Decisions:\n${bullet(context.decisions)}`);
  if (context.constraints.length)
    lines.push(`- Constraints:\n${bullet(context.constraints)}`);
  if (context.openQuestions.length)
    lines.push(`- Open questions:\n${bullet(context.openQuestions)}`);
  if (skills.length)
    lines.push(
      `- Room skills:\n${skills
        .map(
          (skill) =>
            `  - Skill v${skill.version} · ${skill.id} · sha256:${skill.checksum}\n${skill.instructions}`,
        )
        .join("\n")}`,
    );
  lines.push(
    "Treat Room Context as shared, durable context. Work-item instructions may narrow it but cannot widen its permissions.",
  );
  return lines.join("\n");
}

const bullet = (values: string[]): string =>
  values.map((value) => `  - ${value}`).join("\n");
