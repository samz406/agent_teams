export interface TeamAction { agent: string; prompt: string }

const agentAliases: Record<string, string> = {
  backend: 'Code Agent',
  frontend: 'Code Agent',
  developer: 'Code Agent',
  coder: 'Code Agent',
  'code agent': 'Code Agent',
  qa: 'QA Agent',
  tester: 'QA Agent',
  test: 'QA Agent',
  'qa agent': 'QA Agent',
  architect: 'Architect',
  architecture: 'Architect',
  leader: 'Leader',
  lead: 'Leader'
}

export function extractSessionId(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      const id = value.session_id ?? value.sessionId ?? value.thread_id ?? value.threadId
      if (typeof id === 'string') return id
    } catch { /* raw text line */ }
  }
  return null
}

export function extractFinalResponse(output: string): string {
  const lines = output.split(/\r?\n/)
  const text: string[] = []
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      const candidate = value.result ?? value.final_response ?? value.message ?? value.text
      if (typeof candidate === 'string') text.push(candidate)
      else if (candidate && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).content === 'string') text.push(String((candidate as Record<string, unknown>).content))
    } catch {
      if (line.trim()) text.push(line)
    }
  }
  return text.join('\n').trim().slice(-20000) || 'CLI 已结束，但没有返回可解析的 Final Response。请打开 Run 查看原始输出。'
}

export function extractTeamActions(output: string): TeamAction[] {
  const actions: TeamAction[] = []
  const blockPattern = /```(team-actions|json)\s*([\s\S]*?)```/gi
  for (const match of output.matchAll(blockPattern)) {
    try {
      const parsed = JSON.parse(match[2]) as unknown
      if (!Array.isArray(parsed) || !parsed.length) continue
      const valid = parsed.filter((item): item is TeamAction => Boolean(item && typeof item === 'object' && typeof (item as TeamAction).agent === 'string' && typeof (item as TeamAction).prompt === 'string'))
      // A generic json block is considered delegation only when the whole array is made of team actions.
      if (match[1].toLowerCase() === 'json' && valid.length !== parsed.length) continue
      actions.push(...valid)
    } catch { /* ignore malformed delegation blocks */ }
  }

  const merged = new Map<string, TeamAction>()
  for (const action of actions) {
    const agent = canonicalAgentName(action.agent)
    const prompt = action.prompt.trim()
    if (!agent || !prompt) continue
    const existing = merged.get(agent)
    merged.set(agent, existing ? { agent, prompt: `${existing.prompt}\n\n--- Additional delegated work ---\n${prompt}` } : { agent, prompt })
  }
  return [...merged.values()].slice(0, 3)
}

function canonicalAgentName(value: string): string {
  const trimmed = value.trim()
  return agentAliases[trimmed.toLowerCase()] ?? trimmed
}
