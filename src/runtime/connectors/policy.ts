import type {
  ConnectorDefinition,
  PermissionSet,
  Room,
} from "../../shared/contracts";

export interface ConnectorPolicyResult {
  allowed: boolean;
  reason: string | null;
}

export function evaluateConnectorPolicy(input: {
  connector: ConnectorDefinition | undefined;
  room: Room | undefined;
  permissions: PermissionSet | undefined;
  approvalPoints?: string[];
}): ConnectorPolicyResult {
  const { connector, room, permissions, approvalPoints = [] } = input;
  if (!connector) return { allowed: false, reason: "连接器不存在" };
  if (!connector.enabled) return { allowed: false, reason: "连接器未启用" };
  if (!room || room.status !== "ACTIVE")
    return { allowed: false, reason: "目标空间不存在或已归档" };
  if (!permissions?.network)
    return { allowed: false, reason: "Agent 缺少 network 权限" };
  if (connector.riskLevel === "HIGH_RISK_WRITE" && !permissions.write)
    return { allowed: false, reason: "高风险写操作要求 write 权限" };
  if (
    connector.requiredApproval &&
    !approvalPoints.some((item) => /connector|外部|审批/i.test(item))
  )
    return { allowed: false, reason: "缺少连接器审批点" };
  return { allowed: true, reason: null };
}
