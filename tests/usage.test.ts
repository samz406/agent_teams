import { describe, expect, it } from 'vitest'
import { aggregateRunUsage, extractUsageSummary, parseUsageEvidence, usageForRun } from '../src/shared/usage'
import type { Evidence, Run } from '../src/shared/contracts'

describe('runtime usage metering', () => {
  it('extracts Claude Code usage and prefers runtime-reported cost', () => {
    const output = JSON.stringify({
      type: 'result',
      model: 'claude-sonnet-5',
      usage: { input_tokens: 1200, cache_creation_input_tokens: 300, cache_read_input_tokens: 5000, output_tokens: 800 },
      total_cost_usd: 0.0421
    })
    const result = extractUsageSummary(output)
    expect(result?.provider).toBe('anthropic')
    expect(result?.model).toBe('claude-sonnet-5')
    expect(result?.usage).toMatchObject({ inputTokens: 1200, cacheCreationInputTokens: 300, cachedInputTokens: 5000, outputTokens: 800, totalTokens: 7300 })
    expect(result?.costType).toBe('REPORTED')
    expect(result?.costUsd).toBe(0.0421)
  })

  it('extracts Codex turn usage and estimates current public rate-card cost', () => {
    const output = [
      JSON.stringify({ type: 'thread.started', thread_id: 'abc', model: 'gpt-5.6-terra' }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10000, cached_input_tokens: 4000, output_tokens: 2000 } })
    ].join('\n')
    const result = extractUsageSummary(output)
    expect(result?.provider).toBe('openai')
    expect(result?.model).toBe('gpt-5.6-terra')
    expect(result?.usage.totalTokens).toBe(12000)
    expect(result?.costType).toBe('ESTIMATED')
    // 6k normal input * $2/M + 4k cached * $0.2/M + 2k output * $12/M = $0.0368
    expect(result?.costUsd).toBeCloseTo(0.0368, 6)
  })

  it('persists usage as evidence and aggregates multiple runs without inventing missing cost', () => {
    const first = extractUsageSummary(JSON.stringify({ type: 'turn.completed', model: 'gpt-5.6-luna', usage: { input_tokens: 5000, cached_input_tokens: 1000, output_tokens: 1000 } }))!
    const second = extractUsageSummary(JSON.stringify({ type: 'result', model: 'claude-sonnet-5', usage: { input_tokens: 2000, output_tokens: 500 }, total_cost_usd: 0.02 }))!
    const runs = [makeRun('a', first), makeRun('b', second)]
    const aggregate = aggregateRunUsage(runs)
    expect(aggregate.usageRuns).toBe(2)
    expect(aggregate.pricedRuns).toBe(2)
    expect(aggregate.usage.totalTokens).toBe(first.usage.totalTokens + second.usage.totalTokens)
    expect(aggregate.costUsd).toBeGreaterThan(0.02)
    expect(usageForRun(runs[0])?.model).toBe('gpt-5.6-luna')
    expect(parseUsageEvidence(runs[1].evidence[0].detail)?.costType).toBe('REPORTED')
  })
})

function makeRun(id: string, summary: NonNullable<ReturnType<typeof extractUsageSummary>>): Run {
  const evidence: Evidence = { id: `e-${id}`, runId: id, type: 'USAGE', title: 'usage', status: 'PASS', detail: JSON.stringify(summary), createdAt: new Date().toISOString() }
  return { id, changeId: 'change', agentId: 'agent', taskId: null, agentSessionId: null, parentRunId: null, status: 'COMPLETED', prompt: 'task', runtime: 'codex', executable: 'codex', workspacePath: '/tmp', startedAt: null, endedAt: null, exitCode: 0, sessionId: null, stdout: '', stderr: '', finalResponse: '', baseCommit: null, retryReason: null, evidence: [evidence] }
}
