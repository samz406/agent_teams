import type { WorkflowPhase, WorkflowType } from './contracts'

type PhaseTemplate = Omit<WorkflowPhase, 'status'>

export const WORKFLOW_LABELS: Record<WorkflowType, { name: string; description: string }> = {
  'cross-project': { name: '跨项目协同开发', description: '多个项目围绕契约并行调查、开发与联调' },
  incident: { name: '线上问题会诊', description: '并行收集证据，区分症状、假设与根因' },
  'bug-fix': { name: 'Bug 修复', description: '先复现、再修复，并由独立 Agent 验证' },
  refactor: { name: '大型重构', description: '建立行为基线后分步、可回退地重构' },
  release: { name: '发布前检查', description: '并行检查风险，基于证据做 Go / No-Go' }
}

export const WORKFLOWS: Record<WorkflowType, PhaseTemplate[]> = {
  'cross-project': [
    p('discovery', 'Discovery', '理解各项目现状与边界', '调查报告', ['各 Workspace 现状已确认'], 'AUTO'),
    p('proposal', 'Proposal', '形成联合方案与接口契约', 'Proposal / Contract', ['方案可评审', '影响范围明确'], 'REVIEW'),
    p('approval', 'Approval', '人工确认关键方案', 'Approved Proposal', ['方案已批准'], 'IN_LOOP'),
    p('development', 'Development', '按契约并行实现', '代码、测试、Diff', ['各 Workstream 完成', '测试证据存在'], 'ON_LOOP'),
    p('integration', 'Integration', '执行真实联调', 'Integration Result', ['关键 Case 通过', '阻塞问题清零'], 'ON_LOOP'),
    p('review', 'Review', '独立审查变更与证据', 'Review Report', ['无 Blocking Issue'], 'REVIEW'),
    p('done', 'Done', '完成交付', 'Change Summary', ['全部 Gate 通过'], 'AUTO')
  ],
  incident: [
    p('intake', 'Incident Intake', '明确现象、时间窗与影响', 'Incident Brief', ['现象可观测'], 'AUTO'),
    p('investigation', 'Parallel Investigation', '多方向并行调查', 'Investigation Notes', ['至少两个证据源'], 'ON_LOOP'),
    p('evidence', 'Evidence Collection', '收敛可验证证据', 'Evidence Set', ['关键假设均有证据状态'], 'AUTO'),
    p('root-cause', 'Root Cause Proposal', '区分症状、根因与未知项', 'Root Cause Report', ['结论标记置信度'], 'REVIEW'),
    p('fix', 'Fix', '修复已确认根因', 'Fix Diff', ['测试通过'], 'ON_LOOP'),
    p('verify', 'Verify', '验证性能与功能恢复', 'Verification Report', ['指标恢复', '无回归'], 'REVIEW'),
    p('done', 'Done', '关闭事故', 'Incident Summary', ['行动项明确'], 'AUTO')
  ],
  'bug-fix': [
    p('reproduce', 'Reproduce', '稳定复现缺陷', 'Reproduction Case', ['Expected/Actual/Evidence 完整'], 'AUTO'),
    p('root-cause', 'Root Cause', '确认缺陷机制', 'Root Cause Note', ['因果链清晰'], 'AUTO'),
    p('fix', 'Fix', '最小范围修复', 'Fix Diff', ['实现与复现关联'], 'ON_LOOP'),
    p('verify', 'Independent Verify', '由独立 Agent 重跑原 Case', 'Verification Evidence', ['验证者不是实现者', '原 Case 通过'], 'REVIEW'),
    p('regression', 'Regression', '执行回归检查', 'Regression Result', ['相关测试通过'], 'AUTO'),
    p('review', 'Review', '审查范围与风险', 'Review Report', ['无 Blocking Issue'], 'REVIEW'),
    p('done', 'Done', '完成修复', 'Bug Fix Summary', ['全部 Gate 通过'], 'AUTO')
  ],
  refactor: [
    p('behavior', 'Behavior Discovery', '识别现有真实行为', 'Behavior Map', ['关键行为已覆盖'], 'AUTO'),
    p('characterization', 'Characterization Tests', '建立可执行行为基线', 'Characterization Tests', ['测试可稳定运行'], 'AUTO'),
    p('proposal', 'Architecture Proposal', '设计增量重构步骤', 'Refactor Proposal', ['至少两个增量 Step'], 'REVIEW'),
    p('approval', 'Human Approval', '人工确认范围与回退策略', 'Approved Proposal', ['方案已批准'], 'IN_LOOP'),
    p('refactor', 'Incremental Refactor', '逐步修改并逐步验收', 'Step Diffs', ['每步测试通过'], 'ON_LOOP'),
    p('regression', 'Regression', '证明核心行为未改变', 'Regression Evidence', ['行为基线全通过'], 'AUTO'),
    p('review', 'Review', '检查越界修改', 'Review Report', ['无 Scope Creep'], 'REVIEW'),
    p('done', 'Done', '完成重构', 'Refactor Summary', ['全部 Gate 通过'], 'AUTO')
  ],
  release: [
    p('freeze', 'Scope Freeze', '锁定本次发布范围', 'Release Scope', ['版本范围明确'], 'REVIEW'),
    p('checks', 'Parallel Checks', '并行检查代码、测试、配置与安全', 'Check Results', ['检查项均有 PASS/WARN/FAIL'], 'ON_LOOP'),
    p('triage', 'Risk Triage', '识别并分派阻塞风险', 'Risk Register', ['Blocking 均有 Owner'], 'REVIEW'),
    p('fix', 'Fix Blocking Issues', '修复阻塞项', 'Fix Evidence', ['Blocking FAIL 清零'], 'ON_LOOP'),
    p('recheck', 'Recheck', '重跑受影响检查', 'Recheck Result', ['受影响检查已重跑'], 'AUTO'),
    p('decision', 'Go / No-Go', '基于证据做发布决策', 'Release Decision', ['无 Blocking FAIL'], 'IN_LOOP'),
    p('done', 'Done', '完成发布准备', 'Readiness Report', ['决策已记录'], 'AUTO')
  ]
}

function p(id: string, name: string, goal: string, deliverable: string, exitCriteria: string[], humanMode: PhaseTemplate['humanMode']): PhaseTemplate {
  return { id, name, goal, deliverable, exitCriteria, humanMode }
}

export function phasesFor(type: WorkflowType, current: number): WorkflowPhase[] {
  return WORKFLOWS[type].map((phase, index) => ({ ...phase, status: index < current ? 'DONE' : index === current ? 'ACTIVE' : 'PENDING' }))
}

export function canAdvance(type: WorkflowType, current: number, hasApprovedArtifact: boolean): { ok: boolean; reason?: string } {
  const phase = WORKFLOWS[type][current]
  if (!phase) return { ok: false, reason: 'Workflow 已结束' }
  if (phase.humanMode === 'IN_LOOP' && !hasApprovedArtifact) return { ok: false, reason: '当前阶段是人工 Gate，必须先批准 Artifact' }
  return { ok: true }
}
