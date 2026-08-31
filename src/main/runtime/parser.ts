export interface TeamAction { agent: string; prompt: string }

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
  const match = output.match(/```team-actions\s*([\s\S]*?)```/i)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1]) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is TeamAction => Boolean(item && typeof item.agent === 'string' && typeof item.prompt === 'string')).slice(0, 3)
  } catch { return [] }
}
