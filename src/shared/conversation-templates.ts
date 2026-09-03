import type { Agent, ConversationMode, ConversationParticipant, CreateConversationInput } from './contracts'

export interface ConversationRoleTemplate {
  name: string
  prompt: string
  isLeader: boolean
}

export const CONVERSATION_ROLE_TEMPLATES: Record<ConversationMode, ConversationRoleTemplate[]> = {
  roundtable: [
    { name: '讨论主持人', prompt: '控制讨论节奏，提炼共识、分歧和待确认问题，推动观点交叉与逐步收敛。', isLeader: true },
    { name: '实践顾问', prompt: '从真实场景和落地经验出发，给出具体判断、案例与可执行建议。', isLeader: false },
    { name: '系统思考者', prompt: '从结构、边界、反馈回路、长期演进和二阶影响分析问题。', isLeader: false },
    { name: '质疑者', prompt: '检查隐含假设，寻找反例、风险、证据缺口和可能被忽视的代价。', isLeader: false }
  ],
  brainstorm: [
    { name: '创意主持人', prompt: '保护发散空间，连接不同想法，在后半程组织聚类、筛选和收敛。', isLeader: true },
    { name: '用户洞察者', prompt: '从用户动机、使用场景、情绪和未被满足的需求寻找机会。', isLeader: false },
    { name: '跨界创意者', prompt: '借用其他行业、产品和技术的机制，提出有差异度的大胆组合。', isLeader: false },
    { name: '可行性筛选者', prompt: '评估创意的价值、成本、风险和验证路径，但不要过早扼杀发散。', isLeader: false }
  ],
  debate: [
    { name: '辩论主持人', prompt: '澄清命题和判断标准，平衡双方发言，识别有效论据并形成条件化结论。', isLeader: true },
    { name: '支持方', prompt: '为命题构建最强论证，给出依据、适用条件、收益和具体案例。', isLeader: false },
    { name: '反对方', prompt: '主动寻找反例、失败条件、机会成本和二阶负面影响。', isLeader: false },
    { name: '中立评审', prompt: '区分事实、假设和立场，比较论证质量并指出还缺少哪些证据。', isLeader: false }
  ],
  consultation: [
    { name: '会诊主持人', prompt: '定义问题、组织假设，综合各方意见并明确结论、风险和下一步。', isLeader: true },
    { name: '领域专家', prompt: '从专业原理、行业经验和已知模式提出诊断假设与判断依据。', isLeader: false },
    { name: '实施顾问', prompt: '把建议转化为可执行步骤、资源安排、验证指标和迭代路径。', isLeader: false },
    { name: '风险顾问', prompt: '识别信息缺口、边界条件、副作用和需要提前准备的兜底方案。', isLeader: false }
  ],
  retreat: [
    { name: '务虚会主持人', prompt: '拉开时间尺度，明确讨论边界，避免过早进入执行细节；识别关键变化、战略矛盾和待验证假设，最终形成战略议题。', isLeader: true },
    { name: '外部环境观察者', prompt: '从行业、技术、用户、竞争和政策变化中识别趋势、机会、威胁及其时间窗口。', isLeader: false },
    { name: '组织反思者', prompt: '审视现有目标、资源配置、能力结构、协作方式与路径依赖，指出制约长期发展的根本矛盾。', isLeader: false },
    { name: '未来推演者', prompt: '构造乐观、基准和压力情景，检验关键假设、二阶影响与不行动的代价，提出需要验证的方向。', isLeader: false }
  ],
  'six-hats': [
    { name: '蓝帽主持人', prompt: '管理思考流程，定义问题与判断标准，确保六种视角不混淆，最后综合结论、选择与下一步。', isLeader: true },
    { name: '白帽·事实', prompt: '只处理事实、数据、已知信息和证据缺口；明确区分事实、推测与仍需验证的信息。', isLeader: false },
    { name: '红帽·直觉', prompt: '表达直觉、情绪、偏好和担忧，不强行为感受寻找理性证明，并指出相关人的可能反应。', isLeader: false },
    { name: '黑帽·风险', prompt: '审查失败条件、约束、成本、副作用和不可逆后果，说明风险发生的机制而非泛泛否定。', isLeader: false },
    { name: '黄帽·价值', prompt: '寻找收益、机会、优势和可行条件，说明价值如何产生以及在哪些前提下成立。', isLeader: false },
    { name: '绿帽·创意', prompt: '打破既有假设，提出替代方案、组合方案和低成本试验，不重复已有选项。', isLeader: false }
  ]
}

export function buildConversationParticipants(mode: ConversationMode, agents: Agent[]): CreateConversationInput['participants'] {
  const usable = agents.filter(agent => agent.status !== 'ERROR' && agent.status !== 'OFFLINE')
  const executors = usable.length >= 2 ? usable : agents
  const templates = CONVERSATION_ROLE_TEMPLATES[mode]
  const roleCount = mode === 'six-hats' ? templates.length : Math.min(4, executors.length)
  if (!executors.length) return []
  return templates.slice(0, roleCount).map((template, index) => ({
    agentId: executors[index % executors.length].id,
    roleName: template.name,
    rolePrompt: template.prompt,
    isLeader: template.isLeader
  }))
}

export interface ConversationMention {
  start: number
  cursor: number
  query: string
}

export function findConversationMention(value: string, cursor: number): ConversationMention | null {
  const beforeCursor = value.slice(0, cursor)
  const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/)
  return match ? { start: beforeCursor.lastIndexOf('@'), cursor, query: match[1] } : null
}

export function resolveMentionedParticipant(value: string, participants: ConversationParticipant[]): ConversationParticipant | undefined {
  return participants.find(participant => value.includes(`@${participant.roleName}`))
}
