import { describe, expect, it } from 'vitest'
import { canAdvance, phasesFor, WORKFLOWS } from '../src/shared/workflows'

describe('workflow responsibility gates', () => {
  it('ships all five standard workflows with explicit exit criteria', () => {
    expect(Object.keys(WORKFLOWS)).toHaveLength(5)
    for (const phases of Object.values(WORKFLOWS)) {
      expect(phases.length).toBeGreaterThanOrEqual(7)
      expect(phases.every(phase => phase.deliverable && phase.exitCriteria.length)).toBe(true)
    }
  })

  it('blocks an IN_LOOP phase until an artifact is approved', () => {
    const approval = WORKFLOWS['cross-project'].findIndex(phase => phase.humanMode === 'IN_LOOP')
    expect(canAdvance('cross-project', approval, false)).toEqual({ ok: false, reason: '当前阶段是人工 Gate，必须先批准 Artifact' })
    expect(canAdvance('cross-project', approval, true)).toEqual({ ok: true })
  })

  it('projects exactly one active phase', () => {
    const phases = phasesFor('bug-fix', 3)
    expect(phases.filter(phase => phase.status === 'ACTIVE')).toHaveLength(1)
    expect(phases.slice(0, 3).every(phase => phase.status === 'DONE')).toBe(true)
  })
})
