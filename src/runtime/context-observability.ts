import type { Evidence, PermissionSet, RoomPolicy, SkillVersion } from "../shared/contracts";

export interface ContextSegments {
  room_context: string;
  profile?: string;
  trusted_memory?: string;
  untrusted_memory?: string;
  skills?: string;
  conversation_recent?: string;
  instruction: string;
}

export function buildContextUsageEvidence(
  title: string,
  segments: ContextSegments,
): Omit<Evidence, "id" | "runId" | "createdAt"> {
  const entries = Object.entries(segments).map(([key, value]) => ({
    segment: key,
    tokens: estimate(value ?? ""),
  }));
  const total = entries.reduce((sum, item) => sum + item.tokens, 0);
  return {
    type: "CONTEXT_USAGE",
    title,
    status: "PASS",
    detail: JSON.stringify({
      totalTokens: total,
      segments: entries.map((item) => ({
        ...item,
        ratio: total ? Number((item.tokens / total).toFixed(4)) : 0,
      })),
    }),
  };
}

export function buildExecutionManifest(input: {
  runtime: string;
  permissions: PermissionSet;
  roomPolicy: RoomPolicy;
  skills: SkillVersion[];
  requiredEvidence: string[];
  workspaceId: string;
  workspacePath: string;
  resumeNative: boolean;
  subject: "CHANGE" | "WORK_ORDER";
}): Omit<Evidence, "id" | "runId" | "createdAt"> {
  return {
    type: "MANIFEST",
    title: `${input.subject} execution manifest`,
    status: "PASS",
    detail: JSON.stringify({
      runtime: input.runtime,
      permissions: input.permissions,
      roomPolicy: input.roomPolicy,
      skills: input.skills.map((item) => ({
        id: item.id,
        version: item.version,
        checksum: item.checksum,
      })),
      requiredEvidence: input.requiredEvidence,
      workspace: {
        id: input.workspaceId,
        path: input.workspacePath,
      },
      resumeNative: input.resumeNative,
      subject: input.subject,
    }),
  };
}

const estimate = (value: string): number => Math.max(1, Math.ceil(value.length / 3));
