import { describe, expect, it } from 'vitest'
import { extractFinalResponse, extractSessionId, extractTeamActions } from '../src/main/runtime/parser'

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

  it('accepts only bounded, valid team delegation actions', () => {
    const actions = extractTeamActions('```team-actions\n[{"agent":"QA Agent","prompt":"Run the original reproduction case"}]\n```')
    expect(actions).toEqual([{ agent: 'QA Agent', prompt: 'Run the original reproduction case' }])
    expect(extractTeamActions('```team-actions\nnot-json\n```')).toEqual([])
  })
})
