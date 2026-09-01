import { describe, expect, it } from 'vitest'
import { extractFinalResponse, extractSessionId, extractTeamActions, extractTokenUsage } from '../src/main/runtime/parser'

describe('real runtime output parser', () => {
  it('extracts native session identity and final response from JSONL', () => {
    const output = [
      JSON.stringify({ type: 'thread.started', thread_id: 'session-42' }),
      JSON.stringify({ text: 'Investigating repository' }),
      JSON.stringify({ final_response: 'Root cause confirmed with test evidence.' })
    ].join('\n')
    expect(extractSessionId(output)).toBe('session-42')
    expect(extractFinalResponse(output)).toContain('Root cause confirmed')
  })

  it('extracts exact usage when available and estimates when absent', () => {
    expect(extractTokenUsage('{"usage":{"input_tokens":120,"output_tokens":45}}', 'prompt', 'answer')).toEqual({ inputTokens: 120, outputTokens: 45 })
    expect(extractTokenUsage('plain', '123456', '123')).toEqual({ inputTokens: 2, outputTokens: 1 })
  })

  it('accepts only bounded, valid team delegation actions', () => {
    const actions = extractTeamActions('```team-actions\n[{"agent":"QA Agent","prompt":"Run the original reproduction case"}]\n```')
    expect(actions).toEqual([{ agent: 'QA Agent', prompt: 'Run the original reproduction case' }])
    expect(extractTeamActions('```team-actions\nnot-json\n```')).toEqual([])
  })

  it('accepts generic json delegation, normalizes role aliases, and merges duplicate targets', () => {
    const actions = extractTeamActions(`\`\`\`json
[
  {"agent":"Backend","prompt":"Implement backend endpoints"},
  {"agent":"Frontend","prompt":"Implement frontend adapter"},
  {"agent":"Architect","prompt":"Write integration notes"}
]
\`\`\``)
    expect(actions).toHaveLength(2)
    expect(actions[0].agent).toBe('Code Agent')
    expect(actions[0].prompt).toContain('Implement backend endpoints')
    expect(actions[0].prompt).toContain('Implement frontend adapter')
    expect(actions[1]).toEqual({ agent: 'Architect', prompt: 'Write integration notes' })
  })

  it('does not interpret unrelated json arrays as delegation', () => {
    expect(extractTeamActions('```json\n[{"name":"asset","path":"a.json"}]\n```')).toEqual([])
  })
})
