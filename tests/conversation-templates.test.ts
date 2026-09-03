import { describe, expect, it } from 'vitest'
import { buildConversationParticipants, CONVERSATION_ROLE_TEMPLATES, findConversationMention, resolveMentionedParticipant } from '../src/shared/conversation-templates'
import type { Agent, ConversationMode, ConversationParticipant } from '../src/shared/contracts'

const agents = ['a', 'b', 'c', 'd'].map((id, index) => ({
  id,
  name: `Executor ${index + 1}`,
  icon: String(index + 1),
  description: '',
  responsibility: '',
  qualityBar: [],
  runtime: index % 2 ? 'codex' : 'claude',
  command: null,
  argsTemplate: null,
  workspaceIds: [],
  permissions: { read: true, write: false, shell: true, git: true, network: true },
  status: 'IDLE',
  currentRunId: null,
  createdAt: new Date(0).toISOString()
})) as Agent[]

describe('conversation role templates', () => {
  it.each(['roundtable', 'brainstorm', 'debate', 'consultation', 'retreat', 'six-hats'] as ConversationMode[])('creates distinct mode roles for %s', mode => {
    const participants = buildConversationParticipants(mode, agents)
    expect(participants).toHaveLength(mode === 'six-hats' ? 6 : 4)
    expect(new Set(participants.map(item => item.agentId)).size).toBe(4)
    expect(new Set(participants.map(item => item.roleName)).size).toBe(participants.length)
    expect(participants.filter(item => item.isLeader)).toHaveLength(1)
    expect(participants.map(item => item.roleName)).toEqual(CONVERSATION_ROLE_TEMPLATES[mode].map(item => item.name))
  })

  it('shows discussion personas instead of executor names', () => {
    expect(buildConversationParticipants('roundtable', agents).map(item => item.roleName)).not.toContain('Executor 1')
    expect(buildConversationParticipants('brainstorm', agents)[1].roleName).toBe('用户洞察者')
    expect(buildConversationParticipants('debate', agents)[2].roleName).toBe('反对方')
    expect(buildConversationParticipants('retreat', agents).map(item => item.roleName)).toEqual(['务虚会主持人', '外部环境观察者', '组织反思者', '未来推演者'])
    expect(buildConversationParticipants('six-hats', agents).map(item => item.roleName)).toEqual(['蓝帽主持人', '白帽·事实', '红帽·直觉', '黑帽·风险', '黄帽·价值', '绿帽·创意'])
    expect(buildConversationParticipants('six-hats', agents).map(item => item.agentId)).toEqual(['a', 'b', 'c', 'd', 'a', 'b'])
  })

  it('detects an active @ query at the cursor', () => {
    expect(findConversationMention('请 @系统思', 6)).toEqual({ start: 2, cursor: 6, query: '系统思' })
    expect(findConversationMention('普通补充', 4)).toBeNull()
  })

  it('resolves an addressed role from the submitted message', () => {
    const participants = buildConversationParticipants('roundtable', agents).map((item, index) => ({ ...item, id: String(index), conversationId: 'c', speakingOrder: index, enabled: true, nativeSessionId: null, createdAt: '' })) as ConversationParticipant[]
    expect(resolveMentionedParticipant('@质疑者 请先找反例', participants)?.roleName).toBe('质疑者')
  })
})
